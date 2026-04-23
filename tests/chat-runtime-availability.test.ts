import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHermesHealth = vi.fn();

vi.mock('../src/services/agent-runtime/hermes-agent-provider', () => ({
    HermesAgentProvider: class {
        async healthCheck() {
            return mockHermesHealth();
        }
    },
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
        },
        graphApiService: { checkHealth },
    } as any;
}

describe('chat-runtime-availability', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invalidateChatRuntimeAvailabilityCache();
        mockHermesHealth.mockResolvedValue(false);
    });

    it('marks Claude available when graphApiService.checkHealth is ok', async () => {
        const p = makePlugin('ok');
        const av = await getChatRuntimeAvailability(p, true);
        expect(av).toEqual({ claude: true, hermes: false });
    });

    it('marks Claude unavailable when health is not ok', async () => {
        mockHermesHealth.mockResolvedValue(true);
        const p = makePlugin('bad');
        const av = await getChatRuntimeAvailability(p, true);
        expect(av).toEqual({ claude: false, hermes: true });
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
