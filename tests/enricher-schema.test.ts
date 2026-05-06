import { describe, it, expect } from "vitest";
import {
  enrichToolId,
  normalizeEnricherInvocationId,
  normalizeEnricherSpec,
  parseEnrichToolId,
} from "../src/services/enrichers/enricher-schema";

describe("enricher schema", () => {
  it("normalizes basic enricher spec", () => {
    const spec = normalizeEnricherSpec({
      id: "My Enricher",
      name: "My API",
      status: "active",
      enabled: true,
      request: { method: "GET", urlTemplate: "https://api.example.com?q={{query}}" },
      auth: { type: "none" },
      limits: { timeoutMs: 5000, retries: 1, maxResponseChars: 1000 },
    });
    expect(spec?.id).toBe("my-enricher");
    expect(spec?.request.method).toBe("GET");
  });

  it("parses and formats enricher tool ids", () => {
    expect(enrichToolId("abc")).toBe("ENRICH_abc");
    expect(parseEnrichToolId("ENRICH_abc")).toBe("abc");
    expect(parseEnrichToolId("SKILL_x")).toBeNull();
  });

  it("normalizes invocation ids for agent JSON", () => {
    expect(normalizeEnricherInvocationId("LeakCheck")).toBe("leakcheck");
    expect(normalizeEnricherInvocationId("")).toBeNull();
  });

  it("normalizes vault-backed auth with relative path", () => {
    const spec = normalizeEnricherSpec({
      id: "vault-auth",
      name: "V",
      status: "active",
      enabled: true,
      request: { method: "GET", urlTemplate: "https://api.example.com" },
      auth: { type: "bearer_vault", vaultRelativePath: "svc/token.txt" },
      limits: { timeoutMs: 5000, retries: 0, maxResponseChars: 1000 },
    });
    expect(spec?.auth.type).toBe("bearer_vault");
    expect(spec?.auth.vaultRelativePath).toBe("svc/token.txt");
  });

  it("falls back to none when vault auth missing path", () => {
    const spec = normalizeEnricherSpec({
      id: "x",
      name: "V",
      status: "active",
      enabled: true,
      request: { method: "GET", urlTemplate: "https://api.example.com" },
      auth: { type: "header_vault" },
      limits: { timeoutMs: 5000, retries: 0, maxResponseChars: 1000 },
    });
    expect(spec?.auth.type).toBe("none");
  });
});
