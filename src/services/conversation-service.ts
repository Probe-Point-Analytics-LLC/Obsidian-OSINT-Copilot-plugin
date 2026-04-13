/**
 * Conversation Service - handles conversation persistence for OSINT Copilot chat
 */
import { App, normalizePath } from 'obsidian';

/** Primary chat task mode (header dropdown). Legacy per-flag fields are derived for YAML backward compatibility. */
export type CopilotChatMode = 'general' | 'graph' | 'local';

export function legacyFlagsForChatMode(mode: CopilotChatMode): {
  localSearchMode: boolean;
  graphGenerationMode: boolean;
  orchestrationMode: boolean;
  vaultGraphIngestMode: boolean;
} {
  const off = { vaultGraphIngestMode: false };
  switch (mode) {
    case 'general':
      return {
        ...off,
        localSearchMode: false,
        graphGenerationMode: false,
        orchestrationMode: true,
      };
    case 'graph':
      return {
        ...off,
        localSearchMode: false,
        graphGenerationMode: true,
        orchestrationMode: false,
      };
    case 'local':
      return {
        ...off,
        localSearchMode: true,
        graphGenerationMode: true,
        orchestrationMode: false,
      };
  }
}

export function inferChatModeFromLegacyFields(meta: {
  localSearchMode: boolean;
  graphGenerationMode: boolean;
  orchestrationMode?: boolean;
  vaultGraphIngestMode?: boolean;
}): CopilotChatMode {
  if (meta.orchestrationMode || meta.vaultGraphIngestMode) return 'general';
  const graphOnly = meta.graphGenerationMode && !meta.localSearchMode;
  if (graphOnly) return 'graph';
  return 'local';
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  notes?: unknown[];
  jobId?: string;
  status?: string;
  progress?: unknown;
  reportFilePath?: string;
  usedEntities?: { id: string, label: string, type: string }[];
  proposedModifications?: string[];
  proposedPlan?: any;
}

export interface ConversationMetadata {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** Canonical mode for the tri-mode chat UI (general / graph / local). */
  chatMode?: CopilotChatMode;
  /** When set in general mode, runs vault task agent instead of full orchestration. */
  taskAgentId?: string;
  localSearchMode: boolean;
  graphGenerationMode: boolean;
  orchestrationMode?: boolean;
  vaultGraphIngestMode?: boolean;
}

export interface Conversation extends ConversationMetadata {
  messages: ConversationMessage[];
}

export class ConversationService {
  private app: App;
  private basePath: string;
  private conversationList: ConversationMetadata[] = [];
  private currentConversationId: string | null = null;
  private saveInProgress: boolean = false;
  private pendingSave: boolean = false;

  constructor(app: App, basePath: string) {
    this.app = app;
    this.basePath = basePath;
  }

  setBasePath(path: string) {
    this.basePath = path;
  }

  setCurrentConversationId(id: string | null) {
    this.currentConversationId = id;
  }

  async initialize(): Promise<void> {
    await this.ensureFolderExists(this.basePath);
    await this.loadConversationList();
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const normalizedPath = normalizePath(folderPath);
    const folder = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (folder) return;

    const parts = normalizedPath.split('/');
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);
      if (!existing) {
        try {
          await this.app.vault.createFolder(currentPath);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (!errorMsg.includes('Folder already exists')) {
            throw error;
          }
        }
      }
    }
  }

  async loadConversationList(): Promise<ConversationMetadata[]> {
    this.conversationList = [];

    const normalizedPath = normalizePath(this.basePath);
    const folderExists = await this.app.vault.adapter.exists(normalizedPath);
    if (!folderExists) return [];

    try {
      const listing = await this.app.vault.adapter.list(normalizedPath);

      for (const filePath of listing.files) {
        if (filePath.endsWith('.md')) {
          const metadata = await this.parseConversationMetadataFromPath(filePath);
          if (metadata) {
            this.conversationList.push(metadata);
          }
        }
      }
    } catch (error) {
      console.error('Failed to list conversation files:', error);
      return [];
    }

    this.conversationList.sort((a, b) => b.updatedAt - a.updatedAt);
    return this.conversationList;
  }

  getConversationList(): ConversationMetadata[] {
    return this.conversationList;
  }

  private async parseConversationMetadataFromPath(filePath: string): Promise<ConversationMetadata | null> {
    try {
      const content = await this.app.vault.adapter.read(filePath);
      return this.parseMetadataFromContent(content, filePath);
    } catch (error) {
      console.error('Failed to parse conversation metadata from path:', filePath, error);
      return null;
    }
  }

  private parseMetadataFromContent(content: string, filePath: string): ConversationMetadata | null {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const frontmatter = frontmatterMatch[1];
    const basename = filePath.split('/').pop()?.replace('.md', '') || 'unknown';
    const id = this.extractYamlValue(frontmatter, 'id') || basename;
    const title = this.extractYamlValue(frontmatter, 'title') || 'Untitled';
    const createdAt = parseInt(this.extractYamlValue(frontmatter, 'createdAt') || '0');
    const updatedAt = parseInt(this.extractYamlValue(frontmatter, 'updatedAt') || '0');
    const messageCount = parseInt(this.extractYamlValue(frontmatter, 'messageCount') || '0');
    const graphGenerationMode = this.extractYamlValue(frontmatter, 'graphGenerationMode') === 'true' ||
      this.extractYamlValue(frontmatter, 'entityGenerationMode') === 'true';
    const orchestrationMode = this.extractYamlValue(frontmatter, 'orchestrationMode') === 'true';
    const vaultGraphIngestMode = this.extractYamlValue(frontmatter, 'vaultGraphIngestMode') === 'true';

    let localSearchModeValue = this.extractYamlValue(frontmatter, 'localSearchMode');
    if (localSearchModeValue === null) {
      localSearchModeValue = this.extractYamlValue(frontmatter, 'lookupMode');
    }
    const localSearchMode =
      localSearchModeValue === null
        ? !orchestrationMode && !vaultGraphIngestMode
        : localSearchModeValue === 'true';

    const rawChatMode = this.extractYamlValue(frontmatter, 'chatMode');
    const chatModeParsed =
      rawChatMode === 'general' || rawChatMode === 'graph' || rawChatMode === 'local'
        ? rawChatMode
        : null;

    const chatMode: CopilotChatMode =
      chatModeParsed ??
      inferChatModeFromLegacyFields({
        localSearchMode,
        graphGenerationMode,
        orchestrationMode,
        vaultGraphIngestMode,
      });

    const taskAgentIdRaw = this.extractYamlValue(frontmatter, 'taskAgentId');
    const taskAgentId =
      taskAgentIdRaw !== null && taskAgentIdRaw !== '' && taskAgentIdRaw !== '""'
        ? taskAgentIdRaw.replace(/^["']|["']$/g, '')
        : '';

    return {
      id,
      title,
      createdAt,
      updatedAt,
      messageCount,
      chatMode,
      taskAgentId: taskAgentId || undefined,
      localSearchMode,
      graphGenerationMode,
      orchestrationMode,
      vaultGraphIngestMode,
    };
  }

  private extractYamlValue(yaml: string, key: string): string | null {
    const match = yaml.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    return match ? match[1].trim() : null;
  }

  async loadConversation(id: string): Promise<Conversation | null> {
    const filePath = normalizePath(`${this.basePath}/${id}.md`);

    const fileExists = await this.app.vault.adapter.exists(filePath);
    if (!fileExists) return null;

    try {
      const content = await this.app.vault.adapter.read(filePath);

      const metadata = this.parseMetadataFromContent(content, filePath);
      if (!metadata) return null;

      const messagesMatch = content.match(/```json:messages\n([\s\S]*?)\n```/);
      let messages: ConversationMessage[] = [];
      if (messagesMatch) {
        try {
          messages = JSON.parse(messagesMatch[1]);
        } catch (e) {
          console.error('Failed to parse messages JSON:', e);
        }
      }

      return { ...metadata, messages };
    } catch (error) {
      console.error('Failed to load conversation:', error);
      return null;
    }
  }

  private generateId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateTitle(firstMessage?: string): string {
    if (!firstMessage) return 'New Conversation';
    const title = firstMessage.substring(0, 50);
    return title.length < firstMessage.length ? title + '...' : title;
  }

  async createConversation(
    firstMessage?: string,
    chatMode: CopilotChatMode = 'general',
    taskAgentId: string = '',
  ): Promise<Conversation> {
    const id = this.generateId();
    const now = Date.now();
    const flags = legacyFlagsForChatMode(chatMode);
    const conversation: Conversation = {
      id,
      title: this.generateTitle(firstMessage),
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      chatMode,
      taskAgentId: taskAgentId.trim() || undefined,
      ...flags,
      messages: [],
    };

    await this.saveConversation(conversation);
    this.currentConversationId = id;
    return conversation;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    if (this.saveInProgress) {
      this.pendingSave = true;
      return;
    }

    this.saveInProgress = true;
    try {
      await this.doSaveConversation(conversation);

      while (this.pendingSave) {
        this.pendingSave = false;
        await this.doSaveConversation(conversation);
      }
    } finally {
      this.saveInProgress = false;
    }
  }

  private async doSaveConversation(conversation: Conversation): Promise<void> {
    await this.ensureFolderExists(this.basePath);

    const filePath = normalizePath(`${this.basePath}/${conversation.id}.md`);
    conversation.updatedAt = Date.now();
    conversation.messageCount = conversation.messages.length;

    const content = this.serializeConversation(conversation);

    const fileExists = await this.app.vault.adapter.exists(filePath);

    if (fileExists) {
      await this.app.vault.adapter.write(filePath, content);
    } else {
      try {
        await this.app.vault.create(filePath, content);
      } catch (error) {
        const errorMsg = String(error instanceof Error ? error.message : error || '').toLowerCase();
        if (errorMsg.includes('already exists') || errorMsg.includes('file exists')) {
          await this.app.vault.adapter.write(filePath, content);
        } else {
          throw error;
        }
      }
    }

    await this.loadConversationList();
  }

  private serializeConversation(conversation: Conversation): string {
    const mode = conversation.chatMode ?? inferChatModeFromLegacyFields(conversation);
    const frontmatterLines = [
      '---',
      `id: ${conversation.id}`,
      `title: ${conversation.title}`,
      `createdAt: ${conversation.createdAt}`,
      `updatedAt: ${conversation.updatedAt}`,
      `messageCount: ${conversation.messageCount}`,
      `chatMode: ${mode}`,
      ...(conversation.taskAgentId
        ? [`taskAgentId: ${conversation.taskAgentId}`]
        : []),
      `localSearchMode: ${conversation.localSearchMode}`,
      `graphGenerationMode: ${conversation.graphGenerationMode || false}`,
      `orchestrationMode: ${conversation.orchestrationMode || false}`,
      `vaultGraphIngestMode: ${conversation.vaultGraphIngestMode || false}`,
      '---',
      '',
    ];

    const frontmatter = frontmatterLines.join('\n');

    const messagesBlock = [
      '```json:messages',
      JSON.stringify(conversation.messages, null, 2),
      '```'
    ].join('\n');

    return frontmatter + messagesBlock;
  }

  async deleteConversation(id: string): Promise<boolean> {
    const filePath = normalizePath(`${this.basePath}/${id}.md`);

    try {
      const fileExists = await this.app.vault.adapter.exists(filePath);
      if (!fileExists) {
        console.warn(`ConversationService: File not found for deletion: ${filePath}`);
        this.conversationList = this.conversationList.filter((c) => c.id !== id);
        return false;
      }

      await this.app.vault.adapter.remove(filePath);

      if (this.currentConversationId === id) {
        this.currentConversationId = null;
      }

      this.conversationList = this.conversationList.filter((c) => c.id !== id);
      return true;
    } catch (error) {
      console.error(`ConversationService: Failed to delete conversation ${id}:`, error);
      return false;
    }
  }

  async renameConversation(id: string, newTitle: string): Promise<boolean> {
    const conversation = await this.loadConversation(id);
    if (!conversation) return false;

    conversation.title = newTitle;
    await this.saveConversation(conversation);
    return true;
  }

  async getMostRecentConversation(): Promise<Conversation | null> {
    await this.loadConversationList();
    if (this.conversationList.length === 0) return null;
    return this.loadConversation(this.conversationList[0].id);
  }
}
