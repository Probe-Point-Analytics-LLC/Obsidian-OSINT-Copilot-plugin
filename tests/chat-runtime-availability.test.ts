import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateAgentProvider = vi.fn();

vi.mock('../src/services/agent-runtime/create-agent-provider', () => ({
    createAgentProvider: (...args: unknown[]) => mockCreateAgentProvider(...args),
}));

import {
    getChatRuntimeAvailability,
    invalidateChatRuntimeAvailabilityCache,
} from '../src/services/agent-runtime/chat-runtime-availability';

const BUILT_IN_AND_CUSTOM_IDS = ['claude-code', 'codex', 'hermes-agent', 'custom:my-cli'];

function makePlugin() {
    return {
        settings: {
            customAgentRuntimes: [
                {
                    id: 'custom:my-cli',
                    displayName: 'My CLI',
                    cliPath: 'my-cli',
                    extraArgs: '',
                    timeoutMs: 120_000,
                    healthCheckArgs: '--version',
                    enabled: true,
                },
                {
                    id: 'custom:disabled-cli',
                    displayName: 'Disabled CLI',
                    cliPath: 'disabled-cli',
                    extraArgs: '',
                    timeoutMs: 120_000,
                    healthCheckArgs: '--version',
                    enabled: false,
                },
            ],
        },
        graphApiService: {},
    } as any;
}

describe('chat-runtime-availability', () => {
    const healthChecks: Record<string, ReturnType<typeof vi.fn>> = {};

    beforeEach(() => {
        vi.clearAllMocks();
        invalidateChatRuntimeAvailabilityCache();
        for (const id of BUILT_IN_AND_CUSTOM_IDS) {
            healthChecks[id] = vi.fn().mockResolvedValue(false);
        }
        mockCreateAgentProvider.mockImplementation((_plugin: any, runtimeId?: string) => ({
            healthCheck: healthChecks[runtimeId || 'claude-code'],
        }));
    });

    it('probes Claude, Codex, Hermes, and enabled custom runtimes through their providers', async () => {
        healthChecks['claude-code'].mockResolvedValue(true);
        healthChecks.codex.mockResolvedValue(true);

        const plugin = makePlugin();
        const availability = await getChatRuntimeAvailability(plugin, true);

        expect(mockCreateAgentProvider.mock.calls.map(([, id]) => id)).toEqual(BUILT_IN_AND_CUSTOM_IDS);
        expect(availability.byId).toEqual({
            'claude-code': true,
            codex: true,
            'hermes-agent': false,
            'custom:my-cli': false,
        });
        expect(availability.availableIds).toEqual(['claude-code', 'codex']);
        expect(mockCreateAgentProvider).not.toHaveBeenCalledWith(plugin, 'custom:disabled-cli');
    });

    it('marks a runtime unavailable when its health check throws', async () => {
        healthChecks.codex.mockRejectedValue(new Error('not logged in'));
        healthChecks['hermes-agent'].mockResolvedValue(true);

        const availability = await getChatRuntimeAvailability(makePlugin(), true);

        expect(availability.byId.codex).toBe(false);
        expect(availability.byId['hermes-agent']).toBe(true);
        expect(availability.availableIds).toEqual(['hermes-agent']);
    });

    it('caches provider probes until force refresh', async () => {
        const plugin = makePlugin();

        await getChatRuntimeAvailability(plugin, true);
        await getChatRuntimeAvailability(plugin);
        for (const id of BUILT_IN_AND_CUSTOM_IDS) {
            expect(healthChecks[id]).toHaveBeenCalledTimes(1);
        }

        await getChatRuntimeAvailability(plugin, true);
        for (const id of BUILT_IN_AND_CUSTOM_IDS) {
            expect(healthChecks[id]).toHaveBeenCalledTimes(2);
        }
    });
});
