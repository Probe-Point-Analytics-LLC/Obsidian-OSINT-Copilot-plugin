/**
 * Built-in orchestration tool ids (not vault files). Planner may also emit SKILL_* / ENRICH_* — those map to vault skills / enricher JSON in the registry view.
 */
export interface BuiltInOrchestrationTool {
	id: string;
	title: string;
	description: string;
}

export const BUILT_IN_ORCHESTRATION_TOOLS: BuiltInOrchestrationTool[] = [
	{
		id: 'LOCAL_VAULT',
		title: 'Local vault search',
		description:
			'Searches markdown notes in the vault for keywords from the user query. Runs inside the plugin during orchestration (no separate vault file).',
	},
	{
		id: 'EXTRACT_TO_GRAPH',
		title: 'Extract to graph',
		description:
			'Runs local Claude on attachment text to propose graph commands (entities/relationships). Results are reviewed before applying to the vault graph.',
	},
	{
		id: 'VAULT_GRAPH_INGEST',
		title: 'Vault graph ingest',
		description:
			'Batch-reads vault paths and proposes/applies graph operations from note content. Used from dedicated chat flows; not a user-editable file.',
	},
];

export const DYNAMIC_PLANNER_TOOLS_NOTE =
	'The planner may also call `SKILL_<id>` and `ENRICH_<id>` — those map to vault markdown skills and enricher JSON files shown in the Skills and Enrichers columns.';
