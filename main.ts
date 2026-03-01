
import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  Menu,
  requestUrl,
  RequestUrlResponse,
  CachedMetadata,
  Component,
  ButtonComponent,
} from "obsidian";

interface ApiKeyInfo {
  plan?: string;
  remaining_quota?: number;
  remaining_credits?: number;
  active?: boolean;
  expires_at?: string;
  is_trial?: boolean;
  permissions?: {
    allow_web_access: boolean;
    allow_plugin_access: boolean;
    allow_chat_view: boolean;
    allow_graph_automation: boolean;
    allow_custom_chat_config: boolean;
    allow_local_agent: boolean;
  };
}

// Graph plugin imports
import { EntityType, Entity, Connection, ENTITY_CONFIGS, AIOperation, ProcessTextResponse, validateEntityName } from './src/entities/types';
import { EntityManager } from './src/services/entity-manager';
import { GraphApiService, AISearchRequest, AISearchResponse, DetectedEntity } from './src/services/api-service';
import { ConversationService, Conversation, ConversationMetadata, ConversationMessage } from './src/services/conversation-service';
import { GraphView, GRAPH_VIEW_TYPE } from './src/views/graph-view';
import { TimelineView, TIMELINE_VIEW_TYPE } from './src/views/timeline-view';
import { MapView, MAP_VIEW_TYPE } from './src/views/map-view';
import { ConfirmModal } from './src/modals/confirm-modal';
import { CustomTypesService } from './src/services/custom-types-service';

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
  // Custom API settings
  apiProvider: 'default' | 'openai'; // Kept for backward compat, though now unused for custom chat
  customCheckpoints: CustomCheckpoint[];
  permissions?: {
    allow_web_access: boolean;
    allow_plugin_access: boolean;
    allow_chat_view: boolean;
    allow_graph_automation: boolean;
    allow_custom_chat_config: boolean;
    allow_local_agent: boolean;
  };
}

export interface CustomCheckpoint {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  model: string;
  type?: 'openai' | 'mindsdb';
}

// Default models - hardcoded, not user-configurable
// Chat API uses Perplexity's sonar-pro model
const CHAT_MODEL = "gpt-4o-mini";
// Entity extraction uses OpenAI for better JSON parsing
const ENTITY_EXTRACTION_MODEL = "gpt-4o-mini";
// DarkWeb dark web API uses gpt-5-mini for best results with dark web content
const DARKWEB_MODEL = "gpt-5-mini";

export interface IndexedNote {
  path: string;
  content: string;
  tags: string[];
  links: string[];
  frontmatter?: Record<string, unknown>;
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
  // Custom API defaults
  apiProvider: 'default',
  customCheckpoints: []
};

const REPORT_API_BASE_URL = "https://api.osint-copilot.com";
// const REPORT_API_BASE_URL = "http://localhost:8000";

export const CHAT_VIEW_TYPE = "vault-ai-chat-view";

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
  customTypesService!: CustomTypesService;

  async onload() {
    await this.loadSettings();

    // Check license key on load
    // Check license key on load
    if (!this.settings.reportApiKey) {
      new Notice("Osint copilot: license key required for AI features. Visualization features (graph, timeline, map) are free. Configure in settings.");
    } else {
      // Verify permissions on load
      this.verifyPermissions();
    }

    // Initialize custom types service (load schemas before entity manager)
    this.customTypesService = new CustomTypesService(this.app);
    await this.customTypesService.initialize();

    // Initialize graph plugin components
    this.entityManager = new EntityManager(this.app, this.settings.entityBasePath);
    this.graphApiService = new GraphApiService(
      this.settings.graphApiUrl,
      this.settings.reportApiKey
    );
    // Pass custom API settings
    // Pass custom API settings
    this.graphApiService.setSettings({
      apiProvider: 'default',
      customApiUrl: '',
      customApiKey: '',
      customModel: ''
    });

    // Initialize conversation service
    this.conversationService = new ConversationService(this.app, this.settings.conversationFolder);
    try {
      await this.conversationService.initialize();
      console.debug('OSINTCopilot: Conversation service initialized');
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
        console.debug('OSINTCopilot: Local entity storage initialized');
      } catch (error) {
        // Log but don't block - entity manager can still work for basic operations
        console.warn('OSINTCopilot: Entity storage initialization had issues:', error);
      }

      // Check API health in background (non-blocking)
      // This sets the online status for the API service
      this.graphApiService.checkHealth().then(health => {
        if (health) {
          console.debug('OSINTCopilot: Graph API connected', health);
        } else {
          console.debug('OSINTCopilot: Graph API unavailable - running in local-only mode');
        }
      }).catch(error => {
        // Silently handle connection errors - API is optional
        console.debug('OSINTCopilot: Graph API unavailable - running in local-only mode');
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
        console.debug('[VaultAIPlugin] Creating GraphView instance');
        if (!this.settings.enableGraphFeatures) {
          console.warn('[VaultAIPlugin] Graph features are disabled in settings');
        }
        return new GraphView(
          leaf,
          this.entityManager,
          (entityId) => this.onEntityClick(entityId),
          (entityId) => { void this.showEntityOnMap(entityId); }
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
    // Ctrl/Cmd+click opens a new instance in a split pane for side-by-side viewing
    const chatRibbon = this.addRibbonIcon("message-square", "OSINT Copilot chat (Ctrl+click for new pane)", (evt: MouseEvent) => {
      const forceNew = evt.ctrlKey || evt.metaKey;
      void this.openChatView(forceNew);
    });

    // Graph features icons (Entity Graph, Timeline, Map) - shown when graph features are enabled
    if (this.settings.enableGraphFeatures) {
      const graphRibbon = this.addRibbonIcon("git-fork", "Entity graph (Ctrl+click for new pane)", (evt: MouseEvent) => {
        const forceNew = evt.ctrlKey || evt.metaKey;
        void this.openGraphView(forceNew);
      });

      const timelineRibbon = this.addRibbonIcon("calendar", "Timeline (Ctrl+click for new pane)", (evt: MouseEvent) => {
        const forceNew = evt.ctrlKey || evt.metaKey;
        void this.openTimelineView(forceNew);
      });

      const mapRibbon = this.addRibbonIcon("map-pin", "Location map (Ctrl+click for new pane)", (evt: MouseEvent) => {
        const forceNew = evt.ctrlKey || evt.metaKey;
        void this.openMapView(forceNew);
      });
    }

    // Build initial index
    await this.buildIndex();

    // Register file watchers
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          void this.indexFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) {
          void this.indexFile(file);
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
      name: "Open chat",
      callback: () => { void this.openChatView(); },
    });

    this.addCommand({
      id: "open-chat-view-new-pane",
      name: "Open chat in new pane",
      callback: () => { void this.openChatView(true); },
    });

    this.addCommand({
      id: "open-graph-view",
      name: "Open entity graph",
      callback: () => { void this.openGraphView(); },
    });

    this.addCommand({
      id: "open-graph-view-new-pane",
      name: "Open entity graph in new pane",
      callback: () => { void this.openGraphView(true); },
    });

    this.addCommand({
      id: "open-timeline-view",
      name: "Open timeline",
      callback: () => { void this.openTimelineView(); },
    });

    this.addCommand({
      id: "open-timeline-view-new-pane",
      name: "Open timeline in new pane",
      callback: () => { void this.openTimelineView(true); },
    });

    this.addCommand({
      id: "open-map-view",
      name: "Open location map",
      callback: () => { void this.openMapView(); },
    });

    this.addCommand({
      id: "open-map-view-new-pane",
      name: "Open location map in new pane",
      callback: () => { void this.openMapView(true); },
    });

    // Utility commands
    this.addCommand({
      id: "ask-vault",
      name: "Ask (remote)",
      callback: () => {
        if (this.settings.permissions && this.settings.permissions.allow_plugin_access === false) {
          new Notice("Your plan does not include plugin access.");
          return;
        }
        this.openAskModal();
      },
    });

    this.addCommand({
      id: "reindex-vault",
      name: "Reindex vault",
      callback: () => {
        if (this.settings.permissions && this.settings.permissions.allow_plugin_access === false) {
          new Notice("Your plan does not include plugin access.");
          return;
        }
        void this.buildIndex().then(() => {
          new Notice("Vault reindexed successfully.");
        });
      },
    });

    this.addCommand({
      id: "reload-entities",
      name: "Reload entities from notes",
      callback: () => {
        if (this.settings.permissions && this.settings.permissions.allow_plugin_access === false) {
          new Notice("Your plan does not include plugin access.");
          return;
        }
        void this.entityManager.loadEntitiesFromNotes().then(() => {
          new Notice("Entities reloaded from notes.");
        });
      },
    });

    // Add settings tab
    this.addSettingTab(new VaultAISettingTab(this.app, this));
  }

  onunload() {



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
      this.graphApiService.setSettings({
        apiProvider: 'default', // Backward compat defaults
        customApiUrl: '',
        customApiKey: '',
        customModel: ''
      });
    }
    if (this.entityManager) {
      this.entityManager.setBasePath(this.settings.entityBasePath);
    }

    // Refresh all chat views to update mode dropdowns
    this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof ChatView) {
        leaf.view.refresh();
      }
    });
  }

  isAuthenticated(): boolean {
    // AI features require a valid license key
    return !!this.settings.reportApiKey;
  }

  async verifyPermissions() {
    if (!this.settings.reportApiKey) return;

    try {
      const response = await requestUrl({
        url: `${REPORT_API_BASE_URL}/api/key/info`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.settings.reportApiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 200) {
        const data = response.json as ApiKeyInfo;
        if (data.permissions) {
          this.settings.permissions = data.permissions;
          await this.saveData(this.settings);
          console.debug('OSINTCopilot: Permissions updated', this.settings.permissions);
        }
      }
    } catch (error) {
      console.warn('OSINTCopilot: Failed to verify permissions', error);
    }
  }

  // ============================================================================
  // GRAPH VIEW METHODS
  // ============================================================================

  /**
   * Get or create a leaf in the main editor area for OSINT views.
   * This replaces note editors and uses the main workspace area.
   * @param viewType The view type to check for existing instances
   * @param forceNew If true, creates a new split pane even if one exists
   * @returns A workspace leaf in the main editor area
   */
  private getMainEditorLeaf(viewType: string, forceNew: boolean): WorkspaceLeaf | null {
    // Check for existing OSINT views in the main area
    const osintViewTypes = [GRAPH_VIEW_TYPE, TIMELINE_VIEW_TYPE, MAP_VIEW_TYPE, CHAT_VIEW_TYPE];

    // Find all leaves in the main editor area (not sidebars)
    const mainLeaves: WorkspaceLeaf[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      // Check if leaf is in the main editor area (root split)
      const root = leaf.getRoot();
      if (root === this.app.workspace.rootSplit) {
        mainLeaves.push(leaf);
      }
    });

    // Find existing OSINT views in main area
    const existingOsintLeaves = mainLeaves.filter(leaf =>
      osintViewTypes.includes(leaf.view?.getViewType() || '')
    );

    // Find note editor leaves in main area
    const noteEditorLeaves = mainLeaves.filter(leaf =>
      leaf.view?.getViewType() === 'markdown' || leaf.view?.getViewType() === 'empty'
    );

    // If forceNew and there's an existing OSINT view, split from it
    if (forceNew && existingOsintLeaves.length > 0) {
      return this.app.workspace.createLeafBySplit(existingOsintLeaves[0], 'vertical');
    }

    // If there's a note editor, replace it
    if (noteEditorLeaves.length > 0) {
      return noteEditorLeaves[0];
    }

    // If there's an existing OSINT view and not forcing new, split from it
    if (existingOsintLeaves.length > 0) {
      return this.app.workspace.createLeafBySplit(existingOsintLeaves[0], 'vertical');
    }

    // Otherwise, get a new leaf in the main area
    return this.app.workspace.getLeaf('tab');
  }

  /**
   * Open the Graph View in the main editor area.
   * @param forceNew If true, creates a new instance in a split pane even if one already exists.
   *                 This allows multiple views to be open simultaneously.
   */
  async openGraphView(forceNew: boolean = false) {
    if (this.settings.permissions && this.settings.permissions.allow_graph_automation === false) {
      new Notice("Your plan does not include access to graph automation features. Please upgrade.");
      return;
    }

    if (!this.settings.enableGraphFeatures) {
      new Notice('Graph features are disabled. Enable them in settings → osint copilot → enable graph features', 5000);
      console.warn('[VaultAIPlugin] Attempted to open graph view but graph features are disabled');
      return;
    }

    console.debug('[VaultAIPlugin] Opening graph view, forceNew:', forceNew);
    const existing = this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);

    // If not forcing new and one exists, reveal it
    if (!forceNew && existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return existing[0];
    }

    // Get a leaf in the main editor area
    const leaf = this.getMainEditorLeaf(GRAPH_VIEW_TYPE, forceNew);

    if (leaf) {
      await leaf.setViewState({ type: GRAPH_VIEW_TYPE, active: true });
      void this.app.workspace.revealLeaf(leaf);
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
        console.debug('[OSINT Copilot] Refreshing graph view with new entities...');
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
        console.debug('[OSINT Copilot] Auto-opening graph view with new entities...');
        await this.openGraphView();
        new Notice('Graph view opened with new entities');
      }
    }
  }

  /**
   * Open the Timeline View in the main editor area.
   * @param forceNew If true, creates a new instance in a split pane even if one already exists.
   *                 This allows multiple views to be open simultaneously.
   */
  async openTimelineView(forceNew: boolean = false) {
    const existing = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);

    // If not forcing new and one exists, reveal it
    if (!forceNew && existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    // Get a leaf in the main editor area
    const leaf = this.getMainEditorLeaf(TIMELINE_VIEW_TYPE, forceNew);

    if (leaf) {
      await leaf.setViewState({ type: TIMELINE_VIEW_TYPE, active: true });
      void this.app.workspace.revealLeaf(leaf);
    }
  }

  /**
   * Open the Map View in the main editor area.
   * @param forceNew If true, creates a new instance in a split pane even if one already exists.
   *                 This allows multiple views to be open simultaneously.
   */
  async openMapView(forceNew: boolean = false) {
    const existing = this.app.workspace.getLeavesOfType(MAP_VIEW_TYPE);

    // If not forcing new and one exists, reveal it
    if (!forceNew && existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    // Get a leaf in the main editor area
    const leaf = this.getMainEditorLeaf(MAP_VIEW_TYPE, forceNew);

    if (leaf) {
      await leaf.setViewState({ type: MAP_VIEW_TYPE, active: true });
      void this.app.workspace.revealLeaf(leaf);
    }
  }

  onEntityClick(entityId: string) {
    // Open the entity's note when clicked in graph/timeline/map
    void this.entityManager.openEntityNote(entityId);
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
      new Notice('Only location entities can be shown on the map');
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
          void mapView.refresh();
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

  async callRemoteModel(messages: ChatMessage[], stream: boolean = false, model?: string, signal?: AbortSignal): Promise<string> {
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

      const requestBody: Record<string, unknown> = {
        model: modelToUse,
        messages,
        stream: stream,  // Pass stream flag to endpoint
      };


      // Use Obsidian's requestUrl to bypass CORS restrictions
      const requestPromise = requestUrl({
        url: endpoint,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.reportApiKey}`,
        },
        body: JSON.stringify(requestBody),
        throw: false,
      });

      // Handle cancellation
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const response: RequestUrlResponse = await (signal
        ? Promise.race([
          requestPromise,
          new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          })
        ])
        : requestPromise);

      if (response.status < 200 || response.status >= 300) {
        const errorText = response.text || "";
        console.error("[callRemoteModel] API error:", response.status, errorText);
        throw new Error(
          `API request failed (${response.status}): ${errorText.substring(0, 200)}`
        );
      }

      // requestUrl doesn't support streaming, so always parse as JSON
      const jsonData = response.json;
      const content = jsonData.choices?.[0]?.message?.content ||
        jsonData.choices?.[0]?.text ||
        jsonData.content ||
        "";
      return content || "No answer received.";
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
      'err_network_changed', 'network_changed',
      'connection', 'timeout', 'timed out', 'econnreset',
      'econnrefused', 'enotfound', 'socket', 'dns',
      'abort', 'aborted',
      '502', '503', '504', 'service unavailable', 'temporarily unavailable'
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
   * Note: Obsidian's requestUrl doesn't support streaming, so we use non-streaming
   * and deliver the full response at once via onDelta callback.
   */
  private async executeStreamingFetch(
    endpoint: string,
    messages: ChatMessage[],
    onDelta?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    // Obsidian's requestUrl doesn't support streaming responses,
    // so we fall back to non-streaming and deliver the full response at once
    const full = await this.callRemoteModel(messages, false, undefined, signal);
    if (onDelta) onDelta(full);
    return full;
  }

  async callRemoteModelStream(
    messages: ChatMessage[],
    onDelta?: (text: string) => void,
    onRetry?: (attempt: number, maxAttempts: number) => void,
    signal?: AbortSignal
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
        if (signal?.aborted) {
          throw new Error("Request was cancelled.");
        }
        return await this.executeStreamingFetch(endpoint, messages, onDelta, signal);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Only retry on transient network errors
        if (!this.isTransientNetworkError(lastError)) {
          break;
        }

        // Don't retry on the last attempt
        if (attempt < maxRetries) {
          const delayMs = getRetryDelay(attempt);
          console.debug(`[OSINT Copilot] Network error, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})`);

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
    onRetry?: (attempt: number, maxAttempts: number) => void,
    additionalContext?: string,
    signal?: AbortSignal
  ): Promise<{ fullAnswer: string; notes: IndexedNote[] }> {
    if (!this.isAuthenticated()) {
      throw new Error("License key required for AI features. Please configure your license key in settings.");
    }

    const contextNotes = preloadedNotes ?? this.retrieveNotes(query);

    if (contextNotes.length === 0 && !additionalContext) {
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

    // Append additional context (e.g., Knowledge Graph connections)
    if (additionalContext) {
      contextText += `\n\n${additionalContext}\n\n`;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: this.settings.systemPrompt },
      { role: "user", content: contextText },
    ];

    const fullAnswer = await this.callRemoteModelStream(messages, onDelta, onRetry, signal);

    return { fullAnswer, notes: contextNotes };
  }

  // ============================================================================
  // REPORT GENERATION
  // ============================================================================

  async generateReport(
    description: string,
    currentConversation: Conversation | null,
    statusCallback?: (status: string, progress?: ReportProgress, intermediateResults?: string[]) => void,
    signal?: AbortSignal
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
          const requestBody: Record<string, unknown> = {
            description: description,
            vault_context: "", // Can be extended to include vault context
            force_new_report: true // Always create new reports instead of overwriting
          };

          // Include conversation_id only if we have a saved one
          if (savedConversationId) {
            requestBody.conversation_id = savedConversationId;
            console.debug('[OSINT Copilot] Sending request with existing conversation_id:', savedConversationId);
          } else {
            console.debug('[OSINT Copilot] Sending first request (no conversation_id)');
          }

          const generateResponse: RequestUrlResponse = await requestUrl({
            url: `${baseUrl}/api/generate-report`,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${reportApiKey}`,
            },
            body: JSON.stringify(requestBody),
            throw: false,
          });

          if (generateResponse.status < 200 || generateResponse.status >= 300) {
            const errorText = generateResponse.text || "";

            // Handle quota exhaustion specifically - don't retry these
            if (generateResponse.status === 403) {
              const lowerError = errorText.toLowerCase();
              if (lowerError.includes("quota") || lowerError.includes("exhausted")) {
                throw new Error(
                  "Companies&People quota exhausted. Please upgrade your plan or wait for quota renewal. Visit https://osint-copilot.com/dashboard/ to manage your subscription."
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
              `Companies&People generation request failed (${generateResponse.status}): ${errorText.substring(0, 200)}`
            );
          }

          const generateData = generateResponse.json;
          jobId = generateData.job_id;

          if (!jobId) {
            throw new Error("No job_id received from server");
          }

          // ✅ IMPORTANT: Save conversation_id from server response to current conversation
          // This will be saved to the conversation file when saveConversation() is called
          if (generateData.conversation_id && currentConversation) {
            currentConversation.reportConversationId = generateData.conversation_id;
            console.debug('[OSINT Copilot] Updated conversation with reportConversationId:', generateData.conversation_id);
          }

          break; // Success, exit retry loop
        } catch (initError) {
          const isNetworkError = initError instanceof Error && this.isTransientNetworkError(initError);

          if (isNetworkError && initAttempt < maxInitialRetries) {
            console.debug(`[OSINT Copilot] Companies&People init network error, retrying (${initAttempt}/${maxInitialRetries}):`, initError);
            statusCallback?.(`Network interrupted, retrying... (attempt ${initAttempt}/${maxInitialRetries})`);
            await this.sleep(1000 * initAttempt); // Exponential backoff
          } else {
            throw initError;
          }
        }
      }

      statusCallback?.(`Companies&People generation started (Job ID: ${jobId}). Processing... This might take up to 5 minutes, don't close the tab.`);

      // Step 2: Poll for job status with adaptive polling and retry logic
      let attempts = 0;
      const maxElapsedMs = 20 * 60 * 1000; // 20 minutes max timeout (increased for deep research)
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
        if (signal?.aborted) {
          throw new Error('Cancelled by user');
        }

        const pollInterval = getPollingInterval(elapsedMs);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        elapsedMs += pollInterval;
        attempts++;

        const elapsedSecs = Math.round(elapsedMs / 1000);
        statusCallback?.(`Checking report status... (${elapsedSecs}s elapsed)`);

        try {
          // Use Obsidian's requestUrl to bypass CORS restrictions
          const statusResponse: RequestUrlResponse = await requestUrl({
            url: `${baseUrl}/api/report-status/${jobId}`,
            method: "GET",
            headers: {
              Authorization: `Bearer ${reportApiKey}`,
            },
            throw: false,
          });

          if (statusResponse.status < 200 || statusResponse.status >= 300) {
            throw new Error(`Failed to check job status: ${statusResponse.status}`);
          }

          const statusData = statusResponse.json;
          jobStatus = statusData.status;

          // Reset consecutive error counter on successful fetch
          consecutiveNetworkErrors = 0;

          // Parse and forward progress and intermediate results
          console.debug(`[OSINT Copilot] Polling status for job ${jobId}:`, statusData);
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
            console.error(`[OSINT Copilot] Job ${jobId} failed with error:`, backendError);

            // Check for common backend issues
            if (backendError.toLowerCase().includes("ssl") ||
              backendError.toLowerCase().includes("certificate") ||
              backendError.toLowerCase().includes("n8n")) {
              throw new Error("Backend service temporarily unavailable. Please try again in a few minutes.");
            }

            throw new Error(`Companies&People generation failed: ${backendError}`);
          }
        } catch (pollError) {
          // Check if this is a transient network error
          const isNetworkError = pollError instanceof Error && this.isTransientNetworkError(pollError);

          if (isNetworkError) {
            consecutiveNetworkErrors++;

            // Enhanced logging for network errors
            const errorType = pollError instanceof Error ? pollError.name : 'Unknown';
            const errorMsg = pollError instanceof Error ? pollError.message : String(pollError);
            console.debug(
              `[OSINT Copilot] Companies&People status poll network error (${consecutiveNetworkErrors}/${maxConsecutiveNetworkErrors}):`,
              `Type: ${errorType}, Message: ${errorMsg}`
            );

            if (consecutiveNetworkErrors >= maxConsecutiveNetworkErrors) {
              throw new Error("Network connection lost after multiple retries. Please check your internet connection and try again.");
            }

            // Show retry status to user with more detail
            const retryMsg = `Network interrupted (${errorType}), retrying... (${Math.round(elapsedMs / 1000)}s elapsed, attempt ${consecutiveNetworkErrors}/${maxConsecutiveNetworkErrors})`;
            statusCallback?.(retryMsg);
            console.debug(`[OSINT Copilot] ${retryMsg}`);
            // Continue polling - don't throw
          } else {
            // Non-network error, re-throw immediately
            console.error('[OSINT Copilot] Non-retryable error during status polling:', pollError);
            throw pollError;
          }
        }
      }

      const elapsedSecsTotal = Math.round(elapsedMs / 1000);
      console.info(`[OSINT Copilot] Polling loop finished for job ${jobId}. Final status: ${jobStatus}, Elapsed: ${elapsedSecsTotal}s`);

      // Check if job completed or response is ready (for answers)
      // Note: response_ready case is handled inside the loop and returns early
      if (jobStatus !== "completed") {
        throw new Error("Companies&People generation timed out. Please try again.");
      }

      // Step 3: Download the report with retry logic
      statusCallback?.("Downloading report...");

      let reportContent = "";
      const maxDownloadRetries = 3;

      for (let downloadAttempt = 1; downloadAttempt <= maxDownloadRetries; downloadAttempt++) {
        try {
          const downloadResponse: RequestUrlResponse = await requestUrl({
            url: `${baseUrl}/api/download-report/${jobId}/md`,
            method: "GET",
            headers: {
              Authorization: `Bearer ${reportApiKey}`,
            },
            throw: false,
          });

          if (downloadResponse.status < 200 || downloadResponse.status >= 300) {
            const errorText = downloadResponse.text || "";
            throw new Error(`Failed to download report: ${downloadResponse.status} - ${errorText}`);
          }

          // Get the raw response text
          const rawContent = downloadResponse.text;

          // Check if the response is JSON and extract markdown content if so
          reportContent = this.extractMarkdownFromResponse(rawContent);

          break; // Success, exit retry loop
        } catch (downloadError) {
          const isNetworkError = downloadError instanceof Error && this.isTransientNetworkError(downloadError);

          if (isNetworkError && downloadAttempt < maxDownloadRetries) {
            console.debug(`[OSINT Copilot] Companies&People download network error, retrying (${downloadAttempt}/${maxDownloadRetries}):`, downloadError);
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

      statusCallback?.("Companies&People downloaded successfully!");

      // Sanitize the markdown content
      const sanitizedContent = this.sanitizeMarkdownContent(reportContent);

      return {
        content: sanitizedContent,
        filename: finalReportFilename
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Companies&People generation failed: ${error.message}`);
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
        const response: RequestUrlResponse = await requestUrl({
          url: `${baseUrl}${endpoint}`,
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          throw: false,
        });

        if (response.status >= 200 && response.status < 300) {
          const data = response.json;

          // Try different response structures
          let messages: Record<string, unknown>[] = [];
          if (Array.isArray(data)) {
            messages = data;
          } else if (data.messages && Array.isArray(data.messages)) {
            messages = data.messages;
          } else if (data.conversation && Array.isArray(data.conversation.messages)) {
            messages = data.conversation.messages;
          }

          // Find last assistant message
          const lastAssistantMessage = messages
            .filter((msg: Record<string, unknown>) => msg.role === 'assistant' || msg.role === 'AI')
            .pop();

          if (lastAssistantMessage && lastAssistantMessage.content) {
            return lastAssistantMessage.content as string;
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
  async extractEntitiesFromQuery(query: string): Promise<Array<{
    name: string | null;
    type: "person" | "company" | "asset" | "event" | "location" | "unknown";
  }>> {
    const system =
      "Extract the main entities mentioned in the user's query and classify each as one of: person | company | asset | event | location. Respond ONLY in JSON with a list of objects: [{\"name\":\"<entity name>\",\"type\":\"person|company|asset|event|location|unknown\"}]. If no specific entities are found, return an empty list []. Use English only.";

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: query },
    ];

    try {
      const text = await this.callRemoteModel(messages, false, ENTITY_EXTRACTION_MODEL);

      // Try strict JSON parse
      const match = text.trim();
      let list: any[] = [];
      try {
        list = JSON.parse(match);
      } catch (parseError) {
        // Best-effort: find JSON substring
        const m = match.match(/\[[\s\S]*\]/);
        if (m) {
          try {
            list = JSON.parse(m[0]);
          } catch (e) {
            console.error("[extractEntitiesFromQuery] Regex parse failed:", e);
          }
        }
      }

      if (!Array.isArray(list)) {
        return [];
      }

      const allowed = ["person", "company", "asset", "event", "location", "unknown"];
      return list.map(item => {
        const t = (String(item?.type) || "unknown").toLowerCase();
        const type = allowed.includes(t) ? (t as any) : "unknown";
        const nameVal =
          typeof item?.name === "string" && item.name.trim().length > 0
            ? item.name.trim()
            : null;
        return { name: nameVal, type };
      });
    } catch (error) {
      console.error("[extractEntitiesFromQuery] Error:", error);
      return [];
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
              console.debug(`[OSINT Copilot] Extracted markdown from JSON field: ${field}`);
              return data[field];
            }
          }

          // If no known field found, check for nested 'report' object
          if (data.report && typeof data.report === 'object') {
            for (const field of contentFields) {
              if (data.report[field] && typeof data.report[field] === 'string') {
                console.debug(`[OSINT Copilot] Extracted markdown from JSON field: report.${field}`);
                return data.report[field];
              }
            }
          }

          // Last resort: if there's only one string field, use it
          const stringFields = Object.entries(data).filter(([_, v]) => typeof v === 'string' && v.length > 100);
          if (stringFields.length === 1) {
            console.debug(`[OSINT Copilot] Extracted markdown from single string field: ${stringFields[0][0]}`);
            return stringFields[0][1] as string;
          }

          // If we still can't find markdown, log the structure and return raw
          console.warn('[OSINT Copilot] Could not find markdown content in JSON response. Fields:', Object.keys(data));
        }
      } catch (parseError) {
        // Not valid JSON, treat as plain text
        console.debug('[OSINT Copilot] Response is not valid JSON, treating as plain markdown');
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
    const now = new Date();
    const date = now.toISOString().split("T")[0];
    // Add timestamp (HH-MM-SS) for uniqueness to prevent overwrites
    const timestamp = now.toISOString().split("T")[1].split(".")[0].replace(/:/g, "-");

    // Extract entity name from description for meaningful filename
    // Common patterns: "Tell me about X", "Companies&People on X", "Who is X", "What is X", etc.
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

    // Create filename with timestamp: EntityName_Report_YYYY-MM-DD_HH-MM-SS.md
    // This ensures each report is unique and maintains chronological order
    const baseFilename = sanitizedEntity ? `${sanitizedEntity}_Report` : "Corporate_Report";
    const fileName = `${this.settings.reportOutputDir}/${baseFilename}_${date}_${timestamp}.md`;

    // Ensure Reports folder exists
    const reportsFolder = this.app.vault.getAbstractFileByPath(this.settings.reportOutputDir);
    if (!reportsFolder) {
      await this.app.vault.createFolder(this.settings.reportOutputDir);
    }

    // Add metadata header to the report
    let content = `---\n`;
    content += `report_description: "${description.replace(/"/g, '\\"')}"\n`;
    content += `generated: ${now.toISOString()}\n`;
    content += `source: OpenDossier API\n`;
    content += `---\n\n`;
    content += reportContent;

    // Check if file exists (unlikely with timestamp, but add counter as fallback)
    // This provides an additional safety layer to prevent any potential overwrites
    let finalFileName = fileName;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(finalFileName)) {
      finalFileName = `${this.settings.reportOutputDir}/${baseFilename}_${date}_${timestamp}-${counter}.md`;
      counter++;
    }

    // Create new file - guaranteed to be unique
    await this.app.vault.create(finalFileName, content);

    console.debug(`[OSINT Copilot] Report saved to: ${finalFileName}`);
    return finalFileName;
  }

  async saveDarkWebReportToVault(reportContent: string, query: string, jobId: string): Promise<string> {
    const now = new Date();
    const date = now.toISOString().split("T")[0];
    // Add timestamp (HH-MM-SS) for uniqueness to prevent overwrites
    const timestamp = now.toISOString().split("T")[1].split(".")[0].replace(/:/g, "-");

    // Sanitize query for filename: replace spaces with underscores, remove special chars
    const sanitizedQuery = query
      .substring(0, 50)
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_");

    // Create filename with timestamp: DarkWeb_QueryTopic_YYYY-MM-DD_HH-MM-SS.md
    // This ensures each dark web investigation is unique and maintains chronological order
    const baseFilename = sanitizedQuery ? `DarkWeb_${sanitizedQuery}` : `DarkWeb_Investigation`;
    const fileName = `${this.settings.reportOutputDir}/${baseFilename}_${date}_${timestamp}.md`;

    // Ensure Reports folder exists
    const reportsFolder = this.app.vault.getAbstractFileByPath(this.settings.reportOutputDir);
    if (!reportsFolder) {
      await this.app.vault.createFolder(this.settings.reportOutputDir);
    }

    // Add metadata header to the report
    let content = `---\n`;
    content += `investigation_query: "${query.replace(/"/g, '\\"')}"\n`;
    content += `job_id: "${jobId}"\n`;
    content += `generated: ${now.toISOString()}\n`;
    content += `source: Dark Web Investigation\n`;
    content += `---\n\n`;
    content += reportContent;

    // Check if file exists (unlikely with timestamp, but add counter as fallback)
    // This provides an additional safety layer to prevent any potential overwrites
    let finalFileName = fileName;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(finalFileName)) {
      finalFileName = `${this.settings.reportOutputDir}/${baseFilename}_${date}_${timestamp}-${counter}.md`;
      counter++;
    }

    // Create new file - guaranteed to be unique
    await this.app.vault.create(finalFileName, content);

    console.debug(`[OSINT Copilot] Dark web report saved to: ${finalFileName}`);
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

  /**
   * Open the Chat View in the main editor area.
   * @param forceNew If true, creates a new instance in a split pane even if one already exists.
   *                 This allows multiple views to be open simultaneously.
   */
  async openChatView(forceNew: boolean = false) {
    if (this.settings.permissions && this.settings.permissions.allow_chat_view === false) {
      new Notice("Your plan does not include access to the chat view/local agent. Please upgrade to local agent or plugin own data plan.");
      return;
    }
    // License key validation - Chat feature requires a valid license key
    if (!this.settings.reportApiKey) {
      new Notice("A valid license key is required to use the chat feature. Please purchase a license key to enable this functionality.", 8000);
      // Open settings tab so user can enter their license key
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settingTab = (this.app as any).setting;
      if (settingTab) {
        settingTab.open();
        settingTab.openTabById(this.manifest.id);
      }
      return;
    }

    const existing = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);

    // If not forcing new and one exists, reveal it
    if (!forceNew && existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    // Get a leaf in the main editor area
    const leaf = this.getMainEditorLeaf(CHAT_VIEW_TYPE, forceNew);

    if (leaf) {
      void leaf.setViewState({
        type: CHAT_VIEW_TYPE,
        active: true,
      });
      await this.app.workspace.revealLeaf(leaf);
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

    contentEl.createEl("h2", { text: "Ask your vault" });

    // Query input
    contentEl.createEl("label", { text: "Your question:" });
    this.queryInput = contentEl.createEl("textarea", {
      placeholder: "What would you like to know?",
    });

    // Buttons
    const buttonContainer = contentEl.createDiv();
    const askButton = buttonContainer.createEl("button", { text: "Ask" });
    askButton.addEventListener("click", () => { void this.handleAsk(); });

    const closeButton = buttonContainer.createEl("button", { text: "Close" });
    closeButton.addEventListener("click", () => this.close());

    // Answer container
    this.answerContainer = contentEl.createDiv("vault-ai-answer");
    this.answerContainer.setCssProps({ display: 'none' });

    // Notes list container
    this.notesContainer = contentEl.createDiv("vault-ai-notes-list");
    this.notesContainer.setCssProps({ display: 'none' });
  }

  async handleAsk() {
    const query = this.queryInput.value.trim();
    if (!query) {
      new Notice("Please enter a question.");
      return;
    }

    this.answerContainer.empty();
    this.answerContainer.createEl("p", { text: "Thinking..." });
    this.answerContainer.setCssProps({ display: 'block' });

    try {
      const result = await this.plugin.askVault(query);

      // Display answer
      this.answerContainer.innerHTML = "";
      const answerPre = this.answerContainer.createEl("pre");
      answerPre.setText(result.answer);

      // Copy button
      const copyButton = this.answerContainer.createEl("button", {
        text: "Copy answer",
      });
      copyButton.addEventListener("click", () => {
        void navigator.clipboard.writeText(result.answer);
        new Notice("Answer copied to clipboard.");
      });

      // Display matching notes
      if (result.notes.length > 0) {
        this.notesContainer.innerHTML = "";
        this.notesContainer.createEl("h3", { text: "Matching notes:" });

        for (const note of result.notes) {
          const noteItem = this.notesContainer.createDiv("vault-ai-note-item");
          noteItem.textContent = note.path;
          noteItem.addEventListener("click", () => {
            void (async () => {
              const file = this.app.vault.getAbstractFileByPath(note.path);
              if (file instanceof TFile) {
                await this.app.workspace.getLeaf().openFile(file);
                this.close();
              }
            })();
          });
        }

        this.notesContainer.setCssProps({ display: 'block' });
      }
    } catch (error) {
      this.answerContainer.empty();
      const errorP = this.answerContainer.createEl("p", { text: `Error: ${error instanceof Error ? error.message : String(error)}` });
      errorP.setCssProps({ color: 'var(--text-error)' });
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

    contentEl.createEl("h3", { text: "Rename conversation" });

    const inputContainer = contentEl.createDiv({ cls: "vault-ai-rename-input-container" });
    inputContainer.createEl("label", { text: "New title:" });
    this.inputEl = inputContainer.createEl("input", {
      type: "text",
      value: this.currentTitle,
      cls: "vault-ai-rename-input"
    });
    this.inputEl.setCssProps({
      width: "100%",
      "margin-top": "8px",
      padding: "8px"
    });

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
    buttonContainer.setCssProps({
      "margin-top": "16px",
      display: "flex",
      "justify-content": "flex-end",
      gap: "8px"
    });

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

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
  notes?: IndexedNote[];
  jobId?: string; // For DarkWeb investigations
  status?: string; // For DarkWeb investigation status
  progress?: { message: string, percent: number }; // For DarkWeb investigation progress
  query?: string; // For DarkWeb investigation query (used for saving reports)
  intermediateResults?: string[]; // For report generation intermediate results
  createdEntities?: CreatedEntityInfo[]; // For entity generation - clickable graph view links
  connectionsCreated?: number; // Number of relationships created
  reportFilePath?: string; // For report generation - path to the generated report file
  usedEntities?: { id: string, label: string, type: string }[]; // Pinpointed graph entities
}

export class ChatView extends ItemView {
  plugin: VaultAIPlugin;
  chatHistory: ChatHistoryItem[] = [];
  inputEl!: HTMLTextAreaElement;
  messagesContainer!: HTMLDivElement;
  sidebarContainer!: HTMLDivElement;
  conversationListEl!: HTMLDivElement;
  // Main modes (mutually exclusive - only one can be active, or all can be off for Entity-Only Mode)
  localSearchMode: boolean = false; // Default mode (formerly "lookup mode")
  autoMode: boolean = true; // NEW: The All-in-One Auto Agent mode
  customChatMode: boolean = false; // Custom OpenAI-compatible chat mode
  activeCheckpointId: string | undefined; // Selected custom checkpoint ID
  darkWebMode: boolean = false;
  reportGenerationMode: boolean = false;
  osintSearchMode: boolean = false; // Digital Footprint mode
  // Mode dropdown element (replaces individual toggle checkboxes)
  modeDropdown!: HTMLSelectElement;
  // Digital Footprint options
  osintSearchOptionsVisible: boolean = false;
  osintSearchCountry: 'RU' | 'UA' | 'BY' | 'KZ' = 'RU';
  osintSearchMaxProviders: number = 3;
  osintSearchParallel: boolean = true;
  // Graph generation is independent (can be enabled with any main mode, or alone for Graph only Mode)
  graphGenerationMode: boolean = true;
  graphModificationMode: boolean = false;
  graphQueryMode: boolean = false;
  graphGenerationToggle!: HTMLInputElement;
  entityGenContainer!: HTMLElement;  // Container for the toggle - hidden when Graph mode selected
  pollingIntervals: Map<string, number> = new Map();
  currentConversation: Conversation | null = null;
  sidebarVisible: boolean = true;
  uploadButtonEl!: HTMLElement;
  urlButtonEl!: HTMLElement; // URL extraction button
  dragOverlay!: HTMLElement;
  // Attached files display
  attachmentsContainer!: HTMLElement;
  // Stores attached files - content is extracted only when sending
  attachedFiles: { file: TFile | File; extracted: boolean; content?: string }[] = [];

  // Track active operations for cancellation
  activeAbortControllers: Map<number, AbortController> = new Map();

  constructor(leaf: WorkspaceLeaf, plugin: VaultAIPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Osint copilot";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen() {
    await this.loadMostRecentConversation();
    await this.render();
  }

  async loadMostRecentConversation() {
    const conversation = await this.plugin.conversationService.getMostRecentConversation();
    if (conversation) {
      this.currentConversation = conversation;
      this.chatHistory = this.conversationMessagesToHistory(conversation.messages);
      this.darkWebMode = conversation.darkWebMode || false;
      this.reportGenerationMode = conversation.reportGenerationMode || false;
      this.osintSearchMode = conversation.osintSearchMode || false;
      this.autoMode = conversation.autoMode ?? true; // Default to true for older conversations

      // Check if any main mode is explicitly set in the conversation
      const hasMainMode = conversation.darkWebMode || conversation.reportGenerationMode || conversation.osintSearchMode || conversation.localSearchMode || conversation.autoMode;

      if (hasMainMode) {
        // Use the saved modes
        this.localSearchMode = conversation.localSearchMode || false;
        this.graphGenerationMode = conversation.graphGenerationMode || false;
        this.autoMode = conversation.autoMode ?? false;
      } else {
        // No main mode set - default to Auto mode
        this.localSearchMode = false;
        this.graphGenerationMode = true;
        this.autoMode = true;
      }
    } else {
      // No conversation - default to Auto Mode
      this.localSearchMode = false;
      this.graphGenerationMode = true;
      this.autoMode = true;
    }
  }

  conversationMessagesToHistory(messages: ConversationMessage[]): ChatHistoryItem[] {
    return messages.map(m => ({
      role: m.role,
      content: m.content,
      notes: m.notes as IndexedNote[],
      jobId: m.jobId,
      status: m.status,
      progress: m.progress as { message: string, percent: number } | undefined,
      reportFilePath: m.reportFilePath,
      usedEntities: m.usedEntities
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
      reportFilePath: h.reportFilePath,
      usedEntities: h.usedEntities
    }));
  }

  async saveCurrentConversation() {
    if (!this.currentConversation) {
      this.currentConversation = await this.plugin.conversationService.createConversation(
        this.chatHistory.length > 0 ? this.chatHistory[0].content : undefined,
        this.darkWebMode,
        this.graphGenerationMode,
        this.reportGenerationMode
      );
    }
    this.currentConversation.messages = this.historyToConversationMessages();
    this.currentConversation.localSearchMode = this.localSearchMode;
    this.currentConversation.autoMode = this.autoMode;
    this.currentConversation.darkWebMode = this.darkWebMode;
    this.currentConversation.graphGenerationMode = this.graphGenerationMode;
    this.currentConversation.reportGenerationMode = this.reportGenerationMode;
    this.currentConversation.osintSearchMode = this.osintSearchMode;
    await this.plugin.conversationService.saveConversation(this.currentConversation);
    this.renderConversationList();
  }

  async refresh() {
    await this.render();
  }

  async render() {
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
    toggleSidebarBtn.setText("☰");
    toggleSidebarBtn.title = "Toggle conversation history";
    toggleSidebarBtn.addEventListener("click", () => {
      this.sidebarVisible = !this.sidebarVisible;
      if (this.sidebarVisible) {
        this.sidebarContainer.removeClass("hidden");
      } else {
        this.sidebarContainer.addClass("hidden");
      }
    });

    header.createEl("h3", { text: "Osint copilot" });

    const buttonGroup = header.createDiv("vault-ai-chat-header-buttons");

    // New Chat button
    const newChatBtn = buttonGroup.createEl("button", { text: "New chat", cls: "vault-ai-new-chat-btn" });
    newChatBtn.addEventListener("click", () => {
      void this.startNewConversation();
    });

    // === Main Mode Selection Dropdown (Mutually Exclusive - can be "none" for Graph only Mode) ===
    const modeSelectContainer = buttonGroup.createDiv("vault-ai-mode-select-container");
    modeSelectContainer.setAttribute("title", "Select a mode, or choose 'graph generation' for entity extraction without AI chat");

    const modeLabel = modeSelectContainer.createEl("label", {
      text: "Mode:",
      cls: "vault-ai-mode-select-label",
    });
    modeLabel.htmlFor = "vault-ai-mode-dropdown";

    this.modeDropdown = modeSelectContainer.createEl("select", {
      cls: "vault-ai-mode-dropdown",
    });
    this.modeDropdown.id = "vault-ai-mode-dropdown";

    // Add mode options
    // Add mode options
    const modeOptions: { value: string; label: string; mode: string; checkpointId?: string }[] = [];

    // Add custom checkpoints dynamically
    this.plugin.settings.customCheckpoints.forEach((cp) => {
      modeOptions.push({
        value: `custom-${cp.id}`,
        label: `💬 ${cp.name}`,
        mode: "customChatMode",
        checkpointId: cp.id,
      });
    });

    // Validate activeCheckpointId - if it doesn't exist anymore, reset it
    if (this.activeCheckpointId && !this.plugin.settings.customCheckpoints.find(c => c.id === this.activeCheckpointId)) {
      this.activeCheckpointId = undefined;
      // If we were in custom mode, either switch to first available or disable custom mode
      if (this.customChatMode) {
        if (this.plugin.settings.customCheckpoints.length > 0) {
          this.activeCheckpointId = this.plugin.settings.customCheckpoints[0].id;
        } else {
          this.customChatMode = false;
          this.localSearchMode = true; // Fallback to local search
        }
      }
    }

    // Add standard options
    modeOptions.push(
      { value: "auto", label: "✨ Auto (All-in-One)", mode: "autoMode" },
      { value: "none", label: "🏷️ Graph Generation", mode: "none" },
      { value: "local", label: "🔍 Local Search", mode: "localSearchMode" },
      { value: "darkweb", label: "🕵️ Dark Web", mode: "darkWebMode" },
      { value: "report", label: "📄 Companies&People", mode: "reportGenerationMode" },
      { value: "osint", label: "🔎 Digital Footprint", mode: "osintSearchMode" },
    );

    for (const option of modeOptions) {
      const optEl = this.modeDropdown.createEl("option", {
        text: option.label,
        value: option.value,
      });
      // Set selected based on current mode
      if (option.mode === "customChatMode") {
        if (this.customChatMode && this.activeCheckpointId === option.checkpointId) {
          optEl.selected = true;
        } else if (this.customChatMode && !this.activeCheckpointId && option.checkpointId === this.plugin.settings.customCheckpoints[0]?.id) {
          // Fallback: if custom mode is on but no ID set, select first
          this.activeCheckpointId = option.checkpointId;
          optEl.selected = true;
        }
      }
      else if (option.value === "none" && this.isGraphOnlyMode()) optEl.selected = true;
      else if (option.value === "auto" && this.autoMode) optEl.selected = true;
      else if (option.value === "local" && this.localSearchMode) optEl.selected = true;
      else if (option.value === "darkweb" && this.darkWebMode) optEl.selected = true;
      else if (option.value === "report" && this.reportGenerationMode) optEl.selected = true;
      else if (option.value === "osint" && this.osintSearchMode) optEl.selected = true;
    }

    // Settings shortcut button
    const settingsBtn = buttonGroup.createEl("button", {
      text: "⚙️",
      cls: "vault-ai-settings-btn",
      attr: { "aria-label": "Open settings" }
    });
    settingsBtn.addEventListener("click", () => {
      // @ts-ignore
      this.app.setting.open();
      // @ts-ignore
      this.app.setting.openTabById(this.plugin.manifest.id);
    });

    // Handle mode selection
    this.modeDropdown.addEventListener("change", () => {
      const selectedValue = this.modeDropdown.value;

      // Reset all modes
      this.autoMode = false;
      this.customChatMode = false;
      this.localSearchMode = false;
      this.darkWebMode = false;
      this.reportGenerationMode = false;
      this.osintSearchMode = false;

      // Enable selected mode
      // Enable selected mode
      if (selectedValue.startsWith("custom-")) {
        const cpId = selectedValue.replace("custom-", "");
        this.customChatMode = true;
        this.activeCheckpointId = cpId;
        const cpName = this.plugin.settings.customCheckpoints.find(c => c.id === cpId)?.name || "Custom Chat";
        new Notice(`${cpName} enabled`);
      } else {
        this.activeCheckpointId = undefined; // Reset if switching away
        switch (selectedValue) {
          case "auto":
            this.autoMode = true;
            new Notice("Auto (All-in-One) mode enabled");
            break;
          case "local":
            this.localSearchMode = true;
            new Notice("Local search mode enabled");
            break;
          case "darkweb":
            this.darkWebMode = true;
            new Notice("Dark web mode enabled");
            break;
          case "report":
            this.reportGenerationMode = true;
            new Notice("Companies&people mode enabled");
            break;
          case "osint":
            this.osintSearchMode = true;
            new Notice("Leak search mode enabled");
            break;
          case "none":
            // All modes off - Graph only Mode if graph generation is on
            if (this.graphGenerationMode) {
              new Notice("Graph only mode enabled - extract entities from your text");
            } else {
              // Enable graph generation automatically for Graph Generation mode
              this.graphGenerationMode = true;
              this.graphGenerationToggle.checked = true;
              this.updateGraphGenerationLabel();
              new Notice("Graph only mode enabled - extract entities from your text");
            }
            break;
        }
      }

      this.updateAllModeLabels();
      this.updateInputPlaceholder();
      this.updateAllModeLabels();
      this.updateInputPlaceholder();
      this.updateModeDisclaimer();
      this.updateUploadButtonVisibility();
      this.updateUrlButtonVisibility();
      this.updateGraphToggleVisibility();
    });

    // === Graph Generation Toggle (Independent - enables Graph only Mode when all main modes are off) ===
    this.entityGenContainer = buttonGroup.createDiv("vault-ai-entity-gen-toggle");
    this.entityGenContainer.addClass("vault-ai-toggle-container");
    this.entityGenContainer.setAttribute("title", "Extract entities (works with any mode, or alone for graph only mode)");

    this.graphGenerationToggle = this.entityGenContainer.createEl("input", {
      type: "checkbox",
      cls: "vault-ai-entity-gen-checkbox",
    });
    this.graphGenerationToggle.id = "graph-gen-mode-toggle";
    this.graphGenerationToggle.checked = this.graphGenerationMode;
    this.graphGenerationToggle.addEventListener("change", () => {
      this.graphGenerationMode = this.graphGenerationToggle.checked;
      this.updateGraphGenerationLabel();
      this.updateInputPlaceholder();
      this.updateInputPlaceholder();
      this.updateModeDisclaimer();
      this.updateUploadButtonVisibility();
      this.updateUrlButtonVisibility();
      if (this.isGraphOnlyMode()) {
        new Notice("Graph only mode enabled - extract entities from your text");
      } else if (this.graphGenerationMode) {
        new Notice("Graph generation enabled");
      } else {
        new Notice("Graph generation disabled");
      }
    });

    const entityGenLabel = this.entityGenContainer.createEl("label", {
      text: this.getGraphGenLabelText(),
      cls: this.graphGenerationMode ? "vault-ai-entity-gen-label active" : "vault-ai-entity-gen-label",
    });
    entityGenLabel.htmlFor = "graph-gen-mode-toggle";

    // Hide toggle if Graph Generation mode is selected from dropdown
    this.updateGraphToggleVisibility();

    // Messages container
    this.messagesContainer = chatArea.createDiv("vault-ai-chat-messages");
    await this.renderMessages();

    // Input area
    const inputContainer = chatArea.createDiv("vault-ai-chat-input");

    // Mode disclaimer (shows what the current mode will do)
    const modeDisclaimer = this.getModeDisclaimer();
    if (modeDisclaimer) {
      const disclaimerEl = inputContainer.createDiv("vault-ai-mode-disclaimer");
      disclaimerEl.createSpan({ text: modeDisclaimer.icon + " " });
      disclaimerEl.createEl("strong", { text: modeDisclaimer.title + " " });
      disclaimerEl.createSpan({ text: modeDisclaimer.text });
    }

    this.inputEl = inputContainer.createEl("textarea", {
      placeholder: this.getInputPlaceholder(),
    });
    this.inputEl.rows = 3;

    // File upload for Graph Generation mode
    const fileInput = inputContainer.createEl("input", {
      type: "file",
      cls: "vault-ai-file-upload",
      attr: {
        "accept": ".md,.txt,.pdf,.docx,.doc",
        "style": "display: none;"
      }
    });
    fileInput.addEventListener("change", (e) => void this.handleFileUpload(e));

    // Attachments container - shows attached files below input
    this.attachmentsContainer = inputContainer.createDiv("vault-ai-attachments");
    this.attachedFiles = []; // Reset on render

    // Action Row for Buttons (Upload, URL, Send)
    const actionRow = inputContainer.createDiv("vault-ai-action-row");

    // Upload Button
    this.uploadButtonEl = actionRow.createEl("button", {
      text: "📎",
      cls: "vault-ai-upload-btn",
      attr: {
        "aria-label": "Upload file for graph generation",
        "title": "Upload file for graph generation (.md, .txt, .pdf, .docx)" // eslint-disable-line obsidianmd/ui/sentence-case
      }
    });
    // Only show in Graph Generation mode (or Graph Only mode)
    this.updateUploadButtonVisibility();
    this.uploadButtonEl.addEventListener("click", () => fileInput.click());

    // URL Button
    this.urlButtonEl = actionRow.createEl("button", {
      text: "🔗",
      cls: "vault-ai-url-btn",
      attr: {
        "aria-label": "Extract from URL",
        "title": "Extract content from web URL for graph generation"
      }
    });
    this.urlButtonEl.addEventListener("click", () => this.showUrlInputModal());
    this.updateUrlButtonVisibility();

    // Spacer to push Send button to the right
    const spacer = actionRow.createDiv("vault-ai-action-spacer");
    spacer.style.flexGrow = "1";

    // Send Button
    const sendBtn = actionRow.createEl("button", {
      text: this.osintSearchMode ? "Search" : "Send",
      cls: "vault-ai-send-btn"
    });
    sendBtn.addEventListener("click", () => void this.handleSend());

    // Drag and Drop Overlay
    this.dragOverlay = inputContainer.createDiv("vault-ai-drag-overlay");
    this.dragOverlay.createDiv({ text: "Drop file to extract text", cls: "vault-ai-drag-text" });

    // Drag events on the input container - only enabled in Graph Only mode
    inputContainer.addEventListener("dragenter", (e) => {
      if (!this.isGraphOnlyMode()) return;  // Only allow drag in Graph Only mode
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      if (!this.dragOverlay.hasClass("active")) {
        this.dragOverlay.addClass("active");
      }
    });

    inputContainer.addEventListener("dragleave", (e) => {
      if (!this.isGraphOnlyMode()) return;
      e.preventDefault();
      e.stopPropagation();
      if (!inputContainer.contains(e.relatedTarget as Node)) {
        this.dragOverlay.removeClass("active");
      }
    });

    inputContainer.addEventListener("dragover", (e) => {
      if (!this.isGraphOnlyMode()) return;  // Only allow drag in Graph Only mode
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      if (!this.dragOverlay.hasClass("active")) {
        this.dragOverlay.addClass("active");
      }
    });

    inputContainer.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dragOverlay.removeClass("active");

      // Only process drops in Graph Only mode
      if (!this.isGraphOnlyMode()) {
        new Notice("File drop only available in graph generation mode");
        return;
      }

      // Handle external files (OS drag and drop)
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.handleDroppedFile(e.dataTransfer.files[0]);
        return;
      }

      // Handle internal Obsidian files (drag from sidebar)

      // Method 1: Check internal dragManager (Scanning for internal state)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dragManager = (this.app as any).dragManager;
      if (dragManager && dragManager.draggable && dragManager.draggable.type === 'file' && dragManager.draggable.file instanceof TFile) {
        await this.handleDroppedAbstractFile(dragManager.draggable.file);
        return;
      }

      if (e.dataTransfer) {
        // Method 2: Check text/plain which often contains the file path
        const data = e.dataTransfer.getData("text/plain");
        if (data) {
          // Check if it's a file path in the vault
          const abstractFile = this.app.vault.getAbstractFileByPath(data);
          if (abstractFile instanceof TFile) {
            await this.handleDroppedAbstractFile(abstractFile);
            return;
          }
        }
      }
    });

    // Handle Enter key (Shift+Enter for new line)
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
      }
    });

    // Digital Footprint Options Panel (shown when Digital Footprint mode is active)
    if (this.osintSearchMode) {
      this.renderOSINTSearchOptions(inputContainer);
    }
  }

  /**
   * Get the mode disclaimer text based on current mode settings.
   * Returns HTML string or null if no disclaimer needed.
   */
  /**
   * Get the mode disclaimer text based on current mode settings.
   * Returns object with content parts or null if no disclaimer needed.
   */
  private getModeDisclaimer(): { icon: string; title: string; text: string } | null {
    if (this.isGraphOnlyMode()) {
      return {
        icon: "🏷️",
        title: "Graph Generation Mode:",
        text: "Your text will be analyzed to extract and create entities in the graph (people, companies, locations, etc.) without AI chat."
      };
    }

    if (this.osintSearchMode) {
      if (this.graphGenerationMode) {
        return {
          icon: "🔎",
          title: "Digital Footprint + Graph Gen:",
          text: "Search leaked databases and automatically create entities from the results."
        };
      }
      return {
        icon: "🔎",
        title: "Digital Footprint:",
        text: "Search multiple leaked databases for information about people, emails, phones, and more."
      };
    }

    if (this.darkWebMode) {
      if (this.graphGenerationMode) {
        return {
          icon: "🕵️",
          title: "Dark Web + Graph Gen:",
          text: "Investigate dark web sources and automatically create entities from findings."
        };
      }
      return {
        icon: "🕵️",
        title: "Dark Web:",
        text: "Search dark web sources for leaked data and threat intelligence."
      };
    }

    if (this.reportGenerationMode) {
      if (this.graphGenerationMode) {
        return {
          icon: "📄",
          title: "Persons&Companies + Graph Gen:",
          text: "Generate comprehensive reports and automatically create entities from the content."
        };
      }
      return {
        icon: "📄",
        title: "Persons&Companies:",
        text: "Generate detailed corporate intelligence reports about people and companies. Include data about sanctions and red flags"
      };
    }

    if (this.localSearchMode) {
      if (this.graphGenerationMode) {
        return {
          icon: "🔍",
          title: "Local Search + Graph Gen:",
          text: "Search your vault and automatically create entities from AI responses."
        };
      }
      return null; // Default mode, no disclaimer needed
    }

    return null;
  }

  updateUploadButtonVisibility() {
    if (this.uploadButtonEl) {
      // Only show upload button in Graph Generation mode (Graph Only mode)
      if (this.isGraphOnlyMode()) {
        this.uploadButtonEl.style.display = "block";
      } else {
        this.uploadButtonEl.style.display = "none";
      }
    }
  }

  updateUrlButtonVisibility() {
    if (this.urlButtonEl) {
      // Only show URL button in Graph Generation mode (Graph Only mode)
      if (this.isGraphOnlyMode()) {
        this.urlButtonEl.style.display = "block";
      } else {
        this.urlButtonEl.style.display = "none";
      }
    }
  }

  /**
   * Show modal for URL input to extract content from webpage.
   * Extracted content is sent directly to graph generation.
   */
  showUrlInputModal() {
    // Create modal overlay
    const overlay = document.createElement("div");
    overlay.className = "vault-ai-modal-overlay";
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    `;

    // Create modal
    const modal = document.createElement("div");
    modal.className = "vault-ai-url-modal";
    modal.style.cssText = `
      background: var(--background-primary);
      border-radius: 8px;
      padding: 20px;
      min-width: 400px;
      max-width: 600px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;

    modal.innerHTML = `
      <h3 style="margin-top: 0; margin-bottom: 15px;">🔗 Extract from URL</h3>
      <p style="color: var(--text-muted); margin-bottom: 15px; font-size: 0.9em;">
        Paste a URL to extract article content and generate entities.
      </p>
      <input type="url" id="url-input" placeholder="https://medium.com/@author/article..." 
        style="width: 100%; padding: 10px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-secondary); color: var(--text-normal); margin-bottom: 15px;" />
      <div id="url-status" style="color: var(--text-muted); margin-bottom: 15px; min-height: 20px;"></div>
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="url-cancel" style="padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; background: var(--background-modifier-border);">Cancel</button>
        <button id="url-extract" style="padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; background: var(--interactive-accent); color: white;">Extract & Generate</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const urlInput = modal.querySelector("#url-input") as HTMLInputElement;
    const statusEl = modal.querySelector("#url-status") as HTMLElement;
    const cancelBtn = modal.querySelector("#url-cancel") as HTMLButtonElement;
    const extractBtn = modal.querySelector("#url-extract") as HTMLButtonElement;

    // Focus input
    urlInput.focus();

    // Close modal function
    const closeModal = () => {
      overlay.remove();
    };

    // Cancel button
    cancelBtn.addEventListener("click", closeModal);

    // Click outside to close
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    // Escape key to close
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);

    // Extract button
    extractBtn.addEventListener("click", async () => {
      const url = urlInput.value.trim();

      if (!url) {
        statusEl.textContent = "❌ Please enter a URL"; // eslint-disable-line obsidianmd/ui/sentence-case
        statusEl.style.color = "var(--text-error)";
        return;
      }

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        statusEl.textContent = "❌ URL must start with http:// or https://"; // eslint-disable-line obsidianmd/ui/sentence-case
        statusEl.style.color = "var(--text-error)";
        return;
      }

      // Disable buttons and show loading
      extractBtn.disabled = true;
      cancelBtn.disabled = true;
      extractBtn.textContent = "Extracting...";
      statusEl.textContent = "🔗 Fetching content from URL..."; // eslint-disable-line obsidianmd/ui/sentence-case
      statusEl.style.color = "var(--text-muted)";

      try {
        // Extract text from URL
        const extractedText = await this.plugin.graphApiService.extractTextFromUrl(url);

        if (!extractedText || extractedText.trim().length === 0) {
          throw new Error("No content could be extracted from this URL");
        }

        // Close modal
        closeModal();

        // Show user message in chat with just the URL
        const displayUrl = url.length > 60 ? url.substring(0, 60) + "..." : url;
        this.chatHistory.push({ role: "user", content: `🔗 ${displayUrl}` });
        await this.renderMessages();

        // Send extracted content directly to graph generation
        new Notice(`Extracted content from URL. Processing entities...`);
        await this.handleGraphOnlyMode(extractedText);

        // Save conversation
        await this.saveCurrentConversation();

      } catch (error) {
        console.error("URL extraction error:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
          statusEl.textContent = "❌ Request timed out. Try a simpler page."; // eslint-disable-line obsidianmd/ui/sentence-case
        } else if (errorMsg.includes("429")) {
          statusEl.textContent = "❌ Server busy. Please wait and try again."; // eslint-disable-line obsidianmd/ui/sentence-case
        } else {
          statusEl.textContent = `❌ ${errorMsg}`;
        }
        statusEl.style.color = "var(--text-error)";

        // Re-enable buttons
        extractBtn.disabled = false;
        cancelBtn.disabled = false;
        extractBtn.textContent = "Extract & generate";
      }
    });

    // Enter key to submit
    urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        extractBtn.click();
      }
    });
  }

  /**
   * Hide/show the Graph Generation toggle based on mode selection.
   * When "Graph Generation" is selected from the dropdown, the toggle is redundant.
   */
  updateGraphToggleVisibility() {
    if (this.entityGenContainer) {
      // Hide toggle when Graph Generation mode is selected from dropdown (value="none")
      // Show toggle for other modes (so user can optionally enable graph gen alongside main mode)
      if (this.modeDropdown && this.modeDropdown.value === "none") {
        this.entityGenContainer.style.display = "none";
      } else {
        this.entityGenContainer.style.display = "flex";
      }
    }
  }

  async handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    const file = target.files[0];

    // Clear input to allow re-uploading same file
    target.value = '';

    // Validate file type
    const allowedExtensions = ['.md', '.txt', '.pdf', '.docx', '.doc'];
    const ext = "." + file.name.split('.').pop()?.toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      new Notice(`File type ${ext} not supported. Use .md, .txt, .pdf, .docx`);
      return;
    }

    // Store file for deferred extraction - do NOT extract now
    this.attachedFiles.push({ file, extracted: false });
    this.renderAttachments();
    new Notice(`Attached: ${file.name}`);
  }

  async handleDroppedFile(file: File) {
    if (!file) return;

    const allowedExtensions = ['.md', '.txt', '.pdf', '.docx', '.doc'];
    const ext = "." + file.name.split('.').pop()?.toLowerCase();

    if (!allowedExtensions.includes(ext)) {
      new Notice(`File type ${ext} not supported. Use .md, .txt, .pdf, .docx`);
      return;
    }

    try {
      this.inputEl.placeholder = `Extracting text from ${file.name}...`;
      this.inputEl.disabled = true;

      new Notice(`Extracting text from ${file.name}...`);

      const text = await this.plugin.graphApiService.extractTextFromFile(file);
      this.appendExtractedText(text);
      new Notice(`Text extracted from ${file.name}`);

    } catch (error) {
      console.error("Drop file error:", error);
      new Notice(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.inputEl.disabled = false;
      this.updateInputPlaceholder();
      this.inputEl.focus();
    }
  }

  /**
   * Handle dropped internal file (TFile) from Obsidian Vault
   */
  async handleDroppedAbstractFile(file: TFile) {
    if (!file) return;

    const allowedExtensions = ['md', 'txt', 'pdf', 'docx', 'doc'];
    if (!allowedExtensions.includes(file.extension)) {
      new Notice(`File type .${file.extension} not supported.`);
      return;
    }

    // Store file for deferred extraction - do NOT extract now
    this.attachedFiles.push({ file, extracted: false });
    this.renderAttachments();
    new Notice(`Attached: ${file.name}`);
  }

  /**
   * Render the attached files display.
   */
  private renderAttachments() {
    this.attachmentsContainer.empty();

    if (this.attachedFiles.length === 0) {
      return;
    }

    for (let i = 0; i < this.attachedFiles.length; i++) {
      const attachment = this.attachedFiles[i];
      const attachmentEl = this.attachmentsContainer.createDiv("vault-ai-attachment-item");

      // File icon and name
      const fileInfo = attachmentEl.createDiv("vault-ai-attachment-info");
      fileInfo.createSpan({ text: "📄 ", cls: "vault-ai-attachment-icon" });
      fileInfo.createSpan({ text: attachment.file.name, cls: "vault-ai-attachment-name" });

      // Preview snippet or pending extraction message
      if (attachment.extracted && attachment.content) {
        const preview = attachment.content.substring(0, 100).replace(/\n/g, ' ').trim();
        if (preview) {
          attachmentEl.createDiv({
            text: preview + (attachment.content.length > 100 ? '...' : ''),
            cls: "vault-ai-attachment-preview"
          });
        }
      } else {
        // Show pending message for deferred extraction
        attachmentEl.createDiv({
          text: "📋 Ready to extract on send",
          cls: "vault-ai-attachment-preview"
        });
      }

      // Remove button
      const removeBtn = attachmentEl.createEl("button", {
        text: "✕",
        cls: "vault-ai-attachment-remove",
        attr: { "aria-label": "Remove attachment", "title": "Remove attachment" }
      });
      removeBtn.addEventListener("click", () => {
        this.attachedFiles.splice(i, 1);
        this.renderAttachments();
      });
    }
  }

  private appendExtractedText(text: string) {
    const currentText = this.inputEl.value;
    if (currentText) {
      this.inputEl.value = currentText + "\n\n" + text;
    } else {
      this.inputEl.value = text;
    }
  }

  /**
   * Check if input is a URL and extract text if so
   */
  async handleUrlExtraction(url: string): Promise<boolean> {
    try {
      if (!url.startsWith('http')) return false;

      const originalPlaceholder = this.inputEl.placeholder;
      this.inputEl.placeholder = "Extracting text from URL...";
      this.inputEl.disabled = true;

      new Notice(`Extracting text from URL: ${url}...`);

      const text = await this.plugin.graphApiService.extractTextFromUrl(url);

      this.inputEl.value = text;

      new Notice(`Text extracted from URL`);
      return true; // Return true to indicate URL was handled and text replaced
    } catch (error) {
      console.error("URL extraction error:", error);
      new Notice(`Error extracting URL: ${error instanceof Error ? error.message : String(error)}`);
      return false; // Return false to indicate failure/not handled
    } finally {
      this.inputEl.disabled = false;
      this.updateInputPlaceholder();
      this.inputEl.focus();
    }
  }

  /**
   * Render the Digital Footprint options panel.
   */
  private renderOSINTSearchOptions(container: HTMLElement) {
    const optionsPanel = container.createDiv("vault-ai-osint-search-options");

    // Toggle button for options
    const toggleBtn = optionsPanel.createEl("button", {
      text: this.osintSearchOptionsVisible ? "⚙️ Hide Options" : "⚙️ Search Options",
      cls: "vault-ai-osint-options-toggle"
    });
    toggleBtn.addEventListener("click", () => {
      this.osintSearchOptionsVisible = !this.osintSearchOptionsVisible;
      toggleBtn.textContent = this.osintSearchOptionsVisible ? "⚙️ Hide Options" : "⚙️ Search Options";
      optionsContent.style.display = this.osintSearchOptionsVisible ? "flex" : "none";
    });

    // Options content (collapsible)
    const optionsContent = optionsPanel.createDiv("vault-ai-osint-options-content");
    optionsContent.style.display = this.osintSearchOptionsVisible ? "flex" : "none";

    // Country selector
    const countryGroup = optionsContent.createDiv("vault-ai-osint-option-group");
    countryGroup.createEl("label", { text: "Country:" });
    const countrySelect = countryGroup.createEl("select", { cls: "vault-ai-osint-country-select" });
    const countries = [
      { value: 'RU', label: '🇷🇺 Russia' },
      { value: 'UA', label: '🇺🇦 Ukraine' },
      { value: 'BY', label: '🇧🇾 Belarus' },
      { value: 'KZ', label: '🇰🇿 Kazakhstan' }
    ];
    for (const country of countries) {
      const option = countrySelect.createEl("option", { text: country.label, value: country.value });
      if (country.value === this.osintSearchCountry) {
        option.selected = true;
      }
    }
    countrySelect.addEventListener("change", () => {
      this.osintSearchCountry = countrySelect.value as 'RU' | 'UA' | 'BY' | 'KZ';
    });

    // Max providers
    const providersGroup = optionsContent.createDiv("vault-ai-osint-option-group");
    providersGroup.createEl("label", { text: "Max providers:" });
    const providersInput = providersGroup.createEl("input", {
      type: "number",
      cls: "vault-ai-osint-providers-input",
      value: String(this.osintSearchMaxProviders)
    });
    providersInput.min = "1";
    providersInput.max = "10";
    providersInput.addEventListener("change", () => {
      const value = parseInt(providersInput.value);
      if (value >= 1 && value <= 10) {
        this.osintSearchMaxProviders = value;
      } else {
        providersInput.value = String(this.osintSearchMaxProviders);
      }
    });

    // Parallel execution
    const parallelGroup = optionsContent.createDiv("vault-ai-osint-option-group");
    const parallelLabel = parallelGroup.createEl("label");
    const parallelCheckbox = parallelLabel.createEl("input", { type: "checkbox" });
    parallelCheckbox.checked = this.osintSearchParallel;
    parallelLabel.appendText(" Parallel Search");
    parallelCheckbox.addEventListener("change", () => {
      this.osintSearchParallel = parallelCheckbox.checked;
    });
  }

  // Check if Graph only Mode is active (graph generation ON, all main modes OFF)
  isGraphOnlyMode(): boolean {
    return this.graphGenerationMode && !this.localSearchMode && !this.customChatMode && !this.darkWebMode && !this.reportGenerationMode && !this.osintSearchMode && !this.autoMode;
  }

  // Show notice when entering Graph only Mode
  checkGraphOnlyMode() {
    if (this.isGraphOnlyMode()) {
      new Notice("Graph only mode - enter text to extract entities");
    }
  }

  // Get the appropriate input placeholder based on current mode
  getInputPlaceholder(): string {
    if (this.isGraphOnlyMode()) {
      return "Enter text to extract entities...";
    } else if (this.osintSearchMode) {
      return "Enter OSINT search query (e.g., 'Find info about john@example.com')...";
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

  // Update the mode disclaimer banner dynamically
  updateModeDisclaimer() {
    const inputContainer = this.containerEl.querySelector(".vault-ai-chat-input");
    if (!inputContainer) return;

    // Find existing disclaimer element
    let disclaimerEl = inputContainer.querySelector(".vault-ai-mode-disclaimer") as HTMLElement | null;
    const newDisclaimer = this.getModeDisclaimer();

    if (newDisclaimer) {
      if (disclaimerEl) {
        // Update existing disclaimer
        disclaimerEl.empty();
        disclaimerEl.createSpan({ text: newDisclaimer.icon + " " });
        disclaimerEl.createEl("strong", { text: newDisclaimer.title + " " });
        disclaimerEl.createSpan({ text: newDisclaimer.text });
      } else {
        // Create new disclaimer element (insert at the beginning of input container)
        disclaimerEl = document.createElement("div");
        disclaimerEl.className = "vault-ai-mode-disclaimer";

        const disclaimerSpan = document.createElement("span");
        disclaimerSpan.textContent = newDisclaimer.icon + " ";
        disclaimerEl.appendChild(disclaimerSpan);

        const disclaimerStrong = document.createElement("strong");
        disclaimerStrong.textContent = newDisclaimer.title + " ";
        disclaimerEl.appendChild(disclaimerStrong);

        const disclaimerText = document.createElement("span");
        disclaimerText.textContent = newDisclaimer.text;
        disclaimerEl.appendChild(disclaimerText);

        inputContainer.insertBefore(disclaimerEl, inputContainer.firstChild);
      }
    } else {
      // Remove disclaimer if no longer needed
      if (disclaimerEl) {
        disclaimerEl.remove();
      }
    }

    // Also update the send button text based on mode
    const sendBtn = inputContainer.querySelector(".vault-ai-send-btn");
    if (sendBtn) {
      sendBtn.textContent = this.osintSearchMode ? "Search" : "Send";
    }
  }

  // Get the graph generation label text (shows Graph only when applicable)
  getGraphGenLabelText(): string {
    if (this.isGraphOnlyMode()) {
      return "🏷️ Graph only (ON)";
    } else if (this.graphGenerationMode) {
      return "🏷️ Graph Generation (ON)";
    } else {
      return "🏷️ Graph Generation";
    }
  }

  updateGraphGenerationLabel() {
    const container = this.containerEl.querySelector(".vault-ai-entity-gen-toggle");
    if (container) {
      const label = container.querySelector("label");
      if (label) {
        label.textContent = this.getGraphGenLabelText();
        label.className = this.graphGenerationMode ? "vault-ai-entity-gen-label active" : "vault-ai-entity-gen-label";
        // Add special styling for Graph only Mode
        if (this.isGraphOnlyMode()) {
          container.addClass("graph-only-mode");
        } else {
          container.removeClass("graph-only-mode");
        }
      }
    }
  }

  updateAllModeLabels() {
    // Update mode dropdown selection
    if (this.modeDropdown) {
      if (this.customChatMode && this.activeCheckpointId) {
        this.modeDropdown.value = `custom-${this.activeCheckpointId}`;
      } else if (this.localSearchMode) {
        this.modeDropdown.value = "local";
      } else if (this.darkWebMode) {
        this.modeDropdown.value = "darkweb";
      } else if (this.reportGenerationMode) {
        this.modeDropdown.value = "report";
      } else if (this.osintSearchMode) {
        this.modeDropdown.value = "osint";
      } else if (this.autoMode) {
        this.modeDropdown.value = "auto";
      } else {
        this.modeDropdown.value = "none";
      }
    }

    // Also update graph generation label (for Graph only Mode indicator)
    this.updateGraphGenerationLabel();
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
      // Check if Graph only Mode (graph gen ON, all main modes OFF)
      const convOsintSearchMode = conv.osintSearchMode || false;
      const convAutoMode = conv.autoMode ?? true;
      const isGraphOnly = conv.graphGenerationMode && !conv.localSearchMode && !conv.darkWebMode && !conv.reportGenerationMode && !convOsintSearchMode && !convAutoMode;
      // Show main mode badge or Graph only badge
      if (isGraphOnly) {
        meta.createEl("span", { text: "🏷️", cls: "vault-ai-conversation-graphonly", title: "Graph only mode" });
      } else if (convAutoMode) {
        meta.createEl("span", { text: "✨", cls: "vault-ai-conversation-auto", title: "Auto (All-in-One) mode" });
        if (conv.graphGenerationMode) {
          meta.createEl("span", { text: "🏷️", cls: "vault-ai-conversation-graphgen", title: "Graph generation" });
        }
      } else if (convOsintSearchMode) {
        meta.createEl("span", { text: "🔎", cls: "vault-ai-conversation-osint-search", title: "Leak search mode" });
        if (conv.graphGenerationMode) {
          meta.createEl("span", { text: "🏷️", cls: "vault-ai-conversation-graphgen", title: "Graph generation" });
        }
      } else if (conv.darkWebMode) {
        meta.createEl("span", { text: "🕵️", cls: "vault-ai-conversation-darkweb", title: "Dark web mode" });
        if (conv.graphGenerationMode) {
          meta.createEl("span", { text: "🏷️", cls: "vault-ai-conversation-graphgen", title: "Graph generation" });
        }
      } else if (conv.reportGenerationMode) {
        meta.createEl("span", { text: "📄", cls: "vault-ai-conversation-report", title: "Companies&people generation mode" });
        if (conv.graphGenerationMode) {
          meta.createEl("span", { text: "🏷️", cls: "vault-ai-conversation-graphgen", title: "Graph generation" });
        }
      } else {
        meta.createEl("span", { text: "🔍", cls: "vault-ai-conversation-local-search", title: "Local search mode" });
        if (conv.graphGenerationMode) {
          meta.createEl("span", { text: "🏷️", cls: "vault-ai-conversation-graphgen", title: "Graph generation" });
        }
      }

      // Click to load conversation
      convContent.addEventListener("click", () => {
        void this.loadConversation(conv.id);
      });

      // Actions (delete, rename)
      const actions = convItem.createDiv("vault-ai-conversation-actions");

      const renameBtn = actions.createEl("button", { cls: "vault-ai-conv-action-btn" });
      renameBtn.setText("✏️");
      renameBtn.title = "Rename";
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.renameConversation(conv.id, conv.title);
      });

      const deleteBtn = actions.createEl("button", { cls: "vault-ai-conv-action-btn" });
      deleteBtn.setText("🗑️");
      deleteBtn.title = "Delete";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.deleteConversation(conv.id);
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
      this.graphGenerationMode = conversation.graphGenerationMode || false;
      this.reportGenerationMode = conversation.reportGenerationMode || false;
      this.osintSearchMode = conversation.osintSearchMode || false;
      // Use autoMode from conversation, or infer from other modes for backward compatibility
      this.autoMode = conversation.autoMode !== undefined
        ? conversation.autoMode
        : (!this.darkWebMode && !this.reportGenerationMode && !this.osintSearchMode && !this.localSearchMode);
      this.plugin.conversationService.setCurrentConversationId(id);
      await this.render();
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
    // Reset mode toggles for new conversation (Auto Mode is default)
    this.localSearchMode = false;
    this.autoMode = true;
    this.darkWebMode = false;
    this.graphGenerationMode = true;
    this.reportGenerationMode = false;
    this.osintSearchMode = false;
    this.plugin.conversationService.setCurrentConversationId(null);
    await this.render();
    new Notice("Started new conversation");
  }

  async deleteConversation(id: string) {
    new ConfirmModal(
      this.app,
      "Delete Conversation",
      "Are you sure you want to delete this conversation?",
      async () => {
        const success = await this.plugin.conversationService.deleteConversation(id);

        // Clear current conversation if it was deleted
        if (this.currentConversation && this.currentConversation.id === id) {
          this.currentConversation = null;
          this.chatHistory = [];
        }

        // Always refresh the UI (the service already updated its internal list)
        this.renderConversationList();
        await this.renderMessages();

        if (success) {
          new Notice("Conversation deleted");
        } else {
          new Notice("Failed to delete conversation");
        }
      },
      undefined,
      true // destructive
    ).open();
  }

  renameConversation(id: string, currentTitle: string) {
    new RenameConversationModal(this.app, currentTitle, (newTitle: string) => {
      void (async () => {
        const success = await this.plugin.conversationService.renameConversation(id, newTitle);
        if (success) {
          if (this.currentConversation && this.currentConversation.id === id) {
            this.currentConversation.title = newTitle;
          }
          await this.plugin.conversationService.loadConversationList();
          this.renderConversationList();
          new Notice("Conversation renamed");
        }
      })();
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
          noteLink.addEventListener("click", (e) => {
            e.preventDefault();
            void (async () => {
              const file = this.app.vault.getAbstractFileByPath(note.path);
              if (file instanceof TFile) {
                await this.app.workspace.getLeaf().openFile(file);
              }
            })();
          });
        }
      }

      // Show Used Graph Entities (Advanced Graph Search)
      if (item.role === "assistant" && item.usedEntities && item.usedEntities.length > 0) {
        const entitiesDiv = messageDiv.createDiv("vault-ai-used-entities");
        entitiesDiv.style.marginTop = "8px";
        entitiesDiv.createEl("small", { text: "Graph sources:" });

        const chipsContainer = entitiesDiv.createDiv("vault-ai-entity-chips-container");
        chipsContainer.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 4px;
        `;

        for (const usedEntity of item.usedEntities) {
          const fullEntity = this.plugin.entityManager.getEntity(usedEntity.id);
          if (!fullEntity) continue;

          const chip = chipsContainer.createDiv("vault-ai-entity-chip");
          chip.style.cssText = `
                display: inline-flex;
                align-items: center;
                padding: 2px 8px;
                border-radius: 12px;
                background: var(--background-modifier-border);
                font-size: 11px;
                cursor: pointer;
                border: 1px solid var(--background-modifier-border-hover);
                transition: background 0.2s;
            `;
          chip.setAttribute("aria-label", `Open ${fullEntity.label}`);

          // Icon based on type (simple mapping if helper not available)
          const iconSpan = chip.createEl("span", { text: "🔗" });
          iconSpan.style.marginRight = "4px";
          iconSpan.style.opacity = "0.7";

          chip.createEl("span", { text: fullEntity.label });

          chip.addEventListener("mouseenter", () => {
            chip.style.background = "var(--background-modifier-hover)";
          });
          chip.addEventListener("mouseleave", () => {
            chip.style.background = "var(--background-modifier-border)";
          });

          chip.addEventListener("click", (e) => {
            e.preventDefault();
            if (fullEntity.filePath) {
              void (async () => {
                const file = this.app.vault.getAbstractFileByPath(fullEntity.filePath!);
                if (file instanceof TFile) {
                  await this.app.workspace.getLeaf().openFile(file);
                } else {
                  new Notice("Linked note file not found");
                }
              })();
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
            text: "📄 note",
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
          noteBtn.addEventListener("click", (e) => {
            e.preventDefault();
            void (async () => {
              const file = this.app.vault.getAbstractFileByPath(entity.filePath);
              if (file instanceof TFile) {
                await this.app.workspace.getLeaf().openFile(file);
              }
            })();
          });

          // Open in Graph View button
          const graphBtn = entityRow.createEl("button", {
            text: "🔗 graph",
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
          graphBtn.title = "View in graph";
          graphBtn.addEventListener("click", (e) => {
            e.preventDefault();
            void this.plugin.openGraphViewWithEntity(entity.id);
          });
        }

        // Add hint text
        const hintText = entitiesDiv.createEl("small", {
          text: "Click 'graph' to view entity in the graph, or 'note' to open its file.",
          cls: "vault-ai-entity-hint",
        });
        hintText.style.cssText = `
          display: block;
          margin-top: 8px;
          color: var(--text-muted);
          font-style: italic;
        `;
      }

      // Show "Open Companies&People" button for report generation messages
      if (item.role === "assistant" && item.reportFilePath) {
        const reportButtonContainer = messageDiv.createDiv("vault-ai-report-button-container");
        reportButtonContainer.setCssProps({
          "margin-top": "12px",
          padding: "10px",
          background: "var(--background-secondary)",
          "border-radius": "6px",
          "border-left": "3px solid var(--interactive-accent)"
        });

        const reportButton = reportButtonContainer.createEl("button", {
          text: "📄 open companies&people",
          cls: "vault-ai-open-report-btn",
        });
        reportButton.setCssProps({
          padding: "8px 16px",
          "font-size": "13px",
          "font-weight": "500",
          background: "var(--interactive-accent)",
          color: "var(--text-on-accent)",
          border: "none",
          "border-radius": "4px",
          cursor: "pointer",
          transition: "opacity 0.2s"
        });
        reportButton.title = `Open report: ${item.reportFilePath}`;

        // Add hover effect
        reportButton.addEventListener("mouseenter", () => {
          reportButton.setCssProps({ opacity: "0.8" });
        });
        reportButton.addEventListener("mouseleave", () => {
          reportButton.setCssProps({ opacity: "1" });
        });

        // Add click handler to open the report
        reportButton.addEventListener("click", (e) => {
          e.preventDefault();
          void (async () => {
            const file = this.app.vault.getAbstractFileByPath(item.reportFilePath!);
            if (file instanceof TFile) {
              await this.app.workspace.getLeaf().openFile(file);
              new Notice(`Opened report: ${item.reportFilePath}`);
            } else {
              new Notice(`Companies&People file not found: ${item.reportFilePath}`);
            }
          })();
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

      // Container for text and button
      const infoContainer = progressContainer.createDiv("vault-ai-progress-info");
      infoContainer.style.display = "flex";
      infoContainer.style.justifyContent = "space-between";
      infoContainer.style.alignItems = "center";
      infoContainer.style.marginTop = "4px";

      // Create progress text
      infoContainer.createEl("span", {
        cls: "vault-ai-progress-text",
        text: `${currentProgress.message || "Processing..."} (${currentProgress.percent}%)`,
      });

      // Add Cancel button if operation is active
      if (this.activeAbortControllers.has(messageIndex)) {
        const cancelBtn = infoContainer.createEl("button", {
          text: "✕ Cancel", // eslint-disable-line obsidianmd/ui/sentence-case
          cls: "vault-ai-cancel-btn"
        });
        cancelBtn.style.fontSize = "11px";
        cancelBtn.style.padding = "2px 6px";
        cancelBtn.style.height = "auto";
        cancelBtn.style.marginLeft = "8px";
        cancelBtn.style.color = "var(--text-muted)";
        cancelBtn.style.background = "transparent";
        cancelBtn.style.border = "1px solid var(--background-modifier-border)";
        cancelBtn.style.borderRadius = "4px";
        cancelBtn.style.cursor = "pointer";

        cancelBtn.addEventListener("mouseenter", () => {
          cancelBtn.style.color = "var(--text-error)";
          cancelBtn.style.borderColor = "var(--text-error)";
        });

        cancelBtn.addEventListener("mouseleave", () => {
          cancelBtn.style.color = "var(--text-muted)";
          cancelBtn.style.borderColor = "var(--background-modifier-border)";
        });

        cancelBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.handleCancel(messageIndex);
        });
      }

      // Feature: Add disclaimer below progress bar for Report Generation
      const progressMsg = currentProgress.message || "";
      // Check if it's a report generation (usually has 📄 or "Report" in message/content)
      const isReportGeneration = progressMsg.includes("📄") ||
        progressMsg.includes("Report") ||
        (this.chatHistory[messageIndex]?.content && this.chatHistory[messageIndex].content.includes("Generating report"));

      if (isReportGeneration) {
        const disclaimer = progressContainer.createDiv("vault-ai-progress-disclaimer");
        disclaimer.style.marginTop = "4px";
        disclaimer.style.fontSize = "11px";
        disclaimer.style.color = "var(--text-muted)";
        disclaimer.style.fontStyle = "italic";
        disclaimer.innerText = "It might take up to 5-6 minutes, don't close the tab";
      }
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
        ? this.chatHistory[messageIndex].intermediateResults
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
  }

  async handleCancel(index: number) {
    const controller = this.activeAbortControllers.get(index);
    if (!controller) return;

    new ConfirmModal(
      this.app,
      "Cancel Operation",
      "Are you sure you want to cancel this operation?",
      () => {
        // user confirmed
        controller.abort();
        this.activeAbortControllers.delete(index);

        // Update UI to show cancelled state
        if (this.chatHistory[index]) {
          const currentContent = this.chatHistory[index].content || "";
          this.chatHistory[index].content = currentContent + "\n\n❌ **Cancelled by user**";
          this.chatHistory[index].progress = undefined;
          this.renderMessages();
        }

        new Notice("Operation cancelled");
      },
      () => {
        // user cancelled the modal (did not confirm)
      },
      true // destructive action
    ).open();
  }

  async handleSend() {
    const value = this.inputEl.value.trim();
    if (!value && this.attachedFiles.length === 0) return;

    // Check for URL in Graph Generation Mode
    if (this.isGraphOnlyMode() && value.startsWith('http')) {
      const isUrlHandled = await this.handleUrlExtraction(value);
      if (isUrlHandled) {
        this.inputEl.value = ""; // Clear input if URL was handled
        await this.saveCurrentConversation(); // Save conversation after URL handling
        return; // Stop normal flow if URL was handled
      }
      // If not handled (returned false), continue normal flow
    }

    this.inputEl.value = "";

    if (!this.plugin.isAuthenticated()) {
      new Notice("License key required for AI features. Please configure your license key in settings.");
      return;
    }

    // Build processed value - keep file content separate from chat display
    let displayValue = value; // What user sees in chat
    let processingValue = value; // What gets sent to graph generation (includes file content)
    const processedFileNames: string[] = []; // Track file names for display

    if (this.attachedFiles.length > 0) {
      // Store files for processing, then clear UI immediately for better feedback
      const filesToProcess = [...this.attachedFiles];
      this.attachedFiles = [];
      this.renderAttachments(); // Clear attachment chips immediately

      // Show extraction progress in a placeholder message
      const fileCount = filesToProcess.length;
      const extractionMsgIndex = this.chatHistory.length;
      this.chatHistory.push({
        role: "assistant",
        content: `📄 Extracting text from ${fileCount} file${fileCount > 1 ? 's' : ''}...`
      });
      await this.renderMessages();

      // Extract text from attached files NOW (deferred extraction)
      const extractedContents: string[] = [];
      let extractedCount = 0;
      let failedCount = 0;

      // Process files sequentially to avoid rate limits
      for (const attachment of filesToProcess) {
        const fileName = attachment.file.name;

        // Update progress message
        this.chatHistory[extractionMsgIndex].content =
          `📄 Extracting text (${extractedCount + 1}/${fileCount}): ${fileName}...`;
        await this.renderMessages();

        try {
          let text = "";

          if (attachment.extracted && attachment.content) {
            // Already extracted
            text = attachment.content;
          } else if (attachment.file instanceof TFile) {
            // TFile from Obsidian vault - read directly for text files, API for binary
            const ext = attachment.file.extension;
            if (['md', 'txt'].includes(ext)) {
              text = await this.app.vault.read(attachment.file);
            } else {
              // Show special message for PDF/binary files
              this.chatHistory[extractionMsgIndex].content =
                `📄 Processing ${fileName}... (this may take a moment for large files)`;
              await this.renderMessages();

              const arrayBuffer = await this.app.vault.readBinary(attachment.file);
              const blob = new Blob([arrayBuffer]);
              const syntheticFile = new File([blob], attachment.file.name, { type: 'application/octet-stream' });
              text = await this.plugin.graphApiService.extractTextFromFile(syntheticFile);
            }
          } else {
            // Native File object from upload button
            const ext = fileName.split('.').pop()?.toLowerCase() || '';
            if (!['md', 'txt'].includes(ext)) {
              this.chatHistory[extractionMsgIndex].content =
                `📄 Processing ${fileName}... (this may take a moment for large files)`;
              await this.renderMessages();
            }
            text = await this.plugin.graphApiService.extractTextFromFile(attachment.file);
          }

          extractedContents.push(`\n\n--- Content from ${fileName} ---\n${text}`);
          processedFileNames.push(fileName);
          extractedCount++;

        } catch (error) {
          failedCount++;
          console.error(`Error extracting ${fileName}:`, error);

          // Provide user-friendly error message based on error type
          let userMessage = `Could not extract text from ${fileName}`;
          const errorStr = error instanceof Error ? error.message : String(error);

          if (errorStr.includes('timed out') || errorStr.includes('timeout') || errorStr.includes('AbortError')) {
            userMessage = `${fileName}: File too large or server busy. Try a smaller file.`;
          } else if (errorStr.includes('429') || errorStr.includes('Too Many Requests')) {
            userMessage = `${fileName}: Server busy (rate limited). Please wait and try again.`;
          } else if (errorStr.includes('too large')) {
            userMessage = `${fileName}: ${errorStr}`;
          }

          new Notice(userMessage, 5000);
        }
      }

      // Update or remove the extraction message
      if (extractedCount > 0) {
        // Remove the extraction progress message
        this.chatHistory.splice(extractionMsgIndex, 1);
      } else {
        // All failed - show error message
        this.chatHistory[extractionMsgIndex].content =
          `❌ Failed to extract text from ${failedCount} file${failedCount > 1 ? 's' : ''}. Please try again.`;
        await this.renderMessages();
        return;
      }

      // Add extracted content ONLY to processingValue (not displayed in chat)
      processingValue = processingValue + extractedContents.join('\n');

      // For display, just show file names (not the content)
      if (processedFileNames.length > 0) {
        const fileList = processedFileNames.map(f => `📎 ${f}`).join('\n');
        displayValue = displayValue ? `${displayValue}\n\n${fileList}` : fileList;
      }

      // Show success notice if any files were processed
      if (extractedCount > 0 && failedCount === 0) {
        new Notice(`Extracted text from ${extractedCount} file${extractedCount > 1 ? 's' : ''}`);
      } else if (extractedCount > 0 && failedCount > 0) {
        new Notice(`Extracted ${extractedCount} file${extractedCount > 1 ? 's' : ''}, ${failedCount} failed`);
      }
    }

    // Add user message to chat (shows file names, NOT content)
    this.chatHistory.push({ role: "user", content: displayValue });

    // Save conversation after user message
    await this.saveCurrentConversation();

    // Route to appropriate handler based on mode
    // Pass processingValue (includes file content) to handlers, not displayValue
    let finalHandlerChoice = "localSearchMode";

    if (this.isGraphOnlyMode()) {
      finalHandlerChoice = "none";
    } else if (this.customChatMode) {
      finalHandlerChoice = "customChatMode";
    } else if (this.autoMode) {
      // NEW: Intelligent multi-task orchestration
      const processingMsgIndex = this.chatHistory.length;
      this.chatHistory.push({ role: "assistant", content: "..." });
      await this.renderMessages();

      const taskPlan = await this.plugin.graphApiService.determineTaskPlan(processingValue);
      console.log(`[AutoMode] Detected task plan:`, taskPlan);

      this.chatHistory.splice(processingMsgIndex, 1);

      this.graphGenerationMode = false; // Reset to default for auto mode
      let executionTarget = processingValue;

      // Map the task plan to our internal execution branches
      for (const task of taskPlan) {
        if (task.action === "graph_generation") {
          this.graphGenerationMode = true; // Auto-extract entities from outputs or run natively
          if (finalHandlerChoice === "localSearchMode") {
            finalHandlerChoice = "none";
            executionTarget = task.target || processingValue;
          }
        } else if (task.action === "graph_modification") {
          this.graphGenerationMode = true;
          this.graphModificationMode = true;
          if (finalHandlerChoice === "localSearchMode") {
            finalHandlerChoice = "none";
            executionTarget = task.target || processingValue;
          }
        } else if (task.action === "graph_query") {
          finalHandlerChoice = "graphQueryMode";
          executionTarget = task.target || processingValue;
        } else if (task.action === "report_generation") {
          finalHandlerChoice = "reportGenerationMode";
          executionTarget = task.target || processingValue;
        } else if (task.action === "darkweb") {
          finalHandlerChoice = "darkWebMode";
          executionTarget = task.target || processingValue;
        } else if (task.action === "osint_search") {
          finalHandlerChoice = "osintSearchMode";
          executionTarget = task.target || processingValue;
        }
      }

      // Override processingValue with the specific target identified by the LLM
      processingValue = executionTarget;

    } else if (this.osintSearchMode) {
      finalHandlerChoice = "osintSearchMode";
    } else if (this.darkWebMode) {
      finalHandlerChoice = "darkWebMode";
    } else if (this.reportGenerationMode) {
      finalHandlerChoice = "reportGenerationMode";
    }

    // Execute the final handler
    switch (finalHandlerChoice) {
      case "none":
        await this.handleGraphOnlyMode(processingValue);
        break;
      case "graphQueryMode":
        await this.handleGraphQuery(processingValue);
        break;
      case "customChatMode":
        await this.handleCustomChat(processingValue);
        break;
      case "osintSearchMode":
        await this.handleOSINTSearch(processingValue);
        break;
      case "darkWebMode":
        await this.handleDarkWebInvestigation(processingValue);
        break;
      case "reportGenerationMode":
        await this.handleReportGeneration(processingValue);
        break;
      default:
        await this.handleNormalChat(processingValue);
        break;
    }

    // Save conversation after assistant response
    await this.saveCurrentConversation();
  }

  async handleCustomChat(query: string) {
    const assistantIndex = this.chatHistory.length;

    // Initial user message placeholder
    this.chatHistory.push({
      role: "assistant",
      content: "",
      progress: { message: "Waiting for custom provider...", percent: 10 }
    });
    await this.renderMessages();

    // Helper to update progress
    const updateProgress = (message: string, percent: number) => {
      // Check if cancelled
      if (this.activeAbortControllers.has(assistantIndex)) {
        this.chatHistory[assistantIndex].progress = { message, percent };
        this.updateProgressBar(assistantIndex, { message, percent });
      }
    };

    updateProgress("Sending to custom provider...", 30);

    try {
      // Create new abort controller for this operation
      const controller = new AbortController();
      this.activeAbortControllers.set(assistantIndex, controller);

      // Call the custom provider (OpenAI compatible)
      // Pass system prompt from settings or default

      const checkpoint = this.plugin.settings.customCheckpoints.find(c => c.id === this.activeCheckpointId);

      const aiResponse = await this.plugin.graphApiService.chatWithCustomProvider(
        query,
        this.plugin.settings.systemPrompt,
        checkpoint ? {
          customApiUrl: checkpoint.url,
          customApiKey: checkpoint.apiKey,
          customModel: checkpoint.model,
          type: checkpoint.type || 'openai'
        } : undefined,
        controller.signal
      );

      // Clear controller on completion
      this.activeAbortControllers.delete(assistantIndex);

      // Display the response
      this.chatHistory[assistantIndex].content = aiResponse;
      this.chatHistory[assistantIndex].progress = undefined;
      await this.renderMessages();

      // If Graph Generation is ALSO enabled, feed the custom AI response into the graph extractor
      if (this.graphGenerationMode) {
        try {
          // Pass the AI response as "text to process", but keep original query for context
          await this.processGraphGeneration(assistantIndex, aiResponse, query, aiResponse, this.graphModificationMode);
        } catch (graphError) {
          console.error("[OSINT Copilot] Graph generation from custom chat failed:", graphError);
          new Notice("Graph generation failed, but the chat response was received successfully.");
        }
      }
    } catch (error) {
      this.activeAbortControllers.delete(assistantIndex); // Ensure controller is cleared on error
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Handle user cancellation gracefully
      if (errorMsg === 'Cancelled by user' || errorMsg.includes('Aborted') || errorMsg.includes('Request was cancelled')) {
        return; // UI already handled by handleCancel
      }

      console.error("Custom chat error:", error);
      this.chatHistory[assistantIndex].content = `Error calling custom provider: ${errorMsg}`;
      this.chatHistory[assistantIndex].progress = undefined;
      await this.renderMessages();
    }
  }

  /**
   * Handle Graph Query: answer a question about the existing graph using AI.
   * Sends current graph state (entities + connections) to the backend and displays the text answer.
   */
  async handleGraphQuery(query: string) {
    const assistantIndex = this.chatHistory.length;
    this.chatHistory.push({
      role: "assistant",
      content: "🔍 Analyzing your graph...",
      progress: { message: "Gathering graph state...", percent: 10 },
    });
    await this.renderMessages();

    const updateProgress = (message: string, percent: number) => {
      this.chatHistory[assistantIndex].progress = { message, percent };
      this.chatHistory[assistantIndex].content = `🔍 ${message}`;
      this.updateProgressBar(assistantIndex, { message, percent });
    };

    try {
      const existingEntities = this.plugin.entityManager.getAllEntities();
      const existingConnections = this.plugin.entityManager.getAllConnections().map(c => ({
        from: c.fromEntityId,
        to: c.toEntityId,
        relationship: c.relationship
      }));

      updateProgress(`Sending graph (${existingEntities.length} entities, ${existingConnections.length} connections) to AI...`, 30);

      const onRetry = (attempt: number, maxAttempts: number, reason: string, nextDelayMs: number) => {
        const delaySeconds = Math.round(nextDelayMs / 1000);
        updateProgress(`⚠️ Retrying in ${delaySeconds}s... (${attempt + 1}/${maxAttempts})`, 35);
      };

      const result = await this.plugin.graphApiService.processText(
        query,
        existingEntities,
        undefined, // referenceTime
        onRetry,
        undefined, // signal
        false,     // modifyOnly
        existingConnections,
        true       // graphQuery
      );

      this.chatHistory[assistantIndex].progress = undefined;

      if (result.success && result.message) {
        this.chatHistory[assistantIndex].content = result.message;
      } else if (!result.success) {
        this.chatHistory[assistantIndex].content =
          `🔍 **Graph Query Failed**\n\n` +
          `**Error:** ${result.error || "Unknown error"}\n\n` +
          `Please try rephrasing your question.`;
      } else {
        this.chatHistory[assistantIndex].content =
          `🔍 **No answer generated**\n\nThe AI couldn't analyze the graph. Make sure you have entities in your graph.`;
      }

      await this.renderMessages();
    } catch (error) {
      console.error("[GraphQuery] Error:", error);
      this.chatHistory[assistantIndex].progress = undefined;
      this.chatHistory[assistantIndex].content =
        `🔍 **Graph Query Error**\n\n${error instanceof Error ? error.message : "An unexpected error occurred."}`;
      await this.renderMessages();
    }
  }

  /**
   * Handle Graph only Mode: Extract entities from user input text without sending to AI.
   * This mode is active when graphGenerationMode is ON and all main modes are OFF.
   */
  async handleGraphOnlyMode(inputText: string) {
    // Add processing placeholder with progress bar
    const messageIndex = this.chatHistory.length;
    this.chatHistory.push({
      role: "assistant",
      content: "🏷️ Extracting entities from your text...",
      progress: { message: "Analyzing text...", percent: 10 },
    });
    await this.renderMessages();

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
          reasonText = 'Request takes longer than usual, please wait';
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

      // Chunk progress callback to show user which chunk is being processed
      const onChunkProgress = (chunkIndex: number, totalChunks: number, message: string) => {
        const chunkPercent = 30 + Math.round((chunkIndex / totalChunks) * 20);
        updateProgress(`📦 ${message}`, chunkPercent);
      };

      // Call the API to extract entities - uses chunking for large texts
      // Gather existing connections for modification mode
      const existingConnections = this.graphModificationMode
        ? this.plugin.entityManager.getAllConnections().map(c => ({
          from: c.fromEntityId,
          to: c.toEntityId,
          relationship: c.relationship
        }))
        : undefined;

      const result: ProcessTextResponse = await this.plugin.graphApiService.processTextInChunks(
        inputText,
        existingEntities,
        undefined,
        onChunkProgress,
        onRetry,
        undefined,
        this.graphModificationMode,
        existingConnections
      );

      updateProgress("Processing API response...", 50);

      if (!result.success) {
        this.chatHistory[messageIndex].progress = undefined; // Clear progress bar
        this.chatHistory[messageIndex].content =
          `🏷️ **Graph Generation Failed**\n\n` +
          `**Input:** ${inputText.substring(0, 100)}${inputText.length > 100 ? '...' : ''}\n\n` +
          `**Error:** ${result.error || 'Unknown error'}`;
        await this.renderMessages();
        return;
      }

      if (!result.operations || result.operations.length === 0) {
        this.chatHistory[messageIndex].progress = undefined; // Clear progress bar
        this.chatHistory[messageIndex].content =
          `🏷️ **Graph Generation Complete**\n\n` +
          `**Input:** ${inputText.substring(0, 200)}${inputText.length > 200 ? '...' : ''}\n\n` +
          `No entities detected in the provided text.`;
        await this.renderMessages();
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
      let deletedEntitiesCount = 0;
      let deletedConnectionsCount = 0;
      let updatedEntitiesCount = 0;

      // Debug: Log the full operations array
      console.debug('[GraphOnlyMode] Processing operations:', JSON.stringify(result.operations, null, 2));

      for (const operation of result.operations) {
        // Debug: Log each operation
        console.debug('[GraphOnlyMode] Processing operation:', {
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
            console.debug('[EntityOnlyMode] Processing entity:', {
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

              // Validate entity name is not generic
              const config = ENTITY_CONFIGS[entityType];
              const labelField = config?.labelField;
              const entityLabel = labelField ? entityData.properties[labelField] : null;

              if (entityLabel) {
                const nameValidation = validateEntityName(entityLabel as string, entityType);
                if (!nameValidation.isValid) {
                  console.warn(`[EntityOnlyMode] Skipping entity with generic name: "${entityLabel}" - ${nameValidation.error}`);
                  operationEntities.push(null);
                  continue;
                }
              }

              console.debug('[GraphOnlyMode] Creating entity with type:', entityType);
              const entity = await this.plugin.entityManager.createEntity(
                entityType,
                entityData.properties
              );
              console.debug('[GraphOnlyMode] Entity created successfully:', {
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
              console.error('[GraphOnlyMode] Failed to create entity:', entityError);
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
                console.error('[GraphOnlyMode] Failed to create connection:', connError);
              }
            }
          }
        } else if (operation.action === "delete" && operation.deletions) {
          updateProgress("Processing deletions...", 90);
          for (const deletionId of operation.deletions) {
            try {
              if (this.plugin.entityManager.getEntity(deletionId)) {
                await this.plugin.entityManager.deleteEntity(deletionId);
                deletedEntitiesCount++;
              } else if (this.plugin.entityManager.getConnection(deletionId)) {
                await this.plugin.entityManager.deleteConnectionWithNote(deletionId);
                deletedConnectionsCount++;
              } else {
                console.warn(`[GraphOnlyMode] Element to delete not found: ${deletionId}`);
              }
            } catch (delErr) {
              console.error(`[GraphOnlyMode] Failed to delete element ${deletionId}:`, delErr);
            }
          }
        } else if (operation.action === "update" && operation.updates) {
          updateProgress("Applying updates...", 92);
          for (const update of operation.updates) {
            try {
              if (update.id && this.plugin.entityManager.getEntity(update.id)) {
                await this.plugin.entityManager.updateEntity(update.id, update.new_properties || {});
                updatedEntitiesCount++;
              }
            } catch (updErr) {
              console.error(`[GraphOnlyMode] Failed to update entity ${update.id}:`, updErr);
            }
          }
        } else if (operation.action === "connect" && operation.new_connections) {
          updateProgress("Connecting entities...", 93);
          for (const conn of operation.new_connections) {
            try {
              const fromEntity = this.plugin.entityManager.getEntity(conn.from_id);
              const toEntity = this.plugin.entityManager.getEntity(conn.to_id);
              if (fromEntity && toEntity) {
                await this.plugin.entityManager.addRelationshipToNote(fromEntity, toEntity, conn.relationship);
                connectionsCreated++;
              } else {
                console.warn(`[GraphOnlyMode] Cannot connect: from=${conn.from_id} to=${conn.to_id} - entity not found`);
              }
            } catch (connErr) {
              console.error(`[GraphOnlyMode] Failed to connect entities:`, connErr);
            }
          }
        }
      }

      updateProgress("Finalizing...", 98);

      // Build the result message with clickable links
      let resultContent = `🏷️ **Graph Operations Complete**\n\n`;
      resultContent += `**Input:** ${inputText.substring(0, 200)}${inputText.length > 200 ? '...' : ''}\n\n`;

      if (createdEntities.length > 0 || deletedEntitiesCount > 0 || updatedEntitiesCount > 0 || deletedConnectionsCount > 0 || connectionsCreated > 0) {
        // Store entities in chat history for rendering clickable graph view links
        this.chatHistory[messageIndex].createdEntities = createdEntities;
        this.chatHistory[messageIndex].connectionsCreated = connectionsCreated;

        if (createdEntities.length > 0) {
          resultContent += `\n- **Entities Created:** ${createdEntities.length}`;
        }
        if (connectionsCreated > 0) {
          resultContent += `\n- **Relationships Created:** ${connectionsCreated}`;
        }
        if (deletedEntitiesCount > 0) {
          resultContent += `\n- **Entities Deleted:** ${deletedEntitiesCount}`;
        }
        if (deletedConnectionsCount > 0) {
          resultContent += `\n- **Relationships Deleted:** ${deletedConnectionsCount}`;
        }
        if (updatedEntitiesCount > 0) {
          resultContent += `\n- **Entities Updated:** ${updatedEntitiesCount}`;
        }
      } else {
        resultContent += `No operations were performed.`;
      }

      // Clear progress bar and show final result
      this.chatHistory[messageIndex].progress = undefined;
      this.chatHistory[messageIndex].content = resultContent;
      await this.renderMessages();

      if (createdEntities.length > 0 || deletedEntitiesCount > 0 || updatedEntitiesCount > 0 || deletedConnectionsCount > 0) {
        const parts = [];
        if (createdEntities.length > 0) parts.push(`${createdEntities.length} entities created`);
        if (connectionsCreated > 0) parts.push(`${connectionsCreated} relationships`);
        if (deletedEntitiesCount > 0) parts.push(`${deletedEntitiesCount} deleted`);
        if (updatedEntitiesCount > 0) parts.push(`${updatedEntitiesCount} updated`);

        new Notice(`Graph updated: ${parts.join(', ')}`);

        // Refresh or open graph view after modifications
        await this.plugin.refreshOrOpenGraphView();
      }

    } catch (error) {
      this.activeAbortControllers.delete(messageIndex); // Ensure controller is cleared on error
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Handle user cancellation gracefully
      if (errorMsg === 'Cancelled by user' || errorMsg.includes('Aborted') || errorMsg.includes('Request was cancelled')) {
        return; // UI already handled by handleCancel
      }

      this.chatHistory[messageIndex].progress = undefined; // Clear progress bar on error
      this.chatHistory[messageIndex].content =
        `🏷️ **Graph Generation Failed**\n\n` +
        `**Input:** ${inputText.substring(0, 100)}${inputText.length > 100 ? '...' : ''}\n\n` +
        `**Error:** ${errorMsg}`;
      await this.renderMessages();
      new Notice(`Graph generation failed: ${errorMsg}`);
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
    await this.renderMessages();

    // Helper to update progress
    // Helper to update progress
    const updateProgress = (message: string, percent: number) => {
      // Check if cancelled
      if (this.activeAbortControllers.has(assistantIndex)) {
        this.chatHistory[assistantIndex].progress = { message, percent };
        this.updateProgressBar(assistantIndex, { message, percent });
      }
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
      // Create new abort controller for this operation
      const controller = new AbortController();
      this.activeAbortControllers.set(assistantIndex, controller);

      updateProgress("Extracting entities from query...", 15);

      // 1) Extract entities (multi-entity support)
      const extractedEntities = await this.plugin.extractEntitiesFromQuery(query);

      let entityMsg = "No specific entities identified. Searching vault...";
      if (extractedEntities.length > 0) {
        const names = extractedEntities
          .filter(e => e.name)
          .map(e => `${e.type}: ${e.name}`)
          .join(", ");
        entityMsg = `Entities defined (${names}). Searching vault & graph...`;
      }

      this.chatHistory[assistantIndex].content = entityMsg;
      updateProgress("Entities extracted, searching vault...", 30);

      // 2) Local search (Notes)
      // Base search uses the original query
      let notes = this.plugin.retrieveNotes(query);

      // Merge unique notes if we want to search by entity name specifically?
      // For now, let's keep it simple and stick to the query, as retrieveNotes does fuzzy matching.
      // If result count is low, we could try searching for specific entity names.
      if (notes.length < 3 && extractedEntities.length > 0) {
        for (const entity of extractedEntities) {
          if (entity.name) {
            const extraNotes = this.plugin.retrieveNotes(entity.name);
            // Deduplicate by path
            const existingPaths = new Set(notes.map(n => n.path));
            for (const note of extraNotes) {
              if (!existingPaths.has(note.path)) {
                notes.push(note);
                existingPaths.add(note.path);
              }
            }
          }
        }
      }

      // 3) Graph Context & Pinpointing Preparation
      updateProgress("Checking Knowledge Graph...", 40);
      let graphContext = "";
      const graphEntityIds = new Set<string>(); // IDs of entities included in context

      if (extractedEntities.length > 0) {
        const addedConnections = new Set<string>();

        for (const extracted of extractedEntities) {
          if (!extracted.name) continue;
          const entity = this.plugin.entityManager.findEntityByLabel(extracted.name);

          if (entity) {
            // Get connections
            const connections = this.plugin.entityManager.getConnectionsForEntity(entity.id);

            for (const conn of connections) {
              const source = this.plugin.entityManager.getEntity(conn.fromEntityId);
              const target = this.plugin.entityManager.getEntity(conn.toEntityId);

              if (source && target) {
                // Include IDs in context so the AI can cite them
                const triple = `[${source.label}] (ID:${source.id}) --(${conn.relationship})--> [${target.label}] (ID:${target.id})`;

                if (!addedConnections.has(triple)) {
                  graphContext += "- " + triple + "\n";
                  addedConnections.add(triple);
                  graphEntityIds.add(source.id);
                  graphEntityIds.add(target.id);
                }
              }
            }
          }
        }
      }

      let additionalContext = "";
      if (graphContext.length > 0) {
        additionalContext = "Knowledge Graph Connections:\n" + graphContext +
          "\nIMPORTANT INSTRUCTION: If you use any relationship facts from the 'Knowledge Graph Connections' section above to answer the user's question, you MUST cite the Entity IDs used at the very end of your response. Use this exact format: `[[USED_ENTITY_ID: <ID>]]`. List each used entity ID. Do not output this for note citations, ONLY for graph entities found in the Knowledge Graph section.\n";
      }

      if (notes.length === 0 && graphContext.length === 0) {
        this.chatHistory[assistantIndex].progress = undefined;
        this.chatHistory[assistantIndex].content = entityMsg + "\n\nNo relevant notes or graph connections found.";
        this.chatHistory[assistantIndex].notes = [];
        await this.renderMessages();
        return;
      }

      updateProgress(`Found ${notes.length} notes & ${graphEntityIds.size} related entities...`, 50);

      // Update with process messages (English)
      baseStatusText =
        entityMsg +
        `\n\nFound ${notes.length} relevant notes and ${graphEntityIds.size} graph connections.\nDrafting the answer...\n\n`;
      this.chatHistory[assistantIndex].content = baseStatusText;
      this.chatHistory[assistantIndex].notes = notes;
      await this.renderMessages();

      updateProgress("Generating response...", 60);

      // 4) Stream model answer
      const contentEl = getLastAssistantContentEl();
      let streamed = "";
      let streamProgress = 60;

      const onRetry = (attempt: number, maxAttempts: number) => {
        updateProgress(`Network interrupted. Retrying... (${attempt}/${maxAttempts})`, streamProgress);
        this.chatHistory[assistantIndex].content = baseStatusText + `⚠️ Network interrupted. Retrying... (${attempt}/${maxAttempts})`;
        void this.renderMessages();
      };

      const onDelta = (delta: string) => {
        streamed += delta;
        // Simple progress simulation based on length
        if (streamProgress < 95) {
          streamProgress += 0.5;
          updateProgress("Streaming response...", Math.min(95, streamProgress));
        }

        // Update UI
        if (contentEl) {
          // We can optionally hide the [[USED_ENTITY_ID:...]] tags in real-time if desired, 
          // but let's just show raw output for now and clean up at the end.
          MarkdownRenderer.renderMarkdown(streamed, contentEl, "", this.plugin);
          // Scroll to bottom
          const scrollContainer = this.messagesContainer.parentElement;
          if (scrollContainer) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
          }
        }
      };

      const result = await this.plugin.askVaultStream(
        query,
        onDelta,
        notes,
        onRetry,
        additionalContext,
        controller.signal
      );

      // Clear controller on completion
      this.activeAbortControllers.delete(assistantIndex);

      // 5) Post-process response for Pinpointing
      let finalContent = result.fullAnswer;
      const usedEntityIds = new Set<string>();

      // Extract used entity IDs
      const idRegex = /\[\[USED_ENTITY_ID:\s*([a-zA-Z0-9-]+)\]\]/g;
      let match;
      while ((match = idRegex.exec(finalContent)) !== null) {
        usedEntityIds.add(match[1]);
      }

      // Remove tags from content
      finalContent = finalContent.replace(idRegex, "").trim();

      // Build usedEntities array
      const usedEntities: { id: string, label: string, type: string }[] = [];
      for (const id of usedEntityIds) {
        const entity = this.plugin.entityManager.getEntity(id);
        if (entity) {
          usedEntities.push({
            id: entity.id,
            label: entity.label,
            type: entity.type
          });
        }
      }

      this.chatHistory[assistantIndex].content = finalContent; // Clean content
      this.chatHistory[assistantIndex].progress = undefined;
      this.chatHistory[assistantIndex].usedEntities = usedEntities; // Pinpointed entities

      await this.saveCurrentConversation();
      await this.renderMessages();

      // Graph Generation Mode: Extract and create entities from the AI response
      if (this.graphGenerationMode) {
        try {
          await this.processGraphGeneration(assistantIndex, result.fullAnswer, query, finalContent);
        } catch (graphError) {
          console.error("[OSINT Copilot] Graph generation from chat failed:", graphError);
          new Notice("Graph generation failed, but the chat response was received successfully.");
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar on error
      this.chatHistory[assistantIndex].content = `Error: ${errorMsg}\n\n💡 Tip: Your message was saved. You can try sending it again.`;
      await this.renderMessages();

      // Restore the query to the input field so user can retry
      this.inputEl.value = query;
    }
  }

  /**
   * Process graph generation from AI response text.
   * Calls the /api/process-text endpoint to extract entities and creates them via EntityManager.
   */
  async processGraphGeneration(
    assistantIndex: number,
    aiResponse: string,
    originalQuery: string,
    currentContent: string,
    modifyOnly: boolean = false
  ) {
    // Helper to update progress
    const updateProgress = (message: string, percent: number) => {
      this.chatHistory[assistantIndex].progress = { message, percent };
      this.updateProgressBar(assistantIndex, { message, percent });
    };

    try {
      // Fetch latest content dynamically to avoid overwriting updates from report generation
      // This fixes the race condition where "Report Generated Successfully" gets overwritten
      // by stale "Processing..." content passed as an argument.
      const latestContent = this.chatHistory[assistantIndex].content || currentContent;

      updateProgress("Extracting entities from response...", 10);
      let statusText = latestContent + "\n\n🏷️ Extracting entities...";
      this.chatHistory[assistantIndex].content = statusText;
      await this.renderMessages();

      // Use explicit entity extraction instruction to ensure AI returns operations, not analysis
      const textToProcess = `Extract all entities (people, companies, locations, events) and their relationships from the following content. Create entities for each person, company, location, and event mentioned. Return JSON operations to create entities, do NOT provide analysis or summary.\n\nOriginal Query: ${originalQuery}\n\nContent to extract entities from:\n${aiResponse}`;

      // Get existing entities to avoid duplicates
      const existingEntities = this.plugin.entityManager.getAllEntities();

      // Retry callback to show status to user during entity extraction
      const onRetry = (attempt: number, maxAttempts: number, reason: string, nextDelayMs: number) => {
        const delaySeconds = Math.round(nextDelayMs / 1000);
        let reasonText = 'Network interrupted';
        if (reason === 'timeout') {
          reasonText = 'Request takes longer than usual, please wait';
        } else if (reason === 'network') {
          reasonText = 'Network connection lost';
        } else if (reason.startsWith('server-error')) {
          reasonText = 'Server temporarily unavailable';
        } else if (reason === 'rate-limited') {
          reasonText = 'Rate limited';
        }
        const retryMsg = `\n\n⚠️ ${reasonText}. Retrying in ${delaySeconds}s... (attempt ${attempt + 1}/${maxAttempts})`;
        // Append to existing content, don't overwrite with stale currentContent
        const existingContent = this.chatHistory[assistantIndex].content || "";
        this.chatHistory[assistantIndex].content = existingContent + retryMsg;
        void this.renderMessages();
      };

      // Chunk progress callback to show user which chunk is being processed
      const onChunkProgress = (chunkIndex: number, totalChunks: number, message: string) => {
        const chunkPercent = 10 + Math.round((chunkIndex / totalChunks) * 30);
        updateProgress(`📦 ${message}`, chunkPercent);
      };

      updateProgress("Sending to AI for entity extraction...", 15);

      // Call the API to extract entities with retry and chunking support
      // Create new abort controller for this operation
      const controller = new AbortController();
      this.activeAbortControllers.set(assistantIndex, controller);

      // Gather existing connections for modification mode
      const isModify = modifyOnly || this.graphModificationMode;
      const existingConnections = isModify
        ? this.plugin.entityManager.getAllConnections().map(c => ({
          from: c.fromEntityId,
          to: c.toEntityId,
          relationship: c.relationship
        }))
        : undefined;

      const result: ProcessTextResponse = await this.plugin.graphApiService.processTextInChunks(
        textToProcess,
        existingEntities,
        undefined,
        onChunkProgress,
        onRetry,
        controller.signal,
        isModify,
        existingConnections
      );

      // Clear controller on completion
      this.activeAbortControllers.delete(assistantIndex);

      updateProgress("Processing extraction results...", 40);

      if (!result.success) {
        this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar
        const errorContent = this.chatHistory[assistantIndex].content || "";
        this.chatHistory[assistantIndex].content = errorContent +
          `\n\n⚠️ Entity extraction failed: ${result.error || 'Unknown error'}`;
        await this.renderMessages();
        return;
      }

      if (!result.operations || result.operations.length === 0) {
        this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar
        const warningContent = this.chatHistory[assistantIndex].content || "";
        this.chatHistory[assistantIndex].content = warningContent +
          "\n\n🏷️ No new entities detected in the response.";
        await this.renderMessages();
        return;
      }

      updateProgress("Creating entities...", 50);

      // Process the operations and create entities
      // Store entity info with file paths and IDs for clickable links
      const createdEntities: Array<{ id: string; type: string; label: string; filePath: string }> = [];
      let connectionsCreated = 0;
      let deletedEntitiesCount = 0;
      let deletedConnectionsCount = 0;
      let updatedEntitiesCount = 0;

      // Count total entities for progress tracking
      let totalEntities = 0;
      for (const op of result.operations) {
        if (op.action === "create" && op.entities) {
          totalEntities += op.entities.length;
        }
      }
      let processedEntities = 0;

      // Debug: Log the full operations array
      console.debug('[GraphGeneration] Processing operations:', JSON.stringify(result.operations, null, 2));

      for (const operation of result.operations) {
        // Debug: Log each operation
        console.debug('[GraphGeneration] Processing operation:', {
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
            console.debug('[GraphGeneration] Processing entity:', {
              type: entityData.type,
              properties: entityData.properties
            });

            try {
              const entityType = entityData.type as EntityType;
              // Validate entity type
              if (!Object.values(EntityType).includes(entityType)) {
                console.warn(`[GraphGeneration] Unknown entity type: ${entityData.type}. Valid types:`, Object.values(EntityType));
                operationEntities.push(null);
                continue;
              }

              // Validate entity name is not generic
              const config = ENTITY_CONFIGS[entityType];
              const labelField = config?.labelField;
              const entityLabel = labelField ? entityData.properties[labelField] : null;

              if (entityLabel) {
                const nameValidation = validateEntityName(entityLabel as string, entityType);
                if (!nameValidation.isValid) {
                  console.warn(`[GraphGeneration] Skipping entity with generic name: "${entityLabel}" - ${nameValidation.error}`);
                  operationEntities.push(null);
                  continue;
                }
              }

              console.debug('[GraphGeneration] Creating entity with type:', entityType);
              const entity = await this.plugin.entityManager.createEntity(
                entityType,
                entityData.properties
              );
              console.debug('[GraphGeneration] Entity created successfully:', {
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
              console.error('[GraphGeneration] Failed to create entity:', entityError);
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
                console.error('[GraphGeneration] Failed to create connection:', connError);
              }
            }
          }
        } else if (operation.action === "delete" && operation.deletions) {
          updateProgress("Processing deletions...", 90);
          for (const deletionId of operation.deletions) {
            try {
              if (this.plugin.entityManager.getEntity(deletionId)) {
                await this.plugin.entityManager.deleteEntity(deletionId);
                deletedEntitiesCount++;
              } else if (this.plugin.entityManager.getConnection(deletionId)) {
                await this.plugin.entityManager.deleteConnectionWithNote(deletionId);
                deletedConnectionsCount++;
              } else {
                console.warn(`[GraphGeneration] Element to delete not found: ${deletionId}`);
              }
            } catch (delErr) {
              console.error(`[GraphGeneration] Failed to delete element ${deletionId}:`, delErr);
            }
          }
        } else if (operation.action === "update" && operation.updates) {
          updateProgress("Applying updates...", 92);
          for (const update of operation.updates) {
            try {
              if (update.id && this.plugin.entityManager.getEntity(update.id)) {
                await this.plugin.entityManager.updateEntity(update.id, update.new_properties || {});
                updatedEntitiesCount++;
              }
            } catch (updErr) {
              console.error(`[GraphGeneration] Failed to update entity ${update.id}:`, updErr);
            }
          }
        } else if (operation.action === "connect" && operation.new_connections) {
          updateProgress("Connecting entities...", 93);
          for (const conn of operation.new_connections) {
            try {
              const fromEntity = this.plugin.entityManager.getEntity(conn.from_id);
              const toEntity = this.plugin.entityManager.getEntity(conn.to_id);
              if (fromEntity && toEntity) {
                await this.plugin.entityManager.addRelationshipToNote(fromEntity, toEntity, conn.relationship);
                connectionsCreated++;
              } else {
                console.warn(`[GraphGeneration] Cannot connect: from=${conn.from_id} to=${conn.to_id} - entity not found`);
              }
            } catch (connErr) {
              console.error(`[GraphGeneration] Failed to connect entities:`, connErr);
            }
          }
        }
      }

      updateProgress("Finalizing...", 95);

      // Update the message with entity creation/modification results including clickable links
      if (createdEntities.length > 0 || deletedEntitiesCount > 0 || updatedEntitiesCount > 0 || deletedConnectionsCount > 0 || connectionsCreated > 0) {
        // Store entities in chat history for rendering clickable graph view links
        this.chatHistory[assistantIndex].createdEntities = createdEntities;
        this.chatHistory[assistantIndex].connectionsCreated = connectionsCreated;

        // Build a simple summary message - the actual clickable links will be rendered by renderMessages
        let resultMsg = `\n\n🏷️ **Graph Operations Complete:**`;
        if (createdEntities.length > 0) {
          resultMsg += `\n- **Entities Created:** ${createdEntities.length}`;
        }
        if (connectionsCreated > 0) {
          resultMsg += `\n- **Relationships Created:** ${connectionsCreated}`;
        }
        if (deletedEntitiesCount > 0) {
          resultMsg += `\n- **Entities Deleted:** ${deletedEntitiesCount}`;
        }
        if (deletedConnectionsCount > 0) {
          resultMsg += `\n- **Relationships Deleted:** ${deletedConnectionsCount}`;
        }
        if (updatedEntitiesCount > 0) {
          resultMsg += `\n- **Entities Updated:** ${updatedEntitiesCount}`;
        }

        this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar

        // Fetch latest content dynamically to avoid overwriting updates from report generation
        const successContent = this.chatHistory[assistantIndex].content || "";
        this.chatHistory[assistantIndex].content = successContent + resultMsg;

        // Refresh or open graph view after modifications
        await this.plugin.refreshOrOpenGraphView();
      } else {
        this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar
        const noEntitiesContent = this.chatHistory[assistantIndex].content || "";
        this.chatHistory[assistantIndex].content = noEntitiesContent + "\n\n🏷️ No entities were created or modified.";
      }
      await this.renderMessages();

    } catch (error) {
      console.error('[GraphGeneration] Error during graph generation:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar on error
      this.chatHistory[assistantIndex].content = currentContent +
        `\n\n⚠️ Graph generation error: ${errorMsg}`;
      await this.renderMessages();
    }
  }

  async handleReportGeneration(description: string) {
    // Add status placeholder
    const messageIndex = this.chatHistory.length;
    this.chatHistory.push({
      role: "assistant",
      content: "📄 Generating report, 3-6 mins, don\'t close the tab",
      progress: { message: "Initializing research...", percent: 5 }
    });
    await this.renderMessages();

    try {
      // Create new abort controller for this operation
      const controller = new AbortController();
      this.activeAbortControllers.set(messageIndex, controller);

      // Generate report with status updates, progress, and intermediate results
      // Pass current conversation so it can use and update reportConversationId
      const reportData = await this.plugin.generateReport(
        description,
        this.currentConversation,
        (status: string, progress?: { message: string; percent: number }, intermediateResults?: string[]) => {
          // Build status message with progress and intermediate results
          let statusDisplay = status;
          if (status === "processing") statusDisplay = "Generating report...";
          if (status === "queued") statusDisplay = "Queued for processing...";

          let statusMessage = `📄 ${statusDisplay}`;

          if (progress) {
            statusMessage = `📄 ${progress.message}`;
            console.info(`[OSINT Copilot] Report progress update: ${progress.percent}% - ${progress.message}`);
          } else {
            console.info(`[OSINT Copilot] Report status update: ${status}`);
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
        },
        controller.signal
      );

      // Clear controller on completion
      this.activeAbortControllers.delete(messageIndex);

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
        `📄 **Companies&People Generated Successfully!**\n\n` +
        `**Request:** ${description}\n\n` +
        `**Saved to:** \`${fileName}\`\n\n` +
        `---\n\n` +
        reportData.content;
      this.chatHistory[messageIndex].content = finalContent;
      this.chatHistory[messageIndex].reportFilePath = fileName; // Store report file path for button
      await this.renderMessages();

      // Graph Generation Mode: Extract and create entities from the report
      if (this.graphGenerationMode) {
        try {
          await this.processGraphGeneration(messageIndex, reportData.content, description, finalContent);
        } catch (graphError) {
          console.error("[OSINT Copilot] Graph generation from report failed:", graphError);
          // Don't re-throw - we want to keep the successfully generated report
          new Notice("Graph generation failed, but the report was saved successfully.");
        }
      }

      // Open the report file
      const file = this.app.vault.getAbstractFileByPath(fileName);
      if (file instanceof TFile) {
        await this.app.workspace.getLeaf().openFile(file);
      }

      new Notice(`Companies&People saved to ${fileName}`);
    } catch (error) {
      this.activeAbortControllers.delete(messageIndex); // Ensure controller is cleared on error
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Handle user cancellation gracefully
      if (errorMsg === 'Cancelled by user' || errorMsg.includes('Aborted')) {
        return; // UI already handled by handleCancel
      }

      // Provide user-friendly error messages for common issues
      let userMessage = errorMsg;
      let suggestion = "";

      if (errorMsg.toLowerCase().includes("ssl") || errorMsg.toLowerCase().includes("certificate")) {
        userMessage = "Backend service temporarily unavailable (SSL/certificate issue)";
        suggestion = "\n\n💡 **Suggestion:** This is a temporary server-side issue. Please try again in a few minutes.";
      } else if (errorMsg.toLowerCase().includes("timeout")) {
        userMessage = "Companies&People generation timed out";
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
        `📄 **Companies&People Generation Failed**\n\n` +
        `**Request:** ${description}\n\n` +
        `**Error:** ${userMessage}${suggestion}`;
      await this.renderMessages();
      new Notice(`Companies&People generation failed: ${userMessage}`);
    }
  }

  /**
   * Handle Digital Footprint Mode: AI-powered multi-provider OSINT search.
   */
  async handleOSINTSearch(query: string) {
    // Add processing placeholder with progress bar
    const messageIndex = this.chatHistory.length;
    this.chatHistory.push({
      role: "assistant",
      content: "🔎 Searching OSINT databases...",
      progress: { message: "Analyzing query...", percent: 10 },
    });
    await this.renderMessages();

    // Helper to update progress
    const updateProgress = (message: string, percent: number) => {
      // Check if cancelled
      if (this.activeAbortControllers.has(messageIndex)) {
        this.chatHistory[messageIndex].progress = { message, percent };
        this.chatHistory[messageIndex].content = `🔎 ${message}`;
        this.updateProgressBar(messageIndex, { message, percent });
      }
    };

    try {
      // Check for API key
      if (!this.plugin.settings.reportApiKey) {
        this.chatHistory[messageIndex].progress = undefined;
        this.chatHistory[messageIndex].content =
          `🔎 **Digital Footprint Failed**\n\n` +
          `**Error:** License key required for Digital Footprint.\n\n` +
          `Please configure your API key in Settings → OSINT Copilot → API Key.`;
        await this.renderMessages();
        new Notice("License key required for leak search. Configure in settings.");
        return;
      }

      updateProgress("Detecting entities in query...", 20);

      // Build search request
      const searchRequest: AISearchRequest = {
        query: query,
        country: this.osintSearchCountry,
        max_providers: this.osintSearchMaxProviders,
        parallel: this.osintSearchParallel
      };

      // Retry callback for progress updates
      const onRetry = (attempt: number, maxAttempts: number, reason: string, nextDelayMs: number) => {
        const delaySeconds = Math.round(nextDelayMs / 1000);
        let reasonText = 'Network interrupted';
        if (reason === 'timeout') {
          reasonText = 'Request takes longer than usual, please wait';
        } else if (reason === 'network') {
          reasonText = 'Network connection lost';
        } else if (reason.startsWith('server-error')) {
          reasonText = 'Server temporarily unavailable';
        } else if (reason === 'rate-limited') {
          reasonText = 'Rate limited';
        }
        updateProgress(`⚠️ ${reasonText}. Retrying in ${delaySeconds}s... (${attempt + 1}/${maxAttempts})`, 40);
      };

      updateProgress("Searching OSINT databases...", 50);

      // Create new abort controller for this operation
      const controller = new AbortController();
      this.activeAbortControllers.set(messageIndex, controller);

      // Call the AI search API
      const result: AISearchResponse = await this.plugin.graphApiService.aiSearch(
        searchRequest,
        onRetry,
        controller.signal
      );

      // Clear controller on completion
      this.activeAbortControllers.delete(messageIndex);

      updateProgress("Processing results...", 80);

      // Render the search results and get the content for entity extraction
      const searchResultsContent = this.renderOSINTSearchResults(messageIndex, query, result);

      // Graph Generation Mode: Extract and create entities from search results
      if (this.graphGenerationMode && result.results && result.results.length > 0) {
        try {
          // Convert search results to text for entity extraction
          const resultsText = this.formatOSINTResultsForEntityExtraction(query, result);
          await this.processGraphGeneration(messageIndex, resultsText, query, searchResultsContent);
        } catch (entityError) {
          // Log error but don't fail the whole operation - search results are already displayed
          console.error('[ChatView] Graph generation from OSINT results failed:', entityError);
          const errorMsg = entityError instanceof Error ? entityError.message : String(entityError);
          this.chatHistory[messageIndex].content = searchResultsContent +
            `\n\n⚠️ Graph generation failed: ${errorMsg}`;
          this.chatHistory[messageIndex].progress = undefined;
          await this.renderMessages();
        }
      }

    } catch (error) {
      this.activeAbortControllers.delete(messageIndex); // Ensure controller is cleared on error
      console.error('[ChatView] Digital Footprint error:', error);
      this.chatHistory[messageIndex].progress = undefined;

      let errorMessage = error instanceof Error ? error.message : String(error);

      // Handle user cancellation gracefully
      if (errorMessage === 'Cancelled by user' || errorMessage.includes('Aborted')) {
        return; // UI already handled by handleCancel
      }

      let suggestion = '';

      if (errorMessage.includes('timeout')) {
        suggestion = '\n\n💡 Try reducing the number of providers or simplifying your query.';
      } else if (errorMessage.includes('unavailable')) {
        suggestion = '\n\n💡 The service may be temporarily down. Please try again later.';
      } else if (errorMessage.includes('Authentication') || errorMessage.includes('API key')) {
        suggestion = '\n\n💡 Please check your API key in Settings → OSINT Copilot → API Key.';
      }

      this.chatHistory[messageIndex].content =
        `🔎 **Digital Footprint Failed**\n\n` +
        `**Query:** ${query}\n\n` +
        `**Error:** ${errorMessage}${suggestion}`;
      await this.renderMessages();
      new Notice(`Digital Footprint failed: ${errorMessage}`);
    }
  }

  /**
   * Render OSINT search results in a structured format.
   * Returns the content string for use in entity extraction.
   */
  private renderOSINTSearchResults(messageIndex: number, query: string, result: AISearchResponse): string {
    this.chatHistory[messageIndex].progress = undefined;

    // Build the result content
    let content = `🔎 **Digital Footprint Results**\n\n`;
    content += `**Query:** ${query}\n`;
    content += `⏱️ ${(result.execution_time_ms / 1000).toFixed(1)}s | 📊 ${result.total_results} result(s)\n\n`;

    // Detected Entities section
    if (result.detected_entities && result.detected_entities.length > 0) {
      content += `---\n\n### 📋 Detected Entities\n\n`;
      for (const entity of result.detected_entities) {
        const icon = this.getEntityTypeIcon(entity.type);
        const confidence = Math.round(entity.confidence * 100);
        content += `${icon} **${entity.type}:** \`${entity.value}\` (${confidence}% confidence)\n`;
      }
      content += '\n';
    } else {
      content += `---\n\n### 📋 Detected Entities\n\n`;
      content += `⚠️ No searchable entities detected in your query.\n`;
      content += `Try including an email, phone, name, or other identifier.\n\n`;
    }

    // Results section
    if (result.results && result.results.length > 0) {
      content += `---\n\n### 📊 Results\n\n`;

      // Render each result item from the results array
      for (let i = 0; i < result.results.length; i++) {
        const item = result.results[i];
        content += `**Result ${i + 1}:**\n`;
        content += '```json\n';
        content += JSON.stringify(item, null, 2);
        content += '\n```\n\n';
      }
    } else if (result.detected_entities && result.detected_entities.length > 0) {
      content += `---\n\n### 📊 Results\n\n`;
      content += `No results found.\n\n`;
    }

    // Explanation section
    if (result.explanation) {
      content += `---\n\n### 💡 Explanation\n\n`;
      content += `${result.explanation}\n`;
    }

    this.chatHistory[messageIndex].content = content;
    void this.renderMessages();
    return content;
  }

  /**
   * Format OSINT search results for entity extraction.
   * Converts the JSON results into a text format suitable for the AI entity extraction.
   */
  private formatOSINTResultsForEntityExtraction(query: string, result: AISearchResponse): string {
    let text = `Digital Footprint Results for query: "${query}"\n\n`;

    // Include detected entities from the search
    if (result.detected_entities && result.detected_entities.length > 0) {
      text += "Detected search entities:\n";
      for (const entity of result.detected_entities) {
        text += `- ${entity.type}: ${entity.value}\n`;
      }
      text += "\n";
    }

    // Include the raw results data
    if (result.results && result.results.length > 0) {
      text += `Found ${result.total_results} results:\n\n`;
      for (let i = 0; i < result.results.length; i++) {
        const item = result.results[i];
        text += `Result ${i + 1}:\n`;
        text += JSON.stringify(item, null, 2);
        text += "\n\n";
      }
    }

    // Include the explanation
    if (result.explanation) {
      text += `\nExplanation: ${result.explanation}\n`;
    }

    return text;
  }

  /**
   * Get icon for entity type in OSINT search results.
   */
  private getEntityTypeIcon(entityType: string): string {
    const icons: Record<string, string> = {
      'email': '📧',
      'phone': '📞',
      'name': '👤',
      'ip': '🌐',
      'domain': '🔗',
      'passport': '🛂',
      'inn': '💳',
      'snils': '🆔',
      'address': '📍',
      'auto': '🚗',
      'ogrn': '🏢',
    };
    return icons[entityType.toLowerCase()] || '📦';
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
    await this.renderMessages();

    // Helper to update progress
    const updateProgress = (message: string, percent: number) => {
      this.chatHistory[messageIndex].progress = { message, percent };
      this.updateProgressBar(messageIndex, { message, percent });
    };

    const maxRetries = 3;
    const baseDelayMs = 1000;
    let lastError: Error | null = null;

    // Create new abort controller for this operation
    const controller = new AbortController();
    this.activeAbortControllers.set(messageIndex, controller);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Check cancellation before each attempt
      if (controller.signal.aborted) {
        this.activeAbortControllers.delete(messageIndex);
        return;
      }
      try {
        updateProgress("Connecting to dark web API...", 10);

        // Start DarkWeb investigation
        const endpoint = `${REPORT_API_BASE_URL}/api/darkweb/investigate`;
        const response: RequestUrlResponse = await requestUrl({
          url: endpoint,
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
          throw: false,
        });

        if (response.status < 200 || response.status >= 300) {
          const errorText = response.text || "";

          // Handle quota exhaustion specifically - don't retry these
          if (response.status === 403) {
            const lowerError = errorText.toLowerCase();
            if (lowerError.includes("quota") || lowerError.includes("exceeded")) {
              throw new Error(
                "Investigation credits exhausted. Please upgrade your plan or wait for credit renewal. Visit https://osint-copilot.com/dashboard/ to manage your subscription."
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
        const result = response.json;
        const jobId = result.job_id;

        if (!jobId) {
          throw new Error("No job ID returned from DarkWeb API");
        }

        updateProgress("Investigation started, searching dark web engines...", 20);
        console.debug(`[OSINT Copilot] Dark web investigation started with Job ID: ${jobId}`);

        // Update message and start polling (Job ID stored internally but not shown to user)
        this.chatHistory[messageIndex] = {
          role: "assistant",
          content: `🕵️ Dark web investigation started\n\n**Query:** ${query}\n**Status:** Processing\n**Estimated time:** 2-3 minutes\n\nSearching 15+ dark web engines...`,
          jobId: jobId,
          status: "processing",
          query: query, // Store query for later use when saving report
          progress: { message: "Searching dark web engines...", percent: 20 },
        };
        await this.renderMessages();

        // Start polling for status (pass query for report saving)
        this.pollDarkWebStatus(jobId, messageIndex, query);
        return; // Success, exit the retry loop

      } catch (error) {
        // If aborted during initial request (rare but possible if we implemented abortable fetch)
        if (this.activeAbortControllers.has(messageIndex) && this.activeAbortControllers.get(messageIndex)?.signal.aborted) {
          return;
        }
        lastError = error instanceof Error ? error : new Error(String(error));

        // Only retry on transient network errors
        if (!this.plugin.isTransientNetworkError(lastError)) {
          break;
        }

        // Don't retry on the last attempt
        if (attempt < maxRetries) {
          const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
          console.debug(`[OSINT Copilot] DarkWeb API network error, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})`);

          updateProgress(`Network error. Retrying... (${attempt}/${maxRetries})`, 8);
          // Show retry status to user
          this.chatHistory[messageIndex] = {
            role: "assistant",
            content: `🕵️ Starting dark web investigation...\n\n⚠️ Network interrupted. Retrying... (${attempt}/${maxRetries})`,
            status: "starting",
          };
          await this.renderMessages();

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
    await this.renderMessages();

    // Restore the query to the input field so user can retry
    this.inputEl.value = query;
    this.activeAbortControllers.delete(messageIndex);
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
    const maxElapsedMs = 10 * 60 * 1000; // 10 minutes max timeout (dark web searches can take longer)

    // Adaptive polling: start fast (3s), gradually increase to max (8s) as job takes longer
    const getPollingInterval = (elapsed: number): number => {
      if (elapsed < 20000) return 3000;      // First 20s: poll every 3s (fast feedback)
      if (elapsed < 60000) return 5000;      // 20s-60s: poll every 5s
      return 8000;                            // After 60s: poll every 8s (reduce load)
    };

    const poll = async () => {
      // Check cancellation
      if (!this.activeAbortControllers.has(messageIndex)) {
        this.pollingIntervals.delete(jobId);
        return;
      }

      // Check if we've exceeded the maximum elapsed time
      if (elapsedMs >= maxElapsedMs) {
        this.pollingIntervals.delete(jobId);
        console.warn(`[OSINT Copilot] Dark web investigation timed out after ${Math.round(maxElapsedMs / 1000)}s`);
        this.chatHistory[messageIndex] = {
          role: "assistant",
          content: `⏱️ Dark web investigation timed out\n\n**Job ID:** ${jobId}\n\nThe investigation is taking longer than expected (${Math.round(maxElapsedMs / 60000)} minutes).\n\nThe job may still be processing on the server. You can try checking the status later or contact support.`,
          jobId: jobId,
          status: "timeout",
          progress: undefined,
        };
        await this.renderMessages();
        return;
      }

      try {
        const endpoint = `${REPORT_API_BASE_URL}/api/darkweb/status/${jobId}`;

        // Use Obsidian's requestUrl to bypass CORS restrictions
        const response: RequestUrlResponse = await requestUrl({
          url: endpoint,
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.plugin.settings.reportApiKey}`,
          },
          throw: false,
        });

        if (response.status < 200 || response.status >= 300) {
          // Handle 404 - job not found (backend lost job status, likely Redis issue)
          if (response.status === 404) {
            this.pollingIntervals.delete(jobId);
            console.warn(`[OSINT Copilot] Job ${jobId} not found in backend (404). Attempting to fetch results directly...`);

            // Try to fetch results directly from summary endpoint
            // The job may have completed but status was lost
            try {
              await this.fetchDarkWebResults(jobId, messageIndex, query);
              // Clean up controller is handled in fetchDarkWebResults or here?
              // fetchDarkWebResults is async/recursive-ish via poll? No, it's a separate call.
              // Actually fetchDarkWebResults handles completion.
              // But we should clear it here if it returns successfully?
              // Let's rely on fetchDarkWebResults to clear it or clear it here if it returns.
              this.activeAbortControllers.delete(messageIndex);
              return; // Success - results fetched
            } catch (summaryError) {
              console.error('[OSINT Copilot] Failed to fetch results after 404:', summaryError);
              this.chatHistory[messageIndex] = {
                role: "assistant",
                content: `⚠️ Investigation status unavailable\n\n**Job ID:** ${jobId}\n\nThe backend lost track of this investigation (likely due to a Redis connection issue).\n\nThe investigation may have completed, but the results are not accessible. Please try starting a new investigation.`,
                jobId: jobId,
                status: "failed",
                progress: undefined,
              };
              await this.renderMessages();
              this.activeAbortControllers.delete(messageIndex);
              return;
            }
          }
          throw new Error(`Status check failed (${response.status})`);
        }

        const statusData = response.json;
        const status = statusData.status;

        // Reset error counter on success
        consecutiveErrors = 0;

        // Update message with progress
        // Handle both "processing" and "queued" statuses (API returns these, not "processing (up to 5 mins)")
        if (status === "processing" || status === "queued") {
          // Use stage field from API for more accurate progress tracking
          const stage = statusData.stage || "processing";
          const searchResultsCount = statusData.search_results_count || 0;
          const filteredResultsCount = statusData.filtered_results_count || 0;

          // Map stages to progress percentages and human-readable messages
          const stageProgress: { [key: string]: { percent: number; message: string } } = {
            "initializing": { percent: 22, message: "Initializing investigation..." },
            "refining_query": { percent: 28, message: "Refining search query with AI..." },
            "searching": { percent: 40, message: `Searching dark web engines...` },
            "filtering": { percent: 55, message: `Filtering ${searchResultsCount} results...` },
            "scraping": { percent: 70, message: `Scraping ${filteredResultsCount} relevant sites...` },
            "generating_summary": { percent: 85, message: "Generating intelligence summary..." },
          };

          const stageInfo = stageProgress[stage] || { percent: 25, message: "Processing..." };
          const displayPercent = stageInfo.percent;
          const progressMessage = stageInfo.message;

          // Build status content with available info
          let statusContent = `🕵️ Dark web investigation in progress\n\n**Stage:** ${progressMessage}\n`;
          if (searchResultsCount > 0) {
            statusContent += `**Search results:** ${searchResultsCount}\n`;
          }
          if (filteredResultsCount > 0) {
            statusContent += `**Filtered results:** ${filteredResultsCount}\n`;
          }
          statusContent += `\nPlease wait...`;

          this.chatHistory[messageIndex] = {
            role: "assistant",
            content: statusContent,
            jobId: jobId, // Keep Job ID internally for API calls
            status: "processing",
            progress: { message: progressMessage, percent: displayPercent },
            query: query,
          };
          this.updateProgressBar(messageIndex, { message: progressMessage, percent: displayPercent });

          // Schedule next poll with adaptive interval
          const nextInterval = getPollingInterval(elapsedMs);
          elapsedMs += nextInterval;
          const timeoutId = window.setTimeout(() => { void poll(); }, nextInterval);
          this.pollingIntervals.set(jobId, timeoutId);
        } else if (status === "completed") {
          // Stop polling
          this.pollingIntervals.delete(jobId);

          // Update progress to show fetching results
          this.chatHistory[messageIndex].progress = { message: "Fetching results...", percent: 92 };
          this.updateProgressBar(messageIndex, { message: "Fetching results...", percent: 92 });

          // Fetch the summary and save to vault
          await this.fetchDarkWebResults(jobId, messageIndex, query);
          this.activeAbortControllers.delete(messageIndex);
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
          await this.renderMessages();
        }
      } catch (error) {
        consecutiveErrors++;

        // Enhanced logging for network errors
        const errorType = error instanceof Error ? error.name : 'Unknown';
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(
          `[OSINT Copilot] Dark web status poll error (${consecutiveErrors}/${maxConsecutiveErrors}):`,
          `Type: ${errorType}, Message: ${errorMsg}`
        );

        // Continue polling unless too many consecutive errors
        if (consecutiveErrors < maxConsecutiveErrors) {
          const nextInterval = getPollingInterval(elapsedMs);
          elapsedMs += nextInterval;

          // Show retry status to user
          const elapsedSecs = Math.round(elapsedMs / 1000);
          const retryMsg = `Network interrupted (${errorType}), retrying... (${elapsedSecs}s elapsed, attempt ${consecutiveErrors}/${maxConsecutiveErrors})`;
          console.debug(`[OSINT Copilot] ${retryMsg}`);

          const timeoutId = window.setTimeout(() => { void poll(); }, nextInterval);
          this.pollingIntervals.set(jobId, timeoutId);
        } else {
          // Too many errors, stop polling and show error
          this.pollingIntervals.delete(jobId);
          console.error('[OSINT Copilot] Dark web status polling failed after max retries');
          this.chatHistory[messageIndex] = {
            role: "assistant",
            content: `❌ Dark web investigation status check failed\n\n**Error:** Network connection lost after ${maxConsecutiveErrors} attempts (${errorType}).\n\nPlease check your connection and try again.`,
            jobId: jobId,
            status: "failed",
            progress: undefined,
          };
          await this.renderMessages();
        }
      }
    };

    // Start first poll after initial interval
    const initialInterval = getPollingInterval(0);
    elapsedMs = initialInterval;
    const timeoutId = window.setTimeout(() => { void poll(); }, initialInterval);
    this.pollingIntervals.set(jobId, timeoutId);
  }

  async fetchDarkWebResults(jobId: string, messageIndex: number, query: string) {
    try {
      // Strip darkweb_ prefix if present (backend expects clean UUID)
      const cleanJobId = jobId.startsWith('darkweb_') ? jobId.replace('darkweb_', '') : jobId;
      const endpoint = `${REPORT_API_BASE_URL}/api/darkweb/summary/${cleanJobId}`;
      const response: RequestUrlResponse = await requestUrl({
        url: endpoint,
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.plugin.settings.reportApiKey}`,
        },
        throw: false,
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Failed to fetch results (${response.status})`);
      }

      const summary = response.json;
      console.debug(`[OSINT Copilot] Dark web investigation completed. Job ID: ${jobId}`);

      // Format the results as markdown for both display and saving
      let reportContent = `# Dark Web Investigation: ${query}\n\n`;

      if (summary.summary) {
        reportContent += `## Summary\n\n${summary.summary}\n\n`;
      }

      if (summary.findings && summary.findings.length > 0) {
        reportContent += `## Key Findings (${summary.findings.length})\n\n`;
        summary.findings.forEach((finding: { title?: string; url?: string; snippet?: string }, index: number) => {
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
      await this.renderMessages();

      // Graph Generation Mode: Extract and create entities from the dark web results
      if (this.graphGenerationMode) {
        try {
          await this.processGraphGeneration(messageIndex, reportContent, query, displayText);
        } catch (graphError) {
          console.error("[OSINT Copilot] Graph generation from dark web results failed:", graphError);
          new Notice("Graph generation failed, but the report was saved successfully.");
        }
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
      await this.renderMessages();
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

    ;

    // Max Notes
    new Setting(containerEl)
      .setName("Max notes")
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
      .setName("System prompt")
      .setDesc("Default system prompt for q&a")
      .addTextArea((text) => {
        text
          .setPlaceholder("You are a vault assistant...")
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.setCssProps({ width: "100%" });
      });

    // Custom Chat Configuration
    if (this.plugin.settings.permissions && this.plugin.settings.permissions.allow_custom_chat_config) {
      new Setting(containerEl).setName("Custom chat configuration").setHeading();
      containerEl.createEl("p", {
        text: "Configure LLM providers for the 'Custom chat' mode. Add multiple checkpoints (e.g., local models, different providers) and select them in the chat view.", // eslint-disable-line obsidianmd/ui/sentence-case
        cls: "setting-item-description"
      });

      const checkpointsContainer = containerEl.createDiv("vault-ai-checkpoints-container");
      checkpointsContainer.style.marginBottom = "20px";

      // "Add New / Edit" Section
      const addSection = containerEl.createDiv("vault-ai-add-checkpoint");
      addSection.style.borderTop = "1px solid var(--background-modifier-border)";
      addSection.style.paddingTop = "10px";
      const addHeader = addSection.createDiv();
      addHeader.setText("Add new checkpoint");
      addHeader.addClass("setting-item-heading");

      // State for inputs
      let newName = "";
      let newUrl = "http://localhost:11434/v1";
      let newKey = "";
      let newModel = "";
      let newType: 'openai' | 'mindsdb' = 'openai';
      let editingId: string | null = null; // Track if we are editing

      // References to components for updating values programmatically
      let nameInput: any;
      let urlInput: any;
      let keyInput: any;
      let modelInput: any;
      let typeDropdown: any;
      let actionButton: any;

      const resetForm = () => {
        editingId = null;
        newName = "";
        newUrl = "http://localhost:11434/v1";
        newKey = "";
        newModel = "";
        newType = 'openai';

        if (nameInput) nameInput.setValue("");
        if (urlInput) urlInput.setValue("http://localhost:11434/v1");
        if (keyInput) keyInput.setValue("");
        if (modelInput) modelInput.setValue("");
        if (typeDropdown) typeDropdown.setValue("openai");

        addHeader.setText("Add new checkpoint");
        if (actionButton) actionButton.setButtonText("Add checkpoint");
      };

      // Render list with Edit/Delete
      const renderCheckpoints = () => {
        checkpointsContainer.empty();

        if (this.plugin.settings.customCheckpoints.length === 0) {
          checkpointsContainer.createEl("p", { text: "No checkpoints configured.", cls: "setting-item-description" });
        }

        this.plugin.settings.customCheckpoints.forEach((checkpoint, index) => {
          const checkpointEl = checkpointsContainer.createDiv("vault-ai-checkpoint-item");
          checkpointEl.style.display = "flex";
          checkpointEl.style.alignItems = "center";
          checkpointEl.style.marginBottom = "10px";
          checkpointEl.style.padding = "10px";
          checkpointEl.style.background = "var(--background-secondary)";
          checkpointEl.style.borderRadius = "5px";
          checkpointEl.style.gap = "10px";

          // Compact display: Name (Type - Model)
          const infoEl = checkpointEl.createDiv();
          infoEl.style.flex = "1";
          infoEl.createEl("strong", { text: checkpoint.name });
          const typeLabel = checkpoint.type === 'mindsdb' ? 'MindsDB' : 'OpenAI';
          infoEl.createEl("span", { text: ` (${typeLabel}: ${checkpoint.model})`, cls: "setting-item-description" });
          infoEl.createEl("div", { text: checkpoint.url, cls: "setting-item-description" }).style.fontSize = "0.8em";

          // Edit button
          new ButtonComponent(checkpointEl)
            .setIcon("pencil")
            .setTooltip("Edit")
            .onClick(() => {
              // Populate form
              editingId = checkpoint.id;
              newName = checkpoint.name;
              newUrl = checkpoint.url;
              newKey = checkpoint.apiKey;
              newModel = checkpoint.model;
              newType = checkpoint.type || 'openai';

              if (nameInput) nameInput.setValue(newName);
              if (urlInput) urlInput.setValue(newUrl);
              if (keyInput) keyInput.setValue(newKey);
              if (modelInput) modelInput.setValue(newModel);
              if (typeDropdown) typeDropdown.setValue(newType);

              addHeader.setText("Edit checkpoint");
              if (actionButton) actionButton.setButtonText("Update checkpoint");
              if (actionButton) actionButton.setCta();
            });

          // Delete button
          new ButtonComponent(checkpointEl)
            .setIcon("trash")
            .setTooltip("Delete")
            .setWarning()
            .onClick(async () => {
              if (confirm(`Delete checkpoint "${checkpoint.name}"?`)) {
                this.plugin.settings.customCheckpoints.splice(index, 1);
                await this.plugin.saveSettings();
                renderCheckpoints();
                // If we were editing this one, cancel edit
                if (editingId === checkpoint.id) {
                  resetForm();
                }
              }
            });
        });
      };

      renderCheckpoints();

      new Setting(addSection)
        .setName("Name")
        .setDesc("Display name")
        .addText(text => {
          nameInput = text;
          text.setPlaceholder("My custom LLM").onChange(v => newName = v); // eslint-disable-line obsidianmd/ui/sentence-case
        });

      new Setting(addSection)
        .setName("Provider type")
        .setDesc("Protocol to use")
        .addDropdown(dropdown => {
          typeDropdown = dropdown;
          dropdown
            .addOption('openai', 'OpenAI compatible (default)')
            .addOption('mindsdb', 'MindsDB (SQL via HTTP)')
            .setValue(newType)
            .onChange((v: string) => {
              const val = v as 'openai' | 'mindsdb';
              newType = val;
              if (newType === 'mindsdb' && newUrl.includes('localhost')) {
                newUrl = 'http://127.0.0.1:47334';
                if (urlInput) urlInput.setValue(newUrl);
              }
            });
        });

      new Setting(addSection)
        .setName("API URL")
        .setDesc("Base URL. For MindsDB, use the root (e.g. http://127.0.0.1:47334). For OpenAI, the full path is constructed automatically unless specified.")
        .addText(text => {
          urlInput = text;
          text.setValue(newUrl).setPlaceholder("http://localhost:11434/v1").onChange(v => newUrl = v); // eslint-disable-line obsidianmd/ui/sentence-case
        });

      new Setting(addSection)
        .setName("API key")
        .setDesc("Optional")
        .addText(text => {
          keyInput = text;
          text.setPlaceholder("sk-...").onChange(v => newKey = v); // eslint-disable-line obsidianmd/ui/sentence-case
        });

      new Setting(addSection)
        .setName("Model / agent name")
        .setDesc("Model ID or agent name")
        .addText(text => {
          modelInput = text;
          text.setPlaceholder("llama3 or my_agent").onChange(v => newModel = v); // eslint-disable-line obsidianmd/ui/sentence-case
        });

      new Setting(addSection)
        .addButton(btn => {
          actionButton = btn;
          btn
            .setButtonText("Add checkpoint")
            .setCta()
            .onClick(async () => {
              if (!newName || !newUrl || !newModel) {
                new Notice("Name, URL, and model are required.");
                return;
              }

              if (editingId) {
                // Update existing
                const index = this.plugin.settings.customCheckpoints.findIndex(c => c.id === editingId);
                if (index !== -1) {
                  this.plugin.settings.customCheckpoints[index] = {
                    ...this.plugin.settings.customCheckpoints[index],
                    name: newName,
                    url: newUrl,
                    apiKey: newKey,
                    model: newModel,
                    type: newType
                  };
                  new Notice("Checkpoint updated!");
                }
              } else {
                // Add new
                this.plugin.settings.customCheckpoints.push({
                  id: Date.now().toString(),
                  name: newName,
                  url: newUrl,
                  apiKey: newKey,
                  model: newModel,
                  type: newType
                });
                new Notice("Checkpoint added!");
              }

              await this.plugin.saveSettings();
              renderCheckpoints();
              resetForm();
            });
        });

      new Setting(addSection)
        .addButton(btn => btn
          .setButtonText("Clear / cancel")
          .onClick(() => {
            resetForm();
          }));
    } else {
      new Setting(containerEl).setName("Custom chat configuration").setHeading();
      containerEl.createEl("p", {
        text: "This feature is available in 'Plugin own data' plan.", // eslint-disable-line obsidianmd/ui/sentence-case
        cls: "setting-item-description"
      }).style.color = "var(--text-muted)";
    }

    new Setting(containerEl).setName("Backend API").setHeading();

    // Dashboard Link
    const dashboardSetting = new Setting(containerEl)
      .setName("Account dashboard")
      .setDesc("View your API usage, quota, and manage your subscription");

    const linkEl = dashboardSetting.controlEl.createEl("a", {
      text: "Open dashboard →",
      href: "https://osint-copilot.com/dashboard/",
      cls: "external-link",
    });
    linkEl.setCssProps({
      color: "var(--interactive-accent)",
      "text-decoration": "none",
      "font-weight": "500"
    });

    // License Key
    new Setting(containerEl)
      .setName("License key")
      .setDesc("License key for all operations (chat, reports, and investigations)")
      .addText((text) => {
        text
          .setPlaceholder("Enter your license key")
          .setValue(this.plugin.settings.reportApiKey)
          .onChange(async (value) => {
            this.plugin.settings.reportApiKey = value;
            await this.plugin.saveSettings();
            // Refresh license key info when key changes
            await this.refreshApiInfo();
          });
        text.inputEl.type = "password";
      });

    // License Key Info Display (if key is configured)
    if (this.plugin.settings.reportApiKey) {
      const apiInfoContainer = containerEl.createDiv("api-info-container");
      apiInfoContainer.setCssProps({
        margin: "10px 0",
        padding: "15px",
        background: "var(--background-secondary)",
        "border-radius": "5px"
      });

      const loadingEl = apiInfoContainer.createEl("p", {
        text: "Loading license key information...",
        cls: "setting-item-description",
      });

      // Fetch license key info
      void this.fetchApiKeyInfo().then((info) => {
        loadingEl.remove();

        if (info) {
          const infoGrid = apiInfoContainer.createDiv();
          infoGrid.setCssProps({
            display: "grid",
            "grid-template-columns": "1fr 1fr",
            gap: "10px",
            "font-size": "0.9em"
          });

          // Safe values
          const quota = info.remaining_credits ?? info.remaining_quota ?? 0;
          const isActive = info.active ?? false;
          const isTrial = info.is_trial ?? false;

          // Plan
          const planDiv = infoGrid.createDiv();
          planDiv.createEl("strong", { text: "Plan: " });
          planDiv.createSpan({ text: info.plan || "No Plan" });

          // Quota
          const quotaDiv = infoGrid.createDiv();
          quotaDiv.createEl("strong", { text: "Remaining credits: " });
          const quotaSpan = quotaDiv.createSpan({ text: `${quota} credits` });
          if (quota <= 0) {
            quotaSpan.setCssProps({ color: "var(--text-error)", "font-weight": "bold" });
          } else if (quota <= 5) {
            quotaSpan.setCssProps({ color: "var(--text-warning)" });
          }

          // Status
          const statusDiv = infoGrid.createDiv();
          statusDiv.createEl("strong", { text: "Status: " });
          const statusSpan = statusDiv.createSpan({
            text: isActive ? "Active" : "Inactive"
          });
          statusSpan.setCssProps({ color: isActive ? "var(--text-success)" : "var(--text-error)" });

          // Expiry
          const expiryDiv = infoGrid.createDiv();
          expiryDiv.createEl("strong", { text: "Expires: " });
          if (info.expires_at) {
            const expiryDate = new Date(info.expires_at);
            expiryDiv.createSpan({ text: expiryDate.toLocaleDateString() });
          } else {
            expiryDiv.createSpan({ text: "N/A" });
          }

          // Trial badge
          if (isTrial) {
            const trialBadge = apiInfoContainer.createEl("p", {
              text: "🎁 trial account",
              cls: "setting-item-description",
            });
            trialBadge.setCssProps({
              "margin-top": "10px",
              color: "var(--text-warning)",
              "font-weight": "500"
            });
          }

          // Quota exhaustion warning
          if (quota <= 0) {
            const quotaWarning = apiInfoContainer.createDiv();
            quotaWarning.setCssProps({
              "margin-top": "15px",
              padding: "12px",
              background: "var(--background-modifier-error)",
              "border-radius": "5px",
              "border-left": "4px solid var(--text-error)"
            });
            const text1 = quotaWarning.createEl("p", {
              text: "⚠️ credits exhausted",
            });
            text1.setCssProps({
              margin: "0 0 8px 0",
              "font-weight": "bold",
              color: "var(--text-error)"
            });

            const text2 = quotaWarning.createEl("p", {
              text: "You have no remaining credits. Dark web investigations and report generation are unavailable until you upgrade or your quota renews.",
            });
            text2.setCssProps({ margin: "0 0 10px 0", "font-size": "0.9em" });
            const upgradeLink = quotaWarning.createEl("a", {
              text: "Upgrade your plan →",
              href: "https://osint-copilot.com/dashboard/",
            });
            upgradeLink.setCssProps({
              color: "var(--interactive-accent)",
              "font-weight": "500",
              "text-decoration": "none"
            });
          } else if (quota <= 5) {
            const lowQuotaWarning = apiInfoContainer.createDiv();
            lowQuotaWarning.setCssProps({
              "margin-top": "15px",
              padding: "10px",
              background: "var(--background-modifier-warning)",
              "border-radius": "5px"
            });
            const p = lowQuotaWarning.createEl("p", {
              text: `⚠️ Low credits: Only ${quota} credits remaining.`,
            });
            p.setCssProps({
              margin: "0",
              "font-size": "0.9em",
              color: "var(--text-warning)"
            });
          }
        } else {
          const errP = apiInfoContainer.createEl("p", {
            text: "⚠️ could not load license key information. Please check your license key.",
            cls: "setting-item-description",
          });
          errP.setCssProps({ color: "var(--text-error)" });
        }
      }).catch(() => {
        loadingEl.remove();
        const errP2 = apiInfoContainer.createEl("p", {
          text: "⚠️ failed to connect to API. Please check your internet connection.",
          cls: "setting-item-description",
        });
        errP2.setCssProps({ color: "var(--text-error)" });
      });
    }

    // Companies&People Output Directory
    new Setting(containerEl)
      .setName("Companies&people output directory")
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
      .setName("Conversation history folder")
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

    const noteP = containerEl.createEl("p", {
      text: "ℹ️ note: AI entity generation requires an active API connection. All other features (manual entity creation, editing, connections, map view) work locally without the API.",
      cls: "setting-item-description",
    });
    noteP.setCssProps({ color: "var(--text-muted)" });

    new Setting(containerEl).setName("Graph view").setHeading();

    // Auto-refresh graph view
    new Setting(containerEl)
      .setName("Auto-refresh graph view")
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
      .setName("Auto-open graph view")
      .setDesc("Automatically open the graph view when entities are created (if not already open)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoOpenGraphOnEntityCreation)
          .onChange(async (value) => {
            this.plugin.settings.autoOpenGraphOnEntityCreation = value;
            await this.plugin.saveSettings();
          })
      );

    ;

  }

  async fetchApiKeyInfo(): Promise<ApiKeyInfo | null> {
    if (!this.plugin.settings.reportApiKey) {
      return null;
    }

    try {
      const response: RequestUrlResponse = await requestUrl({
        url: "https://api.osint-copilot.com/api/key/info",
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.plugin.settings.reportApiKey}`,
          "Content-Type": "application/json",
        },
        throw: false,
      });

      if (response.status < 200 || response.status >= 300) {
        return null;
      }

      return response.json as ApiKeyInfo;
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

