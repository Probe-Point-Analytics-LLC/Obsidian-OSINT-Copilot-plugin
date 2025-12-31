/**
 * Entity types and configurations matching OSINTCopilot's entity schema.
 * Now integrated with FollowTheMoney (FTM) schema format.
 */

import { ftmSchemaService, ResolvedFTMSchema, FTMPropertyDefinition } from '../services/ftm-schema-service';

// Legacy EntityType enum - kept for backward compatibility
export enum EntityType {
    Person = "Person",
    Event = "Event",
    Location = "Location",
    Company = "Company",
    Email = "Email",
    Phone = "Phone",
    Username = "Username",
    Vehicle = "Vehicle",
    Website = "Website",
    Evidence = "Evidence",
    Image = "Image",
    Text = "Text"
}

// FTM Entity Types - these are the primary entity types from FTM schema
export type FTMEntityType =
    | 'Person'
    | 'LegalEntity'
    | 'Organization'
    | 'Company'
    | 'Event'
    | 'Address'
    | 'Vehicle'
    | 'BankAccount'
    | 'CryptoWallet'
    | 'UserAccount'
    | 'Document'
    | 'RealEstate'
    | 'Sanction'
    | 'Passport'
    | 'Ownership'
    | 'Employment'
    | 'Directorship';

// All available FTM entity type names
export const FTM_ENTITY_TYPES: FTMEntityType[] = [
    'Person',
    'Company',
    'Organization',
    'Event',
    'Address',
    'Vehicle',
    'BankAccount',
    'CryptoWallet',
    'UserAccount',
    'Document',
    'RealEstate',
    'Sanction',
    'Passport',
];

// Relationship types from FTM
export const FTM_RELATIONSHIP_TYPES: FTMEntityType[] = [
    'Ownership',
    'Employment',
    'Directorship',
];

export interface EntityConfig {
    color: string;
    properties: string[];
    labelField: string;
    description: string;
}

// FTM-aware entity configuration
export interface FTMEntityConfig {
    color: string;
    label: string;
    plural: string;
    description: string;
    labelField: string;
    /** Required properties - always shown */
    requiredProperties: string[];
    /** Featured properties - shown by default */
    featuredProperties: string[];
    /** Optional properties - shown in collapsible section */
    optionalProperties: string[];
    /** All properties with their definitions */
    propertyDefinitions: Record<string, FTMPropertyDefinition>;
}

/**
 * Get FTM entity configuration for a schema type.
 */
export function getFTMEntityConfig(schemaName: string): FTMEntityConfig | null {
    const schema = ftmSchemaService.getSchema(schemaName);
    if (!schema) return null;

    return {
        color: schema.color || '#607D8B',
        label: schema.label,
        plural: schema.plural,
        description: schema.description,
        labelField: ftmSchemaService.getLabelField(schemaName),
        requiredProperties: schema.required,
        featuredProperties: schema.featured,
        optionalProperties: schema.optionalProperties,
        propertyDefinitions: schema.allProperties,
    };
}

/**
 * Get all available FTM entity types for entity creation.
 */
export function getAvailableFTMEntityTypes(): Array<{ name: string; label: string; description: string; color: string }> {
    return ftmSchemaService.getEntitySchemas().map(schema => ({
        name: schema.name,
        label: schema.label,
        description: schema.description,
        color: schema.color || '#607D8B',
    }));
}

/**
 * Get all available FTM interval/relationship types for connection creation.
 */
export function getAvailableFTMIntervalTypes(): Array<{ name: string; label: string; description: string; color: string }> {
    return ftmSchemaService.getIntervalSchemas().map(schema => ({
        name: schema.name,
        label: schema.label,
        description: schema.description,
        color: schema.color || '#607D8B',
    }));
}

export const ENTITY_CONFIGS: Record<EntityType, EntityConfig> = {
    [EntityType.Person]: {
        color: "#4CAF50",
        properties: ["full_name", "age", "height", "nationality", "occupation"],
        labelField: "full_name",
        description: "A person representing an individual"
    },
    [EntityType.Event]: {
        color: "#F22416",
        properties: ["name", "description", "start_date", "end_date", "add_to_timeline"],
        labelField: "name",
        description: "An event with date and time"
    },
    [EntityType.Location]: {
        color: "#FF5722",
        properties: ["address", "city", "state", "country", "postal_code", "latitude", "longitude", "location_type"],
        labelField: "address",
        description: "A physical location or address"
    },
    [EntityType.Company]: {
        color: "#037d9e",
        properties: ["name", "description"],
        labelField: "name",
        description: "A company or organization"
    },
    [EntityType.Email]: {
        color: "#2196F3",
        properties: ["address", "domain"],
        labelField: "address",
        description: "An email address"
    },
    [EntityType.Phone]: {
        color: "#b82549",
        properties: ["number", "phone_type", "country_code"],
        labelField: "number",
        description: "A phone number"
    },
    [EntityType.Username]: {
        color: "#21B57D",
        properties: ["username", "platform", "link"],
        labelField: "username",
        description: "A username on a platform"
    },
    [EntityType.Vehicle]: {
        color: "#6c5952",
        properties: ["model", "color", "year", "vin"],
        labelField: "model",
        description: "A vehicle"
    },
    [EntityType.Website]: {
        color: "#9C27B0",
        properties: ["url", "domain", "title", "description", "ip_address", "status", "technologies"],
        labelField: "title",
        description: "A website or web domain"
    },
    [EntityType.Evidence]: {
        color: "#02bfd4",
        properties: ["name", "description", "tampered"],
        labelField: "name",
        description: "Evidence in an investigation"
    },
    [EntityType.Image]: {
        color: "#E9B96E",
        properties: ["title", "url", "description"],
        labelField: "title",
        description: "An image"
    },
    [EntityType.Text]: {
        color: "#D0BD1D",
        properties: ["text"],
        labelField: "text",
        description: "A text note"
    }
};

// Common properties for all entities
export const COMMON_PROPERTIES = ["notes", "source", "image"];

export interface Entity {
    id: string;
    type: EntityType | string;  // Support both legacy EntityType and FTM schema names
    label: string;
    properties: Record<string, any>;
    filePath?: string;
    /** FTM schema name if using FTM format */
    ftmSchema?: string;
}

/**
 * FTM-compliant entity interface
 */
export interface FTMEntity {
    id: string;
    schema: string;  // FTM schema name (e.g., 'Person', 'Company')
    label: string;
    properties: Record<string, any>;
    filePath?: string;
}

export interface Connection {
    id: string;
    fromEntityId: string;
    toEntityId: string;
    relationship: string;
    label?: string;  // Human-readable label for the connection
    properties?: Record<string, any>;  // FTM interval properties (startDate, endDate, role, etc.)
    ftmSchema?: string;  // FTM interval schema name (e.g., 'Associate', 'Ownership')
    filePath?: string;  // Path to the connection's note file
}

export interface GraphData {
    entities: Entity[];
    connections: Connection[];
}

// AI Operation types matching OSINTCopilot's format
export interface AIOperation {
    action: "create" | "update";
    entities?: Array<{
        type: string;
        properties: Record<string, any>;
    }>;
    connections?: Array<{
        from: number;
        to: number;
        relationship: string;
    }>;
    updates?: Array<{
        type: string;
        current_label: string;
        new_properties: Record<string, any>;
    }>;
}

export interface AIResponse {
    operations: AIOperation[];
    message?: string;
}

export interface ProcessTextResponse {
    success: boolean;
    operations?: AIOperation[];
    message?: string;
    error?: string;
    /** Original text preserved for retry on failure */
    originalText?: string;
}

/**
 * Get the label for an entity based on its type and properties.
 * Supports both legacy EntityType and FTM schema names.
 */
export function getEntityLabel(type: EntityType | string, properties: Record<string, any>): string {
    // First try FTM schema
    if (ftmSchemaService.hasSchema(type)) {
        return ftmSchemaService.getEntityLabel(type, properties);
    }

    // Fall back to legacy config
    const config = ENTITY_CONFIGS[type as EntityType];
    if (config && properties[config.labelField]) {
        return String(properties[config.labelField]);
    }
    return type;
}

/**
 * Get the color for an entity type.
 * Supports both legacy EntityType and FTM schema names.
 */
export function getEntityColor(type: EntityType | string): string {
    // First try FTM schema
    if (ftmSchemaService.hasSchema(type)) {
        return ftmSchemaService.getColor(type);
    }

    // Fall back to legacy config
    const config = ENTITY_CONFIGS[type as EntityType];
    return config?.color || '#607D8B';
}

/**
 * Check if a type is a valid FTM schema.
 */
export function isFTMSchema(type: string): boolean {
    return ftmSchemaService.hasSchema(type);
}

/**
 * Map legacy entity types to FTM schema names.
 */
export const LEGACY_TO_FTM_MAP: Record<EntityType, string> = {
    [EntityType.Person]: 'Person',
    [EntityType.Event]: 'Event',
    [EntityType.Location]: 'Address',
    [EntityType.Company]: 'Company',
    [EntityType.Email]: 'LegalEntity',  // Email is a property in FTM
    [EntityType.Phone]: 'LegalEntity',  // Phone is a property in FTM
    [EntityType.Username]: 'UserAccount',
    [EntityType.Vehicle]: 'Vehicle',
    [EntityType.Website]: 'Document',
    [EntityType.Evidence]: 'Document',
    [EntityType.Image]: 'Document',
    [EntityType.Text]: 'Document',
};

/**
 * Convert a legacy entity type to FTM schema name.
 */
export function legacyToFTMSchema(type: EntityType): string {
    return LEGACY_TO_FTM_MAP[type] || 'Thing';
}

/**
 * Generate a unique ID for entities.
 */
export function generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Sanitize a string for use as a filename.
 */
export function sanitizeFilename(name: string): string {
    return name
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
}

