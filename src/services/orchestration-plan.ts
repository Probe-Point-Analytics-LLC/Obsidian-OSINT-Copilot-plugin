/** Planner output shape (no runtime deps on plugin entry). */
export interface OrchestrationPlan {
	reasoning: string;
	planSummary?: string;
	isProposal?: boolean;
	toolsToCall: string[];
	graphCommands: string[];
	directResponse?: string;
}
