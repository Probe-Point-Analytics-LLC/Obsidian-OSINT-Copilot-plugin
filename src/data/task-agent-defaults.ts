/**
 * Default task-agent markdown files under taskAgentsFolder (missing only).
 */

export interface TaskAgentFileDef {
	path: string;
	content: string;
}

export const TASK_AGENT_DEFAULT_FILES: TaskAgentFileDef[] = [
	{
		path: "README.md",
		content: `# Task agents (vault-pluggable)

Task agents run **only** through your local **Claude Code CLI**. Each \`.md\` file defines instructions + metadata. The model returns **JSON**; the plugin creates or updates vault files under allowed folders.

## Layout

| File | Role |
|------|------|
| \`*.md\` | One task agent per file; YAML frontmatter + body (instructions). |

## Frontmatter (task agents)

| Key | Required | Meaning |
|-----|----------|---------|
| \`agent_kind\` | yes | Must be \`task\` for this folder. |
| \`id\` | yes | Stable id (filename usually matches). |
| \`name\` | yes | Shown in the chat dropdown. |
| \`description\` | no | Tooltip / settings list. |
| \`output_schema\` | yes | Use \`vault_files_v1\`. |
| \`output_roots\` | yes | Comma-separated vault-relative folder prefixes where files may be written. |
| \`context_roots\` | no | Comma-separated folders (or note paths) to inject as wiki context. |
| \`max_notes\` | no | Cap notes pulled from context (default 20). |
| \`max_context_chars\` | no | Max characters of wiki context (default 120000). |
| \`enabled_default\` | no | \`true\`/\`false\` when no per-agent setting exists. |

## Output JSON (\`vault_files_v1\`)

The model must output **only** valid JSON:

\`\`\`json
{
  "version": "vault_files_v1",
  "files": [
    { "path": "relative/note.md", "body": "markdown body" }
  ]
}
\`\`\`

Optional per file: \`frontmatter\` as a string (YAML block) or omit for body-only notes.

Paths must stay under **both** the agent’s \`output_roots\` **and** the global allowlist in **Settings → OSINT Copilot → Task agents**.

## Settings

Enable **Task agents**, set folder path, global output allowlist, and per-agent toggles. Use **Task agent** dropdown in chat (General mode) to select **None** or a task agent.
`,
	},
	{
		path: "memo-writer.md",
		content: `---
agent_kind: task
id: memo-writer
name: Memo writer
description: Draft short memos into the vault from chat + wiki context
output_schema: vault_files_v1
output_roots: .osint-copilot/outputs/memos/
context_roots: .osint-copilot/prompts/rules/
max_notes: 15
max_context_chars: 80000
enabled_default: true
---

You are a task agent that writes **concise investigation memos** as new Markdown notes in the vault.

Use the wiki context and the user message. Prefer bullet summaries, clear sections, and cite source note paths when the context includes them.

At the end, output **only** JSON matching \`vault_files_v1\` (no markdown fences, no commentary):

{
  "version": "vault_files_v1",
  "files": [
    {
      "path": "YYYY-MM-DD-topic-memo.md",
      "body": "# Title\\n\\n## Summary\\n...\\n\\n## Sources\\n- ...",
      "frontmatter": "title: Short title\\ndate: YYYY-MM-DD\\ntags: [memo, osint]"
    }
  ]
}

Use a unique filename (date prefix recommended). Keep \`path\` relative and under the configured output folder.
`,
	},
	{
		path: "report-drafter.md",
		content: `---
agent_kind: task
id: report-drafter
name: Report drafter
description: Longer structured report skeletons into allowed output folders
output_schema: vault_files_v1
output_roots: .osint-copilot/outputs/reports/
context_roots:
max_notes: 25
max_context_chars: 120000
enabled_default: false
---

You draft **structured OSINT-style reports** (Markdown) from the user request and any wiki context provided.

Sections to include when relevant: Executive summary, Key judgments, Facts (with uncertainty), Gaps, Recommended next steps, References (vault paths if present).

Output **only** JSON \`vault_files_v1\`:

{
  "version": "vault_files_v1",
  "files": [
    {
      "path": "report-<short-slug>.md",
      "body": "# Report title\\n\\n...",
      "frontmatter": "title: Report title\\ntype: draft-report"
    }
  ]
}

Paths must be relative under the agent output root. No prose outside the JSON.
`,
	},
];
