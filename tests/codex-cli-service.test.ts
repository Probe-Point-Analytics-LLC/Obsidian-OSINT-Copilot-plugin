import { describe, expect, it, vi } from 'vitest';
import { CodexCliService } from '../src/services/codex-cli-service';

class TestCodexCliService extends CodexCliService {
    args(extra: string[] = [], imagePaths: string[] = []): string[] {
        return this.buildCliArgs(16, extra, imagePaths);
    }

    configSnapshot() {
        return { ...this.config };
    }
}

describe('CodexCliService', () => {
    it('uses safe non-interactive defaults and places the global approval flag before exec', () => {
        const service = new TestCodexCliService('');

        expect(service.providerId).toBe('codex');
        expect(service.displayName).toBe('Codex CLI');
        expect(service.configSnapshot()).toMatchObject({
            cliPath: 'codex',
            model: '',
            maxTokens: 16_000,
            timeoutMs: 300_000,
        });
        expect(service.args()).toEqual([
            '--ask-for-approval',
            'never',
            'exec',
            '--skip-git-repo-check',
            '--ephemeral',
            '--color',
            'never',
            '--sandbox',
            'read-only',
            '-',
        ]);
    });

    it('adds a configured model, extra arguments, and image attachments before stdin', () => {
        const service = new TestCodexCliService('', { model: 'gpt-5-codex' });

        expect(service.args(['--oss'], ['/tmp/evidence one.png', '/tmp/evidence-two.jpg'])).toEqual([
            '--ask-for-approval',
            'never',
            'exec',
            '--skip-git-repo-check',
            '--ephemeral',
            '--color',
            'never',
            '--sandbox',
            'read-only',
            '--model',
            'gpt-5-codex',
            '--oss',
            '--image',
            '/tmp/evidence one.png',
            '--image',
            '/tmp/evidence-two.jpg',
            '-',
        ]);
    });

    it('routes the global --search flag before the exec subcommand', () => {
        const service = new TestCodexCliService('');

        expect(service.args(['--search', '--oss'])).toEqual([
            '--ask-for-approval',
            'never',
            '--search',
            'exec',
            '--skip-git-repo-check',
            '--ephemeral',
            '--color',
            'never',
            '--sandbox',
            'read-only',
            '--oss',
            '-',
        ]);
    });

    it('omits the optional model flag when the configured value is blank', () => {
        const service = new TestCodexCliService('', { model: '   ' });

        expect(service.args()).not.toContain('--model');
    });

    it('requires saved Codex authentication for remote runs but not explicit OSS runs', async () => {
        const remote = new TestCodexCliService('', { cliPath: process.execPath });
        const remoteStatus = vi.spyOn(remote, 'getLoginStatus').mockResolvedValue({
            authenticated: false,
            message: 'Not logged in',
        });
        await expect(remote.isAvailable()).resolves.toBe(false);
        expect(remoteStatus).toHaveBeenCalledOnce();

        remoteStatus.mockResolvedValue({ authenticated: true, message: 'Logged in using ChatGPT' });
        await expect(remote.isAvailable()).resolves.toBe(true);

        const oss = new TestCodexCliService('', { cliPath: process.execPath, extraCliArgs: '--oss' });
        const ossStatus = vi.spyOn(oss, 'getLoginStatus').mockResolvedValue({
            authenticated: false,
            message: 'Not logged in',
        });
        await expect(oss.isAvailable()).resolves.toBe(true);
        expect(ossStatus).not.toHaveBeenCalled();

        for (const extraCliArgs of ['--profile local', '-p local', '-c model_provider=custom']) {
            const configured = new TestCodexCliService('', { cliPath: process.execPath, extraCliArgs });
            const configuredStatus = vi.spyOn(configured, 'getLoginStatus').mockResolvedValue({
                authenticated: false,
                message: 'Not logged in',
            });
            await expect(configured.isAvailable()).resolves.toBe(true);
            expect(configuredStatus).not.toHaveBeenCalled();
        }

        const invalidOss = new TestCodexCliService('', { cliPath: process.execPath, extraCliArgs: '--oss=false' });
        const invalidOssStatus = vi.spyOn(invalidOss, 'getLoginStatus').mockResolvedValue({
            authenticated: false,
            message: 'Not logged in',
        });
        await expect(invalidOss.isAvailable()).resolves.toBe(false);
        expect(invalidOssStatus).toHaveBeenCalledOnce();
    });

    it('rejects SVG attachments with an actionable conversion message', () => {
        const service = new TestCodexCliService('');

        expect(() => service.args([], ['/tmp/diagram.svg'])).toThrow(/Export the image as PNG or JPEG/);
    });

    it.each([
        ['--json'],
        ['--sandbox', 'danger-full-access'],
        ['-s', 'workspace-write'],
        ['--dangerously-bypass-approvals-and-sandbox'],
        ['--yolo'],
        ['--approve-for-me'],
        ['--color=always'],
        ['--cd', '/tmp'],
        ['--image', '/tmp/extra.png'],
        ['--model=other-model'],
        ['--remote', 'ws://example.test'],
        ['review'],
        ['-'],
    ])('rejects framework-owned or incompatible extra arguments: %j', (...extra) => {
        const service = new TestCodexCliService('');

        expect(() => service.args(extra)).toThrow(/Unsupported Codex extra CLI argument/);
    });
});
