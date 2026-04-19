/**
 * Resolves Internet Archive snapshot URLs for http(s) osint_sources in the background.
 */

import { App, TFile, requestUrl } from 'obsidian';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { OsintArchiveStatus } from '../entities/types';

interface QueueJob {
    key: string;
    filePath: string;
    sourceId: string;
    url: string;
}

export class WaybackArchiveService {
    private readonly app: App;
    private pending = new Set<string>();
    private queue: QueueJob[] = [];
    private active = 0;
    private readonly maxConcurrent = 2;

    constructor(app: App) {
        this.app = app;
    }

    /** Scan note frontmatter and queue Wayback lookups for sources missing archive_url. */
    enqueueFromPath(filePath: string): void {
        const f = this.app.vault.getAbstractFileByPath(filePath);
        if (!(f instanceof TFile)) return;

        void this.app.vault.read(f).then((text) => {
            const fm = this.extractFrontmatterRecord(text);
            if (!fm) return;
            const sources = fm.osint_sources;
            if (!Array.isArray(sources)) return;

            for (const raw of sources) {
                if (typeof raw !== 'object' || !raw) continue;
                const s = raw as Record<string, unknown>;
                const id = String(s.id ?? '');
                const url = String(s.source_url ?? '');
                if (s.archive_url) continue;
                if (!id || !url) continue;
                if (!/^https?:\/\//i.test(url)) continue;

                const key = `${filePath}::${id}`;
                if (this.pending.has(key)) continue;
                this.pending.add(key);
                this.queue.push({ key, filePath, sourceId: id, url });
            }
            this.drain();
        });
    }

    private drain(): void {
        while (this.active < this.maxConcurrent && this.queue.length > 0) {
            const job = this.queue.shift()!;
            this.active += 1;
            void this.runJob(job).finally(() => {
                this.active -= 1;
                this.drain();
            });
        }
    }

    private async runJob(job: QueueJob): Promise<void> {
        try {
            const archiveUrl = await this.resolveClosestSnapshot(job.url);
            if (archiveUrl) {
                await this.patchFrontmatter(job.filePath, job.sourceId, archiveUrl, 'resolved');
            } else {
                await this.patchFrontmatter(job.filePath, job.sourceId, '', 'failed');
            }
        } catch (e) {
            console.warn('[WaybackArchiveService] job failed:', job.filePath, e);
            try {
                await this.patchFrontmatter(job.filePath, job.sourceId, '', 'failed');
            } catch {
                /* ignore */
            }
        } finally {
            this.pending.delete(job.key);
        }
    }

    /** CDX API — closest successful capture. */
    private async resolveClosestSnapshot(pageUrl: string): Promise<string | null> {
        const enc = encodeURIComponent(pageUrl);
        const api = `https://web.archive.org/cdx/search/cdx?url=${enc}&output=json&limit=1&filter=statuscode:200&collapse=digest`;
        try {
            const res = await requestUrl({ url: api, method: 'GET', throw: false });
            if (res.status < 200 || res.status >= 300) return null;
            const rows = JSON.parse(res.text) as unknown;
            if (!Array.isArray(rows) || rows.length < 2) return null;
            const row = rows[1] as unknown;
            if (!Array.isArray(row) || row.length < 3) return null;
            const timestamp = String(row[1] ?? '');
            const original = String(row[2] ?? '');
            if (!timestamp || !original) return null;
            return `https://web.archive.org/web/${timestamp}/${original}`;
        } catch {
            return null;
        }
    }

    private extractFrontmatterRecord(text: string): Record<string, unknown> | null {
        const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!m) return null;
        try {
            return parseYaml(m[1]) as Record<string, unknown>;
        } catch {
            return null;
        }
    }

    private async patchFrontmatter(
        filePath: string,
        sourceId: string,
        archiveUrl: string,
        status: OsintArchiveStatus,
    ): Promise<void> {
        const f = this.app.vault.getAbstractFileByPath(filePath);
        if (!(f instanceof TFile)) return;

        const text = await this.app.vault.read(f);
        const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!m) return;
        let fm: Record<string, unknown>;
        try {
            fm = parseYaml(m[1]) as Record<string, unknown>;
        } catch {
            return;
        }
        const sources = fm.osint_sources;
        if (!Array.isArray(sources)) return;

        let changed = false;
        for (const raw of sources) {
            if (typeof raw !== 'object' || !raw) continue;
            const s = raw as Record<string, unknown>;
            if (String(s.id ?? '') !== sourceId) continue;
            if (archiveUrl) {
                s.archive_url = archiveUrl;
            }
            s.archive_status = status;
            changed = true;
            break;
        }
        if (!changed) return;

        const newFm = stringifyYaml(fm).trim();
        const newText = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newFm}\n---`);
        await this.app.vault.modify(f, newText);
    }
}
