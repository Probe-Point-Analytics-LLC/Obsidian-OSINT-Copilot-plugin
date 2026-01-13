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
import { Entity, ProcessTextResponse } from '../entities/types';

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
    results: Record<string, any>[];
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
    maxRetries: 7,              // Increased from 3 to 7 for better resilience
    baseDelayMs: 1000,          // Start with 1 second delay
    maxDelayMs: 32000,          // Cap at 32 seconds max delay
    baseTimeoutMs: 45000,       // 45 second base timeout (increased from 30s)
    maxTimeoutMs: 120000,       // 2 minute max timeout for slow connections
    timeoutMultiplierOnTimeout: 1.5  // Increase timeout by 50% after timeout error
};

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

    constructor(baseUrl: string = 'https://api.osint-copilot.com', apiKey: string = '') {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.retryConfig = { ...DEFAULT_RETRY_CONFIG };
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
            console.log('[GraphApiService] AI API unavailable - graph generation from text will not work');
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
        json: () => Promise<any>;
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
        timeoutMs: number = 30000
    ): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }> {
        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                const error = new DOMException('Request timed out', 'AbortError');
                reject(error);
            }, timeoutMs);
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
        onRetry?: RetryCallback
    ): Promise<ProcessTextResponse> {
        // First, try to connect if we haven't checked yet
        if (!this.isOnline) {
            await this.checkHealth();
        }

        if (!this.isOnline) {
            return {
                success: false,
                error: 'AI API is offline. Graph generation from text is not available.\n\nYou can still:\n• Create entities manually using the Graph View\n• Edit existing entities\n• Create connections between entities\n• View entities on the map'
            };
        }

        console.log('[GraphApiService] Processing text with AI:', text.substring(0, 100) + '...');

        const { maxRetries, baseTimeoutMs } = this.retryConfig;
        let currentTimeout = baseTimeoutMs;
        let lastError: unknown = null;
        let lastStatusCode: number | undefined;
        let hadTimeoutError = false;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Increase timeout if we had a timeout error on previous attempt
                if (hadTimeoutError) {
                    currentTimeout = this.calculateTimeout(currentTimeout, true);
                    console.log(`[GraphApiService] Increased timeout to ${currentTimeout}ms after timeout error`);
                }

                console.log(`[GraphApiService] Attempt ${attempt}/${maxRetries} with ${currentTimeout}ms timeout`);

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
                    currentTimeout
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
                        console.log(`[GraphApiService] Retrying in ${Math.round(delayMs)}ms (reason: ${reason})...`);

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
                    console.log('[GraphApiService] AI processing successful:', result);
                    return result;
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
                    console.log(`[GraphApiService] ${reason} error, retrying in ${Math.round(delayMs)}ms...`);

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
        onRetry?: RetryCallback
    ): Promise<AISearchResponse> {
        // First, try to connect if we haven't checked yet
        if (!this.isOnline) {
            await this.checkHealth();
        }

        if (!this.apiKey) {
            throw new Error('License key required for Leak Search. Configure in Settings → OSINT Copilot → API Key.');
        }

        console.log('[GraphApiService] AI Search request:', request.query.substring(0, 100));

        const { maxRetries } = this.retryConfig;
        // Use longer timeout for multi-provider search (3 minutes)
        const searchTimeout = 180000;
        let lastError: unknown = null;
        let lastStatusCode: number | undefined;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[GraphApiService] AI Search attempt ${attempt}/${maxRetries}`);

                const response = await this.fetchWithTimeout(
                    `${this.baseUrl}/api/bot-aggregator/ai-search`,
                    {
                        method: 'POST',
                        headers: this.getHeaders(),
                        mode: 'cors',
                        credentials: 'omit',
                        body: JSON.stringify(request)
                    },
                    searchTimeout
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
                            throw new Error('Leak Search endpoint not found. Please check your API configuration.');
                        }
                        throw new Error(`API error (${response.status}): ${errorText}`);
                    }

                    // Retryable errors (5xx, 429)
                    lastError = new Error(`HTTP ${response.status}: ${errorText}`);

                    if (attempt < maxRetries) {
                        const delayMs = this.calculateBackoffDelay(attempt);
                        const reason = this.getErrorReason(lastError, response.status);
                        console.log(`[GraphApiService] AI Search retrying in ${Math.round(delayMs)}ms (reason: ${reason})...`);

                        if (onRetry) {
                            onRetry(attempt, maxRetries, reason, delayMs);
                        }

                        await new Promise(resolve => setTimeout(resolve, delayMs));
                        continue;
                    }
                } else {
                    // Success!
                    const result: AISearchResponse = await response.json();
                    console.log('[GraphApiService] AI Search successful:', result.total_results, 'results');
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
                    console.log(`[GraphApiService] AI Search ${reason} error, retrying in ${Math.round(delayMs)}ms...`);

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
            throw new Error('Leak Search service is temporarily unavailable. Please try again later.');
        } else if (lastStatusCode === 504) {
            throw new Error('Search timed out. Try reducing the number of providers.');
        }

        throw new Error(`Leak Search failed after ${maxRetries} attempts: ${errorMessage}`);
    }
}

// Alias for backward compatibility with ai-panel.ts
export { GraphApiService as ApiService };
