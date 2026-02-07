import { describe, it, expect, beforeEach, vi } from 'vitest';
import VaultAIPlugin, { ChatView, CHAT_VIEW_TYPE } from '../main';
import { App, WorkspaceLeaf } from 'obsidian';

describe('ChatView', () => {
    let plugin: VaultAIPlugin;
    let leaf: WorkspaceLeaf;
    let chatView: ChatView;

    beforeEach(() => {
        // Instantiate mocks
        const app = new App();
        plugin = new VaultAIPlugin(app, { id: 'test-plugin', name: 'Test Plugin' } as any);

        // Mock plugin dependencies
        plugin.settings = {
            systemPrompt: 'Test Prompt',
            maxNotes: 5,
            reportApiKey: 'test-key',
            reportOutputDir: 'Reports',
            graphApiUrl: 'https://api.test.com',
            entityBasePath: 'Test',
            enableGraphFeatures: true,
            autoRefreshGraph: true,
            autoOpenGraphOnEntityCreation: true,
            conversationFolder: '.test/conversations',
            apiProvider: 'default',
            customCheckpoints: []
        } as any;

        (plugin as any).conversationService = {
            getMostRecentConversation: vi.fn().mockResolvedValue(null),
        };

        leaf = new App().workspace.getLeaf(false);
        chatView = new ChatView(leaf, plugin);

        // Mock containerEl which is normally set by Obsidian
        (chatView as any).containerEl = document.createElement('div');
        // ContentEl is where the UI is rendered
        (chatView as any).contentEl = (chatView as any).containerEl.createDiv();

    });

    it('should have the correct view type', () => {
        expect(chatView.getViewType()).toBe(CHAT_VIEW_TYPE);
    });

    it('should have correct display text', () => {
        expect(chatView.getDisplayText()).toBe('Osint copilot');
    });

    it('should initialize with default modes', () => {
        expect(chatView.localSearchMode).toBe(true);
        expect(chatView.graphGenerationMode).toBe(true);
    });

    it('should render basic UI on open', async () => {
        // Mock render method since it uses many Obsidian DOM helpers
        const renderSpy = vi.spyOn(chatView, 'render').mockImplementation(async () => {
            chatView.contentEl.empty();
            chatView.contentEl.createDiv({ cls: 'chat-container' });
        });

        await chatView.onOpen();

        expect(renderSpy).toHaveBeenCalled();
        const container = chatView.contentEl.querySelector('.chat-container');
        expect(container).not.toBeNull();
    });
});
