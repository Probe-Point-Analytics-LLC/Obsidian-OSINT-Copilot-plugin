/**
 * Geocoding Service - Converts addresses to latitude/longitude coordinates
 * Uses Nominatim (OpenStreetMap) API - free, no API key required
 */

import { requestUrl, RequestUrlResponse } from 'obsidian';

/**
 * Result from a geocoding request
 */
export interface GeocodingResult {
    latitude: number;
    longitude: number;
    displayName: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    confidence: 'high' | 'medium' | 'low';
}

/**
 * Error types for geocoding failures
 */
export enum GeocodingErrorType {
    NetworkError = 'NETWORK_ERROR',
    NotFound = 'NOT_FOUND',
    RateLimited = 'RATE_LIMITED',
    InvalidInput = 'INVALID_INPUT',
    Unknown = 'UNKNOWN'
}

/**
 * Custom error class for geocoding failures
 */
export class GeocodingError extends Error {
    constructor(
        public readonly type: GeocodingErrorType,
        message: string
    ) {
        super(message);
        this.name = 'GeocodingError';
    }
}

/**
 * Nominatim API response structure
 */
interface NominatimResult {
    lat: string;
    lon: string;
    display_name: string;
    importance: number;
    address?: {
        house_number?: string;
        road?: string;
        city?: string;
        town?: string;
        village?: string;
        municipality?: string;
        state?: string;
        country?: string;
        postcode?: string;
    };
}

/**
 * Callback for retry status updates
 */
export type RetryStatusCallback = (attempt: number, maxAttempts: number, delaySeconds: number) => void;

/**
 * Geocoding service using Nominatim (OpenStreetMap)
 *
 * Usage Policy:
 * - Maximum 1 request per second
 * - Must include valid User-Agent
 * - Free for reasonable usage
 *
 * @see https://nominatim.org/release-docs/latest/api/Search/
 */
export class GeocodingService {
    private static readonly NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
    private static readonly USER_AGENT = 'OSINTCopilot-Obsidian-Plugin/1.0 (https://github.com/Probe-Point-Analytics-LLC/OSINT-Copilot-plugin)';
    private static readonly REQUEST_TIMEOUT = 10000; // 10 seconds

    // Rate limiting: track last request time
    private lastRequestTime: number = 0;
    private static readonly MIN_REQUEST_INTERVAL = 1100; // 1.1 seconds between requests

    // Retry configuration
    private static readonly MAX_RETRIES = 5;
    private static readonly INITIAL_RETRY_DELAY = 1000; // 1 second

    /**
     * Geocode an address with automatic retry on network errors and graceful fallback.
     * This is the main public method that should be used for geocoding.
     *
     * Features:
     * - Automatic retry with exponential backoff on network errors
     * - Graceful fallback: if full address fails, tries progressively simpler queries
     * - Handles special characters and various address formats
     *
     * @param address - Street address (e.g., "123 Main Street")
     * @param city - City name (optional)
     * @param state - State/province (optional)
     * @param country - Country name (optional)
     * @param onRetry - Optional callback for retry status updates
     * @returns GeocodingResult with coordinates and address details
     * @throws GeocodingError on failure after all retries and fallbacks
     */
    async geocodeAddressWithRetry(
        address?: string,
        city?: string,
        state?: string,
        country?: string,
        onRetry?: RetryStatusCallback
    ): Promise<GeocodingResult> {
        let lastError: GeocodingError | null = null;

        for (let attempt = 0; attempt < GeocodingService.MAX_RETRIES; attempt++) {
            try {
                // Try with graceful fallback
                return await this.geocodeAddressWithFallback(address, city, state, country);
            } catch (error) {
                if (!(error instanceof GeocodingError)) {
                    // Unknown error, wrap it
                    lastError = new GeocodingError(
                        GeocodingErrorType.Unknown,
                        error instanceof Error ? error.message : String(error)
                    );
                } else {
                    lastError = error;
                }

                // Don't retry on non-network errors (unless it's NotFound, which might succeed with fallback)
                if (lastError.type === GeocodingErrorType.InvalidInput) {
                    throw lastError;
                }

                // If NotFound after fallback, don't retry (fallback already tried simpler queries)
                if (lastError.type === GeocodingErrorType.NotFound && attempt > 0) {
                    throw lastError;
                }

                // Don't retry on last attempt
                if (attempt === GeocodingService.MAX_RETRIES - 1) {
                    break;
                }

                // Calculate exponential backoff delay
                const delayMs = GeocodingService.INITIAL_RETRY_DELAY * Math.pow(2, attempt);
                const delaySeconds = Math.round(delayMs / 1000);

                console.log(`[GeocodingService] Retry attempt ${attempt + 1}/${GeocodingService.MAX_RETRIES} after ${delaySeconds}s`);

                // Notify caller of retry
                if (onRetry) {
                    onRetry(attempt + 1, GeocodingService.MAX_RETRIES, delaySeconds);
                }

                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        // All retries exhausted
        throw new GeocodingError(
            GeocodingErrorType.NetworkError,
            `Failed to geocode after ${GeocodingService.MAX_RETRIES} attempts. Please check your internet connection.`
        );
    }

    /**
     * Geocode with graceful fallback - tries progressively simpler queries if full address fails.
     * This helps with addresses that have special characters, unusual formats, or limited coverage.
     *
     * Fallback strategy:
     * 1. Try full address: "str. Şevcenco, nr. 81/11, Tiraspol, Moldova"
     * 2. Try without building number: "str. Şevcenco, Tiraspol, Moldova"
     * 3. Try just street and city: "Şevcenco, Tiraspol, Moldova"
     * 4. Try city and country: "Tiraspol, Moldova"
     * 5. Try just city: "Tiraspol"
     *
     * @param address - Street address
     * @param city - City name
     * @param state - State/province
     * @param country - Country name
     * @returns GeocodingResult with coordinates
     * @throws GeocodingError if all fallback attempts fail
     */
    private async geocodeAddressWithFallback(
        address?: string,
        city?: string,
        state?: string,
        country?: string
    ): Promise<GeocodingResult> {
        const fallbackQueries: Array<{components: string[], description: string}> = [];

        // Build fallback query list
        if (address && city && country) {
            // Full address
            fallbackQueries.push({
                components: [address, city, state, country].filter((c): c is string => Boolean(c)),
                description: 'full address'
            });

            // Without building number (remove "nr. XX" pattern)
            const addressWithoutNumber = address.replace(/,?\s*nr\.?\s*\d+[\/\d]*/gi, '').trim();
            if (addressWithoutNumber !== address) {
                fallbackQueries.push({
                    components: [addressWithoutNumber, city, state, country].filter((c): c is string => Boolean(c)),
                    description: 'address without building number'
                });
            }

            // Just street name and city (remove "str." prefix)
            const streetName = address.replace(/^str\.?\s*/i, '').replace(/,?\s*nr\.?\s*\d+[\/\d]*/gi, '').trim();
            if (streetName !== address) {
                fallbackQueries.push({
                    components: [streetName, city, state, country].filter((c): c is string => Boolean(c)),
                    description: 'street name and city'
                });
            }
        }

        // City and country
        if (city && country) {
            fallbackQueries.push({
                components: [city, state, country].filter((c): c is string => Boolean(c)),
                description: 'city and country'
            });
        }

        // Just city
        if (city) {
            fallbackQueries.push({
                components: [city],
                description: 'city only'
            });
        }

        // If no fallback queries were built, use original components
        if (fallbackQueries.length === 0) {
            fallbackQueries.push({
                components: [address, city, state, country].filter((c): c is string => Boolean(c)),
                description: 'original query'
            });
        }

        let lastError: GeocodingError | null = null;

        // Try each fallback query
        for (const query of fallbackQueries) {
            try {
                console.log(`[GeocodingService] Trying ${query.description}: ${query.components.join(', ')}`);

                const result = await this.geocodeAddress(
                    query.components[0],
                    query.components[1],
                    query.components[2],
                    query.components[3]
                );

                // Success! Log which fallback worked
                if (query.description !== 'full address' && query.description !== 'original query') {
                    console.log(`[GeocodingService] ✓ Geocoded using ${query.description} fallback`);
                }

                return result;
            } catch (error) {
                if (error instanceof GeocodingError) {
                    lastError = error;

                    // If it's a network error, don't try other fallbacks (they'll fail too)
                    if (error.type === GeocodingErrorType.NetworkError ||
                        error.type === GeocodingErrorType.RateLimited) {
                        throw error;
                    }

                    // NotFound is expected for some fallback attempts, continue to next
                    console.log(`[GeocodingService] ${query.description} not found, trying next fallback...`);
                } else {
                    throw error;
                }
            }
        }

        // All fallbacks failed
        throw lastError || new GeocodingError(
            GeocodingErrorType.NotFound,
            'Address not found. Please check the address or enter coordinates manually.'
        );
    }

    /**
     * Geocode an address to latitude/longitude coordinates (internal method).
     * Use geocodeAddressWithRetry() for automatic retry on network errors.
     *
     * @param address - Street address (e.g., "123 Main Street")
     * @param city - City name (optional)
     * @param state - State/province (optional)
     * @param country - Country name (optional)
     * @returns GeocodingResult with coordinates and address details
     * @throws GeocodingError on failure
     */
    private async geocodeAddress(
        address?: string,
        city?: string,
        state?: string,
        country?: string
    ): Promise<GeocodingResult> {
        // Validate input
        const queryParts = [address, city, state, country].filter(Boolean);
        if (queryParts.length === 0) {
            throw new GeocodingError(
                GeocodingErrorType.InvalidInput,
                'Please provide at least an address, city, or country'
            );
        }

        // Rate limiting: wait if needed
        await this.enforceRateLimit();

        const query = queryParts.join(', ');
        console.log('[GeocodingService] Geocoding address:', query);

        try {
            const url = `${GeocodingService.NOMINATIM_URL}?` + new URLSearchParams({
                q: query,
                format: 'json',
                limit: '1',
                addressdetails: '1'
            }).toString();

            // Use Obsidian's requestUrl which handles CSP properly
            const response: RequestUrlResponse = await requestUrl({
                url,
                method: 'GET',
                headers: {
                    'User-Agent': GeocodingService.USER_AGENT,
                    'Accept': 'application/json'
                },
                throw: false // Don't throw on non-2xx status
            });

            this.lastRequestTime = Date.now();

            // Handle rate limiting
            if (response.status === 429) {
                throw new GeocodingError(
                    GeocodingErrorType.RateLimited,
                    'Too many requests. Please wait a moment and try again.'
                );
            }

            // Handle other errors
            if (response.status !== 200) {
                throw new GeocodingError(
                    GeocodingErrorType.NetworkError,
                    `Geocoding request failed with status ${response.status}`
                );
            }

            const results: NominatimResult[] = response.json;

            if (!results || results.length === 0) {
                throw new GeocodingError(
                    GeocodingErrorType.NotFound,
                    'Address not found. Please check the address or enter coordinates manually.'
                );
            }

            const result = results[0];
            console.log('[GeocodingService] Geocoding result:', result);

            // Determine confidence based on importance score
            let confidence: 'high' | 'medium' | 'low' = 'medium';
            if (result.importance > 0.7) {
                confidence = 'high';
            } else if (result.importance < 0.3) {
                confidence = 'low';
            }

            // Extract city from various possible fields
            const cityName = result.address?.city 
                || result.address?.town 
                || result.address?.village 
                || result.address?.municipality;

            return {
                latitude: parseFloat(result.lat),
                longitude: parseFloat(result.lon),
                displayName: result.display_name,
                city: cityName,
                state: result.address?.state,
                country: result.address?.country,
                postalCode: result.address?.postcode,
                confidence
            };

        } catch (error) {
            // Re-throw GeocodingErrors as-is
            if (error instanceof GeocodingError) {
                throw error;
            }

            // Handle network errors
            console.error('[GeocodingService] Geocoding error:', error);
            throw new GeocodingError(
                GeocodingErrorType.NetworkError,
                'Failed to connect to geocoding service. Please check your internet connection.'
            );
        }
    }

    /**
     * Enforce rate limiting by waiting if necessary
     */
    private async enforceRateLimit(): Promise<void> {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < GeocodingService.MIN_REQUEST_INTERVAL) {
            const waitTime = GeocodingService.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
            console.log(`[GeocodingService] Rate limiting: waiting ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    /**
     * Validate coordinates are within valid ranges
     */
    static validateCoordinates(lat: number, lng: number): boolean {
        return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }

    /**
     * Format coordinates for display
     */
    static formatCoordinates(lat: number, lng: number, precision: number = 6): string {
        return `${lat.toFixed(precision)}, ${lng.toFixed(precision)}`;
    }
}

// Export a singleton instance for convenience
export const geocodingService = new GeocodingService();

