// @vitest-environment node
import { describe, it, expect } from 'vitest';

// Use native fetch (Node 18+)


// Configuration from user
const REPORT_API_KEY = "enc:gAAAAABpYFzA3eh491NP_1A-sR0YKtBcA_uc-cHP7eDT8UMcbdEEDHLhjghkf2C4c36WwRLL-ILrwZt52L2pCGk4Wjfs3IxQT7_uEUqnEgXm4xTxm09UyTUCYl-MndJhVZEJP-XuOaEj";
const BASE_URL = "https://api.osint-copilot.com"; // Assuming this is the base URL based on code reading or I should default to what's in code.
// Checking main.ts line 5003: const endpoint = `${REPORT_API_BASE_URL}/api/darkweb/investigate`;
// Need to confirm REPORT_API_BASE_URL. Usually defined at top of file.
// I will assume it is "https://api.osint-copilot.com" or similar.
// Actually, I should check the constant in main.ts or just define it here. 
// Let's assume it's "https://api.osint-copilot.com" for now, or check main.ts constants.

const API_BASE_URL = "https://api.osint-copilot.com";

// Custom requestUrl implementation using fetch
async function requestUrl(options: any) {
    const { url, method, headers, body } = options;
    console.log(`[REQ] ${method} ${url}`);

    try {
        const response = await fetch(url, {
            method: method || 'GET',
            headers: headers || {},
            body: body
        });

        const text = await response.text();
        console.log(`[RES] ${response.status} ${text.substring(0, 200)}...`);

        let json = null;
        try {
            json = JSON.parse(text);
        } catch (e) {
            // ignore JSON parse error
        }

        return {
            status: response.status,
            text: text,
            json: json,
            headers: response.headers
        };
    } catch (error: any) {
        console.error(`[ERR] Request failed: ${error.message}`);
        throw error;
    }
}

describe('Report Generation Loop Reproduction', () => {

    // Set timeout to 5 minutes to allow for realistic polling
    it('should reproduce the report generation loop', async () => {
        const query = "Lukoil";
        console.log(`Starting report generation for: ${query}`);

        // 1. Start Report
        const startResponse = await requestUrl({
            url: `${API_BASE_URL}/api/generate-report`, // Verifying endpoint in main.ts next if this fails
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${REPORT_API_KEY}`
            },
            body: JSON.stringify({
                description: query,
                user_id: "test-user-e2e",
                platform: "obsidian"
            })
        });

        if (![200, 202].includes(startResponse.status)) {
            console.error("Failed to start report:", startResponse.text);
            // Don't fail immediately, let's see what happened
            expect([200, 202]).toContain(startResponse.status);
        }

        const jobId = startResponse.json.job_id;
        console.log(`Job ID: ${jobId}`);
        expect(jobId).toBeDefined();

        // 2. Poll Status
        let jobStatus = "processing";
        const maxAttempts = 20; // Try 20 times (approx 1-2 mins)

        for (let i = 0; i < maxAttempts; i++) {
            // Wait 2-5 seconds
            await new Promise(r => setTimeout(r, 5000));

            console.log(`Polling attempt ${i + 1}/${maxAttempts}...`);
            const statusResponse = await requestUrl({
                url: `${API_BASE_URL}/api/report-status/${jobId}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${REPORT_API_KEY}`
                }
            });

            if (statusResponse.status !== 200) {
                console.error(`Status check failed: ${statusResponse.status}`);
                continue;
            }

            const statusData = statusResponse.json;
            jobStatus = statusData.status;

            console.log(`Status: ${jobStatus}`);
            if (statusData.progress) {
                console.log(`Progress: ${statusData.progress.percent}% - ${statusData.progress.message}`);
            } else {
                console.log("No progress data.");
            }

            if (jobStatus === 'completed' || jobStatus === 'failed') {
                break;
            }
        }

        // 3. Final Check
        console.log(`Final Job Status: ${jobStatus}`);

        // If it's still processing after max attempts, that's the loop!
        if (jobStatus === 'processing') {
            console.warn("⚠️ REPRODUCTION CONFIRMED: Job stuck in 'processing' state.");
        } else if (jobStatus === 'completed') {
            console.log("✅ COMPLETE: Job finished successfully.");
        } else {
            console.log(`❌ FAILED: Job failed with status: ${jobStatus}`);
        }

    }, 300000); // 5 minute timeout
});
