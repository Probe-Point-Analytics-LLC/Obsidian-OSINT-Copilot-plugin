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

import { requestUrl, RequestUrlResponse } from 'obsidian';
import { AIOperation, Entity, ProcessTextResponse, getEntityLabel } from '../entities/types';
import { ClaudeCodeService } from './claude-code-service';

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

// ============================================================================
// AI Search Types
// ============================================================================

/**
 * Request format for AI-powered OSINT search.
 */
export interface AISearchRequest {
    query: string;
    country?: 'RU' | 'UA' | 'BY' | 'KZ' | 'ALL';
    max_providers?: number;
    preferred_providers?: string[];
    parallel?: boolean;
}

/**
 * Entity detected from the search query.
 */
export interface DetectedEntity {
    value: string;
    type: string;
    confidence: number;
    normalized_value: string;
}

/**
 * Response from the AI search endpoint.
 * The results array contains raw data objects from the search.
 */
export interface AISearchResponse {
    query: string;
    detected_entities: DetectedEntity[];
    results: Record<string, unknown>[];
    total_results: number;
    status: 'success' | 'error' | 'no_results';
    status_message: string;
    execution_time_ms: number;
    explanation: string;
}

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    baseTimeoutMs: number;
    maxTimeoutMs: number;
    timeoutMultiplierOnTimeout: number;
}

/**
 * Callback for retry notifications.
 */
export type RetryCallback = (attempt: number, maxAttempts: number, reason: string, nextDelayMs: number) => void;

/**
 * Default retry configuration with robust settings for unstable networks.
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,              // Reduced retries since we have proper timeouts now
    baseDelayMs: 1000,          // Start with 1 second delay
    maxDelayMs: 10000,          // Cap at 10 seconds max delay
    baseTimeoutMs: 300000,      // 300 second timeout (5 minutes)
    maxTimeoutMs: 600000,       // 600 second max timeout (10 minutes)
    timeoutMultiplierOnTimeout: 1.5  // Increase timeout by 50% on each timeout retry
};

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
    private baseUrl: string;
    private apiKey: string;
    private isOnline: boolean = false;
    private retryConfig: RetryConfig;
    private settings: ApiSettings | null = null;
    private claudeCodeService: ClaudeCodeService | null = null;

    constructor(baseUrl: string = 'https://api.osint-copilot.com', apiKey: string = '') {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.retryConfig = { ...DEFAULT_RETRY_CONFIG };
    }

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
     * Update retry configuration.
     */
    setRetryConfig(config: Partial<RetryConfig>): void {
        this.retryConfig = { ...this.retryConfig, ...config };
    }

    /**
     * Get current retry configuration.
     */
    getRetryConfig(): RetryConfig {
        return { ...this.retryConfig };
    }

    /**
     * Update the API base URL.
     */
    setBaseUrl(url: string): void {
        this.baseUrl = url;
    }

    /**
     * Update the API key.
     */
    setApiKey(key: string): void {
        this.apiKey = key;
    }

    /**
     * Get authorization headers.
     */
    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        return headers;
    }

    /**
     * Check if the AI API is online.
     * This only affects the "Generate Entities from Text" feature.
     * All other features work locally without the API.
     *
     * Uses Obsidian's requestUrl to bypass CORS restrictions.
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
     * Get the current online status.
     * Note: This only affects AI graph generation. All other features work offline.
     */
    getOnlineStatus(): boolean {
        return this.isOnline;
    }

    /**
     * Response wrapper to provide a consistent interface for requestUrl responses.
     * This mimics the browser's Response interface for compatibility with existing code.
     */
    private createResponseWrapper(response: RequestUrlResponse): {
        ok: boolean;
        status: number;
        text: () => Promise<string>;
        json: () => Promise<unknown>;
    } {
        return {
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            text: async () => response.text,
            json: async () => response.json
        };
    }

    /**
     * Helper to create a request with timeout using Obsidian's requestUrl.
     * This bypasses CORS restrictions that affect the browser's fetch API.
     *
     * @param url - The URL to request
     * @param options - Request options (method, headers, body)
     * @param timeoutMs - Timeout in milliseconds (note: requestUrl doesn't support abort, so this is advisory)
     * @returns A response wrapper compatible with the existing code
     */
    private async fetchWithTimeout(
        url: string,
        options: RequestInit,
        timeoutMs: number = 30000,
        signal?: AbortSignal
    ): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }> {
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
            const timer = setTimeout(() => {
                const error = new DOMException('Request timed out', 'AbortError');
                reject(error);
            }, timeoutMs);

            // Clear timeout if signal aborts
            if (signal) {
                signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            }
        });

        // Create the request promise using Obsidian's requestUrl
        const requestPromise = requestUrl({
            url,
            method: options.method as string || 'GET',
            headers: options.headers as Record<string, string>,
            body: options.body as string,
            throw: false // Don't throw on non-2xx status, let us handle it
        });

        // Race between request and timeout
        const response = await Promise.race([requestPromise, timeoutPromise]);

        return this.createResponseWrapper(response);
    }

    /**
     * Determine if an error is a timeout error.
     */
    private isTimeoutError(error: unknown): boolean {
        // Check for our custom timeout error or AbortError
        if (error instanceof DOMException && error.name === 'AbortError') {
            return true;
        }
        // Also check for timeout-related error messages
        if (error instanceof Error) {
            const msg = error.message.toLowerCase();
            return msg.includes('timeout') || msg.includes('timed out');
        }
        return false;
    }

    /**
     * Determine if an error is a network connectivity error.
     */
    private isNetworkError(error: unknown): boolean {
        if (error instanceof Error) {
            const errorStr = error.message.toLowerCase();
            return errorStr.includes('failed to fetch') ||
                errorStr.includes('network') ||
                errorStr.includes('connection') ||
                errorStr.includes('net::') ||
                errorStr.includes('econnrefused') ||
                errorStr.includes('enotfound');
        }
        return false;
    }

    /**
     * Determine if an error is retryable (network issues, server errors).
     */
    private isRetryableError(error: unknown, statusCode?: number): boolean {
        // Timeout errors are retryable
        if (this.isTimeoutError(error)) {
            return true;
        }

        // Network errors (Failed to fetch, connection issues, etc.) are retryable
        if (this.isNetworkError(error)) {
            return true;
        }

        // Generic TypeError (often network-related in fetch)
        if (error instanceof TypeError) {
            return true;
        }

        // Server errors (5xx) are retryable
        if (statusCode && statusCode >= 500 && statusCode < 600) {
            return true;
        }

        // Rate limiting (429) is retryable
        if (statusCode === 429) {
            return true;
        }

        // Service unavailable (503) - often temporary
        if (statusCode === 503) {
            return true;
        }

        // Gateway timeout (504)
        if (statusCode === 504) {
            return true;
        }

        // Cloudflare "origin timeout" — edge gave up waiting for the API; retry may help if transient
        if (statusCode === 524) {
            return true;
        }

        return false;
    }

    /**
     * Get a short reason string for the error (for retry callback).
     */
    private getErrorReason(error: unknown, statusCode?: number): string {
        if (this.isTimeoutError(error)) {
            return 'timeout';
        }
        if (this.isNetworkError(error)) {
            return 'network';
        }
        if (statusCode === 429) {
            return 'rate-limited';
        }
        if (statusCode === 524) {
            return 'cloudflare-timeout';
        }
        if (statusCode && statusCode >= 500) {
            return `server-error-${statusCode}`;
        }
        return 'unknown';
    }

    /**
     * Get user-friendly error message based on error type.
     */
    private getErrorMessage(error: unknown, statusCode?: number): string {
        // Timeout error
        if (this.isTimeoutError(error)) {
            return 'The request is taking longer than expected. Please wait a moment while we retry...';
        }

        // Network connectivity error
        if (this.isNetworkError(error)) {
            return 'Network connection failed. Please check your internet connection.';
        }

        // Generic TypeError (often network-related)
        if (error instanceof TypeError) {
            return 'Network error occurred. Please check your connection and try again.';
        }

        if (statusCode === 524) {
            return (
                'Cloudflare/proxy timeout (524): the origin API did not respond in time. ' +
                'Long or complex extraction often needs smaller text chunks per request.'
            );
        }

        // Server errors
        if (statusCode && statusCode >= 500) {
            if (statusCode === 503) {
                return 'Service temporarily unavailable. The server is overloaded or under maintenance.';
            }
            if (statusCode === 504) {
                return 'The server is processing your request. Please wait a moment...';
            }
            return `Server error (${statusCode}). The service is temporarily unavailable.`;
        }

        // Rate limiting
        if (statusCode === 429) {
            return 'Too many requests. Please wait a moment before trying again.';
        }

        // Generic error
        return error instanceof Error ? error.message : String(error);
    }

    /**
     * Calculate delay for exponential backoff with jitter.
     */
    private calculateBackoffDelay(attempt: number): number {
        // Exponential backoff: baseDelay * 2^(attempt-1)
        const exponentialDelay = this.retryConfig.baseDelayMs * Math.pow(2, attempt - 1);

        // Add jitter (±25%) to prevent thundering herd
        const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);

        // Cap at max delay
        return Math.min(exponentialDelay + jitter, this.retryConfig.maxDelayMs);
    }

    /**
     * Calculate timeout for the current attempt.
     * Increases timeout after timeout errors.
     */
    private calculateTimeout(baseTimeout: number, hadTimeoutError: boolean): number {
        if (hadTimeoutError) {
            const increasedTimeout = baseTimeout * this.retryConfig.timeoutMultiplierOnTimeout;
            return Math.min(increasedTimeout, this.retryConfig.maxTimeoutMs);
        }
        return baseTimeout;
    }

    /**
     * Extract text from a URL locally by fetching the page and stripping HTML.
     */
    async extractTextFromUrl(url: string): Promise<string> {
        console.debug('[GraphApiService] extractTextFromUrl (local) called with:', url);

        try {
            const response = await requestUrl({
                url,
                method: 'GET',
                headers: { 'Accept': 'text/html,application/xhtml+xml,text/plain,*/*' },
                throw: false
            });

            if (response.status < 200 || response.status >= 300) {
                throw new Error(`Failed to fetch URL (${response.status})`);
            }

            const contentType = (response.headers?.['content-type'] || '').toLowerCase();
            let text = response.text || '';

            if (contentType.includes('text/html') || text.trimStart().startsWith('<')) {
                text = this.htmlToText(text);
            }

            const trimmed = text.trim();
            if (!trimmed) {
                throw new Error('No text content could be extracted from this URL');
            }

            console.debug('[GraphApiService] Extracted text length:', trimmed.length);
            return trimmed;
        } catch (error) {
            console.error('[GraphApiService] extractTextFromUrl exception:', error);
            throw error;
        }
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
     */
    private extractFileFromZip(data: Uint8Array, targetPath: string): Uint8Array | null {
        let offset = 0;
        while (offset < data.length - 4) {
            const sig = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
            if (sig !== 0x04034b50) break; // PK\x03\x04

            const compressionMethod = data[offset + 8] | (data[offset + 9] << 8);
            const compressedSize = data[offset + 18] | (data[offset + 19] << 8) | (data[offset + 20] << 16) | (data[offset + 21] << 24);
            const uncompressedSize = data[offset + 22] | (data[offset + 23] << 8) | (data[offset + 24] << 16) | (data[offset + 25] << 24);
            const nameLen = data[offset + 26] | (data[offset + 27] << 8);
            const extraLen = data[offset + 28] | (data[offset + 29] << 8);
            const name = new TextDecoder().decode(data.slice(offset + 30, offset + 30 + nameLen));
            const dataStart = offset + 30 + nameLen + extraLen;

            if (name === targetPath) {
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

            const size = compressedSize > 0 ? compressedSize : uncompressedSize;
            offset = dataStart + size;
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
        orchestrationOptions?: { provider: 'osint-copilot' | 'local' | 'remote', url: string, apiKey: string }
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
        return this.claudeCodeService.chat(systemPrompt, userContent, signal);
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



    /**
     * AI-powered OSINT search that automatically detects entity types,
     * selects appropriate providers, and aggregates results.
     *
     * @param request - Search request with query and options
     * @param onRetry - Optional callback for retry notifications
     * @returns AISearchResponse with detected entities and search results
     */
    async aiSearch(
        request: AISearchRequest,
        onRetry?: RetryCallback,
        signal?: AbortSignal
    ): Promise<AISearchResponse> {
        // First, try to connect if we haven't checked yet
        if (!this.isOnline) {
            await this.checkHealth();
        }

        if (!this.apiKey) {
            throw new Error('License key required for Digital Footprint. Configure in Settings → OSINT Copilot → API Key.');
        }

        console.debug('[GraphApiService] AI Search request:', request.query.substring(0, 100));

        const { maxRetries } = this.retryConfig;
        // Use longer timeout for multi-provider search (3 minutes)
        const searchTimeout = 180000;
        let lastError: unknown = null;
        let lastStatusCode: number | undefined;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.debug(`[GraphApiService] AI Search attempt ${attempt}/${maxRetries}`);

                const response = await this.fetchWithTimeout(
                    `${this.baseUrl}/api/bot-aggregator/ai-search`,
                    {
                        method: 'POST',
                        headers: this.getHeaders(),
                        mode: 'cors',
                        credentials: 'omit',
                        body: JSON.stringify(request)
                    },
                    searchTimeout,
                    signal
                );

                // Handle non-OK responses
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`[GraphApiService] AI Search error (attempt ${attempt}/${maxRetries}):`, response.status, errorText);
                    lastStatusCode = response.status;

                    // Non-retryable client errors (4xx except 429)
                    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                        if (response.status === 401 || response.status === 403) {
                            throw new Error('Authentication failed. Please check your API key in Settings.');
                        }
                        if (response.status === 404) {
                            throw new Error('Digital Footprint endpoint not found. Please check your API configuration.');
                        }
                        throw new Error(`API error (${response.status}): ${errorText}`);
                    }

                    // Retryable errors (5xx, 429)
                    lastError = new Error(`HTTP ${response.status}: ${errorText}`);

                    if (attempt < maxRetries) {
                        const delayMs = this.calculateBackoffDelay(attempt);
                        const reason = this.getErrorReason(lastError, response.status);
                        console.debug(`[GraphApiService] AI Search retrying in ${Math.round(delayMs)}ms (reason: ${reason})...`);

                        if (onRetry) {
                            onRetry(attempt, maxRetries, reason, delayMs);
                        }

                        await new Promise(resolve => setTimeout(resolve, delayMs));
                        continue;
                    }
                } else {
                    // Success!
                    const result = await response.json() as AISearchResponse;
                    console.debug('[GraphApiService] AI Search successful:', result.total_results, 'results');
                    return result;
                }
            } catch (error) {
                console.error(`[GraphApiService] AI Search failed (attempt ${attempt}/${maxRetries}):`, error);
                lastError = error;

                // Don't retry non-retryable errors
                if (error instanceof Error && (
                    error.message.includes('Authentication') ||
                    error.message.includes('API key') ||
                    error.message.includes('endpoint not found')
                )) {
                    throw error;
                }

                // Check if error is retryable
                if (this.isRetryableError(error) && attempt < maxRetries) {
                    const delayMs = this.calculateBackoffDelay(attempt);
                    const reason = this.getErrorReason(error, lastStatusCode);
                    console.debug(`[GraphApiService] AI Search ${reason} error, retrying in ${Math.round(delayMs)}ms...`);

                    if (onRetry) {
                        onRetry(attempt, maxRetries, reason, delayMs);
                    }

                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }
            }
        }

        // All retries exhausted
        const errorMessage = this.getErrorMessage(lastError, lastStatusCode);
        console.error('[GraphApiService] AI Search all retries exhausted:', errorMessage);

        if (this.isTimeoutError(lastError)) {
            throw new Error('Search timed out. Try reducing the number of providers or simplifying your query.');
        } else if (lastStatusCode === 503) {
            throw new Error('Digital Footprint service is temporarily unavailable. Please try again later.');
        } else if (lastStatusCode === 504) {
            throw new Error('Search timed out. Try reducing the number of providers.');
        }

        throw new Error(`Digital Footprint failed after ${maxRetries} attempts: ${errorMessage}`);
    }
}

// Alias for backward compatibility with ai-panel.ts
export { GraphApiService as ApiService };
