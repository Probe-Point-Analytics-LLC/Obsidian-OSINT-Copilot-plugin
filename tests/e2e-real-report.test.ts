// @vitest-environment node
import { describe, it, expect } from 'vitest';

// Configuration
const REPORT_API_KEY = "guest";
const API_BASE_URL = "http://localhost:5000";

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

describe('Real End-to-End Report Generation', () => {

    // Set timeout to 5 minutes
    it.skipIf(!process.env.RUN_REAL_E2E)('should generate and download a report from production', async () => {
        const query = "E2E Test " + Date.now(); // Unique query
        console.log(`Starting real report generation for: ${query}`);

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
                platform: "obsidian-e2e"
            })
        });

        // Fail if we can't even start the job
        expect(startResponse.status).toBe(200);
        const jobId = startResponse.json.job_id;
        expect(jobId).toBeDefined();
        console.log(`Job ID: ${jobId}`);

        // 2. Poll Status until Completion
        let jobStatus = "processing";
        const maxTime = 300 * 1000; // 5 minutes
        const pollInterval = 5000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxTime) {
            await new Promise(r => setTimeout(r, pollInterval));

            const statusResponse = await requestUrl({
                url: `${API_BASE_URL}/api/report-status/${jobId}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${REPORT_API_KEY}`
                }
            });

            if (statusResponse.status !== 200) {
                console.warn(`Status check failed with ${statusResponse.status}`);
                continue;
            }

            const statusData = statusResponse.json;
            jobStatus = statusData.status;

            if (statusData.progress) {
                console.log(`Progress: ${statusData.progress.percent}% - ${statusData.progress.message}`);
            } else {
                console.log(`Status: ${jobStatus} (No progress data)`);
            }

            if (jobStatus === 'completed' || jobStatus === 'failed') {
                break;
            }
        }

        // 3. Assert Completion
        if (jobStatus !== 'completed') {
            console.error(`Test failed: Job finished with status '${jobStatus}' (expected 'completed')`);
        }
        expect(jobStatus).toBe('completed');

        // 4. Download Report
        console.log("Downloading report...");
        const downloadResponse = await requestUrl({
            url: `${API_BASE_URL}/api/download-report/${jobId}`, // or /md suffix depending on API
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${REPORT_API_KEY}`
            }
        });

        expect(downloadResponse.status).toBe(200);
        expect(downloadResponse.text.length).toBeGreaterThan(0);
        console.log("Report downloaded successfully.");

    }, 310000); // Test timeout slightly larger than loop timeout
});
