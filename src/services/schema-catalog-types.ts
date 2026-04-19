/**
 * Unified catalog types for FTM, STIX 2, MITRE, and user YAML schemas.
 */

export type SchemaFamily = 'ftm' | 'stix2' | 'mitre' | 'user';

export interface CatalogEntityType {
	family: SchemaFamily;
	name: string;
	label: string;
	plural: string;
	description: string;
	color: string;
	labelField: string;
	required: string[];
	featured: string[];
	properties: Record<string, { label: string; type?: string; description?: string }>;
}

export interface CatalogRelationshipType {
	family: SchemaFamily;
	name: string;
	label: string;
	description: string;
	color: string;
	featured: string[];
	required: string[];
	properties: Record<string, { label: string; type?: string; description?: string }>;
}

/** Settings shape (also persisted in VaultAISettings). */
export interface EnabledSchemaFamilies {
	ftm: boolean;
	stix2: boolean;
	mitre: boolean;
	user: boolean;
}

export const DEFAULT_ENABLED_SCHEMA_FAMILIES: EnabledSchemaFamilies = {
	ftm: true,
	stix2: true,
	mitre: true,
	user: true,
};

/**
 * Layer toggles for OIDSF-derived bundled schemata in entity/connection type pickers.
 * Full graph resolution still uses every schema; this only filters modal lists.
 */
export interface OIDSFModalLayers {
	world: boolean;
	links: boolean;
	cyber: boolean;
	analysis: boolean;
}

export const DEFAULT_OIDSF_MODAL_LAYERS: OIDSFModalLayers = {
	world: true,
	links: true,
	cyber: false,
	analysis: false,
};

export function mergeOidsfModalLayers(
	partial?: Partial<OIDSFModalLayers>,
): OIDSFModalLayers {
	return { ...DEFAULT_OIDSF_MODAL_LAYERS, ...partial };
}
