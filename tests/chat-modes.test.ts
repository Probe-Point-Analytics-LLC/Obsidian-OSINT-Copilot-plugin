import { describe, it, expect, beforeEach, vi } from 'vitest';
import VaultAIPlugin from '../main';
import { ChatView } from '../main';
import { App } from 'obsidian';

/**
 * ChatView send routing (current behavior):
 * - handleSend() → handleGraphOnlyMode when graphGenerationMode is on and localSearchMode/customChatMode are off.
 * - Otherwise → handleNormalChat (vault entity extract + retrieveNotes + askVaultStream; then processGraphFromNotes).
 * Legacy UI flags (darkWebMode, reportGenerationMode, osintSearchMode, customChatMode) are not consulted in handleSend;
 * hosted handlers exist on ChatView but are not invoked from the send pipeline today.
 */
describe('ChatView send routing', () => {
  let plugin: VaultAIPlugin;
  let app: App;
  let view: ChatView;

  beforeEach(() => {
    app = new App();
    plugin = new VaultAIPlugin(app, { id: 'test-plugin', name: 'Test Plugin' } as any);

    plugin.settings = {
      reportApiKey: '',
      systemPrompt: 'You are a vault assistant.',
      maxNotes: 15,
      reportOutputDir: 'Reports',
      graphApiUrl: 'https://api.osint-copilot.com',
      entityBasePath: 'OSINTCopilot',
      enableGraphFeatures: true,
      autoRefreshGraph: true,
      autoOpenGraphOnEntityCreation: false,
      advancedGraphMode: true,
      conversationFolder: '.osint-copilot/conversations',
      promptsFolder: '.osint-copilot/prompts',
      activeAgentId: 'default',
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
      findEntityByLabel: vi.fn().mockReturnValue(null),
      getEntity: vi.fn().mockReturnValue(null),
      getConnectionsForEntity: vi.fn().mockReturnValue([]),
      createEntity: vi.fn().mockResolvedValue({ id: 'ent-1', type: 'Person', label: 'Test' }),
    } as any;

    plugin.graphApiService = {
      aiSearch: vi.fn(),
      processText: vi.fn().mockResolvedValue({ success: true, operations: [] }),
      extractTextFromUrl: vi.fn(),
      extractTextFromFile: vi.fn(),
      extractTextFromImage: vi.fn(),
      processTextInChunks: vi.fn().mockResolvedValue({ success: true, operations: [] }),
      chatWithCustomProvider: vi.fn().mockResolvedValue('Default Response'),
    } as any;

    plugin.extractEntitiesFromQuery = vi
      .fn()
      .mockResolvedValue([{ type: 'unknown', name: null }]);
    plugin.retrieveNotes = vi.fn().mockReturnValue([{ path: 'note1.md', content: 'content' }]);
    plugin.askVaultStream = vi
      .fn()
      .mockResolvedValue({ fullAnswer: 'This is the answer.', notes: [] });
    plugin.refreshOrOpenGraphView = vi.fn().mockResolvedValue(undefined);

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

  it('runs vault Q&A (normal chat) when not in graph-only mode', async () => {
    view.localSearchMode = true;
    view.graphGenerationMode = false;
    view.customChatMode = false;
    view.darkWebMode = false;
    view.osintSearchMode = false;
    view.reportGenerationMode = false;

    view.inputEl.value = 'What is in my vault?';

    await view.handleSend();

    expect(plugin.extractEntitiesFromQuery).toHaveBeenCalledWith('What is in my vault?', true);
    expect(plugin.retrieveNotes).toHaveBeenCalled();
    expect(plugin.askVaultStream).toHaveBeenCalled();

    const lastMsg = view.chatHistory[view.chatHistory.length - 1];
    expect(lastMsg.role).toBe('assistant');
  });

  it('does not branch on legacy dark web / report / footprint flags — still uses normal chat', async () => {
    view.localSearchMode = true;
    view.graphGenerationMode = false;
    view.customChatMode = false;
    view.darkWebMode = true;
    view.osintSearchMode = true;
    view.reportGenerationMode = true;

    view.inputEl.value = 'test query';

    const aiSearchSpy = vi.spyOn(plugin.graphApiService, 'aiSearch');

    await view.handleSend();

    expect(plugin.askVaultStream).toHaveBeenCalled();
    expect(aiSearchSpy).not.toHaveBeenCalled();
  });

  it('runs graph extraction in graph-only mode via processTextInChunks', async () => {
    view.graphGenerationMode = true;
    view.localSearchMode = false;
    view.customChatMode = false;
    view.darkWebMode = false;
    view.reportGenerationMode = false;
    view.osintSearchMode = false;

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
  });
});
