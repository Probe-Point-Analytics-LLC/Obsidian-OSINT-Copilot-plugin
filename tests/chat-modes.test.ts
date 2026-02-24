import { describe, it, expect, beforeEach, vi } from 'vitest';
import VaultAIPlugin from '../main';
import { ChatView } from '../main';
import { App, requestUrl, TFile } from 'obsidian';

// Mock the Obsidian API and Plugin
describe('ChatView Modes Integration', () => {
    let plugin: VaultAIPlugin;
    let app: App;
    let view: ChatView;

    // User provided license key for testing
    const TEST_LICENSE_KEY = "enc:gAAAAABpYFzA3eh491NP_1A-sR0YKtBcA_uc-cHP7eDT8UMcbdEEDHLhjghkf2C4c36WwRLL-ILrwZt52L2pCGk4Wjfs3IxQT7_uEUqnEgXm4xTxm09UyTUCYl-MndJhVZEJP-XuOaEj";

    beforeEach(() => {
        // Mock App and Plugin
        app = new App();
        plugin = new VaultAIPlugin(app, { id: 'test-plugin', name: 'Test Plugin' } as any);

        // Setup Plugin Settings with License Key
        plugin.settings = {
            reportApiKey: TEST_LICENSE_KEY,
            systemPrompt: 'You are a vault assistant.',
            maxNotes: 15,
            reportOutputDir: 'Reports',
            graphApiUrl: 'https://api.osint-copilot.com',
            entityBasePath: 'OSINTCopilot',
            enableGraphFeatures: true,
            autoRefreshGraph: true,
            autoOpenGraphOnEntityCreation: false,
            conversationFolder: '.osint-copilot/conversations',
            apiProvider: 'default',
            customCheckpoints: []
        };

        // Mock Plugin Services
        plugin.conversationService = {
            getMostRecentConversation: vi.fn(),
            createConversation: vi.fn().mockResolvedValue({ id: 'test-conv', messages: [] }),
            saveConversation: vi.fn(),
            getConversationList: vi.fn().mockReturnValue([]),
            setCurrentConversationId: vi.fn(),
        } as any;

        plugin.entityManager = {
            getAllEntities: vi.fn().mockReturnValue([]),
            createEntity: vi.fn().mockResolvedValue({ id: 'ent-1', type: 'Person', label: 'Test' }),
        } as any;

        plugin.graphApiService = {
            aiSearch: vi.fn(),
            processText: vi.fn().mockResolvedValue({ success: true, operations: [] }), // For graph generation hooks
            extractTextFromUrl: vi.fn(),
            extractTextFromFile: vi.fn(),
            processTextInChunks: vi.fn().mockResolvedValue({ success: true, operations: [] }),
            chatWithCustomProvider: vi.fn().mockResolvedValue("Default Response"),
        } as any;

        // Create ChatView
        const leaf = {
            view: null,
            openFile: vi.fn(),
            app: app
        } as any;
        view = new ChatView(leaf, plugin);
        view.app = app;

        // Mock UI elements that might be missing in JSDOM/Node setup
        view.inputEl = { value: '' } as any;
        view.messagesContainer = {
            empty: vi.fn(),
            createDiv: vi.fn().mockReturnValue({
                setAttribute: vi.fn(),
                createEl: vi.fn(),
                createDiv: vi.fn(),
                addClass: vi.fn()
            }),
            createEl: vi.fn(),
            scrollTop: 0,
            scrollHeight: 100,
            querySelector: vi.fn(),
            querySelectorAll: vi.fn().mockReturnValue([])
        } as any;
        view.containerEl = {
            children: [null, {
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
                                })
                            })
                        })
                    })
                })
            }],
            querySelector: vi.fn()
        } as any;

        // Stub render methods to avoid pure DOM issues
        view.render = vi.fn();
        view.renderMessages = vi.fn();
        view.saveCurrentConversation = vi.fn();
    });

    /**
     * 1) Local Search Test
     * Verifies that when localSearchMode is active, the plugin searches notes and calls askVaultStream.
     */
    it('should perform Local Search', async () => {
        // Setup Mode
        view.localSearchMode = true;
        view.darkWebMode = false;
        view.osintSearchMode = false;
        view.reportGenerationMode = false;
        view.graphGenerationMode = false; // Disable extra processing for this test

        // Mock Input
        view.inputEl.value = "What is in my vault?";

        // Mock Plugin Methods specifically for Local Search
        plugin.extractEntitiesFromQuery = vi.fn().mockResolvedValue([{ type: 'unknown', name: null }]);
        plugin.retrieveNotes = vi.fn().mockReturnValue([{ path: 'note1.md', content: 'content' }]);
        plugin.askVaultStream = vi.fn().mockResolvedValue({ fullAnswer: 'This is the answer.', notes: [] });

        // Act
        await view.handleSend();

        // Assert
        expect(plugin.extractEntitiesFromQuery).toHaveBeenCalledWith("What is in my vault?");
        expect(plugin.retrieveNotes).toHaveBeenCalled();
        expect(plugin.askVaultStream).toHaveBeenCalled();

        // Verify chat history updated (via internal state since render is mocked)
        const lastMsg = view.chatHistory[view.chatHistory.length - 1];
        expect(lastMsg.role).toBe('assistant');
        // The mock implementation of handleSend will update history content
        // Note: checking call args or mock state might be better if handleSend logic is complex
    });

    /**
     * 2) Darkweb Test
     * Verifies triggers handleDarkWebInvestigation and calls the API.
     */
    it('should start Darkweb Investigation', async () => {
        // Setup Mode
        view.localSearchMode = false;
        view.darkWebMode = true;
        view.osintSearchMode = false;
        view.reportGenerationMode = false;

        // Mock Input
        const query = "leaked credentials for example.com";
        view.inputEl.value = query;

        // Mock requestUrl for the initial investigation call
        // Need to mock the specific call to /api/darkweb/investigate
        const requestUrlMock = vi.mocked(requestUrl);
        requestUrlMock.mockResolvedValueOnce({
            status: 200,
            text: JSON.stringify({ job_id: 'job-darkweb-123' }),
            json: { job_id: 'job-darkweb-123' },
            headers: {}
        } as any);

        // Act
        await view.handleSend();

        // Assert
        expect(requestUrlMock).toHaveBeenCalledWith(expect.objectContaining({
            url: expect.stringContaining('/api/darkweb/investigate'),
            method: 'POST',
            body: expect.stringContaining(query)
        }));

        const lastMsg = view.chatHistory[view.chatHistory.length - 1];
        expect(lastMsg.content).toContain('Dark web investigation started');
        expect(lastMsg.jobId).toBe('job-darkweb-123');
    });

    /**
     * 3) Digital Footprint (OSINT Search) Test
     * Verifies handleOSINTSearch calls graphApiService.aiSearch.
     */
    it('should perform Digital Footprint Search', async () => {
        // Setup Mode
        view.localSearchMode = false;
        view.darkWebMode = false;
        view.osintSearchMode = true;
        view.reportGenerationMode = false;

        // Mock Input
        const query = "john.doe@example.com";
        view.inputEl.value = query;

        // Mock aiSearch response
        const mockResult = {
            total_results: 1,
            results: [{ title: 'Leak Info', snippet: 'Found pwned data' }],
            detected_entities: [{ type: 'email', value: 'john.doe@example.com', confidence: 0.9 }],
            execution_time_ms: 100
        };
        (plugin.graphApiService.aiSearch as any).mockResolvedValue(mockResult);

        // Act
        await view.handleSend();

        // Assert
        expect(plugin.graphApiService.aiSearch).toHaveBeenCalledWith(
            expect.objectContaining({ query: query }),
            expect.any(Function),
            expect.any(AbortSignal)
        );

        // Verify history contains results rendered
        const lastMsg = view.chatHistory[view.chatHistory.length - 1];
        expect(lastMsg.content).toContain('Digital Footprint Results');
        expect(lastMsg.content).toContain('john.doe@example.com');
    });

    /**
     * 4) Companies & People (Report Generation) Test
     * Verifies handleReportGeneration calls generateReport.
     */
    it('should start Companies & People Report Generation', async () => {
        // Setup Mode
        view.localSearchMode = false;
        view.darkWebMode = false;
        view.osintSearchMode = false;
        view.reportGenerationMode = true;

        // Mock Input
        const description = "Analyze Google LLC";
        view.inputEl.value = description;

        // Mock generateReport
        plugin.generateReport = vi.fn().mockImplementation(async (desc, conv, callback) => {
            // Simulate progress callback
            callback('processing', { message: 'Researching...', percent: 50 });
            return {
                content: '# Report content',
                filename: 'Report.md'
            };
        });
        plugin.saveReportToVault = vi.fn().mockResolvedValue('Report.md');

        // Fix: Set a current conversation so it's not null
        view.currentConversation = { id: 'test-conv', messages: [] } as any;

        // Act
        await view.handleSend();

        // Assert
        expect(plugin.generateReport).toHaveBeenCalledWith(
            description,
            expect.objectContaining({ id: 'test-conv' }),
            expect.any(Function),
            expect.any(AbortSignal)
        );

        const lastMsg = view.chatHistory[view.chatHistory.length - 1];
        expect(lastMsg.content).toContain('Companies&People Generated Successfully');
    });

    /**
     * 5) Custom Chat Mode Test
     * Verifies handleCustomChat calls chatWithCustomProvider.
     */
    it('should perform Custom Chat', async () => {
        // Setup Custom Checkpoint
        const checkpoint = {
            id: 'ckpt-1',
            name: 'My Custom Model',
            url: 'https://api.openai.com/v1',
            apiKey: 'sk-test',
            model: 'gpt-4o'
        };
        plugin.settings.customCheckpoints = [checkpoint];

        // Setup Mode
        view.localSearchMode = false;
        view.customChatMode = true;
        view.activeCheckpointId = 'ckpt-1';
        view.darkWebMode = false;
        view.graphGenerationMode = false; // Disable to avoid appending graph gen output

        // Mock Input
        const query = "Custom model query";
        view.inputEl.value = query;

        // Mock chatWithCustomProvider
        (plugin.graphApiService.chatWithCustomProvider as any) = vi.fn().mockResolvedValue("Custom response");

        // Act
        await view.handleSend();

        // Assert
        expect(plugin.graphApiService.chatWithCustomProvider).toHaveBeenCalledWith(
            query,
            expect.any(String), // system prompt
            expect.objectContaining({
                customApiUrl: checkpoint.url,
                customApiKey: checkpoint.apiKey,
                customModel: checkpoint.model
            }),
            expect.any(AbortSignal)
        );

        const lastMsg = view.chatHistory[view.chatHistory.length - 1];
        expect(lastMsg.content).toBe("Custom response");
    });

    /**
     * 6) Graph Only Mode Test
     * Verifies handleGraphOnlyMode calls processTextInChunks.
     */
    it('should perform Graph Generation in Graph Only Mode', async () => {
        // Setup Mode (Graph Gen=True, all others=False)
        view.graphGenerationMode = true;
        view.localSearchMode = false;
        view.darkWebMode = false;
        view.reportGenerationMode = false;
        view.osintSearchMode = false;
        view.customChatMode = false;

        // Verify helper confirms mode
        expect(view.isGraphOnlyMode()).toBe(true);

        // Mock Input
        const text = "Apple Inc. CEO Tim Cook announced new iPhone.";
        view.inputEl.value = text;

        // Mock processTextInChunks
        const mockResponse = {
            success: true,
            operations: [
                {
                    action: 'create',
                    entities: [{ type: 'Person', properties: { name: 'Tim Cook' } }]
                }
            ]
        };
        (plugin.graphApiService.processTextInChunks as any) = vi.fn().mockResolvedValue(mockResponse);

        // Act
        await view.handleSend();

        // Assert
        expect(plugin.graphApiService.processTextInChunks).toHaveBeenCalledWith(
            text,
            expect.any(Array), // existing entities
            undefined,
            expect.any(Function),
            expect.any(Function)
        );

        // Verify history message
        // Since we didn't mock the entity creation internals completely, we just check if it called the API
        // If successful, handleGraphOnlyMode usually clears progress or updates content
        // Given we mocked the return, it will try to process operations.
        // We can verify it didn't crash and called the service.
    });

});
