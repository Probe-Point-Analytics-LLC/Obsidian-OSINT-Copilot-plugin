import type VaultAIPlugin from '../../../main';
import { ClaudeAgentProvider } from './claude-agent-provider';
import { HermesAgentProvider } from './hermes-agent-provider';
import type { AgentProvider } from './provider-types';

export function createAgentProvider(plugin: VaultAIPlugin): AgentProvider {
    const s = plugin.settings;
    if (s.agentRuntimeProvider === 'hermes-agent') {
        return new HermesAgentProvider({
            cliPath: s.hermesAgentCliPath || 'hermes',
            extraArgs: s.hermesAgentExtraArgs || '',
            timeoutMs: s.hermesAgentTimeoutMs ?? 120_000,
            healthCheckArgs: s.hermesAgentHealthCheckArgs || '--version',
        });
    }
    return new ClaudeAgentProvider(plugin.graphApiService);
}
