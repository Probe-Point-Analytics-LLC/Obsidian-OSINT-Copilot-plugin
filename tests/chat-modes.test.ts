import { describe, it, expect, beforeEach, vi } from 'vitest';
import VaultAIPlugin from '../main';
import { ChatView } from '../main';
import { App } from 'obsidian';
import { legacyFlagsForChatMode } from '../src/services/conversation-service';

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
 * Tri-mode send routing:
 * - chatMode === 'graph' → handleGraphOnlyMode (local processTextInChunks)
 * - chatMode === 'general' → handleOrchestrationAgent → orchestrationService.processRequest
 * - chatMode === 'local' → handleNormalChat (vault Q&A)
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
      conversationFolder: '.osint-copilot/conversations',
      promptsFolder: '.osint-copilot/prompts',
      activeAgentId: 'default',
      taskAgentsFolder: '.osint-copilot/task-agents',
      taskAgentsEnabled: true,
      preferredTaskAgentId: '',
      taskAgentGlobalOutputAllowlist: '.osint-copilot/outputs/',
      taskAgentOverrides: {},
      apiProvider: 'claude-code' as const,
      claudeCodeCliPath: 'claude',
      claudeCodeModel: 'sonnet',
      themeMode: 'system',
      customCheckpoints: [],
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

  it('routes local mode to vault Q&A (handleNormalChat)', async () => {
    applyModeToView(view, 'local');
    view.inputEl.value = 'What is in my vault?';

    await view.handleSend();

    expect(plugin.extractEntitiesFromQuery).toHaveBeenCalledWith('What is in my vault?', true);
    expect(plugin.retrieveNotes).toHaveBeenCalled();
    expect(plugin.askVaultStream).toHaveBeenCalled();
    expect(plugin.orchestrationService.processRequest).not.toHaveBeenCalled();

    const lastMsg = view.chatHistory[view.chatHistory.length - 1];
    expect(lastMsg.role).toBe('assistant');
  });

  it('routes general mode to orchestration (processRequest)', async () => {
    applyModeToView(view, 'general');
    view.inputEl.value = 'Investigate ACME';

    await view.handleSend();

    expect(plugin.orchestrationService.processRequest).toHaveBeenCalled();
    expect(plugin.askVaultStream).not.toHaveBeenCalled();
  });

  it('routes general mode with task agent to taskAgentRunner', async () => {
    applyModeToView(view, 'general');
    view.selectedTaskAgentId = 'memo-writer';
    view.inputEl.value = 'Write a short memo';

    const manifest = {
      agentKind: 'task' as const,
      id: 'memo-writer',
      name: 'Memo',
      description: '',
      outputSchema: 'vault_files_v1' as const,
      outputRoots: ['.osint-copilot/outputs/memos/'],
      contextRoots: [] as string[],
      maxNotes: 10,
      maxContextChars: 5000,
      enabledDefault: true,
      model: '',
      body: 'instructions',
      sourcePath: 'x.md',
    };
    (plugin.taskAgentRegistry.getById as ReturnType<typeof vi.fn>).mockResolvedValue(manifest);
    (plugin.taskAgentRunner.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      assistantText: 'Done.',
      appliedPaths: ['.osint-copilot/outputs/memos/a.md'],
    });

    await view.handleSend();

    expect(plugin.taskAgentRunner.run).toHaveBeenCalledWith(
      manifest,
      'Write a short memo',
      expect.any(AbortSignal),
    );
    expect(plugin.orchestrationService.processRequest).not.toHaveBeenCalled();
  });

  it('routes graph mode to processTextInChunks', async () => {
    applyModeToView(view, 'graph');
    expect(view.isGraphOnlyMode()).toBe(true);

    const text = 'Apple Inc. CEO Tim Cook announced new iPhone.';
    view.inputEl.value = text;

    const mockResponse = {
      success: true,
      operations: [
        {
          action: 'create',
          entities: [{ type: 'Person', properties: { name: 'Tim Cook' } }],
        },
      ],
    };
    (plugin.graphApiService.processTextInChunks as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    await view.handleSend();

    expect(plugin.graphApiService.processTextInChunks).toHaveBeenCalledWith(
      text,
      [],
      undefined,
      expect.any(Function),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(plugin.orchestrationService.processRequest).not.toHaveBeenCalled();
  });
});
