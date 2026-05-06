import { describe, it, expect } from "vitest";
import { enrichToolId, normalizeEnricherSpec, parseEnrichToolId } from "../src/services/enrichers/enricher-schema";

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
});
