/**
 * Legacy FollowTheMoney / pre-OIDSF-unification schema names → OIDSF canonical names.
 * Vault notes may still use legacy `type` / `ftmSchema` values; resolution uses canonical types.
 */

export const LEGACY_SCHEMA_NAME_ALIASES: Record<string, string> = {
	Post: 'EmploymentPost',
	UserAccount: 'OnlineAccount',
	StixObject: 'IntelObject',
	StixNote: 'AnalysisNote',
	StixIdentity: 'IntelIdentity',
	StixReport: 'IntelligenceReport',
	StixLocation: 'GeoLocation',
	StixBundle: 'CtiBundle',
	StixArtifactObservable: 'ObservableArtifact',
	StixFileObservable: 'ObservableFile',
	StixProcessObservable: 'ObservableProcess',
	ArkhamObject: 'AnalyticObject',
	ArkhamClaim: 'Claim',
	ArkhamClaimEvidence: 'ClaimEvidence',
	ArkhamHypothesis: 'Hypothesis',
	ArkhamACHEvidence: 'ACHEvidenceRow',
	ArkhamACHRating: 'ACHRating',
	ArkhamACHMatrix: 'ACHMatrix',
	ArkhamEvidenceChain: 'EvidenceChain',
	ArkhamProvenanceLink: 'ProvenanceLink',
	ArkhamTrackedArtifact: 'TrackedArtifact',
	ArkhamMediaAnalysis: 'MediaAnalysis',
	ArkhamTimelineEvent: 'TimelineEvent',
	ArkhamGraphNode: 'GraphNode',
	ArkhamGraphEdge: 'GraphEdge',
	ArkhamSummary: 'InvestigationSummary',
	ArkhamContradiction: 'ClaimContradiction',
	ArkhamCredibilityAssessment: 'CredibilityAssessment',
	ArkhamProject: 'MirrorProject',
	ArkhamDocumentRecord: 'CorpusDocument',
	ArkhamEntityRecord: 'ExtractedEntityRecord',
	ArkhamSearchHit: 'SearchHit',
	ArkhamAnomaly: 'AnomalyFinding',
	ArkhamTemplate: 'ReportTemplate',
	ArkhamPremortemAnalysis: 'PremortemAnalysis',
	ArkhamScenarioTree: 'ScenarioTree',
};

export function canonicalSchemaName(name: string): string {
	return LEGACY_SCHEMA_NAME_ALIASES[name] ?? name;
}
