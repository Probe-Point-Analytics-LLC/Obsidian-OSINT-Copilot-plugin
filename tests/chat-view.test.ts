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

    it('keeps the active cancel button when agent logs trigger a full rerender', async () => {
        chatView.messagesContainer = document.createElement('div');
        chatView.chatHistory = [{
            role: 'assistant',
            content: '',
            progress: { message: 'Running Codex agent...', percent: 40 },
            extractionLogs: [],
        } as any];
        const controller = new AbortController();
        chatView.activeAbortControllers.set(0, controller);
        const cancelSpy = vi.spyOn(chatView, 'handleCancel').mockResolvedValue(undefined);

        await chatView.renderMessages();
        expect(chatView.messagesContainer.querySelectorAll('.vault-ai-cancel-btn')).toHaveLength(1);

        const appendLog = (chatView as any).makeLogAppender(0) as (event: any) => void;
        appendLog({
            phase: 'invoke_start',
            level: 'info',
            message: 'Running Codex CLI',
            timestamp: Date.now(),
        });
        await vi.waitFor(() => {
            expect(chatView.messagesContainer.querySelectorAll('.vault-ai-cancel-btn')).toHaveLength(1);
        });

        (chatView.messagesContainer.querySelector('.vault-ai-cancel-btn') as HTMLButtonElement).click();
        expect(cancelSpy).toHaveBeenCalledWith(0);
        expect(controller.signal.aborted).toBe(false);
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

    it('ignores late orchestration progress and errors after the pending chat item is replaced', async () => {
        vi.spyOn(chatView, 'renderMessages').mockResolvedValue(undefined);
        (plugin as any).entityManager = {
            getAllEntities: vi.fn().mockReturnValue([]),
            getAllConnections: vi.fn().mockReturnValue([]),
        };

        let rejectRequest!: (error: Error) => void;
        let reportProgress!: (message: string, percent: number) => void;
        const request = new Promise((_resolve, reject) => {
            rejectRequest = reject;
        });
        (plugin as any).orchestrationService = {
            processRequest: vi.fn().mockImplementation(
                (_query, _attachments, _graph, _memory, _conversation, onProgress) => {
                    reportProgress = onProgress;
                    return request;
                },
            ),
        };

        const run = chatView.handleOrchestrationAgent('test');
        await vi.waitFor(() => expect(reportProgress).toBeTypeOf('function'));

        const replacement = { role: 'assistant', content: 'Different conversation' } as any;
        chatView.chatHistory = [replacement];
        expect(() => reportProgress('Late update', 80)).not.toThrow();
        rejectRequest(new Error('Codex failed'));

        await expect(run).resolves.toBeUndefined();
        expect(chatView.chatHistory).toEqual([replacement]);
        expect(chatView.activeAbortControllers.size).toBe(0);
    });
});

describe('ChatView.largeAttachmentWarningMessage', () => {
    it('returns null under the size threshold', () => {
        expect(ChatView.largeAttachmentWarningMessage(1000)).toBeNull();
        expect(ChatView.largeAttachmentWarningMessage(149_999)).toBeNull();
    });

    it('warns at and above the threshold, with an estimated token count', () => {
        // A real reproduction of the reported case: a ~593KB CSV plus PDF text landed well
        // past this threshold and the CLI call timed out twice at the configured limit with no
        // visible feedback beforehand -- this is the proactive warning added for that.
        const message = ChatView.largeAttachmentWarningMessage(600_000);
        expect(message).not.toBeNull();
        expect(message).toContain('150,000'); // 600_000 / 4 chars-per-token estimate
        expect(message).toMatch(/minutes/i);

        const atThreshold = ChatView.largeAttachmentWarningMessage(150_000);
        expect(atThreshold).not.toBeNull();
    });
});
