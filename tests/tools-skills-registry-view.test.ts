import { describe, it, expect } from "vitest";
import { BUILT_IN_ORCHESTRATION_TOOLS } from "../src/data/built-in-orchestration-tools";
import { enricherJsonPathFromId, skillMarkdownPathFromId } from "../src/utils/registry-paths";
import { DEFAULT_ENRICHERS_FOLDER, DEFAULT_SKILLS_FOLDER } from "../src/constants/vault-layout";

describe("registry paths", () => {
	it("skillMarkdownPathFromId uses default folder and slug", () => {
		expect(skillMarkdownPathFromId("", "Hello World")).toBe(`${DEFAULT_SKILLS_FOLDER}/hello-world.md`);
		expect(skillMarkdownPathFromId("Custom/skills", "my_skill")).toBe("Custom/skills/my_skill.md");
	});

	it("skillMarkdownPathFromId rejects readme id", () => {
		expect(skillMarkdownPathFromId("", "readme")).toBeNull();
	});

	it("enricherJsonPathFromId matches writer-style path", () => {
		expect(enricherJsonPathFromId("", "LeakCheck v2")).toBe(`${DEFAULT_ENRICHERS_FOLDER}/leakcheck-v2.json`);
		expect(enricherJsonPathFromId("OSINTCopilot/custom/enrichers", "foo")).toBe(
			"OSINTCopilot/custom/enrichers/foo.json",
		);
	});
});

describe("built-in orchestration tool catalog", () => {
	it("is non-empty and has expected ids", () => {
		expect(BUILT_IN_ORCHESTRATION_TOOLS.length).toBeGreaterThan(0);
		const ids = BUILT_IN_ORCHESTRATION_TOOLS.map((t) => t.id);
		expect(ids).toContain("LOCAL_VAULT");
		expect(ids).toContain("EXTRACT_TO_GRAPH");
		expect(ids).toContain("VAULT_GRAPH_INGEST");
		for (const t of BUILT_IN_ORCHESTRATION_TOOLS) {
			expect(t.title.length).toBeGreaterThan(0);
			expect(t.description.length).toBeGreaterThan(0);
		}
	});
});
