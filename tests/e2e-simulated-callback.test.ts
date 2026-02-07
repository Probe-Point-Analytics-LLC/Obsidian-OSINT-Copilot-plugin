// @vitest-environment node
import { describe, it, expect } from 'vitest';

// Configuration
const REPORT_API_KEY = "enc:gAAAAABpYFzA3eh491NP_1A-sR0YKtBcA_uc-cHP7eDT8UMcbdEEDHLhjghkf2C4c36WwRLL-ILrwZt52L2pCGk4Wjfs3IxQT7_uEUqnEgXm4xTxm09UyTUCYl-MndJhVZEJP-XuOaEj";
const API_BASE_URL = "https://api.osint-copilot.com";

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
        // Log short preview of response
        console.log(`[RES] ${response.status} ${text.substring(0, 150)}...`);

        let json = null;
        try {
            json = JSON.parse(text);
        } catch (e) {
            // ignore
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

describe('Simulated E2E Report Generation', () => {

    it('should generate report, simulate callback, and download', async () => {
        const query = "Simulated Callback Test " + Date.now();
        console.log(`Starting simulated report generation for: ${query}`);

        // 1. Start Report
        const startResponse = await requestUrl({
            url: `${API_BASE_URL}/api/generate-report`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${REPORT_API_KEY}`
            },
            body: JSON.stringify({
                description: query,
                platform: "obsidian-e2e-sim"
            })
        });

        expect(startResponse.status).toBe(200);
        const jobId = startResponse.json.job_id;
        expect(jobId).toBeDefined();
        console.log(`Job ID: ${jobId}`);

        // 2. Poll Initial Status (Verify it's processing)
        const initStatus = await requestUrl({
            url: `${API_BASE_URL}/api/report-status/${jobId}`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${REPORT_API_KEY}` }
        });
        expect(initStatus.json.status).toBe('processing');

        // 3. SIMULATE CALLBACK (The Fix Verification)
        // We act as the n8n workflow here because the real n8n can't reach the internal report-api
        console.log("Simulating n8n callback...");
        const callbackResponse = await requestUrl({
            url: `${API_BASE_URL}/api/report-callback`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${REPORT_API_KEY}`
            },
            body: JSON.stringify({
                job_id: jobId,
                status: 'completed',
                result: '# Simulated Report\nThis report was generated via E2E simulation to verify the full flow.',
                report_content: '# Simulated Report\nThis report was generated via E2E simulation to verify the full flow.'
            })
        });
        expect(callbackResponse.status).toBe(200);

        // 4. Poll and Expect Completion (Should be immediate now)
        let jobStatus = "processing";
        const maxAttempts = 10;

        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 1000));

            const statusResponse = await requestUrl({
                url: `${API_BASE_URL}/api/report-status/${jobId}`,
                method: 'GET',
                headers: { 'Authorization': `Bearer ${REPORT_API_KEY}` }
            });

            const statusData = statusResponse.json;
            jobStatus = statusData.status;
            console.log(`Status: ${jobStatus}`);

            if (jobStatus === 'completed') break;
        }

        expect(jobStatus).toBe('completed');

        // 5. Download Report
        console.log("Downloading report...");
        const downloadResponse = await requestUrl({
            url: `${API_BASE_URL}/api/download-report/${jobId}`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${REPORT_API_KEY}` }
        });

        expect(downloadResponse.status).toBe(200);
        expect(downloadResponse.text).toContain('# Simulated Report');
        console.log("Report downloaded successfully!");

    }, 30000);
});
