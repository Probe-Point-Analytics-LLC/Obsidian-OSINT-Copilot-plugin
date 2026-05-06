import type VaultAIPlugin from '../../../main';
import { ClaudeAgentProvider } from './claude-agent-provider';
import { HermesAgentProvider } from './hermes-agent-provider';
import type { AgentProvider } from './provider-types';
import { CLAUDE_RUNTIME_ID, HERMES_RUNTIME_ID, findCustomRuntime } from './runtime-registry';

export function createAgentProvider(plugin: VaultAIPlugin, runtimeId?: string): AgentProvider {
    const s = plugin.settings;
    const selected = runtimeId || s.agentRuntimeProvider;
    if (selected === HERMES_RUNTIME_ID) {
        return new HermesAgentProvider({
            cliPath: s.hermesAgentCliPath || 'hermes',
            extraArgs: s.hermesAgentExtraArgs || '',
            timeoutMs: s.hermesAgentTimeoutMs ?? 120_000,
            healthCheckArgs: s.hermesAgentHealthCheckArgs || '--version',
        });
    }
    if (selected !== CLAUDE_RUNTIME_ID) {
        const custom = findCustomRuntime(plugin, selected);
        if (custom) {
            return new HermesAgentProvider({
                cliPath: custom.cliPath || 'hermes',
                extraArgs: custom.extraArgs || '',
                timeoutMs: custom.timeoutMs ?? 120_000,
                healthCheckArgs: custom.healthCheckArgs || '--version',
            });
        }
    }
    return new ClaudeAgentProvider(plugin.graphApiService);
}
