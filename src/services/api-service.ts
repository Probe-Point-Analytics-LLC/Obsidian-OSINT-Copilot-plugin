/**
 * API Service for AI-powered entity extraction.
 *
 * HYBRID ARCHITECTURE:
 * - This service ONLY handles AI entity generation from text (requires API)
 * - All other features (entity CRUD, connections, graph, map) work locally
 * - Uses local API at http://localhost:5000 by default for development
 * - Can be configured to use remote API for production
 */

import { Entity, ProcessTextResponse } from '../entities/types';

export interface ApiHealthResponse {
    status: string;
    openai_configured: boolean;
    version?: string;
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
     */
    async checkHealth(): Promise<ApiHealthResponse | null> {
        try {
            // Try the health endpoint first
            const response = await fetch(`${this.baseUrl}/health`, {
                method: 'GET',
                headers: this.getHeaders(),
                mode: 'cors',
                credentials: 'omit'
            });

            if (response.ok) {
                this.isOnline = true;
                return await response.json();
            }

            // Fallback: try root endpoint
            const rootResponse = await fetch(`${this.baseUrl}/`, {
                method: 'GET',
                headers: this.getHeaders(),
                mode: 'cors',
                credentials: 'omit'
            });

            if (rootResponse.ok) {
                this.isOnline = true;
                return await rootResponse.json();
            }

            this.isOnline = false;
            return null;
        } catch (error) {
            this.isOnline = false;
            console.log('[GraphApiService] AI API unavailable - entity generation from text will not work');
            return null;
        }
    }

    /**
     * Get the current online status.
     * Note: This only affects AI entity generation. All other features work offline.
     */
    getOnlineStatus(): boolean {
        return this.isOnline;
    }

    /**
     * Helper to create a fetch request with timeout.
     */
    private async fetchWithTimeout(
        url: string,
        options: RequestInit,
        timeoutMs: number = 30000
    ): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            return response;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Determine if an error is a timeout error.
     */
    private isTimeoutError(error: unknown): boolean {
        return error instanceof DOMException && error.name === 'AbortError';
    }

    /**
     * Determine if an error is a network connectivity error.
     */
    private isNetworkError(error: unknown): boolean {
        if (error instanceof TypeError) {
            const errorStr = String(error).toLowerCase();
            return errorStr.includes('failed to fetch') ||
                   errorStr.includes('network') ||
                   errorStr.includes('connection');
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
            return 'Request timed out. The server may be busy or your connection is slow.';
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
                return 'Gateway timeout. The server took too long to respond.';
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
                error: 'AI API is offline. Entity generation from text is not available.\n\nYou can still:\n• Create entities manually using the Graph View\n• Edit existing entities\n• Create connections between entities\n• View entities on the map'
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
        let helpMessage = '💡 This may be a temporary network issue. Please try again in a moment.';
        if (this.isTimeoutError(lastError)) {
            helpMessage = '💡 The request timed out. Try again when your connection is more stable, or the server may be under heavy load.';
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
}

// Alias for backward compatibility with ai-panel.ts
export { GraphApiService as ApiService };
