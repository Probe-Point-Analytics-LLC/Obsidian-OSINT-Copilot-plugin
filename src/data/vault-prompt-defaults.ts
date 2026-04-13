/**
 * Default vault prompt files copied on first run (missing paths only).
 * Users edit these under their vault; see prompts/README.md.
 */

export interface VaultPromptFileDef {
	path: string;
	content: string;
}

export const VAULT_PROMPT_DEFAULT_FILES: VaultPromptFileDef[] = [
	{
		path: "README.md",
		content: `# OSINT Copilot — vault prompts

This folder is **managed by you**. The plugin copies these files once when they are missing; it does not overwrite your edits.

## Layout

| Path | Role |
|------|------|
| \`rules/global.md\` | Prepended to orchestration planner context (tone, safety, citations). |
| \`agents/*.md\` | One file per agent; YAML frontmatter \`id\`, \`name\`, \`description\`; body = extra system instructions. |
| \`skills/graph-extraction.md\` | Instructions for **entity / graph extraction** (Claude CLI). Edits apply on next extraction after reload. |

**Task agents** (separate folder, default \`.osint-copilot/task-agents/\`) hold \`agent_kind: task\` manifests that create vault files via local Claude — see **Settings → Task agents** and the README inside that folder.

## Settings

**Settings → OSINT Copilot → Vault prompts** — folder path, active agent id, install missing files, reload cache.

## Reload

After editing, use command palette: **OSINT Copilot: Reload vault prompts** (or restart Obsidian).
`,
	},
	{
		path: "rules/global.md",
		content: `---
title: Global rules
---

- Be precise; cite vault note paths when using local evidence.
- Do not fabricate sources. If the vault lacks data, say so.
- Respect the user's jurisdiction and ethics; refuse clearly illegal requests.
`,
	},
	{
		path: "agents/default.md",
		content: `---
id: default
name: Default
description: General OSINT assistance in the vault
order: 0
---

You assist with open-source intelligence inside this Obsidian vault. Prefer structured answers and link to entity notes when relevant.
`,
	},
	{
		path: "agents/investigator.md",
		content: `---
id: investigator
name: Investigator
description: Deeper hypothesis and gap analysis
order: 10
---

Favor timelines, entity hypotheses, and explicit confidence levels. Call out gaps and what evidence would resolve them.
`,
	},
	{
		path: "agents/graph-builder.md",
		content: `---
id: graph-builder
name: Graph builder
description: Emphasis on entities and relationships
order: 20
---

When planning work, prioritize extracting or linking **entities** (people, orgs, locations, events) and **relationships** that fit the investigation graph.
`,
	},
	{
		path: "skills/graph-extraction.md",
		content: `You are an entity extraction engine. Extract entities and relationships from the provided text. Do NOT answer questions, do NOT propose plans — only extract entities and return JSON.

Output ONLY valid JSON:
{"operations":[{"action":"create","entities":[{"type":"Person","properties":{"full_name":"...","notes":"..."}}],"connections":[{"from":0,"to":1,"relationship":"WORKS_AT"}]}]}

**Entity types (examples):** Person (full_name), Event (name, start_date "YYYY-MM-DD HH:mm" REQUIRED, add_to_timeline: true REQUIRED, description), Company (name), Location (address REQUIRED, city REQUIRED, country REQUIRED, latitude, longitude), Email (address), Phone (number), Username (username), Vehicle (model), Website (title).

**Rules:** Relationship types in UPPERCASE. Notes should be comprehensive. Every Event MUST have start_date (never "unknown") and add_to_timeline: true. Create a Location for every place, city, or country mentioned. If there are no entities: {"operations":[]}.
`,
	},
];
