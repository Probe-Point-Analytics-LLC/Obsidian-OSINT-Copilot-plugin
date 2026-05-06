import { normalizePath, TFile, type Vault } from "obsidian";
import { DEFAULT_CREDENTIALS_FOLDER } from "../../constants/vault-layout";
import { normalizeCredentialsRelativePath } from "../custom-vault-operations";
import type { EnricherSpec } from "./enricher-schema";

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
  if (!rel) throw new Error("Invalid vault credential relative path");
  const full = normalizePath(`${root}/${rel}`);
  if (!pathIsUnderPrefix(full, root)) throw new Error("Credential path escapes credentials folder");
  const file = vault.getAbstractFileByPath(full);
  if (!(file instanceof TFile)) throw new Error(`Credential file not found: ${rel}`);
  return (await vault.read(file)).trim();
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => vars[key] ?? "");
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
  const vars = {
    query,
    attachments_context: attachmentsContext || "",
  };
  const baseUrl = interpolate(spec.request.urlTemplate, vars);
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
      ? interpolate(spec.request.bodyTemplate, vars)
      : undefined;

  const started = Date.now();
  let attempt = 0;
  let lastErr: unknown = null;
  const totalAttempts = Math.max(1, spec.limits.retries + 1);
  while (attempt < totalAttempts) {
    attempt++;
    try {
      const timeoutController = new AbortController();
      const t = setTimeout(() => timeoutController.abort(), spec.limits.timeoutMs);
      const mergedController = new AbortController();
      const onAbort = () => {
        if (!mergedController.signal.aborted) mergedController.abort();
      };
      timeoutController.signal.addEventListener("abort", onAbort, { once: true });
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      const res = await fetch(url.toString(), {
        method,
        headers,
        body,
        signal: mergedController.signal,
      });
      clearTimeout(t);
      const text = await res.text();
      const elapsed = Date.now() - started;
      const truncated = truncate(text, spec.limits.maxResponseChars);
      const info = `[${spec.id}] ${method} ${url.hostname} status=${res.status} latency_ms=${elapsed}`;
      if (!res.ok) {
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
