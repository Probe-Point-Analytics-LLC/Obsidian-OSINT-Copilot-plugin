import {
  Notice,
  Setting,
  TFile,
  TFolder,
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  normalizePath,
} from "obsidian";

import {
  EntityType,
  Entity,
  ProcessTextResponse,
  validateEntityName,
  getEntityLabel,
  type GraphWriteContext,
} from '../entities/types';
import { isLikelyExpectedUrlFetchFailure } from '../services/api-service';
import type { ExtractionLogEvent } from '../services/claude-code-service';
import { ensureFolderExists } from '../utils/vault-bootstrap-fs';
import {
  Conversation,
  ConversationMetadata,
  ConversationMessage,
  type CopilotChatMode,
  legacyFlagsForChatMode,
  inferChatModeFromLegacyFields,
} from '../services/conversation-service';
import { ConfirmModal } from '../modals/confirm-modal';
import {
  ORCHESTRATION_TOOL_DISPLAY_NAMES,
  type OrchestrationProgressMeta,
} from '../services/orchestration-service';
import type { OrchestrationPlan } from '../services/orchestration-plan';
import {
  getChatRuntimeAvailability,
  type ChatRuntimeAvailability,
} from '../services/agent-runtime/chat-runtime-availability';
import {
  CLAUDE_RUNTIME_ID,
  CODEX_RUNTIME_ID,
  getConfiguredRuntimeOptions,
} from '../services/agent-runtime/runtime-registry';
import type { CustomVaultOperation } from '../services/custom-vault-operations';
import { normalizeCustomVaultOperations, summarizeCustomVaultOperation } from '../services/custom-vault-operations';
import { applyCustomVaultOperations } from '../services/custom-vault-writer';
import { isTaskAgentRunnable } from '../task-agents/task-agent-settings';
import type { TaskAgentManifest } from '../task-agents/types';
import type { IndexedNote } from '../chat/indexed-note';
import type { ChatHistoryItem } from '../chat/chat-types';
import { RenameConversationModal } from '../modals/rename-conversation-modal';
import { appendVaultOpPreviewBlock } from '../ui/vault-op-previews';
import type VaultAIPlugin from '../plugin/vault-ai-plugin';

export const CHAT_VIEW_TYPE = "vault-ai-chat-view";


export class ChatView extends ItemView {
  plugin: VaultAIPlugin;
  chatHistory: ChatHistoryItem[] = [];
  inputEl!: HTMLTextAreaElement;
  messagesContainer!: HTMLDivElement;
  sidebarContainer!: HTMLDivElement;
  conversationListEl!: HTMLDivElement;
  /** Tri-mode chat: general (orchestration), graph (entity extract only), local (vault Q&A). */
  chatMode: CopilotChatMode = 'general';
  // Legacy flags — kept in sync with `chatMode` via `legacyFlagsForChatMode` for YAML and older code paths
  localSearchMode: boolean = false;
  customChatMode: boolean = false;
  activeCheckpointId: string | undefined;
  orchestrationMode: boolean = true;
  vaultGraphIngestMode: boolean = false;
  /** Legacy: persisted on conversations; task agents are configured in settings only. */
  selectedTaskAgentId: string = "";
  graphGenerationMode: boolean = false;
  graphGenerationToggle!: HTMLInputElement;
  entityGenContainer!: HTMLElement;
  pollingIntervals: Map<string, number> = new Map();
  currentConversation: Conversation | null = null;
  sidebarVisible: boolean = true;
  uploadButtonEl!: HTMLElement;
  urlButtonEl!: HTMLElement; // URL extraction button
  /** Send button (used to disable when no agent CLI is available). */
  sendButtonEl!: HTMLButtonElement;
  dragOverlay!: HTMLElement;
  // Attached files display
  attachmentsContainer!: HTMLElement;
  // Stores attached files - content is extracted only when sending
  attachedFiles: { file: TFile | File; extracted: boolean; content?: string }[] = [];

  // Track active operations for cancellation
  activeAbortControllers: Map<number, AbortController> = new Map();

  private abortAllActiveOperations(): void {
    for (const controller of this.activeAbortControllers.values()) {
      controller.abort();
    }
    this.activeAbortControllers.clear();
  }

  private shouldDisplayDetailedExtractionLogs(): boolean {
    return this.plugin.settings.extractionLogVerbosity === 'detailed';
  }

  private formatExtractionLogLine(ev: ExtractionLogEvent): string {
    const t = new Date(ev.timestamp).toLocaleTimeString();
    const base = `[${t}] ${ev.level.toUpperCase()} ${ev.phase}: ${ev.message}`;
    if (!ev.details) return base;
    return `${base}\n${ev.details}`;
  }

  /**
   * Builds a log-event appender for the collapsible "Agent logs" panel rendered under a
   * chat message's progress bar. Shared by attachment extraction and unified-agent turns so
   * the verbosity filter and entry cap can't drift between the two.
   */
  private makeLogAppender(messageIndex: number): (ev: ExtractionLogEvent) => void {
    return (ev: ExtractionLogEvent) => {
      if (!this.activeAbortControllers.has(messageIndex)) return;
      const item = this.chatHistory[messageIndex];
      if (!item) return;
      const include = this.shouldDisplayDetailedExtractionLogs()
        ? true
        : (ev.phase === 'invoke_start' || ev.phase === 'invoke_exit' || ev.phase === 'invoke_error' || ev.phase === 'invoke_aborted');
      if (!include) return;
      if (!item.extractionLogs) item.extractionLogs = [];
      item.extractionLogs.push(ev);
      if (item.extractionLogs.length > 80) {
        item.extractionLogs = item.extractionLogs.slice(-80);
      }
      void this.renderMessages();
    };
  }

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

  private applyChatMode(mode: CopilotChatMode) {
    this.chatMode = mode;
    const f = legacyFlagsForChatMode(mode);
    this.localSearchMode = f.localSearchMode;
    this.graphGenerationMode = f.graphGenerationMode;
    this.orchestrationMode = f.orchestrationMode;
    this.vaultGraphIngestMode = f.vaultGraphIngestMode;
    this.customChatMode = false;
    this.activeCheckpointId = undefined;
  }

  private syncModesFromConversation(_conv: ConversationMetadata) {
    this.applyChatMode("general");
  }

  private runtimeDisplayName(runtimeId: string): string {
    const opt = getConfiguredRuntimeOptions(this.plugin).find((r) => r.id === runtimeId);
    return opt?.displayName || "Claude Code";
  }

  /** Keep a removed runtime id valid, but never fail over a valid user selection. */
  private async syncRuntimeSelectionToAvailability(_av: ChatRuntimeAvailability): Promise<void> {
    const configured = getConfiguredRuntimeOptions(this.plugin).map((r) => r.id);
    const cur = this.plugin.settings.agentRuntimeProvider;
    if (!configured.includes(cur)) {
      this.plugin.settings.agentRuntimeProvider = CLAUDE_RUNTIME_ID;
      await this.plugin.saveSettings();
      return;
    }
  }

  private buildRuntimeHeaderRow(buttonGroup: HTMLElement, av: ChatRuntimeAvailability): void {
    const wrap = buttonGroup.createDiv({ cls: "vault-ai-runtime-header" });
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "8px";
    wrap.style.flexWrap = "wrap";

    const configured = getConfiguredRuntimeOptions(this.plugin);
    if (av.availableIds.length === 0) {
      wrap.createEl("span", {
        text: "No agent CLI detected. Configure Claude, Codex, Hermes, or a custom runtime under Settings → OSINT Copilot.",
        cls: "setting-item-description",
      });
    }
    new Setting(wrap)
      .setName("Runtime")
      .addDropdown((dd) => {
        for (const rt of configured) {
          dd.addOption(rt.id, av.byId[rt.id] ? rt.displayName : `${rt.displayName} (unavailable)`);
        }
        dd.setValue(this.plugin.settings.agentRuntimeProvider);
        dd.onChange(async (v) => {
          if (this.plugin.settings.agentRuntimeProvider === v) return;
          this.plugin.settings.agentRuntimeProvider = v;
          if (v === CLAUDE_RUNTIME_ID || v === CODEX_RUNTIME_ID) {
            this.plugin.settings.apiProvider = v;
          }
          await this.plugin.saveSettings();
        });
      });
  }

  /** Select a vault task agent, or leave the unified agent as the conversation workflow. */
  private async buildTaskAgentHeaderRow(buttonGroup: HTMLElement): Promise<void> {
    if (!this.plugin.settings.taskAgentsEnabled) {
      this.selectedTaskAgentId = "";
      return;
    }
    let agents: TaskAgentManifest[];
    try {
      agents = (await this.plugin.taskAgentRegistry.listAgents())
        .filter((agent) => isTaskAgentRunnable(agent, this.plugin.settings));
    } catch (error) {
      console.warn('[ChatView] Could not list task agents:', error);
      return;
    }
    if (!agents.some((agent) => agent.id === this.selectedTaskAgentId)) {
      this.selectedTaskAgentId = "";
    }
    if (agents.length === 0) return;

    const wrap = buttonGroup.createDiv({ cls: "vault-ai-task-agent-header" });
    new Setting(wrap)
      .setName("Workflow")
      .addDropdown((dd) => {
        dd.addOption("", "Unified agent");
        for (const agent of agents) dd.addOption(agent.id, agent.name);
        dd.setValue(this.selectedTaskAgentId);
        dd.onChange(async (value) => {
          this.selectedTaskAgentId = value;
          this.plugin.settings.preferredTaskAgentId = value;
          if (this.currentConversation) {
            this.currentConversation.taskAgentId = value || undefined;
            await this.plugin.conversationService.saveConversation(this.currentConversation);
          }
          await this.plugin.saveSettings();
        });
      });
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
      this.syncModesFromConversation(conversation);
      this.selectedTaskAgentId =
        conversation.taskAgentId ?? this.plugin.settings.preferredTaskAgentId ?? "";
    } else {
      this.applyChatMode('general');
      this.selectedTaskAgentId = this.plugin.settings.preferredTaskAgentId ?? "";
    }
  }

  conversationMessagesToHistory(messages: ConversationMessage[]): ChatHistoryItem[] {
    return messages.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      notes: m.notes as IndexedNote[],
      jobId: m.jobId,
      status: m.status,
      progress: m.progress as { message: string, percent: number } | undefined,
      reportFilePath: m.reportFilePath,
      usedEntities: m.usedEntities,
      proposedModifications: m.proposedModifications,
      proposedCustomVaultOps:
        Array.isArray(m.proposedCustomVaultOps) && m.proposedCustomVaultOps.length > 0
          ? normalizeCustomVaultOperations(m.proposedCustomVaultOps)
          : undefined,
      proposedPlan: m.proposedPlan as OrchestrationPlan
    }));
  }

  historyToConversationMessages(): ConversationMessage[] {
    return this.chatHistory.map(h => {
      // Assign a timestamp once, on first save, then keep it — otherwise every
      // re-save (e.g. after each new turn) would stamp the whole history with
      // the current time, collapsing all messages onto one identical value.
      if (h.timestamp === undefined) h.timestamp = Date.now();
      return {
        role: h.role,
        content: h.content,
        timestamp: h.timestamp,
        notes: h.notes,
        jobId: h.jobId,
        status: h.status,
        progress: h.progress,
        reportFilePath: h.reportFilePath,
        usedEntities: h.usedEntities,
        proposedModifications: h.proposedModifications,
        proposedCustomVaultOps: h.proposedCustomVaultOps as Record<string, unknown>[] | undefined,
        proposedPlan: h.proposedPlan
      };
    });
  }

  async saveCurrentConversation() {
    this.applyChatMode("general");
    if (!this.currentConversation) {
      this.currentConversation = await this.plugin.conversationService.createConversation(
        this.chatHistory.length > 0 ? this.chatHistory[0].content : undefined,
        this.chatMode,
        this.selectedTaskAgentId,
      );
    }
    this.currentConversation.messages = this.historyToConversationMessages();
    this.currentConversation.chatMode = "general";
    this.currentConversation.taskAgentId = this.selectedTaskAgentId.trim() || undefined;
    const f = legacyFlagsForChatMode(this.chatMode);
    this.currentConversation.localSearchMode = f.localSearchMode;
    this.currentConversation.graphGenerationMode = f.graphGenerationMode;
    this.currentConversation.orchestrationMode = f.orchestrationMode;
    this.currentConversation.vaultGraphIngestMode = f.vaultGraphIngestMode;
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

    const runtimeAvailability = await getChatRuntimeAvailability(this.plugin);
    await this.syncRuntimeSelectionToAvailability(runtimeAvailability);
    this.buildRuntimeHeaderRow(buttonGroup, runtimeAvailability);
    await this.buildTaskAgentHeaderRow(buttonGroup);

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

    // Legacy graph toggle hidden (unified agent handles extraction intent from the prompt)
    this.entityGenContainer = buttonGroup.createDiv("vault-ai-entity-gen-toggle");
    this.entityGenContainer.addClass("vault-ai-toggle-container");
    this.entityGenContainer.style.display = "none";

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
      this.updateModeDisclaimer();
      this.updateUploadButtonVisibility();
      this.updateUrlButtonVisibility();
    });

    const entityGenLabel = this.entityGenContainer.createEl("label", {
      text: this.getGraphGenLabelText(),
      cls: this.graphGenerationMode ? "vault-ai-entity-gen-label active" : "vault-ai-entity-gen-label",
    });
    entityGenLabel.htmlFor = "graph-gen-mode-toggle";

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
        "accept": ".md,.txt,.pdf,.docx,.doc,.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.ico",
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
      text: "Send",
      cls: "vault-ai-send-btn"
    });
    this.sendButtonEl = sendBtn;
    if (runtimeAvailability.availableIds.length === 0) {
      sendBtn.disabled = true;
      sendBtn.title = "Install and configure Claude, Codex, Hermes, or a custom runtime in Settings → OSINT Copilot.";
    } else {
      sendBtn.disabled = false;
      sendBtn.title = "";
    }
    sendBtn.addEventListener("click", () => void this.handleSend());

    // Drag and Drop Overlay
    this.dragOverlay = inputContainer.createDiv("vault-ai-drag-overlay");
    this.dragOverlay.createDiv({ text: "Drop file to extract text", cls: "vault-ai-drag-text" });

    inputContainer.addEventListener("dragenter", (e) => {
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
      e.preventDefault();
      e.stopPropagation();
      if (!inputContainer.contains(e.relatedTarget as Node)) {
        this.dragOverlay.removeClass("active");
      }
    });

    inputContainer.addEventListener("dragover", (e) => {
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

      let handled = false;

      // 1) Internal Obsidian drag manager (check first — takes priority over dataTransfer)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dragManager = (this.app as any).dragManager;
      if (dragManager?.draggable) {
        const draggable = dragManager.draggable;
        console.log('[OSINT Copilot] Drop: dragManager draggable type =', draggable.type,
          'file =', draggable.file?.path || draggable.file,
          'files =', draggable.files?.length);

        // Single item: .file can be TFile or TFolder regardless of .type string
        if (draggable.file instanceof TFolder) {
          await this.handleDroppedFolder(draggable.file);
          handled = true;
        } else if (draggable.file instanceof TFile) {
          await this.handleDroppedAbstractFile(draggable.file);
          handled = true;
        }

        // Multi-select: .files array
        if (!handled && Array.isArray(draggable.files) && draggable.files.length > 0) {
          for (const f of draggable.files) {
            if (f instanceof TFolder) await this.handleDroppedFolder(f);
            else if (f instanceof TFile) await this.handleDroppedAbstractFile(f);
          }
          handled = true;
        }

        // Some Obsidian versions put folder info under .info
        if (!handled && draggable.info) {
          const info = draggable.info;
          if (typeof info === 'string') {
            const resolved = this.app.vault.getAbstractFileByPath(info);
            if (resolved instanceof TFolder) {
              await this.handleDroppedFolder(resolved);
              handled = true;
            } else if (resolved instanceof TFile) {
              await this.handleDroppedAbstractFile(resolved);
              handled = true;
            }
          }
        }
      }

      // 2) text/plain data (Obsidian often puts the vault path here)
      if (!handled && e.dataTransfer) {
        const data = e.dataTransfer.getData("text/plain");
        if (data) {
          const abstractFile = this.app.vault.getAbstractFileByPath(data);
          if (abstractFile instanceof TFolder) {
            await this.handleDroppedFolder(abstractFile);
            handled = true;
          } else if (abstractFile instanceof TFile) {
            await this.handleDroppedAbstractFile(abstractFile);
            handled = true;
          }
        }
      }

      // 3) External OS files (only if nothing internal matched)
      if (!handled && e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          this.handleDroppedFile(e.dataTransfer.files[i]);
        }
        handled = true;
      }

      if (!handled) {
        console.log('[OSINT Copilot] Drop: unhandled. dataTransfer types =',
          e.dataTransfer ? Array.from(e.dataTransfer.types) : 'none');
      }
    });

    // Handle Enter key (Shift+Enter for new line)
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
      }
    });

    this.updateAllModeLabels();

    // Hosted OSINT options panel removed
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
    if (this.selectedTaskAgentId.trim()) {
      return {
        icon: "🤖",
        title: "Task agent:",
        text: `The selected vault task agent runs through ${this.runtimeDisplayName(this.plugin.settings.apiProvider)} and may automatically create or update files, limited by both configured output allowlists.`,
      };
    }
    const p = this.runtimeDisplayName(this.plugin.settings.agentRuntimeProvider);
    return {
      icon: "🤖",
      title: "Unified agent:",
      text: `One local ${p} turn per message. Search vs graph work follows your message and attachments; vault prompts under OSINTCopilot/custom still augment the agent.`,
    };
  }

  updateUploadButtonVisibility() {
    if (this.uploadButtonEl) {
      this.uploadButtonEl.style.display = "block";
    }
  }

  updateUrlButtonVisibility() {
    if (this.urlButtonEl) {
      this.urlButtonEl.style.display = "block";
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

        // Show user message in chat with the full URL
        const displayUrl = url;
        this.chatHistory.push({ role: "user", content: `🔗 ${displayUrl}` });
        await this.renderMessages();

        // Send extracted content directly to graph generation
        new Notice(`Extracted content from URL. Processing entities...`);
        await this.handleGraphOnlyMode(extractedText);

        // Save conversation
        await this.saveCurrentConversation();

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (isLikelyExpectedUrlFetchFailure(errorMsg)) {
          console.debug("URL extraction skipped:", errorMsg.slice(0, 120));
          statusEl.textContent =
            "Could not open this link from Obsidian (login or site protection). Copy the page text into the chat instead."; // eslint-disable-line obsidianmd/ui/sentence-case
          statusEl.style.color = "var(--text-muted)";
        } else {
          console.error("URL extraction error:", error);
          if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
            statusEl.textContent = "❌ Request timed out. Try a simpler page."; // eslint-disable-line obsidianmd/ui/sentence-case
          } else if (errorMsg.includes("429")) {
            statusEl.textContent = "❌ Server busy. Please wait and try again."; // eslint-disable-line obsidianmd/ui/sentence-case
          } else {
            statusEl.textContent = `❌ ${errorMsg}`;
          }
          statusEl.style.color = "var(--text-error)";
        }

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

  updateGraphToggleVisibility() {
    if (this.entityGenContainer) {
      this.entityGenContainer.style.display = "none";
    }
  }

  async handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    const file = target.files[0];
    target.value = '';

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ChatView.ALLOWED_EXTENSIONS.has(ext)) {
      new Notice(`File type .${ext} not supported. Use images or documents.`);
      return;
    }

    this.attachedFiles.push({ file, extracted: false });
    this.renderAttachments();
    new Notice(`Attached: ${file.name}`);
  }

  private static readonly IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']);
  private static readonly ALLOWED_EXTENSIONS = new Set([
    'md', 'txt', 'pdf', 'docx', 'doc',
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
  ]);

  static isImageFile(name: string): boolean {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return ChatView.IMAGE_EXTENSIONS.has(ext);
  }

  async handleDroppedFile(file: File) {
    if (!file) return;

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ChatView.ALLOWED_EXTENSIONS.has(ext)) {
      new Notice(`File type .${ext} not supported. Use images (.jpg, .png, etc.) or documents (.pdf, .docx, .txt)`);
      return;
    }

    this.attachedFiles.push({ file, extracted: false });
    this.renderAttachments();
    new Notice(`Attached: ${file.name}`);
  }

  private getVaultAbsolutePath(): string {
    const adapter = this.app.vault.adapter as any;
    return typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
  }

  /** Preserve prior evidence when a browser upload reuses an existing filename. */
  private getAvailableEvidencePath(evidenceFolder: string, rawName: string): string {
    const safeName = rawName.replace(/[\\/:*?"<>|]/g, '_');
    const dot = safeName.lastIndexOf('.');
    const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
    const extension = dot > 0 ? safeName.slice(dot) : '';
    let candidate = normalizePath(`${evidenceFolder}/${safeName}`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(`${evidenceFolder}/${stem}-${suffix}${extension}`);
      suffix++;
    }
    return candidate;
  }

  /**
   * Handle dropped internal file (TFile) from Obsidian Vault
   */
  async handleDroppedAbstractFile(file: TFile) {
    if (!file) return;

    const ext = (file.extension || '').toLowerCase();
    if (!ChatView.ALLOWED_EXTENSIONS.has(ext)) {
      new Notice(`File type .${ext} not supported. Use images or documents.`);
      return;
    }

    this.attachedFiles.push({ file, extracted: false });
    this.renderAttachments();
    new Notice(`Attached: ${file.name}`);
  }

  /**
   * Handle a dropped folder — recursively collect all allowed files and attach them.
   */
  async handleDroppedFolder(folder: TFolder) {
    if (!folder) return;

    const files = this.collectFilesFromFolder(folder);
    if (files.length === 0) {
      new Notice(`No supported files found in folder "${folder.name}"`);
      return;
    }

    for (const file of files) {
      this.attachedFiles.push({ file, extracted: false });
    }
    this.renderAttachments();
    new Notice(`Attached ${files.length} file${files.length > 1 ? 's' : ''} from folder "${folder.name}"`);
  }

  private collectFilesFromFolder(folder: TFolder): TFile[] {
    const results: TFile[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile) {
        const ext = (child.extension || '').toLowerCase();
        if (ChatView.ALLOWED_EXTENSIONS.has(ext)) {
          results.push(child);
        }
      } else if (child instanceof TFolder) {
        results.push(...this.collectFilesFromFolder(child));
      }
    }
    return results;
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

      const isImage = ChatView.isImageFile(attachment.file.name);
      const fileInfo = attachmentEl.createDiv("vault-ai-attachment-info");
      fileInfo.createSpan({ text: isImage ? "🖼️ " : "📄 ", cls: "vault-ai-attachment-icon" });
      fileInfo.createSpan({ text: attachment.file.name, cls: "vault-ai-attachment-name" });

      if (attachment.extracted && attachment.content) {
        const preview = attachment.content.substring(0, 100).replace(/\n/g, ' ').trim();
        if (preview) {
          attachmentEl.createDiv({
            text: preview + (attachment.content.length > 100 ? '...' : ''),
            cls: "vault-ai-attachment-preview"
          });
        }
      } else {
        attachmentEl.createDiv({
          text: isImage ? "🔍 Will analyze with AI on send" : "📋 Ready to extract on send",
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
      const msg = error instanceof Error ? error.message : String(error);
      if (isLikelyExpectedUrlFetchFailure(msg)) {
        console.debug("URL extraction skipped:", msg.slice(0, 120));
        new Notice("Could not open this link from Obsidian. Paste the page text into the chat instead.");
      } else {
        console.error("URL extraction error:", error);
        new Notice(`Error extracting URL: ${msg}`);
      }
      return false; // Return false to indicate failure/not handled
    } finally {
      this.inputEl.disabled = false;
      this.updateInputPlaceholder();
      this.inputEl.focus();
    }
  }



  isGraphOnlyMode(): boolean {
    return false;
  }

  // Show notice when entering Graph only Mode
  checkGraphOnlyMode() {
    if (this.isGraphOnlyMode()) {
      new Notice("Graph only mode - enter text to extract entities");
    }
  }

  // Get the appropriate input placeholder based on current mode
  getInputPlaceholder(): string {
    return "Ask for an investigation (search vs graph follows from your wording and attachments). Pick the runtime in the header when multiple agents are available…";
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
      sendBtn.textContent = "Send";
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
      const convMode = conv.chatMode ?? inferChatModeFromLegacyFields(conv);
      if (convMode === "general") {
        meta.createEl("span", {
          text: "🤖",
          cls: "vault-ai-conversation-orchestration",
          title: "General agent",
        });
      } else if (convMode === "graph") {
        meta.createEl("span", {
          text: "🏷️",
          cls: "vault-ai-conversation-graphonly",
          title: "Graph generation",
        });
      } else {
        meta.createEl("span", {
          text: "🔍",
          cls: "vault-ai-conversation-local-search",
          title: "Local search",
        });
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
      this.abortAllActiveOperations();
      this.currentConversation = conversation;
      this.chatHistory = this.conversationMessagesToHistory(conversation.messages);
      this.syncModesFromConversation(conversation);
      this.selectedTaskAgentId =
        conversation.taskAgentId ?? this.plugin.settings.preferredTaskAgentId ?? "";
      this.plugin.conversationService.setCurrentConversationId(id);
      await this.render();
    } else {
      new Notice("Failed to load conversation");
    }
  }

  async startNewConversation() {
    this.abortAllActiveOperations();
    // Save current conversation first if it has messages
    if (this.currentConversation && this.chatHistory.length > 0) {
      await this.saveCurrentConversation();
    }
    this.currentConversation = null;
    this.chatHistory = [];
    this.applyChatMode('general');
    this.selectedTaskAgentId = this.plugin.settings.preferredTaskAgentId ?? "";
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
          this.abortAllActiveOperations();
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

      if (item.role === "assistant" && item.extractionLogs && item.extractionLogs.length > 0) {
        const details = messageDiv.createEl("details", { cls: "vault-ai-extraction-logs" });
        details.style.cssText =
          "margin-top: 8px; padding: 8px; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-secondary);";
        details.open = !!item.extractionLogsExpanded;
        const summary = details.createEl("summary", {
          text: `Agent logs (${item.extractionLogs.length})`,
        });
        summary.style.cssText = "cursor: pointer; font-size: 12px; color: var(--text-muted);";
        details.addEventListener("toggle", () => {
          item.extractionLogsExpanded = details.open;
        });

        const logList = details.createEl("div", { cls: "vault-ai-extraction-log-list" });
        logList.style.cssText =
          "margin-top: 8px; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;";
        for (const ev of item.extractionLogs) {
          const row = logList.createEl("pre", { text: this.formatExtractionLogLine(ev) });
          row.style.cssText =
            "margin: 0; white-space: pre-wrap; font-size: 11px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 6px;";
        }
      }

      // NEW: Show multiple progress bars for concurrent investigation tools
      if (item.role === "assistant" && item.multiProgress && Object.keys(item.multiProgress).length > 0) {
        const multiProgressContainer = messageDiv.createDiv("vault-ai-multi-progress-container");
        multiProgressContainer.style.cssText = `
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin: 12px 0;
          padding: 12px;
          background: var(--background-secondary);
          border-radius: 8px;
          border: 1px solid var(--background-modifier-border);
        `;

        if (this.activeAbortControllers.has(i)) {
          const cancelAllRow = multiProgressContainer.createDiv("vault-ai-multi-cancel-all-row");
          cancelAllRow.style.cssText =
            "display: flex; justify-content: flex-end; margin-bottom: 4px;";
          const cancelAllBtn = cancelAllRow.createEl("button", {
            text: "Cancel all",
            cls: "vault-ai-cancel-all-btn",
          });
          cancelAllBtn.style.cssText =
            "font-size: 11px; padding: 4px 10px; cursor: pointer; color: var(--text-muted); background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 4px;";
          cancelAllBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void this.handleCancel(i);
          });
        }

        for (const [tool, progress] of Object.entries(item.multiProgress)) {
          const toolRow = multiProgressContainer.createDiv("vault-ai-tool-progress-row");
          toolRow.setAttribute("data-tool", tool);
          toolRow.style.cssText =
            "margin-bottom: 12px; padding: 8px; background: var(--background-secondary-alt); border-radius: 6px; border: 1px solid var(--background-modifier-border); display: flex; flex-direction: column; gap: 4px;";

          const header = toolRow.createDiv("vault-ai-tool-header");
          header.style.cssText =
            "display: flex; align-items: center; gap: 10px; justify-content: space-between; margin-bottom: 6px;";

          const label = header.createDiv("vault-ai-tool-label");
          label.textContent = tool;
          label.style.cssText =
            "font-size: 12px; font-weight: 600; color: var(--text-normal); flex: 1; min-width: 0;";

          const headerRight = header.createDiv("vault-ai-tool-header-right");
          headerRight.style.cssText = "display: flex; align-items: center; gap: 8px; flex-shrink: 0;";

          const pctEl = headerRight.createDiv("vault-ai-tool-percent");
          pctEl.textContent = `${progress.percent}%`;
          pctEl.style.cssText = "font-size: 11px; color: var(--interactive-accent);";

          const toolId = item.orchestrationDisplayToToolId?.[tool];
          const ctrl = toolId ? item.orchestrationAbortByToolId?.[toolId] : undefined;
          if (ctrl && !ctrl.signal.aborted) {
            const cancelWrap = headerRight.createDiv("vault-ai-tool-cancel-wrap");
            const cancelBtn = cancelWrap.createEl("button", { text: "Cancel", cls: "vault-ai-tool-cancel-btn" });
            cancelBtn.style.cssText =
              "font-size: 11px; padding: 2px 8px; cursor: pointer; color: var(--text-muted); background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 4px;";
            cancelBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (toolId) void this.handleOrchestrationToolCancel(i, toolId);
            });
          }

          const progressTrack = toolRow.createDiv("vault-ai-tool-bar-container");
          progressTrack.style.cssText = `
            height: 6px;
            background: var(--background-modifier-border);
            border-radius: 3px;
            overflow: hidden;
            position: relative;
          `;

          const progressFill = progressTrack.createDiv("vault-ai-tool-bar-fill");
          progressFill.style.cssText = `
            height: 100%;
            width: ${progress.percent}%;
            background: var(--interactive-accent);
            transition: width 0.3s ease-in-out;
          `;

          const statusText = toolRow.createDiv("vault-ai-tool-status");
          statusText.textContent = progress.message;
          statusText.style.cssText =
            "font-size: 11px; color: var(--text-muted); margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
        }
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

      // Step-by-step: Show tool results for review with continue button
      if (item.role === "assistant" && item.toolResults && Object.keys(item.toolResults).length > 0) {
        this.renderToolResults(item, i, messageDiv);
      }

      // Round 4: Show proposed graph modifications (persistent box)
      if (item.role === "assistant" && item.proposedModifications && item.proposedModifications.length > 0) {
        const proposedDiv = messageDiv.createDiv("vault-ai-proposed-modifications");
        proposedDiv.style.cssText = `
          margin-top: 12px;
          padding: 12px;
          background: var(--background-secondary-alt);
          border: 1px solid var(--background-modifier-border-hover);
          border-radius: 8px;
          border-left: 4px solid var(--interactive-accent);
        `;

        proposedDiv.createEl("h4", {
          text: "📊 Proposed Graph Changes",
          cls: "vault-ai-proposed-title"
        }).style.marginTop = "0";

        proposedDiv.createEl("p", {
          text: "Review and apply the following graph modifications:",
          cls: "vault-ai-proposed-subtitle"
        }).style.fontSize = "small";

        const listContainer = proposedDiv.createDiv("vault-ai-proposed-list");
        listContainer.style.marginBottom = "12px";

        const selectedIndices: number[] = [];

        item.proposedModifications.forEach((cmd, idx) => {
          const row = listContainer.createDiv();
          row.style.cssText = `
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin-bottom: 6px;
            padding: 4px;
            border-bottom: 1px solid var(--background-modifier-border);
          `;

          const cb = row.createEl("input");
          cb.type = "checkbox";
          cb.checked = true;
          selectedIndices.push(idx);
          cb.style.marginTop = "4px";

          const label = row.createEl("span");
          label.style.fontSize = "13px";

          let labelText = `❓ ${cmd}`;
          try {
            if (cmd.startsWith("@@create_entity")) {
              const data = JSON.parse(cmd.replace("@@create_entity", "").trim());
              labelText = `➕ Create ${data.type}: **${data.label || 'Entity'}**`;
            } else if (cmd.startsWith("@@delete_entity")) {
              const data = JSON.parse(cmd.replace("@@delete_entity", "").trim());
              const name = this.plugin.entityManager.getEntity(data.id)?.label || `ID: ${data.id}`;
              labelText = `🗑️ Delete Entity: **${name}**`;
            } else if (cmd.startsWith("@@create_link")) {
              const data = JSON.parse(cmd.replace("@@create_link", "").trim());
              labelText = `🔗 Connect: [**${data.from}**] ──(${data.relationship})──> [**${data.to}**]`;
            } else if (cmd.startsWith("@@delete_link")) {
              const data = JSON.parse(cmd.replace("@@delete_link", "").trim());
              labelText = `✂️ Delete Link (ID: ${data.id})`;
            }
          } catch (e) { labelText = `⚠️ Raw: ${cmd}`; }

          const parts = labelText.split(/(\*\*.*?\*\*)/g);
          parts.forEach(p => {
            if (p.startsWith('**') && p.endsWith('**')) {
              label.createEl('strong', { text: p.substring(2, p.length - 2) });
            } else {
              label.appendChild(document.createTextNode(p));
            }
          });

          cb.addEventListener("change", () => {
            if (cb.checked) selectedIndices.push(idx);
            else {
              const iIdx = selectedIndices.indexOf(idx);
              if (iIdx > -1) selectedIndices.splice(iIdx, 1);
            }
          });
        });

        const actionRow = proposedDiv.createDiv();
        actionRow.style.display = "flex";
        actionRow.style.gap = "10px";

        const applyBtn = actionRow.createEl("button", {
          text: "Apply Selected Changes",
          cls: "mod-cta"
        });
        applyBtn.addEventListener("click", () => {
          void this.applyProposedModifications(i, selectedIndices);
        });

        const dismissBtn = actionRow.createEl("button", {
          text: "Dismiss"
        });
        dismissBtn.addEventListener("click", () => {
          this.chatHistory[i].proposedModifications = undefined;
          this.renderMessages();
        });
      }

      if (item.role === "assistant" && item.proposedCustomVaultOps && item.proposedCustomVaultOps.length > 0) {
        const vaultOpsDiv = messageDiv.createDiv("vault-ai-proposed-custom-vault");
        vaultOpsDiv.style.cssText = `
          margin-top: 12px;
          padding: 12px;
          background: var(--background-secondary-alt);
          border: 1px solid var(--background-modifier-border-hover);
          border-radius: 8px;
          border-left: 4px solid var(--text-accent);
        `;
        vaultOpsDiv.createEl("h4", { text: "📁 Proposed vault changes (skills / credentials / enrichers / scripts)" }).style.marginTop = "0";
        vaultOpsDiv.createEl("p", {
          text: "Review and apply file writes under your OSINT Copilot custom folder. Credential file contents are not shown here. Script proposals show a side-by-side diff (current vault vs proposed); the plugin does not run scripts.",
        }).style.fontSize = "small";

        const listEl = vaultOpsDiv.createDiv();
        listEl.style.marginBottom = "12px";
        const selectedVaultOpIndices = new Set<number>(item.proposedCustomVaultOps.map((_, idx) => idx));

        for (let idx = 0; idx < item.proposedCustomVaultOps.length; idx++) {
          const op = item.proposedCustomVaultOps[idx];
          const outer = listEl.createDiv();
          outer.style.cssText = `
            display: flex;
            flex-direction: column;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--background-modifier-border);
          `;
          const row = outer.createDiv();
          row.style.cssText = `
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 4px 0 0 0;
          `;
          const cb = row.createEl("input");
          cb.type = "checkbox";
          cb.checked = true;
          cb.style.marginTop = "4px";
          const label = row.createEl("span", { text: summarizeCustomVaultOperation(op) });
          label.style.fontSize = "13px";
          cb.addEventListener("change", () => {
            if (cb.checked) selectedVaultOpIndices.add(idx);
            else selectedVaultOpIndices.delete(idx);
          });
          await appendVaultOpPreviewBlock(this.plugin, outer, op);
        }

        const vaultActionRow = vaultOpsDiv.createDiv();
        vaultActionRow.style.display = "flex";
        vaultActionRow.style.gap = "10px";
        const applyVaultBtn = vaultActionRow.createEl("button", { text: "Apply selected", cls: "mod-cta" });
        applyVaultBtn.addEventListener("click", () => {
          void this.applyProposedCustomVaultOps(i, Array.from(selectedVaultOpIndices));
        });
        const dismissVaultBtn = vaultActionRow.createEl("button", { text: "Dismiss" });
        dismissVaultBtn.addEventListener("click", () => {
          this.chatHistory[i].proposedCustomVaultOps = undefined;
          void this.renderMessages();
          void this.saveCurrentConversation();
        });
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

      const vaultLive = this.chatHistory[messageIndex]?.vaultIngestLiveLog;
      const vaultPreviewCmds = this.chatHistory[messageIndex]?.vaultIngestPreviewCommands;
      const existingIngestPreview = messageDiv.querySelector(".vault-ai-vault-ingest-preview") as HTMLElement;
      if (vaultLive && vaultLive.length > 0) {
        const ingestPreview = existingIngestPreview || (() => {
          const el = document.createElement("div");
          el.className = "vault-ai-vault-ingest-preview";
          progressContainer.insertAdjacentElement("afterend", el);
          return el;
        })();
        ingestPreview.empty();
        ingestPreview.style.marginTop = "10px";
        ingestPreview.style.padding = "10px 12px";
        ingestPreview.style.border = "1px solid var(--background-modifier-border)";
        ingestPreview.style.borderRadius = "8px";
        ingestPreview.style.background = "var(--background-secondary)";
        ingestPreview.style.maxHeight = "240px";
        ingestPreview.style.overflowY = "auto";
        ingestPreview.style.fontSize = "12px";
        ingestPreview.createEl("div", {
          text: `Applied to graph (${vaultLive.length}) — one line per entity or link`,
        }).style.marginBottom = "8px";
        const mdBox = ingestPreview.createDiv();
        void MarkdownRenderer.render(this.app, vaultLive.join("\n\n"), mdBox, "", this);
      } else if (vaultPreviewCmds && vaultPreviewCmds.length > 0) {
        const ingestPreview = existingIngestPreview || (() => {
          const el = document.createElement("div");
          el.className = "vault-ai-vault-ingest-preview";
          progressContainer.insertAdjacentElement("afterend", el);
          return el;
        })();
        ingestPreview.empty();
        ingestPreview.style.marginTop = "10px";
        ingestPreview.style.padding = "10px 12px";
        ingestPreview.style.border = "1px solid var(--background-modifier-border)";
        ingestPreview.style.borderRadius = "8px";
        ingestPreview.style.background = "var(--background-secondary)";
        ingestPreview.style.maxHeight = "240px";
        ingestPreview.style.overflowY = "auto";
        ingestPreview.style.fontSize = "12px";
        ingestPreview.createEl("div", {
          text: `Proposed graph commands (${vaultPreviewCmds.length}) — grows as each file/chunk is processed`,
        }).style.marginBottom = "8px";
        const pre = ingestPreview.createEl("pre");
        pre.style.whiteSpace = "pre-wrap";
        pre.style.wordBreak = "break-word";
        pre.style.margin = "0";
        pre.textContent = vaultPreviewCmds.join("\n");
      } else if (existingIngestPreview) {
        existingIngestPreview.remove();
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

  updateMultiProgressBar(messageIndex: number, toolName: string, progress: { message: string, percent: number }) {
    const messageDiv = this.messagesContainer.querySelector(
      `.vault-ai-chat-message[data-message-index="${messageIndex}"]`
    ) as HTMLElement;
    if (!messageDiv) return;

    let multiContainer = messageDiv.querySelector(".vault-ai-multi-progress-container") as HTMLElement;
    if (!multiContainer) {
      // Create it if it doesn't exist (fallback)
      const contentDiv = messageDiv.querySelector(".vault-ai-chat-content") as HTMLElement;
      multiContainer = document.createElement("div");
      multiContainer.className = "vault-ai-multi-progress-container";
      if (contentDiv) {
        contentDiv.insertAdjacentElement("afterend", multiContainer);
      } else {
        messageDiv.appendChild(multiContainer);
      }
    }

    if (this.activeAbortControllers.has(messageIndex) && !multiContainer.querySelector(".vault-ai-multi-cancel-all-row")) {
      const cancelAllRow = multiContainer.createDiv("vault-ai-multi-cancel-all-row");
      cancelAllRow.style.cssText =
        "display: flex; justify-content: flex-end; margin-bottom: 4px;";
      multiContainer.prepend(cancelAllRow);
      const cancelAllBtn = cancelAllRow.createEl("button", {
        text: "Cancel all",
        cls: "vault-ai-cancel-all-btn",
      });
      cancelAllBtn.style.cssText =
        "font-size: 11px; padding: 4px 10px; cursor: pointer; color: var(--text-muted); background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 4px;";
      cancelAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.handleCancel(messageIndex);
      });
    }

    let toolRow = multiContainer.querySelector(`.vault-ai-tool-progress-row[data-tool="${toolName}"]`) as HTMLElement;
    if (!toolRow) {
      toolRow = multiContainer.createDiv('vault-ai-tool-progress-row');
      toolRow.setAttribute('data-tool', toolName);
      toolRow.style.marginBottom = '12px';
      toolRow.style.padding = '8px';
      toolRow.style.background = 'var(--background-secondary-alt)';
      toolRow.style.borderRadius = '6px';
      toolRow.style.border = '1px solid var(--background-modifier-border)';

      const header = toolRow.createDiv('vault-ai-tool-header');
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.gap = '10px';
      header.style.justifyContent = 'space-between';
      header.style.marginBottom = '6px';

      const label = header.createDiv('vault-ai-tool-label');
      label.textContent = toolName;
      label.style.fontSize = '12px';
      label.style.fontWeight = '600';
      label.style.color = 'var(--text-normal)';
      label.style.flex = '1';
      label.style.minWidth = '0';

      const headerRight = header.createDiv('vault-ai-tool-header-right');
      headerRight.style.display = 'flex';
      headerRight.style.alignItems = 'center';
      headerRight.style.gap = '8px';
      headerRight.style.flexShrink = '0';

      const percentText = headerRight.createDiv('vault-ai-tool-percent');
      percentText.style.fontSize = '11px';
      percentText.style.color = 'var(--interactive-accent)';

      const barContainer = toolRow.createDiv('vault-ai-tool-bar-container');
      barContainer.style.height = '6px';
      barContainer.style.background = 'var(--background-modifier-border)';
      barContainer.style.borderRadius = '3px';
      barContainer.style.overflow = 'hidden';
      barContainer.style.position = 'relative';

      const bar = barContainer.createDiv('vault-ai-tool-bar-fill');
      bar.style.height = '100%';
      bar.style.background = 'var(--interactive-accent)';
      bar.style.width = '0%';
      bar.style.transition = 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)';

      const status = toolRow.createDiv('vault-ai-tool-status');
      status.style.fontSize = '11px';
      status.style.color = 'var(--text-muted)';
      status.style.marginTop = '6px';
      status.style.whiteSpace = 'nowrap';
      status.style.overflow = 'hidden';
      status.style.textOverflow = 'ellipsis';
    }

    const bar = toolRow.querySelector('.vault-ai-tool-bar-fill') as HTMLElement;
    const status = toolRow.querySelector('.vault-ai-tool-status') as HTMLElement;
    const percentText = toolRow.querySelector('.vault-ai-tool-percent') as HTMLElement;

    if (bar) bar.style.width = `${progress.percent}%`;
    if (status) status.textContent = progress.message;
    if (percentText) percentText.textContent = `${progress.percent}%`;

    // Smooth pulse animation if it's 100%
    if (progress.percent === 100 && bar) {
      bar.style.background = 'var(--text-success)';
    }

    // Per-tool cancel (parallel Main Copilot)
    if (messageIndex < this.chatHistory.length) {
      const item = this.chatHistory[messageIndex];
      const toolId = item.orchestrationDisplayToToolId?.[toolName];
      const ctrl = toolId ? item.orchestrationAbortByToolId?.[toolId] : undefined;
      let cancelRow = toolRow.querySelector(".vault-ai-tool-cancel-wrap") as HTMLElement | null;
      if (ctrl && !ctrl.signal.aborted) {
        if (!cancelRow) {
          const headerRight = toolRow.querySelector(".vault-ai-tool-header-right") as HTMLElement;
          if (headerRight) {
            cancelRow = headerRight.createDiv("vault-ai-tool-cancel-wrap");
            cancelRow.style.flexShrink = "0";
            const cancelBtn = cancelRow.createEl("button", {
              text: "Cancel",
              cls: "vault-ai-tool-cancel-btn",
            });
            cancelBtn.style.fontSize = "11px";
            cancelBtn.style.padding = "2px 8px";
            cancelBtn.style.cursor = "pointer";
            cancelBtn.style.color = "var(--text-muted)";
            cancelBtn.style.background = "transparent";
            cancelBtn.style.border = "1px solid var(--background-modifier-border)";
            cancelBtn.style.borderRadius = "4px";
            cancelBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (toolId) void this.handleOrchestrationToolCancel(messageIndex, toolId);
            });
          }
        }
      } else if (cancelRow) {
        cancelRow.remove();
      }
    }
  }

  /**
   * Creates per-tool AbortControllers and multi-progress rows for parallel orchestration.
   * Returns signals passed to {@link OrchestrationService.executeToolsInParallel}.
   */
  private setupOrchestrationParallelToolsUI(
    assistantIndex: number,
    tools: string[]
  ): Record<string, AbortSignal> {
    const item = this.chatHistory[assistantIndex];
    item.progress = undefined;
    item.multiProgress = {};
    item.orchestrationAbortByToolId = {};
    item.orchestrationDisplayToToolId = {};
    const signals: Record<string, AbortSignal> = {};
    for (const t of tools) {
      const d = ORCHESTRATION_TOOL_DISPLAY_NAMES[t] || t;
      item.orchestrationDisplayToToolId![d] = t;
      const c = new AbortController();
      item.orchestrationAbortByToolId![t] = c;
      signals[t] = c.signal;
      item.multiProgress![d] = { message: "Initializing…", percent: 5 };
    }
    void this.renderMessages();
    return signals;
  }

  /** Cancels one parallel orchestration tool without stopping the others. */
  async handleOrchestrationToolCancel(messageIndex: number, toolId: string) {
    const item = this.chatHistory[messageIndex];
    const ctrl = item.orchestrationAbortByToolId?.[toolId];
    if (!ctrl || ctrl.signal.aborted) return;

    new ConfirmModal(
      this.app,
      "Cancel this task",
      "Stop only this investigation module? Other modules will keep running.",
      () => {
        ctrl.abort();
        const display =
          Object.entries(item.orchestrationDisplayToToolId || {}).find(([, id]) => id === toolId)?.[0] ||
          toolId;
        if (item.multiProgress?.[display]) {
          item.multiProgress[display] = { message: "Cancelled by user", percent: 100 };
        }
        this.updateMultiProgressBar(messageIndex, display, { message: "Cancelled by user", percent: 100 });
        new Notice("Task cancelled");
      },
      () => {},
      true
    ).open();
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
          const hist = this.chatHistory[index];
          if (hist.orchestrationAbortByToolId) {
            Object.values(hist.orchestrationAbortByToolId).forEach((c) => c.abort());
            hist.orchestrationAbortByToolId = undefined;
            hist.orchestrationDisplayToToolId = undefined;
          }
          const currentContent = hist.content || "";
          hist.content = currentContent + "\n\n❌ **Cancelled by user**";
          hist.progress = undefined;
          hist.multiProgress = undefined;
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
    if (!value && this.attachedFiles.length === 0 && !this.vaultGraphIngestMode) return;

    if (value.startsWith("http")) {
      const isUrlHandled = await this.handleUrlExtraction(value);
      if (isUrlHandled) {
        this.inputEl.value = ""; // Clear input if URL was handled
        await this.saveCurrentConversation(); // Save conversation after URL handling
        return; // Stop normal flow if URL was handled
      }
      // If not handled (returned false), continue normal flow
    }

    const sendRuntimeAvailability = await getChatRuntimeAvailability(this.plugin, true);
    if (sendRuntimeAvailability.availableIds.length === 0) {
      new Notice(
        "No agent runtime is available. Install Claude, Codex, Hermes, or a custom runtime and confirm settings under OSINT Copilot.",
        8000,
      );
      return;
    }
    const requestRuntimeId = this.selectedTaskAgentId.trim()
      ? this.plugin.settings.apiProvider
      : this.plugin.settings.agentRuntimeProvider;
    if (!sendRuntimeAvailability.byId[requestRuntimeId]) {
      new Notice(
        `${this.runtimeDisplayName(requestRuntimeId)} is unavailable, so your message was not sent. ` +
        'Check its executable and login, or explicitly select another runtime.',
        9000,
      );
      return;
    }

    this.inputEl.value = "";

    // Authentication check removed for local-only mode

    // Build processed value - keep file content separate from chat display
    let displayValue = value; // What user sees in chat
    let processingValue = value; // What gets sent to graph generation (includes file content)
    const processedFileNames: string[] = []; // Track file names for display
    const extractedContents: string[] = []; // Extracted text

    if (this.attachedFiles.length > 0) {
      const filesToProcess = [...this.attachedFiles];
      this.attachedFiles = [];
      this.renderAttachments();

      const fileCount = filesToProcess.length;
      const extractionMsgIndex = this.chatHistory.length;

      this.chatHistory.push({
        role: "assistant",
        content: `📄 Extracting text from ${fileCount} file${fileCount > 1 ? 's' : ''}...`,
        progress: { message: `Processing 1/${fileCount}...`, percent: 5 },
        extractionLogs: [],
      });
      await this.renderMessages();

      const extractionController = new AbortController();
      this.activeAbortControllers.set(extractionMsgIndex, extractionController);

      const updateExtractionProgress = (message: string, percent: number) => {
        if (!this.activeAbortControllers.has(extractionMsgIndex)) return;
        if (this.chatHistory[extractionMsgIndex]) {
          this.chatHistory[extractionMsgIndex].progress = { message, percent };
          this.updateProgressBar(extractionMsgIndex, { message, percent });
        }
      };

      const appendExtractionLog = this.makeLogAppender(extractionMsgIndex);

      let extractedCount = 0;
      let failedCount = 0;
      let cancelled = false;

      for (const attachment of filesToProcess) {
        if (extractionController.signal.aborted) { cancelled = true; break; }

        const fileName = attachment.file.name;
        const fileProgress = Math.round(5 + (extractedCount / fileCount) * 85);
        const isImage = ChatView.isImageFile(fileName);
        const icon = isImage ? '🖼️' : '📄';

        this.chatHistory[extractionMsgIndex].content =
          `${icon} Processing (${extractedCount + 1}/${fileCount}): ${fileName}...`;
        updateExtractionProgress(
          `${icon} ${extractedCount + 1}/${fileCount}: ${fileName}`,
          fileProgress
        );

        try {
          let text = "";

          if (attachment.extracted && attachment.content) {
            text = attachment.content;
          } else if (isImage) {
            let absolutePath: string;
            if (attachment.file instanceof TFile) {
              const vaultBase = this.getVaultAbsolutePath();
              absolutePath = vaultBase ? `${vaultBase}/${attachment.file.path}` : attachment.file.path;
            } else {
              const evidencePath = normalizePath(`${this.plugin.entityManager.getBasePath()}/Evidence`);
              await ensureFolderExists(this.app, evidencePath);
              const destPath = this.getAvailableEvidencePath(evidencePath, fileName);
              const buffer = await (attachment.file as File).arrayBuffer();
              const tFile = await this.app.vault.createBinary(destPath, buffer);
              const vaultBase = this.getVaultAbsolutePath();
              absolutePath = vaultBase ? `${vaultBase}/${tFile.path}` : tFile.path;
            }

            text = await this.plugin.graphApiService.extractTextFromImage(
              absolutePath,
              extractionController.signal,
              {
                emit: appendExtractionLog,
                rawCli: this.plugin.settings.extractionDebugRawCli,
              },
            );
          } else if (attachment.file instanceof TFile) {
            const ext = (attachment.file.extension || '').toLowerCase();
            const textExts = ['md', 'txt', 'csv', 'json', 'xml', 'html', 'htm', 'log', 'yaml', 'yml', 'toml', 'ini'];
            if (textExts.includes(ext)) {
              text = await this.app.vault.read(attachment.file);
            } else {
              const arrayBuffer = await this.app.vault.readBinary(attachment.file);
              const blob = new Blob([arrayBuffer]);
              const syntheticFile = new File([blob], attachment.file.name, { type: 'application/octet-stream' });
              text = await this.plugin.graphApiService.extractTextFromFile(syntheticFile);
            }
          } else {
            text = await this.plugin.graphApiService.extractTextFromFile(attachment.file);
          }

          extractedContents.push(`\n\n--- Content from ${fileName} ---\n${text}`);
          processedFileNames.push(fileName);
          extractedCount++;

        } catch (error) {
          failedCount++;
          console.error(`Error extracting ${fileName}:`, error);

          const errorStr = error instanceof Error ? error.message : String(error);
          if (errorStr.includes('Aborted') || errorStr.includes('Cancelled')) {
            cancelled = true;
            break;
          }

          const userMessage = `${fileName}: ${errorStr}`;
          new Notice(userMessage, 8000);
        }
      }

      this.activeAbortControllers.delete(extractionMsgIndex);

      if (cancelled) {
        if (this.chatHistory[extractionMsgIndex]) {
          this.chatHistory[extractionMsgIndex].progress = undefined;
          this.chatHistory[extractionMsgIndex].content = `❌ **File extraction cancelled.**`;
        }
        await this.renderMessages();
        return;
      }

      if (extractedCount > 0) {
        if (extractionMsgIndex < this.chatHistory.length) {
          this.chatHistory.splice(extractionMsgIndex, 1);
        }
      } else {
        if (extractionMsgIndex < this.chatHistory.length && this.chatHistory[extractionMsgIndex]) {
          this.chatHistory[extractionMsgIndex].progress = undefined;
          this.chatHistory[extractionMsgIndex].content =
            `❌ Failed to extract text from ${failedCount} file${failedCount > 1 ? 's' : ''}. Please try again.`;
        } else {
          this.chatHistory.push({
            role: "assistant",
            content: `❌ Failed to extract text from ${failedCount} file${failedCount > 1 ? 's' : ''}. Please try again.`,
          });
        }
        await this.renderMessages();
        return;
      }

      processingValue = processingValue + extractedContents.join('\n');

      if (processedFileNames.length > 0) {
        const fileList = processedFileNames.map(f => {
          const icon = ChatView.isImageFile(f) ? '🖼️' : '📎';
          return `${icon} ${f}`;
        }).join('\n');
        displayValue = displayValue ? `${displayValue}\n\n${fileList}` : fileList;
      }

      if (extractedCount > 0 && failedCount === 0) {
        new Notice(`Processed ${extractedCount} file${extractedCount > 1 ? 's' : ''}`);
      } else if (extractedCount > 0 && failedCount > 0) {
        new Notice(`Processed ${extractedCount} file${extractedCount > 1 ? 's' : ''}, ${failedCount} failed`);
      }
    }

    // Add user message to chat (shows file names, NOT content)
    this.chatHistory.push({ role: "user", content: displayValue });

    // Save conversation after user message
    await this.saveCurrentConversation();

    if (this.selectedTaskAgentId.trim()) {
      await this.handleVaultTaskAgent(processingValue);
    } else if (this.vaultGraphIngestMode) {
      await this.handleVaultGraphIngestOnly(processingValue, "");
    } else {
      await this.handleOrchestrationAgent(processingValue, "");
    }

    // Save conversation after assistant response
    await this.saveCurrentConversation();
  }

  async handleVaultTaskAgent(query: string) {
    const assistantIndex = this.chatHistory.length;
    this.chatHistory.push({
      role: "assistant",
      content: "",
      progress: { message: "Running task agent (local AI CLI)...", percent: 15 },
    });
    await this.renderMessages();

    const controller = new AbortController();
    try {
      this.activeAbortControllers.set(assistantIndex, controller);

      const id = this.selectedTaskAgentId.trim();
      const manifest = await this.plugin.taskAgentRegistry.getById(id);
      if (!manifest) {
        this.chatHistory[assistantIndex].content = `Unknown task agent: \`${id}\`. Check the task agents folder and settings.`;
        this.chatHistory[assistantIndex].progress = undefined;
        this.activeAbortControllers.delete(assistantIndex);
        await this.renderMessages();
        return;
      }
      if (!isTaskAgentRunnable(manifest, this.plugin.settings)) {
        this.chatHistory[assistantIndex].content =
          `Task agent **${manifest.name}** is disabled. Enable it under Settings → Task agents.`;
        this.chatHistory[assistantIndex].progress = undefined;
        this.activeAbortControllers.delete(assistantIndex);
        await this.renderMessages();
        return;
      }

      const { assistantText } = await this.plugin.taskAgentRunner.run(
        manifest,
        query,
        controller.signal,
      );
      this.activeAbortControllers.delete(assistantIndex);
      this.chatHistory[assistantIndex].content = assistantText;
      this.chatHistory[assistantIndex].progress = undefined;
      await this.renderMessages();
    } catch (e) {
      // handleCancel() already finalizes content/progress for a genuine user cancel — it
      // aborts this exact controller synchronously before this catch runs. Checking the
      // controller's own signal (rather than map membership, which the success path also
      // mutates) avoids misclassifying an unrelated later error as a cancel.
      const wasUserCancelled = controller.signal.aborted;
      this.activeAbortControllers.delete(assistantIndex);
      const msg = e instanceof Error ? e.message : String(e);
      if (wasUserCancelled || msg === "Cancelled by user") return;
      this.chatHistory[assistantIndex].content = `Task agent error: ${msg}`;
      this.chatHistory[assistantIndex].progress = undefined;
      await this.renderMessages();
    }
  }

  async handleOrchestrationAgent(query: string, attachmentsContext: string = "") {
    const assistantIndex = this.chatHistory.length;

    const pendingItem: ChatHistoryItem = {
      role: "assistant",
      content: "",
      progress: { message: "Starting unified agent…", percent: 10 }
    };
    this.chatHistory.push(pendingItem);
    await this.renderMessages();
    if (this.chatHistory[assistantIndex] !== pendingItem) return;

    const controller = new AbortController();
    const isLive = (): boolean =>
      this.chatHistory[assistantIndex] === pendingItem &&
      this.activeAbortControllers.get(assistantIndex) === controller;
    const releaseController = (): void => {
      if (this.activeAbortControllers.get(assistantIndex) === controller) {
        this.activeAbortControllers.delete(assistantIndex);
      }
    };

    const updateProgress = (message: string, percent: number, meta?: OrchestrationProgressMeta) => {
      if (!isLive()) return;
      const item = this.chatHistory[assistantIndex];
      if (
        meta?.orchestrationTool &&
        item.multiProgress &&
        item.multiProgress[meta.orchestrationTool] !== undefined
      ) {
        item.multiProgress[meta.orchestrationTool] = { message, percent };
        this.updateMultiProgressBar(assistantIndex, meta.orchestrationTool, { message, percent });
        return;
      }
      if (item.multiProgress && Object.keys(item.multiProgress).length > 0 && !meta?.orchestrationTool) {
        return;
      }
      item.progress = { message, percent };
      this.updateProgressBar(assistantIndex, { message, percent });
    };

    // Live CLI activity shown in a collapsible log panel under the progress bar while the
    // agent is thinking, instead of only a single static progress line.
    const appendLiveAgentLog = this.makeLogAppender(assistantIndex);
    const appendAgentLog: typeof appendLiveAgentLog = (event) => {
      if (isLive()) appendLiveAgentLog(event);
    };

    try {
      this.activeAbortControllers.set(assistantIndex, controller);

      const currentGraphState = {
        entities: this.plugin.entityManager.getAllEntities(), // Send the current graph state
        connections: this.plugin.entityManager.getAllConnections() // Send connections to find orphaned nodes
      };

      // Extract conversational memory
      const conversationMemory = this.chatHistory
        .slice(0, assistantIndex) // All messages before this current pending assistant response
        .map(msg => ({ role: msg.role, content: msg.content }));

      const result = await this.plugin.orchestrationService.processRequest(
        query,
        attachmentsContext,
        currentGraphState, // Also pass the graph state
        conversationMemory, // Send the memory history
        this.currentConversation,
        updateProgress,
        {
          abortSignal: controller.signal,
          onToolsStarting: (tools) => {
            if (!isLive() || tools.length <= 1) return;
            return this.setupOrchestrationParallelToolsUI(assistantIndex, tools);
          },
          onLog: appendAgentLog,
        }
      );

      releaseController();
      const item = this.chatHistory[assistantIndex];
      if (item !== pendingItem) return;
      item.orchestrationAbortByToolId = undefined;
      item.orchestrationDisplayToToolId = undefined;

      // Handle TOOLS_COMPLETE phase: show tool results for review
      if (result.phase === "TOOLS_COMPLETE" && result.toolResults) {
        item.content = result.finalResponse || "Tools complete. Review results below.";
        item.toolResults = result.toolResults;
        item.savedPlan = result.plan;
        item.savedQuery = query;
        item.progress = undefined;
        item.multiProgress = undefined;
        this._awaitingToolReview = true;
        await this.renderMessages();
        return;
      }

      item.content = result.finalResponse || "Done.";
      item.proposedModifications = result.proposedCommands;
      item.proposedCustomVaultOps = result.proposedCustomVaultOps;
      item.savedQuery = query; // Save query for tool execution
      item.progress = undefined;
      item.multiProgress = undefined;
      await this.renderMessages();

    } catch (e) {
      // handleCancel() already finalizes content/progress for a genuine user cancel — it
      // aborts this exact controller synchronously before this catch runs. Checking the
      // controller's own signal (rather than map membership, which the success path also
      // mutates) avoids misclassifying an unrelated later error as a cancel.
      const wasUserCancelled = controller.signal.aborted;
      releaseController();
      const item = this.chatHistory[assistantIndex];
      if (item !== pendingItem) return;
      item.orchestrationAbortByToolId = undefined;
      item.orchestrationDisplayToToolId = undefined;
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (wasUserCancelled || errorMsg === 'Cancelled by user') return;

      item.content = `Orchestration Error: ${errorMsg}`;
      item.progress = undefined;
      item.multiProgress = undefined;
      await this.renderMessages();
    }
  }

  /**
   * Direct vault graph ingest: runs VAULT_GRAPH_INGEST without the LLM planner (dropdown mode).
   */
  async handleVaultGraphIngestOnly(query: string, attachmentsContext: string = "") {
    const assistantIndex = this.chatHistory.length;
    this.chatHistory.push({
      role: "assistant",
      content: "",
      progress: { message: "Running vault graph ingest...", percent: 5 },
    });
    await this.renderMessages();

    const controller = new AbortController();
    try {
      this.activeAbortControllers.set(assistantIndex, controller);

      const q = (query || "").trim() || "Ingest vault documents for knowledge graph";
      const toolResults = await this.plugin.orchestrationService.executeToolsInParallel(
        ["VAULT_GRAPH_INGEST"],
        q,
        attachmentsContext,
        this.currentConversation,
        (_displayName, msg, pct, detail) => {
          if (this.activeAbortControllers.has(assistantIndex)) {
            this.chatHistory[assistantIndex].progress = { message: msg, percent: pct };
            if (detail?.vaultIngestAppliedLine) {
              if (!this.chatHistory[assistantIndex].vaultIngestLiveLog) {
                this.chatHistory[assistantIndex].vaultIngestLiveLog = [];
              }
              this.chatHistory[assistantIndex].vaultIngestLiveLog!.push(detail.vaultIngestAppliedLine);
            }
            this.updateProgressBar(assistantIndex, { message: msg, percent: pct });
          }
        },
        { globalAbort: controller.signal }
      );

      this.activeAbortControllers.delete(assistantIndex);

      const plan: OrchestrationPlan = {
        reasoning: "Direct vault graph ingest",
        toolsToCall: ["VAULT_GRAPH_INGEST"],
        graphCommands: [],
        isProposal: false,
      };

      this.chatHistory[assistantIndex].content =
        "Vault ingestion finished. Review results below, then click **📊 Generate Analysis & Graph** to proceed.";
      this.chatHistory[assistantIndex].toolResults = toolResults;
      this.chatHistory[assistantIndex].savedPlan = plan;
      this.chatHistory[assistantIndex].savedQuery = q;
      this.chatHistory[assistantIndex].progress = undefined;
      this.chatHistory[assistantIndex].vaultIngestPreviewCommands = undefined;
      this._awaitingToolReview = true;
      await this.renderMessages();
    } catch (e) {
      // handleCancel() already finalizes content/progress for a genuine user cancel — it
      // aborts this exact controller synchronously before this catch runs. Checking the
      // controller's own signal (rather than map membership, which the success path also
      // mutates) avoids misclassifying an unrelated later error as a cancel.
      const wasUserCancelled = controller.signal.aborted;
      this.activeAbortControllers.delete(assistantIndex);
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (wasUserCancelled || errorMsg === "Cancelled by user") return;
      this.chatHistory[assistantIndex].content = `Vault ingest error: ${errorMsg}`;
      this.chatHistory[assistantIndex].progress = undefined;
      this.chatHistory[assistantIndex].vaultIngestPreviewCommands = undefined;
      this.chatHistory[assistantIndex].vaultIngestLiveLog = undefined;
      await this.renderMessages();
    }
  }

  /**
   * Phase 2: Continue after the user has reviewed tool results.
   * Calls continueAfterToolReview on the OrchestrationService to synthesize + generate graph.
   */
  private _awaitingToolReview = false; // Guard flag: only true after tools complete, before user clicks Generate

  private async continueFromToolResults(sourceIndex: number) {
    console.log("[continueFromToolResults] CALLED for sourceIndex:", sourceIndex, "_awaitingToolReview:", this._awaitingToolReview);
    console.trace("[continueFromToolResults] Stack trace:");

    // Guard: only proceed if we are genuinely awaiting tool review (user clicked the button)
    if (!this._awaitingToolReview) {
      console.warn("[continueFromToolResults] BLOCKED - not awaiting tool review. Ignoring ghost trigger.");
      return;
    }
    this._awaitingToolReview = false;

    const item = this.chatHistory[sourceIndex];
    if (!item.toolResults || !item.savedPlan) return;

    // Clear the tool results UI from the source message
    const toolResults = item.toolResults;
    const plan = item.savedPlan;
    const originalQuery = item.savedQuery || "";
    item.toolResults = undefined;
    item.savedPlan = undefined;
    item.savedQuery = undefined;

    // Add a new assistant message for the synthesis phase
    const synthesisIndex = this.chatHistory.length;
    this.chatHistory.push({
      role: "assistant",
      content: "📊 Synthesizing analysis from all tool results...",
      progress: { message: "Generating graph and analysis...", percent: 10 },
      savedQuery: originalQuery,
    });
    await this.renderMessages();

    const updateProgress = (message: string, percent: number) => {
      if (this.activeAbortControllers.has(synthesisIndex)) {
        this.chatHistory[synthesisIndex].progress = { message, percent };
        this.updateProgressBar(synthesisIndex, { message, percent });
      }
    };

    const controller = new AbortController();
    try {
      this.activeAbortControllers.set(synthesisIndex, controller);

      const currentGraphState = {
        entities: this.plugin.entityManager.getAllEntities(),
        connections: this.plugin.entityManager.getAllConnections()
      };

      const conversationMemory = this.chatHistory
        .slice(0, synthesisIndex)
        .map(msg => ({ role: msg.role, content: msg.content }));

      const result = await this.plugin.orchestrationService.continueAfterToolReview(
        toolResults,
        plan,
        originalQuery,
        currentGraphState,
        conversationMemory,
        updateProgress
      );

      this.activeAbortControllers.delete(synthesisIndex);

      this.chatHistory[synthesisIndex].content = result.finalResponse || "Analysis complete.";
      this.chatHistory[synthesisIndex].proposedModifications = result.proposedCommands;
      this.chatHistory[synthesisIndex].progress = undefined;
      await this.renderMessages();
      await this.saveCurrentConversation();

    } catch (e) {
      // handleCancel() already finalizes content/progress for a genuine user cancel — it
      // aborts this exact controller synchronously before this catch runs. Checking the
      // controller's own signal (rather than map membership, which the success path also
      // mutates) avoids misclassifying an unrelated later error as a cancel.
      const wasUserCancelled = controller.signal.aborted;
      this.activeAbortControllers.delete(synthesisIndex);
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (wasUserCancelled || errorMsg === 'Cancelled by user') return;

      this.chatHistory[synthesisIndex].content = `Synthesis Error: ${errorMsg}`;
      this.chatHistory[synthesisIndex].progress = undefined;
      await this.renderMessages();
    }
  }

  /**
   * Renders collapsible tool result sections and a "Generate Analysis & Graph" button.
   */
  private renderToolResults(item: ChatHistoryItem, index: number, messageDiv: HTMLElement) {
    console.log("[renderToolResults] Called for index:", index, "toolResults:", item.toolResults ? Object.keys(item.toolResults) : "null");
    if (!item.toolResults || Object.keys(item.toolResults).length === 0) {
      console.log("[renderToolResults] No tool results to render, skipping.");
      return;
    }

    const toolResultsDiv = messageDiv.createDiv("vault-ai-tool-results");
    toolResultsDiv.style.cssText = `
      margin-top: 15px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    const toolIcons: Record<string, string> = {
      "LOCAL_VAULT": "📁 Local Search",
      "EXTRACT_TO_GRAPH": "🏷️ Graph Extraction",
      "VAULT_GRAPH_INGEST": "🗂️ Vault graph ingest"
    };

    for (const [tool, result] of Object.entries(item.toolResults)) {
      const details = document.createElement("details");
      details.style.cssText = `
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        overflow: hidden;
      `;

      const summary = document.createElement("summary");
      summary.style.cssText = `
        padding: 10px 14px;
        cursor: pointer;
        font-weight: 600;
        background: var(--background-secondary);
        user-select: none;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      summary.textContent = toolIcons[tool] || `🔧 ${tool}`;

      // Add a badge showing result size
      const badge = document.createElement("span");
      const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const wordCount = resultText.split(/\s+/).length;
      badge.textContent = `${wordCount} words`;
      badge.style.cssText = `
        font-size: 11px;
        font-weight: normal;
        color: var(--text-muted);
        margin-left: auto;
      `;
      summary.appendChild(badge);

      const content = document.createElement("div");
      content.style.cssText = `
        padding: 12px 14px;
        font-size: 13px;
        max-height: 400px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-word;
        background: var(--background-primary);
      `;

      // Format the result for display
      let displayText = '';
      if (typeof result === 'string') {
        displayText = result;
      } else if (result && typeof result === 'object') {
        // Vault ingest: entities applied during run; optional count from appliedOperationsCount
        if (result.__vaultIngest && result.summary) {
          const n =
            typeof result.appliedOperationsCount === "number"
              ? result.appliedOperationsCount
              : Array.isArray(result.graphCommands)
                ? result.graphCommands.length
                : 0;
          if (result.__vaultIngestAutoApplied) {
            displayText = `${result.summary}\n\n**${n}** operation(s) were applied to the graph automatically. Use **📊 Generate Analysis & Graph** for the written summary (no second confirmation list).`;
          } else {
            displayText = `${result.summary}\n\n**${n}** proposed graph command(s) — confirm with **📊 Generate Analysis & Graph**, then review the full list in the next step.`;
          }
        } else if (result.summary) {
          displayText = result.summary;
        } else if (result.results && Array.isArray(result.results)) {
          displayText = result.results.map((r: any) => {
            if (typeof r === 'string') return r;
            return r.title ? `**${r.title}**\n${r.snippet || r.content || ''}` : JSON.stringify(r, null, 2);
          }).join('\n\n---\n\n');
        } else if (result.text) {
          displayText = result.text;
        } else if (result.report) {
          displayText = result.report;
        } else {
          displayText = JSON.stringify(result, null, 2);
        }
      } else {
        displayText = String(result);
      }
      // Render as markdown for rich formatting
      MarkdownRenderer.render(this.app, displayText, content, "", this);

      if (
        tool === "VAULT_GRAPH_INGEST" &&
        item.vaultIngestLiveLog &&
        item.vaultIngestLiveLog.length > 0
      ) {
        content.createEl("hr");
        content.createEl("strong", { text: "Applied to graph (during ingest):" });
        const logDiv = content.createDiv();
        logDiv.style.marginTop = "8px";
        void MarkdownRenderer.render(this.app, item.vaultIngestLiveLog.join("\n\n"), logDiv, "", this);
      }

      details.appendChild(summary);
      details.appendChild(content);
      toolResultsDiv.appendChild(details);
    }

    // "Generate Analysis & Graph" button
    const actionRow = toolResultsDiv.createDiv();
    actionRow.style.cssText = `
      display: flex;
      gap: 12px;
      margin-top: 10px;
      justify-content: center;
    `;

    const continueBtn = actionRow.createEl("button", {
      text: "📊 Generate Analysis & Graph",
      cls: "mod-cta"
    });
    continueBtn.style.cssText = `
      padding: 8px 20px;
      font-size: 14px;
    `;
    continueBtn.addEventListener("click", () => {
      continueBtn.disabled = true;
      continueBtn.textContent = "⏳ Generating...";
      void this.continueFromToolResults(index);
    });
  }

  private buildGraphWriteContextFromSavedQuery(savedQuery: string | undefined): GraphWriteContext {
    const q = (savedQuery ?? "").trim() || "Graph modification apply";
    const extracted_urls = q.match(/(https?:\/\/[^\s]+)/g) ?? undefined;
    return {
      query: q,
      extracted_urls: extracted_urls ?? undefined,
      captured_at: new Date().toISOString(),
      conversation_id: this.currentConversation?.id,
    };
  }

  async applyProposedModifications(index: number, selectedIndices: number[]) {
    const item = this.chatHistory[index];
    if (!item.proposedModifications) return;

    const cmdsToExecute = item.proposedModifications.filter((_, idx) => selectedIndices.includes(idx));
    if (cmdsToExecute.length === 0) return;

    const graphWriteContext = this.buildGraphWriteContextFromSavedQuery(item.savedQuery);
    await this.plugin.orchestrationService.executeGraphModifications(cmdsToExecute, {
      graphWriteContext,
      skipConfirmation: true,
    });
    item.proposedModifications = undefined; // Clear after applying
    await this.renderMessages();
    await this.saveCurrentConversation();
  }

  async applyProposedCustomVaultOps(index: number, selectedIndices: number[]) {
    const item = this.chatHistory[index];
    if (!item.proposedCustomVaultOps?.length) return;
    const ops = item.proposedCustomVaultOps.filter((_, idx) => selectedIndices.includes(idx));
    if (ops.length === 0) return;
    try {
      const { applied, errors } = await applyCustomVaultOperations(this.plugin, ops);
      if (errors.length) {
        new Notice(`Applied ${applied} change(s). Errors: ${errors.join("; ")}`, 8000);
      } else {
        new Notice(`Applied ${applied} vault change(s).`);
      }
    } catch (e) {
      new Notice(`Vault apply failed: ${e instanceof Error ? e.message : String(e)}`, 8000);
    }
    item.proposedCustomVaultOps = undefined;
    await this.renderMessages();
    await this.saveCurrentConversation();
  }

  /**
   * Handle Graph only Mode: Extract entities from user input text without sending to AI.
   * This mode is active when graphGenerationMode is ON and all main modes are OFF.
   */
  async handleGraphOnlyMode(inputText: string) {
    console.log(`[OSINT Copilot] Starting handleGraphOnlyMode (Input snippet: ${inputText.substring(0, 50)}...)`);
    const messageIndex = this.chatHistory.length;
    this.chatHistory.push({
      role: "assistant",
      content: "🏷️ Extracting entities from your text...",
      progress: { message: "Analyzing text...", percent: 10 },
    });
    await this.renderMessages();

    const updateProgress = (message: string, percent: number) => {
      this.chatHistory[messageIndex].progress = { message, percent };
      this.chatHistory[messageIndex].content = `🏷️ ${message}`;
      this.updateProgressBar(messageIndex, { message, percent });
    };

    let controller: AbortController | undefined;
    try {
      const existingEntities = this.plugin.entityManager.getAllEntities();
      updateProgress("Checking existing entities...", 20);

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

      const onChunkProgress = (chunkIndex: number, totalChunks: number, message: string) => {
        const chunkPercent = 30 + Math.round((chunkIndex / totalChunks) * 20);
        console.log(`[OSINT Copilot] Extraction Progress: ${message}`);
        updateProgress(`📦 ${message}`, chunkPercent);
      };

      console.log(`[OSINT Copilot] Calling graphApiService.processTextInChunks (Text length: ${inputText.length})...`);

      // Create AbortController so the cancel button in the progress bar works
      controller = new AbortController();
      this.activeAbortControllers.set(messageIndex, controller);
      this.updateProgressBar(messageIndex, { message: "Sending text to AI for entity extraction...", percent: 30 });

      const result: ProcessTextResponse = await this.plugin.graphApiService.processTextInChunks(
        inputText,
        existingEntities,
        undefined,
        onChunkProgress,
        onRetry,
        controller.signal
      );

      this.activeAbortControllers.delete(messageIndex); // Clean up after success
      console.log(`[OSINT Copilot] Extraction API Result:`, result.success ? "Success" : "Failed", result.error || "");

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

      const proposedCommands: string[] = [];

      for (let opIdx = 0; opIdx < result.operations.length; opIdx++) {
        const operation = result.operations[opIdx];
        const opEntities = operation.entities || [];

        if (operation.action === "create" && operation.entities) {
          for (const ent of operation.entities) {
            const label = getEntityLabel(ent.type as EntityType, ent.properties || {});
            proposedCommands.push(`@@create_entity ${JSON.stringify({
              type: ent.type,
              properties: ent.properties,
              label,
              sources: ent.sources,
            })}`);
          }
        }

        if (operation.connections) {
          for (const conn of operation.connections) {
            let fromLabel = conn.from_label;
            let toLabel = conn.to_label;

            if (!fromLabel && opEntities[conn.from]) {
              const ent = opEntities[conn.from];
              fromLabel = getEntityLabel(ent.type as EntityType, ent.properties || {});
            }
            if (!toLabel && opEntities[conn.to]) {
              const ent = opEntities[conn.to];
              toLabel = getEntityLabel(ent.type as EntityType, ent.properties || {});
            }

            if (fromLabel && toLabel) {
              proposedCommands.push(`@@create_link ${JSON.stringify({
                from: fromLabel,
                to: toLabel,
                relationship: conn.relationship,
                sources: conn.sources,
              })}`);
            }
          }
        }
      }

      console.log(`[OSINT Copilot] Generated ${proposedCommands.length} graph commands for proposal list.`);

      if (proposedCommands.length === 0) {
        this.chatHistory[messageIndex].progress = undefined;
        this.chatHistory[messageIndex].content =
          `🏷️ **Graph Generation Complete**\n\n` +
          `**Input:** ${inputText.substring(0, 200)}${inputText.length > 200 ? '...' : ''}\n\n` +
          `No valid entities or relationships proposed.`;
        await this.renderMessages();
        return;
      }

      // Finalize the message with the proposed changes
      this.chatHistory[messageIndex].progress = undefined;
      this.chatHistory[messageIndex].content =
        `🏷️ **Extraction complete.** I've extracted ${proposedCommands.length} potential graph modifications from the text.\n\n` +
        `**Input:** ${inputText.substring(0, 150)}${inputText.length > 150 ? '...' : ''}\n\n` +
        `Please review and apply the changes below:`;

      this.chatHistory[messageIndex].proposedModifications = proposedCommands;
      this.chatHistory[messageIndex].savedQuery = inputText;

      await this.renderMessages();
      await this.saveCurrentConversation();
    } catch (error) {
      // handleCancel() already finalizes content/progress for a genuine user cancel — it
      // aborts this exact controller synchronously before this catch runs. Checking the
      // controller's own signal (rather than map membership, which the success path also
      // mutates) avoids misclassifying an unrelated later error as a cancel. No controller
      // means the failure happened before one was created, so it can't have been a cancel.
      const wasUserCancelled = controller?.signal.aborted ?? false;
      if (typeof messageIndex !== 'undefined') {
        this.activeAbortControllers.delete(messageIndex); // Ensure controller is cleared on error
      }
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Handle user cancellation gracefully
      if (wasUserCancelled || errorMsg === 'Cancelled by user') {
        return; // UI already handled by handleCancel
      }

      if (typeof messageIndex !== 'undefined' && this.chatHistory[messageIndex]) {
        this.chatHistory[messageIndex].progress = undefined; // Clear progress bar on error
        this.chatHistory[messageIndex].content =
          `🏷️ **Graph Generation Failed**\n\n` +
          `**Input:** ${inputText.substring(0, 100)}${inputText.length > 100 ? '...' : ''}\n\n` +
          `**Error:** ${errorMsg}`;
        await this.renderMessages();
      }
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

      // 1) Extract entities — always use local Ollama model in local search mode
      const extractedEntities = await this.plugin.extractEntitiesFromQuery(query, true);

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
        controller.signal,
        true  // useLocal: always use Ollama for local vault synthesis
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

      // Always generate graph from retrieved vault notes in local search mode (uses Ollama)
      try {
        await this.processGraphFromNotes(assistantIndex, notes, extractedEntities, query);
      } catch (graphError) {
        console.error("[OSINT Copilot] Graph generation from vault notes failed:", graphError);
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
   * Generate/update the knowledge graph from retrieved vault notes in local search mode.
   * Uses Ollama (qwen3:14b) on the production server — no OpenAI cost.
   * If the query contained specific entities, focuses extraction on them.
   * Otherwise extracts all entities from the notes as-is.
   */
  async processGraphFromNotes(
    assistantIndex: number,
    notes: IndexedNote[],
    extractedEntities: Array<{ name: string | null; type: string }>,
    query: string
  ) {
    if (notes.length === 0) return;

    const updateProgress = (message: string, percent: number) => {
      if (this.chatHistory[assistantIndex]) {
        this.chatHistory[assistantIndex].progress = { message, percent };
        this.updateProgressBar(assistantIndex, { message, percent });
      }
    };

    updateProgress("Extracting entities from vault notes...", 70);

    // Build extraction text from retrieved notes (cap at 6000 chars total)
    const MAX_CHARS = 6000;
    let notesText = "";
    for (const note of notes) {
      const noteBlock = `--- ${note.path} ---\n${note.content}\n\n`;
      if (notesText.length + noteBlock.length > MAX_CHARS) break;
      notesText += noteBlock;
    }

    // If query had specific entities, add a focus instruction
    const namedEntities = extractedEntities.filter(e => e.name);
    let extractionText = notesText;
    if (namedEntities.length > 0) {
      const entityList = namedEntities.map(e => `${e.name} (${e.type})`).join(", ");
      extractionText = `Focus on entities related to: ${entityList}.\n\n${notesText}`;
    }

    const existingEntities = this.plugin.entityManager.getAllEntities();

    const onRetry = (attempt: number, maxAttempts: number, reason: string, nextDelayMs: number) => {
      const delaySec = Math.round(nextDelayMs / 1000);
      updateProgress(`⚠️ Retrying graph extraction... (${attempt + 1}/${maxAttempts}, ${delaySec}s)`, 72);
    };

    const controller = new AbortController();
    this.activeAbortControllers.set(assistantIndex, controller);

    const result: ProcessTextResponse = await this.plugin.graphApiService.processTextInChunks(
      extractionText,
      existingEntities,
      undefined,
      undefined,
      onRetry,
      controller.signal,
      true  // useLocal: use Ollama
    );

    this.activeAbortControllers.delete(assistantIndex);

    if (!result.success || !result.operations || result.operations.length === 0) {
      if (this.chatHistory[assistantIndex]) {
        this.chatHistory[assistantIndex].progress = undefined;
      }
      return;
    }

    updateProgress("Saving graph nodes...", 88);

    let entitiesCreated = 0;
    let connectionsCreated = 0;
    const globalEntitiesMap = new Map<number, Entity>();
    const entityLabelMap = new Map<string, Entity>();
    let globalIndexOffset = 0;

    for (const operation of result.operations) {
      const operationEntities: Array<Entity | null> = [];

      if (operation.action === "create" && operation.entities) {
        for (let i = 0; i < operation.entities.length; i++) {
          const entityData = operation.entities[i];
          try {
            const entityType = entityData.type as EntityType;
            if (!Object.values(EntityType).includes(entityType)) {
              operationEntities.push(null);
              continue;
            }
            const finalLabel = getEntityLabel(entityType, entityData.properties);
            const nameValidation = validateEntityName(finalLabel, entityType);
            if (!nameValidation.isValid) {
              operationEntities.push(null);
              continue;
            }
            const entity = await this.plugin.entityManager.createEntity(entityType, entityData.properties);
            operationEntities.push(entity);
            const globalIdx = globalIndexOffset + i;
            globalEntitiesMap.set(globalIdx, entity);
            entityLabelMap.set(`${entity.type}:${entity.label.toLowerCase()}`, entity);
            entitiesCreated++;
          } catch {
            operationEntities.push(null);
          }
        }
        globalIndexOffset += operation.entities.length;
      }

      if (operation.connections) {
        for (const conn of operation.connections) {
          try {
            let fromEntity = (operationEntities[conn.from]) ?? globalEntitiesMap.get(conn.from);
            let toEntity = (operationEntities[conn.to]) ?? globalEntitiesMap.get(conn.to);
            if (!fromEntity && conn.from_label) fromEntity = entityLabelMap.get(`${conn.from_type}:${conn.from_label.toLowerCase()}`) || this.plugin.entityManager.findEntityByLabel(conn.from_label);
            if (!toEntity && conn.to_label) toEntity = entityLabelMap.get(`${conn.to_type}:${conn.to_label.toLowerCase()}`) || this.plugin.entityManager.findEntityByLabel(conn.to_label);
            if (fromEntity && toEntity) {
              await this.plugin.entityManager.createConnection(fromEntity.id, toEntity.id, conn.relationship);
              connectionsCreated++;
            }
          } catch { /* skip failed connections */ }
        }
      }
    }

    if (this.chatHistory[assistantIndex]) {
      this.chatHistory[assistantIndex].progress = undefined;
      if (entitiesCreated > 0) {
        const currentContent = this.chatHistory[assistantIndex].content || "";
        this.chatHistory[assistantIndex].content = currentContent +
          `\n\n🏷️ **Graph updated from vault:** ${entitiesCreated} entities, ${connectionsCreated} relationships added.`;
        await this.plugin.refreshOrOpenGraphView();
        await this.plugin.refreshOpenInsightViews({ skipGraph: this.plugin.settings.autoRefreshGraph });
      }
    }
    await this.renderMessages();
  }

  /**
   * Process graph generation from AI response text.
   * Calls the /api/process-text endpoint to extract entities and creates them via EntityManager.
   */
  async processGraphGeneration(
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

      const result: ProcessTextResponse = await this.plugin.graphApiService.processTextInChunks(
        textToProcess,
        existingEntities,
        undefined,
        onChunkProgress,
        onRetry,
        controller.signal
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

      // Persist entities across all operations and chunks for connection processing
      const globalEntitiesMap: Map<number, Entity> = new Map();
      const entityLabelMap: Map<string, Entity> = new Map();
      let globalIndexOffset = 0;

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

        // Track entities by their index in THIS specific operation for AI relative indexing
        const operationEntities: Array<Entity | null> = [];

        if (operation.action === "create" && operation.entities) {
          for (let i = 0; i < operation.entities.length; i++) {
            const entityData = operation.entities[i];
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
              // Use the same logic as EntityManager to determine the label that will be used
              const finalLabel = getEntityLabel(entityType, entityData.properties);
              const nameValidation = validateEntityName(finalLabel, entityType);

              if (!nameValidation.isValid) {
                console.warn(`[GraphGeneration] Skipping entity with generic name: "${finalLabel}" - ${nameValidation.error}`);
                operationEntities.push(null);
                continue;
              }

              console.debug('[GraphGeneration] Creating entity with type:', entityType);
              const entity = await this.plugin.entityManager.createEntity(
                entityType,
                entityData.properties
              );

              operationEntities.push(entity);
              const globalIdx = globalIndexOffset + i;
              globalEntitiesMap.set(globalIdx, entity);
              entityLabelMap.set(`${entity.type}:${entity.label.toLowerCase()}`, entity);

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
          globalIndexOffset += operation.entities.length;
        }

        // Process connections using both global indices and label fallback
        if (operation.connections && operation.connections.length > 0) {
          updateProgress("Creating relationships...", 88);
          for (const conn of operation.connections) {
            try {
              let fromEntity: Entity | undefined;
              let toEntity: Entity | undefined;

              // 1. Try local operation index (original AI behavior)
              fromEntity = (operationEntities[conn.from]) ?? undefined;
              toEntity = (operationEntities[conn.to]) ?? undefined;

              // 2. Try global index if provided (backend multi-step behavior)
              if (!fromEntity && conn.from >= 0) fromEntity = globalEntitiesMap.get(conn.from);
              if (!toEntity && conn.to >= 0) toEntity = globalEntitiesMap.get(conn.to);

              // 3. Try label fallback (best for cross-chunk and existing entities)
              if (!fromEntity && conn.from_label) {
                fromEntity = entityLabelMap.get(`${conn.from_type}:${conn.from_label.toLowerCase()}`) ||
                  this.plugin.entityManager.findEntityByLabel(conn.from_label);
              }
              if (!toEntity && conn.to_label) {
                toEntity = entityLabelMap.get(`${conn.to_type}:${conn.to_label.toLowerCase()}`) ||
                  this.plugin.entityManager.findEntityByLabel(conn.to_label);
              }

              if (fromEntity && toEntity) {
                // Use createConnection to ensure it's recorded in the plugin's state and graph
                await this.plugin.entityManager.createConnection(
                  fromEntity.id,
                  toEntity.id,
                  conn.relationship
                );
                connectionsCreated++;
              }
            } catch (connError) {
              console.error('[GraphGeneration] Failed to create connection:', connError);
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

        // Fetch latest content dynamically to avoid overwriting updates from report generation
        const successContent = this.chatHistory[assistantIndex].content || "";
        this.chatHistory[assistantIndex].content = successContent + resultMsg;

        // Refresh or open graph view after entity creation
        await this.plugin.refreshOrOpenGraphView();
        await this.plugin.refreshOpenInsightViews({ skipGraph: this.plugin.settings.autoRefreshGraph });
      } else {
        this.chatHistory[assistantIndex].progress = undefined; // Clear progress bar
        const noEntitiesContent = this.chatHistory[assistantIndex].content || "";
        this.chatHistory[assistantIndex].content = noEntitiesContent + "\n\n🏷️ No new entities were created.";
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

  async onClose() {
    this.abortAllActiveOperations();
    // Cleanup polling timeouts (using setTimeout for adaptive polling)
    for (const timeoutId of this.pollingIntervals.values()) {
      window.clearTimeout(timeoutId);
    }
    this.pollingIntervals.clear();
  }
}
