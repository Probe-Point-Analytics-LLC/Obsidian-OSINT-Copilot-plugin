/**
 * Default vault paths — all under visible `OSINTCopilot/` (no `.osint-copilot/` for user-facing data).
 * Customization (prompts, agents, skills, task agents, outputs) lives under `custom/`.
 */

export const OSINT_COPILOT_VAULT_ROOT = "OSINTCopilot";

/** Prompts, skills, task-agent manifests, outputs, custom entity types — user-editable area. */
export const OSINT_COPILOT_CUSTOM_ROOT = `${OSINT_COPILOT_VAULT_ROOT}/custom`;

export const DEFAULT_CONVERSATION_FOLDER = `${OSINT_COPILOT_VAULT_ROOT}/conversations`;
export const DEFAULT_PROMPTS_FOLDER = `${OSINT_COPILOT_CUSTOM_ROOT}/prompts`;
export const DEFAULT_SKILLS_FOLDER = `${OSINT_COPILOT_CUSTOM_ROOT}/skills`;
export const DEFAULT_TASK_AGENTS_FOLDER = `${OSINT_COPILOT_CUSTOM_ROOT}/task-agents`;

/** Global allowlist prefixes for task-agent vault writes (newline-separated). */
export const DEFAULT_TASK_AGENT_OUTPUT_ALLOWLIST = `${OSINT_COPILOT_CUSTOM_ROOT}/outputs/\nResearch/`;

export const GRAPH_NODE_POSITIONS_FILE = `${OSINT_COPILOT_VAULT_ROOT}/graph-positions.json`;

/** Folder for `custom-types.json` (FTM extensions). */
export const CUSTOM_TYPES_CONFIG_DIR = OSINT_COPILOT_CUSTOM_ROOT;
export const CUSTOM_TYPES_FILE_NAME = "custom-types.json";
