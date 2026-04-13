import { describe, it, expect, vi } from "vitest";
import { parseSkillMarkdown } from "../src/skills/parse-skill-markdown";
import { buildPlannerTooling, filterToolsToCall } from "../src/skills/skill-runtime";
import type { SkillRegistry } from "../src/skills/skill-registry";

describe("parseSkillMarkdown", () => {
	it("parses vault skill frontmatter and body", () => {
		const raw = `---
skill_kind: vault
id: test_one
name: Test
description: Desc
---

Body line`;
		const m = parseSkillMarkdown(raw, "OSINTCopilot/custom/skills/t.md");
		expect(m).not.toBeNull();
		expect(m!.id).toBe("test_one");
		expect(m!.body).toContain("Body line");
	});
});

describe("filterToolsToCall", () => {
	it("removes disabled tools and EXTRACT_TO_GRAPH without attachments", () => {
		const enabled = new Set(["LOCAL_VAULT", "EXTRACT_TO_GRAPH"]);
		expect(filterToolsToCall(["LOCAL_VAULT", "EXTRACT_TO_GRAPH"], enabled, false)).toEqual(["LOCAL_VAULT"]);
		expect(filterToolsToCall(["LOCAL_VAULT", "BOGUS"], enabled, true)).toEqual(["LOCAL_VAULT"]);
	});
});

describe("buildPlannerTooling", () => {
	it("includes built-in tools when toggles default on", async () => {
		const registry = {
			listVaultSkills: vi.fn().mockResolvedValue([]),
		} as unknown as SkillRegistry;
		const t = await buildPlannerTooling(registry, {}, true);
		expect(t.enabledPlannerToolIds.has("LOCAL_VAULT")).toBe(true);
		expect(t.enabledPlannerToolIds.has("EXTRACT_TO_GRAPH")).toBe(true);
	});

	it("omits EXTRACT_TO_GRAPH when no attachments", async () => {
		const registry = {
			listVaultSkills: vi.fn().mockResolvedValue([]),
		} as unknown as SkillRegistry;
		const t = await buildPlannerTooling(registry, {}, false);
		expect(t.enabledPlannerToolIds.has("LOCAL_VAULT")).toBe(true);
		expect(t.enabledPlannerToolIds.has("EXTRACT_TO_GRAPH")).toBe(false);
	});
});
