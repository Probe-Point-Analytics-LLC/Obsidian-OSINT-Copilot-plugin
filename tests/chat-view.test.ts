import { describe, it, expect, beforeEach, vi } from 'vitest';
import VaultAIPlugin, { ChatView, CHAT_VIEW_TYPE } from '../main';
import { App, WorkspaceLeaf } from 'obsidian';
import {
	DEFAULT_CREDENTIALS_FOLDER,
	DEFAULT_PROMPTS_FOLDER,
	DEFAULT_SCRIPTS_FOLDER,
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
            enrichersFolder: "OSINTCopilot/custom/enrichers",
            credentialsFolder: DEFAULT_CREDENTIALS_FOLDER,
            scriptsFolder: DEFAULT_SCRIPTS_FOLDER,
            apiProvider: 'claude-code',
            claudeCodeCliPath: 'claude',
            claudeCodeModel: 'sonnet',
            claudeCodeExtraArgs: '',
            claudeCodeTimeoutMs: 300_000,
            codexCliPath: 'codex',
            codexCliModel: '',
            codexCliExtraArgs: '',
            codexCliTimeoutMs: 300_000,
            agentRuntimeProvider: 'claude-code',
            hermesAgentCliPath: 'hermes',
            hermesAgentExtraArgs: '',
            hermesAgentTimeoutMs: 120_000,
            hermesAgentHealthCheckArgs: '--version',
            customAgentRuntimes: [],
            extractionLogVerbosity: 'detailed',
            extractionDebugRawCli: false,
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

    it('allocates a new evidence path when an uploaded image name already exists', () => {
        chatView.app = plugin.app;
        const existing = new Set([
            'OSINTCopilot/Evidence/screenshot.png',
            'OSINTCopilot/Evidence/screenshot-2.png',
        ]);
        vi.spyOn(chatView.app.vault, 'getAbstractFileByPath').mockImplementation(
            (path: string) => existing.has(path) ? ({} as any) : null,
        );

        expect((chatView as any).getAvailableEvidencePath(
            'OSINTCopilot/Evidence',
            'screenshot.png',
        )).toBe('OSINTCopilot/Evidence/screenshot-3.png');
    });

    it('does not overwrite the extraction provider when a removed chat runtime is normalized', async () => {
        plugin.settings.agentRuntimeProvider = 'custom:removed';
        plugin.settings.apiProvider = 'codex';
        plugin.saveSettings = vi.fn().mockResolvedValue(undefined);

        await (chatView as any).syncRuntimeSelectionToAvailability({
            byId: { 'claude-code': true, codex: true, 'hermes-agent': false },
            availableIds: ['claude-code', 'codex'],
        });

        expect(plugin.settings.agentRuntimeProvider).toBe('claude-code');
        expect(plugin.settings.apiProvider).toBe('codex');
    });
});
