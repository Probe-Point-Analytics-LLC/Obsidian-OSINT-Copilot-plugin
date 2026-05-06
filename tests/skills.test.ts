import { describe, it, expect } from "vitest";
import { parseSkillMarkdown } from "../src/skills/parse-skill-markdown";
import { parseVaultSkillPlannerTool, vaultSkillPlannerToolId } from "../src/skills/skill-runtime";

describe("parseSkillMarkdown", () => {
	it("parses vault skill frontmatter", () => {
		const raw = `---
skill_kind: vault
id: my_skill
name: Test Skill
description: Does a thing
---
Body line.`;
		const m = parseSkillMarkdown(raw, "OSINTCopilot/custom/skills/t.md");
		expect(m?.id).toBe("my_skill");
		expect(m?.name).toBe("Test Skill");
		expect(m?.body).toContain("Body line");
	});
});

describe("skill-runtime planner ids", () => {
	it("formats and parses SKILL_ prefix", () => {
		expect(vaultSkillPlannerToolId("foo")).toBe("SKILL_foo");
		expect(parseVaultSkillPlannerTool("SKILL_foo")).toBe("foo");
		expect(parseVaultSkillPlannerTool("LOCAL_VAULT")).toBeNull();
	});
});
