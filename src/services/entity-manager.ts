/**
 * Entity Manager - handles entity storage as Obsidian notes.
 * Now supports both legacy EntityType and FTM schema format.
 */

import { App, TFile, TFolder, normalizePath, Notice } from 'obsidian';
import {
    Entity, EntityType, Connection, ENTITY_CONFIGS,
    getEntityLabel, generateId, sanitizeFilename, COMMON_PROPERTIES,
    getFTMEntityConfig, isFTMSchema
} from '../entities/types';
import { geocodingService, GeocodingError, GeocodingErrorType } from './geocoding-service';
import { ftmSchemaService } from './ftm-schema-service';

export class EntityManager {
    private app: App;
    private basePath: string;
    private entities: Map<string, Entity> = new Map();
    private connections: Map<string, Connection> = new Map();

    constructor(app: App, basePath: string = 'OSINTCopilot') {
        this.app = app;
        this.basePath = basePath;
    }

    /**
     * Set the base path for entity storage.
     */
    setBasePath(path: string): void {
        this.basePath = path;
    }

    /**
     * Initialize the entity manager and load existing entities.
     */
    async initialize(): Promise<void> {
        // Ensure base folder exists
        await this.ensureFolderExists(this.basePath);

        // Create type folders
        for (const type of Object.values(EntityType)) {
            await this.ensureFolderExists(`${this.basePath}/${type}`);
        }

        // Ensure Connections folder exists
        await this.ensureFolderExists(`${this.basePath}/Connections`);

        // Load existing entities from notes
        await this.loadEntitiesFromNotes();
    }

    /**
     * Ensure a folder exists, creating it if necessary.
     * Handles the case where the folder already exists gracefully.
     */
    private async ensureFolderExists(path: string): Promise<void> {
        const normalizedPath = normalizePath(path);
        const folder = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (!folder) {
            try {
                await this.app.vault.createFolder(normalizedPath);
            } catch (error) {
                // Ignore "Folder already exists" errors - this can happen due to race conditions
                // or if the folder was created between our check and create call
                if (error instanceof Error && !error.message.includes('Folder already exists')) {
                    console.error(`Failed to create folder ${normalizedPath}:`, error);
                    throw error;
                }
            }
        }
    }

    /**
     * Load all entities from existing notes.
     */
    async loadEntitiesFromNotes(): Promise<void> {
        this.entities.clear();
        this.connections.clear();

        for (const type of Object.values(EntityType)) {
            const folderPath = normalizePath(`${this.basePath}/${type}`);
            const folder = this.app.vault.getAbstractFileByPath(folderPath);

            if (folder instanceof TFolder) {
                for (const file of folder.children) {
                    if (file instanceof TFile && file.extension === 'md') {
                        const entity = await this.parseEntityFromNote(file);
                        if (entity) {
                            this.entities.set(entity.id, entity);
                        }
                    }
                }
            }
        }

        // Load connections from the Connections folder
        await this.loadConnectionsFromNotes();

        // Also parse connections from entity notes (for backward compatibility)
        await this.parseConnectionsFromNotes();
    }

    /**
     * Parse an entity from a note file.
     */
    private async parseEntityFromNote(file: TFile): Promise<Entity | null> {
        try {
            const content = await this.app.vault.read(file);
            const frontmatter = this.parseFrontmatter(content);

            if (!frontmatter || !frontmatter.type || !frontmatter.id) {
                return null;
            }

            const type = frontmatter.type as EntityType;
            if (!Object.values(EntityType).includes(type)) {
                return null;
            }

            // Extract properties from frontmatter
            const properties: Record<string, unknown> = {};
            const config = ENTITY_CONFIGS[type];
            const allProps = [...config.properties, ...COMMON_PROPERTIES];

            for (const prop of allProps) {
                if (frontmatter[prop] !== undefined) {
                    properties[prop] = frontmatter[prop];
                }
            }

            return {
                id: frontmatter.id as string,
                type,
                label: (frontmatter.label as string) || getEntityLabel(type, properties),
                properties,
                filePath: file.path
            };
        } catch (error) {
            console.error(`Error parsing entity from ${file.path}:`, error);
            return null;
        }
    }

    /**
     * Parse YAML frontmatter from note content.
     */
    private parseFrontmatter(content: string): Record<string, unknown> | null {
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;

        const yaml = match[1];
        const result: Record<string, unknown> = {};

        // Simple YAML parser for frontmatter
        const lines = yaml.split('\n');
        for (const line of lines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                let value = line.substring(colonIndex + 1).trim();

                // Handle quoted strings
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }

                // Handle booleans
                if (value === 'true') result[key] = true;
                else if (value === 'false') result[key] = false;
                // Handle numbers
                else if (!isNaN(Number(value)) && value !== '') result[key] = Number(value);
                else result[key] = value;
            }
        }

        return result;
    }

    /**
     * Load connections from the Connections folder.
     */
    private async loadConnectionsFromNotes(): Promise<void> {
        const folderPath = normalizePath(`${this.basePath}/Connections`);
        const folder = this.app.vault.getAbstractFileByPath(folderPath);

        if (folder instanceof TFolder) {
            for (const file of folder.children) {
                if (file instanceof TFile && file.extension === 'md') {
                    const connection = await this.parseConnectionFromNote(file);
                    if (connection) {
                        this.connections.set(connection.id, connection);
                    }
                }
            }
        }
    }

    /**
     * Parse a connection from a note file.
     */
    private async parseConnectionFromNote(file: TFile): Promise<Connection | null> {
        try {
            const content = await this.app.vault.read(file);
            const frontmatter = this.parseFrontmatter(content);

            if (!frontmatter || frontmatter.type !== 'connection' || !frontmatter.id) {
                return null;
            }

            // Extract connection properties from frontmatter
            const properties: Record<string, unknown> = {};
            const excludedKeys = ['id', 'type', 'relationship', 'fromEntityId', 'toEntityId',
                'fromEntity', 'toEntity', 'ftmSchema', 'label'];

            for (const [key, value] of Object.entries(frontmatter)) {
                if (!excludedKeys.includes(key) && value !== undefined && value !== null) {
                    properties[key] = value;
                }
            }

            return {
                id: frontmatter.id as string,
                fromEntityId: frontmatter.fromEntityId as string,
                toEntityId: frontmatter.toEntityId as string,
                relationship: frontmatter.relationship as string,
                label: frontmatter.label as string,
                properties: Object.keys(properties).length > 0 ? properties : undefined,
                ftmSchema: frontmatter.ftmSchema as string,
                filePath: file.path
            };
        } catch (error) {
            console.error(`Error parsing connection from ${file.path}:`, error);
            return null;
        }
    }

    /**
     * Parse connections from relationship sections in notes.
     */
    private async parseConnectionsFromNotes(): Promise<void> {
        for (const entity of this.entities.values()) {
            if (!entity.filePath) continue;

            const file = this.app.vault.getAbstractFileByPath(entity.filePath);
            if (!(file instanceof TFile)) continue;

            const content = await this.app.vault.read(file);
            const connections = this.parseRelationshipsFromContent(content, entity.id);

            for (const conn of connections) {
                this.connections.set(conn.id, conn);
            }
        }
    }

    /**
     * Parse relationship wikilinks from note content.
     */
    private parseRelationshipsFromContent(content: string, fromEntityId: string): Connection[] {
        const connections: Connection[] = [];

        // Match pattern: [[Entity Name]] RELATIONSHIP_TYPE [[Target Entity]]
        // or simpler: - [[Target Entity]] RELATIONSHIP_TYPE
        const relationshipRegex = /\[\[([^\]]+)\]\]\s+([A-Z_]+)\s+\[\[([^\]]+)\]\]/g;
        const simpleRegex = /-\s+\[\[([^\]]+)\]\]\s+([A-Z_]+)/g;

        let match;

        // Full relationship pattern
        while ((match = relationshipRegex.exec(content)) !== null) {
            const targetLabel = match[3];
            const relationship = match[2];

            // Find target entity by label
            const targetEntity = this.findEntityByLabel(targetLabel);
            if (targetEntity) {
                connections.push({
                    id: generateId(),
                    fromEntityId,
                    toEntityId: targetEntity.id,
                    relationship
                });
            }
        }

        // Simple relationship pattern
        while ((match = simpleRegex.exec(content)) !== null) {
            const targetLabel = match[1];
            const relationship = match[2];

            const targetEntity = this.findEntityByLabel(targetLabel);
            if (targetEntity && targetEntity.id !== fromEntityId) {
                connections.push({
                    id: generateId(),
                    fromEntityId,
                    toEntityId: targetEntity.id,
                    relationship
                });
            }
        }

        return connections;
    }

    /**
     * Find an entity by its label.
     */
    findEntityByLabel(label: string): Entity | undefined {
        if (!label || typeof label !== 'string') return undefined;
        const searchLabel = label.toLowerCase();
        for (const entity of this.entities.values()) {
            // Ensure entity.label is a string before calling toLowerCase
            const entityLabel = entity.label != null ? String(entity.label) : '';
            if (entityLabel.toLowerCase() === searchLabel) {
                return entity;
            }
        }
        return undefined;
    }

    /**
     * Create a new entity and save it as a note.
     * @param type - The entity type
     * @param properties - The entity properties
     * @param options - Optional settings for entity creation
     * @param options.skipAutoGeocode - If true, skip automatic geocoding for Location entities (default: false)
     */
    async createEntity(
        type: EntityType,
        properties: Record<string, unknown>,
        options?: { skipAutoGeocode?: boolean }
    ): Promise<Entity> {
        const id = generateId();

        // For Location entities, attempt automatic geocoding if coordinates are missing
        // Skip if explicitly requested (e.g., for manual entity creation)
        if (type === EntityType.Location && !options?.skipAutoGeocode) {
            properties = await this.geocodeLocationIfNeeded(properties);
        }

        const label = getEntityLabel(type, properties);

        const entity: Entity = {
            id,
            type,
            label,
            properties
        };

        // Create the note
        const filePath = await this.saveEntityAsNote(entity);
        entity.filePath = filePath;

        this.entities.set(id, entity);
        return entity;
    }

    /**
     * Create a new FTM-compliant entity and save it as a note.
     * Uses FTM schema for property definitions and validation.
     * @param schemaName - The FTM schema name (e.g., 'Address', 'Person')
     * @param properties - The entity properties
     * @param options - Optional settings for entity creation
     * @param options.skipAutoGeocode - If true, skip automatic geocoding for Address entities (default: false)
     */
    async createFTMEntity(
        schemaName: string,
        properties: Record<string, unknown>,
        options?: { skipAutoGeocode?: boolean }
    ): Promise<Entity> {
        const id = generateId();
        const config = getFTMEntityConfig(schemaName);

        if (!config) {
            throw new Error(`Unknown FTM schema: ${schemaName}`);
        }

        // For Address entities, attempt automatic geocoding if coordinates are missing
        // Skip if explicitly requested (e.g., for manual entity creation)
        if (schemaName === 'Address' && !options?.skipAutoGeocode) {
            properties = await this.geocodeAddressIfNeeded(properties);
        }

        // Get label from FTM schema
        const label = ftmSchemaService.getEntityLabel(schemaName, properties);

        const entity: Entity = {
            id,
            type: schemaName as EntityType,  // Use schema name as type
            label,
            properties,
            ftmSchema: schemaName  // Store FTM schema name
        };

        // Create the note using FTM-aware save
        const filePath = await this.saveFTMEntityAsNote(entity, schemaName);
        entity.filePath = filePath;

        this.entities.set(id, entity);
        return entity;
    }

    /**
     * Geocode an Address entity's properties if coordinates are missing.
     */
    private async geocodeAddressIfNeeded(properties: Record<string, unknown>): Promise<Record<string, unknown>> {
        const hasLatitude = properties.latitude !== undefined && properties.latitude !== null && properties.latitude !== '';
        const hasLongitude = properties.longitude !== undefined && properties.longitude !== null && properties.longitude !== '';

        if (hasLatitude && hasLongitude) {
            return properties;
        }

        const address = (properties.full as string) || (properties.street as string);
        const city = properties.city as string;
        const state = (properties.state as string) || (properties.region as string);
        const country = properties.country as string;

        if (!address && !city && !state && !country) {
            return properties;
        }

        try {
            const result = await geocodingService.geocodeAddressWithRetry(address, city, state, country);
            return {
                ...properties,
                latitude: result.latitude,
                longitude: result.longitude,
                city: properties.city || result.city,
                state: properties.state || result.state,
                country: properties.country || result.country,
                postalCode: properties.postalCode || result.postalCode
            };
        } catch (error) {
            console.warn('[EntityManager] FTM Address geocoding failed:', error);
            return properties;
        }
    }

    /**
     * Save an FTM entity as an Obsidian note.
     */
    private async saveFTMEntityAsNote(entity: Entity, schemaName: string): Promise<string> {
        const filename = sanitizeFilename(entity.label);
        const folderPath = normalizePath(`${this.basePath}/${schemaName}`);

        // Ensure folder exists
        await this.ensureFolderExists(folderPath);

        const filePath = normalizePath(`${folderPath}/${filename}.md`);

        // Build frontmatter using FTM schema
        const frontmatter = this.buildFTMFrontmatter(entity, schemaName);

        // Build note content
        const content = `---
${frontmatter}
---

# ${entity.label}

## Properties

${this.buildFTMPropertiesSection(entity, schemaName)}

## Relationships

<!-- Add relationships using wikilinks: [[Entity Name]] RELATIONSHIP_TYPE [[Target Entity]] -->

## Notes

${(entity.properties.notes as string) || ''}
`;

        // Check if file exists
        const existingFile = this.app.vault.getAbstractFileByPath(filePath);
        if (existingFile instanceof TFile) {
            await this.app.vault.modify(existingFile, content);
        } else {
            await this.app.vault.create(filePath, content);
        }

        return filePath;
    }

    /**
     * Build YAML frontmatter for an FTM entity.
     */
    private buildFTMFrontmatter(entity: Entity, schemaName: string): string {
        const lines: string[] = [
            `id: "${entity.id}"`,
            `type: ${entity.type}`,
            `ftmSchema: ${schemaName}`,
            `label: "${entity.label}"`
        ];

        const config = getFTMEntityConfig(schemaName);
        if (!config) return lines.join('\n');

        // Add all properties from the entity
        for (const [prop, value] of Object.entries(entity.properties)) {
            if (value !== undefined && value !== null && value !== '') {
                if (typeof value === 'string') {
                    lines.push(`${prop}: "${value.replace(/"/g, '\\"')}"`);
                } else if (typeof value === 'boolean') {
                    lines.push(`${prop}: ${value}`);
                } else {
                    lines.push(`${prop}: ${String(value)}`);
                }
            }
        }

        return lines.join('\n');
    }

    /**
     * Build the properties section for an FTM entity note.
     */
    private buildFTMPropertiesSection(entity: Entity, schemaName: string): string {
        const lines: string[] = [];
        const config = getFTMEntityConfig(schemaName);

        if (!config) return '_No properties set_';

        // Show required and featured properties first
        const priorityProps = [...config.requiredProperties, ...config.featuredProperties];
        const shownProps = new Set<string>();

        for (const prop of priorityProps) {
            if (shownProps.has(prop)) continue;
            shownProps.add(prop);

            const value = entity.properties[prop];
            const propDef = config.propertyDefinitions[prop];
            const label = propDef?.label || prop;

            if (value !== undefined && value !== null && value !== '') {
                lines.push(`- **${label}**: ${String(value)}`);
            }
        }

        // Show other properties
        for (const [prop, value] of Object.entries(entity.properties)) {
            if (shownProps.has(prop)) continue;
            if (value === undefined || value === null || value === '') continue;
            if (prop === 'notes') continue;  // Notes shown separately

            const propDef = config.propertyDefinitions[prop];
            const label = propDef?.label || prop;
            lines.push(`- **${label}**: ${String(value)}`);
        }

        return lines.length > 0 ? lines.join('\n') : '_No properties set_';
    }

    /**
     * Geocode a Location entity's properties if coordinates are missing.
     * Uses the address, city, state, country fields to build a geocoding query.
     */
    private async geocodeLocationIfNeeded(properties: Record<string, unknown>): Promise<Record<string, unknown>> {
        // Check if coordinates already exist and are valid
        const hasLatitude = properties.latitude !== undefined && properties.latitude !== null && properties.latitude !== '';
        const hasLongitude = properties.longitude !== undefined && properties.longitude !== null && properties.longitude !== '';

        if (hasLatitude && hasLongitude) {
            console.debug('[EntityManager] Location already has coordinates:', properties.latitude, properties.longitude);
            return properties;
        }

        // Build geocoding query from available address fields
        const address = properties.address as string;
        const city = properties.city as string;
        const state = properties.state as string;
        const country = properties.country as string;

        // Need at least one field to geocode
        if (!address && !city && !state && !country) {
            console.debug('[EntityManager] No address fields available for geocoding');
            return properties;
        }

        try {
            console.debug('[EntityManager] Attempting to geocode location:', { address, city, state, country });
            const result = await geocodingService.geocodeAddressWithRetry(address, city, state, country);

            // Update properties with geocoded coordinates
            const updatedProperties: Record<string, unknown> = {
                ...properties,
                latitude: result.latitude,
                longitude: result.longitude
            };

            // Optionally fill in missing address fields from geocoding result
            if (!city && result.city) {
                updatedProperties.city = result.city;
            }
            if (!state && result.state) {
                updatedProperties.state = result.state;
            }
            if (!country && result.country) {
                updatedProperties.country = result.country;
            }
            if (!properties.postal_code && result.postalCode) {
                updatedProperties.postal_code = result.postalCode;
            }

            console.debug('[EntityManager] Geocoding successful:', result.latitude, result.longitude, `(${result.confidence} confidence)`);
            new Notice(`📍 Location geocoded: ${result.displayName.substring(0, 50)}...`);

            return updatedProperties;

        } catch (error) {
            if (error instanceof GeocodingError) {
                console.warn('[EntityManager] Geocoding failed:', error.type, error.message);
                if (error.type === GeocodingErrorType.NotFound) {
                    new Notice("⚠️ could not find coordinates for location. You can add them manually.");
                } else if (error.type === GeocodingErrorType.RateLimited) {
                    new Notice("⚠️ geocoding rate limited. Coordinates can be added manually.");
                } else {
                    new Notice(`⚠️ Geocoding failed: ${error.message}`);
                }
            } else {
                console.error('[EntityManager] Unexpected geocoding error:', error);
                new Notice("⚠️ could not geocode location. You can add coordinates manually.");
            }
            // Return original properties without coordinates - entity creation continues
            return properties;
        }
    }

    /**
     * Retry geocoding for a Location entity that doesn't have coordinates.
     * Updates the entity and its note file with the new coordinates.
     */
    async retryGeocoding(entityId: string): Promise<boolean> {
        const entity = this.entities.get(entityId);
        if (!entity) {
            console.warn('[EntityManager] Entity not found for geocoding retry:', entityId);
            return false;
        }

        if (entity.type !== EntityType.Location) {
            console.warn('[EntityManager] Cannot geocode non-Location entity:', entity.type);
            return false;
        }

        // Check if already has coordinates
        const hasCoords = entity.properties.latitude && entity.properties.longitude;
        if (hasCoords) {
            console.debug('[EntityManager] Entity already has coordinates');
            new Notice('📍 location already has coordinates.');
            return true;
        }

        try {
            const updatedProperties = await this.geocodeLocationIfNeeded(entity.properties);

            // Check if geocoding was successful
            if (updatedProperties.latitude && updatedProperties.longitude) {
                // Update the entity
                entity.properties = updatedProperties;
                await this.saveEntityAsNote(entity);
                console.debug('[EntityManager] Geocoding retry successful for:', entity.label);
                return true;
            } else {
                console.debug('[EntityManager] Geocoding retry did not find coordinates');
                return false;
            }
        } catch (error) {
            console.error('[EntityManager] Geocoding retry failed:', error);
            return false;
        }
    }

    /**
     * Get all Location entities that don't have coordinates.
     */
    getUnlocatedEntities(): Entity[] {
        return Array.from(this.entities.values()).filter(entity => {
            if (entity.type !== EntityType.Location) return false;
            const hasLat = entity.properties.latitude !== undefined && entity.properties.latitude !== null && entity.properties.latitude !== '';
            const hasLng = entity.properties.longitude !== undefined && entity.properties.longitude !== null && entity.properties.longitude !== '';
            return !hasLat || !hasLng;
        });
    }

    /**
     * Retry geocoding for all unlocated entities.
     * Returns the number of successfully geocoded entities.
     */
    async geocodeAllUnlocated(): Promise<{ success: number; failed: number }> {
        const unlocated = this.getUnlocatedEntities();
        let success = 0;
        let failed = 0;

        new Notice(`🌍 Geocoding ${unlocated.length} locations...`);

        for (const entity of unlocated) {
            const result = await this.retryGeocoding(entity.id);
            if (result) {
                success++;
            } else {
                failed++;
            }
            // Rate limiting is handled by the geocoding service
        }

        new Notice(`📍 Geocoding complete: ${success} succeeded, ${failed} failed`);
        return { success, failed };
    }

    /**
     * Save an entity as an Obsidian note.
     */
    private async saveEntityAsNote(entity: Entity): Promise<string> {
        const filename = sanitizeFilename(`${entity.label}_${entity.id.substring(0, 8)}`);
        const folderPath = normalizePath(`${this.basePath}/${entity.type}`);

        // Ensure the folder exists before creating the file
        await this.ensureFolderExists(folderPath);

        const filePath = normalizePath(`${folderPath}/${filename}.md`);

        // Build frontmatter
        const frontmatter = this.buildFrontmatter(entity);

        // Build note content
        const content = `---
${frontmatter}
---

# ${entity.label}

## Properties

${this.buildPropertiesSection(entity)}

## Relationships

<!-- Add relationships using wikilinks: [[Entity Name]] RELATIONSHIP_TYPE [[Target Entity]] -->

## Notes

${(entity.properties.notes as string) || ''}
`;

        // Check if file exists
        const existingFile = this.app.vault.getAbstractFileByPath(filePath);
        if (existingFile instanceof TFile) {
            await this.app.vault.modify(existingFile, content);
        } else {
            await this.app.vault.create(filePath, content);
        }

        return filePath;
    }

    /**
     * Build YAML frontmatter for an entity.
     */
    private buildFrontmatter(entity: Entity): string {
        const lines: string[] = [
            `id: "${entity.id}"`,
            `type: ${entity.type}`,
            `label: "${entity.label}"`
        ];

        const config = ENTITY_CONFIGS[entity.type as EntityType];
        if (!config) {
            // If no config found, just add all properties
            for (const [prop, value] of Object.entries(entity.properties)) {
                if (value !== undefined && value !== null && value !== '') {
                    if (typeof value === 'string') {
                        lines.push(`${prop}: "${value.replace(/"/g, '\\"')}"`);
                    } else if (typeof value === 'boolean') {
                        lines.push(`${prop}: ${value}`);
                    } else {
                        lines.push(`${prop}: ${String(value)}`);
                    }
                }
            }
        } else {
            const allProps = [...config.properties, ...COMMON_PROPERTIES];

            for (const prop of allProps) {
                const value = entity.properties[prop];
                if (value !== undefined && value !== null && value !== '') {
                    if (typeof value === 'string') {
                        lines.push(`${prop}: "${value.replace(/"/g, '\\"')}"`);
                    } else if (typeof value === 'boolean') {
                        lines.push(`${prop}: ${value}`);
                    } else {
                        lines.push(`${prop}: ${String(value)}`);
                    }
                }
            }
        }

        return lines.join('\n');
    }

    /**
     * Build the properties section for a note.
     */
    private buildPropertiesSection(entity: Entity): string {
        const lines: string[] = [];
        const config = ENTITY_CONFIGS[entity.type as EntityType];

        if (!config) {
            // If no config found, show all properties
            for (const [prop, value] of Object.entries(entity.properties)) {
                if (value !== undefined && value !== null && value !== '') {
                    lines.push(`- **${prop}**: ${value}`);
                }
            }
        } else {
            for (const prop of config.properties) {
                const value = entity.properties[prop];
                if (value !== undefined && value !== null && value !== '') {
                    lines.push(`- **${prop}**: ${value}`);
                }
            }
        }

        return lines.length > 0 ? lines.join('\n') : '_No properties set_';
    }

    /**
     * Update an existing entity.
     */
    async updateEntity(entityId: string, properties: Record<string, unknown>): Promise<Entity | null> {
        const entity = this.entities.get(entityId);
        if (!entity) return null;

        // Update properties
        entity.properties = { ...entity.properties, ...properties };

        // Update label based on entity type
        if (entity.ftmSchema) {
            // For FTM entities, use FTM schema service to get label
            entity.label = ftmSchemaService.getEntityLabel(entity.ftmSchema, entity.properties);
        } else {
            // For legacy entities, use the legacy getEntityLabel function
            entity.label = getEntityLabel(entity.type, entity.properties);
        }

        // Save updated note using appropriate method
        if (entity.ftmSchema) {
            await this.saveFTMEntityAsNote(entity, entity.ftmSchema);
        } else {
            await this.saveEntityAsNote(entity);
        }

        return entity;
    }

    /**
     * Delete an entity and its note.
     */
    async deleteEntity(entityId: string): Promise<boolean> {
        const entity = this.entities.get(entityId);
        if (!entity) return false;

        // Delete the note file
        if (entity.filePath) {
            const file = this.app.vault.getAbstractFileByPath(entity.filePath);
            if (file instanceof TFile) {
                await this.app.fileManager.trashFile(file);
            }
        }

        // Remove from maps
        this.entities.delete(entityId);

        // Remove related connections
        for (const [connId, conn] of this.connections) {
            if (conn.fromEntityId === entityId || conn.toEntityId === entityId) {
                this.connections.delete(connId);
            }
        }

        return true;
    }

    /**
     * Delete an entity without deleting the note file (for undo operations).
     */
    deleteEntityInMemory(entityId: string): boolean {
        const entity = this.entities.get(entityId);
        if (!entity) return false;

        // Remove from maps
        this.entities.delete(entityId);

        // Remove related connections
        for (const [connId, conn] of this.connections) {
            if (conn.fromEntityId === entityId || conn.toEntityId === entityId) {
                this.connections.delete(connId);
            }
        }

        return true;
    }

    /**
     * Restore an entity (for undo operations).
     * Recreates the entity and its note file.
     */
    async restoreEntity(entity: Entity): Promise<boolean> {
        try {
            // Ensure the folder exists
            const folderPath = `${this.basePath}/${entity.type}`;
            await this.ensureFolderExists(folderPath);

            // Generate note content
            const content = this.generateNoteContent(entity);

            // Create the note file
            const filePath = entity.filePath || `${folderPath}/${sanitizeFilename(entity.label)}.md`;

            // Check if file already exists
            const existingFile = this.app.vault.getAbstractFileByPath(filePath);
            if (existingFile) {
                // Update existing file
                if (existingFile instanceof TFile) {
                    await this.app.vault.modify(existingFile, content);
                }
            } else {
                // Create new file
                await this.app.vault.create(filePath, content);
            }

            // Add to entities map
            const restoredEntity = { ...entity, filePath };
            this.entities.set(entity.id, restoredEntity);

            return true;
        } catch (error) {
            console.error(`[EntityManager] Failed to restore entity:`, error);
            return false;
        }
    }

    /**
     * Update an entity (for undo/redo operations).
     */
    async updateEntityForHistory(entity: Entity): Promise<boolean> {
        try {
            // Update in-memory
            this.entities.set(entity.id, entity);

            // Update the note file
            if (entity.filePath) {
                const file = this.app.vault.getAbstractFileByPath(entity.filePath);
                if (file instanceof TFile) {
                    const content = this.generateNoteContent(entity);
                    await this.app.vault.modify(file, content);
                }
            }

            return true;
        } catch (error) {
            console.error(`[EntityManager] Failed to update entity:`, error);
            return false;
        }
    }

    /**
     * Generate note content for an entity.
     */
    private generateNoteContent(entity: Entity): string {
        const lines: string[] = [];
        const now = new Date().toISOString();

        // Frontmatter
        lines.push('---');
        lines.push(`id: ${entity.id}`);
        lines.push(`type: ${entity.type}`);
        lines.push(`label: "${entity.label.replace(/"/g, '\\"')}"`);
        lines.push(`created: ${now}`);
        lines.push(`modified: ${now}`);

        // Add properties to frontmatter
        for (const [key, value] of Object.entries(entity.properties)) {
            if (value !== undefined && value !== null && value !== '') {
                const escapedValue = typeof value === 'string'
                    ? `"${value.replace(/"/g, '\\"')}"`
                    : value;
                lines.push(`${key}: ${escapedValue}`);
            }
        }

        lines.push('---');
        lines.push('');
        lines.push(`# ${entity.label}`);
        lines.push('');
        lines.push(`**Type:** ${entity.type}`);
        lines.push('');

        // Add properties section
        if (Object.keys(entity.properties).length > 0) {
            lines.push('## Properties');
            lines.push('');
            for (const [key, value] of Object.entries(entity.properties)) {
                if (value !== undefined && value !== null && value !== '') {
                    lines.push(`- **${key}:** ${value}`);
                }
            }
            lines.push('');
        }

        // Add relationships section placeholder
        lines.push('## Relationships');
        lines.push('');

        return lines.join('\n');
    }

    /**
     * Delete multiple entities and their notes in bulk.
     * More efficient than calling deleteEntity multiple times.
     * @param entityIds Array of entity IDs to delete
     * @returns Object with count of deleted entities and array of failed entity IDs
     */
    async deleteEntities(entityIds: string[]): Promise<{ deleted: number; failed: string[] }> {
        let deleted = 0;
        const failed: string[] = [];

        // Collect all connection IDs to delete (to avoid modifying map while iterating)
        const connectionIdsToDelete: Set<string> = new Set();

        for (const entityId of entityIds) {
            try {
                const entity = this.entities.get(entityId);
                if (!entity) {
                    failed.push(entityId);
                    continue;
                }

                // Delete the note file
                if (entity.filePath) {
                    const file = this.app.vault.getAbstractFileByPath(entity.filePath);
                    if (file instanceof TFile) {
                        await this.app.fileManager.trashFile(file);
                    }
                }

                // Remove from entities map
                this.entities.delete(entityId);

                // Collect related connections for deletion
                for (const [connId, conn] of this.connections) {
                    if (conn.fromEntityId === entityId || conn.toEntityId === entityId) {
                        connectionIdsToDelete.add(connId);
                    }
                }

                deleted++;
            } catch (error) {
                console.error(`[EntityManager] Failed to delete entity ${entityId}:`, error);
                failed.push(entityId);
            }
        }

        // Delete all collected connections
        for (const connId of connectionIdsToDelete) {
            this.connections.delete(connId);
        }

        return { deleted, failed };
    }

    /**
     * Create a connection between two entities.
     * Now supports FTM interval properties and creates a connection note file.
     */
    async createConnection(
        fromEntityId: string,
        toEntityId: string,
        relationship: string,
        properties?: Record<string, unknown>
    ): Promise<Connection | null> {
        const fromEntity = this.entities.get(fromEntityId);
        const toEntity = this.entities.get(toEntityId);

        if (!fromEntity || !toEntity) return null;

        const id = generateId();

        // Create label for the connection
        const label = `${fromEntity.label} → ${relationship} → ${toEntity.label}`;

        const connection: Connection = {
            id,
            fromEntityId,
            toEntityId,
            relationship: relationship,
            label,
            properties: properties || {},
            ftmSchema: relationship  // Store the FTM interval schema name
        };

        // Create the connection note file
        const filePath = await this.saveConnectionAsNote(connection, fromEntity, toEntity);
        connection.filePath = filePath;

        this.connections.set(connection.id, connection);

        // Also update the source entity's note with the relationship (for backward compatibility)
        await this.addRelationshipToNote(fromEntity, toEntity, relationship);

        return connection;
    }

    /**
     * Update an existing connection's properties.
     * Updates both the in-memory connection and the connection note file.
     */
    async updateConnection(connectionId: string, properties: Record<string, unknown>): Promise<Connection | null> {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;

        const fromEntity = this.entities.get(connection.fromEntityId);
        const toEntity = this.entities.get(connection.toEntityId);

        if (!fromEntity || !toEntity) return null;

        // Update properties
        connection.properties = { ...connection.properties, ...properties };

        // Update the connection note file
        if (connection.filePath) {
            const file = this.app.vault.getAbstractFileByPath(connection.filePath);
            if (file instanceof TFile) {
                // Regenerate the note content with updated properties
                const content = this.generateConnectionNoteContent(connection, fromEntity, toEntity);
                await this.app.vault.modify(file, content);
            }
        } else {
            // If no file path exists, create the note
            const filePath = await this.saveConnectionAsNote(connection, fromEntity, toEntity);
            connection.filePath = filePath;
        }

        return connection;
    }

    /**
     * Update a connection (for undo/redo operations).
     */
    async updateConnectionForHistory(connection: Connection): Promise<boolean> {
        try {
            // Update in-memory
            this.connections.set(connection.id, connection);

            // Get entities for note generation
            const fromEntity = this.entities.get(connection.fromEntityId);
            const toEntity = this.entities.get(connection.toEntityId);

            if (!fromEntity || !toEntity) {
                console.error('[EntityManager] Cannot update connection: entities not found');
                return false;
            }

            // Update the note file
            if (connection.filePath) {
                const file = this.app.vault.getAbstractFileByPath(connection.filePath);
                if (file instanceof TFile) {
                    const content = this.generateConnectionNoteContent(connection, fromEntity, toEntity);
                    await this.app.vault.modify(file, content);
                }
            }

            return true;
        } catch (error) {
            console.error(`[EntityManager] Failed to update connection:`, error);
            return false;
        }
    }

    /**
     * Generate note content for a connection.
     */
    private generateConnectionNoteContent(
        connection: Connection,
        fromEntity: Entity,
        toEntity: Entity
    ): string {
        // Build frontmatter
        const frontmatter = this.buildConnectionFrontmatter(connection, fromEntity, toEntity);

        // Build note content
        return `---
${frontmatter}
---

# ${connection.label || connection.relationship}

## Connection Details

- **From**: [[${fromEntity.label}]]
- **To**: [[${toEntity.label}]]
- **Type**: ${connection.relationship}

## Properties

${this.buildConnectionPropertiesSection(connection)}

## Notes

<!-- Add additional notes about this connection here -->
`;
    }

    /**
     * Add a relationship to an entity's note.
     * Format: [[Source Entity]] RELATIONSHIP_TYPE [[Target Entity]]
     */
    async addRelationshipToNote(
        fromEntity: Entity,
        toEntity: Entity,
        relationship: string
    ): Promise<void> {
        if (!fromEntity.filePath) return;

        const file = this.app.vault.getAbstractFileByPath(fromEntity.filePath);
        if (!(file instanceof TFile)) return;

        const content = await this.app.vault.read(file);

        // Find the Relationships section and add the new relationship
        // Format: [[Source Entity]] RELATIONSHIP_TYPE [[Target Entity]]
        const relationshipLine = `- [[${fromEntity.label}]] ${relationship.toUpperCase()} [[${toEntity.label}]]`;

        const relationshipsMatch = content.match(/(## Relationships\n)([\s\S]*?)((?=\n## )|$)/);
        if (relationshipsMatch) {
            const beforeSection = content.substring(0, relationshipsMatch.index! + relationshipsMatch[1].length);
            const sectionContent = relationshipsMatch[2];
            const afterSection = content.substring(relationshipsMatch.index! + relationshipsMatch[0].length);

            // Check if this exact relationship already exists
            if (!sectionContent.includes(relationshipLine)) {
                const newContent = beforeSection + sectionContent.trimEnd() + '\n' + relationshipLine + '\n' + afterSection;
                await this.app.vault.modify(file, newContent);
            }
        }
    }

    /**
     * Add an incoming relationship to an entity's note (where the entity is the target).
     * Format: [[Source Entity]] RELATIONSHIP_TYPE [[This Entity]]
     */
    async addIncomingRelationshipToNote(
        targetEntity: Entity,
        sourceEntity: Entity,
        relationship: string
    ): Promise<void> {
        if (!targetEntity.filePath) return;

        const file = this.app.vault.getAbstractFileByPath(targetEntity.filePath);
        if (!(file instanceof TFile)) return;

        const content = await this.app.vault.read(file);

        // Format: [[Source Entity]] RELATIONSHIP_TYPE [[This Entity]]
        const relationshipLine = `- [[${sourceEntity.label}]] ${relationship.toUpperCase()} [[${targetEntity.label}]]`;

        const relationshipsMatch = content.match(/(## Relationships\n)([\s\S]*?)((?=\n## )|$)/);
        if (relationshipsMatch) {
            const beforeSection = content.substring(0, relationshipsMatch.index! + relationshipsMatch[1].length);
            const sectionContent = relationshipsMatch[2];
            const afterSection = content.substring(relationshipsMatch.index! + relationshipsMatch[0].length);

            // Check if this exact relationship already exists
            if (!sectionContent.includes(relationshipLine)) {
                const newContent = beforeSection + sectionContent.trimEnd() + '\n' + relationshipLine + '\n' + afterSection;
                await this.app.vault.modify(file, newContent);
            }
        }
    }

    /**
     * Save a connection as an Obsidian note.
     * Creates a note file in the Connections folder with connection metadata and properties.
     */
    private async saveConnectionAsNote(
        connection: Connection,
        fromEntity: Entity,
        toEntity: Entity
    ): Promise<string> {
        const filename = sanitizeFilename(`${fromEntity.label} - ${connection.relationship} - ${toEntity.label}`);
        const folderPath = normalizePath(`${this.basePath}/Connections`);
        const filePath = normalizePath(`${folderPath}/${filename}.md`);

        // Ensure the Connections folder exists
        await this.ensureFolderExists(folderPath);

        // Build frontmatter
        const frontmatter = this.buildConnectionFrontmatter(connection, fromEntity, toEntity);

        // Build note content
        const content = `---
${frontmatter}
---

# ${connection.label || connection.relationship}

## Connection Details

- **From**: [[${fromEntity.label}]]
- **To**: [[${toEntity.label}]]
- **Type**: ${connection.relationship}

## Properties

${this.buildConnectionPropertiesSection(connection)}

## Notes

<!-- Add additional notes about this connection here -->
`;

        // Check if file exists
        const existingFile = this.app.vault.getAbstractFileByPath(filePath);
        if (existingFile instanceof TFile) {
            await this.app.vault.modify(existingFile, content);
        } else {
            await this.app.vault.create(filePath, content);
        }

        return filePath;
    }

    /**
     * Build YAML frontmatter for a connection.
     */
    private buildConnectionFrontmatter(
        connection: Connection,
        fromEntity: Entity,
        toEntity: Entity
    ): string {
        const lines: string[] = [
            `id: "${connection.id}"`,
            `type: connection`,
            `relationship: "${connection.relationship}"`,
            `fromEntityId: "${connection.fromEntityId}"`,
            `toEntityId: "${connection.toEntityId}"`,
            `fromEntity: "[[${fromEntity.label}]]"`,
            `toEntity: "[[${toEntity.label}]]"`
        ];

        if (connection.ftmSchema) {
            lines.push(`ftmSchema: "${connection.ftmSchema}"`);
        }

        if (connection.label) {
            lines.push(`label: "${connection.label.replace(/"/g, '\\"')}"`);
        }

        // Add connection properties to frontmatter
        if (connection.properties) {
            for (const [key, value] of Object.entries(connection.properties)) {
                if (value !== undefined && value !== null && value !== '') {
                    if (typeof value === 'string') {
                        lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
                    } else if (typeof value === 'boolean') {
                        lines.push(`${key}: ${value}`);
                    } else {
                        lines.push(`${key}: ${value}`);
                    }
                }
            }
        }

        return lines.join('\n');
    }

    /**
     * Build the properties section for a connection note.
     */
    private buildConnectionPropertiesSection(connection: Connection): string {
        if (!connection.properties || Object.keys(connection.properties).length === 0) {
            return '_No additional properties_';
        }

        const lines: string[] = [];

        for (const [key, value] of Object.entries(connection.properties)) {
            if (value !== undefined && value !== null && value !== '') {
                // Format the key nicely (camelCase to Title Case)
                const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                lines.push(`- **${formattedKey}**: ${value}`);
            }
        }

        return lines.length > 0 ? lines.join('\n') : '_No additional properties_';
    }

    /**
     * Get a connection by ID.
     */
    getConnection(connectionId: string): Connection | undefined {
        return this.connections.get(connectionId);
    }

    /**
     * Delete a connection and remove it from the note file.
     */
    async deleteConnectionWithNote(connectionId: string): Promise<boolean> {
        const connection = this.connections.get(connectionId);
        if (!connection) return false;

        // Get the source entity to update its note
        const fromEntity = this.entities.get(connection.fromEntityId);
        if (fromEntity && fromEntity.filePath) {
            const file = this.app.vault.getAbstractFileByPath(fromEntity.filePath);
            if (file instanceof TFile) {
                try {
                    let content = await this.app.vault.read(file);

                    // Find and remove the relationship line
                    const toEntity = this.entities.get(connection.toEntityId);
                    if (toEntity) {
                        const relationshipLine = `- [[${toEntity.label}]] (${connection.relationship})`;
                        const altRelationshipLine = `- [[${toEntity.filePath?.replace('.md', '')}]] (${connection.relationship})`;

                        // Try to remove the relationship line
                        content = content.replace(new RegExp(`^${this.escapeRegex(relationshipLine)}\\n?`, 'gm'), '');
                        content = content.replace(new RegExp(`^${this.escapeRegex(altRelationshipLine)}\\n?`, 'gm'), '');

                        await this.app.vault.modify(file, content);
                    }
                } catch (error) {
                    console.error(`[EntityManager] Failed to update note for connection deletion:`, error);
                }
            }
        }

        // Remove from connections map
        return this.connections.delete(connectionId);
    }

    /**
     * Escape special regex characters in a string.
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Delete a connection (in-memory only, for backward compatibility).
     */
    deleteConnection(connectionId: string): boolean {
        return this.connections.delete(connectionId);
    }

    /**
     * Restore a connection (for undo operations).
     */
    async restoreConnection(connection: Connection): Promise<boolean> {
        // Add to connections map
        this.connections.set(connection.id, connection);

        // Update the source entity's note
        const fromEntity = this.entities.get(connection.fromEntityId);
        const toEntity = this.entities.get(connection.toEntityId);

        if (fromEntity && toEntity) {
            await this.addRelationshipToNote(fromEntity, toEntity, connection.relationship);
        }

        return true;
    }

    /**
     * Get all entities.
     */
    getAllEntities(): Entity[] {
        return Array.from(this.entities.values());
    }

    /**
     * Get entities by type.
     */
    getEntitiesByType(type: EntityType): Entity[] {
        const entities = Array.from(this.entities.values()).filter(e => e.type === type);
        console.debug(`[EntityManager] getEntitiesByType(${type}): found ${entities.length} entities`);
        if (type === EntityType.Location) {
            entities.forEach(e => {
                console.debug(`[EntityManager] Location entity: ${e.label}, lat: ${e.properties.latitude}, lng: ${e.properties.longitude}`);
            });
        }
        return entities;
    }

    /**
     * Get an entity by ID.
     */
    getEntity(id: string): Entity | undefined {
        return this.entities.get(id);
    }

    /**
     * Get all connections.
     */
    getAllConnections(): Connection[] {
        return Array.from(this.connections.values());
    }

    /**
     * Get connections for an entity.
     */
    getConnectionsForEntity(entityId: string): Connection[] {
        return Array.from(this.connections.values()).filter(
            c => c.fromEntityId === entityId || c.toEntityId === entityId
        );
    }

    /**
     * Get the full graph data.
     */
    getGraphData(): { entities: Entity[]; connections: Connection[] } {
        return {
            entities: this.getAllEntities(),
            connections: this.getAllConnections()
        };
    }

    /**
     * Open an entity's note in Obsidian.
     */
    async openEntityNote(entityId: string): Promise<void> {
        const entity = this.entities.get(entityId);
        if (!entity || !entity.filePath) return;

        const file = this.app.vault.getAbstractFileByPath(entity.filePath);
        if (file instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(file);
        }
    }
}

