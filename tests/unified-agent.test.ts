import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/skills/skill-executor', () => ({
    executeEnricherTool: vi.fn().mockResolvedValue('enricher-mock-result'),
    executeVaultSkillTool: vi.fn(),
}));

import { executeEnricherTool } from '../src/skills/skill-executor';
import { OrchestrationService } from '../src/services/orchestration-service';
import { parseAgentTurnResult } from '../src/services/agent-runtime/parse-agent-turn-json';
import { AGENT_TURN_SCHEMA_VERSION } from '../src/services/agent-runtime/provider-types';
import { aiOperationsToGraphCommands } from '../src/services/graph-commands-from-operations';
import { createAgentProvider } from '../src/services/agent-runtime/create-agent-provider';
import type { AIOperation } from '../src/entities/types';

describe('parseAgentTurnResult', () => {
    it('parses fenced JSON', () => {
        const raw = `Here you go:\n\`\`\`json\n{"version":"${AGENT_TURN_SCHEMA_VERSION}","answer_markdown":"Hi","retrieval_hits":[],"graph_operations":[]}\n\`\`\`\n`;
        const r = parseAgentTurnResult(raw, 'claude-code');
        expect(r.answer_markdown).toBe('Hi');
        expect(r.graph_operations).toEqual([]);
        expect(r.diagnostics?.provider).toBe('claude-code');
    });

    it('returns fallback when not JSON', () => {
        const r = parseAgentTurnResult('not json at all', 'hermes-agent');
        expect(r.answer_markdown).toContain('could not be parsed');
        expect(r.graph_operations).toEqual([]);
        expect(r.enricher_invocations).toEqual([]);
    });

    it('normalizes enricher_invocations', () => {
        const raw = JSON.stringify({
            version: AGENT_TURN_SCHEMA_VERSION,
            answer_markdown: 'ok',
            retrieval_hits: [],
            graph_operations: [],
            custom_vault_operations: [],
            enricher_invocations: [
                { enricher_id: 'LeakCheck', query: 'user@example.com' },
                { enricher_id: 'x', query: '' },
                { enricher_id: '', query: 'nope' },
            ],
        });
        const r = parseAgentTurnResult(raw, 'claude-code');
        expect(r.enricher_invocations).toHaveLength(1);
        expect(r.enricher_invocations[0]).toEqual({ enricher_id: 'leakcheck', query: 'user@example.com' });
    });
});

describe('aiOperationsToGraphCommands', () => {
    it('emits create_entity and create_link', () => {
        const ops: AIOperation[] = [
            {
                action: 'create',
                entities: [
                    {
                        type: 'Person',
                        properties: { full_name: 'Alice' },
                    },
                    {
                        type: 'Company',
                        properties: { name: 'ACME' },
                    },
                ],
                connections: [{ from: 0, to: 1, relationship: 'WORKS_AT' }],
            },
        ];
        const cmds = aiOperationsToGraphCommands(ops);
        expect(cmds.some((c) => c.startsWith('@@create_entity'))).toBe(true);
        expect(cmds.some((c) => c.startsWith('@@create_link'))).toBe(true);
    });
});

describe('createAgentProvider', () => {
    it('returns Hermes provider when configured', () => {
        const plugin = {
            settings: {
                agentRuntimeProvider: 'hermes-agent',
                hermesAgentCliPath: 'hermes-mock',
                hermesAgentExtraArgs: '',
                hermesAgentTimeoutMs: 120_000,
                hermesAgentHealthCheckArgs: '--version',
                customAgentRuntimes: [],
            },
            graphApiService: {},
        } as any;
        const p = createAgentProvider(plugin);
        expect(p.id).toBe('hermes-agent');
    });

    it('returns Claude provider by default', () => {
        const plugin = {
            settings: {
                agentRuntimeProvider: 'claude-code',
                hermesAgentCliPath: 'hermes',
                hermesAgentExtraArgs: '',
                hermesAgentTimeoutMs: 120_000,
                hermesAgentHealthCheckArgs: '--version',
                customAgentRuntimes: [],
            },
            graphApiService: {},
        } as any;
        expect(createAgentProvider(plugin).id).toBe('claude-code');
    });
});

describe('OrchestrationService unified path', () => {
    it('returns SYNTHESIS_COMPLETE with proposedCommands from graph_operations', async () => {
        const turnJson = JSON.stringify({
            version: AGENT_TURN_SCHEMA_VERSION,
            answer_markdown: 'Found X.',
            retrieval_hits: [{ path: 'notes/a.md', snippet: 'ctx' }],
            graph_operations: [
                {
                    action: 'create',
                    entities: [{ type: 'Person', properties: { full_name: 'Bob' } }],
                },
            ],
            custom_vault_operations: [{ action: 'put_credentials', relativePath: 't.txt', content: 'x' }],
            enricher_invocations: [],
        });

        const plugin: any = {
            settings: {
                enableGraphFeatures: true,
                credentialsFolder: 'OSINTCopilot/custom/credentials',
                agentRuntimeProvider: 'claude-code',
                hermesAgentCliPath: 'hermes',
                hermesAgentExtraArgs: '',
                hermesAgentTimeoutMs: 120_000,
                hermesAgentHealthCheckArgs: '--version',
                customAgentRuntimes: [],
            },
            graphApiService: {
                extractTextFromUrl: vi.fn(),
                callRemoteModel: vi.fn().mockResolvedValue(turnJson),
            },
            vaultPromptLoader: {
                getOrchestrationAugmentation: vi.fn().mockResolvedValue(''),
            },
        };

        const orch = new OrchestrationService(plugin);
        const onProgress = vi.fn();
        const result = await orch.processRequest(
            'Who is Bob?',
            '',
            { entities: [], connections: [] },
            [],
            {},
            onProgress,
            {},
        );

        expect(result.phase).toBe('SYNTHESIS_COMPLETE');
        expect(result.finalResponse).toContain('Found X.');
        expect(result.finalResponse).toContain('notes/a.md');
        expect(result.proposedCommands?.length).toBeGreaterThan(0);
        expect(result.proposedCommands?.[0]).toContain('@@create_entity');
        expect(result.proposedCustomVaultOps?.length).toBe(1);
        expect(result.proposedCustomVaultOps?.[0]).toMatchObject({
            action: 'put_credentials',
            relativePath: 't.txt',
        });
        expect(executeEnricherTool).not.toHaveBeenCalled();
    });

    it('runs executeEnricherTool for each enricher_invocations entry', async () => {
        vi.mocked(executeEnricherTool).mockClear();
        const turnJson = JSON.stringify({
            version: AGENT_TURN_SCHEMA_VERSION,
            answer_markdown: 'Queued enricher.',
            retrieval_hits: [],
            graph_operations: [],
            custom_vault_operations: [],
            enricher_invocations: [{ enricher_id: 'leakcheck', query: 'scammer@dom.test' }],
        });

        const plugin: any = {
            settings: {
                enableGraphFeatures: true,
                credentialsFolder: 'OSINTCopilot/custom/credentials',
                agentRuntimeProvider: 'claude-code',
                hermesAgentCliPath: 'hermes',
                hermesAgentExtraArgs: '',
                hermesAgentTimeoutMs: 120_000,
                hermesAgentHealthCheckArgs: '--version',
                customAgentRuntimes: [],
            },
            graphApiService: {
                extractTextFromUrl: vi.fn(),
                callRemoteModel: vi.fn().mockResolvedValue(turnJson),
            },
            vaultPromptLoader: {
                getOrchestrationAugmentation: vi.fn().mockResolvedValue(''),
            },
            app: { vault: {} },
        };

        const orch = new OrchestrationService(plugin);
        const result = await orch.processRequest(
            'run check',
            '',
            { entities: [], connections: [] },
            [],
            {},
            vi.fn(),
            {},
        );

        expect(executeEnricherTool).toHaveBeenCalledTimes(1);
        expect(executeEnricherTool).toHaveBeenCalledWith(
            plugin,
            'ENRICH_leakcheck',
            'scammer@dom.test',
            '',
            undefined,
        );
        expect(result.finalResponse).toContain('## Enricher results');
        expect(result.finalResponse).toContain('enricher-mock-result');
    });
});
