import type VaultAIPlugin from '../../plugin/vault-ai-plugin';
import { createAgentProvider } from './create-agent-provider';
import { getConfiguredRuntimeOptions } from './runtime-registry';

export interface ChatRuntimeAvailability {
    byId: Record<string, boolean>;
    availableIds: string[];
}

const TTL_MS = 30_000;

let cache: { at: number; value: ChatRuntimeAvailability } | null = null;

/** Clear cached probes (e.g. after Settings change to CLI paths). */
export function invalidateChatRuntimeAvailabilityCache(): void {
    cache = null;
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
    const byId: Record<string, boolean> = {};
    const options = getConfiguredRuntimeOptions(plugin);
    const probes = await Promise.all(
        options.map(async (runtime) => {
            try {
                const provider = createAgentProvider(plugin, runtime.id);
                const ok = await provider.healthCheck();
                return [runtime.id, ok] as const;
            } catch {
                return [runtime.id, false] as const;
            }
        }),
    );
    for (const [id, ok] of probes) byId[id] = ok;

    const availableIds = Object.keys(byId).filter((id) => byId[id]);
    const value = { byId, availableIds };
    cache = { at: Date.now(), value };
    return { byId: { ...value.byId }, availableIds: [...value.availableIds] };
}
