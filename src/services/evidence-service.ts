/**
 * Evidence analysis service.
 *
 * Sends vault files to POST /api/evidence/analyze (SSE), parses the
 * per-file and correlation events, and converts the correlated brief
 * into @@create_entity / @@create_link graph commands for the plugin.
 */

import { TFile, requestUrl } from "obsidian";
import VaultAIPlugin from "../../main";

// ---------------------------------------------------------------------------
// SSE event types (mirror backend evidence_models.py)
// ---------------------------------------------------------------------------

export interface EvidenceFileEvent {
  index: number;
  total: number;
  filename: string;
  phase?: string;
}

export interface EvidenceClassifiedEvent {
  index: number;
  filename: string;
  classification: string;
  confidence: number;
}

export interface EvidenceRecordEvent {
  index: number;
  filename: string;
  record: EvidenceRecord;
}

export interface EvidenceRecord {
  file: string;
  vault_path: string;
  classification: string;
  confidence: number;
  extracted: Record<string, unknown>;
  raw_text: string;
  entities_detected: DetectedEntity[];
  relationships_detected: DetectedRelationship[];
}

export interface DetectedEntity {
  name: string;
  entity_type: string;
  properties: Record<string, unknown>;
  confidence: number;
}

export interface DetectedRelationship {
  from_entity: string;
  to_entity: string;
  relationship: string;
  evidence: string;
}

export interface CorrelatedBrief {
  resolved_entities: ResolvedEntity[];
  resolved_relationships: ResolvedRelationship[];
  timeline: TimelineEvent[];
  gaps: string[];
  contradictions: string[];
}

export interface ResolvedEntity {
  canonical_name: string;
  entity_type: string;
  properties: Record<string, unknown>;
  sources: string[];
  confidence: number;
  aliases: string[];
}

export interface ResolvedRelationship {
  from_entity: string;
  to_entity: string;
  relationship: string;
  evidence_summary: string;
  sources: string[];
}

export interface TimelineEvent {
  date: string;
  description: string;
  source: string;
  entities_involved: string[];
}

export interface EvidenceDoneEvent {
  files_processed: number;
  files_failed: number;
  entities_found: number;
  relationships_found: number;
}

// ---------------------------------------------------------------------------
// Progress callback
// ---------------------------------------------------------------------------

export type EvidenceProgressCallback = (
  message: string,
  percent: number,
  detail?: {
    classification?: string;
    record?: EvidenceRecord;
    brief?: CorrelatedBrief;
    done?: EvidenceDoneEvent;
    error?: string;
  },
) => void;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file

export class EvidenceService {
  private plugin: VaultAIPlugin;

  constructor(plugin: VaultAIPlugin) {
    this.plugin = plugin;
  }

  /**
   * Run the full evidence analysis pipeline.
   *
   * 1. Read selected files from vault (text locally, binary as base64).
   * 2. POST to /api/evidence/analyze (SSE).
   * 3. Parse SSE events, call progress callback.
   * 4. Return graph commands derived from the correlated brief.
   */
  async analyze(
    files: TFile[],
    onProgress: EvidenceProgressCallback,
  ): Promise<string[]> {
    const baseUrl = (
      this.plugin.settings.graphApiUrl || "https://api.osint-copilot.com"
    ).replace(/\/+$/, "");
    const apiKey = this.plugin.settings.reportApiKey || "";

    // Build the payload
    onProgress("Preparing files…", 2);
    const filesPayload: Array<{
      filename: string;
      content_base64: string;
      mime_type: string;
      vault_path: string;
    }> = [];

    for (const file of files) {
      if (file.stat.size > MAX_FILE_SIZE) {
        onProgress(`Skipping ${file.name} (too large)`, 0, { error: `${file.name} exceeds 10 MB` });
        continue;
      }
      const ext = (file.extension || "").toLowerCase();
      let b64: string;
      if (ext === "md" || ext === "markdown" || ext === "txt") {
        const text = await this.plugin.app.vault.cachedRead(file);
        b64 = btoa(unescape(encodeURIComponent(text)));
      } else {
        const buf = await this.plugin.app.vault.readBinary(file);
        b64 = this.arrayBufferToBase64(buf);
      }
      filesPayload.push({
        filename: file.name,
        content_base64: b64,
        mime_type: this.mimeFor(ext),
        vault_path: file.path,
      });
    }

    if (filesPayload.length === 0) {
      onProgress("No files to analyze", 100);
      return [];
    }

    // POST as SSE
    onProgress(`Sending ${filesPayload.length} files to server…`, 5);

    const body = JSON.stringify({ files: filesPayload, correlate: true });
    const records: EvidenceRecord[] = [];
    let brief: CorrelatedBrief | null = null;
    let doneEvent: EvidenceDoneEvent | null = null;

    try {
      const resp = await requestUrl({
        url: `${baseUrl}/api/evidence/analyze`,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body,
        throw: false,
      });

      if (resp.status >= 400) {
        const errText = resp.text || `HTTP ${resp.status}`;
        onProgress(`Server error: ${errText}`, 0, { error: errText });
        return [];
      }

      // Obsidian's requestUrl returns the full body at once (no true streaming).
      // Parse the SSE text manually.
      const sseText = resp.text || "";
      const events = this.parseSSE(sseText);

      for (const ev of events) {
        switch (ev.event) {
          case "file_start": {
            const d = ev.data as EvidenceFileEvent;
            const pct = 5 + Math.floor((d.index / d.total) * 70);
            onProgress(`Analyzing ${d.filename} (${d.index + 1}/${d.total})…`, pct);
            break;
          }
          case "file_classified": {
            const d = ev.data as EvidenceClassifiedEvent;
            onProgress(
              `${d.filename}: ${d.classification} (${Math.round(d.confidence * 100)}%)`,
              5 + Math.floor(((d.index + 0.5) / files.length) * 70),
              { classification: d.classification },
            );
            break;
          }
          case "file_complete": {
            const d = ev.data as EvidenceRecordEvent;
            records.push(d.record);
            onProgress(
              `${d.filename}: extracted ${d.record.entities_detected.length} entities`,
              5 + Math.floor(((d.index + 1) / files.length) * 70),
              { record: d.record },
            );
            break;
          }
          case "file_error": {
            const d = ev.data as { index: number; filename: string; error: string };
            onProgress(`Error: ${d.filename} — ${d.error}`, 0, { error: d.error });
            break;
          }
          case "correlation_start":
            onProgress("Cross-document correlation…", 80);
            break;
          case "correlation_complete": {
            const d = ev.data as { brief: CorrelatedBrief };
            brief = d.brief;
            onProgress("Correlation complete", 90, { brief });
            break;
          }
          case "correlation_error": {
            const d = ev.data as { error: string };
            onProgress(`Correlation error: ${d.error}`, 85, { error: d.error });
            break;
          }
          case "done": {
            doneEvent = ev.data as EvidenceDoneEvent;
            onProgress(
              `Done: ${doneEvent.files_processed} files, ${doneEvent.entities_found} entities, ${doneEvent.relationships_found} relationships`,
              95,
              { done: doneEvent },
            );
            break;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onProgress(`Network error: ${msg}`, 0, { error: msg });
      return [];
    }

    // Convert brief → graph commands
    const commands = brief ? this.briefToGraphCommands(brief) : this.recordsToGraphCommands(records);
    onProgress("Graph commands ready for review", 100);
    return commands;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private briefToGraphCommands(brief: CorrelatedBrief): string[] {
    const cmds: string[] = [];

    for (const ent of brief.resolved_entities) {
      const props: Record<string, unknown> = { ...ent.properties };
      if (ent.sources.length > 0) props["source"] = ent.sources.join(", ");
      if (ent.aliases.length > 0) props["aliases"] = ent.aliases.join(", ");

      cmds.push(
        `@@create_entity ${JSON.stringify({
          type: ent.entity_type,
          label: ent.canonical_name,
          properties: props,
        })}`,
      );
    }

    for (const rel of brief.resolved_relationships) {
      cmds.push(
        `@@create_link ${JSON.stringify({
          from: rel.from_entity,
          to: rel.to_entity,
          relationship: rel.relationship,
        })}`,
      );
    }

    // Timeline events
    for (const te of brief.timeline) {
      cmds.push(
        `@@create_entity ${JSON.stringify({
          type: "Event",
          label: te.description.slice(0, 80),
          properties: {
            name: te.description.slice(0, 80),
            description: te.description,
            start_date: te.date,
            add_to_timeline: true,
            source: te.source,
            notes: `Entities involved: ${te.entities_involved.join(", ")}`,
          },
        })}`,
      );
    }

    return cmds;
  }

  /** Fallback when correlation was not requested or failed. */
  private recordsToGraphCommands(records: EvidenceRecord[]): string[] {
    const cmds: string[] = [];
    for (const rec of records) {
      const src = rec.vault_path || rec.file;
      for (const ent of rec.entities_detected) {
        cmds.push(
          `@@create_entity ${JSON.stringify({
            type: ent.entity_type,
            label: ent.name,
            properties: { ...ent.properties, source: src },
          })}`,
        );
      }
      for (const rel of rec.relationships_detected) {
        cmds.push(
          `@@create_link ${JSON.stringify({
            from: rel.from_entity,
            to: rel.to_entity,
            relationship: rel.relationship,
          })}`,
        );
      }
    }
    return cmds;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseSSE(text: string): Array<{ event: string; data: any }> {
    const results: Array<{ event: string; data: any }> = [];
    const blocks = text.split("\n\n");
    for (const block of blocks) {
      if (!block.trim()) continue;
      let event = "message";
      let dataStr = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataStr = line.slice(6);
      }
      if (dataStr) {
        try {
          results.push({ event, data: JSON.parse(dataStr) });
        } catch { /* skip malformed */ }
      }
    }
    return results;
  }

  private arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private mimeFor(ext: string): string {
    const map: Record<string, string> = {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      md: "text/markdown",
      markdown: "text/markdown",
      txt: "text/plain",
    };
    return map[ext] || "application/octet-stream";
  }
}
