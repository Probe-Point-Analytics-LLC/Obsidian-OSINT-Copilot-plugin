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

Toggle skills in the chat header **Skills** menu. Built-in **Local search** and **Graph generation** are managed there too.

`,
	},
	{
		path: "example-skill.md",
		content: `---
skill_kind: vault
id: example_skill
name: Example skill
description: Template — customize or duplicate this file to add planner-invokable skills (SKILL_example_skill).
---

You are a specialized sub-agent invoked when the orchestration planner selects this skill.

Given the user request and any attachment context, produce a concise, actionable result for the main agent to synthesize.
`,
	},
];
