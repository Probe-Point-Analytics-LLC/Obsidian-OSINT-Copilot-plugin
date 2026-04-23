import type VaultAIPlugin from '../../../main';
import { HermesAgentProvider } from './hermes-agent-provider';

export interface ChatRuntimeAvailability {
    claude: boolean;
    hermes: boolean;
}

const TTL_MS = 30_000;

let cache: { at: number; value: ChatRuntimeAvailability } | null = null;

/** Clear cached probes (e.g. after Settings change to CLI paths). */
export function invalidateChatRuntimeAvailabilityCache(): void {
    cache = null;
}

async function probeClaude(plugin: VaultAIPlugin): Promise<boolean> {
    try {
        const h = await plugin.graphApiService?.checkHealth();
        return h !== null && h.status === 'ok';
    } catch {
        return false;
    }
}

async function probeHermes(plugin: VaultAIPlugin): Promise<boolean> {
    const s = plugin.settings;
    const p = new HermesAgentProvider({
        cliPath: s.hermesAgentCliPath || 'hermes',
        extraArgs: s.hermesAgentExtraArgs || '',
        timeoutMs: s.hermesAgentTimeoutMs ?? 120_000,
        healthCheckArgs: s.hermesAgentHealthCheckArgs || '--version',
    });
    try {
        return await p.healthCheck();
    } catch {
        return false;
    }
}

/**
 * Probe which local agent CLIs are reachable. Cached briefly to avoid exec spam on ChatView re-renders.
 */
export async function getChatRuntimeAvailability(
    plugin: VaultAIPlugin,
    forceRefresh = false,
): Promise<ChatRuntimeAvailability> {
    if (!forceRefresh && cache && Date.now() - cache.at < TTL_MS) {
        return { ...cache.value };
    }
    const [claude, hermes] = await Promise.all([probeClaude(plugin), probeHermes(plugin)]);
    const value = { claude, hermes };
    cache = { at: Date.now(), value };
    return { ...value };
}
