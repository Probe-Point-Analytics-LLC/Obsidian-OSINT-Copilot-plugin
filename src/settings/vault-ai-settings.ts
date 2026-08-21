import type { CustomAgentRuntime } from "../services/agent-runtime/runtime-registry";
import {
	CLAUDE_RUNTIME_ID,
} from "../services/agent-runtime/runtime-registry";
import type { EnabledSchemaFamilies } from "../services/schema-catalog-types";
import {
	DEFAULT_ENABLED_SCHEMA_FAMILIES,
	DEFAULT_OIDSF_MODAL_LAYERS,
	type OIDSFModalLayers,
} from "../services/schema-catalog-types";
import {
	DEFAULT_CONVERSATION_FOLDER,
	DEFAULT_CREDENTIALS_FOLDER,
	DEFAULT_ENRICHERS_FOLDER,
	DEFAULT_PROMPTS_FOLDER,
	DEFAULT_SCRIPTS_FOLDER,
	DEFAULT_SKILLS_FOLDER,
	DEFAULT_TASK_AGENTS_FOLDER,
	DEFAULT_TASK_AGENT_OUTPUT_ALLOWLIST,
} from "../constants/vault-layout";

export interface VaultAISettings {
	systemPrompt: string;
	maxNotes: number;
	entityBasePath: string;
	enableGraphFeatures: boolean;
	autoRefreshGraph: boolean;
	autoOpenGraphOnEntityCreation: boolean;
	advancedGraphMode: boolean;
	conversationFolder: string;
	promptsFolder: string;
	activeAgentId: string;
	taskAgentsFolder: string;
	taskAgentsEnabled: boolean;
	preferredTaskAgentId: string;
	taskAgentGlobalOutputAllowlist: string;
	taskAgentOverrides: Record<string, boolean>;
	skillsFolder: string;
	enrichersFolder: string;
	credentialsFolder: string;
	scriptsFolder: string;
	apiProvider: "claude-code" | "codex";
	claudeCodeCliPath: string;
	claudeCodeModel: string;
	claudeCodeExtraArgs: string;
	claudeCodeTimeoutMs: number;
	codexCliPath: string;
	codexCliModel: string;
	codexCliExtraArgs: string;
	codexCliTimeoutMs: number;
	agentRuntimeProvider: string;
	hermesAgentCliPath: string;
	hermesAgentExtraArgs: string;
	hermesAgentTimeoutMs: number;
	hermesAgentHealthCheckArgs: string;
	customAgentRuntimes: CustomAgentRuntime[];
	extractionLogVerbosity: "minimal" | "detailed";
	extractionDebugRawCli: boolean;
	customCheckpoints: CustomCheckpoint[];
	themeMode: "system" | "light" | "dark";
	lockedVaultPaths: string[];
	activeGraphId: string;
	graphWorkspaces: { id: string; name: string }[];
	enabledSchemaFamilies: EnabledSchemaFamilies;
	oidsfModalLayers: OIDSFModalLayers;
}

export interface CustomCheckpoint {
	id: string;
	name: string;
	url: string;
	apiKey: string;
	model: string;
	type?: "openai" | "mindsdb";
}

export const DEFAULT_SETTINGS: VaultAISettings = {
	systemPrompt:
		"You are a vault assistant. Answer questions clearly and concisely based on the provided notes. Cite note paths in-line where useful.",
	maxNotes: 15,
	entityBasePath: "OSINTCopilot",
	enableGraphFeatures: true,
	autoRefreshGraph: true,
	autoOpenGraphOnEntityCreation: false,
	advancedGraphMode: true,
	conversationFolder: DEFAULT_CONVERSATION_FOLDER,
	promptsFolder: DEFAULT_PROMPTS_FOLDER,
	activeAgentId: "default",
	taskAgentsFolder: DEFAULT_TASK_AGENTS_FOLDER,
	taskAgentsEnabled: true,
	preferredTaskAgentId: "",
	taskAgentGlobalOutputAllowlist: DEFAULT_TASK_AGENT_OUTPUT_ALLOWLIST,
	taskAgentOverrides: {},
	skillsFolder: DEFAULT_SKILLS_FOLDER,
	enrichersFolder: DEFAULT_ENRICHERS_FOLDER,
	credentialsFolder: DEFAULT_CREDENTIALS_FOLDER,
	scriptsFolder: DEFAULT_SCRIPTS_FOLDER,
	apiProvider: "claude-code",
	claudeCodeCliPath: "claude",
	claudeCodeModel: "sonnet",
	claudeCodeExtraArgs: "",
	claudeCodeTimeoutMs: 300_000,
	codexCliPath: "codex",
	codexCliModel: "",
	codexCliExtraArgs: "",
	codexCliTimeoutMs: 300_000,
	agentRuntimeProvider: CLAUDE_RUNTIME_ID,
	hermesAgentCliPath: "hermes",
	hermesAgentExtraArgs: "",
	hermesAgentTimeoutMs: 120_000,
	hermesAgentHealthCheckArgs: "--version",
	customAgentRuntimes: [],
	extractionLogVerbosity: "detailed",
	extractionDebugRawCli: false,
	customCheckpoints: [],

	themeMode: "system",

	lockedVaultPaths: [],
	activeGraphId: "default",
	graphWorkspaces: [{ id: "default", name: "Default" }],
	enabledSchemaFamilies: { ...DEFAULT_ENABLED_SCHEMA_FAMILIES },
	oidsfModalLayers: { ...DEFAULT_OIDSF_MODAL_LAYERS },
};
