/* eslint-disable obsidianmd/no-static-styles-assignment */
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

        this.timelineContainer.style.setProperty('width', '100%');
        this.timelineContainer.style.setProperty('height', 'calc(100% - 50px)');
        this.timelineContainer.style.setProperty('overflow-x', 'auto');
        this.timelineContainer.style.setProperty('overflow-y', 'auto');
        this.timelineContainer.style.setProperty('padding', '20px');
        this.timelineContainer.style.setProperty('box-sizing', 'border-box');
    }

    /**
     * Create the toolbar.
     */
    private createToolbar(toolbar: HTMLElement): void {
        toolbar.style.setProperty('display', 'flex');
        toolbar.style.setProperty('gap', '10px');
        toolbar.style.setProperty('padding', '10px');
        toolbar.style.setProperty('background', 'var(--background-secondary)');
        toolbar.style.setProperty('border-bottom', '1px solid var(--background-modifier-border)');

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
        filterSpan.style.setProperty('margin-left', 'auto');
        filterSpan.style.setProperty('color', 'var(--text-muted)');
        filterSpan.style.setProperty('font-size', '12px');
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
            emptyEl.style.setProperty('text-align', 'center');
            emptyEl.style.setProperty('padding', '40px');
            emptyEl.style.setProperty('color', 'var(--text-muted)');

            const p1 = emptyEl.createEl('p', {
                text: 'No events added to the timeline yet.'
            });
            p1.style.setProperty('margin-bottom', '10px');

            const p2 = emptyEl.createEl('p', {
                text: 'To add events: create an event entity with a start date, then check the "add to timeline" checkbox.'
            });
            p2.style.setProperty('font-size', '12px');
            return;
        }

        // Create timeline wrapper
        const wrapper = this.timelineContainer.createDiv({ cls: 'graph_copilot-timeline-wrapper' });
        wrapper.style.setProperty('position', 'relative');
        wrapper.style.setProperty('min-height', '100%');
        wrapper.style.setProperty('padding-left', '200px');

        // Create the timeline line
        const line = wrapper.createDiv({ cls: 'graph_copilot-timeline-line' });
        line.style.setProperty('position', 'absolute');
        line.style.setProperty('left', '180px');
        line.style.setProperty('top', '0');
        line.style.setProperty('bottom', '0');
        line.style.setProperty('width', '4px');
        line.style.setProperty('background', 'var(--interactive-accent)');
        line.style.setProperty('border-radius', '2px');

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
        eventEl.style.setProperty('position', 'relative');
        eventEl.style.setProperty('margin-bottom', '30px');
        eventEl.style.setProperty('padding-left', '40px');

        // Event dot
        const dot = eventEl.createDiv({ cls: 'graph_copilot-timeline-dot' });
        dot.style.setProperty('position', 'absolute');
        dot.style.setProperty('left', '-12px');
        dot.style.setProperty('top', '5px');
        dot.style.setProperty('width', '20px');
        dot.style.setProperty('height', '20px');
        dot.style.setProperty('background', event.color);
        dot.style.setProperty('border-radius', '50%');
        dot.style.setProperty('border', '3px solid var(--background-primary)');
        dot.style.setProperty('box-shadow', `0 0 0 2px ${event.color}`);

        // Date label
        const dateLabel = eventEl.createDiv({ cls: 'graph_copilot-timeline-date' });
        dateLabel.style.setProperty('position', 'absolute');
        dateLabel.style.setProperty('left', '-180px');
        dateLabel.style.setProperty('top', '0');
        dateLabel.style.setProperty('width', '150px');
        dateLabel.style.setProperty('text-align', 'right');
        dateLabel.style.setProperty('font-size', '12px');
        dateLabel.style.setProperty('color', 'var(--text-muted)');
        dateLabel.textContent = this.formatDate(event.start);

        // Event card
        const card = eventEl.createDiv({ cls: 'graph_copilot-timeline-card' });
        card.style.setProperty('background', 'var(--background-secondary)');
        card.style.setProperty('border-left', `4px solid ${event.color}`);
        card.style.setProperty('padding', '15px');
        card.style.setProperty('border-radius', '0 8px 8px 0');
        card.style.setProperty('transition', 'transform 0.2s, box-shadow 0.2s');
        card.style.setProperty('cursor', 'pointer');

        // Card header with title and remove button
        const cardHeader = card.createDiv({ cls: 'graph_copilot-timeline-card-header' });
        cardHeader.style.setProperty('display', 'flex');
        cardHeader.style.setProperty('justify-content', 'space-between');
        cardHeader.style.setProperty('align-items', 'flex-start');
        cardHeader.style.setProperty('gap', '10px');

        // Event title
        const title = cardHeader.createEl('h4', { text: event.label });
        title.style.setProperty('margin', '0');
        title.style.setProperty('color', 'var(--text-normal)');
        title.style.setProperty('flex', '1');

        // Remove from Timeline button
        const removeBtn = cardHeader.createEl('button', {
            text: '✕ remove',
            cls: 'graph_copilot-timeline-remove-btn'
        });
        removeBtn.style.setProperty('background', 'transparent');
        removeBtn.style.setProperty('border', '1px solid var(--text-muted)');
        removeBtn.style.setProperty('color', 'var(--text-muted)');
        removeBtn.style.setProperty('padding', '2px 8px');
        removeBtn.style.setProperty('border-radius', '4px');
        removeBtn.style.setProperty('font-size', '11px');
        removeBtn.style.setProperty('cursor', 'pointer');
        removeBtn.style.setProperty('transition', 'all 0.2s');
        removeBtn.style.setProperty('white-space', 'nowrap');
        removeBtn.title = 'Remove from timeline';

        // Remove button hover effects
        removeBtn.onmouseenter = () => {
            removeBtn.style.setProperty('background', 'var(--background-modifier-error)');
            removeBtn.style.setProperty('border-color', 'var(--background-modifier-error)');
            removeBtn.style.setProperty('color', 'white');
        };
        removeBtn.onmouseleave = () => {
            removeBtn.style.setProperty('background', 'transparent');
            removeBtn.style.setProperty('border-color', 'var(--text-muted)');
            removeBtn.style.setProperty('color', 'var(--text-muted)');
        };

        // Remove button click handler
        removeBtn.onclick = async (e) => {
            e.stopPropagation(); // Prevent card click
            await this.toggleEventTimeline(event.id, false);
        };

        // Time range
        const timeRange = card.createDiv({ cls: 'graph_copilot-timeline-time' });
        timeRange.style.setProperty('font-size', '12px');
        timeRange.style.setProperty('color', 'var(--text-muted)');
        timeRange.style.setProperty('margin-top', '5px');

        let timeText = this.formatTime(event.start);
        if (event.end) {
            timeText += ` → ${this.formatTime(event.end)}`;
        }
        timeRange.textContent = timeText;

        // Hover effects for card
        card.onmouseenter = () => {
            card.style.setProperty('transform', 'translateX(5px)');
            card.style.setProperty('box-shadow', '0 4px 12px rgba(0,0,0,0.2)');
        };
        card.onmouseleave = () => {
            card.style.setProperty('transform', 'translateX(0)');
            card.style.setProperty('box-shadow', 'none');
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

