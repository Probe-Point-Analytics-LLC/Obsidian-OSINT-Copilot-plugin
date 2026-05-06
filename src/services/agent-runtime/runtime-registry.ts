import type VaultAIPlugin from '../../../main';

export interface CustomAgentRuntime {
    id: string;
    displayName: string;
    cliPath: string;
    extraArgs: string;
    timeoutMs: number;
    healthCheckArgs: string;
    enabled: boolean;
}

export interface RuntimeOption {
    id: string;
    displayName: string;
}

export const CLAUDE_RUNTIME_ID = 'claude-code';
export const HERMES_RUNTIME_ID = 'hermes-agent';
const CUSTOM_ID_PREFIX = 'custom:';

export function normalizeCustomRuntimeId(raw: string): string {
    const core = (raw || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const base = core || 'runtime';
    return `${CUSTOM_ID_PREFIX}${base}`;
}

export function isCustomRuntimeId(id: string): boolean {
    return typeof id === 'string' && id.startsWith(CUSTOM_ID_PREFIX);
}

function normalizeDisplayName(v: unknown, fallback: string): string {
    if (typeof v !== 'string' || !v.trim()) return fallback;
    return v.trim();
}

function normalizeTimeout(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 5000 ? v : fallback;
}

export function normalizeCustomAgentRuntimes(raw: unknown): CustomAgentRuntime[] {
    if (!Array.isArray(raw)) return [];
    const out: CustomAgentRuntime[] = [];
    const seen = new Set<string>();
    let autoN = 1;
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const normalizedId = normalizeCustomRuntimeId(typeof rec.id === 'string' ? rec.id : `runtime-${autoN++}`);
        if (seen.has(normalizedId)) continue;
        seen.add(normalizedId);
        out.push({
            id: normalizedId,
            displayName: normalizeDisplayName(rec.displayName, `Custom ${out.length + 1}`),
            cliPath: typeof rec.cliPath === 'string' && rec.cliPath.trim() ? rec.cliPath.trim() : 'hermes',
            extraArgs: typeof rec.extraArgs === 'string' ? rec.extraArgs : '',
            timeoutMs: normalizeTimeout(rec.timeoutMs, 120_000),
            healthCheckArgs:
                typeof rec.healthCheckArgs === 'string' && rec.healthCheckArgs.trim()
                    ? rec.healthCheckArgs.trim()
                    : '--version',
            enabled: rec.enabled !== false,
        });
    }
    return out;
}

export function getConfiguredRuntimeOptions(plugin: VaultAIPlugin): RuntimeOption[] {
    const options: RuntimeOption[] = [
        { id: CLAUDE_RUNTIME_ID, displayName: 'Claude Code' },
        { id: HERMES_RUNTIME_ID, displayName: 'Hermes Agent' },
    ];
    for (const rt of plugin.settings.customAgentRuntimes || []) {
        if (!rt.enabled) continue;
        options.push({ id: rt.id, displayName: rt.displayName });
    }
    return options;
}

export function findCustomRuntime(plugin: VaultAIPlugin, id: string): CustomAgentRuntime | null {
    if (!isCustomRuntimeId(id)) return null;
    const list = plugin.settings.customAgentRuntimes || [];
    return list.find((rt) => rt.id === id) || null;
}
