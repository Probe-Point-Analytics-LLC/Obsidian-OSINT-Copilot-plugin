import { App, Notice, Vault } from 'obsidian';
import { ftmSchemaService, FTMSchemaDefinition } from './ftm-schema-service';

const CONFIG_DIR = '.osint-copilot';
const CUSTOM_TYPES_FILE = 'custom-types.json';

export interface CustomTypeConfig {
    schemas: Partial<FTMSchemaDefinition>[];
}

export class CustomTypesService {
    private app: App;
    private vault: Vault;
    private customSchemas: Map<string, Partial<FTMSchemaDefinition>> = new Map();

    constructor(app: App) {
        this.app = app;
        this.vault = app.vault;
    }

    async initialize(): Promise<void> {
        await this.ensureConfigDir();
        await this.loadCustomTypes();
    }

    private async ensureConfigDir(): Promise<void> {
        try {
            // Check if config dir exists; create if not
            if (!(await this.vault.adapter.exists(CONFIG_DIR))) {
                await this.vault.createFolder(CONFIG_DIR);
            }
        } catch (error) {
            console.error('[CustomTypesService] Failed to create config folder:', error);
        }
    }

    private async loadCustomTypes(): Promise<void> {
        const configPath = `${CONFIG_DIR}/${CUSTOM_TYPES_FILE}`;
        if (await this.vault.adapter.exists(configPath)) {
            try {
                const content = await this.vault.adapter.read(configPath);
                const config: CustomTypeConfig = JSON.parse(content);

                this.customSchemas.clear();
                if (config.schemas && Array.isArray(config.schemas)) {
                    for (const schema of config.schemas) {
                        if (schema.name) {
                            this.customSchemas.set(schema.name, schema);
                            // Register with FTMSchemaService
                            ftmSchemaService.registerSchema(schema);
                        }
                    }
                }
                console.debug(`[CustomTypesService] Loaded ${this.customSchemas.size} custom entity types.`);
            } catch (e) {
                console.error('[CustomTypesService] Failed to load custom types:', e);
                new Notice('Failed to load custom entity types config.');
            }
        }
    }

    async saveCustomTypes(): Promise<void> {
        await this.ensureConfigDir();
        const configPath = `${CONFIG_DIR}/${CUSTOM_TYPES_FILE}`;
        const config: CustomTypeConfig = {
            schemas: Array.from(this.customSchemas.values())
        };

        try {
            await this.vault.adapter.write(configPath, JSON.stringify(config, null, 2));
        } catch (e) {
            console.error('[CustomTypesService] Failed to save custom types:', e);
            new Notice('Failed to save custom entity types config.');
        }
    }

    async addCustomType(schema: Partial<FTMSchemaDefinition>): Promise<void> {
        if (!schema.name) throw new Error('Schema name is required');

        this.customSchemas.set(schema.name, schema);
        ftmSchemaService.registerSchema(schema);
        await this.saveCustomTypes();
        new Notice(`Custom entity type '${schema.label}' added.`);
    }

    async updateCustomType(schema: Partial<FTMSchemaDefinition>): Promise<void> {
        if (!schema.name || !this.customSchemas.has(schema.name)) {
            throw new Error(`Custom type ${schema.name} does not exist`);
        }
        await this.addCustomType(schema); // Same as add/overwrite
    }

    async deleteCustomType(name: string): Promise<void> {
        if (this.customSchemas.delete(name)) {
            // Note: FTMSchemaService handles registration but we don't have unregister method yet.
            // Persistence is handled here, so restarting plugin will clear memory.
            await this.saveCustomTypes();
            new Notice(`Custom entity type '${name}' removed. Please reload plugin to fully remove from memory.`);
        }
    }

    getCustomSchemas(): Partial<FTMSchemaDefinition>[] {
        return Array.from(this.customSchemas.values());
    }

    getCustomSchema(name: string): Partial<FTMSchemaDefinition> | undefined {
        return this.customSchemas.get(name);
    }
}
