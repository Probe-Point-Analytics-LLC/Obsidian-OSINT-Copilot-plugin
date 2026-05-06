/** Bootstrap files under skillsFolder (created only if missing). */
export const SKILL_DEFAULT_FILES: { path: string; content: string }[] = [
	{
		path: "README.md",
		content: `# OSINT Copilot skills

Skills are markdown files in this folder. Each skill uses YAML frontmatter:

\`\`\`yaml
---
skill_kind: vault
id: my_skill
name: Display name
description: Short line for the planner tool list
---

Body: instructions used when this skill runs (local Claude).
\`\`\`

Chat uses a **unified agent** (Claude Code, Hermes, or a custom runtime from settings). Custom skills here complement **HTTP enrichers** and can be created or updated when the agent proposes **custom_vault_operations**.

`,
	},
	{
		path: "example-skill.md",
		content: `---
skill_kind: vault
id: example_skill
name: Example skill
description: Template — customize or duplicate this file for vault-defined skills.
---

You are a specialized sub-agent invoked when a workflow runs this skill file.

Given the user request and any attachment context, produce a concise, actionable result for the main agent to synthesize.
`,
	},
];
