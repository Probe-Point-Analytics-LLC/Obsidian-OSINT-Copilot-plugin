import { ClaudeCodeService, type ClaudeCodeConfig } from './claude-code-service';
import { splitCliArgsLine } from './agent-runtime/cli-args';

export interface CodexCliConfig extends ClaudeCodeConfig {}

export interface CodexLoginStatus {
    authenticated: boolean;
    message: string;
}

const FRAMEWORK_OWNED_CODEX_ARGS = new Set([
    '--ask-for-approval',
    '--sandbox',
    '--approve-for-me',
    '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-bypass-hook-trust',
    '--full-auto',
    '--yolo',
    '--cd',
    '--add-dir',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color',
    '--json',
    '--experimental-json',
    '--output-last-message',
    '--image',
    '--model',
    '--help',
    '--version',
    '--remote',
    '--remote-auth-token-env',
    '--no-alt-screen',
]);

const FRAMEWORK_OWNED_CODEX_SHORT_ARGS = new Set(['-a', '-s', '-C', '-o', '-i', '-m', '-h', '-V']);

/**
 * Extra arguments may select providers/profiles/features, but cannot replace the
 * invocation contract that keeps plugin calls read-only, non-interactive, and plain-text.
 */
function validateExtraArgs(extra: string[]): void {
    for (const token of extra) {
        const longName = token.startsWith('--') ? token.split('=', 1)[0] : '';
        const shortName = token.length >= 2 && token[0] === '-' && token[1] !== '-'
            ? token.slice(0, 2)
            : '';
        if (
            FRAMEWORK_OWNED_CODEX_ARGS.has(longName) ||
            FRAMEWORK_OWNED_CODEX_SHORT_ARGS.has(shortName) ||
            token === '-' ||
            token === '--' ||
            token === 'resume' ||
            token === 'review' ||
            token === 'help'
        ) {
            throw new Error(
                `Unsupported Codex extra CLI argument: ${token}. ` +
                'OSINT Copilot owns approval, sandbox, output, model, image, working-directory, and session flags, or this flag is incompatible with codex exec.',
            );
        }
    }
}

/** True when argv explicitly delegates provider/auth selection to local Codex configuration. */
function hasExternalProviderSelection(extra: string[]): boolean {
    for (let i = 0; i < extra.length; i++) {
        const token = extra[i];
        if (token === '--oss' || token === '--local-provider' || token.startsWith('--local-provider=')) {
            return true;
        }
        if (token === '--profile' || token === '-p' || token.startsWith('--profile=') || /^-p.+/.test(token)) {
            return true;
        }
        const configValue = token === '--config' || token === '-c'
            ? extra[i + 1] || ''
            : token.startsWith('--config=')
                ? token.slice('--config='.length)
                : /^-c.+/.test(token)
                    ? token.slice(2)
                    : '';
        if (/^model_provider\s*=/.test(configValue)) return true;
    }
    return false;
}

/**
 * Codex CLI adapter.
 *
 * `codex exec` prints progress to stderr and only the final agent message to stdout,
 * which matches the text/JSON parsing contract already used by the plugin. Each turn is
 * intentionally ephemeral because the plugin supplies its own conversation memory.
 */
export class CodexCliService extends ClaudeCodeService {
    override readonly providerId: string = 'codex';
    override readonly displayName: string = 'Codex CLI';

    constructor(pluginDir: string, config?: Partial<CodexCliConfig>) {
        super(pluginDir, {
            cliPath: 'codex',
            model: '',
            maxTokens: 16_000,
            timeoutMs: 300_000,
            ...config,
        });
    }

    protected override buildCliArgs(_maxTurns: number, extra: string[], imagePaths: string[]): string[] {
        validateExtraArgs(extra);
        const unsupportedImage = imagePaths.find((imagePath) => /\.svg$/i.test(imagePath));
        if (unsupportedImage) {
            throw new Error('Codex CLI does not accept SVG image attachments. Export the image as PNG or JPEG first.');
        }
        const enableSearch = extra.includes('--search');
        const execExtra = extra.filter((arg) => arg !== '--search');
        const args = [
            // This is a global flag and must precede the `exec` subcommand.
            '--ask-for-approval', 'never',
            ...(enableSearch ? ['--search'] : []),
            'exec',
            '--skip-git-repo-check',
            '--ephemeral',
            '--color', 'never',
            '--sandbox', 'read-only',
        ];
        const model = this.config.model.trim();
        if (model) args.push('--model', model);
        args.push(...execExtra);
        for (const imagePath of imagePaths) {
            args.push('--image', imagePath);
        }
        // Explicitly read the prompt from stdin.
        args.push('-');
        return args;
    }

    /** Query saved Codex authentication without starting a model request or exposing credentials. */
    async getLoginStatus(): Promise<CodexLoginStatus> {
        return new Promise((resolve) => {
            try {
                const { execFile } = require('child_process') as typeof import('child_process');
                execFile(
                    this.config.cliPath,
                    ['login', 'status'],
                    {
                        encoding: 'utf8',
                        timeout: 8_000,
                        maxBuffer: 1024 * 1024,
                        env: { ...process.env, NO_COLOR: '1' },
                        ...(this.config.cliWorkingDirectory?.trim()
                            ? { cwd: this.config.cliWorkingDirectory.trim() }
                            : {}),
                    },
                    (error: Error | null, stdout: string, stderr: string) => {
                        const message = (stdout || stderr || error?.message || 'Not logged in').trim();
                        resolve({ authenticated: !error, message });
                    },
                );
            } catch (error) {
                resolve({
                    authenticated: false,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        });
    }

    /** A remote Codex run needs saved CLI authentication; explicit OSS runs do not. */
    override async isAvailable(): Promise<boolean> {
        if (!(await super.isAvailable())) return false;
        const extra = splitCliArgsLine(this.config.extraCliArgs ?? '');
        if (hasExternalProviderSelection(extra)) return true;
        return (await this.getLoginStatus()).authenticated;
    }
}
