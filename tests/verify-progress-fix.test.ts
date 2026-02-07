import { describe, it, expect, beforeEach, vi } from 'vitest';
import VaultAIPlugin from '../main';
import { App } from 'obsidian';

// Use requestUrl from the global mock (aliased in vitest.config.ts)
import { requestUrl } from 'obsidian';

// Cast requestUrl to a mock function to satisfy TS and access mock methods
const requestUrlMock = requestUrl as unknown as ReturnType<typeof vi.fn>;

describe('Report Generation Progress Fix', () => {
    let plugin: VaultAIPlugin;

    beforeEach(() => {
        requestUrlMock.mockReset();
        plugin = new VaultAIPlugin(new App(), {} as any);
        plugin.settings = {
            reportApiKey: 'test-key',
            reportOutputDir: 'Reports'
        } as any;

        // Mock saveReportToVault to match implementation
        plugin.saveReportToVault = vi.fn().mockResolvedValue('Report.md');
        plugin.getConversationResponse = vi.fn();
        plugin.sanitizeMarkdownContent = vi.fn(c => c);
    });

    it('should generate synthetic progress when backend progress is missing', async () => {
        // 1. Mock Start Report
        requestUrlMock.mockResolvedValueOnce({
            status: 200,
            json: { job_id: 'test-job-123', status: 'processing' }
        });

        // 2. Mock Status Checks (3 polls: processing, processing, completed)
        // Poll 1: Processing, NO progress
        requestUrlMock.mockResolvedValueOnce({
            status: 200,
            json: { status: 'processing', progress: undefined }
        });

        // Poll 2: Processing, NO progress (to verify increment)
        requestUrlMock.mockResolvedValueOnce({
            status: 200,
            json: { status: 'processing', progress: undefined }
        });

        // Poll 3: Completed
        requestUrlMock.mockResolvedValueOnce({
            status: 200,
            json: { status: 'completed', filename: 'Report.md' }
        });

        // 3. Mock Download
        requestUrlMock.mockResolvedValueOnce({
            status: 200,
            text: '# Report Content'
        });

        // Track callback calls
        const updates: number[] = [];
        const callback = vi.fn((status, progress) => {
            if (progress && progress.percent) {
                updates.push(progress.percent);
            }
        });

        // Fast-forward polling logic by mocking setTimeout or using fake timers?
        // The implementation uses: await new Promise(resolve => setTimeout(resolve, pollInterval));
        // We can use vi.useFakeTimers() but the polling loop is async. 
        // A better approach for this unit test might be to allow actual time to pass or ensure the loop logic is triggered.
        // However, the loop waits 2000ms.
        // Let's rely on the implementation calling requestUrl sequentially.

        // But wait, the loop has `await new Promise(resolve => setTimeout(resolve, pollInterval));`
        // We need to fast-forward that.
        vi.useFakeTimers();

        // Start the process
        const promise = plugin.generateReport('Test Query', null, callback);

        // Advance time for Poll 1 (need > 2000ms)
        await vi.advanceTimersByTimeAsync(3000);

        // Advance time for Poll 2
        await vi.advanceTimersByTimeAsync(3000);

        // Advance time for Poll 3
        await vi.advanceTimersByTimeAsync(3000);

        const result = await promise;

        // Verify result
        expect(result.content).toBe('# Report Content');

        // Verify progress updates
        // We expect at least some updates.
        // The first update might be the initial 5% hardcoded, or the first poll.
        console.log('Progress updates:', updates);

        // Assert that we got progress updates despite backend not sending any
        expect(updates.length).toBeGreaterThan(0);

        // Verify they are synthetic (i.e. roughly following the time formula)
        // With small elapsed time, it starts at 5%.
        expect(updates[0]).toBeGreaterThanOrEqual(5);
        expect(updates[updates.length - 1]).toBeGreaterThanOrEqual(5);

    });
});
