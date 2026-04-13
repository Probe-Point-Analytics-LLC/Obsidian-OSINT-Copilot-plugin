/**
 * Unified schema catalog: FTM (bundled + custom registrations) + vault YAML (STIX2, MITRE, user).
 */

import { App, normalizePath, TFile, TFolder } from 'obsidian';
import { ftmSchemaService, type FTMPropertyDefinition } from './ftm-schema-service';
import {
	getAvailableFTMEntityTypes,
	getAvailableFTMIntervalTypes,
	getEntityColor,
} from '../entities/types';
import {
	parseEntityYaml,
	parseRelationshipYaml,
	yamlEntityToCatalog,
	yamlRelationshipToCatalog,
	parseCombinedSchemaYaml,
} from './schema-definition-loader';
import type {
	CatalogEntityType,
	CatalogRelationshipType,
	EnabledSchemaFamilies,
	SchemaFamily,
} from './schema-catalog-types';
import { DEFAULT_ENABLED_SCHEMA_FAMILIES } from './schema-catalog-types';

function ftmPropsToCatalog(
	all: Record<string, FTMPropertyDefinition>,
): Record<string, { label: string; type?: string; description?: string }> {
	const out: Record<string, { label: string; type?: string; description?: string }> = {};
	for (const [k, v] of Object.entries(all)) {
		out[k] = { label: v.label, type: v.type, description: v.description };
	}
	return out;
}

export class SchemaCatalogService {
	private app: App;
	private getEntityBasePath: () => string;
	private entities = new Map<string, CatalogEntityType>();
	private relationships = new Map<string, CatalogRelationshipType>();

	constructor(app: App, getEntityBasePath: () => string) {
		this.app = app;
		this.getEntityBasePath = getEntityBasePath;
	}

	/** Full rebuild: FTM from service + vault YAML. */
	async rebuild(): Promise<void> {
		this.entities.clear();
		this.relationships.clear();
		this.registerFtmEntities();
		this.registerFtmRelationships();
		await this.loadVaultStix2();
		await this.loadVaultMitre();
		await this.loadVaultUser();
	}

	private registerFtmEntities(): void {
		ftmSchemaService.initialize();
		for (const t of getAvailableFTMEntityTypes()) {
			const sch = ftmSchemaService.getSchema(t.name);
			if (!sch) continue;
			const key = `ftm:${sch.name}`;
			this.entities.set(key, {
				family: 'ftm',
				name: sch.name,
				label: sch.label,
				plural: sch.plural,
				description: sch.description,
				color: sch.color || t.color,
				labelField: ftmSchemaService.getLabelField(sch.name),
				required: [...sch.required],
				featured: [...sch.featured],
				properties: ftmPropsToCatalog(sch.allProperties),
			});
		}
	}

	private registerFtmRelationships(): void {
		ftmSchemaService.initialize();
		for (const t of getAvailableFTMIntervalTypes()) {
			const sch = ftmSchemaService.getSchema(t.name);
			if (!sch) continue;
			const key = `ftm:${sch.name}`;
			this.relationships.set(key, {
				family: 'ftm',
				name: sch.name,
				label: sch.label,
				description: sch.description,
				color: sch.color || t.color,
				featured: [...sch.featured],
				required: [...sch.required],
				properties: ftmPropsToCatalog(sch.allProperties),
			});
		}
	}

	private async loadVaultStix2(): Promise<void> {
		const base = normalizePath(`${this.getEntityBasePath()}/schemas/stix2`);
		await this.loadEntityYamlFile(`${base}/entities.yaml`, 'stix2');
		await this.loadRelationshipYamlFile(`${base}/relationships.yaml`, 'stix2');
	}

	private async loadVaultMitre(): Promise<void> {
		const base = normalizePath(`${this.getEntityBasePath()}/schemas/mitre`);
		await this.loadEntityYamlFile(`${base}/entities.yaml`, 'mitre');
		await this.loadRelationshipYamlFile(`${base}/relationships.yaml`, 'mitre');
	}

	private async loadEntityYamlFile(path: string, expectedFamily: SchemaFamily): Promise<void> {
		try {
			if (!(await this.app.vault.adapter.exists(path))) return;
			const content = await this.app.vault.adapter.read(path);
			const parsed = parseEntityYaml(content, path);
			if (parsed.family !== expectedFamily) {
				console.warn(`[SchemaCatalog] ${path}: family mismatch`);
				return;
			}
			for (const raw of parsed.entityTypes) {
				const cat = yamlEntityToCatalog(raw, parsed.family);
				this.entities.set(`${cat.family}:${cat.name}`, cat);
			}
		} catch (e) {
			console.error(`[SchemaCatalog] Failed to load ${path}:`, e);
		}
	}

	private async loadRelationshipYamlFile(path: string, expectedFamily: SchemaFamily): Promise<void> {
		try {
			if (!(await this.app.vault.adapter.exists(path))) return;
			const content = await this.app.vault.adapter.read(path);
			const parsed = parseRelationshipYaml(content, path);
			if (parsed.family !== expectedFamily) {
				console.warn(`[SchemaCatalog] ${path}: family mismatch`);
				return;
			}
			for (const raw of parsed.relationshipTypes) {
				const cat = yamlRelationshipToCatalog(raw, parsed.family);
				this.relationships.set(`${parsed.family}:${raw.name}`, cat);
			}
		} catch (e) {
			console.error(`[SchemaCatalog] Failed to load ${path}:`, e);
		}
	}

	private async loadVaultUser(): Promise<void> {
		const dir = normalizePath(`${this.getEntityBasePath()}/schemas/user`);
		const folder = this.app.vault.getAbstractFileByPath(dir);
		if (!folder || !(folder instanceof TFolder)) return;

		for (const child of folder.children) {
			if (!(child instanceof TFile)) continue;
			const lower = child.name.toLowerCase();
			if (!lower.endsWith('.yaml') && !lower.endsWith('.yml')) continue;
			if (child.name === 'example-user-types.yaml') continue;
			try {
				const content = await this.app.vault.read(child);
				this.ingestUserYaml(content, child.path);
			} catch (e) {
				console.error(`[SchemaCatalog] Failed to read ${child.path}:`, e);
			}
		}
	}

	private ingestUserYaml(content: string, path: string): void {
		try {
			const combined = parseCombinedSchemaYaml(content);
			if (combined.family !== 'user') {
				console.warn(`[SchemaCatalog] ${path}: user folder files should use family: user`);
				return;
			}
			for (const e of combined.entityTypes) {
				this.entities.set(`user:${e.name}`, e);
			}
			for (const r of combined.relationshipTypes) {
				this.relationships.set(`user:${r.name}`, r);
			}
		} catch {
			// try entity-only or relationship-only
			try {
				const ent = parseEntityYaml(content, path);
				if (ent.family !== 'user') return;
				for (const raw of ent.entityTypes) {
					const cat = yamlEntityToCatalog(raw, 'user');
					this.entities.set(`user:${cat.name}`, cat);
				}
			} catch {
				try {
					const rel = parseRelationshipYaml(content, path);
					if (rel.family !== 'user') return;
					for (const raw of rel.relationshipTypes) {
						const cat = yamlRelationshipToCatalog(raw, 'user');
						this.relationships.set(`user:${raw.name}`, cat);
					}
				} catch (e2) {
					console.error(`[SchemaCatalog] Could not parse ${path}:`, e2);
				}
			}
		}
	}

	listEntityTypes(enabled: EnabledSchemaFamilies): CatalogEntityType[] {
		const list: CatalogEntityType[] = [];
		for (const [, v] of this.entities) {
			if (!this.isFamilyEnabled(v.family, enabled)) continue;
			list.push(v);
		}
		return list.sort((a, b) => {
			const fa = a.family.localeCompare(b.family);
			if (fa !== 0) return fa;
			return a.label.localeCompare(b.label);
		});
	}

	listRelationshipTypes(enabled: EnabledSchemaFamilies): CatalogRelationshipType[] {
		const list: CatalogRelationshipType[] = [];
		for (const [, v] of this.relationships) {
			if (!this.isFamilyEnabled(v.family, enabled)) continue;
			list.push(v);
		}
		return list.sort((a, b) => {
			const fa = a.family.localeCompare(b.family);
			if (fa !== 0) return fa;
			return a.label.localeCompare(b.label);
		});
	}

	private isFamilyEnabled(family: SchemaFamily, enabled: EnabledSchemaFamilies): boolean {
		switch (family) {
			case 'ftm':
				return enabled.ftm;
			case 'stix2':
				return enabled.stix2;
			case 'mitre':
				return enabled.mitre;
			case 'user':
				return enabled.user;
			default:
				return true;
		}
	}

	getEntityType(family: SchemaFamily, name: string): CatalogEntityType | undefined {
		return this.entities.get(`${family}:${name}`);
	}

	getRelationshipType(family: SchemaFamily, name: string): CatalogRelationshipType | undefined {
		return this.relationships.get(`${family}:${name}`);
	}

	/** Resolve from persisted entity (schemaFamily + type name). */
	resolveEntityLabelColor(entity: { schemaFamily?: SchemaFamily; type: string; ftmSchema?: string }): {
		label: string;
		color: string;
	} {
		const family = entity.schemaFamily ?? 'ftm';
		const typeName =
			family === 'ftm' && entity.ftmSchema ? entity.ftmSchema : String(entity.type);
		const cat = this.getEntityType(family, typeName);
		const label = cat?.label ?? typeName;
		const color = cat?.color ?? '#607D8B';
		return { label, color };
	}

	/** Display label for an entity instance (uses labelField from catalog when not FTM). */
	getInstanceLabel(entity: {
		schemaFamily?: SchemaFamily;
		type: string;
		ftmSchema?: string;
		label: string;
		properties: Record<string, unknown>;
	}): string {
		const family = entity.schemaFamily ?? 'ftm';
		const typeName = family === 'ftm' && entity.ftmSchema ? entity.ftmSchema : String(entity.type);
		if (family === 'ftm' && ftmSchemaService.hasSchema(typeName)) {
			return ftmSchemaService.getEntityLabel(typeName, entity.properties);
		}
		const cat = this.getEntityType(family, typeName);
		if (cat) {
			const v = entity.properties[cat.labelField];
			if (v !== undefined && v !== null && String(v).trim() !== '') {
				return String(v);
			}
		}
		return entity.label || typeName;
	}

	/** Node color for graph view (catalog when available). */
	getEntityVisualForGraph(entity: {
		schemaFamily?: SchemaFamily;
		type: string;
		ftmSchema?: string;
	}): { color: string } {
		const family = entity.schemaFamily ?? 'ftm';
		const typeName = family === 'ftm' && entity.ftmSchema ? entity.ftmSchema : String(entity.type);
		const cat = this.getEntityType(family, typeName);
		const color = cat?.color ?? getEntityColor(typeName);
		return { color };
	}
}

export function mergeEnabledFamilies(
	partial?: Partial<EnabledSchemaFamilies>,
): EnabledSchemaFamilies {
	return { ...DEFAULT_ENABLED_SCHEMA_FAMILIES, ...partial };
}
