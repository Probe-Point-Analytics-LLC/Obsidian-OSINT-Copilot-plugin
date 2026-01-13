/**
 * Entity Creation Modal - allows users to create entities with a form UI.
 * Now supports both legacy EntityType and FTM schema format.
 */

import { App, Modal, Notice, Setting } from 'obsidian';
import { Entity, Connection, EntityType, ENTITY_CONFIGS, COMMON_PROPERTIES, getFTMEntityConfig, getAvailableFTMEntityTypes, getAvailableFTMIntervalTypes, FTMEntityConfig, validateEntityName, getEntityIcon } from '../entities/types';
import { EntityManager } from '../services/entity-manager';
import { GeocodingService, GeocodingError, GeocodingErrorType } from '../services/geocoding-service';
import { ftmSchemaService, FTMPropertyDefinition } from '../services/ftm-schema-service';

// Common relationship types for suggestions
export const COMMON_RELATIONSHIPS = [
    'WORKS_AT',
    'ATTENDED',
    'LOCATED_AT',
    'KNOWS',
    'OWNS',
    'MEMBER_OF',
    'RELATED_TO',
    'CONTACTED',
    'VISITED',
    'EMPLOYED_BY',
    'LIVES_AT',
    'ASSOCIATED_WITH',
    'PARENT_OF',
    'CHILD_OF',
    'SIBLING_OF',
    'SPOUSE_OF',
    'FRIEND_OF',
    'COLLEAGUE_OF'
];

export class EntityCreationModal extends Modal {
    private entityManager: EntityManager;
    private entityType: EntityType;
    private properties: Record<string, any> = {};
    private onEntityCreated: ((entityId: string) => void) | null;
    private geocodingService: GeocodingService;
    private geocodeStatusEl: HTMLElement | null = null;
    private geocodeBtn: HTMLButtonElement | null = null;

    constructor(
        app: App,
        entityManager: EntityManager,
        entityType: EntityType,
        onEntityCreated?: (entityId: string) => void,
        initialProperties: Record<string, any> = {},
        private entityId?: string
    ) {
        super(app);
        this.entityManager = entityManager;
        this.entityType = entityType;
        this.onEntityCreated = onEntityCreated || null;
        this.geocodingService = new GeocodingService();
        this.properties = { ...initialProperties };
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('graph_copilot-entity-modal');

        const config = ENTITY_CONFIGS[this.entityType];

        // Title
        const action = this.entityId ? 'Edit' : 'Create';
        contentEl.createEl('h2', { text: `${action} ${this.entityType}` });
        contentEl.createEl('p', {
            text: config.description,
            cls: 'graph_copilot-entity-modal-description'
        });

        // Create form container
        const formContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });

        // Add fields for entity-specific properties
        // For Location entities, add geocode button after address fields but before coordinates
        const addressFields = ['address', 'city', 'state', 'country', 'postal_code'];
        const coordinateFields = ['latitude', 'longitude'];

        for (const prop of config.properties) {
            // Skip coordinate fields for now if this is a Location entity
            if (this.entityType === EntityType.Location && coordinateFields.includes(prop)) {
                continue;
            }
            this.createPropertyField(formContainer, prop, prop === config.labelField);
        }

        // Add geocode button for Location entities (after address fields, before coordinates)
        if (this.entityType === EntityType.Location) {
            this.createGeocodeSection(formContainer);

            // Now add coordinate fields
            for (const prop of coordinateFields) {
                this.createPropertyField(formContainer, prop, false);
            }
        }

        // Add common properties section
        contentEl.createEl('h4', { text: 'Additional properties' });
        const commonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });

        for (const prop of COMMON_PROPERTIES) {
            if (prop !== 'image') { // Skip image for now
                this.createPropertyField(commonContainer, prop, false);
            }
        }

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-modal-buttons' });

        const createBtn = buttonContainer.createEl('button', {
            text: this.entityId ? 'Update entity' : 'Create entity',
            cls: 'mod-cta'
        });
        createBtn.onclick = () => this.handleCreate();

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    /**
     * Create the geocoding section with button and status display
     */
    private createGeocodeSection(container: HTMLElement): void {
        const geocodeSection = container.createDiv({ cls: 'graph_copilot-geocode-section' });

        // Geocode button
        this.geocodeBtn = geocodeSection.createEl('button', {
            text: 'Put on map',
            cls: 'graph_copilot-geocode-btn'
        });

        // Status display
        this.geocodeStatusEl = geocodeSection.createEl('span', {
            cls: 'graph_copilot-geocode-status'
        });

        // Help text
        geocodeSection.createEl('small', {
            text: 'Convert address to coordinates using OpenStreetMap',
            cls: 'graph_copilot-geocode-help'
        });

        this.geocodeBtn.onclick = async () => {
            await this.handleGeocode();
        };
    }

    /**
     * Handle the geocode button click
     */
    private async handleGeocode(): Promise<void> {
        if (!this.geocodeBtn || !this.geocodeStatusEl) return;

        const address = this.properties.address || '';
        const city = this.properties.city || '';
        const state = this.properties.state || '';
        const country = this.properties.country || '';

        // Validate that we have at least some address info
        if (!address && !city && !country) {
            this.setGeocodeStatus('error', 'Please enter an address, city, or country first');
            return;
        }

        // Show loading state
        this.geocodeBtn.disabled = true;
        this.geocodeBtn.textContent = '⏳ geocoding...';
        this.setGeocodeStatus('loading', 'Looking up coordinates...');

        try {
            const result = await this.geocodingService.geocodeAddressWithRetry(
                address,
                city,
                state,
                country,
                (attempt, maxAttempts, delaySeconds) => {
                    this.setGeocodeStatus('loading', `Network error, retrying in ${delaySeconds}s... (attempt ${attempt}/${maxAttempts})`);
                }
            );

            // Update latitude/longitude properties
            this.properties.latitude = result.latitude;
            this.properties.longitude = result.longitude;

            // Update the input fields visually
            const latInput = document.getElementById('entity-latitude') as HTMLInputElement;
            const lngInput = document.getElementById('entity-longitude') as HTMLInputElement;

            if (latInput) {
                latInput.value = result.latitude.toString();
            }
            if (lngInput) {
                lngInput.value = result.longitude.toString();
            }

            // Show success with coordinates and confidence
            const coordsStr = GeocodingService.formatCoordinates(result.latitude, result.longitude);
            let statusText = `✓ Found: ${coordsStr}`;
            if (result.confidence === 'low') {
                statusText += ' (low confidence - please verify)';
            }
            this.setGeocodeStatus('success', statusText);

            // Optionally auto-fill missing address components
            if (!this.properties.city && result.city) {
                this.properties.city = result.city;
                const cityInput = document.getElementById('entity-city') as HTMLInputElement;
                if (cityInput) cityInput.value = result.city;
            }
            if (!this.properties.state && result.state) {
                this.properties.state = result.state;
                const stateInput = document.getElementById('entity-state') as HTMLInputElement;
                if (stateInput) stateInput.value = result.state;
            }
            if (!this.properties.country && result.country) {
                this.properties.country = result.country;
                const countryInput = document.getElementById('entity-country') as HTMLInputElement;
                if (countryInput) countryInput.value = result.country;
            }
            if (!this.properties.postal_code && result.postalCode) {
                this.properties.postal_code = result.postalCode;
                const postalInput = document.getElementById('entity-postal_code') as HTMLInputElement;
                if (postalInput) postalInput.value = result.postalCode;
            }

        } catch (error) {
            console.error('[EntityModal] Geocoding error:', error);

            if (error instanceof GeocodingError) {
                switch (error.type) {
                    case GeocodingErrorType.NotFound:
                        this.setGeocodeStatus('error', '✗ Address not found. Please check the address or enter coordinates manually.');
                        break;
                    case GeocodingErrorType.RateLimited:
                        this.setGeocodeStatus('error', '✗ Too many requests. Please wait a moment and try again.');
                        break;
                    case GeocodingErrorType.NetworkError:
                        this.setGeocodeStatus('error', '✗ Network error. Please check your internet connection.');
                        break;
                    case GeocodingErrorType.InvalidInput:
                        this.setGeocodeStatus('error', '✗ ' + error.message);
                        break;
                    default:
                        this.setGeocodeStatus('error', '✗ Geocoding failed. Please enter coordinates manually.');
                }
            } else {
                this.setGeocodeStatus('error', '✗ Geocoding failed. Please enter coordinates manually.');
            }
        } finally {
            // Reset button state
            if (this.geocodeBtn) {
                this.geocodeBtn.disabled = false;
                this.geocodeBtn.textContent = 'Put on map';
            }
        }
    }

    /**
     * Set the geocode status message with appropriate styling
     */
    private setGeocodeStatus(type: 'success' | 'error' | 'loading', message: string): void {
        if (!this.geocodeStatusEl) return;

        this.geocodeStatusEl.textContent = message;
        this.geocodeStatusEl.removeClass('graph_copilot-geocode-status-success');
        this.geocodeStatusEl.removeClass('graph_copilot-geocode-status-error');
        this.geocodeStatusEl.removeClass('graph_copilot-geocode-status-loading');

        this.geocodeStatusEl.addClass(`graph_copilot-geocode-status-${type}`);
    }

    private createPropertyField(container: HTMLElement, propertyName: string, isRequired: boolean): void {
        const fieldContainer = container.createDiv({ cls: 'graph_copilot-entity-field' });

        const label = fieldContainer.createEl('label', {
            text: this.formatPropertyName(propertyName) + (isRequired ? ' *' : '')
        });
        label.setAttribute('for', `entity-${propertyName}`);

        let input: HTMLInputElement | HTMLTextAreaElement;

        // Use textarea for notes and description fields
        if (propertyName === 'notes' || propertyName === 'description' || propertyName === 'text') {
            input = fieldContainer.createEl('textarea', {
                placeholder: `Enter ${this.formatPropertyName(propertyName).toLowerCase()}...`
            }) as HTMLTextAreaElement;
            input.rows = 3;
        } else if (propertyName === 'start_date' || propertyName === 'end_date') {
            // Date-time input for date fields
            input = fieldContainer.createEl('input', {
                type: 'datetime-local'
            }) as HTMLInputElement;
        } else if (propertyName === 'latitude' || propertyName === 'longitude') {
            // Number input for coordinates
            input = fieldContainer.createEl('input', {
                type: 'number',
                placeholder: propertyName === 'latitude' ? '-90 to 90' : '-180 to 180'
            }) as HTMLInputElement;
            (input as HTMLInputElement).step = 'any';
        } else if (propertyName === 'add_to_timeline' || propertyName === 'tampered') {
            // Boolean toggle button with visual feedback
            const toggleContainer = fieldContainer.createDiv({ cls: 'graph_copilot-toggle-container' });
            toggleContainer.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-top: 4px;';

            // Hidden checkbox for form state
            input = toggleContainer.createEl('input', {
                type: 'checkbox'
            }) as HTMLInputElement;
            input.id = `entity-${propertyName}`;
            input.style.display = 'none';

            // Create a styled toggle button
            const toggleBtn = toggleContainer.createEl('button', {
                cls: 'graph_copilot-toggle-btn'
            });
            toggleBtn.type = 'button';
            toggleBtn.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 20px;
                font-size: 14px;
                font-weight: 500;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                border: 2px solid var(--background-modifier-border);
                background: var(--background-secondary);
                color: var(--text-muted);
            `;

            // Icon and text
            const icon = toggleBtn.createSpan({ cls: 'toggle-icon' });
            icon.textContent = '📅';
            icon.style.fontSize = '16px';

            const btnText = toggleBtn.createSpan({ cls: 'toggle-text' });
            btnText.textContent = 'Add to timeline';

            // Update button appearance based on state
            const updateButtonState = (checked: boolean) => {
                if (checked) {
                    toggleBtn.style.background = 'var(--interactive-accent)';
                    toggleBtn.style.borderColor = 'var(--interactive-accent)';
                    toggleBtn.style.color = 'white';
                    btnText.textContent = 'On timeline ✓';
                } else {
                    toggleBtn.style.background = 'var(--background-secondary)';
                    toggleBtn.style.borderColor = 'var(--background-modifier-border)';
                    toggleBtn.style.color = 'var(--text-muted)';
                    btnText.textContent = 'Add to timeline';
                }
            };

            // Initialize state
            const initialValue = this.properties[propertyName] !== undefined
                ? this.properties[propertyName]
                : (!this.entityId && propertyName === 'add_to_timeline');

            (input as HTMLInputElement).checked = initialValue;
            this.properties[propertyName] = initialValue;
            updateButtonState(initialValue);

            // Toggle on click
            toggleBtn.addEventListener('click', () => {
                const newChecked = !(input as HTMLInputElement).checked;
                (input as HTMLInputElement).checked = newChecked;
                this.properties[propertyName] = newChecked;
                updateButtonState(newChecked);
            });

            // Hover effect
            toggleBtn.addEventListener('mouseenter', () => {
                if (!(input as HTMLInputElement).checked) {
                    toggleBtn.style.borderColor = 'var(--interactive-accent)';
                    toggleBtn.style.color = 'var(--text-normal)';
                }
            });
            toggleBtn.addEventListener('mouseleave', () => {
                updateButtonState((input as HTMLInputElement).checked);
            });

            return; // Early return since we've handled everything
        } else {
            // Default text input
            input = fieldContainer.createEl('input', {
                type: 'text',
                placeholder: `Enter ${this.formatPropertyName(propertyName).toLowerCase()}...`
            }) as HTMLInputElement;
        }

        // Set initial value if present in properties
        if (this.properties[propertyName] !== undefined) {
            (input as HTMLInputElement).value = String(this.properties[propertyName]);
        }

        input.id = `entity-${propertyName}`;
        input.addClass('graph_copilot-entity-input');

        // Store value on change
        input.addEventListener('input', () => {
            if (input.type === 'datetime-local') {
                // Convert to YYYY-MM-DD HH:mm format
                const value = (input as HTMLInputElement).value;
                if (value) {
                    this.properties[propertyName] = value.replace('T', ' ');
                }
            } else if (input.type === 'number') {
                const value = parseFloat((input as HTMLInputElement).value);
                if (!isNaN(value)) {
                    this.properties[propertyName] = value;
                }
            } else {
                this.properties[propertyName] = input.value;
            }
        });

        // Also handle change event for datetime-local
        input.addEventListener('change', () => {
            if (input.type === 'datetime-local') {
                const value = (input as HTMLInputElement).value;
                if (value) {
                    this.properties[propertyName] = value.replace('T', ' ');
                }
            }
        });
    }

    private formatPropertyName(name: string): string {
        return name
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    private async handleCreate(): Promise<void> {
        const config = ENTITY_CONFIGS[this.entityType];
        const labelField = config.labelField;

        // Only validate that entity name is not generic (if provided)
        if (this.properties[labelField] && this.properties[labelField].trim() !== '') {
            const nameValidation = validateEntityName(this.properties[labelField], this.entityType);
            if (!nameValidation.isValid) {
                new Notice(nameValidation.error || 'Invalid entity name');
                return;
            }
        }

        try {
            let entity;
            if (this.entityId) {
                // Update existing entity
                entity = await this.entityManager.updateEntity(this.entityId, this.properties);
                new Notice(`Updated ${this.entityType}: ${entity?.label}`);
            } else {
                // Create new entity
                // Skip auto-geocoding for manual creation - user should click the Geocode button explicitly
                entity = await this.entityManager.createEntity(
                    this.entityType,
                    this.properties,
                    { skipAutoGeocode: true }
                );
                new Notice(`Created ${this.entityType}: ${entity.label}`);
            }

            if (this.onEntityCreated && entity) {
                this.onEntityCreated(entity.id);
            }

            this.close();
        } catch (error) {
            new Notice(`Failed to create entity: ${error}`);
            console.error('Entity creation error:', error);
        }
    }

    /**
     * Automatically geocode if address info exists but coordinates are missing
     */
    private async autoGeocodeIfNeeded(): Promise<void> {
        const hasCoordinates = this.properties.latitude && this.properties.longitude;
        const hasAddressInfo = this.properties.address || this.properties.city || this.properties.country;

        if (hasCoordinates || !hasAddressInfo) {
            return; // Already has coordinates or no address to geocode
        }

        console.log('[EntityCreationModal] Auto-geocoding location...');
        this.setGeocodeStatus('loading', 'Auto-geocoding address...');

        try {
            const result = await this.geocodingService.geocodeAddressWithRetry(
                this.properties.address,
                this.properties.city,
                this.properties.state,
                this.properties.country,
                (attempt, maxAttempts, delaySeconds) => {
                    this.setGeocodeStatus('loading', `Network error, retrying in ${delaySeconds}s... (attempt ${attempt}/${maxAttempts})`);
                }
            );

            // Update properties with geocoded coordinates
            this.properties.latitude = result.latitude;
            this.properties.longitude = result.longitude;

            // Update input fields visually
            const latInput = document.getElementById('entity-latitude') as HTMLInputElement;
            const lngInput = document.getElementById('entity-longitude') as HTMLInputElement;
            if (latInput) latInput.value = result.latitude.toString();
            if (lngInput) lngInput.value = result.longitude.toString();

            // Auto-fill missing address components
            if (!this.properties.city && result.city) {
                this.properties.city = result.city;
                const cityInput = document.getElementById('entity-city') as HTMLInputElement;
                if (cityInput) cityInput.value = result.city;
            }
            if (!this.properties.state && result.state) {
                this.properties.state = result.state;
                const stateInput = document.getElementById('entity-state') as HTMLInputElement;
                if (stateInput) stateInput.value = result.state;
            }
            if (!this.properties.country && result.country) {
                this.properties.country = result.country;
                const countryInput = document.getElementById('entity-country') as HTMLInputElement;
                if (countryInput) countryInput.value = result.country;
            }

            const coordsStr = GeocodingService.formatCoordinates(result.latitude, result.longitude);
            this.setGeocodeStatus('success', `✓ Auto-geocoded: ${coordsStr}`);
            console.log('[EntityCreationModal] Auto-geocoded successfully:', coordsStr);

        } catch (error) {
            console.warn('[EntityCreationModal] Auto-geocoding failed:', error);
            // Don't block entity creation - just log the warning
            this.setGeocodeStatus('error', '⚠ Auto-geocoding failed - entity will be created without coordinates');
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Entity Type Selector Modal - allows users to choose which entity type to create.
 */
export class EntityTypeSelectorModal extends Modal {
    private entityManager: EntityManager;
    private onEntityCreated: ((entityId: string) => void) | null;
    private filterTypes: EntityType[] | null;

    constructor(
        app: App,
        entityManager: EntityManager,
        onEntityCreated?: (entityId: string) => void,
        filterTypes?: EntityType[]
    ) {
        super(app);
        this.entityManager = entityManager;
        this.onEntityCreated = onEntityCreated || null;
        this.filterTypes = filterTypes || null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('graph_copilot-entity-selector-modal');

        contentEl.createEl('h2', { text: 'Create new entity' });
        contentEl.createEl('p', { text: 'Select the type of entity to create:' });

        const gridContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-type-grid' });

        const typesToShow = this.filterTypes || Object.values(EntityType);

        for (const type of typesToShow) {
            const config = ENTITY_CONFIGS[type];

            const typeBtn = gridContainer.createDiv({ cls: 'graph_copilot-entity-type-btn' });
            typeBtn.style.borderLeftColor = config.color;

            const icon = typeBtn.createDiv({ cls: 'graph_copilot-entity-type-icon' });
            icon.style.backgroundColor = config.color;
            icon.style.fontSize = '20px';
            icon.style.display = 'flex';
            icon.style.alignItems = 'center';
            icon.style.justifyContent = 'center';
            icon.textContent = getEntityIcon(type);

            const info = typeBtn.createDiv({ cls: 'graph_copilot-entity-type-info' });
            info.createEl('strong', { text: type });
            info.createEl('small', { text: config.description });

            typeBtn.onclick = () => {
                this.close();
                const createModal = new EntityCreationModal(
                    this.app,
                    this.entityManager,
                    type,
                    this.onEntityCreated || undefined
                );
                createModal.open();
            };
        }

        // Cancel button
        const cancelBtn = contentEl.createEl('button', {
            text: 'Cancel',
            cls: 'graph_copilot-entity-cancel-btn'
        });
        cancelBtn.onclick = () => this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Connection Creation Modal - allows users to create connections between entities.
 */
export class ConnectionCreationModal extends Modal {
    private entityManager: EntityManager;
    private sourceEntityId: string | null = null;
    private targetEntityId: string | null = null;
    private relationship: string = '';
    private onConnectionCreated: ((connectionId?: string) => void) | null;
    private entities: Entity[] = [];

    constructor(
        app: App,
        entityManager: EntityManager,
        onConnectionCreated?: (connectionId?: string) => void,
        preselectedSourceId?: string,
        preselectedTargetId?: string
    ) {
        super(app);
        this.entityManager = entityManager;
        this.onConnectionCreated = onConnectionCreated || null;
        this.sourceEntityId = preselectedSourceId || null;
        this.targetEntityId = preselectedTargetId || null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('graph_copilot-connection-modal');

        // Load entities
        this.entities = this.entityManager.getAllEntities();

        // Title
        contentEl.createEl('h2', { text: 'Create connection' });
        contentEl.createEl('p', {
            text: 'Create a relationship between two entities',
            cls: 'graph_copilot-entity-modal-description'
        });

        if (this.entities.length < 2) {
            contentEl.createEl('p', {
                text: 'You need at least 2 entities to create a connection.',
                cls: 'graph_copilot-connection-warning'
            });
            const closeBtn = contentEl.createEl('button', { text: 'Close' });
            closeBtn.onclick = () => this.close();
            return;
        }

        // Create form container
        const formContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });

        // Source entity dropdown
        this.createEntityDropdown(formContainer, 'Source Entity', 'source');

        // Arrow indicator
        const arrowContainer = formContainer.createDiv({ cls: 'graph_copilot-connection-arrow' });
        arrowContainer.textContent = '↓';

        // Target entity dropdown
        this.createEntityDropdown(formContainer, 'Target Entity', 'target');

        // Relationship type input
        this.createRelationshipInput(formContainer);

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-modal-buttons' });

        const createBtn = buttonContainer.createEl('button', {
            text: 'Create connection',
            cls: 'mod-cta'
        });
        createBtn.onclick = () => this.handleCreate();

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    private createEntityDropdown(container: HTMLElement, label: string, type: 'source' | 'target'): void {
        const fieldContainer = container.createDiv({ cls: 'graph_copilot-entity-field' });
        fieldContainer.createEl('label', { text: label + ' *' });

        const select = fieldContainer.createEl('select', { cls: 'graph_copilot-entity-input' });

        const placeholderOption = select.createEl('option', {
            text: `Select ${label.toLowerCase()}...`,
            value: ''
        });
        placeholderOption.disabled = true;

        const preselectedId = type === 'source' ? this.sourceEntityId : this.targetEntityId;
        placeholderOption.selected = !preselectedId;

        for (const entity of this.entities) {
            const option = select.createEl('option', {
                text: `${entity.label} (${entity.type})`,
                value: entity.id
            });
            if (preselectedId && entity.id === preselectedId) {
                option.selected = true;
            }
        }

        select.onchange = () => {
            if (type === 'source') {
                this.sourceEntityId = select.value || null;
            } else {
                this.targetEntityId = select.value || null;
            }
        };
    }

    private createRelationshipInput(container: HTMLElement): void {
        const fieldContainer = container.createDiv({ cls: 'graph_copilot-entity-field' });
        fieldContainer.createEl('label', { text: 'Relationship type *' });

        const input = fieldContainer.createEl('input', {
            type: 'text',
            placeholder: 'e.g., WORKS_AT, KNOWS, LOCATED_AT...',
            cls: 'graph_copilot-entity-input'
        });

        input.oninput = () => {
            this.relationship = input.value.toUpperCase().replace(/\s+/g, '_');
            input.value = this.relationship;
        };

        // Add suggestions
        const suggestionsContainer = fieldContainer.createDiv({ cls: 'graph_copilot-relationship-suggestions' });
        suggestionsContainer.createEl('small', { text: 'Suggestions: ' });

        const suggestionsWrap = suggestionsContainer.createSpan();
        COMMON_RELATIONSHIPS.slice(0, 6).forEach((rel) => {
            const chip = suggestionsWrap.createEl('span', {
                text: rel,
                cls: 'graph_copilot-relationship-chip'
            });
            chip.onclick = () => {
                this.relationship = rel;
                input.value = rel;
            };
        });
    }

    private async handleCreate(): Promise<void> {
        if (!this.sourceEntityId) {
            new Notice('Please select a source entity');
            return;
        }
        if (!this.targetEntityId) {
            new Notice('Please select a target entity');
            return;
        }
        if (this.sourceEntityId === this.targetEntityId) {
            new Notice('Source and target entities must be different');
            return;
        }
        if (!this.relationship.trim()) {
            new Notice('Please enter a relationship type');
            return;
        }

        try {
            const connection = await this.entityManager.createConnection(
                this.sourceEntityId,
                this.targetEntityId,
                this.relationship
            );

            if (connection) {
                const sourceEntity = this.entityManager.getEntity(this.sourceEntityId);
                const targetEntity = this.entityManager.getEntity(this.targetEntityId);
                new Notice(`Created: ${sourceEntity?.label} → ${this.relationship} → ${targetEntity?.label}`);

                if (this.onConnectionCreated) {
                    this.onConnectionCreated(connection.id);
                }
                this.close();
            } else {
                new Notice('Failed to create connection');
            }
        } catch (error) {
            new Notice(`Failed to create connection: ${error}`);
            console.error('Connection creation error:', error);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Quick Connection Modal - simplified modal for when source and target are already selected.
 */
export class ConnectionQuickModal extends Modal {
    private entityManager: EntityManager;
    private sourceEntityId: string;
    private targetEntityId: string;
    private sourceLabel: string;
    private targetLabel: string;
    private relationship: string = '';
    private properties: Record<string, any> = {};
    private onConnectionCreated: ((connectionId?: string) => void) | null;
    private propertiesContainer: HTMLElement | null = null;

    constructor(
        app: App,
        entityManager: EntityManager,
        sourceEntityId: string,
        targetEntityId: string,
        sourceLabel: string,
        targetLabel: string,
        onConnectionCreated?: (connectionId?: string) => void
    ) {
        super(app);
        this.entityManager = entityManager;
        this.sourceEntityId = sourceEntityId;
        this.targetEntityId = targetEntityId;
        this.sourceLabel = sourceLabel;
        this.targetLabel = targetLabel;
        this.onConnectionCreated = onConnectionCreated || null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('graph_copilot-connection-modal');

        // Title
        contentEl.createEl('h2', { text: 'Create connection' });

        // Show selected entities
        const entitiesDisplay = contentEl.createDiv({ cls: 'graph_copilot-connection-entities' });

        const sourceDiv = entitiesDisplay.createDiv({ cls: 'graph_copilot-connection-entity' });
        sourceDiv.createEl('span', { text: 'From:', cls: 'graph_copilot-connection-label' });
        sourceDiv.createEl('strong', { text: this.sourceLabel });

        const arrowDiv = entitiesDisplay.createDiv({ cls: 'graph_copilot-connection-arrow-horizontal' });
        arrowDiv.textContent = '→';

        const targetDiv = entitiesDisplay.createDiv({ cls: 'graph_copilot-connection-entity' });
        targetDiv.createEl('span', { text: 'To:', cls: 'graph_copilot-connection-label' });
        targetDiv.createEl('strong', { text: this.targetLabel });

        // Relationship type selector (FTM interval types)
        const formContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });
        const fieldContainer = formContainer.createDiv({ cls: 'graph_copilot-entity-field' });

        fieldContainer.createEl('label', { text: 'Relationship type *' });

        const select = fieldContainer.createEl('select', { cls: 'graph_copilot-entity-input' });

        // Add placeholder option
        const placeholderOption = select.createEl('option', {
            text: 'Select relationship type...',
            value: ''
        });
        placeholderOption.disabled = true;
        placeholderOption.selected = true;

        // Get FTM interval types and populate dropdown (pre-sorted with UnknownLink first)
        const intervalTypes = getAvailableFTMIntervalTypes();

        for (const intervalType of intervalTypes) {
            const option = select.createEl('option', {
                text: `${intervalType.label} - ${intervalType.description}`,
                value: intervalType.name
            });
        }

        select.onchange = () => {
            this.relationship = select.value;
            // Dynamically show property fields for the selected interval type
            this.renderPropertyFields(this.relationship);
        };

        select.focus();

        // Container for dynamic property fields
        this.propertiesContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });
        this.propertiesContainer.style.marginTop = '16px';

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-modal-buttons' });

        const createBtn = buttonContainer.createEl('button', {
            text: 'Create connection',
            cls: 'mod-cta'
        });
        createBtn.onclick = () => this.handleCreate();

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    private renderPropertyFields(intervalType: string): void {
        if (!this.propertiesContainer) return;

        // Clear existing fields
        this.propertiesContainer.empty();
        this.properties = {};

        if (!intervalType) return;

        const config = getFTMEntityConfig(intervalType);
        if (!config) return;

        // Get non-entity properties (entity properties are source/target which are already selected)
        const propertiesToShow = [...config.featuredProperties, ...config.optionalProperties]
            .filter(propName => {
                const propDef = config.propertyDefinitions[propName];
                return propDef && propDef.type !== 'entity' && !propDef.hidden;
            });

        if (propertiesToShow.length === 0) return;

        // Add a separator
        this.propertiesContainer.createEl('h4', { text: 'Connection properties' });

        // Create fields for each property
        for (const propName of propertiesToShow) {
            const propDef = config.propertyDefinitions[propName];
            if (!propDef) continue;

            const isRequired = config.requiredProperties.includes(propName);
            this.createPropertyField(propName, propDef, isRequired);
        }
    }

    private createPropertyField(propertyName: string, propDef: FTMPropertyDefinition, isRequired: boolean): void {
        if (!this.propertiesContainer) return;

        const fieldContainer = this.propertiesContainer.createDiv({ cls: 'graph_copilot-entity-field' });

        const label = fieldContainer.createEl('label', {
            text: propDef.label + (isRequired ? ' *' : '')
        });
        label.setAttribute('for', `conn-${propertyName}`);

        let input: HTMLInputElement | HTMLTextAreaElement;

        // Use appropriate input type based on property type
        if (propDef.type === 'text' || propertyName === 'description' || propertyName === 'summary') {
            input = fieldContainer.createEl('textarea', {
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLTextAreaElement;
            input.rows = 3;
        } else if (propDef.type === 'date' || propertyName.includes('Date')) {
            input = fieldContainer.createEl('input', {
                type: 'date'
            }) as HTMLInputElement;
        } else if (propDef.type === 'number' || propertyName.includes('percentage') || propertyName.includes('Count') || propertyName.includes('Value') || propertyName.includes('amount')) {
            input = fieldContainer.createEl('input', {
                type: 'number',
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLInputElement;
            (input as HTMLInputElement).step = 'any';
        } else {
            input = fieldContainer.createEl('input', {
                type: 'text',
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLInputElement;
        }

        input.id = `conn-${propertyName}`;
        input.addClass('graph_copilot-entity-input');

        // Store value on change
        input.addEventListener('input', () => {
            if (input.type === 'number') {
                const value = parseFloat((input as HTMLInputElement).value);
                if (!isNaN(value)) {
                    this.properties[propertyName] = value;
                } else {
                    delete this.properties[propertyName];
                }
            } else {
                const value = input.value.trim();
                if (value) {
                    this.properties[propertyName] = value;
                } else {
                    delete this.properties[propertyName];
                }
            }
        });
    }

    private async handleCreate(): Promise<void> {
        if (!this.relationship.trim()) {
            new Notice('Please select a relationship type');
            return;
        }

        // No required field validation - allow creation with partial data

        try {
            const connection = await this.entityManager.createConnection(
                this.sourceEntityId,
                this.targetEntityId,
                this.relationship,
                this.properties
            );

            if (connection) {
                new Notice(`Created: ${this.sourceLabel} → ${this.relationship} → ${this.targetLabel}`);

                if (this.onConnectionCreated) {
                    this.onConnectionCreated(connection.id);
                }
                this.close();
            } else {
                new Notice('Failed to create connection');
            }
        } catch (error) {
            new Notice(`Failed to create connection: ${error}`);
            console.error('Connection creation error:', error);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Entity Edit Modal - allows users to edit existing entities.
 */
export class EntityEditModal extends Modal {
    private entityManager: EntityManager;
    private entity: Entity;
    private properties: Record<string, any> = {};
    private onEntityUpdated: ((entityId: string) => void) | null;
    private geocodingService: GeocodingService;
    private geocodeStatusEl: HTMLElement | null = null;
    private geocodeBtn: HTMLButtonElement | null = null;

    constructor(
        app: App,
        entityManager: EntityManager,
        entity: Entity,
        onEntityUpdated?: (entityId: string) => void
    ) {
        super(app);
        this.entityManager = entityManager;
        this.entity = entity;
        this.properties = { ...entity.properties }; // Clone properties
        this.onEntityUpdated = onEntityUpdated || null;
        this.geocodingService = new GeocodingService();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('graph_copilot-entity-modal');

        const config = ENTITY_CONFIGS[this.entity.type as EntityType];

        // Title
        contentEl.createEl('h2', { text: `Edit ${this.entity.type}` });
        contentEl.createEl('p', {
            text: `Editing: ${this.entity.label}`,
            cls: 'graph_copilot-entity-modal-description'
        });

        // Create form container
        const formContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });

        // Add fields for entity-specific properties
        const coordinateFields = ['latitude', 'longitude'];

        for (const prop of config.properties) {
            // Skip coordinate fields for now if this is a Location entity
            if (this.entity.type === EntityType.Location && coordinateFields.includes(prop)) {
                continue;
            }
            this.createPropertyField(formContainer, prop, prop === config.labelField);
        }

        // Add geocode button for Location entities (after address fields, before coordinates)
        if (this.entity.type === EntityType.Location) {
            this.createGeocodeSection(formContainer);

            // Now add coordinate fields
            for (const prop of coordinateFields) {
                this.createPropertyField(formContainer, prop, false);
            }
        }

        // Add common properties section
        contentEl.createEl('h4', { text: 'Additional properties' });
        const commonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });

        for (const prop of COMMON_PROPERTIES) {
            if (prop !== 'image') { // Skip image for now
                this.createPropertyField(commonContainer, prop, false);
            }
        }

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-modal-buttons' });

        const saveBtn = buttonContainer.createEl('button', {
            text: 'Save changes',
            cls: 'mod-cta'
        });
        saveBtn.onclick = () => this.handleSave();

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    /**
     * Create the geocoding section with button and status display
     */
    private createGeocodeSection(container: HTMLElement): void {
        const geocodeSection = container.createDiv({ cls: 'graph_copilot-geocode-section' });

        // Geocode button
        this.geocodeBtn = geocodeSection.createEl('button', {
            text: 'Put on map',
            cls: 'graph_copilot-geocode-btn'
        });

        // Status display
        this.geocodeStatusEl = geocodeSection.createEl('span', {
            cls: 'graph_copilot-geocode-status'
        });

        // Help text
        geocodeSection.createEl('small', {
            text: 'Convert address to coordinates using OpenStreetMap',
            cls: 'graph_copilot-geocode-help'
        });

        this.geocodeBtn.onclick = async () => {
            await this.handleGeocode();
        };
    }

    /**
     * Handle the geocode button click
     */
    private async handleGeocode(): Promise<void> {
        if (!this.geocodeBtn || !this.geocodeStatusEl) return;

        const address = this.properties.address || '';
        const city = this.properties.city || '';
        const state = this.properties.state || '';
        const country = this.properties.country || '';

        // Validate that we have at least some address info
        if (!address && !city && !country) {
            this.setGeocodeStatus('error', 'Please enter an address, city, or country first');
            return;
        }

        // Show loading state
        this.geocodeBtn.disabled = true;
        this.geocodeBtn.textContent = '⏳ geocoding...';
        this.setGeocodeStatus('loading', 'Looking up coordinates...');

        try {
            const result = await this.geocodingService.geocodeAddressWithRetry(
                address,
                city,
                state,
                country,
                (attempt, maxAttempts, delaySeconds) => {
                    this.setGeocodeStatus('loading', `Network error, retrying in ${delaySeconds}s... (attempt ${attempt}/${maxAttempts})`);
                }
            );

            // Update latitude/longitude properties
            this.properties.latitude = result.latitude;
            this.properties.longitude = result.longitude;

            // Update the input fields visually
            const latInput = document.getElementById('entity-latitude') as HTMLInputElement;
            const lngInput = document.getElementById('entity-longitude') as HTMLInputElement;

            if (latInput) {
                latInput.value = result.latitude.toString();
            }
            if (lngInput) {
                lngInput.value = result.longitude.toString();
            }

            // Show success with coordinates and confidence
            const coordsStr = GeocodingService.formatCoordinates(result.latitude, result.longitude);
            let statusText = `✓ Found: ${coordsStr}`;
            if (result.confidence === 'low') {
                statusText += ' (low confidence - please verify)';
            }
            this.setGeocodeStatus('success', statusText);

            // Optionally auto-fill missing address components
            if (!this.properties.city && result.city) {
                this.properties.city = result.city;
                const cityInput = document.getElementById('entity-city') as HTMLInputElement;
                if (cityInput) cityInput.value = result.city;
            }
            if (!this.properties.state && result.state) {
                this.properties.state = result.state;
                const stateInput = document.getElementById('entity-state') as HTMLInputElement;
                if (stateInput) stateInput.value = result.state;
            }
            if (!this.properties.country && result.country) {
                this.properties.country = result.country;
                const countryInput = document.getElementById('entity-country') as HTMLInputElement;
                if (countryInput) countryInput.value = result.country;
            }
            if (!this.properties.postal_code && result.postalCode) {
                this.properties.postal_code = result.postalCode;
                const postalInput = document.getElementById('entity-postal_code') as HTMLInputElement;
                if (postalInput) postalInput.value = result.postalCode;
            }

        } catch (error) {
            console.error('[EntityEditModal] Geocoding error:', error);

            if (error instanceof GeocodingError) {
                switch (error.type) {
                    case GeocodingErrorType.NotFound:
                        this.setGeocodeStatus('error', '✗ Address not found. Please check the address or enter coordinates manually.');
                        break;
                    case GeocodingErrorType.RateLimited:
                        this.setGeocodeStatus('error', '✗ Too many requests. Please wait a moment and try again.');
                        break;
                    case GeocodingErrorType.NetworkError:
                        this.setGeocodeStatus('error', '✗ Network error. Please check your internet connection.');
                        break;
                    case GeocodingErrorType.InvalidInput:
                        this.setGeocodeStatus('error', '✗ ' + error.message);
                        break;
                    default:
                        this.setGeocodeStatus('error', '✗ Geocoding failed. Please enter coordinates manually.');
                }
            } else {
                this.setGeocodeStatus('error', '✗ Geocoding failed. Please enter coordinates manually.');
            }
        } finally {
            // Reset button state
            if (this.geocodeBtn) {
                this.geocodeBtn.disabled = false;
                this.geocodeBtn.textContent = '📍 geocode address';
            }
        }
    }

    /**
     * Set the geocode status message with appropriate styling
     */
    private setGeocodeStatus(type: 'success' | 'error' | 'loading', message: string): void {
        if (!this.geocodeStatusEl) return;

        this.geocodeStatusEl.textContent = message;
        this.geocodeStatusEl.removeClass('graph_copilot-geocode-status-success');
        this.geocodeStatusEl.removeClass('graph_copilot-geocode-status-error');
        this.geocodeStatusEl.removeClass('graph_copilot-geocode-status-loading');

        this.geocodeStatusEl.addClass(`graph_copilot-geocode-status-${type}`);
    }

    private createPropertyField(container: HTMLElement, propertyName: string, isRequired: boolean): void {
        const fieldContainer = container.createDiv({ cls: 'graph_copilot-entity-field' });

        const label = fieldContainer.createEl('label', {
            text: this.formatPropertyName(propertyName) + (isRequired ? ' *' : '')
        });
        label.setAttribute('for', `entity-${propertyName}`);

        let input: HTMLInputElement | HTMLTextAreaElement;
        const currentValue = this.properties[propertyName];

        // Use textarea for notes and description fields
        if (propertyName === 'notes' || propertyName === 'description' || propertyName === 'text') {
            input = fieldContainer.createEl('textarea', {
                placeholder: `Enter ${this.formatPropertyName(propertyName).toLowerCase()}...`
            }) as HTMLTextAreaElement;
            input.rows = 3;
            if (currentValue) input.value = currentValue;
        } else if (propertyName === 'start_date' || propertyName === 'end_date') {
            // Date-time input for date fields
            input = fieldContainer.createEl('input', {
                type: 'datetime-local'
            }) as HTMLInputElement;
            // Convert stored format back to datetime-local format
            if (currentValue) {
                (input as HTMLInputElement).value = currentValue.replace(' ', 'T');
            }
        } else if (propertyName === 'latitude' || propertyName === 'longitude') {
            // Number input for coordinates
            input = fieldContainer.createEl('input', {
                type: 'number',
                placeholder: propertyName === 'latitude' ? '-90 to 90' : '-180 to 180'
            }) as HTMLInputElement;
            (input as HTMLInputElement).step = 'any';
            if (currentValue !== undefined && currentValue !== null) {
                (input as HTMLInputElement).value = currentValue.toString();
            }
        } else if (propertyName === 'add_to_timeline' || propertyName === 'tampered') {
            // Boolean toggle button with visual feedback
            const toggleContainer = fieldContainer.createDiv({ cls: 'graph_copilot-toggle-container' });
            toggleContainer.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-top: 4px;';

            // Hidden checkbox for form state
            input = toggleContainer.createEl('input', {
                type: 'checkbox'
            }) as HTMLInputElement;
            input.id = `entity-${propertyName}`;
            input.style.display = 'none';
            if (currentValue) (input as HTMLInputElement).checked = true;

            // Create a styled toggle button
            const toggleBtn = toggleContainer.createEl('button', {
                cls: 'graph_copilot-toggle-btn'
            });
            toggleBtn.type = 'button';
            toggleBtn.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 20px;
                font-size: 14px;
                font-weight: 500;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                border: 2px solid var(--background-modifier-border);
                background: var(--background-secondary);
                color: var(--text-muted);
            `;

            // Icon and text
            const icon = toggleBtn.createSpan({ cls: 'toggle-icon' });
            icon.textContent = '📅';
            icon.style.fontSize = '16px';

            const btnText = toggleBtn.createSpan({ cls: 'toggle-text' });

            // Update button appearance based on state
            const updateButtonState = (checked: boolean) => {
                if (checked) {
                    toggleBtn.style.background = 'var(--interactive-accent)';
                    toggleBtn.style.borderColor = 'var(--interactive-accent)';
                    toggleBtn.style.color = 'white';
                    btnText.textContent = 'On timeline ✓';
                } else {
                    toggleBtn.style.background = 'var(--background-secondary)';
                    toggleBtn.style.borderColor = 'var(--background-modifier-border)';
                    toggleBtn.style.color = 'var(--text-muted)';
                    btnText.textContent = 'Add to timeline';
                }
            };

            // Initialize state
            updateButtonState(!!currentValue);

            // Toggle on click
            toggleBtn.addEventListener('click', () => {
                const newChecked = !(input as HTMLInputElement).checked;
                (input as HTMLInputElement).checked = newChecked;
                this.properties[propertyName] = newChecked;
                updateButtonState(newChecked);
            });

            // Hover effect
            toggleBtn.addEventListener('mouseenter', () => {
                if (!(input as HTMLInputElement).checked) {
                    toggleBtn.style.borderColor = 'var(--interactive-accent)';
                    toggleBtn.style.color = 'var(--text-normal)';
                }
            });
            toggleBtn.addEventListener('mouseleave', () => {
                updateButtonState((input as HTMLInputElement).checked);
            });

            return; // Early return since we've handled everything
        } else {
            // Default text input
            input = fieldContainer.createEl('input', {
                type: 'text',
                placeholder: `Enter ${this.formatPropertyName(propertyName).toLowerCase()}...`
            }) as HTMLInputElement;
            if (currentValue) input.value = currentValue;
        }

        input.id = `entity-${propertyName}`;
        input.addClass('graph_copilot-entity-input');

        // Store value on change
        input.addEventListener('input', () => {
            if (input.type === 'datetime-local') {
                // Convert to YYYY-MM-DD HH:mm format
                const value = (input as HTMLInputElement).value;
                if (value) {
                    this.properties[propertyName] = value.replace('T', ' ');
                }
            } else if (input.type === 'number') {
                const value = parseFloat((input as HTMLInputElement).value);
                if (!isNaN(value)) {
                    this.properties[propertyName] = value;
                }
            } else {
                this.properties[propertyName] = input.value;
            }
        });

        // Also handle change event for datetime-local
        input.addEventListener('change', () => {
            if (input.type === 'datetime-local') {
                const value = (input as HTMLInputElement).value;
                if (value) {
                    this.properties[propertyName] = value.replace('T', ' ');
                }
            }
        });
    }

    private formatPropertyName(name: string): string {
        return name
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    private async handleSave(): Promise<void> {
        const config = ENTITY_CONFIGS[this.entity.type as EntityType];
        const labelField = config.labelField;

        // Only validate that entity name is not generic (if provided)
        if (this.properties[labelField] && this.properties[labelField].trim() !== '') {
            const nameValidation = validateEntityName(this.properties[labelField], this.entity.type);
            if (!nameValidation.isValid) {
                new Notice(nameValidation.error || 'Invalid entity name');
                return;
            }
        }

        try {
            // Note: No auto-geocoding for manual editing - user should click the Geocode button explicitly
            const updatedEntity = await this.entityManager.updateEntity(this.entity.id, this.properties);

            if (updatedEntity) {
                new Notice(`Updated ${this.entity.type}: ${updatedEntity.label}`);

                if (this.onEntityUpdated) {
                    this.onEntityUpdated(this.entity.id);
                }

                this.close();
            } else {
                new Notice('Failed to update entity: entity not found');
            }
        } catch (error) {
            new Notice(`Failed to update entity: ${error}`);
            console.error('Entity update error:', error);
        }
    }

    /**
     * Automatically geocode if address info exists but coordinates are missing
     */
    private async autoGeocodeIfNeeded(): Promise<void> {
        const hasCoordinates = this.properties.latitude && this.properties.longitude;
        const hasAddressInfo = this.properties.address || this.properties.city || this.properties.country;

        if (hasCoordinates || !hasAddressInfo) {
            return; // Already has coordinates or no address to geocode
        }

        console.log('[EntityEditModal] Auto-geocoding location...');
        this.setGeocodeStatus('loading', 'Auto-geocoding address...');

        try {
            const result = await this.geocodingService.geocodeAddressWithRetry(
                this.properties.address,
                this.properties.city,
                this.properties.state,
                this.properties.country,
                (attempt, maxAttempts, delaySeconds) => {
                    this.setGeocodeStatus('loading', `Network error, retrying in ${delaySeconds}s... (attempt ${attempt}/${maxAttempts})`);
                }
            );

            // Update properties with geocoded coordinates
            this.properties.latitude = result.latitude;
            this.properties.longitude = result.longitude;

            // Update input fields visually
            const latInput = document.getElementById('entity-latitude') as HTMLInputElement;
            const lngInput = document.getElementById('entity-longitude') as HTMLInputElement;
            if (latInput) latInput.value = result.latitude.toString();
            if (lngInput) lngInput.value = result.longitude.toString();

            // Auto-fill missing address components
            if (!this.properties.city && result.city) {
                this.properties.city = result.city;
                const cityInput = document.getElementById('entity-city') as HTMLInputElement;
                if (cityInput) cityInput.value = result.city;
            }
            if (!this.properties.state && result.state) {
                this.properties.state = result.state;
                const stateInput = document.getElementById('entity-state') as HTMLInputElement;
                if (stateInput) stateInput.value = result.state;
            }
            if (!this.properties.country && result.country) {
                this.properties.country = result.country;
                const countryInput = document.getElementById('entity-country') as HTMLInputElement;
                if (countryInput) countryInput.value = result.country;
            }

            const coordsStr = GeocodingService.formatCoordinates(result.latitude, result.longitude);
            this.setGeocodeStatus('success', `✓ Auto-geocoded: ${coordsStr}`);
            console.log('[EntityEditModal] Auto-geocoded successfully:', coordsStr);

        } catch (error) {
            console.warn('[EntityEditModal] Auto-geocoding failed:', error);
            // Don't block entity save - just log the warning
            this.setGeocodeStatus('error', '⚠ Auto-geocoding failed - entity will be saved without coordinates');
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * FTM Entity Creation Modal - creates entities using FTM schema format.
 * Shows required properties by default with collapsible optional properties.
 */
export class FTMEntityCreationModal extends Modal {
    private entityManager: EntityManager;
    private schemaName: string;
    private properties: Record<string, any> = {};
    private onEntityCreated: ((entityId: string) => void) | null;
    private optionalSectionExpanded: boolean = false;

    constructor(
        app: App,
        entityManager: EntityManager,
        schemaName: string,
        onEntityCreated?: (entityId: string) => void
    ) {
        super(app);
        this.entityManager = entityManager;
        this.schemaName = schemaName;
        this.onEntityCreated = onEntityCreated || null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('graph_copilot-entity-modal');
        contentEl.addClass('graph_copilot-ftm-modal');

        const config = getFTMEntityConfig(this.schemaName);
        if (!config) {
            contentEl.createEl('p', { text: `Unknown schema: ${this.schemaName}` });
            return;
        }

        // Title
        contentEl.createEl('h2', { text: `Create ${config.label}` });
        contentEl.createEl('p', {
            text: config.description,
            cls: 'graph_copilot-entity-modal-description'
        });

        // Create form container
        const formContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });

        // Required properties section
        if (config.requiredProperties.length > 0) {
            formContainer.createEl('h4', { text: 'Required properties', cls: 'graph_copilot-section-header' });
            for (const prop of config.requiredProperties) {
                const propDef = config.propertyDefinitions[prop];
                if (propDef) {
                    this.createFTMPropertyField(formContainer, prop, propDef, true);
                }
            }
        }

        // Featured properties section (non-required featured properties)
        const featuredNonRequired = config.featuredProperties.filter(
            p => !config.requiredProperties.includes(p)
        );
        if (featuredNonRequired.length > 0) {
            formContainer.createEl('h4', { text: 'Key properties', cls: 'graph_copilot-section-header' });
            for (const prop of featuredNonRequired) {
                const propDef = config.propertyDefinitions[prop];
                if (propDef) {
                    this.createFTMPropertyField(formContainer, prop, propDef, false);
                }
            }
        }

        // Optional properties section (collapsible)
        if (config.optionalProperties.length > 0) {
            const optionalSection = contentEl.createDiv({ cls: 'graph_copilot-optional-section' });

            const optionalHeader = optionalSection.createDiv({ cls: 'graph_copilot-optional-header' });
            const toggleIcon = optionalHeader.createSpan({ cls: 'graph_copilot-toggle-icon', text: '▶' });
            optionalHeader.createSpan({ text: ` Additional Properties (${config.optionalProperties.length})` });

            const optionalContent = optionalSection.createDiv({ cls: 'graph_copilot-optional-content' });
            optionalContent.style.display = 'none';

            optionalHeader.onclick = () => {
                this.optionalSectionExpanded = !this.optionalSectionExpanded;
                toggleIcon.textContent = this.optionalSectionExpanded ? '▼' : '▶';
                optionalContent.style.display = this.optionalSectionExpanded ? 'block' : 'none';
            };

            for (const prop of config.optionalProperties) {
                const propDef = config.propertyDefinitions[prop];
                if (propDef && !propDef.hidden) {
                    this.createFTMPropertyField(optionalContent, prop, propDef, false);
                }
            }
        }

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-modal-buttons' });

        const createBtn = buttonContainer.createEl('button', {
            text: 'Create entity',
            cls: 'mod-cta'
        });
        createBtn.onclick = () => this.handleCreate();

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    private createFTMPropertyField(
        container: HTMLElement,
        propertyName: string,
        propDef: FTMPropertyDefinition,
        isRequired: boolean
    ): void {
        const fieldContainer = container.createDiv({ cls: 'graph_copilot-entity-field' });

        const label = fieldContainer.createEl('label', {
            text: propDef.label + (isRequired ? ' *' : '')
        });
        label.setAttribute('for', `entity-${propertyName}`);

        let input: HTMLInputElement | HTMLTextAreaElement;

        // Determine input type based on FTM property type
        const propType = propDef.type || 'string';

        if (propType === 'text' || propertyName === 'description' || propertyName === 'notes' || propertyName === 'summary') {
            input = fieldContainer.createEl('textarea', {
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLTextAreaElement;
            input.rows = 3;
        } else if (propType === 'date') {
            input = fieldContainer.createEl('input', {
                type: 'date'
            }) as HTMLInputElement;
        } else if (propType === 'number') {
            input = fieldContainer.createEl('input', {
                type: 'number',
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLInputElement;
            (input as HTMLInputElement).step = 'any';
        } else if (propType === 'url') {
            input = fieldContainer.createEl('input', {
                type: 'url',
                placeholder: 'https://...'
            }) as HTMLInputElement;
        } else if (propType === 'email') {
            input = fieldContainer.createEl('input', {
                type: 'email',
                placeholder: 'email@example.com'
            }) as HTMLInputElement;
        } else if (propType === 'phone') {
            input = fieldContainer.createEl('input', {
                type: 'tel',
                placeholder: '+1 234 567 8900'
            }) as HTMLInputElement;
        } else if (propType === 'country') {
            input = fieldContainer.createEl('input', {
                type: 'text',
                placeholder: 'Country code (e.g., US, GB, DE)'
            }) as HTMLInputElement;
        } else {
            // Default text input
            input = fieldContainer.createEl('input', {
                type: 'text',
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLInputElement;
        }

        input.id = `entity-${propertyName}`;
        input.addClass('graph_copilot-entity-input');

        // Store value on change
        input.addEventListener('input', () => {
            if (input.type === 'number') {
                const value = parseFloat((input as HTMLInputElement).value);
                if (!isNaN(value)) {
                    this.properties[propertyName] = value;
                }
            } else {
                this.properties[propertyName] = input.value;
            }
        });
    }

    private async handleCreate(): Promise<void> {
        const config = getFTMEntityConfig(this.schemaName);
        if (!config) return;

        // Only validate that entity name is not generic (if provided)
        const labelField = config.labelField;
        if (this.properties[labelField] && String(this.properties[labelField]).trim() !== '') {
            const nameValidation = validateEntityName(this.properties[labelField], this.schemaName);
            if (!nameValidation.isValid) {
                new Notice(nameValidation.error || 'Invalid entity name');
                return;
            }
        }

        try {
            // Create entity using FTM schema
            // Skip auto-geocoding for manual creation - user should click the Geocode button explicitly
            const entity = await this.entityManager.createFTMEntity(
                this.schemaName,
                this.properties,
                { skipAutoGeocode: true }
            );
            new Notice(`Created ${config.label}: ${entity.label}`);

            if (this.onEntityCreated) {
                this.onEntityCreated(entity.id);
            }

            this.close();
        } catch (error) {
            new Notice(`Failed to create entity: ${error}`);
            console.error('FTM Entity creation error:', error);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * FTM Entity Type Selector Modal - allows users to choose which FTM entity type to create.
 */
export class FTMEntityTypeSelectorModal extends Modal {
    private entityManager: EntityManager;
    private onEntityCreated: ((entityId: string) => void) | null;
    private searchInput: HTMLInputElement | null = null;
    private gridContainer: HTMLDivElement | null = null;
    private entityTypes: Array<{ name: string; label: string; description: string; color: string }> = [];

    constructor(
        app: App,
        entityManager: EntityManager,
        onEntityCreated?: (entityId: string) => void
    ) {
        super(app);
        this.entityManager = entityManager;
        this.onEntityCreated = onEntityCreated || null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('graph_copilot-entity-selector-modal');

        contentEl.createEl('h2', { text: 'Create new entity' });
        contentEl.createEl('p', { text: 'Select the type of entity to create:' });

        // Search input for filtering entity types
        const searchContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-search-container' });
        searchContainer.style.cssText = 'margin-bottom: 12px;';

        this.searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: 'Search entity types...',
            cls: 'graph_copilot-entity-search-input'
        });
        this.searchInput.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            background: var(--background-primary);
            color: var(--text-normal);
            font-size: 14px;
        `;
        this.searchInput.addEventListener('input', () => this.filterEntityTypes());

        // Grid container with scrolling
        const scrollContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-scroll-container' });
        scrollContainer.style.cssText = `
            max-height: 400px;
            overflow-y: auto;
            padding-right: 8px;
        `;

        this.gridContainer = scrollContainer.createDiv({ cls: 'graph_copilot-entity-type-grid' });

        // getAvailableFTMEntityTypes() returns types pre-sorted with LegalEntity first
        this.entityTypes = getAvailableFTMEntityTypes();

        this.renderEntityTypes(this.entityTypes);

        // Cancel button
        const cancelBtn = contentEl.createEl('button', {
            text: 'Cancel',
            cls: 'graph_copilot-entity-cancel-btn'
        });
        cancelBtn.onclick = () => this.close();

        // Focus search input
        setTimeout(() => this.searchInput?.focus(), 50);
    }

    private filterEntityTypes(): void {
        const query = this.searchInput?.value.toLowerCase() || '';
        const filtered = this.entityTypes.filter(type =>
            type.label.toLowerCase().includes(query) ||
            type.description.toLowerCase().includes(query) ||
            type.name.toLowerCase().includes(query)
        );
        this.renderEntityTypes(filtered);
    }

    private renderEntityTypes(types: Array<{ name: string; label: string; description: string; color: string }>): void {
        if (!this.gridContainer) return;
        this.gridContainer.empty();

        if (types.length === 0) {
            const noResults = this.gridContainer.createDiv({ cls: 'graph_copilot-no-results' });
            noResults.style.cssText = `
                text-align: center;
                padding: 20px;
                color: var(--text-muted);
            `;
            noResults.textContent = 'No entity types match your search.';
            return;
        }

        for (const typeInfo of types) {
            const typeBtn = this.gridContainer.createDiv({ cls: 'graph_copilot-entity-type-btn' });
            typeBtn.style.borderLeftColor = typeInfo.color;

            const icon = typeBtn.createDiv({ cls: 'graph_copilot-entity-type-icon' });
            icon.style.backgroundColor = typeInfo.color;
            icon.style.fontSize = '20px';
            icon.style.display = 'flex';
            icon.style.alignItems = 'center';
            icon.style.justifyContent = 'center';
            icon.textContent = getEntityIcon(typeInfo.name);

            const info = typeBtn.createDiv({ cls: 'graph_copilot-entity-type-info' });
            info.createEl('strong', { text: typeInfo.label });
            info.createEl('small', { text: typeInfo.description });

            typeBtn.onclick = () => {
                this.close();
                const createModal = new FTMEntityCreationModal(
                    this.app,
                    this.entityManager,
                    typeInfo.name,
                    this.onEntityCreated || undefined
                );
                createModal.open();
            };
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * FTM Entity Edit Modal - edits entities using FTM schema format.
 * Shows required properties by default with collapsible optional properties.
 */
export class FTMEntityEditModal extends Modal {
    private entityManager: EntityManager;
    private entity: Entity;
    private schemaName: string;
    private properties: Record<string, any> = {};
    private onEntityUpdated: ((entityId: string) => void) | null;
    private optionalSectionExpanded: boolean = false;
    private geocodingService: GeocodingService;
    private geocodeStatusEl: HTMLElement | null = null;

    constructor(
        app: App,
        entityManager: EntityManager,
        entity: Entity,
        onEntityUpdated?: (entityId: string) => void
    ) {
        super(app);
        this.entityManager = entityManager;
        this.entity = entity;
        // Use ftmSchema if available, otherwise use type
        this.schemaName = entity.ftmSchema || String(entity.type);
        this.properties = { ...entity.properties };
        this.onEntityUpdated = onEntityUpdated || null;
        this.geocodingService = new GeocodingService();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('graph_copilot-entity-modal');
        contentEl.addClass('graph_copilot-ftm-modal');

        const config = getFTMEntityConfig(this.schemaName);
        if (!config) {
            // Fall back to generic property editor for non-FTM entities
            this.renderNonFTMEntityEditor(contentEl);
            return;
        }

        // Title
        contentEl.createEl('h2', { text: `Edit ${config.label}` });
        contentEl.createEl('p', {
            text: `Editing: ${this.entity.label}`,
            cls: 'graph_copilot-entity-modal-description'
        });

        // Create form container
        const formContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });

        // Required properties section
        if (config.requiredProperties.length > 0) {
            formContainer.createEl('h4', { text: 'Required properties', cls: 'graph_copilot-section-header' });
            for (const prop of config.requiredProperties) {
                const propDef = config.propertyDefinitions[prop];
                if (propDef) {
                    this.createFTMPropertyField(formContainer, prop, propDef, true);
                }
            }
        }

        // Featured properties section (non-required featured properties)
        const featuredNonRequired = config.featuredProperties.filter(
            p => !config.requiredProperties.includes(p)
        );
        if (featuredNonRequired.length > 0) {
            formContainer.createEl('h4', { text: 'Key properties', cls: 'graph_copilot-section-header' });
            for (const prop of featuredNonRequired) {
                const propDef = config.propertyDefinitions[prop];
                if (propDef) {
                    this.createFTMPropertyField(formContainer, prop, propDef, false);
                }
            }
        }

        // Optional properties section (collapsible)
        if (config.optionalProperties.length > 0) {
            const optionalSection = contentEl.createDiv({ cls: 'graph_copilot-optional-section' });

            const optionalHeader = optionalSection.createDiv({ cls: 'graph_copilot-optional-header' });
            const toggleIcon = optionalHeader.createSpan({ cls: 'graph_copilot-toggle-icon', text: '▶' });
            optionalHeader.createSpan({ text: ` Additional Properties (${config.optionalProperties.length})` });

            const optionalContent = optionalSection.createDiv({ cls: 'graph_copilot-optional-content' });
            optionalContent.style.display = 'none';

            optionalHeader.onclick = () => {
                this.optionalSectionExpanded = !this.optionalSectionExpanded;
                toggleIcon.textContent = this.optionalSectionExpanded ? '▼' : '▶';
                optionalContent.style.display = this.optionalSectionExpanded ? 'block' : 'none';
            };

            for (const prop of config.optionalProperties) {
                const propDef = config.propertyDefinitions[prop];
                if (propDef && !propDef.hidden) {
                    this.createFTMPropertyField(optionalContent, prop, propDef, false);
                }
            }
        }

        // Geocoding section for Location and Address entities without coordinates
        if ((this.schemaName === 'Location' || this.schemaName === 'Address') &&
            (!this.properties.latitude || !this.properties.longitude)) {
            this.createGeocodingSection(contentEl);
        }

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-modal-buttons' });

        const saveBtn = buttonContainer.createEl('button', {
            text: 'Save changes',
            cls: 'mod-cta'
        });
        saveBtn.onclick = () => this.handleSave();

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    private createFTMPropertyField(
        container: HTMLElement,
        propertyName: string,
        propDef: FTMPropertyDefinition,
        isRequired: boolean
    ): void {
        const fieldContainer = container.createDiv({ cls: 'graph_copilot-entity-field' });

        const label = fieldContainer.createEl('label', {
            text: propDef.label + (isRequired ? ' *' : '')
        });
        label.setAttribute('for', `entity-${propertyName}`);

        let input: HTMLInputElement | HTMLTextAreaElement;
        const currentValue = this.properties[propertyName];

        // Determine input type based on FTM property type
        const propType = propDef.type || 'string';

        if (propType === 'boolean') {
            // Boolean toggle button with visual feedback
            const toggleContainer = fieldContainer.createDiv({ cls: 'graph_copilot-toggle-container' });
            toggleContainer.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-top: 4px;';

            // Hidden checkbox for form state
            input = toggleContainer.createEl('input', {
                type: 'checkbox'
            }) as HTMLInputElement;
            input.id = `entity-${propertyName}`;
            input.style.display = 'none';
            if (currentValue) (input as HTMLInputElement).checked = true;

            // Create a styled toggle button
            const toggleBtn = toggleContainer.createEl('button', {
                cls: 'graph_copilot-toggle-btn'
            });
            toggleBtn.type = 'button';
            toggleBtn.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 20px;
                font-size: 14px;
                font-weight: 500;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                border: 2px solid var(--background-modifier-border);
                background: var(--background-secondary);
                color: var(--text-muted);
            `;

            // Icon and text
            const icon = toggleBtn.createSpan({ cls: 'toggle-icon' });
            icon.textContent = '📅';
            icon.style.fontSize = '16px';

            const btnText = toggleBtn.createSpan({ cls: 'toggle-text' });

            // Update button appearance based on state
            const updateButtonState = (checked: boolean) => {
                if (checked) {
                    toggleBtn.style.background = 'var(--interactive-accent)';
                    toggleBtn.style.borderColor = 'var(--interactive-accent)';
                    toggleBtn.style.color = 'white';
                    btnText.textContent = 'On timeline ✓';
                } else {
                    toggleBtn.style.background = 'var(--background-secondary)';
                    toggleBtn.style.borderColor = 'var(--background-modifier-border)';
                    toggleBtn.style.color = 'var(--text-muted)';
                    btnText.textContent = 'Add to timeline';
                }
            };

            // Initialize state
            updateButtonState(!!currentValue);

            // Toggle on click
            toggleBtn.addEventListener('click', () => {
                const newChecked = !(input as HTMLInputElement).checked;
                (input as HTMLInputElement).checked = newChecked;
                this.properties[propertyName] = newChecked;
                updateButtonState(newChecked);
            });

            // Hover effect
            toggleBtn.addEventListener('mouseenter', () => {
                if (!(input as HTMLInputElement).checked) {
                    toggleBtn.style.borderColor = 'var(--interactive-accent)';
                    toggleBtn.style.color = 'var(--text-normal)';
                }
            });
            toggleBtn.addEventListener('mouseleave', () => {
                updateButtonState((input as HTMLInputElement).checked);
            });

            return; // Early return since we've handled everything
        } else if (propType === 'text' || propertyName === 'description' || propertyName === 'notes' || propertyName === 'summary') {
            input = fieldContainer.createEl('textarea', {
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLTextAreaElement;
            input.rows = 3;
            if (currentValue) input.value = currentValue;
        } else if (propType === 'date') {
            input = fieldContainer.createEl('input', {
                type: 'date'
            }) as HTMLInputElement;
            if (currentValue) (input as HTMLInputElement).value = currentValue;
        } else if (propType === 'number') {
            input = fieldContainer.createEl('input', {
                type: 'number',
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLInputElement;
            (input as HTMLInputElement).step = 'any';
            if (currentValue !== undefined && currentValue !== null) {
                (input as HTMLInputElement).value = currentValue.toString();
            }
        } else if (propType === 'url') {
            input = fieldContainer.createEl('input', {
                type: 'url',
                placeholder: 'https://...'
            }) as HTMLInputElement;
            if (currentValue) input.value = currentValue;
        } else if (propType === 'email') {
            input = fieldContainer.createEl('input', {
                type: 'email',
                placeholder: 'email@example.com'
            }) as HTMLInputElement;
            if (currentValue) input.value = currentValue;
        } else if (propType === 'phone') {
            input = fieldContainer.createEl('input', {
                type: 'tel',
                placeholder: '+1 234 567 8900'
            }) as HTMLInputElement;
            if (currentValue) input.value = currentValue;
        } else if (propType === 'country') {
            input = fieldContainer.createEl('input', {
                type: 'text',
                placeholder: 'Country code (e.g., US, GB, DE)'
            }) as HTMLInputElement;
            if (currentValue) input.value = currentValue;
        } else {
            // Default text input
            input = fieldContainer.createEl('input', {
                type: 'text',
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLInputElement;
            if (currentValue) input.value = currentValue;
        }

        input.id = `entity-${propertyName}`;
        input.addClass('graph_copilot-entity-input');

        // Store value on change
        input.addEventListener('input', () => {
            if (input.type === 'number') {
                const value = parseFloat((input as HTMLInputElement).value);
                if (!isNaN(value)) {
                    this.properties[propertyName] = value;
                }
            } else {
                this.properties[propertyName] = input.value;
            }
        });
    }

    /**
     * Create geocoding section for Location and Address entities.
     */
    private createGeocodingSection(contentEl: HTMLElement): void {
        const geocodingSection = contentEl.createDiv({ cls: 'graph_copilot-geocoding-section' });
        geocodingSection.style.cssText = `
            margin-top: 20px;
            padding: 15px;
            background: var(--background-secondary);
            border-radius: 6px;
            border-left: 3px solid var(--interactive-accent);
        `;

        const header = geocodingSection.createEl('h4', { text: '📍 geocoding' });
        header.style.cssText = 'margin-top: 0; margin-bottom: 10px;';

        const description = geocodingSection.createEl('p', {
            text: 'This entity is missing coordinates. Click the button below to automatically geocode the address.',
            cls: 'text-muted'
        });
        description.style.cssText = 'font-size: 12px; margin-bottom: 12px;';

        // Status message area
        this.geocodeStatusEl = geocodingSection.createDiv({ cls: 'graph_copilot-geocode-status' });
        this.geocodeStatusEl.style.cssText = 'margin-bottom: 10px; font-size: 12px;';

        // Geocode button
        const geocodeBtn = geocodingSection.createEl('button', { text: '📍 geolocate address' });
        geocodeBtn.style.cssText = `
            padding: 8px 16px;
            background: var(--interactive-accent);
            color: var(--text-on-accent);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
        `;
        geocodeBtn.onclick = async () => {
            await this.handleGeocode(geocodeBtn);
        };
    }

    /**
     * Handle geocoding for the entity.
     */
    private async handleGeocode(button: HTMLButtonElement): Promise<void> {
        // Extract address components based on entity type
        let address: string | undefined;
        let city: string | undefined;
        let state: string | undefined;
        let country: string | undefined;

        if (this.schemaName === 'Location') {
            address = this.properties.address as string;
            city = this.properties.city as string;
            country = this.properties.country as string;
        } else if (this.schemaName === 'Address') {
            address = this.properties.street as string || this.properties.full as string;
            city = this.properties.city as string;
            state = this.properties.state as string;
            country = this.properties.country as string;
        }

        // Validate we have at least some address information
        if (!address && !city && !country) {
            this.updateGeocodeStatus('⚠️ No address information found. Please fill in address fields first.', 'error');
            return;
        }

        try {
            // Disable button during geocoding
            button.disabled = true;
            button.textContent = 'Geocoding...';
            this.updateGeocodeStatus('🔄 Geocoding address...', 'info');

            const result = await this.geocodingService.geocodeAddressWithRetry(
                address,
                city,
                state,
                country,
                (attempt, maxAttempts, delaySeconds) => {
                    this.updateGeocodeStatus(
                        `⚠️ Network error, retrying in ${delaySeconds}s... (attempt ${attempt}/${maxAttempts})`,
                        'warning'
                    );
                }
            );

            // Update properties with coordinates
            this.properties.latitude = result.latitude;
            this.properties.longitude = result.longitude;

            // Also update address components if they were found and not already set
            if (result.city && !city) {
                this.properties.city = result.city;
            }
            if (result.state && !state && this.schemaName === 'Address') {
                this.properties.state = result.state;
            }
            if (result.country && !country) {
                this.properties.country = result.country;
            }
            if (result.postalCode && this.schemaName === 'Address' && !this.properties.postalCode) {
                this.properties.postalCode = result.postalCode;
            }

            // Update status
            this.updateGeocodeStatus(
                `✓ Geocoded: ${result.displayName}\nLat: ${result.latitude.toFixed(6)}, Lng: ${result.longitude.toFixed(6)}\nConfidence: ${result.confidence}`,
                'success'
            );

            // Re-enable button
            button.disabled = false;
            button.textContent = '✓ geocoded successfully';
            button.style.background = 'var(--text-success)';

            new Notice('Geocoding successful! Don\'t forget to save your changes.');

        } catch (error) {
            // Re-enable button
            button.disabled = false;
            button.textContent = '📍 geolocate address';

            if (error instanceof GeocodingError) {
                this.updateGeocodeStatus(`✗ ${error.message}`, 'error');
                new Notice(`Geocoding failed: ${error.message}`);
            } else {
                console.error('[FTMEntityEditModal] Geocoding error:', error);
                this.updateGeocodeStatus('✗ Failed to geocode address. Please try again.', 'error');
                new Notice('Failed to geocode address. Please try again.');
            }
        }
    }

    /**
     * Update geocode status message.
     */
    private updateGeocodeStatus(message: string, type: 'info' | 'success' | 'warning' | 'error'): void {
        if (!this.geocodeStatusEl) return;

        this.geocodeStatusEl.textContent = message;

        let color = 'var(--text-muted)';
        if (type === 'success') color = 'var(--text-success)';
        else if (type === 'warning') color = 'var(--text-warning)';
        else if (type === 'error') color = 'var(--text-error)';

        this.geocodeStatusEl.style.color = color;
        this.geocodeStatusEl.style.whiteSpace = 'pre-line';
    }

    private async handleSave(): Promise<void> {
        const config = getFTMEntityConfig(this.schemaName);
        if (!config) return;

        // Only validate that entity name is not generic (if provided)
        const labelField = config.labelField;
        if (this.properties[labelField] && String(this.properties[labelField]).trim() !== '') {
            const nameValidation = validateEntityName(this.properties[labelField], this.schemaName);
            if (!nameValidation.isValid) {
                new Notice(nameValidation.error || 'Invalid entity name');
                return;
            }
        }

        try {
            const updatedEntity = await this.entityManager.updateEntity(this.entity.id, this.properties);

            if (updatedEntity) {
                new Notice(`Updated ${config.label}: ${updatedEntity.label}`);

                if (this.onEntityUpdated) {
                    this.onEntityUpdated(this.entity.id);
                }

                this.close();
            } else {
                new Notice('Failed to update entity: entity not found');
            }
        } catch (error) {
            new Notice(`Failed to update entity: ${error}`);
            console.error('FTM Entity update error:', error);
        }
    }

    /**
     * Render a generic property editor for non-FTM entities.
     * This provides a fallback editing interface for entities that don't have FTM schemas.
     */
    private renderNonFTMEntityEditor(contentEl: HTMLElement): void {
        // Title
        contentEl.createEl('h2', { text: `Edit ${this.schemaName}` });
        contentEl.createEl('p', {
            text: `Editing: ${this.entity.label}`,
            cls: 'graph_copilot-entity-modal-description'
        });

        // Info message
        const infoDiv = contentEl.createDiv({ cls: 'graph_copilot-info-message' });
        infoDiv.style.cssText = `
            padding: 12px;
            margin-bottom: 20px;
            background: var(--background-secondary);
            border-left: 3px solid var(--interactive-accent);
            border-radius: 4px;
        `;
        infoDiv.createEl('p', {
            text: `This is a non-standard entity type. You can edit its properties below.`,
            cls: 'text-muted'
        });

        // Create form container
        const formContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });

        // Get all existing properties
        const existingProps = Object.keys(this.properties);

        if (existingProps.length > 0) {
            formContainer.createEl('h4', { text: 'Properties', cls: 'graph_copilot-section-header' });

            for (const propName of existingProps) {
                this.createGenericPropertyField(formContainer, propName);
            }
        }

        // Add new property section
        const addPropSection = contentEl.createDiv({ cls: 'graph_copilot-add-property-section' });
        addPropSection.style.cssText = 'margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--background-modifier-border);';

        addPropSection.createEl('h4', { text: 'Add new property', cls: 'graph_copilot-section-header' });

        const addPropContainer = addPropSection.createDiv({ cls: 'graph_copilot-add-property-container' });
        addPropContainer.style.cssText = 'display: flex; gap: 10px; align-items: flex-end;';

        const nameFieldContainer = addPropContainer.createDiv({ cls: 'graph_copilot-entity-field' });
        nameFieldContainer.style.flex = '1';
        nameFieldContainer.createEl('label', { text: 'Property name' });
        const nameInput = nameFieldContainer.createEl('input', {
            type: 'text',
            placeholder: 'e.g., address, phone, email'
        }) as HTMLInputElement;
        nameInput.addClass('graph_copilot-entity-input');

        const valueFieldContainer = addPropContainer.createDiv({ cls: 'graph_copilot-entity-field' });
        valueFieldContainer.style.flex = '2';
        valueFieldContainer.createEl('label', { text: 'Property value' });
        const valueInput = valueFieldContainer.createEl('input', {
            type: 'text',
            placeholder: 'Enter value...'
        }) as HTMLInputElement;
        valueInput.addClass('graph_copilot-entity-input');

        const addBtn = addPropContainer.createEl('button', { text: '+ add' });
        addBtn.style.cssText = 'padding: 8px 16px; margin-bottom: 2px;';
        addBtn.onclick = () => {
            const propName = nameInput.value.trim();
            const propValue = valueInput.value.trim();

            if (!propName) {
                new Notice('Please enter a property name');
                return;
            }

            if (!propValue) {
                new Notice('Please enter a property value');
                return;
            }

            // Add the property
            this.properties[propName] = propValue;

            // Re-render the form
            contentEl.empty();
            this.renderNonFTMEntityEditor(contentEl);

            new Notice(`Added property: ${propName}`);
        };

        // Geocoding section for Location entities without coordinates
        if (this.schemaName === 'Location' &&
            (!this.properties.latitude || !this.properties.longitude)) {
            this.createGeocodingSection(contentEl);
        }

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-modal-buttons' });

        const saveBtn = buttonContainer.createEl('button', {
            text: 'Save changes',
            cls: 'mod-cta'
        });
        saveBtn.onclick = () => this.handleNonFTMSave();

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    /**
     * Create a generic property field for non-FTM entities.
     */
    private createGenericPropertyField(container: HTMLElement, propertyName: string): void {
        const fieldContainer = container.createDiv({ cls: 'graph_copilot-entity-field' });
        fieldContainer.style.cssText = 'display: flex; gap: 10px; align-items: flex-start;';

        const inputContainer = fieldContainer.createDiv();
        inputContainer.style.flex = '1';

        const label = inputContainer.createEl('label', { text: propertyName });
        label.setAttribute('for', `entity-${propertyName}`);

        const currentValue = this.properties[propertyName];
        const input = inputContainer.createEl('input', {
            type: 'text',
            value: String(currentValue || '')
        }) as HTMLInputElement;
        input.id = `entity-${propertyName}`;
        input.addClass('graph_copilot-entity-input');

        // Store value on change
        input.addEventListener('input', () => {
            this.properties[propertyName] = input.value;
        });

        // Delete button
        const deleteBtn = fieldContainer.createEl('button', { text: '🗑' });
        deleteBtn.style.cssText = 'padding: 8px 12px; margin-top: 24px;';
        deleteBtn.title = 'Delete property';
        deleteBtn.onclick = () => {
            delete this.properties[propertyName];
            fieldContainer.remove();
            new Notice(`Deleted property: ${propertyName}`);
        };
    }

    /**
     * Handle save for non-FTM entities.
     */
    private async handleNonFTMSave(): Promise<void> {
        try {
            const updatedEntity = await this.entityManager.updateEntity(this.entity.id, this.properties);

            if (updatedEntity) {
                new Notice(`Updated ${this.schemaName}: ${updatedEntity.label}`);

                if (this.onEntityUpdated) {
                    this.onEntityUpdated(this.entity.id);
                }

                this.close();
            } else {
                new Notice('Failed to update entity: entity not found');
            }
        } catch (error) {
            new Notice(`Failed to update entity: ${error}`);
            console.error('Non-FTM Entity update error:', error);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * FTM Interval Type Selector Modal - allows users to choose which FTM interval/relationship type to create.
 * This modal is specifically for creating connections/relationships between entities using FTM interval schemas.
 */
export class FTMIntervalTypeSelectorModal extends Modal {
    private entityManager: EntityManager;
    private sourceEntityId: string | null = null;
    private targetEntityId: string | null = null;
    private onConnectionCreated: ((connectionId?: string) => void) | null;
    private searchInput: HTMLInputElement | null = null;
    private gridContainer: HTMLDivElement | null = null;
    private intervalTypes: Array<{ name: string; label: string; description: string; color: string }> = [];

    constructor(
        app: App,
        entityManager: EntityManager,
        onConnectionCreated?: (connectionId?: string) => void,
        preselectedSourceId?: string,
        preselectedTargetId?: string
    ) {
        super(app);
        this.entityManager = entityManager;
        this.onConnectionCreated = onConnectionCreated || null;
        this.sourceEntityId = preselectedSourceId || null;
        this.targetEntityId = preselectedTargetId || null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('graph_copilot-entity-selector-modal');

        contentEl.createEl('h2', { text: 'Create new connection' });
        contentEl.createEl('p', { text: 'Select the type of relationship/interval to create:' });

        // Search input for filtering interval types
        const searchContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-search-container' });
        searchContainer.style.cssText = 'margin-bottom: 12px;';

        this.searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: 'Search relationship types...',
            cls: 'graph_copilot-entity-search-input'
        });
        this.searchInput.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            background: var(--background-primary);
            color: var(--text-normal);
            font-size: 14px;
        `;
        this.searchInput.addEventListener('input', () => this.filterIntervalTypes());

        // Grid container with scrolling
        const scrollContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-scroll-container' });
        scrollContainer.style.cssText = `
            max-height: 400px;
            overflow-y: auto;
            padding-right: 8px;
        `;

        this.gridContainer = scrollContainer.createDiv({ cls: 'graph_copilot-entity-type-grid' });

        // getAvailableFTMIntervalTypes() returns types pre-sorted with UnknownLink first
        this.intervalTypes = getAvailableFTMIntervalTypes();

        this.renderIntervalTypes(this.intervalTypes);

        // Cancel button
        const cancelBtn = contentEl.createEl('button', {
            text: 'Cancel',
            cls: 'graph_copilot-entity-cancel-btn'
        });
        cancelBtn.onclick = () => this.close();

        // Focus search input
        setTimeout(() => this.searchInput?.focus(), 50);
    }

    private filterIntervalTypes(): void {
        const query = this.searchInput?.value.toLowerCase() || '';
        const filtered = this.intervalTypes.filter(type =>
            type.label.toLowerCase().includes(query) ||
            type.description.toLowerCase().includes(query) ||
            type.name.toLowerCase().includes(query)
        );
        this.renderIntervalTypes(filtered);
    }

    private renderIntervalTypes(types: Array<{ name: string; label: string; description: string; color: string }>): void {
        if (!this.gridContainer) return;
        this.gridContainer.empty();

        if (types.length === 0) {
            const noResults = this.gridContainer.createDiv({ cls: 'graph_copilot-no-results' });
            noResults.style.cssText = `
                text-align: center;
                padding: 20px;
                color: var(--text-muted);
            `;
            noResults.textContent = 'No relationship types match your search.';
            return;
        }

        for (const typeInfo of types) {
            const typeBtn = this.gridContainer.createDiv({ cls: 'graph_copilot-entity-type-btn' });
            typeBtn.style.borderLeftColor = typeInfo.color;

            const icon = typeBtn.createDiv({ cls: 'graph_copilot-entity-type-icon' });
            icon.style.backgroundColor = typeInfo.color;
            icon.textContent = '🔗'; // Connection icon

            const info = typeBtn.createDiv({ cls: 'graph_copilot-entity-type-info' });
            info.createEl('strong', { text: typeInfo.label });
            info.createEl('small', { text: typeInfo.description });

            typeBtn.onclick = () => {
                this.close();
                // Open the FTM interval creation modal
                const createModal = new FTMIntervalCreationModal(
                    this.app,
                    this.entityManager,
                    typeInfo.name,
                    this.onConnectionCreated || undefined,
                    this.sourceEntityId || undefined,
                    this.targetEntityId || undefined
                );
                createModal.open();
            };
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * FTM Interval Creation Modal - allows users to create FTM interval/relationship entities.
 * This modal provides a form for creating connections using FTM interval schemas.
 */
export class FTMIntervalCreationModal extends Modal {
    private entityManager: EntityManager;
    private intervalType: string; // FTM schema name (e.g., 'Associate', 'Ownership')
    private properties: Record<string, any> = {};
    private onConnectionCreated: ((connectionId?: string) => void) | null;
    private sourceEntityId: string | null = null;
    private targetEntityId: string | null = null;
    private entities: Entity[] = [];

    constructor(
        app: App,
        entityManager: EntityManager,
        intervalType: string,
        onConnectionCreated?: (connectionId?: string) => void,
        preselectedSourceId?: string,
        preselectedTargetId?: string
    ) {
        super(app);
        this.entityManager = entityManager;
        this.intervalType = intervalType;
        this.onConnectionCreated = onConnectionCreated || null;
        this.sourceEntityId = preselectedSourceId || null;
        this.targetEntityId = preselectedTargetId || null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('graph_copilot-entity-modal');

        // Load entities
        this.entities = this.entityManager.getAllEntities();

        const config = getFTMEntityConfig(this.intervalType);
        if (!config) {
            new Notice(`Unknown interval type: ${this.intervalType}`);
            this.close();
            return;
        }

        // Title
        contentEl.createEl('h2', { text: `Create ${config.label}` });
        contentEl.createEl('p', {
            text: config.description,
            cls: 'graph_copilot-entity-modal-description'
        });

        if (this.entities.length < 2) {
            contentEl.createEl('p', {
                text: 'You need at least 2 entities to create a connection.',
                cls: 'graph_copilot-connection-warning'
            });
            const closeBtn = contentEl.createEl('button', { text: 'Close' });
            closeBtn.onclick = () => this.close();
            return;
        }

        // Create form container
        const formContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });

        // Add entity selection dropdowns for entity-type properties
        // These are properties that reference other entities (type: 'entity')
        const entityProperties = Object.entries(config.propertyDefinitions)
            .filter(([_, def]) => def.type === 'entity')
            .map(([name, _]) => name);

        for (const propName of entityProperties) {
            this.createEntityDropdown(formContainer, propName, config.propertyDefinitions[propName]);
        }

        // Add fields for other required and featured properties
        const nonEntityProps = [...config.requiredProperties, ...config.featuredProperties]
            .filter(prop => !entityProperties.includes(prop));

        for (const propName of nonEntityProps) {
            const propDef = config.propertyDefinitions[propName];
            if (propDef) {
                this.createPropertyField(formContainer, propName, propDef, config.requiredProperties.includes(propName));
            }
        }

        // Add optional properties in collapsible section
        if (config.optionalProperties.length > 0) {
            contentEl.createEl('h4', { text: 'Additional properties' });
            const optionalContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });

            for (const propName of config.optionalProperties) {
                const propDef = config.propertyDefinitions[propName];
                if (propDef && !propDef.hidden && !entityProperties.includes(propName)) {
                    this.createPropertyField(optionalContainer, propName, propDef, false);
                }
            }
        }

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-modal-buttons' });

        const createBtn = buttonContainer.createEl('button', {
            text: `Create ${config.label}`,
            cls: 'mod-cta'
        });
        createBtn.onclick = () => this.handleCreate();

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    private createEntityDropdown(container: HTMLElement, propertyName: string, propDef: FTMPropertyDefinition): void {
        const fieldContainer = container.createDiv({ cls: 'graph_copilot-entity-field' });
        fieldContainer.createEl('label', { text: propDef.label + ' *' });

        const select = fieldContainer.createEl('select', { cls: 'graph_copilot-entity-input' });

        const placeholderOption = select.createEl('option', {
            text: `Select ${propDef.label.toLowerCase()}...`,
            value: ''
        });
        placeholderOption.disabled = true;

        // Check if this property has a preselected value
        const preselectedId = (propertyName === 'person' || propertyName === 'owner' || propertyName === 'employee' || propertyName === 'director')
            ? this.sourceEntityId
            : (propertyName === 'associate' || propertyName === 'asset' || propertyName === 'employer' || propertyName === 'organization')
                ? this.targetEntityId
                : null;

        placeholderOption.selected = !preselectedId;

        // Filter entities by range if specified
        const range = propDef.range;
        const filteredEntities = range
            ? this.entities.filter(e => e.type === range || e.ftmSchema === range)
            : this.entities;

        for (const entity of filteredEntities) {
            const option = select.createEl('option', {
                text: `${entity.label} (${entity.type})`,
                value: entity.id
            });
            if (preselectedId && entity.id === preselectedId) {
                option.selected = true;
                this.properties[propertyName] = entity.id;
            }
        }

        select.onchange = () => {
            this.properties[propertyName] = select.value || null;
        };
    }

    private createPropertyField(container: HTMLElement, propertyName: string, propDef: FTMPropertyDefinition, isRequired: boolean): void {
        const fieldContainer = container.createDiv({ cls: 'graph_copilot-entity-field' });

        const label = fieldContainer.createEl('label', {
            text: propDef.label + (isRequired ? ' *' : '')
        });
        label.setAttribute('for', `interval-${propertyName}`);

        let input: HTMLInputElement | HTMLTextAreaElement;

        // Use appropriate input type based on property type
        if (propDef.type === 'text' || propertyName === 'description' || propertyName === 'summary') {
            input = fieldContainer.createEl('textarea', {
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLTextAreaElement;
            input.rows = 3;
        } else if (propDef.type === 'date' || propertyName.includes('Date')) {
            input = fieldContainer.createEl('input', {
                type: 'date'
            }) as HTMLInputElement;
        } else if (propDef.type === 'number' || propertyName.includes('percentage') || propertyName.includes('Count') || propertyName.includes('Value')) {
            input = fieldContainer.createEl('input', {
                type: 'number',
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLInputElement;
            (input as HTMLInputElement).step = 'any';
        } else {
            input = fieldContainer.createEl('input', {
                type: 'text',
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLInputElement;
        }

        input.id = `interval-${propertyName}`;
        input.addClass('graph_copilot-entity-input');

        // Store value on change
        input.addEventListener('input', () => {
            if (input.type === 'number') {
                const value = parseFloat((input as HTMLInputElement).value);
                if (!isNaN(value)) {
                    this.properties[propertyName] = value;
                }
            } else {
                this.properties[propertyName] = input.value;
            }
        });
    }

    private async handleCreate(): Promise<void> {
        const config = getFTMEntityConfig(this.intervalType);
        if (!config) return;

        // No required field validation - allow creation with partial data

        try {
            // For now, we'll create this as a connection with the interval type as the relationship
            // In the future, this could be enhanced to create actual FTM interval entities
            const entityProps = Object.entries(config.propertyDefinitions)
                .filter(([_, def]) => def.type === 'entity')
                .map(([name, _]) => name);

            if (entityProps.length >= 2) {
                const sourceId = this.properties[entityProps[0]];
                const targetId = this.properties[entityProps[1]];

                if (!sourceId || !targetId) {
                    new Notice('Please select both entities for the connection');
                    return;
                }

                if (sourceId === targetId) {
                    new Notice('Source and target entities must be different');
                    return;
                }

                // Create connection with interval type as relationship
                const connection = await this.entityManager.createConnection(
                    sourceId,
                    targetId,
                    this.intervalType
                );

                if (connection) {
                    const sourceEntity = this.entityManager.getEntity(sourceId);
                    const targetEntity = this.entityManager.getEntity(targetId);
                    new Notice(`Created: ${sourceEntity?.label} → ${this.intervalType} → ${targetEntity?.label}`);

                    if (this.onConnectionCreated) {
                        this.onConnectionCreated(connection.id);
                    }
                    this.close();
                } else {
                    new Notice('Failed to create connection');
                }
            } else {
                new Notice('This interval type requires at least two entity references');
            }
        } catch (error) {
            new Notice(`Failed to create ${config.label}: ${error}`);
            console.error('Interval creation error:', error);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Connection Edit Modal - allows editing of connection properties.
 * Similar to FTMEntityEditModal but for connections/relationships.
 */
export class ConnectionEditModal extends Modal {
    private entityManager: EntityManager;
    private connection: Connection;
    private properties: Record<string, any> = {};
    private onConnectionUpdated: ((connectionId: string) => void) | null;

    constructor(
        app: App,
        entityManager: EntityManager,
        connection: Connection,
        onConnectionUpdated?: (connectionId: string) => void
    ) {
        super(app);
        this.entityManager = entityManager;
        this.connection = connection;
        this.properties = connection.properties ? { ...connection.properties } : {};
        this.onConnectionUpdated = onConnectionUpdated || null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('graph_copilot-entity-modal');
        contentEl.addClass('graph_copilot-ftm-modal');

        const intervalType = this.connection.ftmSchema || this.connection.relationship;
        const config = getFTMEntityConfig(intervalType);

        if (!config) {
            // Fall back to generic connection editor for non-FTM relationships
            this.renderNonFTMConnectionEditor(contentEl, intervalType);
            return;
        }

        // Get source and target entities
        const fromEntity = this.entityManager.getEntity(this.connection.fromEntityId);
        const toEntity = this.entityManager.getEntity(this.connection.toEntityId);

        if (!fromEntity || !toEntity) {
            contentEl.createEl('p', { text: 'Error: source or target entity not found' });
            const closeBtn = contentEl.createEl('button', { text: 'Close' });
            closeBtn.onclick = () => this.close();
            return;
        }

        // Title
        contentEl.createEl('h2', { text: `Edit ${config.label}` });
        contentEl.createEl('p', {
            text: `${fromEntity.label} → ${this.connection.relationship} → ${toEntity.label}`,
            cls: 'graph_copilot-entity-modal-description'
        });

        // Show connection details (read-only)
        const detailsContainer = contentEl.createDiv({ cls: 'graph_copilot-connection-details' });
        detailsContainer.style.cssText = `
            background: var(--background-secondary);
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 16px;
        `;
        detailsContainer.createEl('div', { text: `From: ${fromEntity.label}` });
        detailsContainer.createEl('div', { text: `To: ${toEntity.label}` });
        detailsContainer.createEl('div', { text: `Type: ${this.connection.relationship}` });

        // Create form container for editable properties
        const formContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });

        // Get non-entity properties (entity properties are source/target which are read-only)
        const editableProperties = [...config.featuredProperties, ...config.optionalProperties]
            .filter(propName => {
                const propDef = config.propertyDefinitions[propName];
                return propDef && propDef.type !== 'entity' && !propDef.hidden;
            });

        if (editableProperties.length === 0) {
            formContainer.createEl('p', {
                text: 'This connection type has no editable properties.',
                cls: 'graph_copilot-entity-modal-description'
            });
        } else {
            formContainer.createEl('h4', { text: 'Connection properties', cls: 'graph_copilot-section-header' });

            // Create fields for each editable property
            for (const propName of editableProperties) {
                const propDef = config.propertyDefinitions[propName];
                if (!propDef) continue;

                const isRequired = config.requiredProperties.includes(propName);
                this.createPropertyField(formContainer, propName, propDef, isRequired);
            }
        }

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-modal-buttons' });

        const saveBtn = buttonContainer.createEl('button', {
            text: 'Save changes',
            cls: 'mod-cta'
        });
        saveBtn.onclick = () => this.handleSave();

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    private createPropertyField(container: HTMLElement, propertyName: string, propDef: FTMPropertyDefinition, isRequired: boolean): void {
        const fieldContainer = container.createDiv({ cls: 'graph_copilot-entity-field' });

        const label = fieldContainer.createEl('label', {
            text: propDef.label + (isRequired ? ' *' : '')
        });
        label.setAttribute('for', `conn-edit-${propertyName}`);

        let input: HTMLInputElement | HTMLTextAreaElement;

        // Get current value
        const currentValue = this.properties[propertyName] || '';

        // Use appropriate input type based on property type
        if (propDef.type === 'text' || propertyName === 'description' || propertyName === 'summary') {
            input = fieldContainer.createEl('textarea', {
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLTextAreaElement;
            input.rows = 3;
            input.value = currentValue;
        } else if (propDef.type === 'date' || propertyName.includes('Date')) {
            input = fieldContainer.createEl('input', {
                type: 'date'
            }) as HTMLInputElement;
            input.value = currentValue;
        } else if (propDef.type === 'number' || propertyName.includes('percentage') || propertyName.includes('Count') || propertyName.includes('Value') || propertyName.includes('amount')) {
            input = fieldContainer.createEl('input', {
                type: 'number',
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLInputElement;
            (input as HTMLInputElement).step = 'any';
            input.value = currentValue;
        } else {
            input = fieldContainer.createEl('input', {
                type: 'text',
                placeholder: `Enter ${propDef.label.toLowerCase()}...`
            }) as HTMLInputElement;
            input.value = currentValue;
        }

        input.id = `conn-edit-${propertyName}`;
        input.addClass('graph_copilot-entity-input');

        // Store value on change
        input.addEventListener('input', () => {
            if (input.type === 'number') {
                const value = parseFloat((input as HTMLInputElement).value);
                if (!isNaN(value)) {
                    this.properties[propertyName] = value;
                } else {
                    delete this.properties[propertyName];
                }
            } else {
                const value = input.value.trim();
                if (value) {
                    this.properties[propertyName] = value;
                } else {
                    delete this.properties[propertyName];
                }
            }
        });
    }

    private async handleSave(): Promise<void> {
        const intervalType = this.connection.ftmSchema || this.connection.relationship;
        const config = getFTMEntityConfig(intervalType);

        // No required field validation - allow updates with partial data

        try {
            // Update the connection
            await this.entityManager.updateConnection(this.connection.id, this.properties);

            new Notice('Connection updated successfully');

            if (this.onConnectionUpdated) {
                this.onConnectionUpdated(this.connection.id);
            }
            this.close();
        } catch (error) {
            new Notice(`Failed to update connection: ${error}`);
            console.error('Connection update error:', error);
        }
    }

    /**
     * Render a generic connection editor for non-FTM relationships.
     */
    private renderNonFTMConnectionEditor(contentEl: HTMLElement, intervalType: string): void {
        // Get source and target entities
        const fromEntity = this.entityManager.getEntity(this.connection.fromEntityId);
        const toEntity = this.entityManager.getEntity(this.connection.toEntityId);

        if (!fromEntity || !toEntity) {
            contentEl.createEl('p', { text: 'Error: source or target entity not found' });
            const closeBtn = contentEl.createEl('button', { text: 'Close' });
            closeBtn.onclick = () => this.close();
            return;
        }

        // Title
        contentEl.createEl('h2', { text: "Edit connection" });
        contentEl.createEl('p', {
            text: `${fromEntity.label} → ${this.connection.relationship} → ${toEntity.label}`,
            cls: 'graph_copilot-entity-modal-description'
        });

        // Info message
        const infoDiv = contentEl.createDiv({ cls: 'graph_copilot-info-message' });
        infoDiv.style.cssText = `
            padding: 12px;
            margin-bottom: 20px;
            background: var(--background-secondary);
            border-left: 3px solid var(--interactive-accent);
            border-radius: 4px;
        `;
        infoDiv.createEl('p', {
            text: `This is a non-standard relationship type. You can edit its properties below.`,
            cls: 'text-muted'
        });

        // Create form container
        const formContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-form' });

        // Get all existing properties
        const existingProps = Object.keys(this.properties);

        if (existingProps.length > 0) {
            formContainer.createEl('h4', { text: 'Properties', cls: 'graph_copilot-section-header' });

            for (const propName of existingProps) {
                this.createGenericConnectionPropertyField(formContainer, propName);
            }
        }

        // Add new property section
        const addPropSection = contentEl.createDiv({ cls: 'graph_copilot-add-property-section' });
        addPropSection.style.cssText = 'margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--background-modifier-border);';

        addPropSection.createEl('h4', { text: 'Add new property', cls: 'graph_copilot-section-header' });

        const addPropContainer = addPropSection.createDiv({ cls: 'graph_copilot-add-property-container' });
        addPropContainer.style.cssText = 'display: flex; gap: 10px; align-items: flex-end;';

        const nameFieldContainer = addPropContainer.createDiv({ cls: 'graph_copilot-entity-field' });
        nameFieldContainer.style.flex = '1';
        nameFieldContainer.createEl('label', { text: 'Property name' });
        const nameInput = nameFieldContainer.createEl('input', {
            type: 'text',
            placeholder: 'e.g., date, location, notes'
        }) as HTMLInputElement;
        nameInput.addClass('graph_copilot-entity-input');

        const valueFieldContainer = addPropContainer.createDiv({ cls: 'graph_copilot-entity-field' });
        valueFieldContainer.style.flex = '2';
        valueFieldContainer.createEl('label', { text: 'Property value' });
        const valueInput = valueFieldContainer.createEl('input', {
            type: 'text',
            placeholder: 'Enter value...'
        }) as HTMLInputElement;
        valueInput.addClass('graph_copilot-entity-input');

        const addBtn = addPropContainer.createEl('button', { text: '+ add' });
        addBtn.style.cssText = 'padding: 8px 16px; margin-bottom: 2px;';
        addBtn.onclick = () => {
            const propName = nameInput.value.trim();
            const propValue = valueInput.value.trim();

            if (!propName) {
                new Notice('Please enter a property name');
                return;
            }

            if (!propValue) {
                new Notice('Please enter a property value');
                return;
            }

            // Add the property
            this.properties[propName] = propValue;

            // Re-render the form
            contentEl.empty();
            this.renderNonFTMConnectionEditor(contentEl, intervalType);

            new Notice(`Added property: ${propName}`);
        };

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-modal-buttons' });

        const saveBtn = buttonContainer.createEl('button', {
            text: 'Save changes',
            cls: 'mod-cta'
        });
        saveBtn.onclick = () => this.handleNonFTMConnectionSave();

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    /**
     * Create a generic property field for non-FTM connections.
     */
    private createGenericConnectionPropertyField(container: HTMLElement, propertyName: string): void {
        const fieldContainer = container.createDiv({ cls: 'graph_copilot-entity-field' });
        fieldContainer.style.cssText = 'display: flex; gap: 10px; align-items: flex-start;';

        const inputContainer = fieldContainer.createDiv();
        inputContainer.style.flex = '1';

        const label = inputContainer.createEl('label', { text: propertyName });
        label.setAttribute('for', `connection-${propertyName}`);

        const currentValue = this.properties[propertyName];
        const input = inputContainer.createEl('input', {
            type: 'text',
            value: String(currentValue || '')
        }) as HTMLInputElement;
        input.id = `connection-${propertyName}`;
        input.addClass('graph_copilot-entity-input');

        // Store value on change
        input.addEventListener('input', () => {
            this.properties[propertyName] = input.value;
        });

        // Delete button
        const deleteBtn = fieldContainer.createEl('button', { text: '🗑' });
        deleteBtn.style.cssText = 'padding: 8px 12px; margin-top: 24px;';
        deleteBtn.title = 'Delete property';
        deleteBtn.onclick = () => {
            delete this.properties[propertyName];
            fieldContainer.remove();
            new Notice(`Deleted property: ${propertyName}`);
        };
    }

    /**
     * Handle save for non-FTM connections.
     */
    private async handleNonFTMConnectionSave(): Promise<void> {
        try {
            await this.entityManager.updateConnection(this.connection.id, this.properties);

            new Notice('Connection updated successfully');

            if (this.onConnectionUpdated) {
                this.onConnectionUpdated(this.connection.id);
            }
            this.close();
        } catch (error) {
            new Notice(`Failed to update connection: ${error}`);
            console.error('Non-FTM Connection update error:', error);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
