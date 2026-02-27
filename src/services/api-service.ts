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
import { Entity, ProcessTextResponse, getEntityLabel } from '../entities/types';

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
    country?: 'RU' | 'UA' | 'BY' | 'KZ';
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
    baseTimeoutMs: 90000,       // 90 second timeout - MUST be under Cloudflare's 100s limit
    maxTimeoutMs: 90000,        // 90 second max - stay under Cloudflare limit
    timeoutMultiplierOnTimeout: 1.0  // Don't increase timeout (Cloudflare caps at 100s)
};

// Local interface to avoid circular dependency with main.ts
export interface ApiSettings {
    apiProvider: 'default' | 'openai';
    customApiUrl: string;
    customApiKey: string;
    customModel: string;
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

    constructor(baseUrl: string = 'https://api.osint-copilot.com', apiKey: string = '') {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.retryConfig = { ...DEFAULT_RETRY_CONFIG };
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
        // If using custom API, check that instead
        if (this.settings?.apiProvider === 'openai') {
            try {
                // Determine health check URL (some providers support /health, others may need a simple completion)
                // For now, we'll try a fast call to /models or just assume online if URL is reachable
                const response = await requestUrl({
                    url: this.settings.customApiUrl.replace(/\/v1\/?$/, '') + '/v1/models',
                    method: 'GET',
                    headers: this.settings.customApiKey ? { 'Authorization': `Bearer ${this.settings.customApiKey}` } : {},
                    throw: false
                });

                if (response.status >= 200 && response.status < 300) {
                    this.isOnline = true;
                    return { status: 'ok', openai_configured: true, version: 'custom' };
                }
                // Fallback: assume online if we didn't get a connection error
                this.isOnline = true;
                return { status: 'ok', openai_configured: true };
            } catch (e) {
                console.debug('[GraphApiService] Custom API unavailable:', e);
                this.isOnline = false;
                return null;
            }
        }

        try {
            // Try the health endpoint first using Obsidian's requestUrl (bypasses CORS)
            const response: RequestUrlResponse = await requestUrl({
                url: `${this.baseUrl}/health`,
                method: 'GET',
                headers: this.getHeaders(),
                throw: false // Don't throw on non-2xx status
            });

            if (response.status >= 200 && response.status < 300) {
                this.isOnline = true;
                return response.json;
            }

            // Fallback: try root endpoint
            const rootResponse: RequestUrlResponse = await requestUrl({
                url: `${this.baseUrl}/`,
                method: 'GET',
                headers: this.getHeaders(),
                throw: false
            });

            if (rootResponse.status >= 200 && rootResponse.status < 300) {
                this.isOnline = true;
                return rootResponse.json;
            }

            this.isOnline = false;
            return null;
        } catch (error) {
            this.isOnline = false;
            console.debug('[GraphApiService] AI API unavailable - graph generation from text will not work');
            return null;
        }
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
     * Extract text from a URL via the backend API.
     * Uses Obsidian's requestUrl directly for maximum reliability.
     * Returns full text - chunking happens in processText for large texts.
     */
    async extractTextFromUrl(url: string): Promise<string> {
        console.debug('[GraphApiService] extractTextFromUrl called with:', url);

        try {
            console.debug('[GraphApiService] Making request to:', `${this.baseUrl}/api/extract-text`);

            const response = await requestUrl({
                url: `${this.baseUrl}/api/extract-text`,
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ url }),
                throw: false
            });

            console.debug('[GraphApiService] Response status:', response.status);

            if (response.status < 200 || response.status >= 300) {
                console.error('[GraphApiService] extractTextFromUrl error:', response.status, response.text);
                try {
                    const errorJson = JSON.parse(response.text);
                    throw new Error(errorJson.error || `Server error (${response.status})`);
                } catch {
                    throw new Error(`Server error (${response.status})`);
                }
            }

            const json = response.json as { success?: boolean; text?: string; error?: string };
            console.debug('[GraphApiService] Response json success:', json.success);

            if (json.success && json.text) {
                console.debug('[GraphApiService] Extracted text length:', json.text.length);
                return json.text;
            }

            throw new Error(json.error || 'Failed to extract text from URL');
        } catch (error) {
            console.error('[GraphApiService] extractTextFromUrl exception:', error);
            throw error;
        }
    }

    /**
     * Extract text from a file via the backend API.
     * Supports .md, .txt, .pdf, .docx, .doc
     * Includes retry logic with exponential backoff for timeouts and rate limits.
     */
    async extractTextFromFile(file: File): Promise<string> {
        // Check file size (limit to 10MB to avoid backend issues)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Limit is 10MB.`);
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async () => {
                try {
                    const result = reader.result as string;
                    // result is a data URL like "data:application/pdf;base64,JVBERi0x..."

                    // Skip health check - just try the extraction directly.
                    // If the API is truly unavailable, the retry logic will catch it.
                    // This avoids blocking on health check timeouts.

                    // Retry logic for file extraction
                    const maxRetries = 3;
                    const baseTimeout = 120000; // 120s timeout for file processing
                    let lastError: unknown = null;

                    for (let attempt = 1; attempt <= maxRetries; attempt++) {
                        try {
                            console.debug(`[GraphApiService] File extraction attempt ${attempt}/${maxRetries}: ${file.name}`);

                            const response = await this.fetchWithTimeout(
                                `${this.baseUrl}/api/extract-text`,
                                {
                                    method: 'POST',
                                    headers: this.getHeaders(),
                                    body: JSON.stringify({
                                        filename: file.name,
                                        content_base64: result
                                    })
                                },
                                baseTimeout
                            );

                            if (!response.ok) {
                                const errorText = await response.text();

                                // Handle rate limiting with retry
                                if (response.status === 429 && attempt < maxRetries) {
                                    const delayMs = this.calculateBackoffDelay(attempt);
                                    console.debug(`[GraphApiService] Rate limited, retrying in ${delayMs}ms...`);
                                    await new Promise(r => setTimeout(r, delayMs));
                                    continue;
                                }

                                // Handle 5xx errors with retry
                                if (response.status >= 500 && attempt < maxRetries) {
                                    const delayMs = this.calculateBackoffDelay(attempt);
                                    console.debug(`[GraphApiService] Server error, retrying in ${delayMs}ms...`);
                                    await new Promise(r => setTimeout(r, delayMs));
                                    continue;
                                }

                                try {
                                    const errorJson = JSON.parse(errorText);
                                    throw new Error(errorJson.error || errorText);
                                } catch {
                                    throw new Error(`Server error (${response.status}): ${errorText}`);
                                }
                            }

                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const json = await response.json() as any;
                            if (json.success) {
                                resolve(json.text);
                                return;
                            } else {
                                throw new Error(json.error || 'Failed to extract text');
                            }
                        } catch (error) {
                            lastError = error;

                            // Retry on timeout errors
                            if (this.isTimeoutError(error) && attempt < maxRetries) {
                                const delayMs = this.calculateBackoffDelay(attempt);
                                console.debug(`[GraphApiService] Timeout, retrying in ${delayMs}ms...`);
                                await new Promise(r => setTimeout(r, delayMs));
                                continue;
                            }

                            // Retry on network errors
                            if (this.isNetworkError(error) && attempt < maxRetries) {
                                const delayMs = this.calculateBackoffDelay(attempt);
                                console.debug(`[GraphApiService] Network error, retrying in ${delayMs}ms...`);
                                await new Promise(r => setTimeout(r, delayMs));
                                continue;
                            }

                            throw error;
                        }
                    }

                    // All retries exhausted
                    throw lastError || new Error('Failed to extract text after retries');

                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file'));

            // Read as Data URL (Base64)
            reader.readAsDataURL(file);
        });
    }

    /**
     * Call custom OpenAI-compatible API for chat.
     * outputting natural language response.
     */
    async chatWithCustomProvider(
        text: string,
        systemPrompt?: string,
        settings?: { customApiUrl: string, customApiKey: string, customModel: string, type?: 'openai' | 'mindsdb' },
        signal?: AbortSignal
    ): Promise<string> {
        if (!settings) throw new Error('Custom chat settings not provided');

        const { customApiUrl, customApiKey, customModel, type } = settings;

        // === MindsDB SQL Logic ===
        if (type === 'mindsdb') {
            // For MindsDB, we use the SQL API
            // Ensure URL points to /api/sql/query logic.
            // If user gave a base URL like http://localhost:47334, we append /api/sql/query
            let endpoint = customApiUrl.trim().replace(/\/+$/, '');
            if (!endpoint.endsWith('/api/sql/query')) {
                endpoint = `${endpoint}/api/sql/query`;
            }

            // Escape single quotes for SQL (basic)
            const sanitizedText = text.replace(/'/g, "''");
            // Default query pattern for MindsDB agents
            const query = `SELECT answer FROM ${customModel} WHERE question='${sanitizedText}'`;

            const requestPromise = requestUrl({
                url: endpoint,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(customApiKey ? { 'Authorization': `Bearer ${customApiKey}` } : {})
                },
                body: JSON.stringify({ query }),
                throw: false
            });

            // Handle cancellation
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            const response = await (signal
                ? Promise.race([
                    requestPromise,
                    new Promise<never>((_, reject) => {
                        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                    })
                ])
                : requestPromise);

            if (response.status >= 200 && response.status < 300) {
                try {
                    const data = await response.json;
                    // Format: { type: 'table', data: [['response text']], column_names: ['answer'], ... }
                    if (data.data && Array.isArray(data.data) && data.data.length > 0) {
                        return String(data.data[0][0]);
                    }
                    return "No response from MindsDB agent.";
                } catch (e) {
                    console.error('MindsDB parsing error:', e);
                    throw new Error('Failed to parse MindsDB response');
                }
            } else {
                console.error('MindsDB API Error:', response.status, response.text);
                throw new Error(`MindsDB API Error: ${response.status}`);
            }
        }

        // === Standard OpenAI Logic ===
        const defaultSystemPrompt = `You are a helpful OSINT assistant. Answer the user's questions to the best of your ability.`;
        const actualSystemPrompt = systemPrompt || defaultSystemPrompt;

        // Smart URL handling: if user provided full URL ending in /chat/completions, use it.
        // Otherwise, append /chat/completions to the base URL.
        let endpoint = customApiUrl.trim();
        if (!endpoint.endsWith('/chat/completions')) {
            endpoint = `${endpoint.replace(/\/+$/, '')}/chat/completions`;
        }

        // Check for cancellation before request
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        const requestPromise = requestUrl({
            url: endpoint,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(customApiKey ? { 'Authorization': `Bearer ${customApiKey}` } : {})
            },
            body: JSON.stringify({
                model: customModel,
                messages: [
                    { role: 'system', content: actualSystemPrompt },
                    { role: 'user', content: text }
                ]
            }),
            throw: false
        });

        const response = await (signal
            ? Promise.race([
                requestPromise,
                new Promise<never>((_, reject) => {
                    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                })
            ])
            : requestPromise);

        if (response.status >= 200 && response.status < 300) {
            try {
                const data = await response.json;
                return data.choices[0].message.content;
            } catch (e) {
                console.error('[GraphApiService] Failed to parse custom API response:', e);
                throw new Error('Failed to parse AI response.');
            }
        }

        throw new Error(`Custom API Error: ${response.status} ${await response.text}`);
    }

    /**
     * Split text into chunks, trying to break at paragraph boundaries.
     */
    private splitTextIntoChunks(text: string, chunkSize: number = 8000): string[] {
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
        signal?: AbortSignal
    ): Promise<ProcessTextResponse> {
        const CHUNK_SIZE = 8000;  // Characters per chunk
        const CHUNK_THRESHOLD = 10000;  // Only chunk if text is larger than this

        // For small texts, process directly
        if (text.length <= CHUNK_THRESHOLD) {
            return this.processText(text, existingEntities, referenceTime, onRetry, signal);
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
                const result = await this.processText(chunk, accumulatedEntities, referenceTime, onRetry, signal);

                if (!result.success) {
                    console.warn(`[GraphApiService] Chunk ${chunkNum} failed:`, result.error);
                    // Continue with other chunks instead of failing entirely
                    continue;
                }

                if (result.operations) {
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
                                allOperations.push({
                                    ...op,
                                    entities: dedupedEntities
                                });

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
                        }
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
        signal?: AbortSignal
    ): Promise<ProcessTextResponse> {
        // Skip health check - just try the request directly.
        // If the API is down, the request will fail with a proper timeout error.
        // This prevents blocking on a hanging health check.

        console.debug('[GraphApiService] Processing text with AI:', text.substring(0, 100) + '...');

        const { maxRetries, baseTimeoutMs } = this.retryConfig;
        let currentTimeout = baseTimeoutMs;
        let lastError: unknown = null;
        let lastStatusCode: number | undefined;
        let hadTimeoutError = false;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            try {
                // Increase timeout if we had a timeout error on previous attempt
                if (hadTimeoutError) {
                    currentTimeout = this.calculateTimeout(currentTimeout, true);
                    console.debug(`[GraphApiService] Increased timeout to ${currentTimeout}ms after timeout error`);
                }

                console.debug(`[GraphApiService] Attempt ${attempt}/${maxRetries} with ${currentTimeout}ms timeout`);

                const response = await this.fetchWithTimeout(
                    `${this.baseUrl}/api/process-text`,
                    {
                        method: 'POST',
                        headers: this.getHeaders(),
                        mode: 'cors',
                        credentials: 'omit',
                        body: JSON.stringify({
                            text,
                            existing_entities: existingEntities?.map(e => ({
                                id: e.id,
                                type: e.type,
                                label: e.label,
                                properties: e.properties
                            })),
                            reference_time: referenceTime
                        })
                    },
                    currentTimeout,
                    signal
                );

                // Handle non-OK responses
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`[GraphApiService] API error (attempt ${attempt}/${maxRetries}):`, response.status, errorText);
                    lastStatusCode = response.status;

                    // Non-retryable client errors (4xx except 429)
                    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                        if (response.status === 401 || response.status === 403) {
                            return {
                                success: false,
                                error: 'Authentication required. Please configure your API key in Settings → OSINT Copilot → API Key'
                            };
                        }

                        if (response.status === 404) {
                            return {
                                success: false,
                                error: 'API endpoint not found. Please check that the API server is running and the URL is correct.'
                            };
                        }

                        return {
                            success: false,
                            error: `API error (${response.status}): ${errorText}`
                        };
                    }

                    // Retryable errors (5xx, 429)
                    lastError = new Error(`HTTP ${response.status}: ${errorText}`);

                    if (attempt < maxRetries) {
                        const delayMs = this.calculateBackoffDelay(attempt);
                        const reason = this.getErrorReason(lastError, response.status);
                        console.debug(`[GraphApiService] Retrying in ${Math.round(delayMs)}ms (reason: ${reason})...`);

                        // Notify caller about retry
                        if (onRetry) {
                            onRetry(attempt, maxRetries, reason, delayMs);
                        }

                        await new Promise(resolve => setTimeout(resolve, delayMs));
                        continue;
                    }
                } else {
                    // Success!
                    const result = await response.json();
                    console.debug('[GraphApiService] AI processing successful:', result);
                    return result as ProcessTextResponse;
                }
            } catch (error) {
                console.error(`[GraphApiService] Process text failed (attempt ${attempt}/${maxRetries}):`, error);
                lastError = error;

                // Track timeout errors to increase timeout on next attempt
                if (this.isTimeoutError(error)) {
                    hadTimeoutError = true;
                }

                // Check if error is retryable
                if (this.isRetryableError(error) && attempt < maxRetries) {
                    const delayMs = this.calculateBackoffDelay(attempt);
                    const reason = this.getErrorReason(error, lastStatusCode);
                    console.debug(`[GraphApiService] ${reason} error, retrying in ${Math.round(delayMs)}ms...`);

                    // Notify caller about retry
                    if (onRetry) {
                        onRetry(attempt, maxRetries, reason, delayMs);
                    }

                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }

                // Non-retryable error or max retries reached
                if (!this.isRetryableError(error)) {
                    // Mark as offline only for non-retryable errors
                    this.isOnline = false;
                }
            }
        }

        // All retries exhausted
        const errorMessage = this.getErrorMessage(lastError, lastStatusCode);
        console.error('[GraphApiService] All retries exhausted:', errorMessage);

        // Provide helpful message based on error type
        let helpMessage = '💡 Please wait a moment and try again. This is usually temporary.';
        if (this.isTimeoutError(lastError)) {
            helpMessage = '💡 The server is busy processing requests. Please wait a moment and try again.';
        } else if (this.isNetworkError(lastError)) {
            helpMessage = '💡 Network connection failed. Please check your internet connection and try again.';
        } else if (lastStatusCode && lastStatusCode >= 500) {
            helpMessage = '💡 The server is experiencing issues. Please try again later.';
        }

        return {
            success: false,
            error: `Entity extraction failed after ${maxRetries} attempts: ${errorMessage}\n\n${helpMessage}`,
            // Include the original text so caller can preserve it for retry
            originalText: text
        };
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

    /**
     * Determine user intent from text.
     * Tells the app whether the user wants to generate a graph, search dark web, etc.
     */
    async determineIntent(text: string): Promise<string> {
        try {
            const response = await this.fetchWithTimeout(
                `${this.baseUrl}/api/chat/route`,
                {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify({ text })
                },
                5000 // 5 second timeout for quick routing
            );

            if (response.ok) {
                const data = await response.json() as { intent?: string; success?: boolean; error?: string };
                if (data.success && data.intent) {
                    return data.intent;
                }

                // If it wasn't successful because of auth, throw it so the caller can see
                if (data.error && (data.error.includes('unauthorized') || data.error.includes('API key'))) {
                    throw new Error(data.error);
                }
            }
            return "local_chat";
        } catch (error) {
            console.error("[GraphApiService] Error determining intent:", error);
            // Default to local chat if routing fails
            return "local_chat";
        }
    }
}

// Alias for backward compatibility with ai-panel.ts
export { GraphApiService as ApiService };
