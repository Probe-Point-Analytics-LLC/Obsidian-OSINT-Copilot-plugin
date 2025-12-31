/**
 * Graph History Manager - manages undo/redo history for graph operations.
 * Tracks entity creation, deletion, edits, relationship changes, and node positions.
 */

import { Entity, Connection } from '../entities/types';

/**
 * Types of operations that can be tracked in history.
 */
export enum HistoryOperationType {
    ENTITY_CREATE = 'entity_create',
    ENTITY_DELETE = 'entity_delete',
    ENTITY_EDIT = 'entity_edit',
    RELATIONSHIP_CREATE = 'relationship_create',
    RELATIONSHIP_DELETE = 'relationship_delete',
    RELATIONSHIP_EDIT = 'relationship_edit',
    NODE_POSITION_CHANGE = 'node_position_change',
    BATCH_OPERATION = 'batch_operation'
}

/**
 * Node position data.
 */
export interface NodePosition {
    x: number;
    y: number;
}

/**
 * A single history entry representing an operation.
 */
export interface HistoryEntry {
    id: string;
    type: HistoryOperationType;
    timestamp: Date;
    description: string;

    // Data for undo/redo
    entityData?: Entity;
    previousEntityData?: Entity;
    connectionData?: Connection;
    previousConnectionData?: Connection;
    nodePositions?: Map<string, NodePosition>;
    previousNodePositions?: Map<string, NodePosition>;

    // For batch operations
    subOperations?: HistoryEntry[];
}

/**
 * Callback types for history operations.
 */
export interface HistoryCallbacks {
    onEntityCreate: (entity: Entity) => Promise<void>;
    onEntityDelete: (entityId: string) => Promise<void>;
    onEntityRestore: (entity: Entity) => Promise<void>;
    onEntityUpdate: (entity: Entity) => Promise<void>;
    onConnectionCreate: (connection: Connection) => Promise<void>;
    onConnectionDelete: (connectionId: string) => Promise<void>;
    onConnectionRestore: (connection: Connection) => Promise<void>;
    onConnectionUpdate: (connection: Connection) => Promise<void>;
    onNodePositionChange: (positions: Map<string, NodePosition>) => void;
}

/**
 * Graph History Manager class.
 */
export class GraphHistoryManager {
    private undoStack: HistoryEntry[] = [];
    private redoStack: HistoryEntry[] = [];
    private maxHistorySize: number = 100;
    private callbacks: HistoryCallbacks | null = null;
    private listeners: Set<() => void> = new Set();

    constructor(maxHistorySize: number = 100) {
        this.maxHistorySize = maxHistorySize;
    }

    /**
     * Set callbacks for executing undo/redo operations.
     */
    setCallbacks(callbacks: HistoryCallbacks): void {
        this.callbacks = callbacks;
    }

    /**
     * Add a listener for history changes.
     */
    addListener(listener: () => void): void {
        this.listeners.add(listener);
    }

    /**
     * Remove a listener.
     */
    removeListener(listener: () => void): void {
        this.listeners.delete(listener);
    }

    /**
     * Notify all listeners of a change.
     */
    private notifyListeners(): void {
        this.listeners.forEach(listener => listener());
    }

    /**
     * Generate a unique ID for history entries.
     */
    private generateId(): string {
        return `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Record an entity creation.
     */
    recordEntityCreate(entity: Entity): void {
        const entry: HistoryEntry = {
            id: this.generateId(),
            type: HistoryOperationType.ENTITY_CREATE,
            timestamp: new Date(),
            description: `Created entity: ${entity.label}`,
            entityData: { ...entity }
        };
        this.pushToUndoStack(entry);
    }

    /**
     * Record an entity deletion.
     */
    recordEntityDelete(entity: Entity): void {
        const entry: HistoryEntry = {
            id: this.generateId(),
            type: HistoryOperationType.ENTITY_DELETE,
            timestamp: new Date(),
            description: `Deleted entity: ${entity.label}`,
            entityData: { ...entity }
        };
        this.pushToUndoStack(entry);
    }

    /**
     * Record an entity edit.
     */
    recordEntityEdit(previousEntity: Entity, newEntity: Entity): void {
        const entry: HistoryEntry = {
            id: this.generateId(),
            type: HistoryOperationType.ENTITY_EDIT,
            timestamp: new Date(),
            description: `Edited entity: ${newEntity.label}`,
            entityData: { ...newEntity },
            previousEntityData: { ...previousEntity }
        };
        this.pushToUndoStack(entry);
    }

    /**
     * Record a relationship edit.
     */
    recordRelationshipEdit(previousConnection: Connection, newConnection: Connection): void {
        const entry: HistoryEntry = {
            id: this.generateId(),
            type: HistoryOperationType.RELATIONSHIP_EDIT,
            timestamp: new Date(),
            description: `Edited relationship: ${newConnection.relationship}`,
            connectionData: { ...newConnection },
            previousConnectionData: { ...previousConnection }
        };
        this.pushToUndoStack(entry);
    }

    /**
     * Record a relationship creation.
     */
    recordRelationshipCreate(connection: Connection): void {
        const entry: HistoryEntry = {
            id: this.generateId(),
            type: HistoryOperationType.RELATIONSHIP_CREATE,
            timestamp: new Date(),
            description: `Created relationship: ${connection.relationship}`,
            connectionData: { ...connection }
        };
        this.pushToUndoStack(entry);
    }

    /**
     * Record a relationship deletion.
     */
    recordRelationshipDelete(connection: Connection): void {
        const entry: HistoryEntry = {
            id: this.generateId(),
            type: HistoryOperationType.RELATIONSHIP_DELETE,
            timestamp: new Date(),
            description: `Deleted relationship: ${connection.relationship}`,
            connectionData: { ...connection }
        };
        this.pushToUndoStack(entry);
    }

    /**
     * Record node position changes.
     */
    recordNodePositionChange(
        previousPositions: Map<string, NodePosition>,
        newPositions: Map<string, NodePosition>
    ): void {
        const entry: HistoryEntry = {
            id: this.generateId(),
            type: HistoryOperationType.NODE_POSITION_CHANGE,
            timestamp: new Date(),
            description: `Moved ${newPositions.size} node(s)`,
            nodePositions: new Map(newPositions),
            previousNodePositions: new Map(previousPositions)
        };
        this.pushToUndoStack(entry);
    }

    /**
     * Push an entry to the undo stack.
     */
    private pushToUndoStack(entry: HistoryEntry): void {
        this.undoStack.push(entry);

        // Clear redo stack when new action is performed
        this.redoStack = [];

        // Limit history size
        while (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }

        this.notifyListeners();
    }

    /**
     * Check if undo is available.
     */
    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    /**
     * Check if redo is available.
     */
    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /**
     * Get the undo stack for display.
     */
    getUndoStack(): HistoryEntry[] {
        return [...this.undoStack];
    }

    /**
     * Get the redo stack for display.
     */
    getRedoStack(): HistoryEntry[] {
        return [...this.redoStack];
    }

    /**
     * Get current position in history (for UI display).
     */
    getCurrentPosition(): number {
        return this.undoStack.length;
    }

    /**
     * Get total history size.
     */
    getTotalHistorySize(): number {
        return this.undoStack.length + this.redoStack.length;
    }

    /**
     * Undo the last operation.
     */
    async undo(): Promise<boolean> {
        if (!this.canUndo() || !this.callbacks) return false;

        const entry = this.undoStack.pop()!;

        try {
            await this.executeUndo(entry);
            this.redoStack.push(entry);
            this.notifyListeners();
            return true;
        } catch (error) {
            console.error('[GraphHistoryManager] Undo failed:', error);
            // Put entry back on undo stack
            this.undoStack.push(entry);
            return false;
        }
    }

    /**
     * Redo the last undone operation.
     */
    async redo(): Promise<boolean> {
        if (!this.canRedo() || !this.callbacks) return false;

        const entry = this.redoStack.pop()!;

        try {
            await this.executeRedo(entry);
            this.undoStack.push(entry);
            this.notifyListeners();
            return true;
        } catch (error) {
            console.error('[GraphHistoryManager] Redo failed:', error);
            // Put entry back on redo stack
            this.redoStack.push(entry);
            return false;
        }
    }

    /**
     * Undo to a specific point in history.
     */
    async undoToEntry(entryId: string): Promise<boolean> {
        const entryIndex = this.undoStack.findIndex(e => e.id === entryId);
        if (entryIndex === -1) return false;

        // Undo all entries after and including the target
        const entriesToUndo = this.undoStack.length - entryIndex;
        for (let i = 0; i < entriesToUndo; i++) {
            const success = await this.undo();
            if (!success) return false;
        }
        return true;
    }

    /**
     * Redo to a specific point in history.
     */
    async redoToEntry(entryId: string): Promise<boolean> {
        const entryIndex = this.redoStack.findIndex(e => e.id === entryId);
        if (entryIndex === -1) return false;

        // Redo all entries from the end up to and including the target
        const entriesToRedo = this.redoStack.length - entryIndex;
        for (let i = 0; i < entriesToRedo; i++) {
            const success = await this.redo();
            if (!success) return false;
        }
        return true;
    }

    /**
     * Execute an undo operation.
     */
    private async executeUndo(entry: HistoryEntry): Promise<void> {
        if (!this.callbacks) return;

        switch (entry.type) {
            case HistoryOperationType.ENTITY_CREATE:
                // Undo create = delete
                if (entry.entityData) {
                    await this.callbacks.onEntityDelete(entry.entityData.id);
                }
                break;

            case HistoryOperationType.ENTITY_DELETE:
                // Undo delete = restore
                if (entry.entityData) {
                    await this.callbacks.onEntityRestore(entry.entityData);
                }
                break;

            case HistoryOperationType.ENTITY_EDIT:
                // Undo edit = restore previous state
                if (entry.previousEntityData) {
                    await this.callbacks.onEntityUpdate(entry.previousEntityData);
                }
                break;

            case HistoryOperationType.RELATIONSHIP_CREATE:
                // Undo create = delete
                if (entry.connectionData) {
                    await this.callbacks.onConnectionDelete(entry.connectionData.id);
                }
                break;

            case HistoryOperationType.RELATIONSHIP_DELETE:
                // Undo delete = restore
                if (entry.connectionData) {
                    await this.callbacks.onConnectionRestore(entry.connectionData);
                }
                break;

            case HistoryOperationType.RELATIONSHIP_EDIT:
                // Undo edit = restore previous state
                if (entry.previousConnectionData) {
                    await this.callbacks.onConnectionUpdate(entry.previousConnectionData);
                }
                break;

            case HistoryOperationType.NODE_POSITION_CHANGE:
                // Undo position change = restore previous positions
                if (entry.previousNodePositions) {
                    this.callbacks.onNodePositionChange(entry.previousNodePositions);
                }
                break;

            case HistoryOperationType.BATCH_OPERATION:
                // Undo batch = undo all sub-operations in reverse order
                if (entry.subOperations) {
                    for (let i = entry.subOperations.length - 1; i >= 0; i--) {
                        await this.executeUndo(entry.subOperations[i]);
                    }
                }
                break;
        }
    }

    /**
     * Execute a redo operation.
     */
    private async executeRedo(entry: HistoryEntry): Promise<void> {
        if (!this.callbacks) return;

        switch (entry.type) {
            case HistoryOperationType.ENTITY_CREATE:
                // Redo create = create again
                if (entry.entityData) {
                    await this.callbacks.onEntityRestore(entry.entityData);
                }
                break;

            case HistoryOperationType.ENTITY_DELETE:
                // Redo delete = delete again
                if (entry.entityData) {
                    await this.callbacks.onEntityDelete(entry.entityData.id);
                }
                break;

            case HistoryOperationType.ENTITY_EDIT:
                // Redo edit = apply new state
                if (entry.entityData) {
                    await this.callbacks.onEntityUpdate(entry.entityData);
                }
                break;

            case HistoryOperationType.RELATIONSHIP_CREATE:
                // Redo create = create again
                if (entry.connectionData) {
                    await this.callbacks.onConnectionRestore(entry.connectionData);
                }
                break;

            case HistoryOperationType.RELATIONSHIP_DELETE:
                // Redo delete = delete again
                if (entry.connectionData) {
                    await this.callbacks.onConnectionDelete(entry.connectionData.id);
                }
                break;

            case HistoryOperationType.RELATIONSHIP_EDIT:
                // Redo edit = apply new state
                if (entry.connectionData) {
                    await this.callbacks.onConnectionUpdate(entry.connectionData);
                }
                break;

            case HistoryOperationType.NODE_POSITION_CHANGE:
                // Redo position change = apply new positions
                if (entry.nodePositions) {
                    this.callbacks.onNodePositionChange(entry.nodePositions);
                }
                break;

            case HistoryOperationType.BATCH_OPERATION:
                // Redo batch = redo all sub-operations in order
                if (entry.subOperations) {
                    for (const subOp of entry.subOperations) {
                        await this.executeRedo(subOp);
                    }
                }
                break;
        }
    }

    /**
     * Clear all history.
     */
    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.notifyListeners();
    }

    /**
     * Get a formatted description of the last undoable action.
     */
    getLastUndoDescription(): string | null {
        if (this.undoStack.length === 0) return null;
        return this.undoStack[this.undoStack.length - 1].description;
    }

    /**
     * Get a formatted description of the last redoable action.
     */
    getLastRedoDescription(): string | null {
        if (this.redoStack.length === 0) return null;
        return this.redoStack[this.redoStack.length - 1].description;
    }
}
