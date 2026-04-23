import { describe, it, expect, beforeEach, vi } from 'vitest';
import VaultAIPlugin, { ChatView, CHAT_VIEW_TYPE } from '../main';
import { App, WorkspaceLeaf } from 'obsidian';
import {
	DEFAULT_PROMPTS_FOLDER,
	DEFAULT_SKILLS_FOLDER,
	DEFAULT_TASK_AGENTS_FOLDER,
	DEFAULT_TASK_AGENT_OUTPUT_ALLOWLIST,
} from '../src/constants/vault-layout';

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
            entityBasePath: 'Test',
            enableGraphFeatures: true,
            autoRefreshGraph: true,
            autoOpenGraphOnEntityCreation: true,
            conversationFolder: '.test/conversations',
            promptsFolder: DEFAULT_PROMPTS_FOLDER,
            activeAgentId: 'default',
            taskAgentsFolder: DEFAULT_TASK_AGENTS_FOLDER,
            taskAgentsEnabled: true,
            preferredTaskAgentId: '',
            taskAgentGlobalOutputAllowlist: DEFAULT_TASK_AGENT_OUTPUT_ALLOWLIST,
            taskAgentOverrides: {},
            skillsFolder: DEFAULT_SKILLS_FOLDER,
            skillToggles: {},
            apiProvider: 'claude-code',
            claudeCodeCliPath: 'claude',
            claudeCodeModel: 'sonnet',
            unifiedAgentOrchestration: true,
            agentRuntimeProvider: 'claude-code',
            hermesAgentCliPath: 'hermes',
            hermesAgentExtraArgs: '',
            hermesAgentTimeoutMs: 120_000,
            hermesAgentHealthCheckArgs: '--version',
            themeMode: 'system',
            customCheckpoints: [],
            advancedGraphMode: true,
            lockedVaultPaths: [],
            activeGraphId: 'default',
            graphWorkspaces: [{ id: 'default', name: 'Default' }],
            enabledSchemaFamilies: {},
            oidsfModalLayers: {},
        } as any;

        (plugin as any).conversationService = {
            getMostRecentConversation: vi.fn().mockResolvedValue(null),
        };
        (plugin as any).taskAgentRegistry = {
            listAgents: vi.fn().mockResolvedValue([]),
            getById: vi.fn(),
            invalidate: vi.fn(),
            registerVaultEvents: vi.fn(),
        };
        (plugin as any).taskAgentRunner = { run: vi.fn(), updateOptions: vi.fn() };
        (plugin as any).skillRegistry = {
            listVaultSkills: vi.fn().mockResolvedValue([]),
            invalidate: vi.fn(),
            registerVaultEvents: vi.fn(),
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

    it('should initialize with default tri-mode (general agent)', () => {
        expect(chatView.chatMode).toBe('general');
        expect(chatView.orchestrationMode).toBe(true);
        expect(chatView.localSearchMode).toBe(false);
        expect(chatView.graphGenerationMode).toBe(false);
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
