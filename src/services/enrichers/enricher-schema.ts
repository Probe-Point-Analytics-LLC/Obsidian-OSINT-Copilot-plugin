export type EnricherAuthType = "none" | "bearer_env" | "header_env" | "query_env";
export type EnricherStatus = "draft" | "active" | "disabled";

export interface EnricherAuthConfig {
  type: EnricherAuthType;
  envVar?: string;
  headerName?: string;
  queryParam?: string;
}

export interface EnricherRequestConfig {
  method: "GET" | "POST";
  urlTemplate: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
}

export interface EnricherLimits {
  timeoutMs: number;
  retries: number;
  maxResponseChars: number;
}

export interface EnricherSpec {
  id: string;
  name: string;
  description: string;
  documentationUrl?: string;
  status: EnricherStatus;
  enabled: boolean;
  allowedDomains: string[];
  auth: EnricherAuthConfig;
  request: EnricherRequestConfig;
  inputHints: string[];
  outputMapping?: {
    summaryPath?: string;
    listPath?: string;
  };
  skillInstructions: string;
  limits: EnricherLimits;
  updatedAt: string;
}

function parseId(v: unknown): string {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function enrichToolId(id: string): string {
  return `ENRICH_${id}`;
}

export function parseEnrichToolId(toolId: string): string | null {
  if (!toolId.startsWith("ENRICH_")) return null;
  const id = parseId(toolId.slice("ENRICH_".length));
  return id || null;
}

export function normalizeEnricherSpec(raw: unknown): EnricherSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = parseId(r.id);
  if (!id) return null;
  const method = String((r.request as any)?.method || "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const timeoutMs = Number((r.limits as any)?.timeoutMs);
  const retries = Number((r.limits as any)?.retries);
  const maxResponseChars = Number((r.limits as any)?.maxResponseChars);
  const authType = String((r.auth as any)?.type || "none") as EnricherAuthType;
  const statusRaw = String(r.status || "draft");
  const status: EnricherStatus = statusRaw === "active" || statusRaw === "disabled" ? statusRaw : "draft";
  const enabled = r.enabled !== false;
  const allowedDomains = Array.isArray(r.allowedDomains)
    ? r.allowedDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
    : [];

  return {
    id,
    name: String(r.name || id).trim() || id,
    description: String(r.description || "").trim(),
    documentationUrl: typeof r.documentationUrl === "string" ? r.documentationUrl.trim() : undefined,
    status,
    enabled,
    allowedDomains,
    auth: {
      type: authType === "bearer_env" || authType === "header_env" || authType === "query_env" ? authType : "none",
      envVar: typeof (r.auth as any)?.envVar === "string" ? String((r.auth as any).envVar).trim() : undefined,
      headerName:
        typeof (r.auth as any)?.headerName === "string" ? String((r.auth as any).headerName).trim() : undefined,
      queryParam:
        typeof (r.auth as any)?.queryParam === "string" ? String((r.auth as any).queryParam).trim() : undefined,
    },
    request: {
      method,
      urlTemplate: String((r.request as any)?.urlTemplate || "").trim(),
      headers:
        (r.request as any)?.headers && typeof (r.request as any).headers === "object"
          ? Object.fromEntries(
              Object.entries((r.request as any).headers).map(([k, v]) => [String(k), String(v ?? "")]),
            )
          : {},
      bodyTemplate: typeof (r.request as any)?.bodyTemplate === "string" ? String((r.request as any).bodyTemplate) : undefined,
    },
    inputHints: Array.isArray(r.inputHints) ? r.inputHints.map((v) => String(v)) : [],
    outputMapping:
      r.outputMapping && typeof r.outputMapping === "object"
        ? {
            summaryPath:
              typeof (r.outputMapping as any).summaryPath === "string"
                ? String((r.outputMapping as any).summaryPath)
                : undefined,
            listPath:
              typeof (r.outputMapping as any).listPath === "string"
                ? String((r.outputMapping as any).listPath)
                : undefined,
          }
        : undefined,
    skillInstructions: String(r.skillInstructions || "").trim(),
    limits: {
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 2000 ? timeoutMs : 15_000,
      retries: Number.isFinite(retries) && retries >= 0 ? retries : 1,
      maxResponseChars: Number.isFinite(maxResponseChars) && maxResponseChars >= 500 ? maxResponseChars : 8000,
    },
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date().toISOString(),
  };
}

export function isEnricherRunnable(spec: EnricherSpec): boolean {
  return spec.status === "active" && spec.enabled && !!spec.request.urlTemplate;
}
