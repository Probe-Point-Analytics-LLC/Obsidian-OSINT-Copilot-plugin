/**
 * Build @@ graph command strings from AI extraction operations.
 * Shared by orchestration (legacy tools) and unified agent runtime.
 */
import { AIOperation, EntityType, getEntityLabel } from '../entities/types';

export function aiOperationsToGraphCommands(operations: AIOperation[]): string[] {
    const commands: string[] = [];
    for (const op of operations) {
        if (op.entities) {
            op.entities.forEach((entity) => {
                commands.push(
                    `@@create_entity ${JSON.stringify({
                        type: entity.type,
                        label: getEntityLabel(entity.type as EntityType, entity.properties || {}),
                        properties: entity.properties,
                        sources: entity.sources,
                    })}`,
                );
            });
        }
        if (op.updates?.length) {
            for (const u of op.updates) {
                if (!u || typeof u !== 'object') continue;
                if (!u.current_label || typeof u.current_label !== 'string') continue;
                if (!u.new_properties || typeof u.new_properties !== 'object') continue;
                commands.push(
                    `@@update_entity ${JSON.stringify({
                        type: u.type,
                        current_label: u.current_label,
                        new_properties: u.new_properties,
                    })}`,
                );
            }
        }
        if (op.connections) {
            op.connections.forEach((conn) => {
                let fromLabel = conn.from_label;
                let toLabel = conn.to_label;

                if (!fromLabel && op.entities && op.entities[conn.from]) {
                    const ent = op.entities[conn.from];
                    fromLabel = getEntityLabel(ent.type as EntityType, ent.properties || {});
                }
                if (!toLabel && op.entities && op.entities[conn.to]) {
                    const ent = op.entities[conn.to];
                    toLabel = getEntityLabel(ent.type as EntityType, ent.properties || {});
                }

                if (fromLabel && toLabel) {
                    commands.push(
                        `@@create_link ${JSON.stringify({
                            from: fromLabel,
                            to: toLabel,
                            relationship: conn.relationship,
                            sources: conn.sources,
                        })}`,
                    );
                }
            });
        }
    }
    return commands;
}
