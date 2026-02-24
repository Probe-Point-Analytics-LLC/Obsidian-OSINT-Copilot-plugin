import { App, Modal, Notice, Setting, TextComponent, DropdownComponent, ButtonComponent } from 'obsidian';
import { FTMSchemaDefinition, FTMPropertyDefinition } from '../services/ftm-schema-service';
import { CustomTypesService } from '../services/custom-types-service';

interface PropertyRow {
    id: string; // internal id for tracking
    key: string;
    label: string;
    type: string;
    description: string;
    required: boolean;
    featured: boolean;
}

export class CustomTypeCreationModal extends Modal {
    private customTypesService: CustomTypesService;
    private isEditing: boolean = false;
    private baseType: string = 'Thing';
    private schema: Partial<FTMSchemaDefinition> = {
        name: '',
        label: '',
        plural: '',
        description: '',
        extends: ['Thing'],
        properties: {},
        featured: [],
        required: [],
        caption: [],
        color: '#607D8B'
    };

    private propertyRows: PropertyRow[] = [];
    private onSaveCallback: ((name: string) => void) | null = null;

    // Available property types
    private readonly PROPERTY_TYPES = [
        'string', 'text', 'date', 'number', 'boolean', 'url', 'email', 'phone', 'country'
    ];

    constructor(
        app: App,
        customTypesService: CustomTypesService,
        existingSchema?: Partial<FTMSchemaDefinition>,
        onSave?: (name: string) => void,
        baseType: string = 'Thing'
    ) {
        super(app);
        this.customTypesService = customTypesService;
        this.baseType = baseType;

        if (existingSchema) {
            this.schema = JSON.parse(JSON.stringify(existingSchema)); // Deep copy
            this.isEditing = true;
            // Infer base type if editing
            if (this.schema.extends && this.schema.extends.includes('Interval')) {
                this.baseType = 'Interval';
            }
        } else {
            // Set base type for new schemas
            this.schema.extends = [baseType];
        }

        this.onSaveCallback = onSave || null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('graph_copilot-custom-type-modal');

        // CSS for the modal
        this.addStyles(contentEl);

        const title = this.baseType === 'Interval' ? 'Create custom connection type' : 'Create custom entity type';
        contentEl.createEl('h2', { text: title });

        const mainContainer = contentEl.createDiv({ cls: 'graph_copilot-custom-type-container' });

        this.renderGeneralSettings(mainContainer);
        this.renderPropertyBuilder(mainContainer);
        this.renderFooter(contentEl);
    }

    private addStyles(contentEl: HTMLElement) {
        // We can inject styles directly or rely on class names. 
        // For complexity, I'll add some inline styles to the container/elements where needed
        // but prefer class names if global styles were available.
        // Assuming standard obsidian modal styles + some helpers.
    }

    private renderGeneralSettings(container: HTMLElement) {
        const section = container.createDiv({ cls: 'graph_copilot-section' });
        section.createEl('h3', { text: '1. General information' });

        new Setting(section)
            .setName('Type name')
            .setDesc('Internal name (CamelCase, e.g. "MyCustomType")')
            .addText(text => text
                .setPlaceholder('MyCustomType')
                .setValue(this.schema.name || '')
                .setDisabled(this.isEditing)
                .onChange(value => {
                    if (this.isEditing) return;
                    const sanitized = value.replace(/[^a-zA-Z0-9]/g, '');
                    this.schema.name = sanitized;

                    // Auto-fill label and plural if empty
                    if (!this.schema.label) this.schema.label = value;
                    if (!this.schema.plural) this.schema.plural = value + 's';
                }));

        new Setting(section)
            .setName('Display label')
            .setDesc('Human readable label')
            .addText(text => text
                .setPlaceholder('My custom type')
                .onChange(value => this.schema.label = value));

        new Setting(section)
            .setName('Plural label')
            .setDesc('Plural formatted label')
            .addText(text => text
                .setPlaceholder('My custom types')
                .onChange(value => this.schema.plural = value));

        new Setting(section)
            .setName('Description')
            .setDesc('Short description of what this entity represents')
            .addTextArea(text => text
                .setPlaceholder('Description...')
                .onChange(value => this.schema.description = value));

        new Setting(section)
            .setName('Color')
            .setDesc('Color for the entity nodes')
            .addColorPicker(color => color
                .setValue(this.schema.color || '#607D8B')
                .onChange(value => this.schema.color = value));
    }

    private renderPropertyBuilder(container: HTMLElement) {
        const section = container.createDiv({ cls: 'graph_copilot-section' });
        section.addClass('graph_copilot-section--properties');
        section.createEl('h3', { text: '2. Properties' });
        section.createEl('p', { text: 'Define custom properties for this entity type.', cls: 'setting-item-description' });

        const propertiesContainer = section.createDiv({ cls: 'graph_copilot-properties-list' });

        // Render existing rows
        // Note: For reactivity, we clears and redraw list on change, or manage DOM manually.
        // For simplicity, we'll append rows as they are added.

        const renderRows = () => {
            propertiesContainer.empty();
            if (this.propertyRows.length === 0) {
                propertiesContainer.createDiv({ text: 'No custom properties defined.', cls: 'text-muted' });
                return;
            }

            const table = propertiesContainer.createEl('table', { cls: 'graph_copilot-properties-table' });

            const thead = table.createEl('thead');
            const headerRow = thead.createEl('tr', { cls: 'graph_copilot-properties-header' });
            ['Label', 'Key', 'Type', 'Flags', 'Actions'].forEach(h => {
                headerRow.createEl('th', { text: h, cls: 'graph_copilot-properties-th' });
            });

            const tbody = table.createEl('tbody');

            this.propertyRows.forEach((row, index) => {
                const tr = tbody.createEl('tr', { cls: 'graph_copilot-properties-row' });

                // Label
                tr.createEl('td', { text: row.label, cls: 'graph_copilot-properties-td' });
                // Key
                tr.createEl('td', { text: row.key, cls: 'graph_copilot-properties-td' });
                // Type
                tr.createEl('td', { text: row.type, cls: 'graph_copilot-properties-td' });
                // Flags
                const flagsTd = tr.createEl('td', { cls: 'graph_copilot-properties-td' });
                if (row.required) flagsTd.createSpan({ text: 'Req', cls: 'graph_copilot-tag graph_copilot-tag--mr' });
                if (row.featured) flagsTd.createSpan({ text: 'Feat', cls: 'graph_copilot-tag' });

                // Actions
                const actionsTd = tr.createEl('td', { cls: 'graph_copilot-properties-td' });
                const deleteBtn = actionsTd.createEl('button', { text: '🗑' });
                deleteBtn.onclick = () => {
                    this.propertyRows.splice(index, 1);
                    renderRows();
                };
            });
        };

        renderRows();

        // Add Property Form
        const addPropSection = section.createDiv({ cls: 'graph_copilot-add-property-form' });

        addPropSection.createEl('h4', { text: 'Add property' });

        // Simple inline form
        // We'll use a temporary state for the new property
        const newProp: PropertyRow = {
            id: '', key: '', label: '', type: 'string', description: '', required: false, featured: false
        };

        const formGrid = addPropSection.createDiv({ cls: 'graph_copilot-form-grid' });

        // Label Input
        const nameContainer = formGrid.createDiv();
        nameContainer.createDiv({ text: 'Label *', cls: 'setting-item-name' });
        const nameInput = new TextComponent(nameContainer);
        nameInput.setPlaceholder('E.g. birth date'); // eslint-disable-line obsidianmd/ui/sentence-case
        nameInput.inputEl.addClass('graph_copilot-input-full');
        nameInput.onChange(val => {
            newProp.label = val;
            // Auto-generate key
            if (!keyInput.getValue()) {
                const key = val.toLowerCase().replace(/[^a-z0-9]/g, '');
                newProp.key = key;
                keyInput.setValue(key);
            }
        });

        // Key Input
        const keyContainer = formGrid.createDiv();
        keyContainer.createDiv({ text: 'Property key *', cls: 'setting-item-name' });
        const keyInput = new TextComponent(keyContainer);
        keyInput.setPlaceholder('E.g. birthDate');
        keyInput.inputEl.addClass('graph_copilot-input-full');
        keyInput.onChange(val => newProp.key = val);

        // Type Select
        const typeContainer = formGrid.createDiv();
        typeContainer.createDiv({ text: 'Type', cls: 'setting-item-name' });
        const typeSelect = new DropdownComponent(typeContainer);
        this.PROPERTY_TYPES.forEach(t => typeSelect.addOption(t, t));
        typeSelect.setValue('string');
        typeSelect.onChange(val => newProp.type = val);

        // Description
        const descContainer = formGrid.createDiv();
        descContainer.createDiv({ text: 'Description', cls: 'setting-item-name' });
        const descInput = new TextComponent(descContainer);
        descInput.setPlaceholder('Optional description');
        descInput.inputEl.addClass('graph_copilot-input-full');
        descInput.onChange(val => newProp.description = val);

        // Flags
        const flagsContainer = addPropSection.createDiv({ cls: 'graph_copilot-flags-container' });

        new Setting(flagsContainer).setName('Required').addToggle(t => t.onChange(v => newProp.required = v));
        new Setting(flagsContainer).setName('Key property (featured)').addToggle(t => t.onChange(v => newProp.featured = v));

        // Add Button
        const btnContainer = addPropSection.createDiv({ cls: 'graph_copilot-btn-container' });

        const addBtn = new ButtonComponent(btnContainer)
            .setButtonText('Add property')
            .setCta()
            .onClick(() => {
                if (!newProp.label || !newProp.key) {
                    new Notice('Label and key are required');
                    return;
                }

                // Add to rows
                this.propertyRows.push({ ...newProp, id: Date.now().toString() });
                renderRows();

                // Reset form
                newProp.label = '';
                newProp.key = '';
                newProp.description = '';
                newProp.required = false;
                newProp.featured = false;

                nameInput.setValue('');
                keyInput.setValue('');
                descInput.setValue('');
                // Toggles hard to reset without reference, but ok
            });
    }

    private renderFooter(contentEl: HTMLElement) {
        const buttonContainer = contentEl.createDiv({ cls: 'graph_copilot-entity-modal-buttons' });

        new ButtonComponent(buttonContainer)
            .setButtonText('Cancel')
            .onClick(() => this.close());

        new ButtonComponent(buttonContainer)
            .setButtonText(this.isEditing ? 'Update type' : 'Create type')
            .setCta()
            .onClick(() => this.handleSave());
    }

    private populateRowsFromSchema() {
        if (!this.schema.properties) return;

        this.propertyRows = [];
        Object.keys(this.schema.properties).forEach(key => {
            const prop = this.schema.properties![key];
            this.propertyRows.push({
                id: key, // use key as id for existing
                key: key,
                label: prop.label,
                type: prop.type || 'string',
                description: prop.description || '',
                required: (this.schema.required || []).includes(key),
                featured: (this.schema.featured || []).includes(key)
            });
        });
    }

    private async handleSave() {
        // Validate
        if (!this.schema.name) {
            new Notice('Internal type name is required');
            return;
        }
        if (!this.schema.label) {
            new Notice('Display label is required');
            return;
        }

        // Build properties object
        const finalProperties: Record<string, FTMPropertyDefinition> = {};
        const required: string[] = [];
        const featured: string[] = [];
        const caption: string[] = ['name']; // Default caption

        this.propertyRows.forEach(row => {
            finalProperties[row.key] = {
                label: row.label,
                type: row.type,
                description: row.description
            };
            if (row.required) required.push(row.key);
            if (row.featured) featured.push(row.key);
        });

        // Add 'name' property implicitly if not present as it is usually required/base
        // But 'Thing' has 'name' usually? No, Thing usually implies it.
        // FTM schemas usually don't define 'name' property explicitly in YAML if inherited from Thing?
        // Let's assume 'Thing' provides basic props or we don't define 'name'.

        this.schema.properties = finalProperties;
        this.schema.required = required;
        this.schema.featured = featured;

        // Add name to caption if exist, or first featured
        if (featured.length > 0) {
            caption.push(...featured);
        }
        this.schema.caption = [...new Set(caption)]; // Unique

        try {
            await this.customTypesService.addCustomType(this.schema);
            if (this.onSaveCallback && this.schema.name) {
                this.onSaveCallback(this.schema.name);
            }
            this.close();
        } catch (error) {
            new Notice(`Failed to create type: ${error}`);
            console.error(error);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
