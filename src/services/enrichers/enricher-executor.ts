import { normalizePath, requestUrl, TFile, type RequestUrlResponse, type Vault } from "obsidian";
import { DEFAULT_CREDENTIALS_FOLDER } from "../../constants/vault-layout";
import { normalizeCredentialsRelativePath } from "../custom-vault-operations";
import type { EnricherSpec } from "./enricher-schema";

/**
 * Pause between consecutive enricher HTTP calls in unified chat. Some APIs (e.g. LeakCheck)
 * reject bursts stricter than “one at a time” if each call finishes in under ~300ms.
 */
export const ENRICHER_INVOCATION_SPACING_MS = 500;

function pathIsUnderPrefix(path: string, prefix: string): boolean {
  const p = normalizePath(path);
  const pre = normalizePath(prefix);
  return p === pre || p.startsWith(pre + "/");
}

async function readVaultCredential(
  vault: Vault,
  credentialsFolder: string,
  vaultRelativePath: string,
): Promise<string> {
  const root = normalizePath(credentialsFolder.trim() || DEFAULT_CREDENTIALS_FOLDER);
  const rel = normalizeCredentialsRelativePath(vaultRelativePath);
  if (!rel) {
    throw new Error(
      `Invalid vault credential path "${vaultRelativePath}". ` +
        `Use a path relative to **Settings → OSINT Copilot → Credentials folder** (no leading /, no .. segments), e.g. leakcheck/api-key.txt.`,
    );
  }
  const full = normalizePath(`${root}/${rel}`);
  if (!pathIsUnderPrefix(full, root)) throw new Error("Credential path escapes credentials folder");
  const file = vault.getAbstractFileByPath(full);
  if (!(file instanceof TFile)) {
    throw new Error(
      `Credential file not found in vault at: ${full}\n` +
        `(credentials folder "${root}" + "${rel}"). ` +
        `Check that **Credentials folder** in plugin settings matches where chat **Apply** wrote the file, and that the note exists in this vault.`,
    );
  }
  const secret = (await vault.read(file)).trim();
  if (!secret) {
    throw new Error(
      `Credential file is empty: ${full}. Paste the secret (single line) or re-apply **put_credentials** and confirm in chat.`,
    );
  }
  return secret;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => vars[key] ?? "");
}

/** Values for urlTemplate: encode so path segments and query values are valid (spaces, @, unicode, etc.). */
function urlTemplateVars(query: string, attachmentsContext: string): Record<string, string> {
  return {
    query: encodeURIComponent(query),
    attachments_context: encodeURIComponent(attachmentsContext || ""),
  };
}

/** Values for bodyTemplate: keep raw strings (JSON bodies must not be URL-encoded). */
function bodyTemplateVars(query: string, attachmentsContext: string): Record<string, string> {
  return {
    query,
    attachments_context: attachmentsContext || "",
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function ensureDomainAllowed(url: string, allowlist: string[]): void {
  if (!allowlist.length) return;
  const host = hostOf(url);
  if (!host) throw new Error("Invalid enricher URL");
  const ok = allowlist.some((d) => host === d || host.endsWith(`.${d}`));
  if (!ok) throw new Error(`Domain not allowed by enricher spec: ${host}`);
}

function truncate(v: string, max: number): string {
  if (v.length <= max) return v;
  return v.slice(0, max) + "...";
}

async function authHeader(
  spec: EnricherSpec,
  vault: Vault | undefined,
  credentialsFolder: string,
): Promise<Record<string, string>> {
  const cfg = spec.auth;
  if (cfg.type === "none") return {};
  /** Query-string secrets are applied to the URL in executeEnricherHttp before this runs — never treat as header/env. */
  if (cfg.type === "query_vault" || cfg.type === "query_env") return {};
  if (cfg.type === "bearer_vault" || cfg.type === "header_vault") {
    if (!vault) throw new Error("Vault-backed auth requires Obsidian vault access");
    const rel = cfg.vaultRelativePath || "";
    const secret = await readVaultCredential(vault, credentialsFolder, rel);
    if (!secret) throw new Error(`Empty credential file: ${rel}`);
    if (cfg.type === "bearer_vault") {
      return { Authorization: `Bearer ${secret}` };
    }
    return { [cfg.headerName || "X-API-Key"]: secret };
  }
  const envVar = cfg.envVar || "";
  const secret = envVar ? process.env[envVar] : "";
  if (!secret) throw new Error(`Missing credential env var: ${envVar || "(unset)"}`);
  if (cfg.type === "bearer_env") {
    return { Authorization: `Bearer ${secret}` };
  }
  if (cfg.type === "header_env") {
    return { [cfg.headerName || "X-API-Key"]: secret };
  }
  return {};
}

export async function executeEnricherHttp(
  spec: EnricherSpec,
  query: string,
  attachmentsContext: string,
  signal?: AbortSignal,
  vault?: Vault,
  credentialsFolder?: string,
): Promise<string> {
  const baseUrl = interpolate(spec.request.urlTemplate, urlTemplateVars(query, attachmentsContext));
  const url = new URL(baseUrl);
  const credRoot = credentialsFolder ?? DEFAULT_CREDENTIALS_FOLDER;
  if (spec.auth.type === "query_env") {
    const envVar = spec.auth.envVar || "";
    const secret = envVar ? process.env[envVar] : "";
    if (!secret) throw new Error(`Missing credential env var: ${envVar || "(unset)"}`);
    url.searchParams.set(spec.auth.queryParam || "api_key", secret);
  } else if (spec.auth.type === "query_vault") {
    if (!vault) throw new Error("Vault-backed query auth requires Obsidian vault access");
    const rel = spec.auth.vaultRelativePath || "";
    const secret = await readVaultCredential(vault, credRoot, rel);
    if (!secret) throw new Error(`Empty credential file: ${rel}`);
    url.searchParams.set(spec.auth.queryParam || "api_key", secret);
  }
  ensureDomainAllowed(url.toString(), spec.allowedDomains);
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    ...(spec.request.headers || {}),
    ...(await authHeader(spec, vault, credRoot)),
  };
  const method = spec.request.method || "GET";
  const body =
    method === "POST" && spec.request.bodyTemplate
      ? interpolate(spec.request.bodyTemplate, bodyTemplateVars(query, attachmentsContext))
      : undefined;

  const started = Date.now();
  let attempt = 0;
  let lastErr: unknown = null;
  const totalAttempts = Math.max(1, spec.limits.retries + 1);
  while (attempt < totalAttempts) {
    attempt++;
    try {
      const strHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        strHeaders[k] = String(v ?? "");
      }
      const urlStr = url.toString();
      const postBody = method === "POST" ? body : undefined;
      const contentType =
        method === "POST" && postBody
          ? postBody.trimStart().startsWith("{") || postBody.trimStart().startsWith("[")
            ? "application/json"
            : "text/plain; charset=utf-8"
          : undefined;

      const runRequest = (): Promise<RequestUrlResponse> =>
        requestUrl({
          url: urlStr,
          method,
          headers: strHeaders,
          body: postBody,
          contentType,
          throw: false,
        });

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new DOMException("Aborted", "AbortError")), spec.limits.timeoutMs);
      });
      const abortPromise = signal
        ? new Promise<never>((_, reject) => {
            if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          })
        : null;

      let res: RequestUrlResponse;
      try {
        res = await Promise.race([
          runRequest(),
          timeoutPromise,
          ...(abortPromise ? [abortPromise] : []),
        ]);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }

      const text = res.text || "";
      const elapsed = Date.now() - started;
      const truncated = truncate(text, spec.limits.maxResponseChars);
      const info = `[${spec.id}] ${method} ${url.hostname} status=${res.status} latency_ms=${elapsed}`;
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`${info} body=${truncate(text, 1000)}`);
      }
      let summary = truncated;
      try {
        const parsed = JSON.parse(text);
        summary = JSON.stringify(parsed, null, 2);
      } catch {
        // keep text
      }
      console.info("[EnricherExecutor] success", info);
      return `Enricher ${spec.name} succeeded.\n${truncate(summary, spec.limits.maxResponseChars)}`;
    } catch (e) {
      lastErr = e;
      if (attempt >= totalAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  const elapsed = Date.now() - started;
  console.warn("[EnricherExecutor] failed", { id: spec.id, elapsed, error: String(lastErr) });
  throw new Error(`Enricher ${spec.name} failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
