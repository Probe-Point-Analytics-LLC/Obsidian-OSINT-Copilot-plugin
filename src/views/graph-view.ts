/**
 * Custom Graph View using Cytoscape.js for interactive graph visualization.
 */

import { App, ItemView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import { Entity, Connection, ENTITY_CONFIGS, EntityType, getEntityIcon } from '../entities/types';
import { EntityManager } from '../services/entity-manager';
import { EntityTypeSelectorModal, ConnectionCreationModal, ConnectionQuickModal, EntityEditModal, FTMEntityTypeSelectorModal, FTMEntityEditModal, FTMIntervalTypeSelectorModal, ConnectionEditModal } from '../modals/entity-modal';
import { GraphHistoryManager, HistoryEntry, HistoryOperationType, NodePosition } from '../services/graph-history-manager';
import { GeocodingService, GeocodingError } from '../services/geocoding-service';

// Cytoscape types (simplified for bundling)
declare const cytoscape: any;

export const GRAPH_VIEW_TYPE = 'graph_copilot-graph-view';

// File path for persisting node positions
const NODE_POSITIONS_FILE = '.osint-copilot/graph-positions.json';

export class GraphView extends ItemView {
    private entityManager: EntityManager;
    private cy: any = null;
    private container: HTMLElement | null = null;
    private onEntityClick: ((entityId: string) => void) | null = null;
    private onShowOnMap: ((entityId: string) => void) | null = null;

    // Connection mode state
    private connectionMode: boolean = false;
    private sourceNodeId: string | null = null;
    private sourceNodeLabel: string | null = null;
    private connectBtn: HTMLButtonElement | null = null;
    private statusIndicator: HTMLElement | null = null;

    // Unified selection state (nodes and edges)
    private selectedNodes: Set<string> = new Set();
    private selectedEdges: Set<string> = new Set();
    private selectionCountEl: HTMLElement | null = null;
    private deleteSelectedBtn: HTMLButtonElement | null = null;
    private clearSelectionBtn: HTMLButtonElement | null = null;

    // Box selection mode state
    private boxSelectMode: boolean = false;
    private boxSelectBtn: HTMLButtonElement | null = null;

    // History manager for undo/redo
    private historyManager: GraphHistoryManager;
    private historyPanel: HTMLElement | null = null;
    private historyPanelVisible: boolean = false;
    private undoBtn: HTMLButtonElement | null = null;
    private redoBtn: HTMLButtonElement | null = null;

    // Node positions cache for tracking position changes
    private nodePositionsCache: Map<string, NodePosition> = new Map();

    // Geocoding service for location entities
    private geocodingService: GeocodingService;

    constructor(
        leaf: WorkspaceLeaf,
        entityManager: EntityManager,
        onEntityClick?: (entityId: string) => void,
        onShowOnMap?: (entityId: string) => void
    ) {
        super(leaf);
        this.entityManager = entityManager;
        this.onEntityClick = onEntityClick || null;
        this.onShowOnMap = onShowOnMap || null;

        // Initialize geocoding service
        this.geocodingService = new GeocodingService();

        // Initialize history manager
        this.historyManager = new GraphHistoryManager();
        this.setupHistoryCallbacks();
    }

    /**
     * Setup callbacks for the history manager to execute undo/redo operations.
     */
    private setupHistoryCallbacks(): void {
        this.historyManager.setCallbacks({
            onEntityCreate: async (entity: Entity) => {
                // This is called when redoing a create - entity already exists
            },
            onEntityDelete: async (entityId: string) => {
                // Delete entity from graph (not from disk - that's handled separately)
                if (this.cy) {
                    this.cy.getElementById(entityId).remove();
                }
                this.entityManager.deleteEntityInMemory(entityId);
            },
            onEntityRestore: async (entity: Entity) => {
                // Restore entity to disk and graph
                await this.entityManager.restoreEntity(entity);
                this.addEntityToGraphPreserveLayout(entity);
            },
            onEntityUpdate: async (entity: Entity) => {
                // Update entity in disk and graph
                await this.entityManager.updateEntityForHistory(entity);
                this.updateEntityInGraph(entity);
            },
            onConnectionCreate: async (connection: Connection) => {
                // This is called when redoing a create
            },
            onConnectionDelete: async (connectionId: string) => {
                // Delete connection from graph
                if (this.cy) {
                    this.cy.getElementById(connectionId).remove();
                }
                this.entityManager.deleteConnection(connectionId);
            },
            onConnectionRestore: async (connection: Connection) => {
                // Restore connection
                await this.entityManager.restoreConnection(connection);
                this.addConnectionToGraph(connection);
            },
            onConnectionUpdate: async (connection: Connection) => {
                // Update connection in disk and graph
                await this.entityManager.updateConnectionForHistory(connection);
                this.updateConnectionInGraph(connection);
            },
            onNodePositionChange: (positions: Map<string, NodePosition>) => {
                // Update node positions in graph
                if (this.cy) {
                    positions.forEach((pos, nodeId) => {
                        const node = this.cy.getElementById(nodeId);
                        if (node.length > 0) {
                            node.position(pos);
                        }
                    });
                }
            }
        });

        // Listen for history changes to update UI
        this.historyManager.addListener(() => this.updateHistoryUI());
    }

    getViewType(): string {
        return GRAPH_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'OSINTCopilot Graph';
    }

    getIcon(): string {
        return 'git-fork';
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('graph_copilot-graph-container');

        // Create graph container
        this.container = container.createDiv({ cls: 'graph_copilot-graph-canvas' });
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.container.style.position = 'absolute';
        this.container.style.top = '0';
        this.container.style.left = '0';

        // Create toolbar
        const toolbar = container.createDiv({ cls: 'graph_copilot-graph-toolbar' });
        this.createToolbar(toolbar);

        try {
            // Load Cytoscape and initialize
            console.log('[GraphView] Loading Cytoscape.js...');
            await this.loadCytoscape();
            console.log('[GraphView] Cytoscape.js loaded successfully');
            
            if (typeof cytoscape === 'undefined') {
                throw new Error('Cytoscape failed to load - typeof cytoscape is undefined');
            }
            

            this.initializeGraph();
            console.log('[GraphView] Graph initialized');

            // Load saved node positions from persistent storage
            await this.loadSavedPositions();

            // Load entities from disk and refresh the graph
            // This ensures persistence across Obsidian restarts
            await this.refreshWithSavedPositions();
            console.log('[GraphView] Graph refreshed with entities');
        } catch (error) {
            console.error('[GraphView] Failed to initialize graph:', error);
            
            // Show error message to user
            const errorDiv = container.createDiv({ cls: 'graph_copilot-error' });
            errorDiv.style.cssText = `
                padding: 20px;
                text-align: center;
                color: var(--text-error);
            `;
            
            const errorTitle = errorDiv.createEl('h3', { text: 'Failed to Load Graph' });
            errorTitle.style.cssText = 'color: var(--text-error); margin-bottom: 10px;';
            
            const errorMsg = errorDiv.createEl('p', { 
                text: error instanceof Error ? error.message : String(error) 
            });
            errorMsg.style.cssText = 'margin-bottom: 15px;';
            
            // Common issues and solutions
            const solutions = errorDiv.createDiv();
            solutions.style.cssText = 'text-align: left; max-width: 600px; margin: 0 auto;';
            solutions.innerHTML = `
                <p><strong>Possible causes:</strong></p>
                <ul>
                    <li><strong>CDN blocked:</strong> Cytoscape.js cannot be loaded from unpkg.com CDN. Check:
                        <ul>
                            <li>Browser extensions (ad blockers, privacy tools)</li>
                            <li>Corporate firewall or network restrictions</li>
                            <li>Content Security Policy (CSP) settings</li>
                        </ul>
                    </li>
                    <li><strong>Network issues:</strong> Check your internet connection</li>
                    <li><strong>Entity Manager:</strong> Check console for EntityManager initialization errors</li>
                </ul>
                <p><strong>To debug:</strong></p>
                <ol>
                    <li>Open Developer Tools (Ctrl+Shift+I)</li>
                    <li>Check Console tab for errors</li>
                    <li>Check Network tab for failed requests to unpkg.com</li>
                    <li>Verify plugin settings: enableGraphFeatures should be enabled</li>
                </ol>
            `;
            
            new Notice('Graph failed to load. Check console for details.', 10000);
        }
    }

    async onClose(): Promise<void> {
        // Clean up keyboard handler
        if ((this as any)._keyHandler) {
            document.removeEventListener('keydown', (this as any)._keyHandler);
        }

        if (this.cy) {
            this.cy.destroy();
            this.cy = null;
        }
    }

    /**
     * Load Cytoscape.js library.
     */
    private async loadCytoscape(): Promise<void> {
        // Check if already loaded
        if (typeof cytoscape !== 'undefined') {
            console.log('[GraphView] Cytoscape.js already loaded');
            return;
        }

        // Load from CDN
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/cytoscape@3.28.1/dist/cytoscape.min.js';
            
            const timeout = setTimeout(() => {
                reject(new Error('Cytoscape.js load timeout - CDN request took too long. Check network connection or firewall settings.'));
            }, 30000); // 30 second timeout
            
            script.onload = () => {
                clearTimeout(timeout);
                // Double-check that cytoscape is actually available
                if (typeof cytoscape === 'undefined') {
                    reject(new Error('Cytoscape script loaded but cytoscape object is undefined. Possible CSP or script execution issue.'));
                } else {
                    console.log('[GraphView] Cytoscape.js loaded from CDN');
                    resolve();
                }
            };
            
            script.onerror = (error) => {
                clearTimeout(timeout);
                console.error('[GraphView] Failed to load Cytoscape.js from CDN:', error);
                reject(new Error('Failed to load Cytoscape.js from CDN. Possible causes: network issue, firewall blocking unpkg.com, or Content Security Policy restrictions.'));
            };
            
            document.head.appendChild(script);
        });
    }

    /**
     * Create the toolbar with controls.
     */
    private createToolbar(toolbar: HTMLElement): void {
        toolbar.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            z-index: 100;
            display: flex;
            gap: 5px;
            background: var(--background-secondary);
            padding: 5px;
            border-radius: 5px;
            flex-wrap: wrap;
            align-items: center;
        `;

        // Add Entity button
        const addBtn = toolbar.createEl('button', { text: '+ Add Entity' });
        addBtn.addClass('graph_copilot-add-entity-btn');
        addBtn.onclick = () => this.openEntityCreator();

        // Connect button (node selection mode)
        this.connectBtn = toolbar.createEl('button', { text: '🔗 Connect' });
        this.connectBtn.addClass('graph_copilot-connect-btn');
        this.connectBtn.onclick = () => this.toggleConnectionMode();

        // Separator
        toolbar.createDiv({ cls: 'graph_copilot-toolbar-separator' });

        // Box Select button
        this.boxSelectBtn = toolbar.createEl('button', { text: '⬚ Box Select' });
        this.boxSelectBtn.title = 'Enter box selection mode to select multiple items by dragging';
        this.boxSelectBtn.onclick = () => this.toggleBoxSelectMode();

        // Selection controls (shown when items are selected)
        // Clear Selection button (hidden by default)
        this.clearSelectionBtn = toolbar.createEl('button', { text: '✕ Clear Selection' });
        this.clearSelectionBtn.addClass('graph_copilot-clear-selection-btn');
        this.clearSelectionBtn.style.display = 'none';
        this.clearSelectionBtn.onclick = () => this.clearSelection();

        // Delete Selected button (hidden by default)
        this.deleteSelectedBtn = toolbar.createEl('button', { text: '🗑 Delete Selected' });
        this.deleteSelectedBtn.addClass('graph_copilot-delete-selected-btn');
        this.deleteSelectedBtn.style.display = 'none';
        this.deleteSelectedBtn.onclick = () => this.showDeleteConfirmation();

        // Selection count indicator
        this.selectionCountEl = toolbar.createDiv({ cls: 'graph_copilot-selection-count' });
        this.selectionCountEl.style.cssText = `
            padding: 4px 8px;
            font-size: 12px;
            color: var(--text-muted);
            display: none;
        `;

        // Separator
        toolbar.createDiv({ cls: 'graph_copilot-toolbar-separator' });

        // Undo/Redo buttons
        this.undoBtn = toolbar.createEl('button', { text: '↶ Undo' });
        this.undoBtn.addClass('graph_copilot-undo-btn');
        this.undoBtn.disabled = true;
        this.undoBtn.onclick = () => this.performUndo();

        this.redoBtn = toolbar.createEl('button', { text: '↷ Redo' });
        this.redoBtn.addClass('graph_copilot-redo-btn');
        this.redoBtn.disabled = true;
        this.redoBtn.onclick = () => this.performRedo();

        // History panel toggle button
        const historyBtn = toolbar.createEl('button', { text: '📜 History' });
        historyBtn.addClass('graph_copilot-history-btn');
        historyBtn.onclick = () => this.toggleHistoryPanel();

        // Separator
        toolbar.createDiv({ cls: 'graph_copilot-toolbar-separator' });

        // Rearrange button (was Refresh) - resets all node positions using automatic layout
        const rearrangeBtn = toolbar.createEl('button', { text: '🔄 Rearrange' });
        rearrangeBtn.title = 'Rearrange all entities using automatic layout (resets current positions)';
        rearrangeBtn.onclick = async () => {
            // Show confirmation dialog
            const confirmed = await this.showRearrangeConfirmation();
            if (!confirmed) return;

            rearrangeBtn.disabled = true;
            rearrangeBtn.textContent = '🔄 Rearranging...';
            await this.rearrangeGraph();
            rearrangeBtn.disabled = false;
            rearrangeBtn.textContent = '🔄 Rearrange';
        };


        // Refresh button - reload entities while preserving positions
        const refreshBtn = toolbar.createEl('button', { text: '↻ Refresh' });
        refreshBtn.title = 'Refresh graph (reload entities while preserving zoom and positions)';
        refreshBtn.addClass('graph_copilot-refresh-btn');
        refreshBtn.onclick = async () => {
            refreshBtn.disabled = true;
            const originalText = refreshBtn.textContent;
            refreshBtn.textContent = '↻ Refreshing...';
            
            try {
                await this.refreshWithSavedPositions();
                new Notice('Graph refreshed successfully');
                
                // Brief visual feedback - flash the button
                refreshBtn.style.backgroundColor = 'var(--interactive-success)';
                setTimeout(() => {
                    refreshBtn.style.backgroundColor = '';
                }, 300);
            } catch (error) {
                console.error('[GraphView] Manual refresh failed:', error);
                new Notice('Failed to refresh graph. Check console for details.');
                
                // Flash error color
                refreshBtn.style.backgroundColor = 'var(--interactive-error)';
                setTimeout(() => {
                    refreshBtn.style.backgroundColor = '';
                }, 300);
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.textContent = originalText;
            }
        };
            // Fit button
        const fitBtn = toolbar.createEl('button', { text: '⊡ Fit' });
        fitBtn.title = 'Fit all entities in view';
        fitBtn.onclick = () => this.cy?.fit();

        // Status indicator for connection mode
        this.statusIndicator = toolbar.createDiv({ cls: 'graph_copilot-connection-status' });
        this.statusIndicator.style.display = 'none';
    }

    /**
     * Toggle connection mode for node selection.
     */
    private toggleConnectionMode(): void {
        if (this.connectionMode) {
            this.exitConnectionMode();
        } else {
            this.enterConnectionMode();
        }
    }

    /**
     * Enter connection mode - user can click nodes to create connections.
     */
    private enterConnectionMode(): void {
        this.connectionMode = true;
        this.sourceNodeId = null;
        this.sourceNodeLabel = null;

        if (this.connectBtn) {
            this.connectBtn.addClass('graph_copilot-connect-btn-active');
            this.connectBtn.textContent = '✕ Cancel';
        }

        if (this.statusIndicator) {
            this.statusIndicator.style.display = 'block';
            this.statusIndicator.textContent = 'Click source node...';
            this.statusIndicator.addClass('graph_copilot-connection-status-active');
        }

        if (this.container) {
            this.container.addClass('graph_copilot-connection-mode');
        }

        new Notice('Connection mode: Click the source node');
    }

    /**
     * Exit connection mode.
     */
    private exitConnectionMode(): void {
        this.connectionMode = false;
        this.sourceNodeId = null;
        this.sourceNodeLabel = null;

        if (this.connectBtn) {
            this.connectBtn.removeClass('graph_copilot-connect-btn-active');
            this.connectBtn.textContent = '🔗 Connect';
        }

        if (this.statusIndicator) {
            this.statusIndicator.style.display = 'none';
            this.statusIndicator.removeClass('graph_copilot-connection-status-active');
        }

        if (this.container) {
            this.container.removeClass('graph_copilot-connection-mode');
        }

        // Clear any node highlighting
        if (this.cy) {
            this.cy.nodes().removeClass('connection-source');
        }
    }

    /**
     * Toggle box selection mode.
     */
    private toggleBoxSelectMode(): void {
        if (this.boxSelectMode) {
            this.exitBoxSelectMode();
        } else {
            this.enterBoxSelectMode();
        }
    }

    /**
     * Enter box selection mode - user can drag to select multiple items.
     */
    private enterBoxSelectMode(): void {
        // Exit connection mode if active
        if (this.connectionMode) {
            this.exitConnectionMode();
        }

        this.boxSelectMode = true;

        if (this.boxSelectBtn) {
            this.boxSelectBtn.addClass('graph_copilot-box-select-active');
            this.boxSelectBtn.textContent = '⬚ Exit Box Select';
        }

        if (this.cy) {
            // Enable box selection in Cytoscape
            this.cy.boxSelectionEnabled(true);
            this.cy.userPanningEnabled(false); // Disable panning while box selecting
        }

        if (this.container) {
            this.container.addClass('graph_copilot-box-select-mode');
        }

        new Notice('Box select mode: Drag to select multiple items');
    }

    /**
     * Exit box selection mode.
     */
    private exitBoxSelectMode(): void {
        this.boxSelectMode = false;

        if (this.boxSelectBtn) {
            this.boxSelectBtn.removeClass('graph_copilot-box-select-active');
            this.boxSelectBtn.textContent = '⬚ Box Select';
        }

        if (this.cy) {
            // Disable box selection and re-enable panning
            this.cy.boxSelectionEnabled(false);
            this.cy.userPanningEnabled(true);
        }

        if (this.container) {
            this.container.removeClass('graph_copilot-box-select-mode');
        }
    }

    /**
     * Handle node click in connection mode.
     */
    private handleConnectionModeClick(nodeId: string, nodeLabel: string): void {
        if (!this.sourceNodeId) {
            // First click - select source node
            this.sourceNodeId = nodeId;
            this.sourceNodeLabel = nodeLabel;

            // Highlight the source node
            if (this.cy) {
                this.cy.getElementById(nodeId).addClass('connection-source');
            }

            if (this.statusIndicator) {
                this.statusIndicator.textContent = `Source: ${nodeLabel} → Click target...`;
            }

            new Notice(`Source selected: ${nodeLabel}. Now click the target node.`);
        } else {
            // Second click - select target node
            if (nodeId === this.sourceNodeId) {
                new Notice('Cannot connect a node to itself. Click a different node.');
                return;
            }

            // Open quick modal to enter relationship
            const modal = new ConnectionQuickModal(
                this.app,
                this.entityManager,
                this.sourceNodeId,
                nodeId,
                this.sourceNodeLabel || '',
                nodeLabel,
                (connectionId?: string) => {
                    // Record connection creation in history and add edge incrementally
                    if (connectionId) {
                        const connection = this.entityManager.getConnection(connectionId);
                        if (connection) {
                            this.historyManager.recordRelationshipCreate(connection);
                            // Add connection to graph incrementally without full refresh
                            this.addConnectionToGraph(connection);
                        }
                    }
                }
            );
            modal.open();

            // Exit connection mode
            this.exitConnectionMode();
        }
    }

    /**
     * Open the connection creation modal (full form).
     */
    private openConnectionModal(): void {
        const modal = new ConnectionCreationModal(
            this.app,
            this.entityManager,
            (connectionId?: string) => {
                // Record connection creation in history and add edge incrementally
                if (connectionId) {
                    const connection = this.entityManager.getConnection(connectionId);
                    if (connection) {
                        this.historyManager.recordRelationshipCreate(connection);
                        // Add connection to graph incrementally without full refresh
                        this.addConnectionToGraph(connection);
                    }
                }
            }
        );
        modal.open();
    }

    /**
     * Open the FTM entity type selector modal.
     * Uses FTM schema format with required properties shown by default
     * and optional properties in a collapsible section.
     */
    private openEntityCreator(): void {
        const modal = new FTMEntityTypeSelectorModal(
            this.app,
            this.entityManager,
            (entityId) => {
                // Record entity creation in history
                const entity = this.entityManager.getEntity(entityId);
                if (entity) {
                    this.historyManager.recordEntityCreate(entity);
                    // Add entity to graph incrementally without full refresh
                    this.addEntityToGraphPreserveLayout(entity);
                }
            }
        );
        modal.open();
    }

    /**
     * Initialize the Cytoscape graph.
     */
    private initializeGraph(): void {
        if (!this.container) {
            console.error('[GraphView] Cannot initialize: container is null');
            return;
        }
        
        if (typeof cytoscape === 'undefined') {
            console.error('[GraphView] Cannot initialize: cytoscape is undefined');
            throw new Error('Cytoscape is not available. Graph cannot be initialized.');
        }

        this.cy = cytoscape({
            container: this.container,
            style: this.getGraphStyle(),
            layout: { name: 'preset' },
            minZoom: 0.1,
            maxZoom: 3,
            // Use default wheel sensitivity to avoid Cytoscape warning
            // wheelSensitivity: 0.3, // Removed to use default (1.0)
            // Enable box selection
            boxSelectionEnabled: true,
            selectionType: 'additive'
        });

        // Event handlers - Single click selects, double-click opens
        this.cy.on('tap', 'node', (evt: any) => {
            const node = evt.target;
            const entityId = node.id();
            const nodeLabel = node.data('fullLabel') || node.data('label');
            const originalEvent = evt.originalEvent;

            // Check if we're in connection mode
            if (this.connectionMode) {
                this.handleConnectionModeClick(entityId, nodeLabel);
                return;
            }

            // Check for Ctrl/Cmd+click for multi-select (add to selection)
            if (originalEvent && (originalEvent.ctrlKey || originalEvent.metaKey)) {
                this.toggleNodeSelection(entityId);
                return;
            }

            // Normal click - clear other selections and select this node
            this.clearSelection();
            this.selectedNodes.add(entityId);
            node.addClass('multi-selected');
            this.updateSelectionUI();
        });

        // Double-click on node opens the entity note
        this.cy.on('dbltap', 'node', (evt: any) => {
            const node = evt.target;
            const entityId = node.id();

            // Don't open if in connection mode
            if (this.connectionMode) return;

            if (this.onEntityClick) {
                this.onEntityClick(entityId);
            } else {
                this.entityManager.openEntityNote(entityId);
            }
        });

        // Click on edge for selection
        this.cy.on('tap', 'edge', (evt: any) => {
            const edge = evt.target;
            const connectionId = edge.id();
            const originalEvent = evt.originalEvent;

            // Check for Ctrl/Cmd+click for multi-select (add to selection)
            if (originalEvent && (originalEvent.ctrlKey || originalEvent.metaKey)) {
                this.toggleEdgeSelection(connectionId);
                return;
            }

            // Normal click - clear other selections and select this edge
            this.clearSelection();
            this.selectedEdges.add(connectionId);
            edge.addClass('multi-selected');
            this.updateSelectionUI();
        });

        // Right-click context menu for nodes
        this.cy.on('cxttap', 'node', (evt: any) => {
            const node = evt.target;
            const entityId = node.id();
            const entityType = node.data('type');
            const nodeLabel = node.data('fullLabel') || node.data('label');

            // Create context menu
            this.showNodeContextMenu(evt.originalEvent, entityId, entityType, nodeLabel);
        });

        // Right-click context menu for edges (relationships)
        this.cy.on('cxttap', 'edge', (evt: any) => {
            const edge = evt.target;
            const connectionId = edge.id();
            const relationship = edge.data('label');
            const sourceId = edge.data('source');
            const targetId = edge.data('target');

            // Create context menu for edge
            this.showEdgeContextMenu(evt.originalEvent, connectionId, relationship, sourceId, targetId);
        });

        // Track node position changes for undo/redo and persist to storage
        this.cy.on('dragfree', 'node', (evt: any) => {
            const node = evt.target;
            const nodeId = node.id();
            const newPos = node.position();
            const oldPos = this.nodePositionsCache.get(nodeId);

            if (oldPos && (oldPos.x !== newPos.x || oldPos.y !== newPos.y)) {
                const previousPositions = new Map<string, NodePosition>();
                previousPositions.set(nodeId, { ...oldPos });

                const newPositions = new Map<string, NodePosition>();
                newPositions.set(nodeId, { x: newPos.x, y: newPos.y });

                this.historyManager.recordNodePositionChange(previousPositions, newPositions);
            }

            // Update cache and persist to storage
            this.nodePositionsCache.set(nodeId, { x: newPos.x, y: newPos.y });
            this.savePositionsDebounced();
        });

        // Tooltip on hover - show map icon for Location entities
        this.cy.on('mouseover', 'node', (evt: any) => {
            const node = evt.target;
            const entityType = node.data('type');
            node.style('border-width', 4);

            // Show tooltip with map hint for Location entities
            if (entityType === EntityType.Location) {
                this.showLocationTooltip(node);
            }
        });

        this.cy.on('mouseout', 'node', (evt: any) => {
            const node = evt.target;
            node.style('border-width', 2);
            this.hideLocationTooltip();
        });

        // Click on background to cancel connection mode or clear selection
        this.cy.on('tap', (evt: any) => {
            if (evt.target === this.cy) {
                if (this.connectionMode) {
                    // Clicked on background, cancel connection mode
                    this.exitConnectionMode();
                    new Notice('Connection mode cancelled');
                } else if (!this.boxSelectMode && (this.selectedNodes.size > 0 || this.selectedEdges.size > 0)) {
                    // Clear selection when clicking on background (not in box select mode)
                    this.clearSelection();
                }
            }
        });

        // Box selection event - fires when elements are selected via box selection
        // The 'boxselect' event fires on each element that gets selected
        this.cy.on('boxselect', 'node', (evt: any) => {
            if (!this.boxSelectMode) return;

            const node = evt.target;
            const nodeId = node.id();

            if (!this.selectedNodes.has(nodeId)) {
                this.selectedNodes.add(nodeId);
                node.addClass('multi-selected');
            }
        });

        this.cy.on('boxselect', 'edge', (evt: any) => {
            if (!this.boxSelectMode) return;

            const edge = evt.target;
            const edgeId = edge.id();

            if (!this.selectedEdges.has(edgeId)) {
                this.selectedEdges.add(edgeId);
                edge.addClass('multi-selected');
            }
        });

        // When box selection ends, update the UI and clear Cytoscape's native selection
        this.cy.on('boxend', (evt: any) => {
            if (!this.boxSelectMode) return;

            // Clear Cytoscape's native selection (we use our own visual styling)
            this.cy.elements().unselect();

            // Update the UI to show the Delete Selected button
            // Use setTimeout to ensure all 'boxselect' events have been processed first
            // This fixes the issue where the button wouldn't appear on the first box-select
            setTimeout(() => {
                this.updateSelectionUI();
            }, 0);
        });

        // Add keyboard event listener for Delete and Escape keys
        this.registerKeyboardShortcuts();
    }

    /**
     * Register keyboard shortcuts for the graph view.
     */
    private registerKeyboardShortcuts(): void {
        const keyHandler = (e: KeyboardEvent) => {
            // Only handle if this view is active
            if (!this.container?.isConnected) return;

            // Don't intercept keyboard events when user is typing in an input field or modal
            const activeElement = document.activeElement;
            const isInputActive = activeElement instanceof HTMLInputElement ||
                                  activeElement instanceof HTMLTextAreaElement ||
                                  activeElement?.hasAttribute('contenteditable');

            // Check if a modal is open
            const modalOpen = document.querySelector('.modal-container') !== null;

            // If user is typing in an input or a modal is open, don't intercept most keys
            if (isInputActive || modalOpen) {
                // Only handle Escape to exit modes when not in modal
                if (e.key === 'Escape' && !modalOpen) {
                    if (this.boxSelectMode) {
                        this.exitBoxSelectMode();
                    } else if (this.connectionMode) {
                        this.exitConnectionMode();
                    }
                }
                return;
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.selectedNodes.size > 0 || this.selectedEdges.size > 0) {
                    e.preventDefault();
                    this.showDeleteConfirmation();
                }
            } else if (e.key === 'Escape') {
                // Priority: box select mode > connection mode > selection
                if (this.boxSelectMode) {
                    e.preventDefault();
                    this.exitBoxSelectMode();
                } else if (this.connectionMode) {
                    e.preventDefault();
                    this.exitConnectionMode();
                } else if (this.selectedNodes.size > 0 || this.selectedEdges.size > 0) {
                    e.preventDefault();
                    this.clearSelection();
                }
            } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
                // Ctrl/Cmd+A to select all nodes and edges
                e.preventDefault();
                this.selectAll();
            } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
                // Ctrl/Cmd+Z for undo, Ctrl/Cmd+Shift+Z for redo
                e.preventDefault();
                if (e.shiftKey) {
                    this.performRedo();
                } else {
                    this.performUndo();
                }
            } else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
                // Ctrl/Cmd+Y for redo (alternative)
                e.preventDefault();
                this.performRedo();
            }
        };

        document.addEventListener('keydown', keyHandler);

        // Store reference for cleanup
        (this as any)._keyHandler = keyHandler;
    }

    /**
     * Toggle selection state of a node.
     */
    private toggleNodeSelection(entityId: string): void {
        if (!this.cy) return;

        const node = this.cy.getElementById(entityId);
        if (node.length === 0) return;

        if (this.selectedNodes.has(entityId)) {
            this.selectedNodes.delete(entityId);
            node.removeClass('multi-selected');
        } else {
            this.selectedNodes.add(entityId);
            node.addClass('multi-selected');
        }

        this.updateSelectionUI();
    }

    /**
     * Toggle selection state of an edge.
     */
    private toggleEdgeSelection(connectionId: string): void {
        if (!this.cy) return;

        const edge = this.cy.getElementById(connectionId);
        if (edge.length === 0) return;

        if (this.selectedEdges.has(connectionId)) {
            this.selectedEdges.delete(connectionId);
            edge.removeClass('multi-selected');
        } else {
            this.selectedEdges.add(connectionId);
            edge.addClass('multi-selected');
        }

        this.updateSelectionUI();
    }

    /**
     * Select all nodes and edges in the graph.
     */
    private selectAll(): void {
        if (!this.cy) return;

        this.cy.nodes().forEach((node: any) => {
            const entityId = node.id();
            this.selectedNodes.add(entityId);
            node.addClass('multi-selected');
        });

        this.cy.edges().forEach((edge: any) => {
            const connectionId = edge.id();
            this.selectedEdges.add(connectionId);
            edge.addClass('multi-selected');
        });

        this.updateSelectionUI();
        const totalCount = this.selectedNodes.size + this.selectedEdges.size;
        new Notice(`Selected ${this.selectedNodes.size} entities and ${this.selectedEdges.size} relationships`);
    }

    /**
     * Clear all selections (nodes and edges).
     */
    private clearSelection(): void {
        if (!this.cy) return;

        this.cy.nodes().removeClass('multi-selected');
        this.cy.edges().removeClass('multi-selected');
        this.selectedNodes.clear();
        this.selectedEdges.clear();
        this.updateSelectionUI();
    }

    /**
     * Update the selection UI elements.
     */
    private updateSelectionUI(): void {
        const nodeCount = this.selectedNodes.size;
        const edgeCount = this.selectedEdges.size;
        const totalCount = nodeCount + edgeCount;

        if (this.selectionCountEl) {
            if (totalCount > 0) {
                const parts: string[] = [];
                if (nodeCount > 0) parts.push(`${nodeCount} ${nodeCount === 1 ? 'entity' : 'entities'}`);
                if (edgeCount > 0) parts.push(`${edgeCount} ${edgeCount === 1 ? 'relationship' : 'relationships'}`);
                this.selectionCountEl.textContent = parts.join(', ');
                this.selectionCountEl.style.display = 'block';
            } else {
                this.selectionCountEl.style.display = 'none';
            }
        }

        if (this.deleteSelectedBtn) {
            if (totalCount > 0) {
                this.deleteSelectedBtn.textContent = `🗑 Delete Selected (${totalCount})`;
                this.deleteSelectedBtn.style.display = 'block';
            } else {
                this.deleteSelectedBtn.textContent = '🗑 Delete Selected';
                this.deleteSelectedBtn.style.display = 'none';
            }
        }

        if (this.clearSelectionBtn) {
            this.clearSelectionBtn.style.display = totalCount > 0 ? 'block' : 'none';
        }
    }

    /**
     * Show delete confirmation dialog for selected items (nodes and/or edges).
     */
    private showDeleteConfirmation(): void {
        const nodeCount = this.selectedNodes.size;
        const edgeCount = this.selectedEdges.size;

        if (nodeCount === 0 && edgeCount === 0) return;

        // Get entity names for the confirmation dialog
        const entityNames: string[] = [];
        this.selectedNodes.forEach(entityId => {
            const entity = this.entityManager.getEntity(entityId);
            if (entity) {
                const label = entity.label != null ? String(entity.label) : entityId;
                entityNames.push(`📦 ${label}`);
            }
        });

        // Get relationship names for the confirmation dialog
        const relationshipNames: string[] = [];
        this.selectedEdges.forEach(connectionId => {
            const connection = this.entityManager.getConnection(connectionId);
            if (connection) {
                const sourceEntity = this.entityManager.getEntity(connection.fromEntityId);
                const targetEntity = this.entityManager.getEntity(connection.toEntityId);
                const sourceLabel = sourceEntity?.label != null ? String(sourceEntity.label) : connection.fromEntityId;
                const targetLabel = targetEntity?.label != null ? String(targetEntity.label) : connection.toEntityId;
                relationshipNames.push(`🔗 ${sourceLabel} → ${connection.relationship} → ${targetLabel}`);
            }
        });

        // Create confirmation modal
        const modal = document.createElement('div');
        modal.className = 'graph_copilot-delete-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: var(--background-primary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 8px;
            padding: 20px;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        // Build title
        const titleParts: string[] = [];
        if (nodeCount > 0) titleParts.push(`${nodeCount} ${nodeCount === 1 ? 'Entity' : 'Entities'}`);
        if (edgeCount > 0) titleParts.push(`${edgeCount} ${edgeCount === 1 ? 'Relationship' : 'Relationships'}`);

        const title = document.createElement('h3');
        title.textContent = `Delete ${titleParts.join(' and ')}?`;
        title.style.cssText = 'margin: 0 0 15px 0; color: var(--text-normal);';
        dialog.appendChild(title);

        const warning = document.createElement('p');
        if (nodeCount > 0) {
            warning.textContent = '⚠️ Entity deletions cannot be undone. Entity markdown files will be permanently deleted.';
        } else {
            warning.textContent = '⚠️ The following items will be deleted:';
        }
        warning.style.cssText = 'margin: 0 0 15px 0; color: var(--text-warning);';
        dialog.appendChild(warning);

        const itemList = document.createElement('ul');
        itemList.style.cssText = `
            margin: 0 0 20px 0;
            padding-left: 20px;
            max-height: 200px;
            overflow-y: auto;
            color: var(--text-muted);
        `;

        // Add entities first
        entityNames.forEach(name => {
            const li = document.createElement('li');
            li.textContent = name;
            itemList.appendChild(li);
        });

        // Add relationships
        relationshipNames.forEach(name => {
            const li = document.createElement('li');
            li.textContent = name;
            li.style.fontSize = '0.9em';
            itemList.appendChild(li);
        });

        dialog.appendChild(itemList);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding: 8px 16px;';
        cancelBtn.onclick = () => modal.remove();
        buttonContainer.appendChild(cancelBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = `Delete ${titleParts.join(' and ')}`;
        deleteBtn.style.cssText = `
            padding: 8px 16px;
            background: var(--text-error);
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
        deleteBtn.onclick = async () => {
            modal.remove();
            await this.deleteSelectedItems();
        };
        buttonContainer.appendChild(deleteBtn);

        dialog.appendChild(buttonContainer);
        modal.appendChild(dialog);

        // Close on background click
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };

        document.body.appendChild(modal);
    }

    /**
     * Delete all selected items (entities and relationships).
     */
    private async deleteSelectedItems(): Promise<void> {
        let deletedEntities = 0;
        let deletedRelationships = 0;
        let failedEntities = 0;
        let failedRelationships = 0;

        // Delete relationships first (so we can record them before entities are deleted)
        const edgesToDelete = Array.from(this.selectedEdges);
        for (const connectionId of edgesToDelete) {
            const connection = this.entityManager.getConnection(connectionId);
            if (connection) {
                try {
                    await this.entityManager.deleteConnectionWithNote(connectionId);
                    this.historyManager.recordRelationshipDelete(connection);
                    if (this.cy) {
                        this.cy.getElementById(connectionId).remove();
                    }
                    deletedRelationships++;
                } catch (error) {
                    console.error(`Failed to delete relationship ${connectionId}:`, error);
                    failedRelationships++;
                }
            }
        }

        // Delete entities
        const entitiesToDelete = Array.from(this.selectedNodes);
        const entitiesForHistory: Entity[] = [];
        for (const entityId of entitiesToDelete) {
            const entity = this.entityManager.getEntity(entityId);
            if (entity) {
                entitiesForHistory.push({ ...entity });
            }
        }

        const result = await this.entityManager.deleteEntities(entitiesToDelete);

        // Record in history for successfully deleted entities
        for (const entity of entitiesForHistory) {
            if (!result.failed.includes(entity.id)) {
                this.historyManager.recordEntityDelete(entity);
                deletedEntities++;
            } else {
                failedEntities++;
            }
        }

        // Remove deleted entities from graph
        if (this.cy) {
            for (const entityId of entitiesToDelete) {
                if (!result.failed.includes(entityId)) {
                    this.cy.getElementById(entityId).remove();
                }
            }
        }

        // Clear selection
        this.selectedNodes.clear();
        this.selectedEdges.clear();
        this.updateSelectionUI();

        // Show result
        const successParts: string[] = [];
        const failParts: string[] = [];

        if (deletedEntities > 0) successParts.push(`${deletedEntities} ${deletedEntities === 1 ? 'entity' : 'entities'}`);
        if (deletedRelationships > 0) successParts.push(`${deletedRelationships} ${deletedRelationships === 1 ? 'relationship' : 'relationships'}`);
        if (failedEntities > 0) failParts.push(`${failedEntities} ${failedEntities === 1 ? 'entity' : 'entities'}`);
        if (failedRelationships > 0) failParts.push(`${failedRelationships} ${failedRelationships === 1 ? 'relationship' : 'relationships'}`);

        if (failParts.length === 0) {
            new Notice(`Successfully deleted ${successParts.join(' and ')}`);
        } else {
            new Notice(`Deleted ${successParts.join(' and ')}. Failed: ${failParts.join(' and ')}`);
        }
    }

    /**
     * Show delete confirmation dialog for a single entity.
     */
    private showSingleDeleteConfirmation(entityId: string, label: string): void {
        // Create confirmation modal
        const modal = document.createElement('div');
        modal.className = 'graph_copilot-delete-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: var(--background-primary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 8px;
            padding: 20px;
            max-width: 400px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        const title = document.createElement('h3');
        title.textContent = 'Delete Entity?';
        title.style.cssText = 'margin: 0 0 15px 0; color: var(--text-normal);';
        dialog.appendChild(title);

        const warning = document.createElement('p');
        warning.innerHTML = `⚠️ This action cannot be undone. The entity <strong>"${label}"</strong> and its markdown file will be permanently deleted.`;
        warning.style.cssText = 'margin: 0 0 20px 0; color: var(--text-warning);';
        dialog.appendChild(warning);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding: 8px 16px;';
        cancelBtn.onclick = () => modal.remove();
        buttonContainer.appendChild(cancelBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.style.cssText = `
            padding: 8px 16px;
            background: var(--text-error);
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
        deleteBtn.onclick = async () => {
            modal.remove();
            try {
                // Get entity before deleting for history
                const entity = this.entityManager.getEntity(entityId);

                const success = await this.entityManager.deleteEntity(entityId);
                if (success) {
                    // Record in history
                    if (entity) {
                        this.historyManager.recordEntityDelete(entity);
                    }
                    // Remove from graph
                    if (this.cy) {
                        this.cy.getElementById(entityId).remove();
                    }
                    // Remove from selection if selected
                    this.selectedNodes.delete(entityId);
                    this.updateSelectionUI();
                    new Notice(`Deleted entity: ${label}`);
                } else {
                    new Notice(`Failed to delete entity: ${label}`);
                }
            } catch (error) {
                console.error(`Failed to delete entity ${entityId}:`, error);
                new Notice(`Error deleting entity: ${label}`);
            }
        };
        buttonContainer.appendChild(deleteBtn);

        dialog.appendChild(buttonContainer);
        modal.appendChild(dialog);

        // Close on background click
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };

        document.body.appendChild(modal);
    }

    /**
     * Show context menu for a node.
     */
    private showNodeContextMenu(event: MouseEvent, entityId: string, entityType: string, label: string): void {
        // Remove any existing context menu
        const existingMenu = document.querySelector('.graph_copilot-context-menu');
        if (existingMenu) existingMenu.remove();

        const menu = document.createElement('div');
        menu.className = 'graph_copilot-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${event.clientX}px;
            top: ${event.clientY}px;
            background: var(--background-primary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            padding: 4px 0;
            min-width: 150px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 1000;
        `;

        // Open Note option
        const openNoteItem = this.createMenuItem('📄 Open Note', () => {
            this.entityManager.openEntityNote(entityId);
            menu.remove();
        });
        menu.appendChild(openNoteItem);

        // Edit Entity option (for all entity types) - uses FTM format
        const editItem = this.createMenuItem('✏️ Edit Entity', () => {
            const entity = this.entityManager.getEntity(entityId);
            if (entity) {
                // Capture previous state for history
                const previousEntity = { ...entity, properties: { ...entity.properties } };

                const editModal = new FTMEntityEditModal(
                    this.app,
                    this.entityManager,
                    entity,
                    () => {
                        // Record edit in history
                        const updatedEntity = this.entityManager.getEntity(entityId);
                        if (updatedEntity) {
                            this.historyManager.recordEntityEdit(previousEntity, updatedEntity);
                            // Update entity in graph incrementally without full refresh
                            this.updateEntityInGraph(updatedEntity);
                        }
                    }
                );
                editModal.open();
            } else {
                new Notice('Entity not found');
            }
            menu.remove();
        });
        menu.appendChild(editItem);

        // Show on Map option (only for Location entities with coordinates)
        if (entityType === EntityType.Location) {
            const entity = this.entityManager.getEntity(entityId);
            if (entity && entity.properties.latitude && entity.properties.longitude) {
                const mapItem = this.createMenuItem('🗺️ Show on Map', () => {
                    if (this.onShowOnMap) {
                        this.onShowOnMap(entityId);
                    } else {
                        new Notice('Map view not available');
                    }
                    menu.remove();
                });
                menu.appendChild(mapItem);
            }
        }

        // Geolocate option (for Location and Address entities without coordinates)
        if (entityType === EntityType.Location || entityType === 'Address') {
            const entity = this.entityManager.getEntity(entityId);
            if (entity && !entity.properties.latitude && !entity.properties.longitude) {
                const geolocateItem = this.createMenuItem('📍 Geolocate Address', async () => {
                    menu.remove();
                    await this.geolocateEntity(entityId);
                });
                menu.appendChild(geolocateItem);
            }
        }

        // Toggle Timeline option (only for Event entities with dates)
        if (entityType === EntityType.Event) {
            const entity = this.entityManager.getEntity(entityId);
            if (entity && entity.properties.start_date) {
                const isOnTimeline = entity.properties.add_to_timeline === true;
                const timelineLabel = isOnTimeline ? '📅 Remove from Timeline' : '📅 Add to Timeline';
                const timelineItem = this.createMenuItem(timelineLabel, async () => {
                    try {
                        await this.entityManager.updateEntity(entityId, {
                            add_to_timeline: !isOnTimeline
                        });
                        new Notice(isOnTimeline ? 'Removed from Timeline' : 'Added to Timeline');
                        // Update the node in the graph
                        const updatedEntity = this.entityManager.getEntity(entityId);
                        if (updatedEntity) {
                            this.updateEntityInGraph(updatedEntity);
                        }
                    } catch (error) {
                        console.error('[GraphView] Failed to toggle timeline status:', error);
                        new Notice('Failed to update timeline status');
                    }
                    menu.remove();
                });
                menu.appendChild(timelineItem);
            }
        }

        // Separator
        const separator = document.createElement('div');
        separator.style.cssText = 'height: 1px; background: var(--background-modifier-border); margin: 4px 0;';
        menu.appendChild(separator);

        // Connect to... option
        const connectItem = this.createMenuItem('🔗 Connect to...', () => {
            this.enterConnectionMode();
            this.handleConnectionModeClick(entityId, label);
            menu.remove();
        });
        menu.appendChild(connectItem);

        // Separator before delete options
        const separator2 = document.createElement('div');
        separator2.style.cssText = 'height: 1px; background: var(--background-modifier-border); margin: 4px 0;';
        menu.appendChild(separator2);

        // Delete selected (if there are multiple selections including this entity)
        const totalSelected = this.selectedNodes.size + this.selectedEdges.size;
        if (totalSelected > 1 && this.selectedNodes.has(entityId)) {
            const deleteSelectedItem = this.createMenuItem(`🗑 Delete Selected (${totalSelected})`, () => {
                menu.remove();
                this.showDeleteConfirmation();
            });
            deleteSelectedItem.style.color = 'var(--text-error)';
            menu.appendChild(deleteSelectedItem);
        }

        // Delete this entity
        const deleteItem = this.createMenuItem('🗑 Delete Entity', () => {
            menu.remove();
            this.showSingleDeleteConfirmation(entityId, label);
        });
        deleteItem.style.color = 'var(--text-error)';
        menu.appendChild(deleteItem);

        document.body.appendChild(menu);

        // Close menu when clicking outside
        const closeMenu = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    /**
     * Create a menu item element.
     */
    private createMenuItem(text: string, onClick: () => void): HTMLElement {
        const item = document.createElement('div');
        item.textContent = text;
        item.style.cssText = `
            padding: 6px 12px;
            cursor: pointer;
            font-size: 13px;
        `;
        item.onmouseenter = () => item.style.background = 'var(--background-modifier-hover)';
        item.onmouseleave = () => item.style.background = 'transparent';
        item.onclick = onClick;
        return item;
    }

    /**
     * Show context menu for edges (relationships).
     */
    private showEdgeContextMenu(event: MouseEvent, connectionId: string, relationship: string, sourceId: string, targetId: string): void {
        // Remove any existing context menu
        const existingMenu = document.querySelector('.graph_copilot-context-menu');
        if (existingMenu) existingMenu.remove();

        const sourceEntity = this.entityManager.getEntity(sourceId);
        const targetEntity = this.entityManager.getEntity(targetId);
        const sourceLabel = sourceEntity?.label || sourceId;
        const targetLabel = targetEntity?.label || targetId;

        const menu = document.createElement('div');
        menu.className = 'graph_copilot-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${event.clientX}px;
            top: ${event.clientY}px;
            background: var(--background-primary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            padding: 4px 0;
            min-width: 180px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 1000;
        `;

        // Header showing relationship info
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 6px 12px;
            font-size: 11px;
            color: var(--text-muted);
            border-bottom: 1px solid var(--background-modifier-border);
            margin-bottom: 4px;
        `;
        header.innerHTML = `<strong>${sourceLabel}</strong> → <strong>${targetLabel}</strong><br><em>${relationship}</em>`;
        menu.appendChild(header);

        // Edit Connection option
        const editItem = this.createMenuItem('✏️ Edit Connection', () => {
            const connection = this.entityManager.getConnection(connectionId);
            if (connection) {
                // Capture previous state for history
                const previousConnection = {
                    ...connection,
                    properties: { ...connection.properties }
                };

                const editModal = new ConnectionEditModal(
                    this.app,
                    this.entityManager,
                    connection,
                    () => {
                        // Record edit in history
                        const updatedConnection = this.entityManager.getConnection(connectionId);
                        if (updatedConnection) {
                            this.historyManager.recordRelationshipEdit(previousConnection, updatedConnection);
                            // Update connection in graph incrementally without full refresh
                            this.updateConnectionInGraph(updatedConnection);
                        }
                    }
                );
                editModal.open();
            } else {
                new Notice('Connection not found');
            }
            menu.remove();
        });
        menu.appendChild(editItem);

        // Delete selected (if there are multiple selections including this edge)
        const totalSelected = this.selectedNodes.size + this.selectedEdges.size;
        if (totalSelected > 1 && this.selectedEdges.has(connectionId)) {
            const deleteSelectedItem = this.createMenuItem(`🗑 Delete Selected (${totalSelected})`, () => {
                menu.remove();
                this.showDeleteConfirmation();
            });
            deleteSelectedItem.style.color = 'var(--text-error)';
            menu.appendChild(deleteSelectedItem);
        }

        // Delete Relationship option
        const deleteItem = this.createMenuItem('🗑 Delete Relationship', async () => {
            menu.remove();
            await this.deleteRelationship(connectionId, relationship, sourceLabel, targetLabel);
        });
        deleteItem.style.color = 'var(--text-error)';
        menu.appendChild(deleteItem);

        document.body.appendChild(menu);

        // Close menu when clicking outside
        const closeMenu = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    /**
     * Delete a relationship with confirmation.
     */
    private async deleteRelationship(connectionId: string, relationship: string, sourceLabel: string, targetLabel: string): Promise<void> {
        // Get the connection before deleting for history
        const connection = this.entityManager.getConnection(connectionId);

        if (!connection) {
            new Notice('Relationship not found');
            return;
        }

        // Show confirmation
        const confirmDelete = confirm(`Delete relationship "${relationship}" between "${sourceLabel}" and "${targetLabel}"?`);
        if (!confirmDelete) return;

        // Record in history before deleting
        this.historyManager.recordRelationshipDelete(connection);

        // Delete from entity manager (with note update)
        await this.entityManager.deleteConnectionWithNote(connectionId);

        // Remove from graph
        if (this.cy) {
            this.cy.getElementById(connectionId).remove();
        }

        new Notice(`Deleted relationship: ${relationship}`);
    }

    /**
     * Show tooltip for Location entities with map preview hint.
     */
    private showLocationTooltip(node: any): void {
        const entityId = node.id();
        const entity = this.entityManager.getEntity(entityId);
        if (!entity || !entity.properties.latitude || !entity.properties.longitude) return;

        // Remove existing tooltip
        this.hideLocationTooltip();

        const tooltip = document.createElement('div');
        tooltip.id = 'graph_copilot-location-tooltip';
        tooltip.className = 'graph_copilot-location-tooltip';

        const lat = parseFloat(entity.properties.latitude);
        const lng = parseFloat(entity.properties.longitude);

        tooltip.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 4px;">📍 ${entity.label}</div>
            <div style="font-size: 11px; color: var(--text-muted);">
                ${entity.properties.address || ''}<br>
                Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}
            </div>
            <div style="font-size: 10px; color: var(--text-accent); margin-top: 4px;">
                Right-click → Show on Map
            </div>
        `;

        tooltip.style.cssText = `
            position: fixed;
            background: var(--background-primary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            padding: 8px 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            z-index: 1000;
            max-width: 250px;
            pointer-events: none;
        `;

        // Position tooltip near the node
        const renderedPos = node.renderedPosition();
        const containerRect = this.container?.getBoundingClientRect();
        if (containerRect) {
            tooltip.style.left = `${containerRect.left + renderedPos.x + 30}px`;
            tooltip.style.top = `${containerRect.top + renderedPos.y - 20}px`;
        }

        document.body.appendChild(tooltip);
    }

    /**
     * Hide the location tooltip.
     */
    private hideLocationTooltip(): void {
        const tooltip = document.getElementById('graph_copilot-location-tooltip');
        if (tooltip) tooltip.remove();
    }

    /**
     * Get Cytoscape style configuration.
     */
    private getGraphStyle(): any[] {
        return [
            {
                selector: 'node',
                style: {
                    'background-color': 'data(color)',
                    'label': (ele: any) => {
                        const icon = ele.data('icon') || '📦';
                        const label = ele.data('label') || '';
                        return `${icon}\n${label}`;
                    },
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'font-size': '16px',
                    'color': '#ffffff',
                    'text-outline-color': '#000000',
                    'text-outline-width': 1.5,
                    'text-wrap': 'wrap',
                    'text-max-width': '100px',
                    'width': 65,
                    'height': 65,
                    'border-width': 2,
                    'border-color': '#ffffff'
                }
            },
            {
                // Location/Address nodes get a special pin-like shape
                selector: 'node[type = "Location"], node[type = "Address"]',
                style: {
                    'shape': 'diamond',
                    'width': 70,
                    'height': 80,
                    'border-width': 3,
                    'border-color': '#ffffff'
                }
            },
            {
                // Location/Address nodes with coordinates get a map indicator
                selector: 'node[type = "Location"].has-coordinates, node[type = "Address"].has-coordinates',
                style: {
                    'border-style': 'double',
                    'border-width': 4
                }
            },
            {
                selector: 'node:selected',
                style: {
                    'border-width': 4,
                    'border-color': '#ffff00'
                }
            },
            {
                selector: 'node.connection-source',
                style: {
                    'border-width': 5,
                    'border-color': '#00ff00',
                    'border-style': 'dashed'
                }
            },
            {
                // Multi-selected nodes
                selector: 'node.multi-selected',
                style: {
                    'border-width': 4,
                    'border-color': '#ff6b6b',
                    'border-style': 'solid',
                    'overlay-color': '#ff6b6b',
                    'overlay-padding': 6,
                    'overlay-opacity': 0.2
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': '#888888',
                    'target-arrow-color': '#888888',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': '10px',
                    'color': '#cccccc',
                    'text-rotation': 'autorotate',
                    'text-margin-y': -10
                }
            },
            {
                selector: 'edge:selected',
                style: {
                    'width': 4,
                    'line-color': '#ffff00'
                }
            },
            {
                // Multi-selected edges
                selector: 'edge.multi-selected',
                style: {
                    'width': 4,
                    'line-color': '#ff6b6b',
                    'target-arrow-color': '#ff6b6b',
                    'line-style': 'solid'
                }
            }
        ];
    }

    /**
     * Refresh the graph with current data.
     * Reloads entities from disk to ensure persistence across Obsidian restarts.
     */
    async refresh(): Promise<void> {
        if (!this.cy) return;

        // Reload entities from disk to ensure we have the latest data
        // This is critical for persistence across Obsidian restarts
        try {
            await this.entityManager.loadEntitiesFromNotes();
        } catch (error) {
            console.error('[GraphView] Failed to reload entities from notes:', error);
        }

        const { entities, connections } = this.entityManager.getGraphData();

        // Clear existing elements
        this.cy.elements().remove();

        // Add nodes
        const nodes = entities.map((entity, index) => {
            // Check if Location entity has coordinates
            const hasCoordinates = entity.type === EntityType.Location &&
                entity.properties.latitude &&
                entity.properties.longitude;

            // Ensure label is a string
            const entityLabel = entity.label != null ? String(entity.label) : '';

            return {
                data: {
                    id: entity.id,
                    label: this.truncateLabel(entityLabel),
                    fullLabel: entityLabel,
                    type: entity.type,
                    color: ENTITY_CONFIGS[entity.type as EntityType]?.color || '#607D8B',
                    icon: getEntityIcon(entity.type),
                    hasCoordinates: hasCoordinates
                },
                position: this.getNodePosition(index, entities.length),
                classes: hasCoordinates ? 'has-coordinates' : ''
            };
        });

        // Build a set of valid entity IDs for edge validation
        const entityIds = new Set(entities.map(e => e.id));

        // Add edges - filter out connections with missing source or target entities
        const validConnections = connections.filter(conn => {
            const hasSource = entityIds.has(conn.fromEntityId);
            const hasTarget = entityIds.has(conn.toEntityId);
            if (!hasSource || !hasTarget) {
                console.warn(`[GraphView] Skipping connection ${conn.id}: missing ${!hasSource ? 'source' : 'target'} entity`);
                return false;
            }
            return true;
        });

        const edges = validConnections.map(conn => ({
            data: {
                id: conn.id,
                source: conn.fromEntityId,
                target: conn.toEntityId,
                label: conn.relationship
            }
        }));

        this.cy.add([...nodes, ...edges]);
        this.runLayout();
    }

    /**
     * Refresh the graph using saved positions (no automatic layout).
     * Only applies layout to new nodes that don't have saved positions.
     */
    async refreshWithSavedPositions(): Promise<void> {
        if (!this.cy) return;

        console.log(`[GraphView] refreshWithSavedPositions called, cache has ${this.nodePositionsCache.size} positions`);

        // Reload entities from disk to ensure we have the latest data
        try {
            await this.entityManager.loadEntitiesFromNotes();
        } catch (error) {
            console.error('[GraphView] Failed to reload entities from notes:', error);
        }

        const { entities, connections } = this.entityManager.getGraphData();
        console.log(`[GraphView] Found ${entities.length} entities and ${connections.length} connections`);

        // Clear existing elements
        this.cy.elements().remove();

        // Track which nodes need layout (no saved position)
        const nodesNeedingLayout: string[] = [];
        const nodesWithSavedPositions: string[] = [];

        // Add nodes with saved positions or mark for layout
        const nodes = entities.map((entity, index) => {
            const hasCoordinates = entity.type === EntityType.Location &&
                entity.properties.latitude &&
                entity.properties.longitude;

            const entityLabel = entity.label != null ? String(entity.label) : '';

            // Use saved position if available, otherwise use default and mark for layout
            const savedPos = this.nodePositionsCache.get(entity.id);
            let position: { x: number; y: number };

            if (savedPos) {
                position = savedPos;
                nodesWithSavedPositions.push(entity.id);
            } else {
                // New node - use circular layout position and mark for layout
                position = this.getNodePosition(index, entities.length);
                nodesNeedingLayout.push(entity.id);
            }

            return {
                data: {
                    id: entity.id,
                    label: this.truncateLabel(entityLabel),
                    fullLabel: entityLabel,
                    type: entity.type,
                    color: ENTITY_CONFIGS[entity.type as EntityType]?.color || '#607D8B',
                    icon: getEntityIcon(entity.type),
                    hasCoordinates: hasCoordinates
                },
                position: position,
                classes: hasCoordinates ? 'has-coordinates' : ''
            };
        });

        console.log(`[GraphView] Nodes with saved positions: ${nodesWithSavedPositions.length}, nodes needing layout: ${nodesNeedingLayout.length}`);
        if (nodesNeedingLayout.length > 0 && nodesNeedingLayout.length <= 5) {
            console.log(`[GraphView] Nodes needing layout:`, nodesNeedingLayout);
        }
        if (nodesWithSavedPositions.length > 0 && nodesWithSavedPositions.length <= 5) {
            console.log(`[GraphView] Nodes with saved positions:`, nodesWithSavedPositions);
        }

        // Build a set of valid entity IDs for edge validation
        const entityIds = new Set(entities.map(e => e.id));

        // Add edges - filter out connections with missing source or target entities
        const validConnections = connections.filter(conn => {
            const hasSource = entityIds.has(conn.fromEntityId);
            const hasTarget = entityIds.has(conn.toEntityId);
            if (!hasSource || !hasTarget) {
                console.warn(`[GraphView] Skipping connection ${conn.id}: missing ${!hasSource ? 'source' : 'target'} entity`);
                return false;
            }
            return true;
        });

        const edges = validConnections.map(conn => ({
            data: {
                id: conn.id,
                source: conn.fromEntityId,
                target: conn.toEntityId,
                label: conn.relationship
            }
        }));

        this.cy.add([...nodes, ...edges]);

        // Update cache with current positions
        this.cy.nodes().forEach((node: any) => {
            const pos = node.position();
            this.nodePositionsCache.set(node.id(), { x: pos.x, y: pos.y });
        });

        // Only run layout for new nodes if there are any
        if (nodesNeedingLayout.length > 0 && nodesNeedingLayout.length < entities.length) {
            // Run layout only on new nodes
            const newNodes = this.cy.nodes().filter((node: any) => nodesNeedingLayout.includes(node.id()));
            if (newNodes.length > 0) {
                newNodes.layout({
                    name: 'cose',
                    animate: true,
                    animationDuration: 300,
                    fit: false,
                    nodeRepulsion: () => 8000,
                    idealEdgeLength: () => 100
                }).run();

                // Save new positions after layout completes
                setTimeout(() => {
                    newNodes.forEach((node: any) => {
                        const pos = node.position();
                        this.nodePositionsCache.set(node.id(), { x: pos.x, y: pos.y });
                    });
                    this.savePositionsDebounced();
                }, 400);
            }
        } else if (nodesNeedingLayout.length === entities.length && entities.length > 0) {
            // All nodes are new - run full layout
            this.runLayout();
            // Save positions after layout
            setTimeout(() => {
                this.cy.nodes().forEach((node: any) => {
                    const pos = node.position();
                    this.nodePositionsCache.set(node.id(), { x: pos.x, y: pos.y });
                });
                this.savePositionsDebounced();
            }, 600);
        }

        // Fit view
        this.cy.fit();
    }

    /**
     * Rearrange all nodes using automatic layout (resets positions).
     */
    async rearrangeGraph(): Promise<void> {
        if (!this.cy) return;

        // Clear saved positions
        this.nodePositionsCache.clear();

        // Run full layout
        this.runLayout();

        // Save new positions after layout completes
        setTimeout(() => {
            this.cy.nodes().forEach((node: any) => {
                const pos = node.position();
                this.nodePositionsCache.set(node.id(), { x: pos.x, y: pos.y });
            });
            this.savePositions();
            new Notice('Graph rearranged');
        }, 600);
    }

    /**
     * Show confirmation dialog before rearranging.
     */
    private showRearrangeConfirmation(): Promise<boolean> {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal-container';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            `;

            const dialog = document.createElement('div');
            dialog.className = 'modal';
            dialog.style.cssText = `
                background: var(--background-primary);
                border-radius: 8px;
                padding: 20px;
                max-width: 400px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            `;

            const title = document.createElement('h3');
            title.textContent = 'Rearrange Graph?';
            title.style.marginTop = '0';
            dialog.appendChild(title);

            const message = document.createElement('p');
            message.textContent = 'Are you sure you want to rearrange all entities? This will reset their current positions.';
            dialog.appendChild(message);

            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;';

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = () => {
                modal.remove();
                resolve(false);
            };
            buttonContainer.appendChild(cancelBtn);

            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = 'Rearrange';
            confirmBtn.className = 'mod-cta';
            confirmBtn.style.cssText = 'background: var(--interactive-accent); color: var(--text-on-accent);';
            confirmBtn.onclick = () => {
                modal.remove();
                resolve(true);
            };
            buttonContainer.appendChild(confirmBtn);

            dialog.appendChild(buttonContainer);
            modal.appendChild(dialog);
            document.body.appendChild(modal);

            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve(false);
                }
            });
        });
    }

    /**
     * Truncate label for display.
     */
    private truncateLabel(label: any, maxLength: number = 20): string {
        // Ensure label is a string
        const strLabel = label != null ? String(label) : '';
        if (strLabel.length <= maxLength) return strLabel;
        return strLabel.substring(0, maxLength - 3) + '...';
    }

    /**
     * Get initial position for a node.
     */
    private getNodePosition(index: number, total: number): { x: number; y: number } {
        const radius = Math.max(200, total * 30);
        const angle = (2 * Math.PI * index) / total;
        return {
            x: radius * Math.cos(angle) + 400,
            y: radius * Math.sin(angle) + 300
        };
    }

    /**
     * Load saved node positions from persistent storage.
     */
    private async loadSavedPositions(): Promise<void> {
        try {
            console.log(`[GraphView] Looking for positions file at: ${NODE_POSITIONS_FILE}`);
            const file = this.app.vault.getAbstractFileByPath(NODE_POSITIONS_FILE);
            if (file instanceof TFile) {
                const content = await this.app.vault.read(file);
                const positions = JSON.parse(content) as Record<string, NodePosition>;
                this.nodePositionsCache.clear();
                for (const [nodeId, pos] of Object.entries(positions)) {
                    this.nodePositionsCache.set(nodeId, pos);
                }
                console.log(`[GraphView] Loaded ${this.nodePositionsCache.size} saved node positions:`,
                    Array.from(this.nodePositionsCache.entries()).slice(0, 3));
            } else {
                console.log('[GraphView] Positions file not found');
            }
        } catch (error) {
            // File doesn't exist or is invalid - start fresh
            console.log('[GraphView] No saved positions found, starting fresh:', error);
        }
    }

    /**
     * Save node positions to persistent storage.
     */
    private async savePositions(): Promise<void> {
        try {
            const positions: Record<string, NodePosition> = {};
            for (const [nodeId, pos] of this.nodePositionsCache.entries()) {
                positions[nodeId] = pos;
            }

            const content = JSON.stringify(positions, null, 2);
            console.log(`[GraphView] Saving ${Object.keys(positions).length} positions to ${NODE_POSITIONS_FILE}`);

            // Ensure directory exists first
            const dir = NODE_POSITIONS_FILE.substring(0, NODE_POSITIONS_FILE.lastIndexOf('/'));
            try {
                const dirExists = this.app.vault.getAbstractFileByPath(dir);
                if (!dirExists) {
                    await this.app.vault.createFolder(dir);
                }
            } catch (e) {
                // Folder may already exist, ignore error
            }

            // Check if file exists and modify or create accordingly
            const file = this.app.vault.getAbstractFileByPath(NODE_POSITIONS_FILE);

            if (file instanceof TFile) {
                await this.app.vault.modify(file, content);
                console.log('[GraphView] Positions saved successfully (modified existing file)');
            } else {
                // File doesn't exist, try to create it
                try {
                    await this.app.vault.create(NODE_POSITIONS_FILE, content);
                    console.log('[GraphView] Positions saved successfully (created new file)');
                } catch (createError: any) {
                    // If file was created between our check and create (race condition),
                    // try to modify it instead
                    if (createError.message?.includes('already exists')) {
                        const existingFile = this.app.vault.getAbstractFileByPath(NODE_POSITIONS_FILE);
                        if (existingFile instanceof TFile) {
                            await this.app.vault.modify(existingFile, content);
                            console.log('[GraphView] Positions saved successfully (modified after race condition)');
                        }
                    } else {
                        throw createError;
                    }
                }
            }
        } catch (error) {
            console.error('[GraphView] Failed to save positions:', error);
        }
    }

    /**
     * Save positions with debouncing to avoid too many writes.
     */
    private savePositionsDebounced = this.debounce(() => this.savePositions(), 1000);

    /**
     * Simple debounce helper.
     */
    private debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        return ((...args: Parameters<T>) => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn(...args), delay);
        }) as T;
    }

    /**
     * Run the force-directed layout.
     */
    runLayout(): void {
        if (!this.cy) return;

        this.cy.layout({
            name: 'cose',
            animate: true,
            animationDuration: 500,
            nodeRepulsion: () => 8000,
            idealEdgeLength: () => 100,
            edgeElasticity: () => 100,
            nestingFactor: 1.2,
            gravity: 0.25,
            numIter: 1000,
            initialTemp: 200,
            coolingFactor: 0.95,
            minTemp: 1.0
        }).run();
    }

    /**
     * Add a single entity to the graph.
     */
    addEntity(entity: Entity): void {
        if (!this.cy) return;

        const existingNode = this.cy.getElementById(entity.id);
        if (existingNode.length > 0) return;

        // Ensure label is a string
        const entityLabel = entity.label != null ? String(entity.label) : '';

        this.cy.add({
            data: {
                id: entity.id,
                label: this.truncateLabel(entityLabel),
                fullLabel: entityLabel,
                type: entity.type,
                color: ENTITY_CONFIGS[entity.type as EntityType]?.color || '#607D8B',
                icon: getEntityIcon(entity.type)
            },
            position: { x: 400, y: 300 }
        });

        this.runLayout();
    }

    /**
     * Add a connection to the graph.
     */
    addConnection(connection: Connection): void {
        if (!this.cy) return;

        const existingEdge = this.cy.getElementById(connection.id);
        if (existingEdge.length > 0) return;

        this.cy.add({
            data: {
                id: connection.id,
                source: connection.fromEntityId,
                target: connection.toEntityId,
                label: connection.relationship
            }
        });
    }

    /**
     * Remove an entity from the graph.
     */
    removeEntity(entityId: string): void {
        if (!this.cy) return;
        this.cy.getElementById(entityId).remove();
    }

    /**
     * Highlight an entity in the graph.
     */
    highlightEntity(entityId: string): void {
        if (!this.cy) return;

        this.cy.elements().unselect();
        const node = this.cy.getElementById(entityId);
        if (node.length > 0) {
            node.select();
            this.cy.animate({
                center: { eles: node },
                zoom: 1.5
            }, { duration: 300 });
        }
    }

    /**
     * Perform undo operation.
     */
    private async performUndo(): Promise<void> {
        if (!this.historyManager.canUndo()) {
            new Notice('Nothing to undo');
            return;
        }

        const description = this.historyManager.getLastUndoDescription();
        const success = await this.historyManager.undo();

        if (success) {
            new Notice(`Undo: ${description}`);
        } else {
            new Notice('Undo failed');
        }
    }

    /**
     * Perform redo operation.
     */
    private async performRedo(): Promise<void> {
        if (!this.historyManager.canRedo()) {
            new Notice('Nothing to redo');
            return;
        }

        const description = this.historyManager.getLastRedoDescription();
        const success = await this.historyManager.redo();

        if (success) {
            new Notice(`Redo: ${description}`);
        } else {
            new Notice('Redo failed');
        }
    }

    /**
     * Update the history UI (undo/redo buttons and panel).
     */
    private updateHistoryUI(): void {
        // Update undo button
        if (this.undoBtn) {
            this.undoBtn.disabled = !this.historyManager.canUndo();
            const undoDesc = this.historyManager.getLastUndoDescription();
            this.undoBtn.title = undoDesc ? `Undo: ${undoDesc}` : 'Nothing to undo';
        }

        // Update redo button
        if (this.redoBtn) {
            this.redoBtn.disabled = !this.historyManager.canRedo();
            const redoDesc = this.historyManager.getLastRedoDescription();
            this.redoBtn.title = redoDesc ? `Redo: ${redoDesc}` : 'Nothing to redo';
        }

        // Update history panel if visible
        if (this.historyPanelVisible && this.historyPanel) {
            this.renderHistoryPanelContent();
        }
    }

    /**
     * Toggle the history panel visibility.
     */
    private toggleHistoryPanel(): void {
        if (this.historyPanelVisible) {
            this.hideHistoryPanel();
        } else {
            this.showHistoryPanel();
        }
    }

    /**
     * Show the history panel.
     */
    private showHistoryPanel(): void {
        if (this.historyPanel) {
            this.historyPanel.remove();
        }

        this.historyPanel = document.createElement('div');
        this.historyPanel.className = 'graph_copilot-history-panel';
        this.historyPanel.style.cssText = `
            position: absolute;
            top: 60px;
            right: 10px;
            width: 280px;
            max-height: 400px;
            background: var(--background-primary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 99;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 10px 12px;
            font-weight: bold;
            border-bottom: 1px solid var(--background-modifier-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        header.innerHTML = '<span>📜 Edit History</span>';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            cursor: pointer;
            font-size: 14px;
            color: var(--text-muted);
        `;
        closeBtn.onclick = () => this.hideHistoryPanel();
        header.appendChild(closeBtn);
        this.historyPanel.appendChild(header);

        // Content container
        const content = document.createElement('div');
        content.className = 'graph_copilot-history-content';
        content.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        `;
        this.historyPanel.appendChild(content);

        this.container?.parentElement?.appendChild(this.historyPanel);
        this.historyPanelVisible = true;
        this.renderHistoryPanelContent();
    }

    /**
     * Hide the history panel.
     */
    private hideHistoryPanel(): void {
        if (this.historyPanel) {
            this.historyPanel.remove();
            this.historyPanel = null;
        }
        this.historyPanelVisible = false;
    }

    /**
     * Render the history panel content.
     */
    private renderHistoryPanelContent(): void {
        if (!this.historyPanel) return;

        const content = this.historyPanel.querySelector('.graph_copilot-history-content');
        if (!content) return;

        content.innerHTML = '';

        const undoStack = this.historyManager.getUndoStack();
        const redoStack = this.historyManager.getRedoStack();

        if (undoStack.length === 0 && redoStack.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.style.cssText = `
                text-align: center;
                color: var(--text-muted);
                padding: 20px;
                font-size: 13px;
            `;
            emptyMsg.textContent = 'No history yet';
            content.appendChild(emptyMsg);
            return;
        }

        // Show redo stack (future actions) - reversed order
        if (redoStack.length > 0) {
            const redoHeader = document.createElement('div');
            redoHeader.style.cssText = `
                font-size: 11px;
                color: var(--text-muted);
                padding: 4px 8px;
                text-transform: uppercase;
            `;
            redoHeader.textContent = 'Redo Stack';
            content.appendChild(redoHeader);

            [...redoStack].reverse().forEach((entry, index) => {
                const item = this.createHistoryItem(entry, 'redo', index);
                content.appendChild(item);
            });
        }

        // Current position marker
        const currentMarker = document.createElement('div');
        currentMarker.style.cssText = `
            padding: 6px 8px;
            background: var(--interactive-accent);
            color: var(--text-on-accent);
            border-radius: 4px;
            font-size: 12px;
            text-align: center;
            margin: 4px 0;
        `;
        currentMarker.textContent = '▶ Current State';
        content.appendChild(currentMarker);

        // Show undo stack (past actions) - reversed order (most recent first)
        if (undoStack.length > 0) {
            const undoHeader = document.createElement('div');
            undoHeader.style.cssText = `
                font-size: 11px;
                color: var(--text-muted);
                padding: 4px 8px;
                text-transform: uppercase;
            `;
            undoHeader.textContent = 'Undo Stack';
            content.appendChild(undoHeader);

            [...undoStack].reverse().forEach((entry, index) => {
                const item = this.createHistoryItem(entry, 'undo', index);
                content.appendChild(item);
            });
        }
    }

    /**
     * Create a history item element.
     */
    private createHistoryItem(entry: HistoryEntry, type: 'undo' | 'redo', index: number): HTMLElement {
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 8px;
            margin: 2px 0;
            background: var(--background-secondary);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            opacity: ${type === 'redo' ? '0.6' : '1'};
        `;

        const icon = this.getHistoryIcon(entry.type);
        const time = this.formatTime(entry.timestamp);

        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>${icon} ${entry.description}</span>
                <span style="font-size: 10px; color: var(--text-muted);">${time}</span>
            </div>
        `;

        item.onmouseenter = () => item.style.background = 'var(--background-modifier-hover)';
        item.onmouseleave = () => item.style.background = 'var(--background-secondary)';

        item.onclick = async () => {
            if (type === 'undo') {
                // Undo to this point
                await this.historyManager.undoToEntry(entry.id);
            } else {
                // Redo to this point
                await this.historyManager.redoToEntry(entry.id);
            }
        };

        return item;
    }

    /**
     * Get icon for history operation type.
     */
    private getHistoryIcon(type: HistoryOperationType): string {
        switch (type) {
            case HistoryOperationType.ENTITY_CREATE: return '➕';
            case HistoryOperationType.ENTITY_DELETE: return '🗑';
            case HistoryOperationType.ENTITY_EDIT: return '✏️';
            case HistoryOperationType.RELATIONSHIP_CREATE: return '🔗';
            case HistoryOperationType.RELATIONSHIP_DELETE: return '✂️';
            case HistoryOperationType.NODE_POSITION_CHANGE: return '↔️';
            case HistoryOperationType.BATCH_OPERATION: return '📦';
            default: return '•';
        }
    }

    /**
     * Format timestamp for display.
     */
    private formatTime(date: Date): string {
        const now = new Date();
        const diff = now.getTime() - date.getTime();

        if (diff < 60000) return 'just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return date.toLocaleDateString();
    }

    /**
     * Add entity to graph without triggering layout.
     */
    private addEntityToGraphPreserveLayout(entity: Entity): void {
        if (!this.cy) return;

        const existingNode = this.cy.getElementById(entity.id);
        if (existingNode.length > 0) return;

        const config = ENTITY_CONFIGS[entity.type as EntityType] || ENTITY_CONFIGS[EntityType.Person];
        // Ensure label is a string
        const entityLabel = entity.label != null ? String(entity.label) : '';
        const label = this.truncateLabel(entityLabel, 15);

        // Get cached position or use random position
        const cachedPos = this.nodePositionsCache.get(entity.id);
        const position = cachedPos || {
            x: Math.random() * 400 + 100,
            y: Math.random() * 400 + 100
        };

        this.cy.add({
            data: {
                id: entity.id,
                label: label,
                fullLabel: entityLabel,
                type: entity.type,
                color: config.color,
                icon: getEntityIcon(entity.type)
            },
            position: position
        });

        // Update cache
        this.nodePositionsCache.set(entity.id, position);
    }

    /**
     * Update entity in graph.
     */
    private updateEntityInGraph(entity: Entity): void {
        if (!this.cy) return;

        const node = this.cy.getElementById(entity.id);
        if (node.length === 0) return;

        const config = ENTITY_CONFIGS[entity.type as EntityType] || ENTITY_CONFIGS[EntityType.Person];
        // Ensure label is a string
        const entityLabel = entity.label != null ? String(entity.label) : '';
        const label = this.truncateLabel(entityLabel, 15);

        node.data('label', label);
        node.data('fullLabel', entityLabel);
        node.data('type', entity.type);
        node.data('color', config.color);
        node.data('icon', getEntityIcon(entity.type));
    }

    /**
     * Update connection in graph.
     */
    private updateConnectionInGraph(connection: Connection): void {
        if (!this.cy) return;

        const edge = this.cy.getElementById(connection.id);
        if (edge.length === 0) return;

        // Update edge data
        edge.data('label', connection.relationship);

        // If the connection has additional properties, we could show them in a tooltip
        // For now, just update the label
    }

    /**
     * Add connection to graph without triggering layout.
     */
    private addConnectionToGraph(connection: Connection): void {
        if (!this.cy) return;

        const existingEdge = this.cy.getElementById(connection.id);
        if (existingEdge.length > 0) return;

        this.cy.add({
            data: {
                id: connection.id,
                source: connection.fromEntityId,
                target: connection.toEntityId,
                label: connection.relationship
            }
        });
    }

    /**
     * Geolocate an entity (Location or Address) by converting its address to coordinates.
     */
    private async geolocateEntity(entityId: string): Promise<void> {
        const entity = this.entityManager.getEntity(entityId);
        if (!entity) {
            new Notice('Entity not found');
            return;
        }

        // Extract address components based on entity type
        let address: string | undefined;
        let city: string | undefined;
        let state: string | undefined;
        let country: string | undefined;

        if (entity.type === EntityType.Location) {
            // Location entity uses 'address' property
            address = entity.properties.address as string;
            city = entity.properties.city as string;
            country = entity.properties.country as string;
        } else if (entity.type === 'Address') {
            // Address entity uses FTM schema properties
            address = entity.properties.street as string || entity.properties.full as string;
            city = entity.properties.city as string;
            state = entity.properties.state as string;
            country = entity.properties.country as string;
        }

        // Validate we have at least some address information
        if (!address && !city && !country) {
            new Notice('No address information found. Please add address details to the entity first.');
            return;
        }

        try {
            new Notice('Geocoding address...');

            const result = await this.geocodingService.geocodeAddressWithRetry(
                address,
                city,
                state,
                country,
                (attempt, maxAttempts, delaySeconds) => {
                    new Notice(`Network error, retrying in ${delaySeconds}s... (attempt ${attempt}/${maxAttempts})`);
                }
            );

            // Update entity with coordinates
            const updates: Record<string, any> = {
                latitude: result.latitude,
                longitude: result.longitude
            };

            // Also update address components if they were found and not already set
            if (result.city && !city) {
                updates.city = result.city;
            }
            if (result.state && !state && entity.type === 'Address') {
                updates.state = result.state;
            }
            if (result.country && !country) {
                updates.country = result.country;
            }
            if (result.postalCode && entity.type === 'Address' && !entity.properties.postalCode) {
                updates.postalCode = result.postalCode;
            }

            await this.entityManager.updateEntity(entityId, updates);

            // Update the node in the graph
            const updatedEntity = this.entityManager.getEntity(entityId);
            if (updatedEntity) {
                this.updateEntityInGraph(updatedEntity);
            }

            new Notice(`✓ Geocoded: ${result.displayName}\nLat: ${result.latitude.toFixed(4)}, Lng: ${result.longitude.toFixed(4)}\nConfidence: ${result.confidence}`);

        } catch (error) {
            if (error instanceof GeocodingError) {
                new Notice(`Geocoding failed: ${error.message}`);
            } else {
                console.error('[GraphView] Geocoding error:', error);
                new Notice('Failed to geocode address. Please try again.');
            }
        }
    }
}

