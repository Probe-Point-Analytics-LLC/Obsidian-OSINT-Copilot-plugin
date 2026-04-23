import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/services/agent-runtime/chat-runtime-availability', () => ({
  getChatRuntimeAvailability: vi.fn().mockResolvedValue({ claude: true, hermes: false }),
  invalidateChatRuntimeAvailabilityCache: vi.fn(),
}));

import VaultAIPlugin from '../main';
import { ChatView } from '../main';
import { App } from 'obsidian';
import { legacyFlagsForChatMode } from '../src/services/conversation-service';
import {
  DEFAULT_CONVERSATION_FOLDER,
  DEFAULT_PROMPTS_FOLDER,
  DEFAULT_SKILLS_FOLDER,
  DEFAULT_TASK_AGENTS_FOLDER,
  DEFAULT_TASK_AGENT_OUTPUT_ALLOWLIST,
} from '../src/constants/vault-layout';
import {
  DEFAULT_ENABLED_SCHEMA_FAMILIES,
  DEFAULT_OIDSF_MODAL_LAYERS,
} from '../src/services/schema-catalog-types';

function applyModeToView(view: ChatView, mode: 'general' | 'graph' | 'local') {
  view.chatMode = mode;
  const f = legacyFlagsForChatMode(mode);
  view.localSearchMode = f.localSearchMode;
  view.graphGenerationMode = f.graphGenerationMode;
  view.orchestrationMode = f.orchestrationMode;
  view.vaultGraphIngestMode = f.vaultGraphIngestMode;
  view.customChatMode = false;
  view.activeCheckpointId = undefined;
}

/**
 * Send routing: orchestration (handleOrchestrationAgent) except vault graph ingest mode.
 */
describe('ChatView send routing', () => {
  let plugin: VaultAIPlugin;
  let app: App;
  let view: ChatView;

  beforeEach(() => {
    app = new App();
    plugin = new VaultAIPlugin(app, { id: 'test-plugin', name: 'Test Plugin' } as any);

    plugin.settings = {
      systemPrompt: 'You are a vault assistant.',
      maxNotes: 15,
      entityBasePath: 'OSINTCopilot',
      enableGraphFeatures: true,
      autoRefreshGraph: true,
      autoOpenGraphOnEntityCreation: false,
      advancedGraphMode: true,
      conversationFolder: DEFAULT_CONVERSATION_FOLDER,
      promptsFolder: DEFAULT_PROMPTS_FOLDER,
      activeAgentId: 'default',
      taskAgentsFolder: DEFAULT_TASK_AGENTS_FOLDER,
      taskAgentsEnabled: true,
      preferredTaskAgentId: '',
      taskAgentGlobalOutputAllowlist: DEFAULT_TASK_AGENT_OUTPUT_ALLOWLIST,
      taskAgentOverrides: {},
      skillsFolder: DEFAULT_SKILLS_FOLDER,
      skillToggles: {},
      apiProvider: 'claude-code' as const,
      claudeCodeCliPath: 'claude',
      claudeCodeModel: 'sonnet',
      unifiedAgentOrchestration: true,
      agentRuntimeProvider: 'claude-code' as const,
      hermesAgentCliPath: 'hermes',
      hermesAgentExtraArgs: '',
      hermesAgentTimeoutMs: 120_000,
      hermesAgentHealthCheckArgs: '--version',
      themeMode: 'system',
      customCheckpoints: [],
      lockedVaultPaths: [],
      activeGraphId: 'default',
      graphWorkspaces: [{ id: 'default', name: 'Default' }],
      enabledSchemaFamilies: { ...DEFAULT_ENABLED_SCHEMA_FAMILIES },
      oidsfModalLayers: { ...DEFAULT_OIDSF_MODAL_LAYERS },
    };

    plugin.conversationService = {
      getMostRecentConversation: vi.fn(),
      createConversation: vi.fn().mockResolvedValue({ id: 'test-conv', messages: [] }),
      saveConversation: vi.fn(),
      getConversationList: vi.fn().mockReturnValue([]),
      setCurrentConversationId: vi.fn(),
    } as any;

    plugin.entityManager = {
      getAllEntities: vi.fn().mockReturnValue([]),
      getAllConnections: vi.fn().mockReturnValue([]),
      findEntityByLabel: vi.fn().mockReturnValue(null),
      getEntity: vi.fn().mockReturnValue(null),
      getConnectionsForEntity: vi.fn().mockReturnValue([]),
      createEntity: vi.fn().mockResolvedValue({ id: 'ent-1', type: 'Person', label: 'Test' }),
    } as any;

    plugin.graphApiService = {
      processText: vi.fn().mockResolvedValue({ success: true, operations: [] }),
      extractTextFromUrl: vi.fn(),
      extractTextFromFile: vi.fn(),
      extractTextFromImage: vi.fn(),
      processTextInChunks: vi.fn().mockResolvedValue({ success: true, operations: [] }),
      chatWithCustomProvider: vi.fn().mockResolvedValue('Default Response'),
    } as any;

    plugin.orchestrationService = {
      processRequest: vi.fn().mockResolvedValue({
        finalResponse: 'Orchestration done.',
        phase: 'SYNTHESIS_COMPLETE',
      }),
    } as any;

    plugin.extractEntitiesFromQuery = vi
      .fn()
      .mockResolvedValue([{ type: 'unknown', name: null }]);
    plugin.retrieveNotes = vi.fn().mockReturnValue([{ path: 'note1.md', content: 'content' }]);
    plugin.askVaultStream = vi
      .fn()
      .mockResolvedValue({ fullAnswer: 'This is the answer.', notes: [] });
    plugin.refreshOrOpenGraphView = vi.fn().mockResolvedValue(undefined);

    plugin.vaultPromptLoader = {
      listAgents: vi.fn().mockResolvedValue([{ id: 'default', name: 'Default' }]),
      invalidateAll: vi.fn(),
    } as any;

    plugin.taskAgentRegistry = {
      listAgents: vi.fn().mockResolvedValue([]),
      getById: vi.fn(),
      invalidate: vi.fn(),
      registerVaultEvents: vi.fn(),
    } as any;
    plugin.taskAgentRunner = {
      run: vi.fn(),
      updateOptions: vi.fn(),
    } as any;

    plugin.skillRegistry = {
      listVaultSkills: vi.fn().mockResolvedValue([]),
      getVaultSkillById: vi.fn(),
      invalidate: vi.fn(),
      registerVaultEvents: vi.fn(),
    } as any;

    const leaf = {
      view: null,
      openFile: vi.fn(),
      app,
    } as any;
    view = new ChatView(leaf, plugin);
    view.app = app;

    view.inputEl = { value: '' } as any;
    view.messagesContainer = {
      empty: vi.fn(),
      createDiv: vi.fn().mockReturnValue({
        setAttribute: vi.fn(),
        createEl: vi.fn(),
        createDiv: vi.fn(),
        addClass: vi.fn(),
      }),
      createEl: vi.fn(),
      scrollTop: 0,
      scrollHeight: 100,
      querySelector: vi.fn(),
      querySelectorAll: vi.fn().mockReturnValue([]),
      parentElement: { scrollTop: 0, scrollHeight: 100 },
    } as any;
    view.containerEl = {
      children: [
        null,
        {
          empty: vi.fn(),
          addClass: vi.fn(),
          createDiv: vi.fn().mockReturnValue({
            createDiv: vi.fn().mockReturnValue({
              createDiv: vi.fn().mockReturnValue({
                createEl: vi.fn().mockReturnValue({ addEventListener: vi.fn() }),
                createDiv: vi.fn().mockReturnValue({
                  createEl: vi.fn().mockReturnValue({ addEventListener: vi.fn() }),
                  createDiv: vi.fn().mockReturnValue({
                    createEl: vi.fn().mockReturnValue({ addEventListener: vi.fn() }),
                    setAttribute: vi.fn(),
                  }),
                }),
              }),
            }),
          }),
        },
      ],
      querySelector: vi.fn(),
    } as any;

    view.render = vi.fn();
    view.renderMessages = vi.fn();
    view.saveCurrentConversation = vi.fn();
  });

  it('routes local mode to orchestration (legacy mode ignored)', async () => {
    applyModeToView(view, 'local');
    view.inputEl.value = 'What is in my vault?';

    await view.handleSend();

    expect(plugin.orchestrationService.processRequest).toHaveBeenCalled();
    expect(plugin.askVaultStream).not.toHaveBeenCalled();
  });

  it('routes general mode to orchestration (processRequest)', async () => {
    applyModeToView(view, 'general');
    view.inputEl.value = 'Investigate ACME';

    await view.handleSend();

    expect(plugin.orchestrationService.processRequest).toHaveBeenCalled();
    expect(plugin.askVaultStream).not.toHaveBeenCalled();
  });

  it('routes graph mode to orchestration (legacy graph-only path removed)', async () => {
    applyModeToView(view, 'graph');
    expect(view.isGraphOnlyMode()).toBe(false);

    const text = 'Apple Inc. CEO Tim Cook announced new iPhone.';
    view.inputEl.value = text;

    await view.handleSend();

    expect(plugin.orchestrationService.processRequest).toHaveBeenCalled();
  });
});
