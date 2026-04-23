import { describe, it, expect, vi } from 'vitest';
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
        });

        const plugin: any = {
            settings: {
                unifiedAgentOrchestration: true,
                enableGraphFeatures: true,
                agentRuntimeProvider: 'claude-code',
                hermesAgentCliPath: 'hermes',
                hermesAgentExtraArgs: '',
                hermesAgentTimeoutMs: 120_000,
                hermesAgentHealthCheckArgs: '--version',
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
    });

    it('uses legacy planner when unifiedAgentOrchestration is false', async () => {
        const plugin: any = {
            settings: {
                unifiedAgentOrchestration: false,
                enableGraphFeatures: true,
                skillToggles: {},
                agentRuntimeProvider: 'claude-code',
                hermesAgentCliPath: 'hermes',
                hermesAgentExtraArgs: '',
                hermesAgentTimeoutMs: 120_000,
                hermesAgentHealthCheckArgs: '--version',
            },
            graphApiService: {
                extractTextFromUrl: vi.fn(),
                callRemoteModel: vi.fn().mockResolvedValue(
                    JSON.stringify({
                        reasoning: 'r',
                        toolsToCall: ['LOCAL_VAULT'],
                        isProposal: true,
                        planSummary: '### Plan',
                        directResponse: 'Will search',
                        graphCommands: [],
                    }),
                ),
            },
            skillRegistry: {
                listVaultSkills: vi.fn().mockResolvedValue([]),
            },
            vaultPromptLoader: {
                getOrchestrationAugmentation: vi.fn().mockResolvedValue(''),
            },
        };

        const orch = new OrchestrationService(plugin);
        const result = await orch.processRequest('q', '', { entities: [] }, [], {}, vi.fn(), {});
        expect(result.phase).toBe('PLAN_PROPOSED');
        expect(result.proposedPlan?.toolsToCall).toContain('LOCAL_VAULT');
    });
});
