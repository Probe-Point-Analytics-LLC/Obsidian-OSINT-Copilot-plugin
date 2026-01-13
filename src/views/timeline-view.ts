
/**
 * Timeline View for visualizing Event entities with dates.
 */

import { App, ItemView, WorkspaceLeaf, Menu, Notice } from 'obsidian';
import { Entity, EntityType, ENTITY_CONFIGS } from '../entities/types';
import { EntityManager } from '../services/entity-manager';
import { EntityCreationModal } from '../modals/entity-modal';

export const TIMELINE_VIEW_TYPE = 'graph_copilot-timeline-view';

interface TimelineEvent {
    id: string;
    label: string;
    start: Date;
    end?: Date;
    color: string;
}

export class TimelineView extends ItemView {
    private entityManager: EntityManager;
    private container: HTMLElement | null = null;
    private timelineContainer: HTMLElement | null = null;
    private events: TimelineEvent[] = [];
    private onEventClick: ((entityId: string) => void) | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        entityManager: EntityManager,
        onEventClick?: (entityId: string) => void
    ) {
        super(leaf);
        this.entityManager = entityManager;
        this.onEventClick = onEventClick || null;
    }

    getViewType(): string {
        return TIMELINE_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'OSINTCopilot timeline';
    }

    getIcon(): string {
        return 'calendar-clock';
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('graph_copilot-timeline-container');

        // Create toolbar
        const toolbar = container.createDiv({ cls: 'graph_copilot-timeline-toolbar' });
        this.createToolbar(toolbar);

        // Create timeline container
        this.timelineContainer = container.createDiv({ cls: 'graph_copilot-timeline-canvas' });
        this.applyStyles();

        // Load entities from disk and refresh the timeline
        await this.refresh();
    }

    async onClose(): Promise<void> {
        this.events = [];
    }

    /**
     * Apply CSS styles for the timeline.
     */
    private applyStyles(): void {
        if (!this.timelineContainer) return;

        this.timelineContainer.setCssProps({
            width: '100%',
            height: 'calc(100% - 50px)',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            padding: '20px',
            'box-sizing': 'border-box'
        });
    }

    /**
     * Create the toolbar.
     */
    private createToolbar(toolbar: HTMLElement): void {
        toolbar.setCssProps({
            display: 'flex',
            gap: '10px',
            padding: '10px',
            background: 'var(--background-secondary)',
            'border-bottom': '1px solid var(--background-modifier-border)'
        });

        // Add Event button
        const addBtn = toolbar.createEl('button', { text: '+ add event' });
        addBtn.addClass('graph_copilot-add-entity-btn');
        addBtn.onclick = () => this.openEventCreator();

        // Separator
        toolbar.createDiv({ cls: 'graph_copilot-toolbar-separator' });

        // Refresh button
        const refreshBtn = toolbar.createEl('button', { text: '↻ refresh' });
        refreshBtn.onclick = () => {
            (async () => {
                refreshBtn.disabled = true;
                refreshBtn.textContent = '↻ loading...';
                await this.refresh();
                refreshBtn.disabled = false;
                refreshBtn.textContent = '↻ refresh';
            })();
        };

        // Filter label
        const filterSpan = toolbar.createEl('span', {
            text: 'Shows events with "add to timeline" enabled',
            cls: 'graph_copilot-timeline-info'
        });
        filterSpan.setCssProps({
            'margin-left': 'auto',
            color: 'var(--text-muted)',
            'font-size': '12px'
        });
    }

    /**
     * Open the event creation modal.
     */
    private openEventCreator(): void {
        const modal = new EntityCreationModal(
            this.app,
            this.entityManager,
            EntityType.Event,
            (entityId) => {
                // Refresh the timeline after event creation
                this.refresh();
            }
        );
        modal.open();
    }

    /**
     * Refresh the timeline with current data.
     * Reloads entities from disk to ensure persistence across Obsidian restarts.
     */
    async refresh(): Promise<void> {
        if (!this.timelineContainer) return;

        // Reload entities from disk to ensure we have the latest data
        try {
            await this.entityManager.loadEntitiesFromNotes();
        } catch (error) {
            console.error('[TimelineView] Failed to reload entities from notes:', error);
        }

        // Get all Event entities with dates
        const entities = this.entityManager.getEntitiesByType(EntityType.Event);
        this.events = this.parseEvents(entities);

        // Render the timeline
        this.renderTimeline();
    }

    /**
     * Parse entities into timeline events.
     * Only includes events that have add_to_timeline set to true.
     */
    private parseEvents(entities: Entity[]): TimelineEvent[] {
        const events: TimelineEvent[] = [];

        for (const entity of entities) {
            // Only include events that are explicitly added to the timeline
            if (!entity.properties.add_to_timeline) continue;

            const startDate = this.parseDate(entity.properties.start_date as string | undefined);
            if (!startDate) continue;

            const endDate = this.parseDate(entity.properties.end_date as string | undefined);

            events.push({
                id: entity.id,
                label: entity.label,
                start: startDate,
                end: endDate || undefined,
                color: ENTITY_CONFIGS[EntityType.Event].color
            });
        }

        // Sort by start date
        events.sort((a, b) => a.start.getTime() - b.start.getTime());

        return events;
    }

    /**
     * Parse a date string in YYYY-MM-DD HH:mm format.
     */
    private parseDate(dateStr: string | undefined): Date | null {
        if (!dateStr) return null;

        try {
            // Handle YYYY-MM-DD HH:mm format
            const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
            if (match) {
                return new Date(
                    parseInt(match[1]),
                    parseInt(match[2]) - 1,
                    parseInt(match[3]),
                    parseInt(match[4]),
                    parseInt(match[5])
                );
            }

            // Try standard Date parsing
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                return date;
            }
        } catch (e) {
            console.error('Failed to parse date:', dateStr);
        }

        return null;
    }

    /**
     * Render the timeline visualization.
     */
    private renderTimeline(): void {
        if (!this.timelineContainer) return;
        this.timelineContainer.empty();

        if (this.events.length === 0) {
            const emptyEl = this.timelineContainer.createDiv({ cls: 'graph_copilot-timeline-empty' });
            emptyEl.setCssProps({
                'text-align': 'center',
                padding: '40px',
                color: 'var(--text-muted)'
            });

            const p1 = emptyEl.createEl('p', {
                text: 'No events added to the timeline yet.'
            });
            p1.setCssProps({ 'margin-bottom': '10px' });

            const p2 = emptyEl.createEl('p', {
                text: 'To add events: create an event entity with a start date, then check the "add to timeline" checkbox.'
            });
            p2.setCssProps({ 'font-size': '12px' });
            return;
        }

        // Create timeline wrapper
        const wrapper = this.timelineContainer.createDiv({ cls: 'graph_copilot-timeline-wrapper' });
        wrapper.setCssProps({
            position: 'relative',
            'min-height': '100%',
            'padding-left': '200px'
        });

        // Create the timeline line
        const line = wrapper.createDiv({ cls: 'graph_copilot-timeline-line' });
        line.setCssProps({
            position: 'absolute',
            left: '180px',
            top: '0',
            bottom: '0',
            width: '4px',
            background: 'var(--interactive-accent)',
            'border-radius': '2px'
        });

        // Render each event
        this.events.forEach((event, index) => {
            this.renderEvent(wrapper, event, index);
        });
    }

    /**
     * Render a single event on the timeline.
     */
    private renderEvent(container: HTMLElement, event: TimelineEvent, index: number): void {
        const eventEl = container.createDiv({ cls: 'graph_copilot-timeline-event' });
        eventEl.setCssProps({
            position: 'relative',
            'margin-bottom': '30px',
            'padding-left': '40px'
        });

        // Event dot
        const dot = eventEl.createDiv({ cls: 'graph_copilot-timeline-dot' });
        dot.setCssProps({
            position: 'absolute',
            left: '-12px',
            top: '5px',
            width: '20px',
            height: '20px',
            background: event.color,
            'border-radius': '50%',
            border: '3px solid var(--background-primary)',
            'box-shadow': `0 0 0 2px ${event.color}`
        });

        // Date label
        const dateLabel = eventEl.createDiv({ cls: 'graph_copilot-timeline-date' });
        dateLabel.setCssProps({
            position: 'absolute',
            left: '-180px',
            top: '0',
            width: '150px',
            'text-align': 'right',
            'font-size': '12px',
            color: 'var(--text-muted)'
        });
        dateLabel.textContent = this.formatDate(event.start);

        // Event card
        const card = eventEl.createDiv({ cls: 'graph_copilot-timeline-card' });
        card.setCssProps({
            background: 'var(--background-secondary)',
            'border-left': `4px solid ${event.color}`,
            padding: '15px',
            'border-radius': '0 8px 8px 0',
            transition: 'transform 0.2s, box-shadow 0.2s',
            cursor: 'pointer'
        });

        // Card header with title and remove button
        const cardHeader = card.createDiv({ cls: 'graph_copilot-timeline-card-header' });
        cardHeader.setCssProps({
            display: 'flex',
            'justify-content': 'space-between',
            'align-items': 'flex-start',
            gap: '10px'
        });

        // Event title
        const title = cardHeader.createEl('h4', { text: event.label });
        title.setCssProps({
            margin: '0',
            color: 'var(--text-normal)',
            flex: '1'
        });

        // Remove from Timeline button
        const removeBtn = cardHeader.createEl('button', {
            text: '✕ remove',
            cls: 'graph_copilot-timeline-remove-btn'
        });
        removeBtn.setCssProps({
            background: 'transparent',
            border: '1px solid var(--text-muted)',
            color: 'var(--text-muted)',
            padding: '2px 8px',
            'border-radius': '4px',
            'font-size': '11px',
            cursor: 'pointer',
            transition: 'all 0.2s',
            'white-space': 'nowrap'
        });
        removeBtn.title = 'Remove from timeline';

        // Remove button hover effects
        removeBtn.onmouseenter = () => {
            removeBtn.setCssProps({
                background: 'var(--background-modifier-error)',
                'border-color': 'var(--background-modifier-error)',
                color: 'white'
            });
        };
        removeBtn.onmouseleave = () => {
            removeBtn.setCssProps({
                background: 'transparent',
                'border-color': 'var(--text-muted)',
                color: 'var(--text-muted)'
            });
        };

        // Remove button click handler
        removeBtn.onclick = async (e) => {
            e.stopPropagation(); // Prevent card click
            await this.toggleEventTimeline(event.id, false);
        };

        // Time range
        const timeRange = card.createDiv({ cls: 'graph_copilot-timeline-time' });
        timeRange.setCssProps({
            'font-size': '12px',
            color: 'var(--text-muted)',
            'margin-top': '5px'
        });

        let timeText = this.formatTime(event.start);
        if (event.end) {
            timeText += ` → ${this.formatTime(event.end)}`;
        }
        timeRange.textContent = timeText;

        // Hover effects for card
        card.onmouseenter = () => {
            card.setCssProps({
                transform: 'translateX(5px)',
                'box-shadow': '0 4px 12px rgba(0,0,0,0.2)'
            });
        };
        card.onmouseleave = () => {
            card.setCssProps({
                transform: 'translateX(0)',
                'box-shadow': 'none'
            });
        };

        // Click handler for card (opens entity note)
        card.onclick = (e) => {
            // Don't trigger if clicking the remove button
            if ((e.target as HTMLElement).closest('.graph_copilot-timeline-remove-btn')) return;

            if (this.onEventClick) {
                this.onEventClick(event.id);
            } else {
                this.entityManager.openEntityNote(event.id);
            }
        };

        // Context menu handler
        card.addEventListener('contextmenu', (e: MouseEvent) => {
            const menu = new Menu();

            menu.addItem((item) => {
                item
                    .setTitle('Edit')
                    .setIcon('pencil')
                    .onClick(() => {
                        const entity = this.entityManager.getEntity(event.id);
                        if (entity) {
                            new EntityCreationModal(
                                this.app,
                                this.entityManager,
                                entity.type as EntityType,
                                () => {
                                    this.refresh();
                                },
                                entity.properties,
                                entity.id
                            ).open();
                        } else {
                            new Notice('Entity not found');
                        }
                    });
            });

            menu.showAtPosition({ x: e.clientX, y: e.clientY });
        });
    }

    /**
     * Toggle an event's timeline inclusion status.
     */
    private async toggleEventTimeline(entityId: string, addToTimeline: boolean): Promise<void> {
        try {
            await this.entityManager.updateEntity(entityId, { add_to_timeline: addToTimeline });
            await this.refresh();
        } catch (error) {
            console.error('[TimelineView] Failed to toggle event timeline status:', error);
        }
    }

    /**
     * Format a date for display.
     */
    private formatDate(date: Date): string {
        const options: Intl.DateTimeFormatOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        };
        return date.toLocaleDateString(undefined, options);
    }

    /**
     * Format a time for display.
     */
    private formatTime(date: Date): string {
        const options: Intl.DateTimeFormatOptions = {
            hour: '2-digit',
            minute: '2-digit'
        };
        return date.toLocaleTimeString(undefined, options);
    }

    /**
     * Add an event to the timeline.
     */
    addEvent(entity: Entity): void {
        if (entity.type !== EntityType.Event) return;
        this.refresh();
    }

    /**
     * Remove an event from the timeline.
     */
    removeEvent(entityId: string): void {
        this.events = this.events.filter(e => e.id !== entityId);
        this.renderTimeline();
    }
}

