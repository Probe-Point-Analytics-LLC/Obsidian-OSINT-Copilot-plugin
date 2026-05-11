import type { CustomVaultOperation } from "../services/custom-vault-operations";
import type { OrchestrationPlan } from "../services/orchestration-plan";
import type { ExtractionLogEvent } from "../services/claude-code-service";
import type { IndexedNote } from "./indexed-note";

export interface CreatedEntityInfo {
	id: string;
	type: string;
	label: string;
	filePath: string;
}

export interface ChatHistoryItem {
	role: "user" | "assistant";
	content: string;
	notes?: IndexedNote[];
	jobId?: string;
	status?: string;
	progress?: { message: string; percent: number };
	multiProgress?: Record<string, { message: string; percent: number }>;
	orchestrationAbortByToolId?: Record<string, AbortController>;
	orchestrationDisplayToToolId?: Record<string, string>;
	query?: string;
	intermediateResults?: string[];
	createdEntities?: CreatedEntityInfo[];
	connectionsCreated?: number;
	reportFilePath?: string;
	usedEntities?: { id: string; label: string; type: string }[];
	proposedModifications?: string[];
	proposedCustomVaultOps?: CustomVaultOperation[];
	proposedPlan?: OrchestrationPlan;
	toolResults?: Record<string, any>;
	savedPlan?: OrchestrationPlan;
	savedQuery?: string;
	vaultIngestPreviewCommands?: string[];
	vaultIngestLiveLog?: string[];
	extractionLogs?: ExtractionLogEvent[];
	extractionLogsExpanded?: boolean;
}
