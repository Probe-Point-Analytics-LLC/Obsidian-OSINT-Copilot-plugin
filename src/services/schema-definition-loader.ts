/**
 * Load entity/relationship schema definitions from vault YAML files.
 */

import { parse as parseYaml } from 'yaml';
import type { CatalogEntityType, CatalogRelationshipType, SchemaFamily } from './schema-catalog-types';

export interface YamlPropertyDef {
	label: string;
	type?: string;
	description?: string;
}

/** Root shape for entities.yaml / merged user files. */
export interface YamlEntityFileV1 {
	version?: number;
	family: SchemaFamily;
	entityTypes: YamlEntityTypeInput[];
}

export interface YamlEntityTypeInput {
	name: string;
	label: string;
	plural?: string;
	description?: string;
	color?: string;
	labelField?: string;
	required?: string[];
	featured?: string[];
	properties?: Record<string, YamlPropertyDef | string>;
}

export interface YamlRelationshipFileV1 {
	version?: number;
	family: SchemaFamily;
	relationshipTypes: YamlRelationshipTypeInput[];
}

export interface YamlRelationshipTypeInput {
	name: string;
	label: string;
	description?: string;
	color?: string;
	featured?: string[];
	required?: string[];
	properties?: Record<string, YamlPropertyDef | string>;
}

function normalizeProperties(
	raw: Record<string, YamlPropertyDef | string> | undefined,
): Record<string, { label: string; type?: string; description?: string }> {
	const out: Record<string, { label: string; type?: string; description?: string }> = {};
	if (!raw) return out;
	for (const [key, val] of Object.entries(raw)) {
		if (typeof val === 'string') {
			out[key] = { label: val };
		} else {
			out[key] = { label: val.label, type: val.type, description: val.description };
		}
	}
	return out;
}

export function parseEntityYaml(content: string, _path: string): YamlEntityFileV1 {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const doc = parseYaml(content) as any;
	if (!doc || typeof doc !== 'object') {
		throw new Error('Invalid YAML: expected object root');
	}
	if (!doc.family || !['stix2', 'mitre', 'user'].includes(doc.family)) {
		throw new Error('Invalid schema file: family must be stix2, mitre, or user');
	}
	if (!Array.isArray(doc.entityTypes)) {
		throw new Error('Invalid schema file: entityTypes must be an array');
	}
	return doc as YamlEntityFileV1;
}

export function parseRelationshipYaml(content: string, _path: string): YamlRelationshipFileV1 {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const doc = parseYaml(content) as any;
	if (!doc || typeof doc !== 'object') {
		throw new Error('Invalid YAML: expected object root');
	}
	if (!doc.family || !['stix2', 'mitre', 'user'].includes(doc.family)) {
		throw new Error('Invalid schema file: family must be stix2, mitre, or user');
	}
	if (!Array.isArray(doc.relationshipTypes)) {
		throw new Error('Invalid schema file: relationshipTypes must be an array');
	}
	return doc as YamlRelationshipFileV1;
}

/** Optional combined file with both keys (user convenience). */
export function parseCombinedSchemaYaml(content: string): {
	family: SchemaFamily;
	entityTypes: CatalogEntityType[];
	relationshipTypes: CatalogRelationshipType[];
} {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const doc = parseYaml(content) as any;
	if (!doc?.family) throw new Error('Invalid YAML: missing family');
	const family = doc.family as SchemaFamily;
	const entityTypes: CatalogEntityType[] = [];
	const relationshipTypes: CatalogRelationshipType[] = [];
	if (Array.isArray(doc.entityTypes)) {
		for (const t of doc.entityTypes) {
			entityTypes.push(yamlEntityToCatalog(t, family));
		}
	}
	if (Array.isArray(doc.relationshipTypes)) {
		for (const t of doc.relationshipTypes) {
			relationshipTypes.push(yamlRelationshipToCatalog(t, family));
		}
	}
	return { family, entityTypes, relationshipTypes };
}

export function yamlEntityToCatalog(input: YamlEntityTypeInput, family: SchemaFamily): CatalogEntityType {
	const props = normalizeProperties(input.properties);
	const required = input.required ?? [];
	const featured = input.featured ?? (required.length ? required : ['name']);
	const labelField = input.labelField ?? 'name';
	return {
		family,
		name: input.name,
		label: input.label,
		plural: input.plural ?? `${input.label}s`,
		description: input.description ?? '',
		color: input.color ?? '#607D8B',
		labelField,
		required,
		featured,
		properties: props,
	};
}

export function yamlRelationshipToCatalog(
	input: YamlRelationshipTypeInput,
	family: SchemaFamily,
): CatalogRelationshipType {
	const props = normalizeProperties(input.properties);
	return {
		family,
		name: input.name,
		label: input.label,
		description: input.description ?? '',
		color: input.color ?? '#9E9E9E',
		featured: input.featured ?? [],
		required: input.required ?? [],
		properties: props,
	};
}
