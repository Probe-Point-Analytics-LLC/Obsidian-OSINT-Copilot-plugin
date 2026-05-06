import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateAgentProvider = vi.fn();

vi.mock('../src/services/agent-runtime/create-agent-provider', () => ({
    createAgentProvider: (...args: unknown[]) => mockCreateAgentProvider(...args),
}));

import {
    getChatRuntimeAvailability,
    invalidateChatRuntimeAvailabilityCache,
} from '../src/services/agent-runtime/chat-runtime-availability';

function makePlugin(claude: 'ok' | 'bad' | 'throw') {
    const checkHealth =
        claude === 'throw'
            ? vi.fn().mockRejectedValue(new Error('network'))
            : vi.fn().mockResolvedValue(claude === 'ok' ? { status: 'ok' } : { status: 'down' });
    return {
        settings: {
            hermesAgentCliPath: 'hermes',
            hermesAgentExtraArgs: '',
            hermesAgentTimeoutMs: 120_000,
            hermesAgentHealthCheckArgs: '--version',
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
            ],
        },
        graphApiService: { checkHealth },
    } as any;
}

describe('chat-runtime-availability', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invalidateChatRuntimeAvailabilityCache();
        mockCreateAgentProvider.mockImplementation((_plugin: any, runtimeId?: string) => ({
            healthCheck: vi.fn().mockResolvedValue(runtimeId === 'hermes-agent'),
        }));
    });

    it('marks Claude available when graphApiService.checkHealth is ok', async () => {
        const p = makePlugin('ok');
        const av = await getChatRuntimeAvailability(p, true);
        expect(av.byId['claude-code']).toBe(true);
        expect(av.byId['hermes-agent']).toBe(true);
        expect(av.byId['custom:my-cli']).toBe(false);
    });

    it('marks Claude unavailable when health is not ok', async () => {
        mockCreateAgentProvider.mockImplementation((_plugin: any, runtimeId?: string) => ({
            healthCheck: vi.fn().mockResolvedValue(runtimeId === 'custom:my-cli'),
        }));
        const p = makePlugin('bad');
        const av = await getChatRuntimeAvailability(p, true);
        expect(av.byId['claude-code']).toBe(false);
        expect(av.byId['hermes-agent']).toBe(false);
        expect(av.byId['custom:my-cli']).toBe(true);
    });

    it('caches probes until TTL unless forceRefresh', async () => {
        const p = makePlugin('ok');
        await getChatRuntimeAvailability(p, true);
        await getChatRuntimeAvailability(p, false);
        expect(p.graphApiService.checkHealth).toHaveBeenCalledTimes(1);
        await getChatRuntimeAvailability(p, true);
        expect(p.graphApiService.checkHealth).toHaveBeenCalledTimes(2);
    });
});
