/**
 * API Service for AI-powered entity extraction.
 *
 * HYBRID ARCHITECTURE:
 * - This service ONLY handles AI graph generation from text (requires API)
 * - All other features (entity CRUD, connections, graph, map) work locally
 * - Uses local API at http://localhost:5000 by default for development
 * - Can be configured to use remote API for production
 *
 * NOTE: Uses Obsidian's requestUrl to bypass CORS restrictions in Electron.
 * The browser's fetch API is blocked by CORS when making requests from
 * the app://obsidian.md origin to external APIs.
 */

import { requestUrl } from 'obsidian';
import { AIOperation, Entity, ProcessTextResponse, getEntityLabel } from '../entities/types';
import { ClaudeCodeService, type ExtractionLogOptions } from './claude-code-service';

/** Optional tuning for vault ingest: smaller chunks + per-chunk callback for live UI. */
export interface VaultProcessTextChunkOptions {
    chunkSize?: number;
    chunkThreshold?: number;
    onChunkOperations?: (info: {
        chunkIndex: number;
        totalChunks: number;
        operations: AIOperation[];
    }) => void | Promise<void>;
}

export interface ApiHealthResponse {
    status: string;
    openai_configured: boolean;
    version?: string;
}

/**
 * Callback for retry notifications (reserved for future local retry UX).
 */
export type RetryCallback = (attempt: number, maxAttempts: number, reason: string, nextDelayMs: number) => void;

/** True when failure is normal user/environment (quiet console in ChatView URL flows). */
export function isLikelyExpectedUrlFetchFailure(message: string): boolean {
    return (
        /^HTTP (401|403)\b/.test(message) ||
        /^Failed to fetch URL \(HTTP (401|403|407|429)\)/.test(message) ||
        message.includes('Obsidian cannot fetch this URL')
    );
}

/** Non-throwing URL fetch + text extraction for orchestration (expected failures are ok:false). */
export type UrlExtractResult =
    | { ok: true; text: string }
    | { ok: false; status?: number; shortMessage: string; /** Longer copy for modal/Notice (401/403). */ longDetail?: string };

// Local interface to avoid circular dependency with main.ts
export interface ApiSettings {
    apiProvider: 'claude-code';
    customApiUrl: string;
    customApiKey: string;
    customModel: string;
    claudeCodeCliPath?: string;
    claudeCodeModel?: string;
}

/**
 * API Service for AI-powered entity extraction.
 *
 * This is the ONLY feature that requires the API:
 * - processText(): Extract entities from natural language text
 *
 * All other graph features work locally without the API:
 * - Manual entity creation/editing/deletion (via EntityManager)
 * - Connection creation (via EntityManager)
 * - Graph visualization (via GraphView)
 * - Map view for locations (via MapView)
 * - Geocoding (via GeocodingService - uses Nominatim, not this API)
 */
export class GraphApiService {
    private isOnline: boolean = false;
    private settings: ApiSettings | null = null;
    private claudeCodeService: ClaudeCodeService | null = null;

    constructor() {}

    setClaudeCodeService(service: ClaudeCodeService): void {
        this.claudeCodeService = service;
    }

    /**
     * Update settings.
     */
    setSettings(settings: ApiSettings): void {
        this.settings = settings;
    }

    /**
     * Check if Claude Code CLI is available for entity extraction.
     */
    async checkHealth(): Promise<ApiHealthResponse | null> {
        if (this.claudeCodeService) {
            const available = await this.claudeCodeService.isAvailable();
            this.isOnline = available;
            return available
                ? { status: 'ok', openai_configured: true, version: 'claude-code-local' }
                : null;
        }
        this.isOnline = false;
        return null;
    }

    /**
     * Get the current online status (Claude CLI probe).
     */
    getOnlineStatus(): boolean {
        return this.isOnline;
    }

    /** One-line status for logs and throw messages (orchestration uses tryExtract; UI may show more). */
    private shortHttpFetchMessage(status: number): string {
        if (status === 401 || status === 403) {
            return `HTTP ${status} (page not loaded — sign-in or site protection may be required)`;
        }
        if (status === 429) {
            return `HTTP ${status} (rate limited)`;
        }
        return `HTTP ${status} (page not loaded)`;
    }

    /** Longer guidance for modal / Notice when extractTextFromUrl throws (optional UI). */
    urlFetchDeniedExplanationForUi(status: number, url: string, headers: Record<string, unknown> | undefined): string {
        if (status !== 401 && status !== 403) {
            return `Failed to fetch URL (HTTP ${status})`;
        }
        const hKeys = headers && typeof headers === 'object' ? Object.keys(headers).map((k) => k.toLowerCase()) : [];
        const cloudflare = hKeys.some((k) => k.includes('cf-'));
        const webmail = /_task=mail|roundcube|webmail|\/owa\/|zimbra|horde\//i.test(url);
        const parts = [
            `HTTP ${status}: Obsidian cannot fetch this URL as a logged-in browser would.`,
            'The request is sent without your site cookies, so webmail, private portals, and many authenticated links return 401/403.',
        ];
        if (webmail) {
            parts.push('For email: export or copy the message text into chat instead of pasting the webmail print URL.');
        }
        if (cloudflare) {
            parts.push('Headers suggest Cloudflare in front; automated clients are often blocked until a real browser completes any checks.');
        }
        return parts.join(' ');
    }

    /**
     * Fetch URL and extract text without throwing (for unified orchestration).
     */
    async tryExtractTextFromUrl(url: string): Promise<UrlExtractResult> {
        console.debug('[GraphApiService] tryExtractTextFromUrl:', url);
        try {
            const response = await requestUrl({
                url,
                method: 'GET',
                headers: { 'Accept': 'text/html,application/xhtml+xml,text/plain,*/*' },
                throw: false,
            });

            if (response.status < 200 || response.status >= 300) {
                const hdrs = response.headers as Record<string, unknown> | undefined;
                const longDetail =
                    response.status === 401 || response.status === 403
                        ? this.urlFetchDeniedExplanationForUi(response.status, url, hdrs)
                        : undefined;
                return {
                    ok: false,
                    status: response.status,
                    shortMessage: this.shortHttpFetchMessage(response.status),
                    longDetail,
                };
            }

            const contentType = (response.headers?.['content-type'] || '').toLowerCase();
            let text = response.text || '';

            if (contentType.includes('text/html') || text.trimStart().startsWith('<')) {
                text = this.htmlToText(text);
            }

            const trimmed = text.trim();
            if (!trimmed) {
                return { ok: false, shortMessage: 'No extractable text from this URL' };
            }

            console.debug('[GraphApiService] Extracted text length:', trimmed.length);
            return { ok: true, text: trimmed };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.debug('[GraphApiService] tryExtractTextFromUrl failed:', msg);
            return { ok: false, shortMessage: msg.slice(0, 200) };
        }
    }

    /**
     * Extract text from a URL locally by fetching the page and stripping HTML.
     * Throws on failure (short message); use tryExtractTextFromUrl to avoid throws in orchestration.
     */
    async extractTextFromUrl(url: string): Promise<string> {
        const r = await this.tryExtractTextFromUrl(url);
        if (r.ok) return r.text;

        let host = '';
        try {
            host = new URL(url).hostname;
        } catch {
            host = '';
        }
        console.debug(`[GraphApiService] extractTextFromUrl skipped${host ? ` (${host})` : ''}: ${r.shortMessage}`);

        throw new Error(r.longDetail ?? r.shortMessage);
    }

    private htmlToText(html: string): string {
        let text = html;
        text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
        text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
        text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
        text = text.replace(/<!--[\s\S]*?-->/g, '');
        text = text.replace(/<(br|hr|p|div|li|tr|h[1-6])[^>]*\/?>/gi, '\n');
        text = text.replace(/<[^>]+>/g, '');
        text = text.replace(/&nbsp;/gi, ' ');
        text = text.replace(/&amp;/gi, '&');
        text = text.replace(/&lt;/gi, '<');
        text = text.replace(/&gt;/gi, '>');
        text = text.replace(/&quot;/gi, '"');
        text = text.replace(/&#39;/gi, "'");
        text = text.replace(/&[a-zA-Z]+;/g, ' ');
        text = text.replace(/[ \t]+/g, ' ');
        text = text.replace(/\n{3,}/g, '\n\n');
        return text.trim();
    }

    private static TEXT_EXTENSIONS = new Set([
        'md', 'txt', 'csv', 'json', 'xml', 'html', 'htm', 'log',
        'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
        'sh', 'bat', 'ps1', 'py', 'js', 'ts', 'jsx', 'tsx',
        'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb',
        'css', 'scss', 'less', 'sql', 'r', 'swift', 'kt',
    ]);

    /**
     * Extract text from a file locally.
     * Text formats are read directly. PDFs use pdftotext. DOCX uses XML extraction.
     * Other binary formats are saved to temp and processed by Claude Code CLI.
     */
    async extractTextFromFile(file: File): Promise<string> {
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Limit is 10MB.`);
        }

        const ext = (file.name.split('.').pop() || '').toLowerCase();

        if (GraphApiService.TEXT_EXTENSIONS.has(ext)) {
            return this.readFileAsText(file);
        }

        if (ext === 'pdf') {
            return this.extractPdfText(file);
        }

        if (ext === 'docx') {
            return this.extractDocxText(file);
        }

        throw new Error(
            `Local text extraction for .${ext} files is not yet supported.\n` +
            `Supported: text files, PDF (requires pdftotext/poppler), DOCX.\n` +
            `Tip: paste the text content directly into the chat instead.`
        );
    }

    /**
     * Extract text/information from an image file using Claude Code vision.
     */
    async extractTextFromImage(absolutePath: string, signal?: AbortSignal, logOptions?: ExtractionLogOptions): Promise<string> {
        if (!this.claudeCodeService) {
            throw new Error('Claude Code service not initialized.');
        }
        return this.claudeCodeService.extractTextFromImage(absolutePath, signal, logOptions);
    }

    private readFileAsText(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Extract text from PDF by saving to temp file and running pdftotext (poppler-utils).
     */
    private async extractPdfText(file: File): Promise<string> {
        const nodeFs = require('fs') as typeof import('fs');
        const nodePath = require('path') as typeof import('path');
        const os = require('os') as typeof import('os');
        const { execFile } = require('child_process') as typeof import('child_process');

        const buffer = await this.readFileAsArrayBuffer(file);
        const tmpDir = os.tmpdir();
        const tmpFile = nodePath.join(tmpDir, `osint-copilot-${Date.now()}.pdf`);

        try {
            nodeFs.writeFileSync(tmpFile, Buffer.from(buffer));

            const text = await new Promise<string>((resolve, reject) => {
                execFile('pdftotext', ['-layout', tmpFile, '-'], {
                    maxBuffer: 10 * 1024 * 1024,
                    timeout: 30_000,
                }, (error: any, stdout: string, stderr: string) => {
                    if (error) {
                        reject(new Error(
                            `PDF text extraction failed. Please install poppler-utils:\n` +
                            `  Ubuntu/Debian: sudo apt install poppler-utils\n` +
                            `  Arch/Manjaro: sudo pacman -S poppler\n` +
                            `  macOS: brew install poppler\n\n` +
                            `Error: ${stderr || error.message}`
                        ));
                    } else {
                        resolve(stdout);
                    }
                });
            });

            const trimmed = text.trim();
            if (!trimmed) {
                throw new Error('pdftotext returned empty output. The PDF may be image-based (scanned). Image OCR is not yet supported locally.');
            }
            return trimmed;
        } finally {
            try { nodeFs.unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
        }
    }

    /**
     * Extract text from DOCX by reading it as a ZIP and parsing word/document.xml.
     */
    private async extractDocxText(file: File): Promise<string> {
        const buffer = await this.readFileAsArrayBuffer(file);
        const bytes = new Uint8Array(buffer);

        const xmlContent = this.extractFileFromZip(bytes, 'word/document.xml');
        if (!xmlContent) {
            throw new Error('Could not find word/document.xml inside the DOCX file.');
        }

        let text = new TextDecoder().decode(xmlContent);
        text = text.replace(/<w:p[^>]*>/g, '\n');
        text = text.replace(/<w:tab\/>/g, '\t');
        text = text.replace(/<w:br\/>/g, '\n');
        text = text.replace(/<[^>]+>/g, '');
        text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
        text = text.replace(/\n{3,}/g, '\n\n');

        return text.trim();
    }

    /**
     * Minimal ZIP extraction for a single file entry (no external dependencies).
     *
     * Reads the central directory (located via the End Of Central Directory record) rather
     * than scanning local file headers sequentially from the start of the archive. Many real
     * DOCX writers (streamed saves, some Word/LibreOffice/Pandoc output) set the ZIP
     * "data descriptor" bit on compressed entries, which leaves compressed/uncompressed size
     * as 0 in the *local* header — a sequential scan can't know how far to skip and desyncs
     * on the first such entry. Central directory entries always carry accurate sizes.
     */
    private extractFileFromZip(data: Uint8Array, targetPath: string): Uint8Array | null {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

        const EOCD_SIGNATURE = 0x06054b50; // "PK\x05\x06"
        const eocdSearchStart = Math.max(0, data.length - 22 - 0xffff); // EOCD comment is at most 65535 bytes
        let eocdOffset = -1;
        for (let i = data.length - 22; i >= eocdSearchStart; i--) {
            if (view.getUint32(i, true) === EOCD_SIGNATURE) {
                eocdOffset = i;
                break;
            }
        }
        if (eocdOffset === -1) return null;

        const centralDirEntryCount = view.getUint16(eocdOffset + 10, true);
        const centralDirOffset = view.getUint32(eocdOffset + 16, true);

        const CENTRAL_DIR_SIGNATURE = 0x02014b50; // "PK\x01\x02"
        let offset = centralDirOffset;
        for (let i = 0; i < centralDirEntryCount; i++) {
            if (offset + 46 > data.length || view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) break;

            const compressionMethod = view.getUint16(offset + 10, true);
            const compressedSize = view.getUint32(offset + 20, true);
            const uncompressedSize = view.getUint32(offset + 24, true);
            const nameLen = view.getUint16(offset + 28, true);
            const extraLen = view.getUint16(offset + 30, true);
            const commentLen = view.getUint16(offset + 32, true);
            const localHeaderOffset = view.getUint32(offset + 42, true);
            const name = new TextDecoder().decode(data.slice(offset + 46, offset + 46 + nameLen));

            if (name === targetPath) {
                return this.readZipEntryData(data, view, localHeaderOffset, compressionMethod, compressedSize, uncompressedSize);
            }

            offset += 46 + nameLen + extraLen + commentLen;
        }
        return null;
    }

    /** Reads and (if needed) inflates a single entry's data given its central-directory metadata. */
    private readZipEntryData(
        data: Uint8Array,
        view: DataView,
        localHeaderOffset: number,
        compressionMethod: number,
        compressedSize: number,
        uncompressedSize: number,
    ): Uint8Array | null {
        const LOCAL_FILE_SIGNATURE = 0x04034b50; // "PK\x03\x04"
        if (view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_SIGNATURE) return null;

        const nameLen = view.getUint16(localHeaderOffset + 26, true);
        const extraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + nameLen + extraLen;

        if (compressionMethod === 0) {
            return data.slice(dataStart, dataStart + uncompressedSize);
        }
        if (compressionMethod === 8) {
            try {
                const compressed = data.slice(dataStart, dataStart + compressedSize);
                const { inflateRawSync } = require('zlib') as typeof import('zlib');
                const result = inflateRawSync(Buffer.from(compressed));
                return new Uint8Array(result);
            } catch (e) {
                console.error('[GraphApiService] DOCX decompression failed:', e);
                return null;
            }
        }
        return null;
    }

    /**
     * Chat via Claude Code CLI. Replaces remote custom provider and backend calls.
     */
    async chatWithCustomProvider(
        text: string,
        systemPrompt?: string,
        settings?: { customApiUrl: string, customApiKey: string, customModel: string, type?: 'openai' | 'mindsdb' },
        signal?: AbortSignal
    ): Promise<string> {
        if (!this.claudeCodeService) {
            throw new Error('Claude Code service not initialized.');
        }
        const sys = systemPrompt || 'You are a helpful OSINT assistant. Answer the user\'s questions to the best of your ability.';
        return this.claudeCodeService.chat(sys, text, signal);
    }

    /**
     * General-purpose LLM call via Claude Code CLI.
     */
    async callRemoteModel(
        messages: { role: string, content: string }[],
        jsonResponse: boolean = false,
        customModel?: string,
        signal?: AbortSignal,
        orchestrationOptions?: { provider: 'osint-copilot' | 'local' | 'remote', url: string, apiKey: string },
        logOptions?: ExtractionLogOptions
    ): Promise<string> {
        if (!this.claudeCodeService) {
            throw new Error('Claude Code service not initialized.');
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
        if (jsonResponse) {
            systemPrompt += '\n\nRespond ONLY with valid JSON. No explanation, no markdown fences.';
        }
        return this.claudeCodeService.chat(systemPrompt, userContent, signal, logOptions);
    }

    /**
     * Split text into chunks, trying to break at paragraph boundaries.
     */
    private splitTextIntoChunks(text: string, chunkSize: number = 1000): string[] {
        const chunks: string[] = [];
        let remaining = text;

        while (remaining.length > 0) {
            if (remaining.length <= chunkSize) {
                chunks.push(remaining);
                break;
            }

            // Try to find a paragraph break near the chunk size
            let breakPoint = remaining.lastIndexOf('\n\n', chunkSize);
            if (breakPoint === -1 || breakPoint < chunkSize * 0.5) {
                // No paragraph break, try single newline
                breakPoint = remaining.lastIndexOf('\n', chunkSize);
            }
            if (breakPoint === -1 || breakPoint < chunkSize * 0.5) {
                // No newline, try sentence break
                breakPoint = remaining.lastIndexOf('. ', chunkSize);
                if (breakPoint > 0) breakPoint += 1; // Include the period
            }
            if (breakPoint === -1 || breakPoint < chunkSize * 0.5) {
                // No good break point, just cut at chunk size
                breakPoint = chunkSize;
            }

            chunks.push(remaining.substring(0, breakPoint).trim());
            remaining = remaining.substring(breakPoint).trim();
        }

        return chunks;
    }

    /**
     * Process large text by chunking and merging entities.
     * For texts larger than CHUNK_THRESHOLD, splits into chunks and processes each.
     */
    async processTextInChunks(
        text: string,
        existingEntities?: Entity[],
        referenceTime?: string,
        onChunkProgress?: (chunkIndex: number, totalChunks: number, message: string) => void,
        onRetry?: RetryCallback,
        signal?: AbortSignal,
        useLocal: boolean = false,
        vaultChunkOptions?: VaultProcessTextChunkOptions
    ): Promise<ProcessTextResponse> {
        const CHUNK_SIZE = vaultChunkOptions?.chunkSize ?? 700; // Default: keep requests under CDN/proxy time limits
        const CHUNK_THRESHOLD = vaultChunkOptions?.chunkThreshold ?? 1200; // Chunk before a single call gets too heavy

        // For small texts, process directly
        if (text.length <= CHUNK_THRESHOLD) {
            const result = await this.processText(text, existingEntities, referenceTime, onRetry, signal, useLocal);
            if (vaultChunkOptions?.onChunkOperations && result.success && result.operations?.length) {
                await vaultChunkOptions.onChunkOperations({
                    chunkIndex: 1,
                    totalChunks: 1,
                    operations: result.operations,
                });
            }
            return result;
        }

        console.debug(`[GraphApiService] Large text detected (${text.length} chars), processing in chunks`);

        const chunks = this.splitTextIntoChunks(text, CHUNK_SIZE);
        console.debug(`[GraphApiService] Split into ${chunks.length} chunks`);

        const allOperations: ProcessTextResponse['operations'] = [];
        const seenEntities = new Set<string>();  // Track entity keys for deduplication
        let accumulatedEntities = existingEntities || [];

        for (let i = 0; i < chunks.length; i++) {
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            const chunk = chunks[i];
            const chunkNum = i + 1;

            if (onChunkProgress) {
                onChunkProgress(chunkNum, chunks.length, `Processing chunk ${chunkNum}/${chunks.length}...`);
            }

            console.debug(`[GraphApiService] Processing chunk ${chunkNum}/${chunks.length} (${chunk.length} chars)`);

            try {
                const result = await this.processText(chunk, accumulatedEntities, referenceTime, onRetry, signal, useLocal);

                if (!result.success) {
                    console.warn(`[GraphApiService] Chunk ${chunkNum} failed:`, result.error);
                    // Continue with other chunks instead of failing entirely
                    continue;
                }

                if (result.operations) {
                    const chunkAddedOps: AIOperation[] = [];
                    // Deduplicate entities
                    for (const op of result.operations) {
                        if (op.action === 'create' && op.entities) {
                            const dedupedEntities = op.entities.filter(entity => {
                                // Compute label from properties using type's labelField
                                const label = getEntityLabel(entity.type, entity.properties);
                                const key = `${entity.type}::${label.toLowerCase()}`;
                                if (seenEntities.has(key)) {
                                    console.debug(`[GraphApiService] Skipping duplicate entity: ${key}`);
                                    return false;
                                }
                                seenEntities.add(key);
                                return true;
                            });

                            if (dedupedEntities.length > 0) {
                                const mergedOp: AIOperation = {
                                    ...op,
                                    entities: dedupedEntities
                                };
                                allOperations.push(mergedOp);
                                chunkAddedOps.push(mergedOp);

                                // Add to accumulated entities for context in next chunk
                                accumulatedEntities = [
                                    ...accumulatedEntities,
                                    ...dedupedEntities.map(e => ({
                                        id: `temp-${Date.now()}-${Math.random()}`,
                                        type: e.type,
                                        label: getEntityLabel(e.type, e.properties),
                                        properties: e.properties || {}
                                    }))
                                ];
                            }
                        } else if (op.connections) {
                            // Include connection operations
                            allOperations.push(op);
                            chunkAddedOps.push(op);
                        }
                    }
                    if (vaultChunkOptions?.onChunkOperations && chunkAddedOps.length > 0) {
                        await vaultChunkOptions.onChunkOperations({
                            chunkIndex: chunkNum,
                            totalChunks: chunks.length,
                            operations: chunkAddedOps,
                        });
                    }
                }
            } catch (error) {
                console.error(`[GraphApiService] Chunk ${chunkNum} error:`, error);
                // Continue with other chunks
            }
        }

        if (allOperations.length === 0) {
            return {
                success: false,
                error: 'Failed to extract entities from any chunks'
            };
        }

        console.debug(`[GraphApiService] Chunking complete. Total operations: ${allOperations.length}`);

        return {
            success: true,
            operations: allOperations
        };
    }

    /**
     * Process natural language text through the AI to extract entities.
     *
     * THIS IS THE ONLY API-DEPENDENT FEATURE.
     *
     * Features:
     * - Automatic retry with exponential backoff and jitter for transient failures
     * - Adaptive timeout that increases after timeout errors
     * - Request timeout to prevent hanging on slow connections
     * - Distinguishes between retryable and permanent errors
     * - Optional callback for retry notifications (user feedback)
     *
     * When the API is unavailable:
     * - This method returns an error
     * - Users can still create entities manually via the Graph View
     * - All other features continue to work locally
     *
     * @param text - Natural language text to process
     * @param existingEntities - Optional list of existing entities for context
     * @param referenceTime - Optional reference time for relative date parsing
     * @param onRetry - Optional callback for retry notifications
     * @returns ProcessTextResponse with extracted entities and relationships
     */
    async processText(
        text: string,
        existingEntities?: Entity[],
        referenceTime?: string,
        onRetry?: RetryCallback,
        signal?: AbortSignal,
        useLocal: boolean = false
    ): Promise<ProcessTextResponse> {
        if (!this.claudeCodeService) {
            return {
                success: false,
                error: 'Claude Code service not initialized. Please check Settings → OSINT Copilot → Graph Extraction.',
            };
        }
        console.debug('[GraphApiService] Routing to Claude Code for entity extraction');
        return this.claudeCodeService.extractEntities(text, existingEntities, undefined, signal);
    }
}

// Alias for backward compatibility with ai-panel.ts
export { GraphApiService as ApiService };
