import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  Setting,
  TFile,
  TFolder,
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  CachedMetadata,
  Component,
  normalizePath,
  setIcon,
} from "obsidian";

// Graph plugin imports
import {
  EntityType,
  Entity,
  Connection,
  ENTITY_CONFIGS,
  AIOperation,
  ProcessTextResponse,
  validateEntityName,
  getEntityLabel,
  getEntityIconForEntity,
  getEntityColor,
  type GraphWriteContext,
} from '../entities/types';
import { EntityManager } from '../services/entity-manager';
import { WaybackArchiveService } from '../services/wayback-archive-service';
import { GraphApiService, isLikelyExpectedUrlFetchFailure } from '../services/api-service';
import { ClaudeCodeService, type ExtractionLogEvent } from '../services/claude-code-service';
import {
  ConversationService,
  Conversation,
  ConversationMetadata,
  ConversationMessage,
  type CopilotChatMode,
  legacyFlagsForChatMode,
  inferChatModeFromLegacyFields,
} from '../services/conversation-service';
import { GraphView, GRAPH_VIEW_TYPE } from '../views/graph-view';
import { TimelineView, TIMELINE_VIEW_TYPE } from '../views/timeline-view';
import { MapView, MAP_VIEW_TYPE } from '../views/map-view';
import { ToolsSkillsRegistryView, TOOLS_SKILLS_REGISTRY_VIEW_TYPE } from '../views/tools-skills-registry-view';
import { ConfirmModal } from '../modals/confirm-modal';
import { CustomTypesService } from '../services/custom-types-service';
import {
  OrchestrationService,
  OrchestrationPlan,
  ORCHESTRATION_TOOL_DISPLAY_NAMES,
  type OrchestrationProgressMeta,
} from '../services/orchestration-service';
import { UpdaterService } from '../services/updater-service';
import { VaultPromptLoader } from '../services/vault-prompt-loader';
import { VaultPromptBootstrapService } from '../services/vault-prompt-bootstrap';
import { TaskAgentRegistry } from '../task-agents/task-agent-registry';
import { TaskAgentRunner } from '../task-agents/task-agent-runner';
import { TaskAgentBootstrapService } from '../task-agents/task-agent-bootstrap';
import { isTaskAgentRunnable } from '../task-agents/task-agent-settings';
import { SkillRegistry } from '../skills/skill-registry';
import { SkillBootstrapService } from '../skills/skill-bootstrap';
import { createAgentProvider } from '../services/agent-runtime/create-agent-provider';
import {
  getChatRuntimeAvailability,
  invalidateChatRuntimeAvailabilityCache,
  type ChatRuntimeAvailability,
} from '../services/agent-runtime/chat-runtime-availability';
import {
  CLAUDE_RUNTIME_ID,
  HERMES_RUNTIME_ID,
  getConfiguredRuntimeOptions,
  normalizeCustomAgentRuntimes,
  normalizeCustomRuntimeId,
  type CustomAgentRuntime,
} from '../services/agent-runtime/runtime-registry';
import {
  DEFAULT_CONVERSATION_FOLDER,
  DEFAULT_CREDENTIALS_FOLDER,
  DEFAULT_ENRICHERS_FOLDER,
  DEFAULT_PROMPTS_FOLDER,
  DEFAULT_SCRIPTS_FOLDER,
  DEFAULT_SKILLS_FOLDER,
  DEFAULT_TASK_AGENTS_FOLDER,
  DEFAULT_TASK_AGENT_OUTPUT_ALLOWLIST,
} from '../constants/vault-layout';
import type { CustomVaultOperation } from '../services/custom-vault-operations';
import { normalizeCustomVaultOperations, summarizeCustomVaultOperation } from '../services/custom-vault-operations';
import {
  applyCustomVaultOperations,
  ensureCredentialsFolder,
  ensureScriptsDefaultsInstalled,
} from '../services/custom-vault-writer';
import { ensureFolderExists, ensureFolderChainForFile } from '../utils/vault-bootstrap-fs';
import { VaultLockService } from '../services/vault-lock-service';
import { VaultUnlockModal } from '../modals/vault-unlock-modal';
import { SchemaBootstrapService } from '../services/schema-bootstrap-service';
import { SchemaCatalogService, mergeEnabledFamilies } from '../services/schema-catalog-service';
import type { EnabledSchemaFamilies } from '../services/schema-catalog-types';
import { EnricherRegistry } from '../services/enrichers/enricher-registry';
import { enrichToolId, normalizeEnricherSpec, type EnricherSpec } from '../services/enrichers/enricher-schema';
import {
  DEFAULT_ENABLED_SCHEMA_FAMILIES,
  DEFAULT_OIDSF_MODAL_LAYERS,
  mergeOidsfModalLayers,
  type OIDSFModalLayers,
} from '../services/schema-catalog-types';
import { LEGACY_SCHEMA_NAME_ALIASES } from '../services/schema-name-aliases';
import {
  DEFAULT_SETTINGS,
  type VaultAISettings,
  type CustomCheckpoint,
} from '../settings/vault-ai-settings';
import { VaultAISettingTab } from '../settings/vault-ai-setting-tab';
import type { IndexedNote } from '../chat/indexed-note';
import type { ChatHistoryItem } from '../chat/chat-types';
import {
  runtimeSettingsVisibility,
  type RuntimeSettingsVisibility,
} from '../chat/runtime-settings-visibility';
import { AskModal } from '../modals/ask-modal';
import { RenameConversationModal } from '../modals/rename-conversation-modal';
import { appendVaultOpPreviewBlock, entityHasMapCoordinates } from '../ui/vault-op-previews';
import { CHAT_VIEW_TYPE, ChatView } from '../views/chat-view';
import { OsintWorkspaceController } from './osint-workspace-controller';

// All AI calls are routed through Claude Code CLI (local).
// These model constants are no longer used for remote routing but kept for reference.
const CHAT_MODEL = "claude-code";
const ENTITY_EXTRACTION_MODEL = "claude-code";
const LOCAL_VAULT_MODEL = "claude-code";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
  orchestrationService!: OrchestrationService;
  updaterService!: UpdaterService;
  claudeCodeService: ClaudeCodeService | null = null;
  vaultPromptLoader!: VaultPromptLoader;
  taskAgentRegistry!: TaskAgentRegistry;
  taskAgentRunner!: TaskAgentRunner;
  skillRegistry!: SkillRegistry;
  enricherRegistry!: EnricherRegistry;
  vaultLockService!: VaultLockService;
  schemaCatalogService!: SchemaCatalogService;
  waybackArchiveService!: WaybackArchiveService;

  attachVaultSkillFromVault(): void {
    if (this.claudeCodeService && this.vaultPromptLoader) {
      this.claudeCodeService.setVaultSkillResolver(() =>
        this.vaultPromptLoader.getGraphExtractionSkill()
      );
    }
  }

  initClaudeCodeService() {
    const adapter = this.app.vault.adapter as any;
    const basePath = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
    const pluginDir = basePath && this.manifest.dir
        ? `${basePath}/${this.manifest.dir}`
        : '';
    const svc = new ClaudeCodeService(pluginDir, {
      cliPath: this.settings.claudeCodeCliPath || 'claude',
      model: this.settings.claudeCodeModel || 'sonnet',
      cliWorkingDirectory: basePath || undefined,
      extraCliArgs: this.settings.claudeCodeExtraArgs ?? '',
      timeoutMs: this.settings.claudeCodeTimeoutMs || 300_000,
    });
    this.claudeCodeService = svc;
    this.graphApiService.setClaudeCodeService(svc);
    this.attachVaultSkillFromVault();
  }

  getEnabledSchemaFamilies(): EnabledSchemaFamilies {
    return mergeEnabledFamilies(this.settings.enabledSchemaFamilies);
  }

  getGraphEntityVisual(entity: Entity): { color: string; icon: string } {
    const icon = getEntityIconForEntity(entity);
    if (this.schemaCatalogService) {
      const { color } = this.schemaCatalogService.getEntityVisualForGraph(entity);
      return { color, icon };
    }
    return { color: getEntityColor(entity.type as string), icon };
  }

  async onload() {
    await this.loadSettings();

    this.vaultLockService = new VaultLockService(this);
    this.vaultLockService.initializeFromSettings();

    // Initialize custom types service (load schemas before entity manager)
    this.customTypesService = new CustomTypesService(this.app);
    await this.customTypesService.initialize();

    try {
      await new SchemaBootstrapService(this.app, () => this.settings.entityBasePath).ensureDefaultsInstalled();
    } catch (e) {
      console.warn('OSINTCopilot: schema vault bootstrap failed:', e);
    }

    // Initialize graph plugin components
    this.entityManager = new EntityManager(this.app, this.settings.entityBasePath, this.vaultLockService);
    this.waybackArchiveService = new WaybackArchiveService(this.app);
    this.entityManager.setWaybackArchiveService(this.waybackArchiveService);
    this.schemaCatalogService = new SchemaCatalogService(this.app, () => this.settings.entityBasePath);
    this.entityManager.setSchemaCatalogService(this.schemaCatalogService);
    try {
      await this.schemaCatalogService.rebuild();
    } catch (e) {
      console.warn('OSINTCopilot: schema catalog rebuild failed:', e);
    }

    this.graphApiService = new GraphApiService();
    this.graphApiService.setSettings({
      apiProvider: 'claude-code',
      customApiUrl: '',
      customApiKey: '',
      customModel: '',
      claudeCodeCliPath: this.settings.claudeCodeCliPath,
      claudeCodeModel: this.settings.claudeCodeModel,
      pdftotextPath: this.settings.pdftotextPath,
    });
    this.vaultPromptLoader = new VaultPromptLoader(
      this.app,
      () => this.settings.promptsFolder,
      () => this.settings.activeAgentId,
    );
    try {
      await new VaultPromptBootstrapService(this.app, () => this.settings.promptsFolder).ensureDefaultsInstalled();
    } catch (e) {
      console.warn('OSINTCopilot: vault prompt bootstrap failed:', e);
    }
    this.vaultPromptLoader.registerVaultEvents(this);
    this.initClaudeCodeService();

    this.taskAgentRegistry = new TaskAgentRegistry(this.app, () => this.settings.taskAgentsFolder);
    this.taskAgentRegistry.registerVaultEvents(this);
    try {
      await new TaskAgentBootstrapService(this.app, () => this.settings.taskAgentsFolder).ensureDefaultsInstalled();
    } catch (e) {
      console.warn('OSINTCopilot: task-agent bootstrap failed:', e);
    }
    this.skillRegistry = new SkillRegistry(this.app, () => this.settings.skillsFolder);
    this.skillRegistry.registerVaultEvents(this);
    try {
      await new SkillBootstrapService(this.app, () => this.settings.skillsFolder).ensureDefaultsInstalled();
    } catch (e) {
      console.warn('OSINTCopilot: skill bootstrap failed:', e);
    }
    try {
      const enricherRoot = this.settings.enrichersFolder.trim() || DEFAULT_ENRICHERS_FOLDER;
      await ensureFolderExists(this.app, enricherRoot);
    } catch (e) {
      console.warn('OSINTCopilot: enricher folder bootstrap failed:', e);
    }
    try {
      await ensureCredentialsFolder(this);
    } catch (e) {
      console.warn('OSINTCopilot: credentials folder bootstrap failed:', e);
    }
    this.enricherRegistry = new EnricherRegistry(this.app, () => this.settings.enrichersFolder);
    this.enricherRegistry.registerVaultEvents(this);
    this.taskAgentRunner = new TaskAgentRunner(
      this.app,
      () => this.claudeCodeService,
      this.vaultPromptLoader,
      () => this.index,
      () => this.settings.claudeCodeModel || 'sonnet',
      {
        globalOutputAllowlist: this.settings.taskAgentGlobalOutputAllowlist,
        isPathLocked: (p) => this.vaultLockService.isPathLocked(p),
      },
    );

    // Initialize conversation service
    this.conversationService = new ConversationService(this.app, this.settings.conversationFolder);
    try {
      await this.conversationService.initialize();
      console.debug('OSINTCopilot: Conversation service initialized');
    } catch (error) {
      console.warn('OSINTCopilot: Conversation service initialization had issues:', error);
    }

    // Initialize Orchestration Service
    this.orchestrationService = new OrchestrationService(this);

    // Initialize Updater Service
    this.updaterService = new UpdaterService(this);

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
          console.debug('OSINTCopilot: Claude Code CLI available for extraction', health);
        } else {
          console.debug('OSINTCopilot: Claude Code CLI not detected — install `claude` for entity extraction');
        }
      }).catch(() => {
        console.debug('OSINTCopilot: Claude Code health check failed');
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
          (entityId) => { void this.showEntityOnMap(entityId); },
          this,
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

    this.registerView(TOOLS_SKILLS_REGISTRY_VIEW_TYPE, (leaf) => new ToolsSkillsRegistryView(leaf, this));

    // Add ribbon icons for all OSINT Copilot features (grouped together)
    // Ctrl/Cmd+click opens a new instance as a tab next to other OSINT views in the same tab strip
    const chatRibbon = this.addRibbonIcon("message-square", "OSINT Copilot chat (Ctrl+click for new tab)", (evt: MouseEvent) => {
      const forceNew = evt.ctrlKey || evt.metaKey;
      void this.openChatView(forceNew);
    });

    this.addRibbonIcon("layout-list", "OSINT Copilot tools & skills registry (Ctrl+click for new tab)", (evt: MouseEvent) => {
      const forceNew = evt.ctrlKey || evt.metaKey;
      void this.openToolsSkillsRegistryView(forceNew);
    });

    // Graph features icons (Entity Graph, Timeline, Map) - shown when graph features are enabled
    if (this.settings.enableGraphFeatures) {
      const graphRibbon = this.addRibbonIcon("git-fork", "Entity graph (Ctrl+click for new tab)", (evt: MouseEvent) => {
        const forceNew = evt.ctrlKey || evt.metaKey;
        void this.openGraphView(forceNew);
      });

      const timelineRibbon = this.addRibbonIcon("calendar", "Timeline (Ctrl+click for new tab)", (evt: MouseEvent) => {
        const forceNew = evt.ctrlKey || evt.metaKey;
        void this.openTimelineView(forceNew);
      });

      const mapRibbon = this.addRibbonIcon("map-pin", "Location map (Ctrl+click for new tab)", (evt: MouseEvent) => {
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

    let schemaCatalogDebounce: number | null = null;
    const scheduleSchemaCatalogRebuild = () => {
      if (schemaCatalogDebounce !== null) window.clearTimeout(schemaCatalogDebounce);
      schemaCatalogDebounce = window.setTimeout(() => {
        void this.schemaCatalogService?.rebuild();
      }, 650);
    };
    const isUnderEntitySchemas = (path: string) => {
      const base = normalizePath(this.settings.entityBasePath.trim() || "OSINTCopilot");
      const prefix = normalizePath(`${base}/schemas`);
      const p = normalizePath(path);
      return p === prefix || p.startsWith(`${prefix}/`);
    };
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && isUnderEntitySchemas(file.path)) {
          scheduleSchemaCatalogRebuild();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && isUnderEntitySchemas(file.path)) {
          scheduleSchemaCatalogRebuild();
        }
      }),
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
      name: "Open chat in new tab",
      callback: () => { void this.openChatView(true); },
    });

    this.addCommand({
      id: "open-graph-view",
      name: "Open entity graph",
      callback: () => { void this.openGraphView(); },
    });

    this.addCommand({
      id: "open-graph-view-new-pane",
      name: "Open entity graph in new tab",
      callback: () => { void this.openGraphView(true); },
    });

    this.addCommand({
      id: "open-timeline-view",
      name: "Open timeline",
      callback: () => { void this.openTimelineView(); },
    });

    this.addCommand({
      id: "open-timeline-view-new-pane",
      name: "Open timeline in new tab",
      callback: () => { void this.openTimelineView(true); },
    });

    this.addCommand({
      id: "open-map-view",
      name: "Open location map",
      callback: () => { void this.openMapView(); },
    });

    this.addCommand({
      id: "open-map-view-new-pane",
      name: "Open location map in new tab",
      callback: () => { void this.openMapView(true); },
    });

    this.addCommand({
      id: "open-tools-skills-registry",
      name: "Open tools & skills registry",
      callback: () => { void this.openToolsSkillsRegistryView(); },
    });

    this.addCommand({
      id: "open-tools-skills-registry-new-pane",
      name: "Open tools & skills registry in new tab",
      callback: () => { void this.openToolsSkillsRegistryView(true); },
    });

    this.addCommand({
      id: "export-investigation",
      name: "Export current investigation",
      callback: () => {
        try {
          const json = this.entityManager.exportToJSON();
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');

          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
          a.href = url;
          a.download = `osint-investigation-${timestamp}.json`;
          a.click();

          URL.revokeObjectURL(url);
          new Notice('Investigation exported successfully');
        } catch (error) {
          console.error('[OSINT Copilot] Export failed:', error);
          new Notice('Failed to export investigation');
        }
      },
    });

    // Utility commands
    this.addCommand({
      id: "ask-vault",
      name: "Ask (remote)",
      callback: () => {
        this.openAskModal();
      },
    });

    this.addCommand({
      id: "reindex-vault",
      name: "Reindex vault",
      callback: () => {
        void this.buildIndex().then(() => {
          new Notice("Vault reindexed successfully.");
        });
      },
    });

    this.addCommand({
      id: "reload-entities",
      name: "Reload entities from notes",
      callback: () => {
        void this.entityManager.loadEntitiesFromNotes().then(() => {
          new Notice("Entities reloaded from notes.");
        });
      },
    });

    this.addCommand({
      id: "oidsf-normalize-legacy-schema-names",
      name: "Normalize legacy OIDSF schema names in entity notes",
      callback: () => {
        void this.normalizeLegacyOidsfSchemaNamesInVault();
      },
    });

    this.addCommand({
      id: "normalize-entity-frontmatter-reserved-keys",
      name: "Normalize entity frontmatter reserved keys (props namespace)",
      callback: () => {
        void (async () => {
          try {
            const summary = await this.entityManager.migrateReservedPropertyFrontmatter();
            new Notice(
              `Frontmatter normalization complete: scanned ${summary.scanned}, fixed ${summary.fixed}, skipped ${summary.skipped}, errors ${summary.errors}.`,
              9000,
            );
            await this.entityManager.loadEntitiesFromNotes();
            await this.refreshOrOpenGraphView();
          } catch (e) {
            new Notice(`Normalization failed: ${e instanceof Error ? e.message : String(e)}`, 9000);
          }
        })();
      },
    });

    this.addCommand({
      id: "reload-vault-prompts",
      name: "Reload vault prompts",
      callback: () => {
        this.vaultPromptLoader?.invalidateAll();
        this.taskAgentRegistry?.invalidate();
        this.skillRegistry?.invalidate();
        this.enricherRegistry?.invalidate();
        this.attachVaultSkillFromVault();
        new Notice("Vault prompts, skills, enrichers, and task-agent registry refreshed.");
      },
    });

    this.addCommand({
      id: "install-missing-vault-prompts",
      name: "Install missing vault prompt files",
      callback: () => {
        void (async () => {
          try {
            await new VaultPromptBootstrapService(this.app, () => this.settings.promptsFolder).ensureDefaultsInstalled();
            await new TaskAgentBootstrapService(this.app, () => this.settings.taskAgentsFolder).ensureDefaultsInstalled();
            await new SkillBootstrapService(this.app, () => this.settings.skillsFolder).ensureDefaultsInstalled();
            const enricherRoot = this.settings.enrichersFolder.trim() || DEFAULT_ENRICHERS_FOLDER;
            await ensureFolderExists(this.app, enricherRoot);
            await ensureCredentialsFolder(this);
            this.vaultPromptLoader?.invalidateAll();
            this.taskAgentRegistry?.invalidate();
            this.skillRegistry?.invalidate();
            this.enricherRegistry?.invalidate();
            this.attachVaultSkillFromVault();
            new Notice("Missing default prompt, skills, enricher, and task-agent folders/files were created (existing files unchanged).");
          } catch (e) {
            new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`, 5000);
          }
        })();
      },
    });

    this.addCommand({
      id: "draft-http-enricher-from-api-docs",
      name: "Draft HTTP enricher skill from API documentation",
      callback: () => {
        void this.draftHttpEnricherFromUserDetails();
      },
    });
    this.addCommand({
      id: "set-http-enricher-enabled-state",
      name: "Set HTTP enricher enabled state (approval required)",
      callback: () => {
        void this.setHttpEnricherEnabledState();
      },
    });

    this.registerVaultLockEditorHooks();

    // Add settings tab
    this.addSettingTab(new VaultAISettingTab(this.app, this));
  }

  private extractJsonObject(raw: string): Record<string, unknown> | null {
    const text = String(raw || "").trim();
    if (!text) return null;
    const fenced = text.match(/```json\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1] || text;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  private async appendEnricherAuditLine(line: string): Promise<void> {
    const enricherRoot = this.settings.enrichersFolder.trim() || DEFAULT_ENRICHERS_FOLDER;
    const path = normalizePath(`${enricherRoot}/audit.log.md`);
    const stamped = `- ${new Date().toISOString()} ${line}\n`;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      const prev = await this.app.vault.read(existing);
      await this.app.vault.modify(existing, prev + stamped);
      return;
    }
    await ensureFolderChainForFile(this.app, path);
    await this.app.vault.create(path, "# Enricher audit log\n\n" + stamped);
  }

  private async draftHttpEnricherFromUserDetails(): Promise<void> {
    const docUrl = (window.prompt("API documentation URL for this enricher:") || "").trim();
    if (!docUrl) {
      new Notice("Cancelled: API documentation URL is required.");
      return;
    }
    const details = (window.prompt("What should this enricher search and return? Include required params.") || "").trim();
    if (!details) {
      new Notice("Cancelled: integration details are required.");
      return;
    }
    const system = [
      "You draft JSON for an OSINT HTTP enricher tool that will run inside Obsidian (plugin HTTP, not a browser tab).",
      "Return ONLY one JSON object with keys:",
      "id, name, description, method, urlTemplate, allowedDomains, authType, authEnvVar, authHeaderName, authQueryParam, vaultRelativePath, inputHints, skillInstructions.",
      "Runtime: Obsidian uses requestUrl (no CORS from app origin). urlTemplate must hit the real API origin — do not rely on browser-only session cookies or front-end-only endpoints.",
      "allowedDomains must list every hostname used in urlTemplate (API host), not only the documentation site host.",
      "Auth: prefer bearer_vault | header_vault | query_vault with vaultRelativePath (relative path under the vault credentials folder); use bearer_env | header_env | query_env only if appropriate. Never put API keys or secrets in the JSON.",
      "Use {{query}} and {{attachments_context}} in urlTemplate or body when relevant.",
      "If the integration is only usable from a logged-in browser UI (cookie/session webmail style), respond with a JSON object whose skillInstructions clearly state the API is not suitable as an HTTP enricher and the user should paste exports instead.",
      "Never include credentials or API keys.",
    ].join("\n");
    const user = `Documentation URL:\n${docUrl}\n\nUser requirements:\n${details}`;
    let parsed: Record<string, unknown> | null = null;
    let docHost = "";
    try { docHost = new URL(docUrl).hostname; } catch { docHost = ""; }
    try {
      const raw = await this.graphApiService.callRemoteModel(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        false,
      );
      parsed = this.extractJsonObject(raw);
    } catch (e) {
      console.warn("[EnricherDraft] model draft failed, using fallback:", e);
    }

    const draft = normalizeEnricherSpec({
      id: parsed?.["id"] || details.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: parsed?.["name"] || "Custom Enricher",
      description: parsed?.["description"] || details,
      documentationUrl: docUrl,
      status: "active",
      enabled: true,
      allowedDomains: parsed?.["allowedDomains"] || (docHost ? [docHost] : []),
      auth: {
        type: parsed?.["authType"] || "none",
        envVar: parsed?.["authEnvVar"] || "",
        headerName: parsed?.["authHeaderName"] || "X-API-Key",
        queryParam: parsed?.["authQueryParam"] || "api_key",
        vaultRelativePath:
          typeof parsed?.["vaultRelativePath"] === "string" ? String(parsed["vaultRelativePath"]).trim() : "",
      },
      request: {
        method: String(parsed?.["method"] || "GET").toUpperCase() === "POST" ? "POST" : "GET",
        urlTemplate: parsed?.["urlTemplate"] || docUrl,
        headers: { "User-Agent": "OSINT-Copilot-Enricher/1.0" },
      },
      inputHints: parsed?.["inputHints"] || ["query"],
      skillInstructions: parsed?.["skillInstructions"] || "Use this enricher when the user asks for this data source.",
      limits: {
        timeoutMs: 15000,
        retries: 1,
        maxResponseChars: 8000,
      },
      updatedAt: new Date().toISOString(),
    });
    if (!draft) {
      new Notice("Failed to build enricher draft.");
      return;
    }

    const enricherPath = `${this.settings.enrichersFolder}/${draft.id}.json`;
    const skillPath = `${this.settings.skillsFolder}/${draft.id}.md`;
    const skillMd = `---
skill_kind: vault
id: ${draft.id}
name: ${draft.name}
description: ${draft.description}
---
${draft.skillInstructions}

Tool id: ${enrichToolId(draft.id)}
This skill executes the configured HTTP enricher spec in ${enricherPath}.
Do not tell the user to run raw curl from Obsidian for this API; unified chat should call this tool via enricher_invocations with enricher_id \`${draft.id}\`.
`;
    const confirmMsg = [
      "Is it OK to install this enricher skill into your vault and create or update the files below?",
      `Enricher: "${draft.name}"`,
      `Spec (JSON): ${enricherPath}`,
      `Skill (markdown): ${skillPath}`,
      `Auth mode: ${draft.auth.type}${draft.auth.envVar ? ` (env: ${draft.auth.envVar})` : ""}`,
      "No credentials will be stored; env var references only.",
    ].join("\n");
    new ConfirmModal(
      this.app,
      "Install enricher skill?",
      confirmMsg,
      () => {
        void (async () => {
          try {
            await ensureFolderChainForFile(this.app, enricherPath);
            await ensureFolderChainForFile(this.app, skillPath);
            const existingSpec = this.app.vault.getAbstractFileByPath(enricherPath);
            if (existingSpec instanceof TFile) {
              await this.app.vault.modify(existingSpec, JSON.stringify(draft, null, 2));
            } else {
              await this.app.vault.create(enricherPath, JSON.stringify(draft, null, 2));
            }
            const existingSkill = this.app.vault.getAbstractFileByPath(skillPath);
            if (existingSkill instanceof TFile) {
              await this.app.vault.modify(existingSkill, skillMd);
            } else {
              await this.app.vault.create(skillPath, skillMd);
            }
            this.enricherRegistry.invalidate();
            this.skillRegistry.invalidate();
            await this.appendEnricherAuditLine(`approved create_or_update id=${draft.id} doc=${docUrl}`);
            new Notice(`Enricher ${draft.name} saved and activated.`);
          } catch (e) {
            new Notice(`Failed to save enricher: ${e instanceof Error ? e.message : String(e)}`, 8000);
          }
        })();
      },
      () => new Notice("Enricher draft cancelled."),
      false,
      undefined,
      "Install",
      "Cancel",
    ).open();
  }

  private async setHttpEnricherEnabledState(): Promise<void> {
    const idInput = (window.prompt("Enricher id (without ENRICH_):") || "").trim().toLowerCase();
    if (!idInput) return;
    const nextRaw = (window.prompt("Set state: active or disabled") || "").trim().toLowerCase();
    const nextStatus = nextRaw === "disabled" ? "disabled" : nextRaw === "active" ? "active" : "";
    if (!nextStatus) {
      new Notice("Cancelled: state must be 'active' or 'disabled'.");
      return;
    }
    const path = `${this.settings.enrichersFolder}/${idInput}.json`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Enricher not found: ${path}`);
      return;
    }
    const raw = await this.app.vault.read(file);
    const parsed = normalizeEnricherSpec(JSON.parse(raw));
    if (!parsed) {
      new Notice("Invalid enricher spec JSON.");
      return;
    }
    const nextEnabled = nextStatus === "active";
    const msg = `Change enricher "${parsed.name}" status to ${nextStatus}?`;
    new ConfirmModal(
      this.app,
      "Approve enricher state change",
      msg,
      () => {
        void (async () => {
          parsed.status = nextStatus as EnricherSpec["status"];
          parsed.enabled = nextEnabled;
          parsed.updatedAt = new Date().toISOString();
          await this.app.vault.modify(file, JSON.stringify(parsed, null, 2));
          this.enricherRegistry.invalidate();
          await this.appendEnricherAuditLine(`approved set_state id=${parsed.id} status=${nextStatus}`);
          new Notice(`Enricher ${parsed.name} is now ${nextStatus}.`);
        })();
      },
      () => new Notice("State change cancelled."),
    ).open();
  }

  onunload() {



  }

  async loadSettings() {
    const loaded = await this.loadData();
    const raw = (
      loaded !== null && typeof loaded === "object" && !Array.isArray(loaded)
        ? { ...(loaded as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const legacyKeys = [
      "reportApiKey",
      "graphApiUrl",
      "reportOutputDir",
      "subscriptionPlan",
      "subscriptionStatus",
      "subscriptionCredits",
      "subscriptionExpires",
    ] as const;
    let stripped = false;
    for (const k of legacyKeys) {
      if (k in raw) {
        delete raw[k];
        stripped = true;
      }
    }
    const merged = Object.assign({}, DEFAULT_SETTINGS, raw) as Record<string, unknown>;
    if (!merged.taskAgentOverrides || typeof merged.taskAgentOverrides !== 'object') {
      merged.taskAgentOverrides = {};
    }
    if (typeof merged.enrichersFolder !== 'string' || !merged.enrichersFolder.trim()) {
      merged.enrichersFolder = DEFAULT_SETTINGS.enrichersFolder;
    }
    if (typeof merged.credentialsFolder !== 'string' || !merged.credentialsFolder.trim()) {
      merged.credentialsFolder = DEFAULT_SETTINGS.credentialsFolder;
    }
    if (typeof merged.scriptsFolder !== 'string' || !merged.scriptsFolder.trim()) {
      merged.scriptsFolder = DEFAULT_SETTINGS.scriptsFolder;
    }
    if (!Array.isArray(merged.lockedVaultPaths)) {
      merged.lockedVaultPaths = [];
    }
    if (typeof merged.activeGraphId !== 'string' || !merged.activeGraphId) {
      merged.activeGraphId = 'default';
    }
    if (!Array.isArray(merged.graphWorkspaces) || merged.graphWorkspaces.length === 0) {
      merged.graphWorkspaces = [{ id: 'default', name: 'Default' }];
    }
    merged.enabledSchemaFamilies = mergeEnabledFamilies(
      raw.enabledSchemaFamilies as Partial<EnabledSchemaFamilies> | undefined,
    );
    merged.oidsfModalLayers = mergeOidsfModalLayers(
      raw.oidsfModalLayers as Partial<OIDSFModalLayers> | undefined,
    );
    merged.customAgentRuntimes = normalizeCustomAgentRuntimes(raw.customAgentRuntimes);
    const validRuntimeIds = new Set<string>([
      CLAUDE_RUNTIME_ID,
      HERMES_RUNTIME_ID,
      ...((merged.customAgentRuntimes as CustomAgentRuntime[]).map((rt) => rt.id)),
    ]);
    const arp = typeof merged.agentRuntimeProvider === 'string' ? merged.agentRuntimeProvider : '';
    if (!validRuntimeIds.has(arp)) {
      merged.agentRuntimeProvider = DEFAULT_SETTINGS.agentRuntimeProvider;
    }
    if (typeof merged.hermesAgentCliPath !== 'string' || !merged.hermesAgentCliPath.trim()) {
      merged.hermesAgentCliPath = DEFAULT_SETTINGS.hermesAgentCliPath;
    }
    if (typeof merged.claudeCodeExtraArgs !== 'string') {
      merged.claudeCodeExtraArgs = DEFAULT_SETTINGS.claudeCodeExtraArgs;
    }
    if (typeof merged.hermesAgentExtraArgs !== 'string') {
      merged.hermesAgentExtraArgs = DEFAULT_SETTINGS.hermesAgentExtraArgs;
    }
    if (typeof merged.hermesAgentTimeoutMs !== 'number' || merged.hermesAgentTimeoutMs < 5000) {
      merged.hermesAgentTimeoutMs = DEFAULT_SETTINGS.hermesAgentTimeoutMs;
    }
    if (typeof merged.hermesAgentHealthCheckArgs !== 'string' || !merged.hermesAgentHealthCheckArgs.trim()) {
      merged.hermesAgentHealthCheckArgs = DEFAULT_SETTINGS.hermesAgentHealthCheckArgs;
    }
    if (merged.extractionLogVerbosity !== 'minimal' && merged.extractionLogVerbosity !== 'detailed') {
      merged.extractionLogVerbosity = DEFAULT_SETTINGS.extractionLogVerbosity;
    }
    if (typeof merged.extractionDebugRawCli !== 'boolean') {
      merged.extractionDebugRawCli = DEFAULT_SETTINGS.extractionDebugRawCli;
    }
    this.settings = merged as unknown as VaultAISettings;
    if (stripped) {
      await this.saveData(this.settings);
    }
  }

  async saveSettings() {
    invalidateChatRuntimeAvailabilityCache();
    await this.saveData(this.settings);
    if (this.graphApiService) {
      this.graphApiService.setSettings({
        apiProvider: 'claude-code',
        customApiUrl: '',
        customApiKey: '',
        customModel: '',
        claudeCodeCliPath: this.settings.claudeCodeCliPath,
        claudeCodeModel: this.settings.claudeCodeModel,
        pdftotextPath: this.settings.pdftotextPath,
      });
      this.initClaudeCodeService();
    }
    if (this.entityManager) {
      this.entityManager.setBasePath(this.settings.entityBasePath);
    }

    if (this.vaultPromptLoader) {
      this.vaultPromptLoader.invalidateAll();
      this.attachVaultSkillFromVault();
    }

    this.taskAgentRegistry?.invalidate();
    this.skillRegistry?.invalidate();
    this.enricherRegistry?.invalidate();
    this.taskAgentRunner?.updateOptions({
      globalOutputAllowlist: this.settings.taskAgentGlobalOutputAllowlist,
      isPathLocked: (p: string) => this.vaultLockService.isPathLocked(p),
    });

    // Refresh all chat views (header controls)
    this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof ChatView) {
        leaf.view.refresh();
      }
    });
  }

  isAuthenticated(): boolean {
    return true;
  }

  getActiveGraphId(): string {
    return this.settings.activeGraphId || 'default';
  }

  async setActiveGraphId(id: string): Promise<void> {
    if (!this.settings.graphWorkspaces.some((g) => g.id === id)) return;
    this.settings.activeGraphId = id;
    await this.saveSettings();
  }

  listGraphWorkspaces(): { id: string; name: string }[] {
    return [...this.settings.graphWorkspaces];
  }

  async addGraphWorkspace(name: string): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const id = `graph-${Date.now().toString(36)}`;
    this.settings.graphWorkspaces.push({ id, name: trimmed });
    this.settings.activeGraphId = id;
    await this.saveSettings();
    return id;
  }

  async deleteGraphWorkspace(id: string): Promise<void> {
    if (id === 'default') return;
    this.settings.graphWorkspaces = this.settings.graphWorkspaces.filter((g) => g.id !== id);
    if (this.settings.activeGraphId === id) {
      this.settings.activeGraphId = 'default';
    }
    await this.saveSettings();
  }

  private registerVaultLockEditorHooks(): void {
    const update = (leaf: WorkspaceLeaf | null) => this.updateVaultLockLeafMode(leaf);

    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => update(leaf)));
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.app.workspace.iterateAllLeaves((leaf) => {
          if (leaf.view instanceof MarkdownView) update(leaf);
        });
      }),
    );
    this.registerEvent(
      this.app.workspace.on('file-open', () => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        update(leaf);
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.vaultLockService.onVaultRename(file, oldPath);
      }),
    );

    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) update(leaf);
    });
  }

  private updateVaultLockLeafMode(leaf: WorkspaceLeaf | null): void {
    if (!leaf || !(leaf.view instanceof MarkdownView)) return;
    const path = leaf.view.file?.path;
    if (!path || path.endsWith('.canvas')) return;

    const locked = this.vaultLockService.isPathLocked(path);
    const view = leaf.view;
    if (locked) {
      const state = leaf.getViewState();
      if (state.state && 'mode' in state.state && (state.state as { mode?: string }).mode === 'source') {
        void leaf.setViewState({
          ...state,
          state: { ...state.state, mode: 'preview' },
        });
      }
      this.hideVaultLockEditButtons(view);
      this.addVaultUnlockButton(view, path);
    } else {
      this.showVaultLockEditButtons(view);
      this.removeVaultUnlockButton(view);
    }
  }

  private hideVaultLockEditButtons(view: MarkdownView): void {
    const container = view.containerEl;
    container.querySelectorAll('.view-action').forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const aria = btn.getAttribute('aria-label') || '';
      const hasPencil = !!btn.querySelector('.lucide-pencil');
      if (hasPencil || aria.includes('Edit') || aria.includes('edit') || aria.includes('Switch to editing')) {
        btn.style.display = 'none';
      }
    });
  }

  private showVaultLockEditButtons(view: MarkdownView): void {
    const container = view.containerEl;
    container.querySelectorAll('.view-action').forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const aria = btn.getAttribute('aria-label') || '';
      if (aria.includes('Edit') || aria.includes('edit') || btn.querySelector('.lucide-pencil')) {
        btn.style.display = '';
      }
    });
  }

  private addVaultUnlockButton(view: MarkdownView, path: string): void {
    this.removeVaultUnlockButton(view);
    const container = view.containerEl;
    const btn = document.createElement('div');
    btn.addClass('view-action', 'clickable-icon', 'osint-copilot-vault-unlock-btn');
    btn.setAttribute('aria-label', 'Locked — click to unlock');
    setIcon(btn, 'lock');
    btn.addEventListener('click', () => {
      new VaultUnlockModal(this.app, () => {
        this.vaultLockService.unlockPath(path);
        this.app.workspace.iterateAllLeaves((leaf) => {
          if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path) {
            this.updateVaultLockLeafMode(leaf);
          }
        });
      }).open();
    });
    const actions = container.querySelector('.view-actions');
    if (actions) actions.prepend(btn);
  }

  private removeVaultUnlockButton(view: MarkdownView): void {
    view.containerEl.querySelector('.osint-copilot-vault-unlock-btn')?.remove();
  }

  // ============================================================================
  // GRAPH VIEW METHODS (workspace / OSINT panes)
  // ============================================================================

  private readonly osintWorkspace = new OsintWorkspaceController(this);

  async openGraphView(forceNew: boolean = false) {
    return this.osintWorkspace.openGraphView(forceNew);
  }

  async openGraphViewWithEntity(entityId: string) {
    return this.osintWorkspace.openGraphViewWithEntity(entityId);
  }

  async refreshGraphView(options?: { silent?: boolean }) {
    return this.osintWorkspace.refreshGraphView(options);
  }

  async refreshOpenInsightViews(options?: { skipGraph?: boolean }): Promise<void> {
    return this.osintWorkspace.refreshOpenInsightViews(options);
  }

  async refreshOrOpenGraphView() {
    return this.osintWorkspace.refreshOrOpenGraphView();
  }

  async openTimelineView(forceNew: boolean = false) {
    return this.osintWorkspace.openTimelineView(forceNew);
  }

  async openMapView(forceNew: boolean = false) {
    return this.osintWorkspace.openMapView(forceNew);
  }

  async openToolsSkillsRegistryView(forceNew: boolean = false) {
    return this.osintWorkspace.openToolsSkillsRegistryView(forceNew);
  }

  async showEntityOnMap(entityId: string) {
    return this.osintWorkspace.showEntityOnMap(entityId);
  }

  async openChatView(forceNew: boolean = false) {
    return this.osintWorkspace.openChatView(forceNew);
  }


  /**
   * Rewrites `type` / `ftmSchema` frontmatter under the entity base path from legacy names to OIDSF canonical names.
   */
  async normalizeLegacyOidsfSchemaNamesInVault(): Promise<void> {
    const base = normalizePath(this.settings.entityBasePath);
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(base + '/'));
    let updated = 0;
    for (const file of files) {
      let text = await this.app.vault.read(file);
      const m = /^(---\s*\n)([\s\S]*?)(\n---\s*\n)/.exec(text);
      if (!m) continue;
      let front = m[2];
      let changed = false;
      for (const [legacy, canon] of Object.entries(LEGACY_SCHEMA_NAME_ALIASES)) {
        const reType = new RegExp(`^type:\\s*["']?${legacy}["']?\\s*$`, 'm');
        const reFt = new RegExp(`^ftmSchema:\\s*["']?${legacy}["']?\\s*$`, 'm');
        if (reType.test(front)) {
          front = front.replace(reType, `type: ${canon}`);
          changed = true;
        }
        if (reFt.test(front)) {
          front = front.replace(reFt, `ftmSchema: ${canon}`);
          changed = true;
        }
      }
      if (changed) {
        const rest = text.slice(m[0].length);
        text = m[1] + front + m[3] + rest;
        await this.app.vault.modify(file, text);
        updated++;
      }
    }
    await this.entityManager.loadEntitiesFromNotes();
    if (this.schemaCatalogService) {
      await this.schemaCatalogService.rebuild();
    }
    new Notice(`OIDSF: normalized schema names in ${updated} note(s). Entities reloaded.`);
  }


  onEntityClick(entityId: string) {
    // Open the entity's note when clicked in graph/timeline/map
    void this.entityManager.openEntityNote(entityId);
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

  async callRemoteModel(messages: ChatMessage[], stream: boolean = false, model?: string, signal?: AbortSignal, useLocal: boolean = false): Promise<string> {
    if (!this.claudeCodeService) {
      throw new Error("Claude Code not initialized. Check Settings → OSINT Copilot → Graph Extraction.");
    }

    let systemPrompt = '';
    let userContent = '';
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n' : '') + msg.content;
      } else {
        userContent += (userContent ? '\n' : '') + msg.content;
      }
    }

    return this.claudeCodeService.chat(systemPrompt, userContent, signal);
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

  async callRemoteModelStream(
    messages: ChatMessage[],
    onDelta?: (text: string) => void,
    onRetry?: (attempt: number, maxAttempts: number) => void,
    signal?: AbortSignal,
    useLocal: boolean = false
  ): Promise<string> {
    const full = await this.callRemoteModel(messages, false, undefined, signal, useLocal);
    if (onDelta) onDelta(full);
    return full;
  }

  // ============================================================================
  // Q&A FUNCTIONALITY
  // ============================================================================

  async askVault(query: string): Promise<{ answer: string; notes: IndexedNote[] }> {

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
    signal?: AbortSignal,
    useLocal: boolean = false
  ): Promise<{ fullAnswer: string; notes: IndexedNote[] }> {
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

    const fullAnswer = await this.callRemoteModelStream(messages, onDelta, onRetry, signal, useLocal);

    return { fullAnswer, notes: contextNotes };
  }

  // ============================================================================
  // CLASSIFICATION HELPERS
  // ============================================================================

  /**
   * Extract entity name and type from a user query.
   * This is the primary method used for entity extraction - it returns both
   * the entity name and its classified type in a single LLM call.
   */
  async extractEntitiesFromQuery(query: string, useLocal: boolean = false): Promise<Array<{
    name: string | null;
    type: "person" | "company" | "asset" | "event" | "location" | "unknown";
  }>> {
    const system =
      "Extract the main entities mentioned in the user's query and classify each as one of: person | company | asset | event | location | unknown. Respond ONLY in JSON with a list of objects: [{\"name\":\"<entity name>\",\"type\":\"person|company|asset|event|location|unknown\"}]. If no specific entities are found, return an empty list []. Use English only.";

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: query },
    ];

    try {
      const model = useLocal ? LOCAL_VAULT_MODEL : ENTITY_EXTRACTION_MODEL;
      const text = await this.callRemoteModel(messages, false, model, undefined, useLocal);

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

  // ============================================================================
  // MODALS
  // ============================================================================

  openAskModal() {
    new AskModal(this.app, this).open();
  }


}
