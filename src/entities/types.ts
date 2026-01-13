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
    // 'Address', // Removed as per user request
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
 * LegalEntity is prioritized to appear first in the list.
 */
export function getAvailableFTMEntityTypes(): Array<{ name: string; label: string; description: string; color: string }> {
    const types = ftmSchemaService.getEntitySchemas().map(schema => ({
        name: schema.name,
        label: schema.label,
        description: schema.description,
        color: schema.color || '#607D8B',
    }));

    // Sort with LegalEntity first, then alphabetically
    return types.sort((a, b) => {
        if (a.name === 'LegalEntity') return -1;
        if (b.name === 'LegalEntity') return 1;
        return a.label.localeCompare(b.label);
    });
}

/**
 * Get all available FTM interval/relationship types for connection creation.
 * UnknownLink is prioritized to appear first in the list.
 */
export function getAvailableFTMIntervalTypes(): Array<{ name: string; label: string; description: string; color: string }> {
    const types = ftmSchemaService.getIntervalSchemas().map(schema => ({
        name: schema.name,
        label: schema.label,
        description: schema.description,
        color: schema.color || '#607D8B',
    }));

    // Sort with UnknownLink first, then alphabetically
    return types.sort((a, b) => {
        if (a.name === 'UnknownLink') return -1;
        if (b.name === 'UnknownLink') return 1;
        return a.label.localeCompare(b.label);
    });
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
        properties: ["name", "address", "city", "state", "country", "postal_code", "latitude", "longitude", "location_type"],
        labelField: "name",
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

// Entity icon mapping - contextually relevant icons for each entity type
export const ENTITY_ICONS: Record<string, string> = {
    // Legacy entity types (using EntityType enum values)
    [EntityType.Person]: "👤",
    [EntityType.Event]: "📅",
    [EntityType.Location]: "📍",
    [EntityType.Company]: "🏢",
    [EntityType.Email]: "📧",
    [EntityType.Phone]: "📞",
    [EntityType.Username]: "👥",
    [EntityType.Vehicle]: "🚗",
    [EntityType.Website]: "🌐",
    [EntityType.Evidence]: "📋",
    [EntityType.Image]: "🖼️",
    [EntityType.Text]: "📝",

    // FTM entity types (only non-duplicate ones)
    'LegalEntity': "⚖️",
    'Organization': "🏛️",
    // 'Address': "📍", // Removed
    'BankAccount': "🏦",
    'CryptoWallet': "₿",
    'UserAccount': "👥",
    'Document': "📄",
    'RealEstate': "🏠",
    'Sanction': "⛔",
    'Passport': "🛂",
    'Ownership': "🔗",
    'Employment': "💼",
    'Directorship': "👔",

    // Additional common types
    'Airplane': "✈️",
    'Asset': "💎",
    'Audio': "🎵",
    'Call': "📞",
    'Contract': "📜",
    'CourtCase': "⚖️",
    'Family': "👨‍👩‍👧‍👦",
    'Folder': "📁",
    'Identification': "🪪",
    'Land': "🗺️",
    'License': "📜",
    'Meeting': "🤝",
    'Message': "💬",
    'Page': "📃",
    'Payment': "💳",
    'PlainText': "📝",
    'PublicBody': "🏛️",
    'Representation': "🎭",
    'Succession': "👑",
    'TaxRoll': "💰",
    'UnknownLink': "❓",
    'Vessel': "🚢",
    'Video': "🎬",
    'Workbook': "📊"
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

    // Try common label fields as fallbacks to avoid using type name as label
    const fallbackFields = ['full_name', 'name', 'address', 'title', 'label', 'username', 'number'];
    for (const field of fallbackFields) {
        if (properties[field] && typeof properties[field] === 'string' && properties[field].trim()) {
            return String(properties[field]);
        }
    }

    // Last resort: return type name (but this should rarely happen)
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
 * Get the icon for an entity type.
 * Supports both legacy EntityType and FTM schema names.
 */
export function getEntityIcon(type: EntityType | string): string {
    // Check if we have a specific icon for this type
    if (ENTITY_ICONS[type]) {
        return ENTITY_ICONS[type];
    }

    // Try FTM schema service
    if (ftmSchemaService.hasSchema(type)) {
        const schema = ftmSchemaService.getSchema(type);
        // If FTM schema has an icon property, use it (future enhancement)
        // For now, fall back to default
    }

    // Default icon for unknown types
    return "📦";
}

/**
 * List of generic entity type names that should not be used as entity labels.
 * These are reserved type names that don't represent specific entities.
 */
const GENERIC_ENTITY_NAMES = new Set([
    // Legacy entity types
    'Person', 'Event', 'Location', 'Company', 'Email', 'Phone',
    'Username', 'Vehicle', 'Website', 'Evidence', 'Image', 'Text',

    // FTM entity types
    'LegalEntity', 'Organization', /* 'Address', */ 'BankAccount', 'CryptoWallet',
    'UserAccount', 'Document', 'RealEstate', 'Sanction', 'Passport',
    'Ownership', 'Employment', 'Directorship',

    // Additional common generic names
    'Airplane', 'Asset', 'Audio', 'Call', 'Contract', 'CourtCase',
    'Family', 'Folder', 'Identification', 'Land', 'License', 'Meeting',
    'Message', 'Page', 'Payment', 'PlainText', 'PublicBody', 'Representation',
    'Succession', 'TaxRoll', 'UnknownLink', 'Vessel', 'Video', 'Workbook',

    // Common variations (lowercase, plural, etc.)
    'person', 'people', 'event', 'events', 'location', 'locations',
    'company', 'companies', 'organization', 'organizations',
    'email', 'emails', 'phone', 'phones', 'vehicle', 'vehicles',
    'website', 'websites', 'document', 'documents', /* 'address', 'addresses', */

    // Very generic terms
    'Entity', 'entity', 'Item', 'item', 'Object', 'object',
    'Thing', 'thing', 'Unknown', 'unknown', 'Unnamed', 'unnamed',
    'New', 'new', 'Untitled', 'untitled', 'Default', 'default'
]);

/**
 * Validation result for entity names.
 */
export interface EntityNameValidation {
    isValid: boolean;
    error?: string;
}

/**
 * Validate an entity name to ensure it's not generic.
 * Returns validation result with error message if invalid.
 *
 * @param name - The proposed entity name/label
 * @param entityType - The type of entity being created
 * @returns Validation result indicating if the name is acceptable
 */
export function validateEntityName(name: string, entityType?: string): EntityNameValidation {
    // Trim whitespace
    const trimmedName = name?.trim();

    // Check if name is empty
    if (!trimmedName) {
        return {
            isValid: false,
            error: 'Entity name cannot be empty'
        };
    }

    // Check if name is too short (less than 2 characters)
    if (trimmedName.length < 2) {
        return {
            isValid: false,
            error: 'Entity name must be at least 2 characters long'
        };
    }

    // Check if name is a generic entity type name
    if (GENERIC_ENTITY_NAMES.has(trimmedName)) {
        return {
            isValid: false,
            error: `"${trimmedName}" is a generic type name. Please provide a specific, unique identifier (e.g., "John Smith" instead of "Person", "Acme Corp" instead of "Company")`
        };
    }

    // Check for case-insensitive match with generic names
    const lowerName = trimmedName.toLowerCase();
    for (const genericName of GENERIC_ENTITY_NAMES) {
        if (lowerName === genericName.toLowerCase()) {
            return {
                isValid: false,
                error: `"${trimmedName}" is too generic. Please provide a specific, unique identifier`
            };
        }
    }

    // Check if name is just the entity type with a number (e.g., "Person 1", "Company2")
    if (entityType) {
        const typePattern = new RegExp(`^${entityType}\\s*\\d*$`, 'i');
        if (typePattern.test(trimmedName)) {
            return {
                isValid: false,
                error: `Please provide a specific name instead of "${trimmedName}"`
            };
        }
    }

    // Name is valid
    return {
        isValid: true
    };
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
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
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

