import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  TFile,
  CachedMetadata,
  Modal,
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  Component,
} from "obsidian";

// Graph plugin imports
import { EntityType, Entity, Connection, ENTITY_CONFIGS, AIOperation, ProcessTextResponse } from './src/entities/types';
import { EntityManager } from './src/services/entity-manager';
import { GraphApiService } from './src/services/api-service';
import { ConversationService, Conversation, ConversationMetadata, ConversationMessage } from './src/services/conversation-service';
import { GraphView, GRAPH_VIEW_TYPE } from './src/views/graph-view';
import { TimelineView, TIMELINE_VIEW_TYPE } from './src/views/timeline-view';
import { MapView, MAP_VIEW_TYPE } from './src/views/map-view';

// ============================================================================
// INTERFACES & TYPES
// ============================================================================

interface VaultAISettings {
  systemPrompt: string;
  maxNotes: number;
  reportApiKey: string;
  reportOutputDir: string;
  // Graph plugin settings
  graphApiUrl: string;
  entityBasePath: string;
  enableGraphFeatures: boolean;
  autoRefreshGraph: boolean;
  autoOpenGraphOnEntityCreation: boolean;
  // Conversation settings
  conversationFolder: string;
}

// Default models - hardcoded, not user-configurable
// Chat API uses Perplexity's sonar-pro model
const CHAT_MODEL = "gpt-4o-mini";
// Entity extraction uses OpenAI for better JSON parsing
const ENTITY_EXTRACTION_MODEL = "gpt-4o-mini";
// DarkWeb dark web API uses gpt-5-mini for best results with dark web content
const DARKWEB_MODEL = "gpt-5-mini";

interface IndexedNote {
  path: string;
  content: string;
  tags: string[];
  links: string[];
  frontmatter?: Record<string, any>;
  updated: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ============================================================================
// DEFAULT SETTINGS
// ============================================================================

const DEFAULT_SETTINGS: VaultAISettings = {
  systemPrompt:
    "You are a vault assistant. Answer questions clearly and concisely based on the provided notes. Cite note paths in-line where useful.",
  maxNotes: 15,
  reportApiKey: "",
  reportOutputDir: "Reports",
  // Graph plugin defaults - production API by default, can switch to localhost in settings
  graphApiUrl: "https://api.osint-copilot.com",
  entityBasePath: "OSINTCopilot",
  enableGraphFeatures: true,
  autoRefreshGraph: true,
  autoOpenGraphOnEntityCreation: false,
  // Conversation defaults
  conversationFolder: ".osint-copilot/conversations",
};

const REPORT_API_BASE_URL = "https://api.osint-copilot.com";
// const REPORT_API_BASE_URL = "http://localhost:8000";

const CHAT_VIEW_TYPE = "vault-ai-chat-view";

interface ReportProgress {
  message: string;
  percent: number;
}

// ============================================================================
// MAIN PLUGIN CLASS
// ============================================================================

export default class VaultAIPlugin extends Plugin {
  settings!: VaultAISettings;
  index: Map<string, IndexedNote> = new Map();

  // Graph plugin components
  entityManager!: EntityManager;
  graphApiService!: GraphApiService;
  conversationService!: ConversationService;

  async onload() {
    await this.loadSettings();

    // Check license key on load
    if (!this.settings.reportApiKey) {
      new Notice("OSINT Copilot: License key required for AI features. Visualization features (Graph, Timeline, Map) are free. Configure in settings.");
    }

    // Initialize graph plugin components
    this.entityManager = new EntityManager(this.app, this.settings.entityBasePath);
    this.graphApiService = new GraphApiService(
      this.settings.graphApiUrl,
      this.settings.reportApiKey
    );

    // Initialize conversation service
    this.conversationService = new ConversationService(this.app, this.settings.conversationFolder);
    try {
      await this.conversationService.initialize();
      console.log('OSINTCopilot: Conversation service initialized');
    } catch (error) {
      console.warn('OSINTCopilot: Conversation service initialization had issues:', error);
    }

    // Initialize entity manager if graph features are enabled
    // This is done separately from API health check to ensure local features work
    // even when the API is unavailable
    if (this.settings.enableGraphFeatures) {
      // Initialize local entity storage (non-blocking on errors)
      try {
        await this.entityManager.initialize();
        console.log('OSINTCopilot: Local entity storage initialized');
      } catch (error) {
        // Log but don't block - entity manager can still work for basic operations
        console.warn('OSINTCopilot: Entity storage initialization had issues:', error);
      }

      // Check API health in background (non-blocking)
      // This sets the online status for the API service
      this.graphApiService.checkHealth().then(health => {
        if (health) {
          console.log('OSINTCopilot: Graph API connected', health);
        } else {
          console.log('OSINTCopilot: Graph API unavailable - running in local-only mode');
        }
      }).catch(error => {
        // Silently handle connection errors - API is optional
        console.log('OSINTCopilot: Graph API unavailable - running in local-only mode');
      });
    }

    // Register views
    this.registerView(
      CHAT_VIEW_TYPE,
      (leaf) => new ChatView(leaf, this)
    );

    // Register graph views (always register, but only initialize if enabled)
    this.registerView(
      GRAPH_VIEW_TYPE,
      (leaf) => {
        console.log('[VaultAIPlugin] Creating GraphView instance');
        if (!this.settings.enableGraphFeatures) {
          console.warn('[VaultAIPlugin] Graph features are disabled in settings');
        }
        return new GraphView(
          leaf,
          this.entityManager,
          (entityId) => this.onEntityClick(entityId),
          (entityId) => this.showEntityOnMap(entityId)
        );
      }
    );

    this.registerView(
      TIMELINE_VIEW_TYPE,
      (leaf) => new TimelineView(leaf, this.entityManager, (entityId) => this.onEntityClick(entityId))
    );

    this.registerView(
      MAP_VIEW_TYPE,
      (leaf) => new MapView(leaf, this.entityManager, (entityId) => this.onEntityClick(entityId))
    );

    // Add ribbon icons for all OSINT Copilot features (grouped together)
    // Chat icon is always shown, but requires license key to use
    this.addRibbonIcon("message-square", "OSINT Copilot Chat", async () => {
      await this.openChatView();
    });

    // Graph features icons (Entity Graph, Timeline, Map) - shown when graph features are enabled
    if (this.settings.enableGraphFeatures) {
      this.addRibbonIcon("git-fork", "Entity Graph", async () => {
        await this.openGraphView();
      });

      this.addRibbonIcon("calendar", "Timeline", async () => {
        await this.openTimelineView();
      });

      this.addRibbonIcon("map-pin", "Location Map", async () => {
        await this.openMapView();
      });
    }

    // Build initial index
    await this.buildIndex();

    // Register file watchers
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          this.indexFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) {
          this.indexFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.index.delete(file.path);
        }
      })
    );

    // Register commands - grouped by feature
    // Main OSINT Copilot commands (Chat, Graph, Timeline, Map)
    this.addCommand({
      id: "open-chat-view",
      name: "Open Chat",
      callback: async () => await this.openChatView(),
    });

    this.addCommand({
      id: "open-graph-view",
      name: "Open Entity Graph",
      callback: async () => await this.openGraphView(),
    });

    this.addCommand({
      id: "open-timeline-view",
      name: "Open Timeline",
      callback: async () => await this.openTimelineView(),
    });

    this.addCommand({
      id: "open-map-view",
      name: "Open Location Map",
      callback: async () => await this.openMapView(),
    });

    // Utility commands
    this.addCommand({
      id: "ask-vault",
      name: "Ask (remote)",
      callback: () => this.openAskModal(),
    });

    this.addCommand({
      id: "reindex-vault",
      name: "Reindex vault",
      callback: async () => {
        await this.buildIndex();
        new Notice("Vault reindexed successfully.");
      },
    });

    this.addCommand({
      id: "reload-entities",
      name: "Reload Entities from Notes",
      callback: async () => {
        await this.entityManager.loadEntitiesFromNotes();
        new Notice("Entities reloaded from notes.");
      },
    });

    // Add settings tab
    this.addSettingTab(new VaultAISettingTab(this.app, this));
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(GRAPH_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(TIMELINE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(MAP_VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Update graph API service with new settings
    if (this.graphApiService) {
      this.graphApiService.setBaseUrl(this.settings.graphApiUrl);
      this.graphApiService.setApiKey(this.settings.reportApiKey);
    }
    if (this.entityManager) {
      this.entityManager.setBasePath(this.settings.entityBasePath);
    }
  }

  isAuthenticated(): boolean {
    // AI features require a valid license key
    return !!this.settings.reportApiKey;
  }

  // ============================================================================
  // GRAPH VIEW METHODS
  // ============================================================================

  async openGraphView() {
    if (!this.settings.enableGraphFeatures) {
      new Notice('Graph features are disabled. Enable them in Settings → OSINT Copilot → Enable Graph Features', 5000);
      console.warn('[VaultAIPlugin] Attempted to open graph view but graph features are disabled');
      return;
    }
    
    console.log('[VaultAIPlugin] Opening graph view');
    const existing = this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return existing[0];
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: GRAPH_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
      return leaf;
    }
    return null;
  }

  /**
   * Open the graph view and focus on a specific entity.
   * This is used by clickable links in chat to navigate to entities in the graph.
   */
  async openGraphViewWithEntity(entityId: string) {
    const leaf = await this.openGraphView();
    if (leaf) {
      // Wait a bit for the graph to render, then highlight the entity
      setTimeout(() => {
        const graphView = leaf.view as GraphView;
        if (graphView && typeof graphView.highlightEntity === 'function') {
          graphView.highlightEntity(entityId);
        }
      }, 300);
    }
  }

  /**
   * Refresh the graph view if it's currently open.
   * This is called after entity creation operations complete.
   */
  async refreshGraphView() {
    const existing = this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);
    if (existing.length > 0) {
      const graphView = existing[0].view as GraphView;
      if (graphView && typeof graphView.refreshWithSavedPositions === 'function') {
        console.log('[OSINT Copilot] Refreshing graph view with new entities...');
        await graphView.refreshWithSavedPositions();
        new Notice('Graph view updated with new entities');
      }
    }
  }

  /**
   * Refresh or open the graph view after entity creation.
   * Respects user settings for auto-refresh and auto-open.
   */
  async refreshOrOpenGraphView() {
    if (!this.settings.enableGraphFeatures) {
      return;
    }

    const existing = this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);

    if (existing.length > 0) {
      // Graph is already open - refresh it if auto-refresh is enabled
      if (this.settings.autoRefreshGraph) {
        await this.refreshGraphView();
      }
    } else {
      // Graph is not open - open it if auto-open is enabled
      if (this.settings.autoOpenGraphOnEntityCreation) {
        console.log('[OSINT Copilot] Auto-opening graph view with new entities...');
        await this.openGraphView();
        new Notice('Graph view opened with new entities');
      }
    }
  }

  async openTimelineView() {
    const existing = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: TIMELINE_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async openMapView() {
    const existing = this.app.workspace.getLeavesOfType(MAP_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: MAP_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  onEntityClick(entityId: string) {
    // Open the entity's note when clicked in graph/timeline/map
    this.entityManager.openEntityNote(entityId);
  }

  /**
   * Show a Location entity on the map view.
   * Opens the map view if not already open and focuses on the location.
   */
  async showEntityOnMap(entityId: string) {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      new Notice('Entity not found');
      return;
    }

    if (entity.type !== 'Location') {
      new Notice('Only Location entities can be shown on the map');
      return;
    }

    if (!entity.properties.latitude || !entity.properties.longitude) {
      new Notice('Location has no coordinates. Please add latitude and longitude.');
      return;
    }

    // Open or reveal the map view
    await this.openMapView();

    // Wait a bit for the map to initialize, then focus on the location
    setTimeout(() => {
      const mapLeaves = this.app.workspace.getLeavesOfType(MAP_VIEW_TYPE);
      if (mapLeaves.length > 0) {
        const mapView = mapLeaves[0].view as MapView;
        if (mapView && typeof mapView.focusLocation === 'function') {
          // Refresh the map first to ensure the marker exists
          mapView.refresh();
          // Then focus on the location
          setTimeout(() => {
            mapView.focusLocation(entityId);
          }, 200);
        }
      }
    }, 300);
  }

  // ============================================================================
  // INDEXING
  // ============================================================================

  async buildIndex() {
    this.index.clear();
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      await this.indexFile(file);
    }
  }

  async indexFile(file: TFile) {
    try {
      const content = await this.app.vault.read(file);
      const cache = this.app.metadataCache.getFileCache(file);

      const tags = this.extractTags(cache);
      const links = this.extractLinks(cache);
      const frontmatter = cache?.frontmatter || undefined;

      this.index.set(file.path, {
        path: file.path,
        content,
        tags,
        links,
        frontmatter,
        updated: file.stat.mtime,
      });
    } catch (error) {
      console.error(`Failed to index file ${file.path}:`, error);
    }
  }

  extractTags(cache: CachedMetadata | null): string[] {
    if (!cache) return [];
    const tags: string[] = [];
    if (cache.tags) {
      cache.tags.forEach((tag) => tags.push(tag.tag));
    }
    if (cache.frontmatter?.tags) {
      const fmTags = cache.frontmatter.tags;
      if (Array.isArray(fmTags)) {
        tags.push(...fmTags.map((t) => (t.startsWith("#") ? t : `#${t}`)));
      } else if (typeof fmTags === "string") {
        tags.push(fmTags.startsWith("#") ? fmTags : `#${fmTags}`);
      }
    }
    return tags;
  }

  extractLinks(cache: CachedMetadata | null): string[] {
    if (!cache || !cache.links) return [];
    return cache.links.map((link) => link.link);
  }

  // ============================================================================
  // RETRIEVAL
  // ============================================================================

  retrieveNotes(query: string): IndexedNote[] {
    const queryLower = query.toLowerCase();
    const queryTokens = this.tokenizeEnglish(queryLower);
    const scored: Array<{ note: IndexedNote; score: number }> = [];

    for (const note of this.index.values()) {
      let score = 0;

      // Content match (2 points)
      const contentLower = note.content.toLowerCase();
      if (
        contentLower.includes(queryLower) ||
        this.fuzzyMatchText(contentLower, queryTokens)
      ) {
        score += 2;
      }

      // Tag match (1 point)
      if (
        note.tags.some((tag) => {
          const t = tag.toLowerCase();
          return t.includes(queryLower) || this.fuzzyMatchText(t, queryTokens);
        })
      ) {
        score += 1;
      }

      // Path match (1 point)
      const pathLower = note.path.toLowerCase();
      if (pathLower.includes(queryLower) || this.fuzzyMatchText(pathLower, queryTokens)) {
        score += 1;
      }

      if (score > 0) {
        scored.push({ note, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.settings.maxNotes).map((s) => s.note);
  }

  // English-only tokenization (letters/digits), min length 3
  tokenizeEnglish(text: string): string[] {
    return (text.match(/\b[a-z0-9]{3,}\b/gi) || []).map((t) => t.toLowerCase());
  }

  // Lightweight fuzzy: if any query token is within Levenshtein distance <= 1
  // of any token in the target text. We cap the number of target tokens scanned.
  fuzzyMatchText(textLower: string, queryTokens: string[]): boolean {
    if (queryTokens.length === 0) return false;
    // Only attempt for short queries (<= 3 tokens) to keep it fast
    if (queryTokens.length > 3) return false;

    const tokens = this.tokenizeEnglish(textLower);
    if (tokens.length === 0) return false;

    const MAX_TOKENS = 800; // cap to avoid scanning entire long notes
    const limited = tokens.slice(0, MAX_TOKENS);

    for (const q of queryTokens) {
      // Skip very short tokens to avoid noise
      if (q.length < 3) continue;
      for (const t of limited) {
        if (Math.abs(t.length - q.length) > 2) continue;
        if (this.levenshteinDistance(q, t) <= 1) {
          return true;
        }
      }
    }
    return false;
  }

  levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;

    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const temp = dp[j];
        if (a[i - 1] === b[j - 1]) {
          dp[j] = prev;
        } else {
          dp[j] = Math.min(prev + 1, dp[j] + 1, dp[j - 1] + 1);
        }
        prev = temp;
      }
    }
    return dp[n];
  }

  // ============================================================================
  // REMOTE MODEL INTEGRATION
  // ============================================================================

  async callRemoteModel(messages: ChatMessage[], stream: boolean = false, model?: string): Promise<string> {
    if (!this.settings.reportApiKey) {
      throw new Error(
        "License key is required. Please configure it in settings."
      );
    }

    // Use unified endpoint that supports both streaming and non-streaming
    const endpoint = `${REPORT_API_BASE_URL}/api/chat/completion`;

    try {
      // Use provided model or default to CHAT_MODEL
      const modelToUse = model || CHAT_MODEL;
      
      const requestBody: any = {
        model: modelToUse,
        messages,
        stream: stream,  // Pass stream flag to endpoint
      };


      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.reportApiKey}`,
        },
        body: JSON.stringify(requestBody),
        mode: "cors",
        credentials: "omit",
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error("[callRemoteModel] API error:", response.status, errorText);
        throw new Error(
          `API request failed (${response.status}): ${errorText.substring(0, 200)}`
        );
      }

      // Non-streaming endpoint always returns JSON
      if (!stream) {
        const jsonData = await response.json();
        const content = jsonData.choices?.[0]?.message?.content || 
                       jsonData.choices?.[0]?.text || 
                       jsonData.content || 
                       "";
        return content || "No answer received.";
      }

      // If streaming (SSE response)
      if (!response.body) {
        throw new Error("Response body is null");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const dataPart = trimmed.slice("data:".length).trim();
          if (dataPart === "[DONE]") {
            continue;
          }

          try {
            const parsed = JSON.parse(dataPart);
            const deltaContent = parsed.choices?.[0]?.delta?.content;
            const messageContent = parsed.choices?.[0]?.message?.content;

            const content = deltaContent ?? messageContent ?? "";
            if (content) {
              fullResponse += content;
            }
          } catch (e) {
            console.warn("Failed to parse SSE chunk:", e, trimmed);
          }
        }
      }

      if (!fullResponse) {
        fullResponse = "No answer received.";
      }

      return fullResponse;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Model call failed: ${error.message}`);
      }
      throw error;
    }
  }

  // ============================================================================
  // STREAMING MODEL INTEGRATION
  // ============================================================================

  /**
   * Check if an error is a transient network error that should be retried
   */
  isTransientNetworkError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    const transientPatterns = [
      'network', 'fetch', 'failed to fetch', 'net::err_',
      'connection', 'timeout', 'timed out', 'econnreset',
      'econnrefused', 'enotfound', 'socket', 'dns'
    ];
    return transientPatterns.some(pattern => msg.includes(pattern));
  }

  /**
   * Sleep for a specified number of milliseconds
   */
  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a streaming fetch request (single attempt)
   */
  private async executeStreamingFetch(
    endpoint: string,
    messages: ChatMessage[],
    onDelta?: (text: string) => void
  ): Promise<string> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.reportApiKey}`,
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages,
        stream: true,
      }),
      mode: "cors",
      credentials: "omit",
    });

    if (!response.ok) {
      // Fallback to non-streaming on any error (e.g., org not verified for streaming)
      const full = await this.callRemoteModel(messages);
      if (onDelta) onDelta(full);
      return full;
    }

    // Fallback if streaming body is not available
    if (!response.body || !("getReader" in response.body)) {
      const full = await this.callRemoteModel(messages);
      if (onDelta) onDelta(full);
      return full;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let fullText = "";
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          return fullText;
        }
        try {
          const parsed = JSON.parse(data);
          const delta: string = parsed?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            fullText += delta;
            onDelta?.(delta);
          }
        } catch {
          // ignore JSON parse errors for keep-alive lines
        }
      }
    }

    return fullText;
  }

  async callRemoteModelStream(
    messages: ChatMessage[],
    onDelta?: (text: string) => void,
    onRetry?: (attempt: number, maxAttempts: number) => void
  ): Promise<string> {
    if (!this.settings.reportApiKey) {
      throw new Error("License key is required. Please configure it in settings.");
    }

    const endpoint = `${REPORT_API_BASE_URL}/api/chat`;
    const maxRetries = 3;
    // Optimized backoff: 500ms, 1s, 2s (faster initial retry for transient errors)
    const getRetryDelay = (attempt: number): number => {
      const delays = [500, 1000, 2000];
      return delays[attempt - 1] || 2000;
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeStreamingFetch(endpoint, messages, onDelta);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Only retry on transient network errors
        if (!this.isTransientNetworkError(lastError)) {
          break;
        }

        // Don't retry on the last attempt
        if (attempt < maxRetries) {
          const delayMs = getRetryDelay(attempt);
          console.log(`[OSINT Copilot] Network error, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})`);

          // Notify caller about retry
          if (onRetry) {
            onRetry(attempt, maxRetries);
          }

          await this.sleep(delayMs);
        }
      }
    }

    // All retries exhausted, throw user-friendly error
    if (lastError) {
      const errorMessage = lastError.message.toLowerCase();
      if (this.isTransientNetworkError(lastError)) {
        throw new Error("Network connection error. Please check your internet connection and try again.");
      }
      if (errorMessage.includes('abort')) {
        throw new Error("Request was cancelled.");
      }
      throw new Error(`API request failed: ${lastError.message}`);
    }
    throw new Error("An unexpected error occurred. Please try again.");
  }

  // ============================================================================
  // Q&A FUNCTIONALITY
  // ============================================================================

  async askVault(query: string): Promise<{ answer: string; notes: IndexedNote[] }> {
    if (!this.isAuthenticated()) {
      throw new Error("License key required for AI features. Please configure your license key in settings.");
    }

    const contextNotes = this.retrieveNotes(query);

    if (contextNotes.length === 0) {
      return {
        answer: "No relevant notes found for your query.",
        notes: [],
      };
    }

    // Build context
    let contextText = `User query: "${query}"\n\nHere are relevant notes:\n\n`;
    for (const note of contextNotes) {
      contextText += `--- Note: ${note.path} ---\n`;
      if (note.tags.length > 0) {
        contextText += `Tags: ${note.tags.join(", ")}\n`;
      }
      if (note.frontmatter) {
        contextText += `Frontmatter: ${JSON.stringify(note.frontmatter)}\n`;
      }
      // Limit content to 1500 chars
      const excerpt =
        note.content.length > 1500
          ? note.content.substring(0, 1500) + "..."
          : note.content;
      contextText += `Content:\n${excerpt}\n\n`;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: this.settings.systemPrompt },
      { role: "user", content: contextText },
    ];

    const answer = await this.callRemoteModel(messages);

    return { answer, notes: contextNotes };
  }

  /**
   * Stream-based version of askVault that provides incremental updates.
   * @param query The user's query
   * @param onDelta Callback for each streamed text chunk
   * @param preloadedNotes Optional pre-loaded notes to use instead of retrieving
   * @param onRetry Optional callback for retry notifications
   */
  async askVaultStream(
    query: string,
    onDelta?: (text: string) => void,
    preloadedNotes?: IndexedNote[],
    onRetry?: (attempt: number, maxAttempts: number) => void
  ): Promise<{ fullAnswer: string; notes: IndexedNote[] }> {
    if (!this.isAuthenticated()) {
      throw new Error("License key required for AI features. Please configure your license key in settings.");
    }

    const contextNotes = preloadedNotes ?? this.retrieveNotes(query);

    if (contextNotes.length === 0) {
      const noNotesMsg = "No relevant notes found for your query.";
      onDelta?.(noNotesMsg);
      return {
        fullAnswer: noNotesMsg,
        notes: [],
      };
    }

    // Build context
    let contextText = `User query: "${query}"\n\nHere are relevant notes:\n\n`;
    for (const note of contextNotes) {
      contextText += `--- Note: ${note.path} ---\n`;
      if (note.tags.length > 0) {
        contextText += `Tags: ${note.tags.join(", ")}\n`;
      }
      if (note.frontmatter) {
        contextText += `Frontmatter: ${JSON.stringify(note.frontmatter)}\n`;
      }
      // Limit content to 1500 chars
      const excerpt =
        note.content.length > 1500
          ? note.content.substring(0, 1500) + "..."
          : note.content;
      contextText += `Content:\n${excerpt}\n\n`;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: this.settings.systemPrompt },
      { role: "user", content: contextText },
    ];

    const fullAnswer = await this.callRemoteModelStream(messages, onDelta, onRetry);

    return { fullAnswer, notes: contextNotes };
  }

  // ============================================================================
  // REPORT GENERATION
  // ============================================================================

  async generateReport(
    description: string,
    currentConversation: Conversation | null,
    statusCallback?: (status: string, progress?: ReportProgress, intermediateResults?: string[]) => void
  ): Promise<{ content: string; filename: string; conversationId?: string }> {
    // Use the license key for report generation
    const reportApiKey = this.settings.reportApiKey;

    if (!reportApiKey) {
      throw new Error("License key required. Please configure it in settings.");
    }

    const baseUrl = REPORT_API_BASE_URL;

    try {
      // Step 1: Request report generation and get job_id with retry logic
      statusCallback?.("Requesting report generation...");

      let jobId = "";
      const maxInitialRetries = 3;
      
      // Get conversation_id from current conversation (if exists)
      // Each conversation has its own conversation_id for report generation
      const savedConversationId = currentConversation?.reportConversationId || null;

      for (let initAttempt = 1; initAttempt <= maxInitialRetries; initAttempt++) {
        try {
          // Build request body - include conversation_id if we have one
          const requestBody: any = {
            description: description,
            vault_context: "" // Can be extended to include vault context
          };
          
          // Include conversation_id only if we have a saved one
          if (savedConversationId) {
            requestBody.conversation_id = savedConversationId;
            console.log('[OSINT Copilot] Sending request with existing conversation_id:', savedConversationId);
          } else {
            console.log('[OSINT Copilot] Sending first request (no conversation_id)');
          }

          const generateResponse = await fetch(`${baseUrl}/api/generate-report`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${reportApiKey}`,
            },
            body: JSON.stringify(requestBody),
            mode: 'cors',
            credentials: 'omit',
          });

          if (!generateResponse.ok) {
            const errorText = await generateResponse.text();

            // Handle quota exhaustion specifically - don't retry these
            if (generateResponse.status === 403) {
              const lowerError = errorText.toLowerCase();
              if (lowerError.includes("quota") || lowerError.includes("exhausted")) {
                throw new Error(
                  "Report quota exhausted. Please upgrade your plan or wait for quota renewal. Visit https://osint-copilot.com/dashboard/ to manage your subscription."
                );
              }
              if (lowerError.includes("expired")) {
                throw new Error(
                  "Your license key or trial has expired. Please renew your subscription at https://osint-copilot.com/dashboard/"
                );
              }
              if (lowerError.includes("inactive")) {
                throw new Error(
                  "Your license key is inactive. Please check your account status at https://osint-copilot.com/dashboard/"
                );
              }
            }

            throw new Error(
              `Report generation request failed (${generateResponse.status}): ${errorText.substring(0, 200)}`
            );
          }

          const generateData = await generateResponse.json();
          jobId = generateData.job_id;

          if (!jobId) {
            throw new Error("No job_id received from server");
          }

          // ✅ IMPORTANT: Save conversation_id from server response to current conversation
          // This will be saved to the conversation file when saveConversation() is called
          if (generateData.conversation_id && currentConversation) {
            currentConversation.reportConversationId = generateData.conversation_id;
            console.log('[OSINT Copilot] Updated conversation with reportConversationId:', generateData.conversation_id);
          }

          break; // Success, exit retry loop
        } catch (initError) {
          const isNetworkError = initError instanceof Error && this.isTransientNetworkError(initError);

          if (isNetworkError && initAttempt < maxInitialRetries) {
            console.log(`[OSINT Copilot] Report init network error, retrying (${initAttempt}/${maxInitialRetries}):`, initError);
            statusCallback?.(`Network interrupted, retrying... (attempt ${initAttempt}/${maxInitialRetries})`);
            await this.sleep(1000 * initAttempt); // Exponential backoff
          } else {
            throw initError;
          }
        }
      }

      statusCallback?.(`Report generation started (Job ID: ${jobId}). Processing...`);

      // Step 2: Poll for job status with adaptive polling and retry logic
      let attempts = 0;
      const maxElapsedMs = 5 * 60 * 1000; // 5 minutes max timeout
      let elapsedMs = 0;
      let jobStatus = "processing";
      let reportFilename = "";
      let consecutiveNetworkErrors = 0;
      const maxConsecutiveNetworkErrors = 5; // Allow up to 5 consecutive network errors before failing

      // Adaptive polling: start fast (2s), gradually increase to max (5s) as job takes longer
      const getPollingInterval = (elapsed: number): number => {
        if (elapsed < 15000) return 2000;      // First 15s: poll every 2s (fast feedback)
        if (elapsed < 45000) return 3000;      // 15-45s: poll every 3s
        return 5000;                            // After 45s: poll every 5s (reduce load)
      };

      while (elapsedMs < maxElapsedMs && jobStatus === "processing") {
        const pollInterval = getPollingInterval(elapsedMs);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        elapsedMs += pollInterval;
        attempts++;

        const elapsedSecs = Math.round(elapsedMs / 1000);
        statusCallback?.(`Checking report status... (${elapsedSecs}s elapsed)`);

        try {
          const statusResponse = await fetch(`${baseUrl}/api/report-status/${jobId}`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${reportApiKey}`,
            },
            mode: 'cors',
            credentials: 'omit',
          });

          if (!statusResponse.ok) {
            throw new Error(`Failed to check job status: ${statusResponse.status}`);
          }

          const statusData = await statusResponse.json();
          jobStatus = statusData.status;

          // Reset consecutive error counter on successful fetch
          consecutiveNetworkErrors = 0;

          // Parse and forward progress and intermediate results
          if (statusData.progress) {
            statusCallback?.(
              statusData.status,
              {
                message: statusData.progress.message || "Processing...",
                percent: statusData.progress.percent || 0,
              },
              statusData.intermediate_results
            );
          } else {
            statusCallback?.(statusData.status, undefined, statusData.intermediate_results);
          }

          // ✅ Check response_ready for answers (new feature)
          if (statusData.response_ready) {
            statusCallback?.("Response ready, retrieving from conversation...");
            
            const conversationId = currentConversation?.reportConversationId || statusData.conversation_id;
            
            if (!conversationId) {
              throw new Error("Response ready but no conversation_id available");
            }
            
            // Backend should return content in statusData when response_ready = true
            // Check multiple possible field names
            let responseContent = statusData.content || 
                                 statusData.response_content || 
                                 statusData.message ||
                                 statusData.response;
            
            // If not in statusData, try to get from conversation via API (fallback)
            if (!responseContent) {
              try {
                responseContent = await this.getConversationResponse(
                  conversationId,
                  baseUrl,
                  reportApiKey
                );
              } catch (apiError) {
                // If API endpoint doesn't exist, throw clear error
                throw new Error(
                  `Response is ready but content not found. ` +
                  `Backend must return 'content' or 'response_content' in statusData when response_ready = true. ` +
                  `Conversation ID: ${conversationId}`
                );
              }
            }
            
            if (!responseContent) {
              throw new Error(
                `Response is ready but no content found. ` +
                `Backend must return 'content' or 'response_content' in statusData when response_ready = true.`
              );
            }
            
            // Save conversation_id if not already saved
            if (currentConversation && !currentConversation.reportConversationId) {
              currentConversation.reportConversationId = conversationId;
            }
            
            // Sanitize the markdown content
            const sanitizedContent = this.sanitizeMarkdownContent(responseContent);
            
            return {
              content: sanitizedContent,
              filename: `response_${jobId}.md`,
              conversationId: conversationId
            };
          }

          if (jobStatus === "completed") {
            reportFilename = statusData.filename;
            break;
          } else if (jobStatus === "failed") {
            // Parse the error message for user-friendly display
            const backendError = statusData.error || "Unknown error";

            // Check for common backend issues
            if (backendError.toLowerCase().includes("ssl") ||
                backendError.toLowerCase().includes("certificate") ||
                backendError.toLowerCase().includes("n8n")) {
              throw new Error("Backend service temporarily unavailable. Please try again in a few minutes.");
            }

            throw new Error(`Report generation failed: ${backendError}`);
          }
        } catch (pollError) {
          // Check if this is a transient network error
          const isNetworkError = pollError instanceof Error && this.isTransientNetworkError(pollError);

          if (isNetworkError) {
            consecutiveNetworkErrors++;
            console.log(`[OSINT Copilot] Report status poll network error (${consecutiveNetworkErrors}/${maxConsecutiveNetworkErrors}):`, pollError);

            if (consecutiveNetworkErrors >= maxConsecutiveNetworkErrors) {
              throw new Error("Network connection lost. Please check your internet connection and try again.");
            }

            // Show retry status to user
            statusCallback?.(`Network interrupted, retrying... (${Math.round(elapsedMs / 1000)}s elapsed)`);
            // Continue polling - don't throw
          } else {
            // Non-network error, re-throw immediately
            throw pollError;
          }
        }
      }

      // Check if job completed or response is ready (for answers)
      // Note: response_ready case is handled inside the loop and returns early
      if (jobStatus !== "completed") {
        throw new Error("Report generation timed out. Please try again.");
      }

      // Step 3: Download the report with retry logic
      statusCallback?.("Downloading report...");

      let reportContent = "";
      const maxDownloadRetries = 3;

      for (let downloadAttempt = 1; downloadAttempt <= maxDownloadRetries; downloadAttempt++) {
        try {
          const downloadResponse = await fetch(`${baseUrl}/api/download-report/${jobId}`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${reportApiKey}`,
            },
            mode: 'cors',
            credentials: 'omit',
          });

          if (!downloadResponse.ok) {
            const errorText = await downloadResponse.text();
            throw new Error(`Failed to download report: ${downloadResponse.status} - ${errorText}`);
          }

          // Get the raw response text
          const rawContent = await downloadResponse.text();

          // Check if the response is JSON and extract markdown content if so
          reportContent = this.extractMarkdownFromResponse(rawContent);

          break; // Success, exit retry loop
        } catch (downloadError) {
          const isNetworkError = downloadError instanceof Error && this.isTransientNetworkError(downloadError);

          if (isNetworkError && downloadAttempt < maxDownloadRetries) {
            console.log(`[OSINT Copilot] Report download network error, retrying (${downloadAttempt}/${maxDownloadRetries}):`, downloadError);
            statusCallback?.(`Download interrupted, retrying... (attempt ${downloadAttempt}/${maxDownloadRetries})`);
            await this.sleep(1000 * downloadAttempt); // Exponential backoff
          } else {
            throw downloadError;
          }
        }
      }

      const finalReportFilename = reportFilename || `report_${jobId}.md`;

      if (!reportContent) {
        throw new Error("No content received from server");
      }

      statusCallback?.("Report downloaded successfully!");

      // Sanitize the markdown content
      const sanitizedContent = this.sanitizeMarkdownContent(reportContent);

      return {
        content: sanitizedContent,
        filename: finalReportFilename
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Report generation failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Получает последнее сообщение ассистента из conversation
   * Используется когда response_ready = true для получения ответа
   */
  async getConversationResponse(
    conversationId: string,
    baseUrl: string,
    apiKey: string
  ): Promise<string> {
    // Try multiple possible endpoints for getting conversation messages
    const possibleEndpoints = [
      `/api/conversation/${conversationId}/messages`,
      `/api/conversations/${conversationId}/messages`,
      `/api/chat/conversation/${conversationId}`,
      `/api/conversation/${conversationId}`
    ];

    for (const endpoint of possibleEndpoints) {
      try {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          mode: 'cors',
          credentials: 'omit',
        });

        if (response.ok) {
          const data = await response.json();
          
          // Try different response structures
          let messages: any[] = [];
          if (Array.isArray(data)) {
            messages = data;
          } else if (data.messages && Array.isArray(data.messages)) {
            messages = data.messages;
          } else if (data.conversation && Array.isArray(data.conversation.messages)) {
            messages = data.conversation.messages;
          }
          
          // Find last assistant message
          const lastAssistantMessage = messages
            .filter((msg: any) => msg.role === 'assistant' || msg.role === 'AI')
            .pop();
          
          if (lastAssistantMessage && lastAssistantMessage.content) {
            return lastAssistantMessage.content;
          }
        } else if (response.status !== 404) {
          // If it's not 404, it might be a different error (403, 500, etc.)
          // Continue to next endpoint
          continue;
        }
      } catch (fetchError) {
        // Network error or other fetch issue, continue to next endpoint
        continue;
      }
    }

    // If all endpoints failed, throw error
    throw new Error(
      `No API endpoint found to retrieve conversation messages. ` +
      `Backend must return 'content' or 'response_content' in statusData when response_ready = true.`
    );
  }

  // ============================================================================
  // CLASSIFICATION HELPERS
  // ============================================================================

  /**
   * Extract entity name and type from a user query.
   * This is the primary method used for entity extraction - it returns both
   * the entity name and its classified type in a single LLM call.
   */
  async extractEntityFromQuery(query: string): Promise<{
    name: string | null;
    type: "person" | "company" | "asset" | "event" | "location" | "unknown";
  }> {
    const system =
      "Extract the main entity mentioned in the user's query and classify it as one of: person | company | asset | event | location. Respond ONLY in JSON: {\"name\":\"<entity name or null>\",\"type\":\"person|company|asset|event|location|unknown\"}. Use English only.";

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: query },
    ];

    try {
      const text = await this.callRemoteModel(messages, false, ENTITY_EXTRACTION_MODEL); // Use OpenAI model for entity extraction
      
      // Debug logging
      //console.log("[extractEntityFromQuery] Raw response:", text);
      
      // Try strict JSON parse
      const match = text.trim();
      let obj: any = null;
      try {
        obj = JSON.parse(match);
        //console.log("[extractEntityFromQuery] Parsed JSON:", obj);
      } catch (parseError) {
        //console.warn("[extractEntityFromQuery] JSON parse failed, trying regex:", parseError);
        // Best-effort: find JSON substring
        const m = match.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            obj = JSON.parse(m[0]);
            //console.log("[extractEntityFromQuery] Parsed JSON from regex:", obj);
          } catch (e) {
            //console.error("[extractEntityFromQuery] Regex parse also failed:", e);
          }
        }
      }
      
      if (!obj) {
        //  console.error("[extractEntityFromQuery] No valid JSON found in response:", match);
        return { name: null, type: "unknown" };
      }
      
      const allowed = ["person", "company", "asset", "event", "location", "unknown"];
      const t = (obj?.type || "unknown").toLowerCase();
      const type = allowed.includes(t) ? t : "unknown";
      const nameVal =
        typeof obj?.name === "string" && obj.name.trim().length > 0
          ? obj.name.trim()
          : null;
      
      console.log("[extractEntityFromQuery] Extracted:", { name: nameVal, type });
      return { name: nameVal, type };
    } catch (error) {
      console.error("[extractEntityFromQuery] Error:", error);
      return { name: null, type: "unknown" };
    }
  }



  sanitizeMarkdownContent(content: string): string {
    // Remove any HTML script tags
    content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Remove any HTML iframe tags
    content = content.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

    // Remove any HTML object/embed tags
    content = content.replace(/<(object|embed)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, '');

    // Remove any javascript: protocol links
    content = content.replace(/\[([^\]]+)\]\(javascript:[^\)]*\)/gi, '[$1](#)');

    // Remove any data: protocol links (except images)
    content = content.replace(/\[([^\]]+)\]\(data:(?!image)[^\)]*\)/gi, '[$1](#)');

    return content;
  }

  /**
   * Extract markdown content from API response.
   * The API may return either:
   * 1. Plain markdown text
   * 2. JSON object with markdown in a field like 'content', 'markdown', 'report', 'text', or 'data'
   * This method detects the format and extracts the markdown content.
   */
  extractMarkdownFromResponse(rawContent: string): string {
    const trimmedContent = rawContent.trim();

    // Check if the response looks like JSON (starts with { or [)
    if (trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) {
      try {
        const jsonData = JSON.parse(trimmedContent);

        // If it's an array, try to get the first element
        const data = Array.isArray(jsonData) ? jsonData[0] : jsonData;

        if (data && typeof data === 'object') {
          // Try common field names for markdown content (in order of priority)
          const contentFields = ['content', 'markdown', 'report', 'text', 'data', 'body', 'result', 'output'];

          for (const field of contentFields) {
            if (data[field] && typeof data[field] === 'string') {
              console.log(`[OSINT Copilot] Extracted markdown from JSON field: ${field}`);
              return data[field];
            }
          }

          // If no known field found, check for nested 'report' object
          if (data.report && typeof data.report === 'object') {
            for (const field of contentFields) {
              if (data.report[field] && typeof data.report[field] === 'string') {
                console.log(`[OSINT Copilot] Extracted markdown from JSON field: report.${field}`);
                return data.report[field];
              }
            }
          }

          // Last resort: if there's only one string field, use it
          const stringFields = Object.entries(data).filter(([_, v]) => typeof v === 'string' && (v as string).length > 100);
          if (stringFields.length === 1) {
            console.log(`[OSINT Copilot] Extracted markdown from single string field: ${stringFields[0][0]}`);
            return stringFields[0][1] as string;
          }

          // If we still can't find markdown, log the structure and return raw
          console.warn('[OSINT Copilot] Could not find markdown content in JSON response. Fields:', Object.keys(data));
        }
      } catch (parseError) {
        // Not valid JSON, treat as plain text
        console.log('[OSINT Copilot] Response is not valid JSON, treating as plain markdown');
      }
    }

    // Return as-is if not JSON or couldn't extract
    return rawContent;
  }

  getVaultContext(): string {
    // Get a summary of vault content for context
    const notes = Array.from(this.index.values());
    let context = `Vault contains ${notes.length} notes.\n\n`;

    // Add sample of note titles
    const sampleNotes = notes.slice(0, 20);
    context += "Sample notes:\n";
    for (const note of sampleNotes) {
      context += `- ${note.path}\n`;
    }

    return context;
  }

  async saveReportToVault(reportContent: string, description: string, originalFilename?: string): Promise<string> {
    const date = new Date().toISOString().split("T")[0];

    // Extract entity name from description for meaningful filename
    // Common patterns: "Tell me about X", "Report on X", "Who is X", "What is X", etc.
    let entityName = description;
    const patterns = [
      /(?:tell me about|report on|who is|what is|investigate|research|find|look up|search for)\s+(.+)/i,
      /(.+?)(?:\s+report|\s+investigation|\s+research)?$/i
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match && match[1]) {
        entityName = match[1].trim();
        break;
      }
    }

    // Sanitize entity name for filename: replace spaces with underscores, remove special chars
    const sanitizedEntity = entityName
      .substring(0, 50)
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_");

    // Create filename: EntityName_Report_YYYY-MM-DD.md
    const baseFilename = sanitizedEntity ? `${sanitizedEntity}_Report` : "Report";
    const fileName = `${this.settings.reportOutputDir}/${baseFilename}_${date}.md`;

    // Ensure Reports folder exists
    const reportsFolder = this.app.vault.getAbstractFileByPath(this.settings.reportOutputDir);
    if (!reportsFolder) {
      await this.app.vault.createFolder(this.settings.reportOutputDir);
    }

    // Add metadata header to the report
    let content = `---\n`;
    content += `report_description: "${description.replace(/"/g, '\\"')}"\n`;
    content += `generated: ${new Date().toISOString()}\n`;
    content += `source: OpenDossier API\n`;
    content += `---\n\n`;
    content += reportContent;

    // Check if file exists, if so add a counter to create unique filename
    let finalFileName = fileName;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(finalFileName)) {
      finalFileName = `${this.settings.reportOutputDir}/${baseFilename}_${date}-${counter}.md`;
      counter++;
    }

    // Create new file
    await this.app.vault.create(finalFileName, content);
    return finalFileName;
  }

  async saveDarkWebReportToVault(reportContent: string, query: string, jobId: string): Promise<string> {
    const date = new Date().toISOString().split("T")[0];

    // Sanitize query for filename: replace spaces with underscores, remove special chars
    const sanitizedQuery = query
      .substring(0, 50)
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_");

    // Create filename: DarkWeb_QueryTopic_YYYY-MM-DD.md
    const baseFilename = sanitizedQuery ? `DarkWeb_${sanitizedQuery}` : `DarkWeb_Investigation`;
    const fileName = `${this.settings.reportOutputDir}/${baseFilename}_${date}.md`;

    // Ensure Reports folder exists
    const reportsFolder = this.app.vault.getAbstractFileByPath(this.settings.reportOutputDir);
    if (!reportsFolder) {
      await this.app.vault.createFolder(this.settings.reportOutputDir);
    }

    // Add metadata header to the report
    let content = `---\n`;
    content += `investigation_query: "${query.replace(/"/g, '\\"')}"\n`;
    content += `job_id: "${jobId}"\n`;
    content += `generated: ${new Date().toISOString()}\n`;
    content += `source: Dark Web Investigation\n`;
    content += `---\n\n`;
    content += reportContent;

    // Check if file exists, if so add a counter to create unique filename
    let finalFileName = fileName;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(finalFileName)) {
      finalFileName = `${this.settings.reportOutputDir}/${baseFilename}_${date}-${counter}.md`;
      counter++;
    }

    // Create new file
    await this.app.vault.create(finalFileName, content);
    return finalFileName;
  }

  // ============================================================================
  // MODALS
  // ============================================================================

  openAskModal() {
    if (!this.isAuthenticated()) {
      new Notice("License key required for AI features. Please configure your license key in settings.");
      return;
    }
    new AskModal(this.app, this).open();
  }

  async openChatView() {
    // License key validation - Chat feature requires a valid license key
    if (!this.settings.reportApiKey) {
      new Notice("A valid license key is required to use the Chat feature. Please purchase a license key to enable this functionality.", 8000);
      // Open settings tab so user can enter their license key
      const settingTab = (this.app as any).setting;
      if (settingTab) {
        settingTab.open();
        settingTab.openTabById(this.manifest.id);
      }
      return;
    }

    const existing = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: CHAT_VIEW_TYPE,
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    }
  }

}

// ============================================================================
// ASK MODAL
// ============================================================================

class AskModal extends Modal {
  plugin: VaultAIPlugin;
  queryInput!: HTMLTextAreaElement;
  answerContainer!: HTMLDivElement;
  notesContainer!: HTMLDivElement;

  constructor(app: App, plugin: VaultAIPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("vault-ai-modal");

    contentEl.createEl("h2", { text: "Ask Your Vault" });

    // Query input
    contentEl.createEl("label", { text: "Your question:" });
    this.queryInput = contentEl.createEl("textarea", {
      placeholder: "What would you like to know?",
    });

    // Buttons
    const buttonContainer = contentEl.createDiv();
    const askButton = buttonContainer.createEl("button", { text: "Ask" });
    askButton.addEventListener("click", () => this.handleAsk());

    const closeButton = buttonContainer.createEl("button", { text: "Close" });
    closeButton.addEventListener("click", () => this.close());

    // Answer container
    this.answerContainer = contentEl.createDiv("vault-ai-answer");
    this.answerContainer.style.display = "none";

    // Notes list container
    this.notesContainer = contentEl.createDiv("vault-ai-notes-list");
    this.notesContainer.style.display = "none";
  }

  async handleAsk() {
    const query = this.queryInput.value.trim();
    if (!query) {
      new Notice("Please enter a question.");
      return;
    }

    this.answerContainer.innerHTML = "<p>Thinking...</p>";
    this.answerContainer.style.display = "block";

    try {
      const result = await this.plugin.askVault(query);

      // Display answer
      this.answerContainer.innerHTML = "";
      const answerPre = this.answerContainer.createEl("pre");
      answerPre.textContent = result.answer;

      // Copy button
      const copyButton = this.answerContainer.createEl("button", {
        text: "Copy Answer",
      });
      copyButton.addEventListener("click", () => {
        navigator.clipboard.writeText(result.answer);
        new Notice("Answer copied to clipboard.");
      });

      // Display matching notes
      if (result.notes.length > 0) {
        this.notesContainer.innerHTML = "";
        this.notesContainer.createEl("h3", { text: "Matching Notes:" });

        for (const note of result.notes) {
          const noteItem = this.notesContainer.createDiv("vault-ai-note-item");
          noteItem.textContent = note.path;
          noteItem.addEventListener("click", async () => {
            const file = this.app.vault.getAbstractFileByPath(note.path);
            if (file instanceof TFile) {
              await this.app.workspace.getLeaf().openFile(file);
              this.close();
            }
          });
        }

        this.notesContainer.style.display = "block";
      }
    } catch (error) {
      this.answerContainer.innerHTML = `<p style="color: var(--text-error);">Error: ${
        error instanceof Error ? error.message : String(error)
      }</p>`;
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// ============================================================================
// RENAME CONVERSATION MODAL
// ============================================================================

class RenameConversationModal extends Modal {
  private currentTitle: string;
  private onSubmit: (newTitle: string) => void;
  private inputEl!: HTMLInputElement;

  constructor(app: App, currentTitle: string, onSubmit: (newTitle: string) => void) {
    super(app);
    this.currentTitle = currentTitle;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("vault-ai-modal");

    contentEl.createEl("h3", { text: "Rename Conversation" });

    const inputContainer = contentEl.createDiv({ cls: "vault-ai-rename-input-container" });
    inputContainer.createEl("label", { text: "New title:" });
    this.inputEl = inputContainer.createEl("input", {
      type: "text",
      value: this.currentTitle,
      cls: "vault-ai-rename-input"
    });
    this.inputEl.style.width = "100%";
    this.inputEl.style.marginTop = "8px";
    this.inputEl.style.padding = "8px";

    // Handle Enter key
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Escape") {
        this.close();
      }
    });

    const buttonContainer = contentEl.createDiv({ cls: "vault-ai-rename-buttons" });
    buttonContainer.style.marginTop = "16px";
    buttonContainer.style.display = "flex";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.gap = "8px";

    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = buttonContainer.createEl("button", { text: "Save", cls: "mod-cta" });
    saveBtn.addEventListener("click", () => this.submit());

    // Focus the input and select all text
    setTimeout(() => {
      this.inputEl.focus();
      this.inputEl.select();
    }, 10);
  }

  private submit() {
    const newTitle = this.inputEl.value.trim();
    if (newTitle && newTitle !== this.currentTitle) {
      this.onSubmit(newTitle);
    }
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// ============================================================================
// REPORT VIEW
// ============================================================================

// ============================================================================
// CHAT VIEW
// ============================================================================

interface CreatedEntityInfo {
  id: string;
  type: string;
  label: string;
  filePath: string;
}

interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
  notes?: IndexedNote[];
  jobId?: string; // For DarkWeb investigations
  status?: string; // For DarkWeb investigation status
  progress?: any; // For DarkWeb investigation progress
  query?: string; // For DarkWeb investigation query (used for saving reports)
  intermediateResults?: string[]; // For report generation intermediate results
  createdEntities?: CreatedEntityInfo[]; // For entity generation - clickable graph view links
  connectionsCreated?: number; // Number of relationships created
  reportFilePath?: string; // For report generation - path to the generated report file
}

class ChatView extends ItemView {
  plugin: VaultAIPlugin;
  chatHistory: ChatHistoryItem[] = [];
  inputEl!: HTMLTextAreaElement;
  messagesContainer!: HTMLDivElement;
  sidebarContainer!: HTMLDivElement;
  conversationListEl!: HTMLDivElement;
  // Main modes (mutually exclusive - only one can be active, or all can be off for Entity-Only Mode)
  lookupMode: boolean = true; // Default mode
  darkWebMode: boolean = false;
  reportGenerationMode: boolean = false;
  // Toggle elements
  lookupModeToggle!: HTMLInputElement;
  darkWebToggle!: HTMLInputElement;
  reportGenerationToggle!: HTMLInputElement;
  // Entity generation is independent (can be enabled with any main mode, or alone for Entity-Only Mode)
  entityGenerationMode: boolean = false;
  entityGenerationToggle!: HTMLInputElement;
  pollingIntervals: Map<string, number> = new Map();
  currentConversation: Conversation | null = null;
  sidebarVisible: boolean = true;

  constructor(leaf: WorkspaceLeaf, plugin: VaultAIPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "OSINT Copilot";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen() {
    await this.loadMostRecentConversation();
    this.render();
  }

  async loadMostRecentConversation() {
    const conversation = await this.plugin.conversationService.getMostRecentConversation();
    if (conversation) {
      this.currentConversation = conversation;
      this.chatHistory = this.conversationMessagesToHistory(conversation.messages);
      this.darkWebMode = conversation.darkWebMode || false;
      this.entityGenerationMode = conversation.entityGenerationMode || false;
      this.reportGenerationMode = conversation.reportGenerationMode || false;
      // Lookup mode: true if no other main mode is active (backward compatibility)
      this.lookupMode = !this.darkWebMode && !this.reportGenerationMode;
    }
  }

  conversationMessagesToHistory(messages: ConversationMessage[]): ChatHistoryItem[] {
    return messages.map(m => ({
      role: m.role,
      content: m.content,
      notes: m.notes as IndexedNote[],
      jobId: m.jobId,
      status: m.status,
      progress: m.progress,
      reportFilePath: m.reportFilePath
    }));
  }

  historyToConversationMessages(): ConversationMessage[] {
    return this.chatHistory.map(h => ({
      role: h.role,
      content: h.content,
      timestamp: Date.now(),
      notes: h.notes,
      jobId: h.jobId,
      status: h.status,
      progress: h.progress,
      reportFilePath: h.reportFilePath
    }));
  }

  async saveCurrentConversation() {
    if (!this.currentConversation) {
      this.currentConversation = await this.plugin.conversationService.createConversation(
        this.chatHistory.length > 0 ? this.chatHistory[0].content : undefined,
        this.darkWebMode,
        this.entityGenerationMode,
        this.reportGenerationMode
      );
    }
    this.currentConversation.messages = this.historyToConversationMessages();
    this.currentConversation.lookupMode = this.lookupMode;
    this.currentConversation.darkWebMode = this.darkWebMode;
    this.currentConversation.entityGenerationMode = this.entityGenerationMode;
    this.currentConversation.reportGenerationMode = this.reportGenerationMode;
    await this.plugin.conversationService.saveConversation(this.currentConversation);
    this.renderConversationList();
  }

  render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("vault-ai-chat-view");
    container.addClass("vault-ai-chat-with-sidebar");

    // Main layout: sidebar + chat area
    const mainLayout = container.createDiv("vault-ai-chat-layout");

    // Sidebar
    this.sidebarContainer = mainLayout.createDiv("vault-ai-chat-sidebar");
    if (!this.sidebarVisible) this.sidebarContainer.addClass("hidden");
    this.renderSidebar();

    // Chat area
    const chatArea = mainLayout.createDiv("vault-ai-chat-area");

    // Header
    const header = chatArea.createDiv("vault-ai-chat-header");

    // Toggle sidebar button
    const toggleSidebarBtn = header.createEl("button", { cls: "vault-ai-sidebar-toggle" });
    toggleSidebarBtn.innerHTML = "☰";
    toggleSidebarBtn.title = "Toggle conversation history";
    toggleSidebarBtn.addEventListener("click", () => {
      this.sidebarVisible = !this.sidebarVisible;
      if (this.sidebarVisible) {
        this.sidebarContainer.removeClass("hidden");
      } else {
        this.sidebarContainer.addClass("hidden");
      }
    });

    header.createEl("h3", { text: "OSINT Copilot" });

    const buttonGroup = header.createDiv("vault-ai-chat-header-buttons");

    // New Chat button
    const newChatBtn = buttonGroup.createEl("button", { text: "New Chat", cls: "vault-ai-new-chat-btn" });
    newChatBtn.addEventListener("click", async () => {
      await this.startNewConversation();
    });

    // === Main Mode Selection (Mutually Exclusive Checkboxes - can all be off for Entity-Only Mode) ===
    const mainModeGroup = buttonGroup.createDiv("vault-ai-main-mode-group");
    mainModeGroup.setAttribute("title", "Select one mode, or deselect all for Entity-Only Mode");

    // Lookup Mode Toggle (default mode)
    const lookupContainer = mainModeGroup.createDiv("vault-ai-lookup-toggle");
    lookupContainer.addClass("vault-ai-toggle-container");

    this.lookupModeToggle = lookupContainer.createEl("input", {
      type: "checkbox",
      cls: "vault-ai-mode-checkbox",
    });
    this.lookupModeToggle.id = "lookup-mode-toggle";
    this.lookupModeToggle.checked = this.lookupMode;
    this.lookupModeToggle.addEventListener("change", () => {
      if (this.lookupModeToggle.checked) {
        // Enable lookup mode, disable others (mutual exclusivity)
        this.lookupMode = true;
        this.darkWebMode = false;
        this.reportGenerationMode = false;
        this.darkWebToggle.checked = false;
        this.reportGenerationToggle.checked = false;
        new Notice("Lookup Mode enabled");
      } else {
        // Disable lookup mode - may enter Entity-Only Mode if entity generation is on
        this.lookupMode = false;
        this.checkEntityOnlyMode();
      }
      this.updateAllModeLabels();
      this.updateInputPlaceholder();
    });

    const lookupLabel = lookupContainer.createEl("label", {
      text: this.lookupMode ? "🔍 Lookup (ON)" : "🔍 Lookup",
      cls: this.lookupMode ? "vault-ai-mode-label active" : "vault-ai-mode-label",
    });
    lookupLabel.htmlFor = "lookup-mode-toggle";

    // Dark Web Mode Toggle
    const darkWebContainer = mainModeGroup.createDiv("vault-ai-dark-web-toggle");
    darkWebContainer.addClass("vault-ai-toggle-container");

    this.darkWebToggle = darkWebContainer.createEl("input", {
      type: "checkbox",
      cls: "vault-ai-mode-checkbox",
    });
    this.darkWebToggle.id = "dark-web-mode-toggle";
    this.darkWebToggle.checked = this.darkWebMode;
    this.darkWebToggle.addEventListener("change", () => {
      if (this.darkWebToggle.checked) {
        // Enable dark web mode, disable others (mutual exclusivity)
        this.darkWebMode = true;
        this.lookupMode = false;
        this.reportGenerationMode = false;
        this.lookupModeToggle.checked = false;
        this.reportGenerationToggle.checked = false;
        new Notice("Dark Web Mode enabled");
      } else {
        // Disable dark web mode - may enter Entity-Only Mode if entity generation is on
        this.darkWebMode = false;
        this.checkEntityOnlyMode();
      }
      this.updateAllModeLabels();
      this.updateInputPlaceholder();
    });

    const darkWebLabel = darkWebContainer.createEl("label", {
      text: this.darkWebMode ? "🕵️ Dark Web (ON)" : "🕵️ Dark Web",
      cls: this.darkWebMode ? "vault-ai-mode-label active" : "vault-ai-mode-label",
    });
    darkWebLabel.htmlFor = "dark-web-mode-toggle";

    // Report Generation Mode Toggle
    const reportGenContainer = mainModeGroup.createDiv("vault-ai-report-gen-toggle");
    reportGenContainer.addClass("vault-ai-toggle-container");

    this.reportGenerationToggle = reportGenContainer.createEl("input", {
      type: "checkbox",
      cls: "vault-ai-mode-checkbox",
    });
    this.reportGenerationToggle.id = "report-gen-mode-toggle";
    this.reportGenerationToggle.checked = this.reportGenerationMode;
    this.reportGenerationToggle.addEventListener("change", () => {
      if (this.reportGenerationToggle.checked) {
        // Enable report mode, disable others (mutual exclusivity)
        this.reportGenerationMode = true;
        this.lookupMode = false;
        this.darkWebMode = false;
        this.lookupModeToggle.checked = false;
        this.darkWebToggle.checked = false;
        new Notice("Report Generation Mode enabled");
      } else {
        // Disable report mode - may enter Entity-Only Mode if entity generation is on
        this.reportGenerationMode = false;
        this.checkEntityOnlyMode();
      }
      this.updateAllModeLabels();
      this.updateInputPlaceholder();
    });

    const reportGenLabel = reportGenContainer.createEl("label", {
      text: this.reportGenerationMode ? "📄 Report (ON)" : "📄 Report",
      cls: this.reportGenerationMode ? "vault-ai-mode-label active" : "vault-ai-mode-label",
    });
    reportGenLabel.htmlFor = "report-gen-mode-toggle";

    // === Entity Generation Toggle (Independent - enables Entity-Only Mode when all main modes are off) ===
    const entityGenContainer = buttonGroup.createDiv("vault-ai-entity-gen-toggle");
    entityGenContainer.addClass("vault-ai-toggle-container");
    entityGenContainer.setAttribute("title", "Extract entities (works with any mode, or alone for Entity-Only Mode)");

    this.entityGenerationToggle = entityGenContainer.createEl("input", {
      type: "checkbox",
      cls: "vault-ai-entity-gen-checkbox",
    });
    this.entityGenerationToggle.id = "entity-gen-mode-toggle";
    this.entityGenerationToggle.checked = this.entityGenerationMode;
    this.entityGenerationToggle.addEventListener("change", () => {
      this.entityGenerationMode = this.entityGenerationToggle.checked;
      this.updateEntityGenerationLabel();
      this.updateInputPlaceholder();
      if (this.isEntityOnlyMode()) {
        new Notice("Entity-Only Mode enabled - extract entities from your text");
      } else if (this.entityGenerationMode) {
        new Notice("Entity Generation enabled");
      } else {
        new Notice("Entity Generation disabled");
      }
    });

    const entityGenLabel = entityGenContainer.createEl("label", {
      text: this.getEntityGenLabelText(),
      cls: this.entityGenerationMode ? "vault-ai-entity-gen-label active" : "vault-ai-entity-gen-label",
    });
    entityGenLabel.htmlFor = "entity-gen-mode-toggle";

    // Messages container
    this.messagesContainer = chatArea.createDiv("vault-ai-chat-messages");
    this.renderMessages();

    // Input area
    const inputContainer = chatArea.createDiv("vault-ai-chat-input");

    this.inputEl = inputContainer.createEl("textarea", {
      placeholder: this.getInputPlaceholder(),
    });
    this.inputEl.rows = 3;

    const sendBtn = inputContainer.createEl("button", { text: "Send" });
    sendBtn.addEventListener("click", () => this.handleSend());

    // Handle Enter key (Shift+Enter for new line)
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });
  }

  // Check if Entity-Only Mode is active (entity generation ON, all main modes OFF)
  isEntityOnlyMode(): boolean {
    return this.entityGenerationMode && !this.lookupMode && !this.darkWebMode && !this.reportGenerationMode;
  }

  // Show notice when entering Entity-Only Mode
  checkEntityOnlyMode() {
    if (this.isEntityOnlyMode()) {
      new Notice("Entity-Only Mode - enter text to extract entities");
    }
  }

  // Get the appropriate input placeholder based on current mode
  getInputPlaceholder(): string {
    if (this.isEntityOnlyMode()) {
      return "Enter text to extract entities...";
    } else if (this.darkWebMode) {
      return "Enter dark web investigation query...";
    } else if (this.reportGenerationMode) {
      return "Describe the report you want to generate...";
    } else {
      return "Ask a question about your vault...";
    }
  }

  // Update the input placeholder text
  updateInputPlaceholder() {
    if (this.inputEl) {
      this.inputEl.placeholder = this.getInputPlaceholder();
    }
  }

  // Get the entity generation label text (shows Entity-Only when applicable)
  getEntityGenLabelText(): string {
    if (this.isEntityOnlyMode()) {
      return "🏷️ Entity-Only (ON)";
    } else if (this.entityGenerationMode) {
      return "🏷️ Entities (ON)";
    } else {
      return "🏷️ Entities";
    }
  }

  updateEntityGenerationLabel() {
    const container = this.containerEl.querySelector(".vault-ai-entity-gen-toggle");
    if (container) {
      const label = container.querySelector("label");
      if (label) {
        label.textContent = this.getEntityGenLabelText();
        label.className = this.entityGenerationMode ? "vault-ai-entity-gen-label active" : "vault-ai-entity-gen-label";
        // Add special styling for Entity-Only Mode
        if (this.isEntityOnlyMode()) {
          container.addClass("entity-only-mode");
        } else {
          container.removeClass("entity-only-mode");
        }
      }
    }
  }

  updateAllModeLabels() {
    // Update Lookup Mode label
    const lookupContainer = this.containerEl.querySelector(".vault-ai-lookup-toggle");
    if (lookupContainer) {
      const label = lookupContainer.querySelector("label");
      if (label) {
        label.textContent = this.lookupMode ? "🔍 Lookup (ON)" : "🔍 Lookup";
        label.className = this.lookupMode ? "vault-ai-mode-label active" : "vault-ai-mode-label";
      }
      const checkbox = lookupContainer.querySelector("input") as HTMLInputElement;
      if (checkbox) checkbox.checked = this.lookupMode;
    }

    // Update Dark Web Mode label
    const darkWebContainer = this.containerEl.querySelector(".vault-ai-dark-web-toggle");
    if (darkWebContainer) {
      const label = darkWebContainer.querySelector("label");
      if (label) {
        label.textContent = this.darkWebMode ? "🕵️ Dark Web (ON)" : "🕵️ Dark Web";
        label.className = this.darkWebMode ? "vault-ai-mode-label active" : "vault-ai-mode-label";
      }
      const checkbox = darkWebContainer.querySelector("input") as HTMLInputElement;
      if (checkbox) checkbox.checked = this.darkWebMode;
    }

    // Update Report Generation Mode label
    const reportContainer = this.containerEl.querySelector(".vault-ai-report-gen-toggle");
    if (reportContainer) {
      const label = reportContainer.querySelector("label");
      if (label) {
        label.textContent = this.reportGenerationMode ? "📄 Report (ON)" : "📄 Report";
        label.className = this.reportGenerationMode ? "vault-ai-mode-label active" : "vault-ai-mode-label";
      }
      const checkbox = reportContainer.querySelector("input") as HTMLInputElement;
      if (checkbox) checkbox.checked = this.reportGenerationMode;
    }

    // Also update entity generation label (for Entity-Only Mode indicator)
    this.updateEntityGenerationLabel();
  }

  renderSidebar() {
    this.sidebarContainer.empty();

    // Sidebar header
    const sidebarHeader = this.sidebarContainer.createDiv("vault-ai-sidebar-header");
    sidebarHeader.createEl("h4", { text: "Conversations" });

    // Conversation list
    this.conversationListEl = this.sidebarContainer.createDiv("vault-ai-conversation-list");
    this.renderConversationList();
  }

  renderConversationList() {
    this.conversationListEl.empty();
    const conversations = this.plugin.conversationService.getConversationList();

    if (conversations.length === 0) {
      this.conversationListEl.createEl("p", {
        text: "No conversations yet",
        cls: "vault-ai-no-conversations"
      });
      return;
    }

    for (const conv of conversations) {
      const convItem = this.conversationListEl.createDiv("vault-ai-conversation-item");
      if (this.currentConversation && this.currentConversation.id === conv.id) {
        convItem.addClass("active");
      }

      // Title and preview
      const convContent = convItem.createDiv("vault-ai-conversation-content");
      convContent.createEl("div", { text: conv.title, cls: "vault-ai-conversation-title" });

      const meta = convContent.createDiv("vault-ai-conversation-meta");
      const date = new Date(conv.updatedAt);
      meta.createEl("span", { text: this.formatDate(date), cls: "vault-ai-conversation-date" });
      // Check if Entity-Only Mode (entity gen ON, all main modes OFF)
      const isEntityOnly = conv.entityGenerationMode && !conv.lookupMode && !conv.darkWebMode && !conv.reportGenerationMode;
      // Show main mode badge or Entity-Only badge
      if (isEntityOnly) {
        meta.createEl("span", { text: "🏷️", cls: "vault-ai-conversation-entityonly", title: "Entity-Only Mode" });
      } else if (conv.darkWebMode) {
        meta.createEl("span", { text: "🕵️", cls: "vault-ai-conversation-darkweb", title: "Dark Web Mode" });
        if (conv.entityGenerationMode) {
          meta.createEl("span", { text: "🏷️", cls: "vault-ai-conversation-entitygen", title: "Entity Generation" });
        }
      } else if (conv.reportGenerationMode) {
        meta.createEl("span", { text: "📄", cls: "vault-ai-conversation-report", title: "Report Generation Mode" });
        if (conv.entityGenerationMode) {
          meta.createEl("span", { text: "🏷️", cls: "vault-ai-conversation-entitygen", title: "Entity Generation" });
        }
      } else {
        meta.createEl("span", { text: "🔍", cls: "vault-ai-conversation-lookup", title: "Lookup Mode" });
        if (conv.entityGenerationMode) {
          meta.createEl("span", { text: "🏷️", cls: "vault-ai-conversation-entitygen", title: "Entity Generation" });
        }
      }

      // Click to load conversation
      convContent.addEventListener("click", async () => {
        await this.loadConversation(conv.id);
      });

      // Actions (delete, rename)
      const actions = convItem.createDiv("vault-ai-conversation-actions");

      const renameBtn = actions.createEl("button", { cls: "vault-ai-conv-action-btn" });
      renameBtn.innerHTML = "✏️";
      renameBtn.title = "Rename";
      renameBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.renameConversation(conv.id, conv.title);
      });

      const deleteBtn = actions.createEl("button", { cls: "vault-ai-conv-action-btn" });
      deleteBtn.innerHTML = "🗑️";
      deleteBtn.title = "Delete";
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.deleteConversation(conv.id);
      });
    }
  }

  formatDate(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  async loadConversation(id: string) {
    // Don't reload if already viewing this conversation
    if (this.currentConversation && this.currentConversation.id === id) {
      return;
    }

    const conversation = await this.plugin.conversationService.loadConversation(id);
    if (conversation) {
      this.currentConversation = conversation;
      this.chatHistory = this.conversationMessagesToHistory(conversation.messages);
      this.darkWebMode = conversation.darkWebMode || false;
      this.entityGenerationMode = conversation.entityGenerationMode || false;
      this.reportGenerationMode = conversation.reportGenerationMode || false;
      // Use lookupMode from conversation, or infer from other modes for backward compatibility
      this.lookupMode = conversation.lookupMode !== undefined
        ? conversation.lookupMode
        : (!this.darkWebMode && !this.reportGenerationMode);
      this.plugin.conversationService.setCurrentConversationId(id);
      this.render();
    } else {
      new Notice("Failed to load conversation");
    }
  }

  async startNewConversation() {
    // Save current conversation first if it has messages
    if (this.currentConversation && this.chatHistory.length > 0) {
      await this.saveCurrentConversation();
    }
    this.currentConversation = null;
    this.chatHistory = [];
    // Reset mode toggles for new conversation (Lookup Mode is default)
    this.lookupMode = true;
    this.darkWebMode = false;
    this.entityGenerationMode = false;
    this.reportGenerationMode = false;
    this.plugin.conversationService.setCurrentConversationId(null);
    this.render();
    new Notice("Started new conversation");
  }

  async deleteConversation(id: string) {
    const confirmed = confirm("Are you sure you want to delete this conversation?");
    if (!confirmed) return;

    const success = await this.plugin.conversationService.deleteConversation(id);

    // Clear current conversation if it was deleted
    if (this.currentConversation && this.currentConversation.id === id) {
      this.currentConversation = null;
      this.chatHistory = [];
    }

    // Always refresh the UI (the service already updated its internal list)
    this.renderConversationList();
    this.renderMessages();

    if (success) {
      new Notice("Conversation deleted");
    } else {
      new Notice("Failed to delete conversation");
    }
  }

  async renameConversation(id: string, currentTitle: string) {
    new RenameConversationModal(this.app, currentTitle, async (newTitle: string) => {
      const success = await this.plugin.conversationService.renameConversation(id, newTitle);
      if (success) {
        if (this.currentConversation && this.currentConversation.id === id) {
          this.currentConversation.title = newTitle;
        }
        await this.plugin.conversationService.loadConversationList();
        this.renderConversationList();
        new Notice("Conversation renamed");
      }
    }).open();
  }

  async renderMessages() {
    this.messagesContainer.empty();

    if (this.chatHistory.length === 0) {
      this.messagesContainer.createEl("p", {
        text: "Start a conversation by asking a question about your vault.",
        cls: "vault-ai-chat-empty",
      });
      return;
    }

    for (let i = 0; i < this.chatHistory.length; i++) {
      const item = this.chatHistory[i];
      const messageDiv = this.messagesContainer.createDiv(
        `vault-ai-chat-message vault-ai-chat-${item.role}`
      );
      messageDiv.setAttribute("data-message-index", i.toString());

      // Add special styling for DarkWeb investigations
      if (item.jobId) {
        messageDiv.addClass("vault-ai-darkweb-message");
        if (item.status === "processing") {
          messageDiv.addClass("vault-ai-darkweb-processing");
        } else if (item.status === "completed") {
          messageDiv.addClass("vault-ai-darkweb-completed");
        } else if (item.status === "failed") {
          messageDiv.addClass("vault-ai-darkweb-failed");
        }
      }

      const roleLabel = messageDiv.createEl("strong", {
        text: item.role === "user" ? "You: " : "AI: ",
      });

      const contentDiv = messageDiv.createDiv("vault-ai-chat-content");

      // Render content as Markdown for rich formatting
      // Use MarkdownRenderer to properly render headings, lists, bold, italic, links, code blocks, etc.
      await MarkdownRenderer.render(
        this.app,
        item.content,
        contentDiv,
        "", // sourcePath - empty string for non-file content
        this // component for lifecycle management
      );

      // Show progress bar and intermediate results for report generation
      if (item.role === "assistant" && item.progress && typeof item.progress === "object" && "percent" in item.progress) {
        const progressContainer = messageDiv.createDiv("vault-ai-progress-container");
        const progressBar = progressContainer.createDiv("vault-ai-progress-bar");
        progressBar.style.width = `${item.progress.percent}%`;
        const progressText = progressContainer.createEl("span", {
          cls: "vault-ai-progress-text",
          text: `${item.progress.message || "Processing..."} (${item.progress.percent}%)`,
        });
      }

      // Show intermediate results for report generation
      if (item.role === "assistant" && item.intermediateResults && item.intermediateResults.length > 0) {
        const resultsContainer = messageDiv.createDiv("vault-ai-intermediate-results-container");
        resultsContainer.createEl("strong", { text: "Intermediate results:" });
        const resultsList = resultsContainer.createEl("ul", { cls: "vault-ai-intermediate-results" });
        item.intermediateResults.forEach((result) => {
          resultsList.createEl("li", { text: result });
        });
      }

      // Show matching notes for assistant responses
      if (item.role === "assistant" && item.notes && item.notes.length > 0) {
        const notesDiv = messageDiv.createDiv("vault-ai-chat-notes");
        notesDiv.createEl("small", { text: "Referenced notes:" });

        for (const note of item.notes) {
          const noteLink = notesDiv.createEl("a", {
            text: note.path,
            cls: "vault-ai-note-link",
          });
          noteLink.addEventListener("click", async (e) => {
            e.preventDefault();
            const file = this.app.vault.getAbstractFileByPath(note.path);
            if (file instanceof TFile) {
              await this.app.workspace.getLeaf().openFile(file);
            }
          });
        }
      }

      // Show created entities with clickable graph view links
      if (item.role === "assistant" && item.createdEntities && item.createdEntities.length > 0) {
        const entitiesDiv = messageDiv.createDiv("vault-ai-created-entities");
        entitiesDiv.style.cssText = `
          margin-top: 10px;
          padding: 10px;
          background: var(--background-secondary);
          border-radius: 6px;
          border-left: 3px solid var(--interactive-accent);
        `;

        for (const entity of item.createdEntities) {
          const entityRow = entitiesDiv.createDiv("vault-ai-entity-row");
          entityRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
            flex-wrap: wrap;
          `;

          // Entity type badge
          const typeBadge = entityRow.createEl("span", {
            text: entity.type,
            cls: "vault-ai-entity-type-badge",
          });
          typeBadge.style.cssText = `
            background: var(--interactive-accent);
            color: var(--text-on-accent);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
          `;

          // Entity label
          const labelSpan = entityRow.createEl("span", {
            text: entity.label,
            cls: "vault-ai-entity-label",
          });
          labelSpan.style.cssText = `
            font-weight: 500;
            flex: 1;
            min-width: 100px;
          `;

          // Open Note button
          const noteBtn = entityRow.createEl("button", {
            text: "📄 Note",
            cls: "vault-ai-entity-note-btn",
          });
          noteBtn.style.cssText = `
            padding: 3px 8px;
            font-size: 11px;
            background: var(--background-modifier-border);
            border: none;
            border-radius: 4px;
            cursor: pointer;
          `;
          noteBtn.title = "Open entity note";
          noteBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            const file = this.app.vault.getAbstractFileByPath(entity.filePath);
            if (file instanceof TFile) {
              await this.app.workspace.getLeaf().openFile(file);
            }
          });

          // Open in Graph View button
          const graphBtn = entityRow.createEl("button", {
            text: "🔗 Graph",
            cls: "vault-ai-entity-graph-btn",
          });
          graphBtn.style.cssText = `
            padding: 3px 8px;
            font-size: 11px;
            background: var(--interactive-accent);
            color: var(--text-on-accent);
            border: none;
            border-radius: 4px;
            cursor: pointer;
          `;
          graphBtn.title = "View in Graph";
          graphBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            await this.plugin.openGraphViewWithEntity(entity.id);
          });
        }

        // Add hint text
        const hintText = entitiesDiv.createEl("small", {
          text: "Click 'Graph' to view entity in the graph, or 'Note' to open its file.",
          cls: "vault-ai-entity-hint",
        });
        hintText.style.cssText = `
          display: block;
          margin-top: 8px;
          color: var(--text-muted);
          font-style: italic;
        `;
      }

      // Show "Open Report" button for report generation messages
      if (item.role === "assistant" && item.reportFilePath) {
        const reportButtonContainer = messageDiv.createDiv("vault-ai-report-button-container");
        reportButtonContainer.style.cssText = `
          margin-top: 12px;
          padding: 10px;
          background: var(--background-secondary);
          border-radius: 6px;
          border-left: 3px solid var(--interactive-accent);
        `;

        const reportButton = reportButtonContainer.createEl("button", {
          text: "📄 Open Report",
          cls: "vault-ai-open-report-btn",
        });
        reportButton.style.cssText = `
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 500;
          background: var(--interactive-accent);
          color: var(--text-on-accent);
          border: none;
          border-radius: 4px;
          cursor: pointer;
          transition: opacity 0.2s;
        `;
        reportButton.title = `Open report: ${item.reportFilePath}`;

        // Add hover effect
        reportButton.addEventListener("mouseenter", () => {
          reportButton.style.opacity = "0.8";
        });
        reportButton.addEventListener("mouseleave", () => {
          reportButton.style.opacity = "1";
        });

        // Add click handler to open the report
        reportButton.addEventListener("click", async (e) => {
          e.preventDefault();
          const file = this.app.vault.getAbstractFileByPath(item.reportFilePath!);
          if (file instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(file);
            new Notice(`Opened report: ${item.reportFilePath}`);
          } else {
            new Notice(`Report file not found: ${item.reportFilePath}`);
          }
        });

        // Add file path label below button
        const filePathLabel = reportButtonContainer.createEl("small", {
          text: `File: ${item.reportFilePath}`,
          cls: "vault-ai-report-path-label",
        });
        filePathLabel.style.cssText = `
          display: block;
          margin-top: 6px;
          color: var(--text-muted);
          font-style: italic;
          font-size: 11px;
        `;
      }
    }

    // Scroll to bottom
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  updateProgressBar(messageIndex: number, progress?: { message: string; percent: number }, intermediateResults?: string[]) {
    // Find the message element by data attribute
    const messageDiv = this.messagesContainer.querySelector(
      `.vault-ai-chat-message[data-message-index="${messageIndex}"]`
    ) as HTMLElement;
    
    if (!messageDiv) return;

    // Use progress from parameter, or fallback to saved progress in chatHistory
    const currentProgress = progress || 
      (messageIndex < this.chatHistory.length && 
       this.chatHistory[messageIndex].progress && 
       typeof this.chatHistory[messageIndex].progress === "object" && 
       "percent" in this.chatHistory[messageIndex].progress
        ? this.chatHistory[messageIndex].progress as { message: string; percent: number }
        : undefined);

    // Find or create progress container FIRST (before updating content)
    let progressContainer = messageDiv.querySelector(".vault-ai-progress-container") as HTMLElement;
    
    if (currentProgress) {
      if (!progressContainer) {
        // Create progress container if it doesn't exist - insert after contentDiv
        const contentDiv = messageDiv.querySelector(".vault-ai-chat-content") as HTMLElement;
        if (contentDiv) {
          progressContainer = document.createElement("div");
          progressContainer.className = "vault-ai-progress-container";
          // Insert after contentDiv using insertAdjacentElement
          contentDiv.insertAdjacentElement("afterend", progressContainer);
        } else {
          progressContainer = messageDiv.createDiv("vault-ai-progress-container");
        }
      } else {
        // Clear existing content but keep the container
        progressContainer.empty();
      }

      // Create progress bar
      const progressBar = progressContainer.createDiv("vault-ai-progress-bar");
      progressBar.style.width = `${currentProgress.percent}%`;
      
      // Create progress text
      const progressText = progressContainer.createEl("span", {
        cls: "vault-ai-progress-text",
        text: `${currentProgress.message || "Processing..."} (${currentProgress.percent}%)`,
      });
    }
    // Don't remove progress container if progress is not available - keep the last known progress

    // Update content AFTER progress bar is set up (so it doesn't interfere)
    // Only update if content actually changed to avoid unnecessary DOM manipulation
    if (messageIndex < this.chatHistory.length) {
      const contentDiv = messageDiv.querySelector(".vault-ai-chat-content") as HTMLElement;
      if (contentDiv) {
        const newContent = this.chatHistory[messageIndex].content;
        // Only update if content changed
        if (contentDiv.textContent !== newContent) {
          // Update content - textContent should not affect sibling elements
          contentDiv.textContent = newContent;
        }
      }
    }

    // Use intermediate results from parameter, or fallback to saved results in chatHistory
    const currentIntermediateResults = intermediateResults || 
      (messageIndex < this.chatHistory.length && 
       this.chatHistory[messageIndex].intermediateResults && 
       this.chatHistory[messageIndex].intermediateResults!.length > 0
        ? this.chatHistory[messageIndex].intermediateResults!
        : undefined);

    // Update intermediate results
    let resultsContainer = messageDiv.querySelector(".vault-ai-intermediate-results-container") as HTMLElement;
    
    if (currentIntermediateResults && currentIntermediateResults.length > 0) {
      if (!resultsContainer) {
        // Create results container if it doesn't exist
        resultsContainer = messageDiv.createDiv("vault-ai-intermediate-results-container");
      } else {
        // Clear existing content
        resultsContainer.empty();
      }

      resultsContainer.createEl("strong", { text: "Intermediate results:" });
      const resultsList = resultsContainer.createEl("ul", { cls: "vault-ai-intermediate-results" });
      currentIntermediateResults.forEach((result) => {
        resultsList.createEl("li", { text: result });
      });
    }
    // Don't remove results container if no new results - keep the last known results

    // Scroll to bottom
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  async handleSend() {
    const query = this.inputEl.value.trim();
    if (!query) {
      new Notice("Please enter a question.");
      return;
    }

    if (!this.plugin.isAuthenticated()) {
      new Notice("License key required for AI features. Please configure your license key in settings.");
      return;
    }

    // Add user message
    this.chatHistory.push({
      role: "user",
      content: query,
    });

    // Clear input
    this.inputEl.value = "";

    // Save conversation after user message
    await this.saveCurrentConversation();

    // Route to appropriate handler based on mode
    if (this.isEntityOnlyMode()) {
      // Entity-Only Mode: Extract entities from user input without AI chat
      await this.handleEntityOnlyMode(query);
    } else if (this.darkWebMode) {
      await this.handleDarkWebInvestigation(query);
    } else if (this.reportGenerationMode) {
      await this.handleReportGeneration(query);
    } else {
      // Default: Lookup Mode (normal chat)
      await this.handleNormalChat(query);
    }

    // Save conversation after assistant response
    await this.saveCurrentConversation();
  }

  /**
   * Handle Entity-Only Mode: Extract entities from user input text without sending to AI.
   * This mode is active when entityGenerationMode is ON and all main modes are OFF.
   */
  async handleEntityOnlyMode(inputText: string) {
    // Add processing placeholder with progress bar
    const messageIndex = this.chatHistory.length;
    this.chatHistory.push({
      role: "assistant",
      content: "🏷️ Extracting entities from your text...",
      progress: { message: "Analyzing text...", percent: 10 },
    });
    this.renderMessages();

    // Helper to update progress
    const updateProgress = (message: string, percent: number) => {
      this.chatHistory[messageIndex].progress = { message, percent };
      this.chatHistory[messageIndex].content = `🏷️ ${message}`;
      this.updateProgressBar(messageIndex, { message, percent });
    };

    try {
      // Get existing entities to avoid duplicates
      const existingEntities = this.plugin.entityManager.getAllEntities();
      updateProgress("Checking existing entities...", 20);

      // Retry callback to show status to user during entity extraction
      const onRetry = (attempt: number, maxAttempts: number, reason: string, nextDelayMs: number) => {
        const delaySeconds = Math.round(nextDelayMs / 1000);
        let reasonText = 'Network interrupted';
        if (reason === 'timeout') {
          reasonText = 'Request timed out';
        } else if (reason === 'network') {
          reasonText = 'Network connection lost';
        } else if (reason.startsWith('server-error')) {
          reasonText = 'Server temporarily unavailable';
        } else if (reason === 'rate-limited') {
          reasonText = 'Rate limited';
        }
        updateProgress(`⚠️ ${reasonText}. Retrying in ${delaySeconds}s... (${attempt + 1}/${maxAttempts})`, 25);
      };

      updateProgress("Sending text to AI for entity extraction...", 30);

      // Call the API to extract entities from the user's input with retry callback
      const result: ProcessTextResponse = await this.plugin.graphApiService.processText(
        inputText,
        existingEntities,
        undefined,
        onRetry
      );

      updateProgress("Processing API response...", 50);

      if (!result.success) {
        this.chatHistory[messageIndex].progress = undefined; // Clear progress bar
        this.chatHistory[messageIndex].content =
          `🏷️ **Entity Extraction Failed**\n\n` +
          `**Input:** ${inputText.substring(0, 100)}${inputText.length > 100 ? '...' : ''}\n\n` +
          `**Error:** ${result.error || 'Unknown error'}`;
        this.renderMessages();
        return;
      }

      if (!result.operations || result.operations.length === 0) {
        this.chatHistory[messageIndex].progress = undefined; // Clear progress bar
        this.chatHistory[messageIndex].content =
          `🏷️ **Entity Extraction Complete**\n\n` +
          `**Input:** ${inputText.substring(0, 200)}${inputText.length > 200 ? '...' : ''}\n\n` +
          `No entities detected in the provided text.`;
        this.renderMessages();
        return;
      }

      // Count total entities to create for progress tracking
      let totalEntities = 0;
      for (const op of result.operations) {
        if (op.action === "create" && op.entities) {
          totalEntities += op.entities.length;
        }
      }

      updateProgress(`Found ${totalEntities} entities to create...`, 55);

      // Process the operations and create entities
      const createdEntities: Array<{ id: string; type: string; label: string; filePath: string }> = [];
      let connectionsCreated = 0;
      let entitiesProcessed = 0;

      // Debug: Log the full operations array
      console.log('[EntityOnlyMode] Processing operations:', JSON.stringify(result.operations, null, 2));

      for (const operation of result.operations) {
        // Debug: Log each operation
        console.log('[EntityOnlyMode] Processing operation:', {
          action: operation.action,
          hasEntities: !!operation.entities,
          entitiesCount: operation.entities?.length || 0,
          hasConnections: !!operation.connections,
          connectionsCount: operation.connections?.length || 0
        });

        // Track entities by their index in this operation for connection processing
        const operationEntities: Array<Entity | null> = [];

        if (operation.action === "create" && operation.entities) {
          for (const entityData of operation.entities) {
            entitiesProcessed++;
            // Calculate progress: 55% to 90% for entity creation
            const entityProgress = 55 + Math.round((entitiesProcessed / totalEntities) * 35);
            updateProgress(`Creating entity ${entitiesProcessed}/${totalEntities}...`, entityProgress);

            // Debug: Log entity data
            console.log('[EntityOnlyMode] Processing entity:', {
              type: entityData.type,
              properties: entityData.properties
            });

            try {
              const entityType = entityData.type as EntityType;
              // Validate entity type
              if (!Object.values(EntityType).includes(entityType)) {
                console.warn(`[EntityOnlyMode] Unknown entity type: ${entityData.type}. Valid types:`, Object.values(EntityType));
                operationEntities.push(null);
                continue;
              }

              console.log('[EntityOnlyMode] Creating entity with type:', entityType);
              const entity = await this.plugin.entityManager.createEntity(
                entityType,
                entityData.properties
              );
              console.log('[EntityOnlyMode] Entity created successfully:', {
                id: entity.id,
                type: entity.type,
                label: entity.label,
                filePath: entity.filePath
              });
              operationEntities.push(entity);
              createdEntities.push({
                id: entity.id,
                type: entity.type,
                label: entity.label,
                filePath: entity.filePath || ''
              });
            } catch (entityError) {
              console.error('[EntityOnlyMode] Failed to create entity:', entityError);
              operationEntities.push(null);
            }
          }

          // Process connections after all entities in this operation are created
          if (operation.connections && operation.connections.length > 0) {
            updateProgress("Creating relationships...", 92);
            for (const conn of operation.connections) {
              try {
                const fromEntity = operationEntities[conn.from];
                const toEntity = operationEntities[conn.to];

                if (fromEntity && toEntity) {
                  // Add directed relationship from source to target entity only
                  await this.plugin.entityManager.addRelationshipToNote(
                    fromEntity,
                    toEntity,
                    conn.relationship
                  );
                  connectionsCreated++;
                }
              } catch (connError) {
                console.error('[EntityOnlyMode] Failed to create connection:', connError);
              }
            }
          }
        }
      }

      updateProgress("Finalizing...", 98);

      // Build the result message with clickable links
      let resultContent = `🏷️ **Entity Extraction Complete**\n\n`;
      resultContent += `**Input:** ${inputText.substring(0, 200)}${inputText.length > 200 ? '...' : ''}\n\n`;

      if (createdEntities.length > 0) {
        // Store entities in chat history for rendering clickable graph view links
        this.chatHistory[messageIndex].createdEntities = createdEntities;
        this.chatHistory[messageIndex].connectionsCreated = connectionsCreated;

        resultContent += `**Entities Created (${createdEntities.length}):**`;
        if (connectionsCreated > 0) {
          resultContent += `\n**Relationships Created:** ${connectionsCreated}`;
        }
      } else {
        resultContent += `No new entities were created (may already exist or types not recognized).`;
      }

      // Clear progress bar and show final result
      this.chatHistory[messageIndex].progress = undefined;
      this.chatHistory[messageIndex].content = resultContent;
      this.renderMessages();

      if (createdEntities.length > 0) {
        const noticeMsg = connectionsCreated > 0
          ? `Created ${createdEntities.length} entities and ${connectionsCreated} relationships`
          : `Created ${createdEntities.length} entities`;
        new Notice(noticeMsg);
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.chatHistory[messageIndex].progress = undefined; // Clear progress bar on error
      this.chatHistory[messageIndex].content =
        `🏷️ **Entity Extraction Failed**\n\n` +
        `**Input:** ${inputText.substring(0, 100)}${inputText.length > 100 ? '...' : ''}\n\n` +
        `**Error:** ${errorMsg}`;
      this.renderMessages();
      new Notice(`Entity extraction failed: ${errorMsg}`);
    }
  }

  async handleNormalChat(query: string) {
    // Add thinking placeholder with progress bar
    this.chatHistory.push({
      role: "assistant",
      content: "Analyzing query...",
      progress: { message: "Analyzing query...", percent: 10 },
    });
    const assistantIndex = this.chatHistory.length - 1;
    this.renderMessages();

    // Helper to update progress
    const updateProgress = (message: string, percent: number) => {
      this.chatHistory[assistantIndex].progress = { message, percent };
      this.updateProgressBar(assistantIndex, { message, percent });
    };

    // Helper to get the last assistant content element for incremental updates
    const getLastAssistantContentEl = (): HTMLDivElement | null => {
      const els = this.messagesContainer.querySelectorAll(
        ".vault-ai-chat-message.vault-ai-chat-assistant .vault-ai-chat-content"
      );
      if (els.length === 0) return null;
      return els[els.length - 1] as HTMLDivElement;
    };

    // Track the base status text for retry updates
    let baseStatusText = "";

    try {
      updateProgress("Extracting entity from query...", 15);

      // 1) Extract entity (name + type) via LLM
      const extracted = await this.plugin.extractEntityFromQuery(query);
      const entityMsg =
        extracted.type === "unknown"
          ? "Entity defined. Starting lookup."
          : extracted.name
          ? `Entity defined (${extracted.type}: ${extracted.name}). Starting lookup.`
          : `Entity defined (${extracted.type}). Starting lookup.`;
      this.chatHistory[assistantIndex].content = entityMsg;
      updateProgress("Entity extracted, searching vault...", 30);

      // 2) Local lookup using extracted entity name if available
      const searchTerm = extracted.name && extracted.name.length > 0 ? extracted.name : query;
      const notes = this.plugin.retrieveNotes(searchTerm);
      if (notes.length === 0) {
        this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar
        this.chatHistory[assistantIndex].content =
          entityMsg + "\n\nNo relevant notes found.";
        this.chatHistory[assistantIndex].notes = [];
        this.renderMessages();
        return;
      }

      updateProgress(`Found ${notes.length} notes, preparing context...`, 45);

      // Update with process messages (English)
      baseStatusText =
        entityMsg +
        `\n\nFound ${notes.length} relevant notes. Selecting key excerpts...\nDrafting the answer...\n\n`;
      this.chatHistory[assistantIndex].content = baseStatusText;
      this.chatHistory[assistantIndex].notes = notes;
      this.renderMessages();

      updateProgress("Generating response...", 55);

      // 3) Stream model answer over the prepared context
      const contentEl = getLastAssistantContentEl();
      let streamed = "";
      let streamProgress = 55;

      // Retry callback to show status to user
      const onRetry = (attempt: number, maxAttempts: number) => {
        updateProgress(`Network interrupted. Retrying... (${attempt}/${maxAttempts})`, streamProgress);
        this.chatHistory[assistantIndex].content = baseStatusText + `⚠️ Network interrupted. Retrying... (${attempt}/${maxAttempts})`;
        this.renderMessages();
        // Reset streamed content for retry
        streamed = "";
      };

      const { fullAnswer, notes: finalNotes } = await this.plugin.askVaultStream(
        searchTerm,
        (delta: string) => {
          streamed += delta;
          // Update progress during streaming (55% to 90%)
          streamProgress = Math.min(90, 55 + Math.round((streamed.length / 2000) * 35));
          updateProgress("Generating response...", streamProgress);
          if (contentEl) {
            contentEl.textContent = baseStatusText + streamed;
            // Keep scroll at bottom during stream
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
          } else {
            // Fallback: update history and re-render
            this.chatHistory[assistantIndex].content = baseStatusText + streamed;
            this.renderMessages();
          }
        },
        notes,
        onRetry
      );

      updateProgress("Finalizing response...", 95);

      // Finalize message and attach notes - clear progress bar
      let finalContent = baseStatusText + fullAnswer;
      this.chatHistory[assistantIndex].content = finalContent;
      this.chatHistory[assistantIndex].notes = finalNotes;
      this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar
      this.renderMessages();

      // Entity Generation Mode: Extract and create entities from the AI response
      if (this.entityGenerationMode) {
        await this.processEntityGeneration(assistantIndex, fullAnswer, query, finalContent);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar on error
      this.chatHistory[assistantIndex].content = `Error: ${errorMsg}\n\n💡 Tip: Your message was saved. You can try sending it again.`;
      this.renderMessages();

      // Restore the query to the input field so user can retry
      this.inputEl.value = query;
    }
  }

  /**
   * Process entity generation from AI response text.
   * Calls the /api/process-text endpoint to extract entities and creates them via EntityManager.
   */
  async processEntityGeneration(
    assistantIndex: number,
    aiResponse: string,
    originalQuery: string,
    currentContent: string
  ) {
    // Helper to update progress
    const updateProgress = (message: string, percent: number) => {
      this.chatHistory[assistantIndex].progress = { message, percent };
      this.updateProgressBar(assistantIndex, { message, percent });
    };

    try {
      // Update status to show entity extraction is in progress
      updateProgress("Extracting entities from response...", 10);
      let statusText = currentContent + "\n\n🏷️ Extracting entities...";
      this.chatHistory[assistantIndex].content = statusText;
      this.renderMessages();

      // Use explicit entity extraction instruction to ensure AI returns operations, not analysis
      const textToProcess = `Extract all entities (people, companies, locations, events) and their relationships from the following content. Create entities for each person, company, location, and event mentioned. Return JSON operations to create entities, do NOT provide analysis or summary.\n\nOriginal Query: ${originalQuery}\n\nContent to extract entities from:\n${aiResponse}`;

      // Get existing entities to avoid duplicates
      const existingEntities = this.plugin.entityManager.getAllEntities();

      // Retry callback to show status to user during entity extraction
      const onRetry = (attempt: number, maxAttempts: number, reason: string, nextDelayMs: number) => {
        const delaySeconds = Math.round(nextDelayMs / 1000);
        let reasonText = 'Network interrupted';
        if (reason === 'timeout') {
          reasonText = 'Request timed out';
        } else if (reason === 'network') {
          reasonText = 'Network connection lost';
        } else if (reason.startsWith('server-error')) {
          reasonText = 'Server temporarily unavailable';
        } else if (reason === 'rate-limited') {
          reasonText = 'Rate limited';
        }
        const retryMsg = `\n\n⚠️ ${reasonText}. Retrying in ${delaySeconds}s... (attempt ${attempt + 1}/${maxAttempts})`;
        this.chatHistory[assistantIndex].content = currentContent + retryMsg;
        this.renderMessages();
      };

      updateProgress("Sending to AI for entity extraction...", 25);

      // Call the API to extract entities with retry callback
      const result: ProcessTextResponse = await this.plugin.graphApiService.processText(
        textToProcess,
        existingEntities,
        undefined,
        onRetry
      );

      updateProgress("Processing extraction results...", 40);

      if (!result.success) {
        this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar
        this.chatHistory[assistantIndex].content = currentContent +
          `\n\n⚠️ Entity extraction failed: ${result.error || 'Unknown error'}`;
        this.renderMessages();
        return;
      }

      if (!result.operations || result.operations.length === 0) {
        this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar
        this.chatHistory[assistantIndex].content = currentContent +
          "\n\n🏷️ No new entities detected in the response.";
        this.renderMessages();
        return;
      }

      updateProgress("Creating entities...", 50);

      // Process the operations and create entities
      // Store entity info with file paths and IDs for clickable links
      const createdEntities: Array<{ id: string; type: string; label: string; filePath: string }> = [];
      let connectionsCreated = 0;

      // Count total entities for progress tracking
      let totalEntities = 0;
      for (const op of result.operations) {
        if (op.action === "create" && op.entities) {
          totalEntities += op.entities.length;
        }
      }
      let processedEntities = 0;

      // Debug: Log the full operations array
      console.log('[EntityGeneration] Processing operations:', JSON.stringify(result.operations, null, 2));

      for (const operation of result.operations) {
        // Debug: Log each operation
        console.log('[EntityGeneration] Processing operation:', {
          action: operation.action,
          hasEntities: !!operation.entities,
          entitiesCount: operation.entities?.length || 0,
          hasConnections: !!operation.connections,
          connectionsCount: operation.connections?.length || 0
        });

        // Track entities by their index in this operation for connection processing
        const operationEntities: Array<Entity | null> = [];

        if (operation.action === "create" && operation.entities) {
          for (const entityData of operation.entities) {
            processedEntities++;
            // Update progress (50% to 85% range for entity creation)
            const entityProgress = 50 + Math.round((processedEntities / Math.max(totalEntities, 1)) * 35);
            updateProgress(`Creating entity ${processedEntities}/${totalEntities}...`, entityProgress);

            // Debug: Log entity data
            console.log('[EntityGeneration] Processing entity:', {
              type: entityData.type,
              properties: entityData.properties
            });

            try {
              const entityType = entityData.type as EntityType;
              // Validate entity type
              if (!Object.values(EntityType).includes(entityType)) {
                console.warn(`[EntityGeneration] Unknown entity type: ${entityData.type}. Valid types:`, Object.values(EntityType));
                operationEntities.push(null);
                continue;
              }

              console.log('[EntityGeneration] Creating entity with type:', entityType);
              const entity = await this.plugin.entityManager.createEntity(
                entityType,
                entityData.properties
              );
              console.log('[EntityGeneration] Entity created successfully:', {
                id: entity.id,
                type: entity.type,
                label: entity.label,
                filePath: entity.filePath
              });
              operationEntities.push(entity);
              createdEntities.push({
                id: entity.id,
                type: entity.type,
                label: entity.label,
                filePath: entity.filePath || ''
              });
            } catch (entityError) {
              console.error('[EntityGeneration] Failed to create entity:', entityError);
              operationEntities.push(null);
            }
          }

          // Process connections after all entities in this operation are created
          if (operation.connections && operation.connections.length > 0) {
            updateProgress("Creating relationships...", 88);
            for (const conn of operation.connections) {
              try {
                const fromEntity = operationEntities[conn.from];
                const toEntity = operationEntities[conn.to];

                if (fromEntity && toEntity) {
                  // Add directed relationship from source to target entity only
                  await this.plugin.entityManager.addRelationshipToNote(
                    fromEntity,
                    toEntity,
                    conn.relationship
                  );
                  connectionsCreated++;
                }
              } catch (connError) {
                console.error('[EntityGeneration] Failed to create connection:', connError);
              }
            }
          }
        }
      }

      updateProgress("Finalizing...", 95);

      // Update the message with entity creation results including clickable links
      if (createdEntities.length > 0) {
        // Store entities in chat history for rendering clickable graph view links
        this.chatHistory[assistantIndex].createdEntities = createdEntities;
        this.chatHistory[assistantIndex].connectionsCreated = connectionsCreated;

        // Build a simple summary message - the actual clickable links will be rendered by renderMessages
        let resultMsg = `\n\n🏷️ **Entities Created (${createdEntities.length}):**`;
        if (connectionsCreated > 0) {
          resultMsg += `\n**Relationships Created:** ${connectionsCreated}`;
        }

        this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar
        this.chatHistory[assistantIndex].content = currentContent + resultMsg;

        // Refresh or open graph view after entity creation
        await this.plugin.refreshOrOpenGraphView();
      } else {
        this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar
        this.chatHistory[assistantIndex].content = currentContent +
          "\n\n🏷️ No new entities were created (entities may already exist).";
      }
      this.renderMessages();

    } catch (error) {
      console.error('[EntityGeneration] Error during entity generation:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar on error
      this.chatHistory[assistantIndex].content = currentContent +
        `\n\n⚠️ Entity generation error: ${errorMsg}`;
      this.renderMessages();
    }
  }

  async handleReportGeneration(description: string) {
    // Add status placeholder
    const messageIndex = this.chatHistory.length;
    this.chatHistory.push({
      role: "assistant",
      content: "📄 Starting report generation...",
    });
    this.renderMessages();

    try {
      // Generate report with status updates, progress, and intermediate results
      // Pass current conversation so it can use and update reportConversationId
      const reportData = await this.plugin.generateReport(
        description,
        this.currentConversation,
        (status: string, progress?: { message: string; percent: number }, intermediateResults?: string[]) => {
          // Build status message with progress and intermediate results
          let statusMessage = `📄 ${status}`;
          
          if (progress) {
            statusMessage = `📄 ${progress.message}`;
          }
          
          // Update the processing message in real-time
          this.chatHistory[messageIndex].content = statusMessage;
          
          // Store progress and intermediate results for rendering (preserve if not provided)
          if (progress) {
            this.chatHistory[messageIndex].progress = progress;
          }
          // Don't clear progress if not provided - keep the last known progress
          
          if (intermediateResults && intermediateResults.length > 0) {
            this.chatHistory[messageIndex].intermediateResults = intermediateResults;
          }
          // Don't clear intermediate results if not provided - keep the last known results
          
          // Always update progress bar - it will use saved progress if new one is not provided
          this.updateProgressBar(messageIndex, progress, intermediateResults);
        }
      );

      // Save to vault
      const fileName = await this.plugin.saveReportToVault(
        reportData.content,
        description,
        reportData.filename
      );
      
      // ✅ IMPORTANT: Save conversation after report generation to persist reportConversationId
      // The conversation.reportConversationId was updated in generateReport() if server returned one
      if (this.currentConversation) {
        await this.saveCurrentConversation();
      }

      // Update message with success header, file link, and full report content
      let finalContent =
        `📄 **Report Generated Successfully!**\n\n` +
        `**Request:** ${description}\n\n` +
        `**Saved to:** \`${fileName}\`\n\n` +
        `---\n\n` +
        reportData.content;
      this.chatHistory[messageIndex].content = finalContent;
      this.chatHistory[messageIndex].reportFilePath = fileName; // Store report file path for button
      this.renderMessages();

      // Entity Generation Mode: Extract and create entities from the report
      if (this.entityGenerationMode) {
        await this.processEntityGeneration(messageIndex, reportData.content, description, finalContent);
      }

      // Open the report file
      const file = this.app.vault.getAbstractFileByPath(fileName);
      if (file instanceof TFile) {
        await this.app.workspace.getLeaf().openFile(file);
      }

      new Notice(`Report saved to ${fileName}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Provide user-friendly error messages for common issues
      let userMessage = errorMsg;
      let suggestion = "";

      if (errorMsg.toLowerCase().includes("ssl") || errorMsg.toLowerCase().includes("certificate")) {
        userMessage = "Backend service temporarily unavailable (SSL/certificate issue)";
        suggestion = "\n\n💡 **Suggestion:** This is a temporary server-side issue. Please try again in a few minutes.";
      } else if (errorMsg.toLowerCase().includes("timeout")) {
        userMessage = "Report generation timed out";
        suggestion = "\n\n💡 **Suggestion:** The server may be busy. Please try again with a simpler query.";
      } else if (errorMsg.toLowerCase().includes("quota")) {
        suggestion = "\n\n💡 **Suggestion:** Visit https://osint-copilot.com/dashboard/ to check your quota.";
      } else if (errorMsg.toLowerCase().includes("network") || errorMsg.toLowerCase().includes("fetch")) {
        userMessage = "Network connection error";
        suggestion = "\n\n💡 **Suggestion:** Check your internet connection and try again.";
      } else if (errorMsg.toLowerCase().includes("n8n") || errorMsg.toLowerCase().includes("workflow")) {
        userMessage = "Backend workflow error";
        suggestion = "\n\n💡 **Suggestion:** This is a temporary server-side issue. Please try again in a few minutes.";
      }

      this.chatHistory[messageIndex].content =
        `📄 **Report Generation Failed**\n\n` +
        `**Request:** ${description}\n\n` +
        `**Error:** ${userMessage}${suggestion}`;
      this.renderMessages();
      new Notice(`Report generation failed: ${userMessage}`);
    }
  }

  async handleDarkWebInvestigation(query: string) {
    // Add status placeholder with progress bar
    const messageIndex = this.chatHistory.length;
    this.chatHistory.push({
      role: "assistant",
      content: "🕵️ Starting dark web investigation...",
      status: "starting",
      progress: { message: "Initializing investigation...", percent: 5 },
    });
    this.renderMessages();

    // Helper to update progress
    const updateProgress = (message: string, percent: number) => {
      this.chatHistory[messageIndex].progress = { message, percent };
      this.updateProgressBar(messageIndex, { message, percent });
    };

    const maxRetries = 3;
    const baseDelayMs = 1000;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        updateProgress("Connecting to dark web API...", 10);

        // Start DarkWeb investigation
        const endpoint = `${REPORT_API_BASE_URL}/api/darkweb/investigate`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.plugin.settings.reportApiKey}`,
          },
          body: JSON.stringify({
            query: query,
            model: DARKWEB_MODEL,
            threads: 8,
          }),
          mode: "cors",
          credentials: "omit",
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");

          // Handle quota exhaustion specifically - don't retry these
          if (response.status === 403) {
            const lowerError = errorText.toLowerCase();
            if (lowerError.includes("quota") || lowerError.includes("exceeded")) {
              throw new Error(
                "Investigation quota exhausted. Please upgrade your plan or wait for quota renewal. Visit https://osint-copilot.com/dashboard/ to manage your subscription."
              );
            }
            if (lowerError.includes("expired")) {
              throw new Error(
                "Your license key or trial has expired. Please renew your subscription at https://osint-copilot.com/dashboard/"
              );
            }
            if (lowerError.includes("inactive")) {
              throw new Error(
                "Your license key is inactive. Please check your account status at https://osint-copilot.com/dashboard/"
              );
            }
          }

          throw new Error(`DarkWeb API request failed (${response.status}): ${errorText.substring(0, 200)}`);
        }

        updateProgress("Processing API response...", 15);
        const result = await response.json();
        const jobId = result.job_id;

        if (!jobId) {
          throw new Error("No job ID returned from DarkWeb API");
        }

        updateProgress("Investigation started, searching dark web engines...", 20);
        console.log(`[OSINT Copilot] Dark web investigation started with Job ID: ${jobId}`);

        // Update message and start polling (Job ID stored internally but not shown to user)
        this.chatHistory[messageIndex] = {
          role: "assistant",
          content: `🕵️ Dark web investigation started\n\n**Query:** ${query}\n**Status:** Processing\n**Estimated time:** 2-3 minutes\n\nSearching 15+ dark web engines...`,
          jobId: jobId,
          status: "processing",
          query: query, // Store query for later use when saving report
          progress: { message: "Searching dark web engines...", percent: 20 },
        };
        this.renderMessages();

        // Start polling for status (pass query for report saving)
        this.pollDarkWebStatus(jobId, messageIndex, query);
        return; // Success, exit the retry loop

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Only retry on transient network errors
        if (!this.plugin.isTransientNetworkError(lastError)) {
          break;
        }

        // Don't retry on the last attempt
        if (attempt < maxRetries) {
          const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
          console.log(`[OSINT Copilot] DarkWeb API network error, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})`);

          updateProgress(`Network error. Retrying... (${attempt}/${maxRetries})`, 8);
          // Show retry status to user
          this.chatHistory[messageIndex] = {
            role: "assistant",
            content: `🕵️ Starting dark web investigation...\n\n⚠️ Network interrupted. Retrying... (${attempt}/${maxRetries})`,
            status: "starting",
          };
          this.renderMessages();

          await this.plugin.sleep(delayMs);
        }
      }
    }

    // All retries exhausted or non-retryable error
    const errorMsg = lastError ? lastError.message : "Unknown error";
    const isNetworkError = lastError && this.plugin.isTransientNetworkError(lastError);

    this.chatHistory[messageIndex] = {
      role: "assistant",
      content: `❌ Error starting dark web investigation: ${isNetworkError ? "Network connection error. Please check your internet connection and try again." : errorMsg}\n\n💡 Tip: Your query was saved. You can try sending it again.`,
      status: "failed",
    };
    this.renderMessages();

    // Restore the query to the input field so user can retry
    this.inputEl.value = query;
  }

  pollDarkWebStatus(jobId: string, messageIndex: number, query: string) {
    // Clear any existing polling for this job
    const existingTimeoutId = this.pollingIntervals.get(jobId);
    if (existingTimeoutId) {
      window.clearTimeout(existingTimeoutId);
    }

    // Track elapsed time for adaptive polling
    let elapsedMs = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    // Adaptive polling: start fast (3s), gradually increase to max (8s) as job takes longer
    const getPollingInterval = (elapsed: number): number => {
      if (elapsed < 20000) return 3000;      // First 20s: poll every 3s (fast feedback)
      if (elapsed < 60000) return 5000;      // 20s-60s: poll every 5s
      return 8000;                            // After 60s: poll every 8s (reduce load)
    };

    const poll = async () => {
      try {
        const endpoint = `${REPORT_API_BASE_URL}/api/darkweb/status/${jobId}`;
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.plugin.settings.reportApiKey}`,
          },
          mode: "cors",
          credentials: "omit",
        });

        if (!response.ok) {
          throw new Error(`Status check failed (${response.status})`);
        }

        const statusData = await response.json();
        const status = statusData.status;

        // Reset error counter on success
        consecutiveErrors = 0;

        // Update message with progress
        if (status === "processing (up to 5 mins)") {
          const progress = statusData.progress || {};
          const percentComplete = progress.percent_complete || 0;
          const currentStep = progress.current_step || "Processing...";
          const enginesSearched = progress.engines_searched || 0;
          const resultsFound = progress.results_found || 0;

          // Map API progress to our progress bar format (20-90% range for processing)
          const displayPercent = 20 + Math.round(percentComplete * 0.7);
          const progressMessage = `${currentStep} (${enginesSearched} engines, ${resultsFound} results)`;

          this.chatHistory[messageIndex] = {
            role: "assistant",
            content: `🕵️ Dark web investigation in progress\n\n**Status:** ${currentStep}\n**Progress:** ${percentComplete}%\n**Engines searched:** ${enginesSearched}\n**Results found:** ${resultsFound}\n\nPlease wait...`,
            jobId: jobId, // Keep Job ID internally for API calls
            status: "processing",
            progress: { message: progressMessage, percent: displayPercent },
            query: query,
          };
          this.updateProgressBar(messageIndex, { message: progressMessage, percent: displayPercent });

          // Schedule next poll with adaptive interval
          const nextInterval = getPollingInterval(elapsedMs);
          elapsedMs += nextInterval;
          const timeoutId = window.setTimeout(poll, nextInterval);
          this.pollingIntervals.set(jobId, timeoutId);
        } else if (status === "completed") {
          // Stop polling
          this.pollingIntervals.delete(jobId);

          // Update progress to show fetching results
          this.chatHistory[messageIndex].progress = { message: "Fetching results...", percent: 92 };
          this.updateProgressBar(messageIndex, { message: "Fetching results...", percent: 92 });

          // Fetch the summary and save to vault
          await this.fetchDarkWebResults(jobId, messageIndex, query);
        } else if (status === "failed") {
          // Stop polling
          this.pollingIntervals.delete(jobId);

          console.error(`[OSINT Copilot] Dark web investigation failed. Job ID: ${jobId}, Error: ${statusData.error || "Unknown error"}`);
          this.chatHistory[messageIndex] = {
            role: "assistant",
            content: `❌ Dark web investigation failed\n\n**Error:** ${statusData.error || "Unknown error"}\n\nPlease try again or contact support if the issue persists.`,
            jobId: jobId, // Keep Job ID internally for debugging
            status: "failed",
            progress: undefined, // Clear progress bar on failure
          };
          this.renderMessages();
        }
      } catch (error) {
        consecutiveErrors++;
        console.error(`Error polling DarkWeb status (${consecutiveErrors}/${maxConsecutiveErrors}):`, error);

        // Continue polling unless too many consecutive errors
        if (consecutiveErrors < maxConsecutiveErrors) {
          const nextInterval = getPollingInterval(elapsedMs);
          elapsedMs += nextInterval;
          const timeoutId = window.setTimeout(poll, nextInterval);
          this.pollingIntervals.set(jobId, timeoutId);
        } else {
          // Too many errors, stop polling and show error
          this.pollingIntervals.delete(jobId);
          this.chatHistory[messageIndex] = {
            role: "assistant",
            content: `❌ Dark web investigation status check failed\n\n**Error:** Network connection lost after ${maxConsecutiveErrors} attempts.\n\nPlease check your connection and try again.`,
            jobId: jobId,
            status: "failed",
            progress: undefined,
          };
          this.renderMessages();
        }
      }
    };

    // Start first poll after initial interval
    const initialInterval = getPollingInterval(0);
    elapsedMs = initialInterval;
    const timeoutId = window.setTimeout(poll, initialInterval);
    this.pollingIntervals.set(jobId, timeoutId);
  }

  async fetchDarkWebResults(jobId: string, messageIndex: number, query: string) {
    try {
      const endpoint = `${REPORT_API_BASE_URL}/api/darkweb/summary/${jobId}`;
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.plugin.settings.reportApiKey}`,
        },
        mode: "cors",
        credentials: "omit",
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch results (${response.status})`);
      }

      const summary = await response.json();
      console.log(`[OSINT Copilot] Dark web investigation completed. Job ID: ${jobId}`);

      // Format the results as markdown for both display and saving
      let reportContent = `# Dark Web Investigation: ${query}\n\n`;

      if (summary.summary) {
        reportContent += `## Summary\n\n${summary.summary}\n\n`;
      }

      if (summary.findings && summary.findings.length > 0) {
        reportContent += `## Key Findings (${summary.findings.length})\n\n`;
        summary.findings.forEach((finding: any, index: number) => {
          reportContent += `### ${index + 1}. ${finding.title || "Finding"}\n\n`;
          if (finding.url) reportContent += `**URL:** ${finding.url}\n\n`;
          if (finding.snippet) reportContent += `${finding.snippet}\n\n`;
        });
      }

      // Save to vault
      let savedFileName = "";
      try {
        savedFileName = await this.plugin.saveDarkWebReportToVault(reportContent, query, jobId);
        new Notice(`Dark web report saved to ${savedFileName}`);
      } catch (saveError) {
        console.error("Error saving dark web report to vault:", saveError);
        // Continue even if save fails - still show results in chat
      }

      // Format display text with file link if saved (no Job ID shown to user)
      let displayText = `✅ Dark web investigation completed\n\n`;
      displayText += `**Query:** ${query}\n`;
      if (savedFileName) {
        displayText += `**Saved to:** \`${savedFileName}\`\n`;
      }
      displayText += `\n---\n\n`;
      displayText += reportContent;

      // Clear progress bar and show final result
      this.chatHistory[messageIndex] = {
        role: "assistant",
        content: displayText,
        jobId: jobId,
        status: "completed",
        query: query,
        progress: undefined, // Clear progress bar on completion
        reportFilePath: savedFileName || undefined, // Store report file path for button
      };
      this.renderMessages();

      // Entity Generation Mode: Extract and create entities from the dark web results
      if (this.entityGenerationMode) {
        await this.processEntityGeneration(messageIndex, reportContent, query, displayText);
      }

      // Open the saved file if it exists
      if (savedFileName) {
        const file = this.app.vault.getAbstractFileByPath(savedFileName);
        if (file instanceof TFile) {
          await this.app.workspace.getLeaf().openFile(file);
        }
      }

      new Notice("Dark web investigation completed!");

    } catch (error) {
      console.error(`[OSINT Copilot] Failed to fetch dark web results. Job ID: ${jobId}, Error:`, error);
      this.chatHistory[messageIndex] = {
        role: "assistant",
        content: `⚠️ Investigation completed but failed to fetch results\n\n**Query:** ${query}\n**Error:** ${error instanceof Error ? error.message : String(error)}\n\nPlease try again or contact support if the issue persists.`,
        jobId: jobId, // Keep Job ID internally for debugging
        status: "completed",
        query: query,
      };
      this.renderMessages();
    }
  }

  async onClose() {
    // Cleanup polling timeouts (using setTimeout for adaptive polling)
    for (const timeoutId of this.pollingIntervals.values()) {
      window.clearTimeout(timeoutId);
    }
    this.pollingIntervals.clear();
  }
}

// ============================================================================
// SETTINGS TAB
// ============================================================================

class VaultAISettingTab extends PluginSettingTab {
  plugin: VaultAIPlugin;

  constructor(app: App, plugin: VaultAIPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "OSINT Copilot Settings" });

    // Max Notes
    new Setting(containerEl)
      .setName("Max Notes")
      .setDesc("Maximum number of notes to include in context")
      .addText((text) =>
        text
          .setPlaceholder("15")
          .setValue(String(this.plugin.settings.maxNotes))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.maxNotes = num;
              await this.plugin.saveSettings();
            }
          })
      );

    // System Prompt
    new Setting(containerEl)
      .setName("System Prompt")
      .setDesc("Default system prompt for Q&A")
      .addTextArea((text) => {
        text
          .setPlaceholder("You are a vault assistant...")
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.style.width = "100%";
      });

    containerEl.createEl("h3", { text: "Backend API Settings" });

    // Dashboard Link
    const dashboardSetting = new Setting(containerEl)
      .setName("Account Dashboard")
      .setDesc("View your API usage, quota, and manage your subscription");

    dashboardSetting.controlEl.createEl("a", {
      text: "Open Dashboard →",
      href: "https://osint-copilot.com/dashboard/",
      cls: "external-link",
    }).style.cssText = "color: var(--interactive-accent); text-decoration: none; font-weight: 500;";

    // License Key
    new Setting(containerEl)
      .setName("License Key")
      .setDesc("License key for all operations (chat, reports, and investigations)")
      .addText((text) => {
        text
          .setPlaceholder("Enter your license key")
          .setValue(this.plugin.settings.reportApiKey)
          .onChange(async (value) => {
            this.plugin.settings.reportApiKey = value;
            await this.plugin.saveSettings();
            // Refresh license key info when key changes
            this.refreshApiInfo();
          });
        text.inputEl.type = "password";
      });

    // License Key Info Display (if key is configured)
    if (this.plugin.settings.reportApiKey) {
      const apiInfoContainer = containerEl.createDiv("api-info-container");
      apiInfoContainer.style.cssText = "margin: 10px 0; padding: 15px; background: var(--background-secondary); border-radius: 5px;";

      const loadingEl = apiInfoContainer.createEl("p", {
        text: "Loading license key information...",
        cls: "setting-item-description",
      });

      // Fetch license key info
      this.fetchApiKeyInfo().then((info) => {
        loadingEl.remove();

        if (info) {
          const infoGrid = apiInfoContainer.createDiv();
          infoGrid.style.cssText = "display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.9em;";

          // Plan
          const planDiv = infoGrid.createDiv();
          planDiv.createEl("strong", { text: "Plan: " });
          planDiv.createSpan({ text: info.plan || "No Plan" });

          // Quota
          const quotaDiv = infoGrid.createDiv();
          quotaDiv.createEl("strong", { text: "Remaining Quota: " });
          const quotaSpan = quotaDiv.createSpan({ text: `${info.remaining_quota} reports` });
          if (info.remaining_quota <= 0) {
            quotaSpan.style.color = "var(--text-error)";
            quotaSpan.style.fontWeight = "bold";
          } else if (info.remaining_quota <= 5) {
            quotaSpan.style.color = "var(--text-warning)";
          }

          // Status
          const statusDiv = infoGrid.createDiv();
          statusDiv.createEl("strong", { text: "Status: " });
          const statusSpan = statusDiv.createSpan({
            text: info.active ? "Active" : "Inactive"
          });
          statusSpan.style.color = info.active ? "var(--text-success)" : "var(--text-error)";

          // Expiry
          const expiryDiv = infoGrid.createDiv();
          expiryDiv.createEl("strong", { text: "Expires: " });
          const expiryDate = new Date(info.expires_at);
          expiryDiv.createSpan({ text: expiryDate.toLocaleDateString() });

          // Trial badge
          if (info.is_trial) {
            const trialBadge = apiInfoContainer.createEl("p", {
              text: "🎁 Trial Account",
              cls: "setting-item-description",
            });
            trialBadge.style.cssText = "margin-top: 10px; color: var(--text-warning); font-weight: 500;";
          }

          // Quota exhaustion warning
          if (info.remaining_quota <= 0) {
            const quotaWarning = apiInfoContainer.createDiv();
            quotaWarning.style.cssText = "margin-top: 15px; padding: 12px; background: var(--background-modifier-error); border-radius: 5px; border-left: 4px solid var(--text-error);";
            quotaWarning.createEl("p", {
              text: "⚠️ Quota Exhausted",
            }).style.cssText = "margin: 0 0 8px 0; font-weight: bold; color: var(--text-error);";
            quotaWarning.createEl("p", {
              text: "You have no remaining report credits. Dark web investigations and report generation are unavailable until you upgrade or your quota renews.",
            }).style.cssText = "margin: 0 0 10px 0; font-size: 0.9em;";
            const upgradeLink = quotaWarning.createEl("a", {
              text: "Upgrade your plan →",
              href: "https://osint-copilot.com/dashboard/",
            });
            upgradeLink.style.cssText = "color: var(--interactive-accent); font-weight: 500; text-decoration: none;";
          } else if (info.remaining_quota <= 5) {
            const lowQuotaWarning = apiInfoContainer.createDiv();
            lowQuotaWarning.style.cssText = "margin-top: 15px; padding: 10px; background: var(--background-modifier-warning); border-radius: 5px;";
            lowQuotaWarning.createEl("p", {
              text: `⚠️ Low quota: Only ${info.remaining_quota} report credits remaining.`,
            }).style.cssText = "margin: 0; font-size: 0.9em; color: var(--text-warning);";
          }
        } else {
          apiInfoContainer.createEl("p", {
            text: "⚠️ Could not load license key information. Please check your license key.",
            cls: "setting-item-description",
          }).style.color = "var(--text-error)";
        }
      }).catch(() => {
        loadingEl.remove();
        apiInfoContainer.createEl("p", {
          text: "⚠️ Failed to connect to API. Please check your internet connection.",
          cls: "setting-item-description",
        }).style.color = "var(--text-error)";
      });
    }

    // Report Output Directory
    new Setting(containerEl)
      .setName("Report Output Directory")
      .setDesc("Directory where generated reports will be saved")
      .addText((text) =>
        text
          .setPlaceholder("Reports")
          .setValue(this.plugin.settings.reportOutputDir)
          .onChange(async (value) => {
            this.plugin.settings.reportOutputDir = value;
            await this.plugin.saveSettings();
          })
      );

    // Conversation Folder
    new Setting(containerEl)
      .setName("Conversation History Folder")
      .setDesc("Directory where chat conversations will be saved")
      .addText((text) =>
        text
          .setPlaceholder(".osint-copilot/conversations")
          .setValue(this.plugin.settings.conversationFolder)
          .onChange(async (value) => {
            this.plugin.settings.conversationFolder = value;
            this.plugin.conversationService.setBasePath(value);
            await this.plugin.saveSettings();
            await this.plugin.conversationService.initialize();
          })
      );

    containerEl.createEl("p", {
      text: "ℹ️ Note: AI entity generation requires an active API connection. All other features (manual entity creation, editing, connections, map view) work locally without the API.",
      cls: "setting-item-description",
    }).style.color = "var(--text-muted)";

    containerEl.createEl("h3", { text: "Graph View Settings" });

    // Auto-refresh graph view
    new Setting(containerEl)
      .setName("Auto-refresh Graph View")
      .setDesc("Automatically refresh the graph view when new entities are created through AI generation")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoRefreshGraph)
          .onChange(async (value) => {
            this.plugin.settings.autoRefreshGraph = value;
            await this.plugin.saveSettings();
          })
      );

    // Auto-open graph view
    new Setting(containerEl)
      .setName("Auto-open Graph View")
      .setDesc("Automatically open the graph view when entities are created (if not already open)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoOpenGraphOnEntityCreation)
          .onChange(async (value) => {
            this.plugin.settings.autoOpenGraphOnEntityCreation = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "General Settings" });

  }

  async fetchApiKeyInfo(): Promise<any> {
    if (!this.plugin.settings.reportApiKey) {
      return null;
    }

    try {
      const response = await fetch("https://api.osint-copilot.com/api/key/info", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.plugin.settings.reportApiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to fetch license key info:", error);
      return null;
    }
  }

  async refreshApiInfo() {
    // Trigger a re-render of the settings tab to show updated API info
    this.display();
  }
}

