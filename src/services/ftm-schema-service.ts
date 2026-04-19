/**
 * Schema registry for the bundled **OIDSF unified ontology** (FollowTheMoney-shaped YAML).
 * Source: `oidsf/spec/schemata/*.yaml` compiled into `src/generated/oidsfBundledSchemas.ts`
 * via `npm run generate:schemas`.
 */

import { OIDSF_BUNDLED_SCHEMAS } from '../generated/oidsfBundledSchemas';
import { canonicalSchemaName } from './schema-name-aliases';
import type { OIDSFModalLayers } from './schema-catalog-types';

/** @public Layer id for bundled OIDSF schemata in pickers */
export type SchemaModalLayer = 'world' | 'links' | 'cyber' | 'analysis';

export interface FTMPropertyDefinition {
	label: string;
	type?: string;
	description?: string;
	hidden?: boolean;
	matchable?: boolean;
	deprecated?: boolean;
	format?: string;
	maxLength?: number;
	range?: string;
	reverse?: {
		name: string;
		label: string;
	};
	options?: string[];
}

export interface FTMSchemaDefinition {
	name: string;
	label: string;
	plural: string;
	description: string;
	extends: string[];
	abstract?: boolean;
	matchable?: boolean;
	generated?: boolean;
	featured: string[];
	required: string[];
	caption: string[];
	properties: Record<string, FTMPropertyDefinition>;
	color?: string;
}

export interface ResolvedFTMSchema extends FTMSchemaDefinition {
	allProperties: Record<string, FTMPropertyDefinition>;
	defaultProperties: string[];
	optionalProperties: string[];
}

const ALL_SCHEMAS: Record<string, Partial<FTMSchemaDefinition>> = OIDSF_BUNDLED_SCHEMAS as Record<
	string,
	Partial<FTMSchemaDefinition>
>;

/**
 * FTMSchemaServiceClass — resolves OIDSF schemata with inheritance (same as legacy FtM behavior).
 */
class FTMSchemaServiceClass {
	private resolvedSchemas: Map<string, ResolvedFTMSchema> = new Map();
	private customSchemas: Map<string, Partial<FTMSchemaDefinition>> = new Map();
	private initialized = false;

	initialize(): void {
		if (this.initialized) return;

		for (const schemaName of Object.keys(ALL_SCHEMAS)) {
			this.resolveSchema(schemaName);
		}

		for (const schemaName of this.customSchemas.keys()) {
			this.resolveSchema(schemaName);
		}

		this.initialized = true;
	}

	registerSchema(schema: Partial<FTMSchemaDefinition>): void {
		const name = schema.name;
		if (!name) return;

		this.customSchemas.set(name, schema);
		this.resolvedSchemas.delete(name);

		if (this.initialized) {
			this.resolveSchema(name);
		}
	}

	private resolveSchema(schemaName: string): ResolvedFTMSchema | null {
		const canon = canonicalSchemaName(schemaName);
		if (this.resolvedSchemas.has(canon)) {
			return this.resolvedSchemas.get(canon)!;
		}

		let schema = ALL_SCHEMAS[canon];
		if (!schema) {
			const custom = this.customSchemas.get(canon);
			if (custom) {
				schema = custom;
			}
		}

		if (!schema) {
			console.warn(`[FTMSchemaService] Schema not found: ${schemaName} (canonical: ${canon})`);
			return null;
		}

		let allProperties: Record<string, FTMPropertyDefinition> = {};

		if (schema.extends && schema.extends.length > 0) {
			for (const parentName of schema.extends) {
				const parentSchema = this.resolveSchema(parentName);
				if (parentSchema) {
					allProperties = { ...allProperties, ...parentSchema.allProperties };
				}
			}
		}

		if (schema.properties) {
			allProperties = { ...allProperties, ...schema.properties };
		}

		const required = schema.required || [];
		const featured = schema.featured || [];
		const defaultProperties = [...new Set([...required, ...featured])];

		const optionalProperties = Object.keys(allProperties).filter(
			(prop) => !defaultProperties.includes(prop) && !allProperties[prop].hidden,
		);

		const resolved: ResolvedFTMSchema = {
			name: canon,
			label: schema.label || canon,
			plural: schema.plural || canon + 's',
			description: schema.description || '',
			extends: schema.extends || [],
			abstract: schema.abstract,
			matchable: schema.matchable,
			generated: schema.generated,
			featured: featured,
			required: required,
			caption: schema.caption || [],
			properties: schema.properties || {},
			allProperties,
			defaultProperties,
			optionalProperties,
			color: schema.color,
		};

		this.resolvedSchemas.set(canon, resolved);
		return resolved;
	}

	getSchema(schemaName: string): ResolvedFTMSchema | null {
		this.initialize();
		const canon = canonicalSchemaName(schemaName);
		return this.resolvedSchemas.get(canon) || null;
	}

	/** All non-abstract schemata (includes interval/edge types). */
	getEntitySchemas(): ResolvedFTMSchema[] {
		this.initialize();
		return Array.from(this.resolvedSchemas.values()).filter((schema) => !schema.abstract);
	}

	/**
	 * Non-abstract schemata that are not interval/relationship shapes — used for “new entity” modals.
	 */
	getCoreEntitySchemas(): ResolvedFTMSchema[] {
		return this.getEntitySchemas().filter((schema) => !this.extendsInterval(schema));
	}

	getIntervalSchemas(): ResolvedFTMSchema[] {
		this.initialize();
		return Array.from(this.resolvedSchemas.values()).filter(
			(schema) => !schema.abstract && this.extendsInterval(schema),
		);
	}

	private extendsInterval(schema: ResolvedFTMSchema): boolean {
		if (schema.name === 'Interval') return false;
		if (schema.extends.includes('Interval')) return true;

		for (const parentName of schema.extends) {
			const parentSchema = this.getSchema(parentName);
			if (parentSchema && this.extendsInterval(parentSchema)) {
				return true;
			}
		}
		return false;
	}

	/** Walk inheritance to see if `ancestorName` appears in the parent chain. */
	extendsParent(schemaName: string, ancestorName: string): boolean {
		const canon = canonicalSchemaName(schemaName);
		if (canon === ancestorName) return true;
		const s = this.getSchema(canon);
		if (!s) return false;
		for (const p of s.extends) {
			if (p === ancestorName || this.extendsParent(p, ancestorName)) return true;
		}
		return false;
	}

	getSchemaModalLayer(schemaName: string): SchemaModalLayer {
		const canon = canonicalSchemaName(schemaName);
		const s = this.getSchema(canon);
		if (!s) return 'world';
		if (this.extendsInterval(s)) return 'links';
		if (this.extendsParent(canon, 'IntelObject')) return 'cyber';
		if (this.extendsParent(canon, 'AnalyticObject')) return 'analysis';
		return 'world';
	}

	/** True if this schema is an interval/relationship (edge) shape, not a core node entity. */
	isIntervalSchemaName(schemaName: string): boolean {
		return this.getSchemaModalLayer(schemaName) === 'links';
	}

	schemaPassesModalLayer(schemaName: string, layers: OIDSFModalLayers): boolean {
		const layer = this.getSchemaModalLayer(schemaName);
		return layers[layer] === true;
	}

	getSchemaNames(): string[] {
		this.initialize();
		return Array.from(this.resolvedSchemas.keys());
	}

	getEntitySchemaNames(): string[] {
		return this.getEntitySchemas().map((s) => s.name);
	}

	hasSchema(schemaName: string): boolean {
		this.initialize();
		const canon = canonicalSchemaName(schemaName);
		return this.resolvedSchemas.has(canon);
	}

	getLabelField(schemaName: string): string {
		const canon = canonicalSchemaName(schemaName);
		const schema = this.getSchema(canon);
		if (!schema) return 'name';

		for (const field of schema.caption) {
			if (schema.allProperties[field]) {
				return field;
			}
		}
		return 'name';
	}

	getColor(schemaName: string): string {
		const schema = this.getSchema(schemaName);
		return schema?.color || '#607D8B';
	}

	getProperty(schemaName: string, propertyName: string): FTMPropertyDefinition | null {
		const schema = this.getSchema(schemaName);
		if (!schema) return null;
		return schema.allProperties[propertyName] || null;
	}

	getEntityLabel(schemaName: string, properties: Record<string, unknown>): string {
		const canon = canonicalSchemaName(schemaName);
		const labelField = this.getLabelField(canon);
		if (properties[labelField]) {
			return String(properties[labelField]);
		}

		const fallbackFields = ['full_name', 'name', 'title', 'address', 'label'];
		for (const field of fallbackFields) {
			if (properties[field] && typeof properties[field] === 'string' && properties[field].trim()) {
				return String(properties[field]);
			}
		}

		return schemaName;
	}
}

export const ftmSchemaService = new FTMSchemaServiceClass();

export { FTMSchemaServiceClass };
