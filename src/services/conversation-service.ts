/**
 * Conversation Service - handles conversation persistence for OSINT Copilot chat
 */
import { App, TFile, TFolder, normalizePath } from 'obsidian';

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  notes?: unknown[];
  jobId?: string;
  status?: string;
  progress?: unknown;
  reportFilePath?: string; // Path to generated report file
}

export interface ConversationMetadata {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  localSearchMode: boolean;
  darkWebMode: boolean;
  graphGenerationMode: boolean;
  reportGenerationMode: boolean;
  osintSearchMode?: boolean; // Leak Search mode
  reportConversationId?: string; // conversation_id для report generation API
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
    // Ensure the conversations folder exists (handle nested paths)
    await this.ensureFolderExists(this.basePath);
    await this.loadConversationList();
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const normalizedPath = normalizePath(folderPath);
    const folder = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (folder) return; // Already exists

    // Split path and create each level if needed
    const parts = normalizedPath.split('/');
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);
      if (!existing) {
        try {
          await this.app.vault.createFolder(currentPath);
        } catch (error) {
          // Ignore "folder already exists" errors (race condition)
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

    // Use adapter.list for more reliable file listing (bypasses Obsidian's cache)
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

    // Sort by updatedAt descending (most recent first)
    this.conversationList.sort((a, b) => b.updatedAt - a.updatedAt);
    return this.conversationList;
  }

  getConversationList(): ConversationMetadata[] {
    return this.conversationList;
  }

  private async parseConversationMetadataFromPath(filePath: string): Promise<ConversationMetadata | null> {
    try {
      // Read directly from adapter for reliability
      const content = await this.app.vault.adapter.read(filePath);
      return this.parseMetadataFromContent(content, filePath);
    } catch (error) {
      console.error('Failed to parse conversation metadata from path:', filePath, error);
      return null;
    }
  }

  private async parseConversationMetadata(file: TFile): Promise<ConversationMetadata | null> {
    try {
      const content = await this.app.vault.read(file);
      return this.parseMetadataFromContent(content, file.path);
    } catch (error) {
      console.error('Failed to parse conversation metadata:', error);
      return null;
    }
  }

  private parseMetadataFromContent(content: string, filePath: string): ConversationMetadata | null {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const frontmatter = frontmatterMatch[1];
    // Extract basename from path for fallback id
    const basename = filePath.split('/').pop()?.replace('.md', '') || 'unknown';
    const id = this.extractYamlValue(frontmatter, 'id') || basename;
    const title = this.extractYamlValue(frontmatter, 'title') || 'Untitled';
    const createdAt = parseInt(this.extractYamlValue(frontmatter, 'createdAt') || '0');
    const updatedAt = parseInt(this.extractYamlValue(frontmatter, 'updatedAt') || '0');
    const messageCount = parseInt(this.extractYamlValue(frontmatter, 'messageCount') || '0');
    const darkWebMode = this.extractYamlValue(frontmatter, 'darkWebMode') === 'true';
    const graphGenerationMode = this.extractYamlValue(frontmatter, 'graphGenerationMode') === 'true' ||
      this.extractYamlValue(frontmatter, 'entityGenerationMode') === 'true'; // Backward compatibility
    const reportGenerationMode = this.extractYamlValue(frontmatter, 'reportGenerationMode') === 'true';
    // localSearchMode defaults to true for backward compatibility (if not specified, assume local search mode)
    // Also check for legacy 'lookupMode' key for backward compatibility with old conversations
    let localSearchModeValue = this.extractYamlValue(frontmatter, 'localSearchMode');
    if (localSearchModeValue === null) {
      // Fallback to legacy 'lookupMode' key
      localSearchModeValue = this.extractYamlValue(frontmatter, 'lookupMode');
    }
    const localSearchMode = localSearchModeValue === null ? !darkWebMode && !reportGenerationMode : localSearchModeValue === 'true';
    const reportConversationId = this.extractYamlValue(frontmatter, 'reportConversationId');

    return { id, title, createdAt, updatedAt, messageCount, localSearchMode, darkWebMode, graphGenerationMode, reportGenerationMode, reportConversationId: reportConversationId || undefined };
  }

  private extractYamlValue(yaml: string, key: string): string | null {
    const match = yaml.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    return match ? match[1].trim() : null;
  }

  async loadConversation(id: string): Promise<Conversation | null> {
    const filePath = normalizePath(`${this.basePath}/${id}.md`);

    // Use adapter to check if file exists (more reliable than getAbstractFileByPath)
    const fileExists = await this.app.vault.adapter.exists(filePath);
    if (!fileExists) return null;

    try {
      // Read directly from adapter for reliability
      const content = await this.app.vault.adapter.read(filePath);

      const metadata = this.parseMetadataFromContent(content, filePath);
      if (!metadata) return null;

      // Extract messages from JSON block
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
    return `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateTitle(firstMessage?: string): string {
    if (!firstMessage) return 'New Conversation';
    const title = firstMessage.substring(0, 50);
    return title.length < firstMessage.length ? title + '...' : title;
  }

  async createConversation(firstMessage?: string, darkWebMode: boolean = false, graphGenerationMode: boolean = false, reportGenerationMode: boolean = false): Promise<Conversation> {
    const id = this.generateId();
    const now = Date.now();
    // Infer localSearchMode: true if no other main mode is active
    const localSearchMode = !darkWebMode && !reportGenerationMode;
    const conversation: Conversation = {
      id,
      title: this.generateTitle(firstMessage),
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      localSearchMode,
      darkWebMode,
      graphGenerationMode,
      reportGenerationMode,
      messages: []
    };

    await this.saveConversation(conversation);
    this.currentConversationId = id;
    return conversation;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    // Prevent concurrent saves - queue if already saving
    if (this.saveInProgress) {
      this.pendingSave = true;
      return;
    }

    this.saveInProgress = true;
    try {
      await this.doSaveConversation(conversation);

      // Process any pending save that was queued
      while (this.pendingSave) {
        this.pendingSave = false;
        await this.doSaveConversation(conversation);
      }
    } finally {
      this.saveInProgress = false;
    }
  }

  private async doSaveConversation(conversation: Conversation): Promise<void> {
    // Ensure the folder exists before saving
    await this.ensureFolderExists(this.basePath);

    const filePath = normalizePath(`${this.basePath}/${conversation.id}.md`);
    conversation.updatedAt = Date.now();
    conversation.messageCount = conversation.messages.length;

    const content = this.serializeConversation(conversation);

    // Use the vault adapter to check if file exists at filesystem level
    // This is more reliable than getAbstractFileByPath which uses Obsidian's cache
    const fileExists = await this.app.vault.adapter.exists(filePath);

    if (fileExists) {
      // File exists on disk - use adapter.write for reliability
      await this.app.vault.adapter.write(filePath, content);
    } else {
      try {
        // Try to create the file
        await this.app.vault.create(filePath, content);
      } catch (error) {
        // Handle "File already exists" race condition
        const errorMsg = String(error instanceof Error ? error.message : error || '').toLowerCase();
        if (errorMsg.includes('already exists') || errorMsg.includes('file exists')) {
          // File was created between our check and create - just write to it
          await this.app.vault.adapter.write(filePath, content);
        } else {
          throw error;
        }
      }
    }

    // Update the list
    await this.loadConversationList();
  }

  private serializeConversation(conversation: Conversation): string {
    const frontmatterLines = [
      '---',
      `id: ${conversation.id}`,
      `title: ${conversation.title}`,
      `createdAt: ${conversation.createdAt}`,
      `updatedAt: ${conversation.updatedAt}`,
      `messageCount: ${conversation.messageCount}`,
      `localSearchMode: ${conversation.localSearchMode}`,
      `darkWebMode: ${conversation.darkWebMode}`,
      `graphGenerationMode: ${conversation.graphGenerationMode || false}`,
      `reportGenerationMode: ${conversation.reportGenerationMode || false}`
    ];

    // Add reportConversationId only if it exists
    if (conversation.reportConversationId) {
      frontmatterLines.push(`reportConversationId: ${conversation.reportConversationId}`);
    }

    frontmatterLines.push('---', '');
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
      // Use adapter.exists for reliable file check (bypasses Obsidian's cache)
      const fileExists = await this.app.vault.adapter.exists(filePath);
      if (!fileExists) {
        console.warn(`ConversationService: File not found for deletion: ${filePath}`);
        // Still remove from local list if it exists there
        this.conversationList = this.conversationList.filter(c => c.id !== id);
        return false;
      }

      // Use adapter.remove for reliable deletion
      await this.app.vault.adapter.remove(filePath);

      // Update local state
      if (this.currentConversationId === id) {
        this.currentConversationId = null;
      }

      // Remove from local conversation list immediately
      this.conversationList = this.conversationList.filter(c => c.id !== id);

      return true;
    } catch (error) {
      console.error(`ConversationService: Failed to delete conversation ${id}:`, error);
      return false;
    }
  }

  async renameConversation(id: string, newTitle: string): Promise<boolean> {
    const conversation = await this.loadConversation(id);
    if (conversation) {
      conversation.title = newTitle;
      await this.saveConversation(conversation);
      return true;
    }
    return false;
  }

  async getMostRecentConversation(): Promise<Conversation | null> {
    await this.loadConversationList();
    if (this.conversationList.length === 0) return null;
    return this.loadConversation(this.conversationList[0].id);
  }
}
