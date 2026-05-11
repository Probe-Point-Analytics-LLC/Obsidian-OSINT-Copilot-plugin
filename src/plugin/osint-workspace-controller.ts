import { Notice, WorkspaceLeaf } from 'obsidian';
import { EntityType } from '../entities/types';
import { GraphView, GRAPH_VIEW_TYPE } from '../views/graph-view';
import { TimelineView, TIMELINE_VIEW_TYPE } from '../views/timeline-view';
import { MapView, MAP_VIEW_TYPE } from '../views/map-view';
import { CHAT_VIEW_TYPE } from '../views/chat-view';
import { TOOLS_SKILLS_REGISTRY_VIEW_TYPE } from '../views/tools-skills-registry-view';
import { entityHasMapCoordinates } from '../ui/vault-op-previews';
import type VaultAIPlugin from './vault-ai-plugin';

/** OSINT pane placement: main leaf, graph/timeline/map/chat/tools views. */
export class OsintWorkspaceController {
  constructor(private readonly plugin: VaultAIPlugin) {}

  private async getMainEditorLeaf(_viewType: string, _forceNew: boolean): Promise<WorkspaceLeaf | null> {
    const osintViewTypes = [GRAPH_VIEW_TYPE, TIMELINE_VIEW_TYPE, MAP_VIEW_TYPE, CHAT_VIEW_TYPE, TOOLS_SKILLS_REGISTRY_VIEW_TYPE];

    const mainLeaves: WorkspaceLeaf[] = [];
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      const root = leaf.getRoot();
      if (root === this.plugin.app.workspace.rootSplit) {
        mainLeaves.push(leaf);
      }
    });

    const existingOsintLeaves = mainLeaves.filter((leaf) =>
      osintViewTypes.includes(leaf.view?.getViewType() || ''),
    );

    const noteEditorLeaves = mainLeaves.filter((leaf) =>
      leaf.view?.getViewType() === 'markdown' || leaf.view?.getViewType() === 'empty',
    );

    if (existingOsintLeaves.length > 0) {
      const activeLeaf = this.plugin.app.workspace.activeLeaf;
      let anchor = existingOsintLeaves[0];
      if (
        activeLeaf &&
        mainLeaves.includes(activeLeaf) &&
        osintViewTypes.includes(activeLeaf.view?.getViewType() || '')
      ) {
        anchor = activeLeaf;
      }
      try {
        return await this.plugin.app.workspace.duplicateLeaf(anchor, 'tab');
      } catch (e) {
        console.warn('[VaultAIPlugin] duplicateLeaf(tab) failed; falling back to new root tab', e);
        return this.plugin.app.workspace.getLeaf('tab');
      }
    }

    if (noteEditorLeaves.length > 0) {
      return noteEditorLeaves[0];
    }

    return this.plugin.app.workspace.getLeaf('tab');
  }
  /**
   * Open the Graph View in the main editor area.
   * @param forceNew If true, opens another instance as a new tab next to existing OSINT tabs when possible.
   */
  async openGraphView(forceNew: boolean = false) {
    if (!this.plugin.settings.enableGraphFeatures) {
      new Notice('Graph features are disabled. Enable them in settings → osint copilot → enable graph features', 5000);
      console.warn('[VaultAIPlugin] Attempted to open graph view but graph features are disabled');
      return;
    }

    console.debug('[VaultAIPlugin] Opening graph view, forceNew:', forceNew);
    const existing = this.plugin.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);

    // If not forcing new and one exists, reveal it
    if (!forceNew && existing.length > 0) {
      void this.plugin.app.workspace.revealLeaf(existing[0]);
      return existing[0];
    }

    const leaf = await this.getMainEditorLeaf(GRAPH_VIEW_TYPE, forceNew);

    if (leaf) {
      await leaf.setViewState({ type: GRAPH_VIEW_TYPE, active: true });
      void this.plugin.app.workspace.revealLeaf(leaf);
      return leaf;
    }
    return null;
  }

  /**
   * Open the graph view and focus on a specific entity.
   * This is used by clickable links in chat to navigate to entities in the graph.
   */
  async openGraphViewWithEntity(entityId: string) {
    const leaf = await this.openGraphView();
    if (leaf) {
      // Wait a bit for the graph to render, then highlight the entity
      setTimeout(() => {
        const graphView = leaf.view as GraphView;
        if (graphView && typeof graphView.highlightEntity === 'function') {
          graphView.highlightEntity(entityId);
        }
      }, 300);
    }
  }

  /**
   * Refresh the graph view if it's currently open.
   * This is called after entity creation operations complete.
   */
  async refreshGraphView(options?: { silent?: boolean }) {
    const existing = this.plugin.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);
    if (existing.length > 0) {
      const graphView = existing[0].view as GraphView;
      if (graphView && typeof graphView.refreshWithSavedPositions === 'function') {
        console.debug('[OSINT Copilot] Refreshing graph view with new entities...');
        await graphView.refreshWithSavedPositions();
        if (!options?.silent) {
          new Notice('Graph view updated with new entities');
        }
      }
    }
  }

  /**
   * Reload open Graph, Timeline, and Map views from the vault (after graph writes).
   * Timeline may also refresh from its own vault listeners; this ensures consistency when those views are open.
   * @param options.skipGraph — when true, do not refresh graph leaves (e.g. graph was just refreshed by {@link refreshOrOpenGraphView}).
   */
  async refreshOpenInsightViews(options?: { skipGraph?: boolean }): Promise<void> {
    if (!this.plugin.settings.enableGraphFeatures) {
      return;
    }
    if (!options?.skipGraph) {
      for (const leaf of this.plugin.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE)) {
        const graphView = leaf.view as GraphView;
        if (graphView && typeof graphView.refreshWithSavedPositions === 'function') {
          await graphView.refreshWithSavedPositions();
        }
      }
    }
    for (const leaf of this.plugin.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE)) {
      const timelineView = leaf.view as TimelineView;
      if (timelineView && typeof timelineView.refresh === 'function') {
        await timelineView.refresh();
      }
    }
    for (const leaf of this.plugin.app.workspace.getLeavesOfType(MAP_VIEW_TYPE)) {
      const mapView = leaf.view as MapView;
      if (mapView && typeof mapView.refresh === 'function') {
        void mapView.refresh();
      }
    }
  }

  /**
   * Refresh or open the graph view after entity creation.
   * Respects user settings for auto-refresh and auto-open.
   */
  async refreshOrOpenGraphView() {
    if (!this.plugin.settings.enableGraphFeatures) {
      return;
    }

    const existing = this.plugin.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);

    if (existing.length > 0) {
      // Graph is already open - refresh it if auto-refresh is enabled
      if (this.plugin.settings.autoRefreshGraph) {
        await this.refreshGraphView();
      }
    } else {
      // Graph is not open - open it if auto-open is enabled
      if (this.plugin.settings.autoOpenGraphOnEntityCreation) {
        console.debug('[OSINT Copilot] Auto-opening graph view with new entities...');
        await this.openGraphView();
        new Notice('Graph view opened with new entities');
      }
    }
  }

  /**
   * Open the Timeline View in the main editor area.
   * @param forceNew If true, opens another instance as a new tab next to existing OSINT tabs when possible.
   */
  async openTimelineView(forceNew: boolean = false) {
    const existing = this.plugin.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);

    // If not forcing new and one exists, reveal it
    if (!forceNew && existing.length > 0) {
      void this.plugin.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = await this.getMainEditorLeaf(TIMELINE_VIEW_TYPE, forceNew);

    if (leaf) {
      await leaf.setViewState({ type: TIMELINE_VIEW_TYPE, active: true });
      void this.plugin.app.workspace.revealLeaf(leaf);
    }
  }

  /**
   * Open the Map View in the main editor area.
   * @param forceNew If true, opens another instance as a new tab next to existing OSINT tabs when possible.
   */
  async openMapView(forceNew: boolean = false) {
    const existing = this.plugin.app.workspace.getLeavesOfType(MAP_VIEW_TYPE);

    // If not forcing new and one exists, reveal it
    if (!forceNew && existing.length > 0) {
      void this.plugin.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = await this.getMainEditorLeaf(MAP_VIEW_TYPE, forceNew);

    if (leaf) {
      await leaf.setViewState({ type: MAP_VIEW_TYPE, active: true });
      void this.plugin.app.workspace.revealLeaf(leaf);
    }
  }

  /**
   * Open the tools / skills / enrichers registry in the main editor area.
   */
  async openToolsSkillsRegistryView(forceNew: boolean = false) {
    const existing = this.plugin.app.workspace.getLeavesOfType(TOOLS_SKILLS_REGISTRY_VIEW_TYPE);

    if (!forceNew && existing.length > 0) {
      void this.plugin.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = await this.getMainEditorLeaf(TOOLS_SKILLS_REGISTRY_VIEW_TYPE, forceNew);

    if (leaf) {
      await leaf.setViewState({ type: TOOLS_SKILLS_REGISTRY_VIEW_TYPE, active: true });
      void this.plugin.app.workspace.revealLeaf(leaf);
    }
  }

  async showEntityOnMap(entityId: string) {
    const entity = this.plugin.entityManager.getEntity(entityId);
    if (!entity) {
      new Notice('Entity not found');
      return;
    }

    const mapCapable =
      entity.type === EntityType.Location ||
      entity.type === 'Address' ||
      entityHasMapCoordinates(entity);

    if (!mapCapable) {
      new Notice('Map needs a Location or Address entity, or latitude/longitude on the entity.');
      return;
    }

    if (!entityHasMapCoordinates(entity)) {
      new Notice('Entity has no coordinates. Add latitude and longitude (e.g. in frontmatter) to show it on the map.');
      return;
    }

    // Open or reveal the map view
    await this.openMapView();

    // Wait a bit for the map to initialize, then focus on the location
    setTimeout(() => {
      const mapLeaves = this.plugin.app.workspace.getLeavesOfType(MAP_VIEW_TYPE);
      if (mapLeaves.length > 0) {
        const mapView = mapLeaves[0].view as MapView;
        if (mapView && typeof mapView.focusLocation === 'function') {
          // Refresh the map first to ensure the marker exists
          void mapView.refresh();
          // Then focus on the location
          setTimeout(() => {
            mapView.focusLocation(entityId);
          }, 200);
        }
      }
    }, 300);
  }
  /**
   * Open the Chat View in the main editor area.
   * @param forceNew If true, opens another instance as a new tab next to existing OSINT tabs when possible.
   */
  async openChatView(forceNew: boolean = false) {
    const existing = this.plugin.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);

    // If not forcing new and one exists, reveal it
    if (!forceNew && existing.length > 0) {
      await this.plugin.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = await this.getMainEditorLeaf(CHAT_VIEW_TYPE, forceNew);

    if (leaf) {
      await leaf.setViewState({
        type: CHAT_VIEW_TYPE,
        active: true,
      });
      await this.plugin.app.workspace.revealLeaf(leaf);
    }
  }

}
