/**
 * Map View for visualizing Location entities using Leaflet.
 */

import { App, ItemView, WorkspaceLeaf, Notice, Modal, Menu } from 'obsidian';
import { Entity, EntityType, ENTITY_CONFIGS } from '../entities/types';
import { EntityManager } from '../services/entity-manager';
import { EntityCreationModal } from '../modals/entity-modal';
import { GeocodingService, GeocodingError } from '../services/geocoding-service';

// Leaflet types (simplified for bundling)
declare const L: any;

export const MAP_VIEW_TYPE = 'graph_copilot-map-view';

// Leaflet CSS inlined to avoid CSP issues with external stylesheets
const LEAFLET_CSS = `
/* Leaflet CSS v1.9.4 - Inlined for CSP compliance */
.leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile-container,.leaflet-pane>svg,.leaflet-pane>canvas,.leaflet-zoom-box,.leaflet-image-layer,.leaflet-layer{position:absolute;left:0;top:0}
.leaflet-container{overflow:hidden}
.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow{-webkit-user-select:none;-moz-user-select:none;user-select:none;-webkit-user-drag:none}
.leaflet-tile::selection{background:transparent}
.leaflet-safari .leaflet-tile{image-rendering:-webkit-optimize-contrast}
.leaflet-safari .leaflet-tile-container{width:1600px;height:1600px;-webkit-transform-origin:0 0}
.leaflet-marker-icon,.leaflet-marker-shadow{display:block}
.leaflet-container .leaflet-overlay-pane svg{max-width:none!important;max-height:none!important}
.leaflet-container .leaflet-marker-pane img,.leaflet-container .leaflet-shadow-pane img,.leaflet-container .leaflet-tile-pane img,.leaflet-container img.leaflet-image-layer,.leaflet-container .leaflet-tile{max-width:none!important;max-height:none!important;width:auto;padding:0}
.leaflet-container img.leaflet-tile{mix-blend-mode:plus-lighter}
.leaflet-container.leaflet-touch-zoom{-ms-touch-action:pan-x pan-y;touch-action:pan-x pan-y}
.leaflet-container.leaflet-touch-drag{-ms-touch-action:pinch-zoom;touch-action:none;touch-action:pinch-zoom}
.leaflet-container.leaflet-touch-drag.leaflet-touch-zoom{-ms-touch-action:none;touch-action:none}
.leaflet-container{-webkit-tap-highlight-color:transparent}
.leaflet-container a{-webkit-tap-highlight-color:rgba(51,181,229,.4)}
.leaflet-tile{filter:inherit;visibility:hidden}
.leaflet-tile-loaded{visibility:inherit}
.leaflet-zoom-box{width:0;height:0;-moz-box-sizing:border-box;box-sizing:border-box;z-index:800}
.leaflet-overlay-pane svg{-moz-user-select:none}
.leaflet-pane{z-index:400}
.leaflet-tile-pane{z-index:200}
.leaflet-overlay-pane{z-index:400}
.leaflet-shadow-pane{z-index:500}
.leaflet-marker-pane{z-index:600}
.leaflet-tooltip-pane{z-index:650}
.leaflet-popup-pane{z-index:700}
.leaflet-map-pane canvas{z-index:100}
.leaflet-map-pane svg{z-index:200}
.leaflet-vml-shape{width:1px;height:1px}
.lvml{behavior:url(#default#VML);display:inline-block;position:absolute}
.leaflet-control{position:relative;z-index:800;pointer-events:visiblePainted;pointer-events:auto}
.leaflet-top,.leaflet-bottom{position:absolute;z-index:1000;pointer-events:none}
.leaflet-top{top:0}
.leaflet-right{right:0}
.leaflet-bottom{bottom:0}
.leaflet-left{left:0}
.leaflet-control{float:left;clear:both}
.leaflet-right .leaflet-control{float:right}
.leaflet-top .leaflet-control{margin-top:10px}
.leaflet-bottom .leaflet-control{margin-bottom:10px}
.leaflet-left .leaflet-control{margin-left:10px}
.leaflet-right .leaflet-control{margin-right:10px}
.leaflet-fade-anim .leaflet-popup{opacity:0;-webkit-transition:opacity .2s linear;-moz-transition:opacity .2s linear;transition:opacity .2s linear}
.leaflet-fade-anim .leaflet-map-pane .leaflet-popup{opacity:1}
.leaflet-zoom-animated{-webkit-transform-origin:0 0;-ms-transform-origin:0 0;transform-origin:0 0}
svg.leaflet-zoom-animated{will-change:transform}
.leaflet-zoom-anim .leaflet-zoom-animated{-webkit-transition:-webkit-transform .25s cubic-bezier(0,0,.25,1);-moz-transition:-moz-transform .25s cubic-bezier(0,0,.25,1);transition:transform .25s cubic-bezier(0,0,.25,1)}
.leaflet-zoom-anim .leaflet-tile,.leaflet-pan-anim .leaflet-tile{-webkit-transition:none;-moz-transition:none;transition:none}
.leaflet-zoom-anim .leaflet-zoom-hide{visibility:hidden}
.leaflet-interactive{cursor:pointer}
.leaflet-grab{cursor:-webkit-grab;cursor:-moz-grab;cursor:grab}
.leaflet-crosshair,.leaflet-crosshair .leaflet-interactive{cursor:crosshair}
.leaflet-popup-pane,.leaflet-control{cursor:auto}
.leaflet-dragging .leaflet-grab,.leaflet-dragging .leaflet-grab .leaflet-interactive,.leaflet-dragging .leaflet-marker-draggable{cursor:move;cursor:-webkit-grabbing;cursor:-moz-grabbing;cursor:grabbing}
.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-image-layer,.leaflet-pane>svg path,.leaflet-tile-container{pointer-events:none}
.leaflet-marker-icon.leaflet-interactive,.leaflet-image-layer.leaflet-interactive,.leaflet-pane>svg path.leaflet-interactive,svg.leaflet-image-layer.leaflet-interactive path{pointer-events:visiblePainted;pointer-events:auto}
.leaflet-container{background:#ddd;outline-offset:1px}
.leaflet-container a{color:#0078A8}
.leaflet-zoom-box{border:2px dotted #38f;background:rgba(255,255,255,.5)}
.leaflet-container{font-family:"Helvetica Neue",Arial,Helvetica,sans-serif;font-size:12px;font-size:.75rem;line-height:1.5}
.leaflet-bar{box-shadow:0 1px 5px rgba(0,0,0,.65);border-radius:4px}
.leaflet-bar a{background-color:#fff;border-bottom:1px solid #ccc;width:26px;height:26px;line-height:26px;display:block;text-align:center;text-decoration:none;color:#000}
.leaflet-bar a,.leaflet-control-layers-toggle{background-position:50% 50%;background-repeat:no-repeat;display:block}
.leaflet-bar a:hover,.leaflet-bar a:focus{background-color:#f4f4f4}
.leaflet-bar a:first-child{border-top-left-radius:4px;border-top-right-radius:4px}
.leaflet-bar a:last-child{border-bottom-left-radius:4px;border-bottom-right-radius:4px;border-bottom:none}
.leaflet-bar a.leaflet-disabled{cursor:default;background-color:#f4f4f4;color:#bbb}
.leaflet-touch .leaflet-bar a{width:30px;height:30px;line-height:30px}
.leaflet-touch .leaflet-bar a:first-child{border-top-left-radius:2px;border-top-right-radius:2px}
.leaflet-touch .leaflet-bar a:last-child{border-bottom-left-radius:2px;border-bottom-right-radius:2px}
.leaflet-control-zoom-in,.leaflet-control-zoom-out{font:bold 18px 'Lucida Console',Monaco,monospace;text-indent:1px}
.leaflet-touch .leaflet-control-zoom-in,.leaflet-touch .leaflet-control-zoom-out{font-size:22px}
.leaflet-control-layers{box-shadow:0 1px 5px rgba(0,0,0,.4);background:#fff;border-radius:5px}
.leaflet-control-layers-toggle{width:36px;height:36px}
.leaflet-touch .leaflet-control-layers-toggle{width:44px;height:44px}
.leaflet-control-layers .leaflet-control-layers-list,.leaflet-control-layers-expanded .leaflet-control-layers-toggle{display:none}
.leaflet-control-layers-expanded .leaflet-control-layers-list{display:block;position:relative}
.leaflet-control-layers-expanded{padding:6px 10px 6px 6px;color:#333;background:#fff}
.leaflet-control-layers-scrollbar{overflow-y:scroll;overflow-x:hidden;padding-right:5px}
.leaflet-control-layers-selector{margin-top:2px;position:relative;top:1px}
.leaflet-control-layers label{display:block;font-size:13px;font-size:1.08333em}
.leaflet-control-layers-separator{height:0;border-top:1px solid #ddd;margin:5px -10px 5px -6px}
.leaflet-container .leaflet-control-attribution{background:#fff;background:rgba(255,255,255,.8);margin:0}
.leaflet-control-attribution,.leaflet-control-scale-line{padding:0 5px;color:#333;line-height:1.4}
.leaflet-control-attribution a{text-decoration:none}
.leaflet-control-attribution a:hover,.leaflet-control-attribution a:focus{text-decoration:underline}
.leaflet-attribution-flag{display:inline!important;vertical-align:baseline!important;width:1em;height:.6669em}
.leaflet-left .leaflet-control-scale{margin-left:5px}
.leaflet-bottom .leaflet-control-scale{margin-bottom:5px}
.leaflet-control-scale-line{border:2px solid #777;border-top:none;line-height:1.1;padding:2px 5px 1px;white-space:nowrap;-moz-box-sizing:border-box;box-sizing:border-box;background:rgba(255,255,255,.8);text-shadow:1px 1px #fff}
.leaflet-control-scale-line:not(:first-child){border-top:2px solid #777;border-bottom:none;margin-top:-2px}
.leaflet-control-scale-line:not(:first-child):not(:last-child){border-bottom:2px solid #777}
.leaflet-touch .leaflet-control-attribution,.leaflet-touch .leaflet-control-layers,.leaflet-touch .leaflet-bar{box-shadow:none}
.leaflet-touch .leaflet-control-layers,.leaflet-touch .leaflet-bar{border:2px solid rgba(0,0,0,.2);background-clip:padding-box}
.leaflet-popup{position:absolute;text-align:center;margin-bottom:20px}
.leaflet-popup-content-wrapper{padding:1px;text-align:left;border-radius:12px}
.leaflet-popup-content{margin:13px 24px 13px 20px;line-height:1.3;font-size:13px;font-size:1.08333em;min-height:1px}
.leaflet-popup-content p{margin:17px 0;margin:1.3em 0}
.leaflet-popup-tip-container{width:40px;height:20px;position:absolute;left:50%;margin-top:-1px;margin-left:-20px;overflow:hidden;pointer-events:none}
.leaflet-popup-tip{width:17px;height:17px;padding:1px;margin:-10px auto 0;pointer-events:auto;-webkit-transform:rotate(45deg);-moz-transform:rotate(45deg);-ms-transform:rotate(45deg);transform:rotate(45deg)}
.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#fff;color:#333;box-shadow:0 3px 14px rgba(0,0,0,.4)}
.leaflet-container a.leaflet-popup-close-button{position:absolute;top:0;right:0;border:none;text-align:center;width:24px;height:24px;font:16px/24px Tahoma,Verdana,sans-serif;color:#757575;text-decoration:none;background:transparent}
.leaflet-container a.leaflet-popup-close-button:hover,.leaflet-container a.leaflet-popup-close-button:focus{color:#585858}
.leaflet-popup-scrolled{overflow:auto}
.leaflet-oldie .leaflet-popup-content-wrapper{-ms-zoom:1}
.leaflet-oldie .leaflet-popup-tip{width:24px;margin:0 auto;-ms-filter:"progid:DXImageTransform.Microsoft.Matrix(M11=0.70710678, M12=0.70710678, M21=-0.70710678, M22=0.70710678)";filter:progid:DXImageTransform.Microsoft.Matrix(M11=0.70710678,M12=0.70710678,M21=-0.70710678,M22=0.70710678)}
.leaflet-oldie .leaflet-control-zoom,.leaflet-oldie .leaflet-control-layers,.leaflet-oldie .leaflet-popup-content-wrapper,.leaflet-oldie .leaflet-popup-tip{border:1px solid #999}
.leaflet-div-icon{background:#fff;border:1px solid #666}
.leaflet-tooltip{position:absolute;padding:6px;background-color:#fff;border:1px solid #fff;border-radius:3px;color:#222;white-space:nowrap;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.leaflet-tooltip.leaflet-interactive{cursor:pointer;pointer-events:auto}
.leaflet-tooltip-top:before,.leaflet-tooltip-bottom:before,.leaflet-tooltip-left:before,.leaflet-tooltip-right:before{position:absolute;pointer-events:none;border:6px solid transparent;background:transparent;content:""}
.leaflet-tooltip-bottom{margin-top:6px}
.leaflet-tooltip-top{margin-top:-6px}
.leaflet-tooltip-bottom:before,.leaflet-tooltip-top:before{left:50%;margin-left:-6px}
.leaflet-tooltip-top:before{bottom:0;margin-bottom:-12px;border-top-color:#fff}
.leaflet-tooltip-bottom:before{top:0;margin-top:-12px;margin-left:-6px;border-bottom-color:#fff}
.leaflet-tooltip-left{margin-left:-6px}
.leaflet-tooltip-right{margin-left:6px}
.leaflet-tooltip-left:before,.leaflet-tooltip-right:before{top:50%;margin-top:-6px}
.leaflet-tooltip-left:before{right:0;margin-right:-12px;border-left-color:#fff}
.leaflet-tooltip-right:before{left:0;margin-left:-12px;border-right-color:#fff}
@media print{.leaflet-control{-webkit-print-color-adjust:exact;print-color-adjust:exact}}

/* Custom Layer Control Styles */
.leaflet-control-layers-toggle {
    background-size: cover;
    border: 2px solid rgba(255,255,255,0.8);
    background-color: #fff;
    transition: background-image 0.2s ease;
}
.leaflet-retina .leaflet-control-layers-toggle {
    background-size: cover;
}
`;

interface MapLocation {
    id: string;
    label: string;
    lat: number;
    lng: number;
    address?: string;
    city?: string;
    country?: string;
}

export class MapView extends ItemView {
    private entityManager: EntityManager;
    private map: any = null;
    private markers: Map<string, any> = new Map();
    private container: HTMLElement | null = null;
    private onLocationClick: ((entityId: string) => void) | null = null;
    private geocodingService: GeocodingService;

    constructor(
        leaf: WorkspaceLeaf,
        entityManager: EntityManager,
        onLocationClick?: (entityId: string) => void
    ) {
        super(leaf);
        this.entityManager = entityManager;
        this.onLocationClick = onLocationClick || null;
        this.geocodingService = new GeocodingService();
    }

    getViewType(): string {
        return MAP_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'OSINTCopilot map';
    }

    getIcon(): string {
        return 'map-pin';
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('graph_copilot-map-container');

        // Create toolbar
        const toolbar = container.createDiv({ cls: 'graph_copilot-map-toolbar' });
        this.createToolbar(toolbar);

        // Create map container
        this.container = container.createDiv({ cls: 'graph_copilot-map-canvas' });
        this.container.id = 'graph_copilot-map-' + Date.now();
        this.container.style.cssText = `
            width: 100%;
            height: calc(100% - 50px);
        `;

        // Load Leaflet and initialize
        await this.loadLeaflet();
        this.initializeMap();

        // Wait for map to be ready before refreshing
        setTimeout(async () => {
            await this.refresh();
        }, 200);
    }

    async onClose(): Promise<void> {
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        this.markers.clear();
    }

    /**
     * Load Leaflet library and CSS.
     */
    private async loadLeaflet(): Promise<void> {
        // Check if already loaded
        if (typeof L !== 'undefined') return;

        // Inject CSS inline to avoid CSP issues with external stylesheets
        // Only inject if not already present
        if (!document.getElementById('leaflet-inline-css')) {
            // eslint-disable-next-line obsidianmd/no-forbidden-elements
            const style = document.createElement('style');
            style.id = 'leaflet-inline-css';
            style.textContent = LEAFLET_CSS;
            document.head.appendChild(style);
        }

        // Load JS from CDN (scripts are allowed by Obsidian's CSP)
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Leaflet'));
            document.head.appendChild(script);
        });
    }

    /**
     * Create the toolbar.
     */
    private createToolbar(toolbar: HTMLElement): void {
        toolbar.style.cssText = `
            display: flex;
            gap: 10px;
            padding: 10px;
            background: var(--background-secondary);
            border-bottom: 1px solid var(--background-modifier-border);
        `;

        // Add Location button
        const addBtn = toolbar.createEl('button', { text: '+ Add location' });
        addBtn.addClass('graph_copilot-add-entity-btn');
        addBtn.onclick = () => this.openLocationCreator();

        // Separator
        toolbar.createDiv({ cls: 'graph_copilot-toolbar-separator' });

        // Refresh button
        const refreshBtn = toolbar.createEl('button', { text: '↻ Refresh' });
        refreshBtn.onclick = () => { this.refresh(); };

        // Fit all button
        const fitBtn = toolbar.createEl('button', { text: '⊡ Fit all' });
        fitBtn.onclick = () => this.fitAllMarkers();

        // Geolocate button
        const geolocateBtn = toolbar.createEl('button', { text: '📍 Geolocate missing' });
        geolocateBtn.onclick = () => this.showGeolocateMissingDialog();

        // Info label
        toolbar.createEl('span', {
            text: 'Map shows all location entities with coordinates',
            cls: 'graph_copilot-map-info'
        }).style.cssText = 'margin-left: auto; color: var(--text-muted); font-size: 12px;';
    }

    /**
     * Open the location creation modal.
     */
    private openLocationCreator(): void {
        const modal = new EntityCreationModal(
            this.app,
            this.entityManager,
            EntityType.Location,
            (entityId) => {
                // Refresh the map after location creation
                this.refresh();
            }
        );
        modal.open();
    }

    /**
     * Initialize the Leaflet map.
     */
    private initializeMap(): void {
        if (!this.container || typeof L === 'undefined') return;

        // Create map centered on world view
        this.map = L.map(this.container.id, {
            center: [20, 0],
            zoom: 2,
            zoomControl: true
        });

        // Add tile layer with fallback providers for reliability
        // Primary: OpenStreetMap standard tiles (no API key required)
        const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
            crossOrigin: 'anonymous'
        });

        // Satellite Layer: Esri World Imagery
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            maxZoom: 19
        });

        // Fallback 2: Carto Positron (light theme, no API key required)
        const cartoLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20,
            crossOrigin: 'anonymous'
        });

        // Try primary layer first, with error handling for fallbacks
        osmLayer.on('tileerror', () => {
            console.log('OSM tiles failed, trying fallback...');
            if (!this.map.hasLayer(cartoLayer)) {
                osmLayer.remove();
                cartoLayer.addTo(this.map);
            }
        });

        osmLayer.addTo(this.map);

        // Add layer control for manual switching if needed
        const baseMaps = {
            "OpenStreetMap": osmLayer,
            "Satellite": satelliteLayer,
            "Carto Light": cartoLayer
        };
        L.control.layers(baseMaps).addTo(this.map);

        // Update layer control visual on change
        const updateLayerControl = (layerName: string) => {
            const container = this.container?.querySelector('.leaflet-control-layers-toggle') as HTMLElement;
            if (container) {
                // Use actual tiles as icons
                if (layerName === 'Satellite') {
                    // Esri Satellite tile (rich green/terrain)
                    container.style.backgroundImage = 'url("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/4/5/8")';
                } else if (layerName === 'Carto Light') {
                    // Carto Light tile (clean/grey)
                    container.style.backgroundImage = 'url("https://a.basemaps.cartocdn.com/light_all/5/15/12.png")';
                } else {
                    // Default OSM tile (standard map colors)
                    container.style.backgroundImage = 'url("https://tile.openstreetmap.org/5/16/10.png")';
                }
            }
        };

        // Listen for layer changes
        this.map.on('baselayerchange', (e: any) => {
            updateLayerControl(e.name);
        });

        // Set initial state (OSM is default)
        setTimeout(() => updateLayerControl('OpenStreetMap'), 100);

        // Fix map size after container is visible
        setTimeout(() => {
            this.map?.invalidateSize();
        }, 100);

        // Add context menu for the map
        this.map.on('contextmenu', (e: any) => {
            const menu = new Menu();

            menu.addItem((item) => {
                item
                    .setTitle('Create location here')
                    .setIcon('map-pin')
                    .onClick(() => {
                        const modal = new EntityCreationModal(
                            this.app,
                            this.entityManager,
                            EntityType.Location,
                            (entityId) => {
                                this.refresh();
                            },
                            {
                                latitude: e.latlng.lat,
                                longitude: e.latlng.lng
                            }
                        );
                        modal.open();
                    });
            });



            menu.showAtPosition({ x: e.originalEvent.clientX, y: e.originalEvent.clientY });
        });
    }

    /**
     * Refresh the map with current data.
     */
    async refresh(): Promise<void> {
        console.log('[MapView] refresh() called, map exists:', !!this.map);
        if (!this.map) return;

        // Reload entities from notes to ensure we have the latest data
        try {
            await this.entityManager.loadEntitiesFromNotes();
            console.log('[MapView] Entities reloaded from notes');
        } catch (error) {
            console.error('[MapView] Failed to reload entities:', error);
        }

        // Clear existing markers
        this.markers.forEach(marker => marker.remove());
        this.markers.clear();

        // Get all Location and Address entities with coordinates
        const locationEntities = this.entityManager.getEntitiesByType(EntityType.Location);
        const addressEntities = this.entityManager.getAllEntities().filter(e => e.type === 'Address');
        const entities = [...locationEntities, ...addressEntities];
        console.log('[MapView] Found Location and Address entities:', entities.length, entities);

        const locations = this.parseLocations(entities);
        console.log('[MapView] Parsed locations with coordinates:', locations.length, locations);

        // Add markers
        locations.forEach(location => {
            console.log('[MapView] Adding marker for:', location.label, 'at', location.lat, location.lng);
            this.addMarker(location);
        });

        console.log('[MapView] Total markers added:', this.markers.size);

        // Fit bounds if we have markers
        if (locations.length > 0) {
            this.fitAllMarkers();
        }
    }

    /**
     * Parse entities into map locations.
     */
    private parseLocations(entities: Entity[]): MapLocation[] {
        const locations: MapLocation[] = [];

        for (const entity of entities) {
            console.log('[MapView] Parsing entity:', entity.label, 'properties:', entity.properties);
            const lat = this.parseCoordinate(entity.properties.latitude);
            const lng = this.parseCoordinate(entity.properties.longitude);
            console.log('[MapView] Parsed coordinates - lat:', lat, 'lng:', lng);

            if (lat !== null && lng !== null) {
                // Handle both Location and Address entity types
                const address = entity.type === 'Address'
                    ? (entity.properties.street || entity.properties.full)
                    : entity.properties.address;

                locations.push({
                    id: entity.id,
                    label: entity.label,
                    lat,
                    lng,
                    address: address,
                    city: entity.properties.city,
                    country: entity.properties.country
                });
            } else {
                console.log('[MapView] Skipping entity - missing coordinates');
            }
        }

        return locations;
    }

    /**
     * Parse a coordinate string to number.
     */
    private parseCoordinate(value: string | number | undefined): number | null {
        if (value === undefined || value === null || value === '') {
            console.log('[MapView] parseCoordinate: value is empty/undefined:', value);
            return null;
        }

        const num = typeof value === 'number' ? value : parseFloat(value);
        if (isNaN(num)) {
            console.log('[MapView] parseCoordinate: value is NaN:', value);
            return null;
        }

        return num;
    }

    /**
     * Add a marker to the map.
     */
    private addMarker(location: MapLocation): void {
        if (!this.map || typeof L === 'undefined') return;

        const color = ENTITY_CONFIGS[EntityType.Location].color;

        // Create custom icon
        const icon = L.divIcon({
            className: 'graph_copilot-map-marker',
            html: `<div style="
                background: ${color};
                width: 24px;
                height: 24px;
                border-radius: 50% 50% 50% 0;
                transform: rotate(-45deg);
                border: 2px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            "></div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 24],
            popupAnchor: [0, -24]
        });

        // Create marker
        const marker = L.marker([location.lat, location.lng], { icon })
            .addTo(this.map);

        // Create popup content
        const popupContent = this.createPopupContent(location);
        marker.bindPopup(popupContent);

        // Click handler
        marker.on('click', () => {
            if (this.onLocationClick) {
                this.onLocationClick(location.id);
            }
        });

        // Context menu handler
        marker.on('contextmenu', (e: any) => {
            const menu = new Menu();

            menu.addItem((item) => {
                item
                    .setTitle('Open note')
                    .setIcon('file-text')
                    .onClick(() => {
                        this.entityManager.openEntityNote(location.id);
                    });
            });

            menu.addItem((item) => {
                item
                    .setTitle('Edit')
                    .setIcon('pencil')
                    .onClick(() => {
                        const entity = this.entityManager.getEntity(location.id);
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

            menu.addItem((item) => {
                item
                    .setTitle('Focus')
                    .setIcon('crosshair')
                    .onClick(() => {
                        this.map.setView(marker.getLatLng(), 16);
                    });
            });

            menu.showAtPosition({ x: e.originalEvent.clientX, y: e.originalEvent.clientY });

            // Prevent map context menu from firing
            L.DomEvent.stopPropagation(e);
        });


        // Double-click to open note
        marker.on('dblclick', () => {
            this.entityManager.openEntityNote(location.id);
        });

        this.markers.set(location.id, marker);
    }

    /**
     * Create popup content for a location.
     */
    private createPopupContent(location: MapLocation): string {
        let content = `<div style="min-width: 150px;">`;
        content += `<strong>${location.label}</strong>`;

        if (location.address) {
            content += `<br><small>${location.address}</small>`;
        }
        if (location.city || location.country) {
            const parts = [location.city, location.country].filter(Boolean);
            content += `<br><small>${parts.join(', ')}</small>`;
        }

        content += `<br><small style="color: #888;">
            ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}
        </small>`;
        content += `<br><a href="#" onclick="return false;" style="font-size: 11px;">
            Double-click to open note
        </a>`;
        content += `</div>`;

        return content;
    }

    /**
     * Fit the map to show all markers.
     */
    fitAllMarkers(): void {
        if (!this.map || this.markers.size === 0) return;

        const bounds = L.latLngBounds([]);
        this.markers.forEach(marker => {
            bounds.extend(marker.getLatLng());
        });

        this.map.fitBounds(bounds, { padding: [50, 50] });
    }

    /**
     * Add a location to the map.
     */
    addLocation(entity: Entity): void {
        if (entity.type !== EntityType.Location) return;

        const lat = this.parseCoordinate(entity.properties.latitude);
        const lng = this.parseCoordinate(entity.properties.longitude);

        if (lat !== null && lng !== null) {
            this.addMarker({
                id: entity.id,
                label: entity.label,
                lat,
                lng,
                address: entity.properties.address,
                city: entity.properties.city,
                country: entity.properties.country
            });
        }
    }

    /**
     * Remove a location from the map.
     */
    removeLocation(entityId: string): void {
        const marker = this.markers.get(entityId);
        if (marker) {
            marker.remove();
            this.markers.delete(entityId);
        }
    }

    /**
     * Focus on a specific location.
     */
    focusLocation(entityId: string): void {
        console.log('[MapView] focusLocation called for:', entityId);
        console.log('[MapView] Available markers:', Array.from(this.markers.keys()));
        const marker = this.markers.get(entityId);
        if (marker && this.map) {
            console.log('[MapView] Found marker, focusing...');
            this.map.setView(marker.getLatLng(), 15);
            marker.openPopup();
        } else {
            console.log('[MapView] Marker not found for entity:', entityId);
        }
    }

    /**
     * Show dialog to geolocate locations without coordinates.
     */
    private async showGeolocateMissingDialog(): Promise<void> {
        // Get all Location and Address entities
        const allEntities = this.entityManager.getAllEntities();
        const locationsWithoutCoords = allEntities.filter(entity => {
            const isLocationOrAddress = entity.type === EntityType.Location || entity.type === 'Address';
            const hasNoCoords = !entity.properties.latitude || !entity.properties.longitude;
            const hasAddress = entity.properties.address || entity.properties.street ||
                entity.properties.full || entity.properties.city || entity.properties.country;
            return isLocationOrAddress && hasNoCoords && hasAddress;
        });

        if (locationsWithoutCoords.length === 0) {
            new Notice('No locations found that need geocoding');
            return;
        }

        // Create a simple modal to show the list
        const modal = new GeolocateMissingModal(
            this.app,
            locationsWithoutCoords,
            this.geocodingService,
            this.entityManager,
            async () => {
                // Refresh the map after geocoding
                await this.refresh();
            }
        );
        modal.open();
    }
}

/**
 * Modal to show and geolocate locations without coordinates.
 */
class GeolocateMissingModal extends Modal {
    private locations: Entity[];
    private geocodingService: GeocodingService;
    private entityManager: EntityManager;
    private onComplete: () => Promise<void>;

    constructor(
        app: App,
        locations: Entity[],
        geocodingService: GeocodingService,
        entityManager: EntityManager,
        onComplete: () => Promise<void>
    ) {
        super(app);
        this.locations = locations;
        this.geocodingService = geocodingService;
        this.entityManager = entityManager;
        this.onComplete = onComplete;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Geolocate locations' });
        contentEl.createEl('p', {
            text: `Found ${this.locations.length} location(s) without coordinates that can be geocoded.`
        });

        // Create a list of locations
        const listContainer = contentEl.createDiv({ cls: 'geolocate-list' });
        listContainer.style.cssText = `
            max-height: 400px;
            overflow-y: auto;
            margin: 20px 0;
        `;

        this.locations.forEach(entity => {
            const item = listContainer.createDiv({ cls: 'geolocate-item' });
            item.style.cssText = `
                padding: 10px;
                margin: 5px 0;
                border: 1px solid var(--background-modifier-border);
                border-radius: 4px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            `;

            const info = item.createDiv();
            info.createEl('strong', { text: entity.label });
            info.createEl('br');

            const address = entity.properties.address || entity.properties.street ||
                entity.properties.full || entity.properties.city || entity.properties.country;
            info.createEl('small', {
                text: String(address),
                cls: 'text-muted'
            });

            const btn = item.createEl('button', { text: '📍 geolocate' });
            btn.onclick = async () => {
                btn.disabled = true;
                btn.textContent = 'Geocoding...';
                await this.geolocateEntity(entity, btn, item);
            };
        });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;';

        const geolocateAllBtn = buttonContainer.createEl('button', { text: 'Geolocate all' });
        geolocateAllBtn.onclick = async () => {
            geolocateAllBtn.disabled = true;
            await this.geolocateAll();
            geolocateAllBtn.disabled = false;
        };

        const closeBtn = buttonContainer.createEl('button', { text: 'Close' });
        closeBtn.onclick = () => this.close();
    }

    private async geolocateEntity(entity: Entity, btn: HTMLButtonElement, item: HTMLElement): Promise<void> {
        try {
            // Extract address components
            let address: string | undefined;
            let city: string | undefined;
            let state: string | undefined;
            let country: string | undefined;

            if (entity.type === EntityType.Location) {
                address = entity.properties.address as string;
                city = entity.properties.city as string;
                country = entity.properties.country as string;
            } else if (entity.type === 'Address') {
                address = entity.properties.street as string || entity.properties.full as string;
                city = entity.properties.city as string;
                state = entity.properties.state as string;
                country = entity.properties.country as string;
            }

            const result = await this.geocodingService.geocodeAddressWithRetry(
                address,
                city,
                state,
                country,
                (attempt, maxAttempts, delaySeconds) => {
                    new Notice(`Network error, retrying in ${delaySeconds}s... (attempt ${attempt}/${maxAttempts})`);
                }
            );

            // Update entity
            const updates: Record<string, any> = {
                latitude: result.latitude,
                longitude: result.longitude
            };

            if (result.city && !city) updates.city = result.city;
            if (result.state && !state && entity.type === 'Address') updates.state = result.state;
            if (result.country && !country) updates.country = result.country;
            if (result.postalCode && entity.type === 'Address' && !entity.properties.postalCode) {
                updates.postalCode = result.postalCode;
            }

            await this.entityManager.updateEntity(entity.id, updates);

            // Update UI
            btn.textContent = '✓ done';
            btn.style.color = 'var(--text-success)';
            item.style.borderColor = 'var(--text-success)';

        } catch (error) {
            btn.textContent = '✗ failed';
            btn.style.color = 'var(--text-error)';
            if (error instanceof GeocodingError) {
                new Notice(`Failed to geocode ${entity.label}: ${error.message}`);
            } else {
                new Notice(`Failed to geocode ${entity.label}`);
            }
            btn.disabled = false;
        }
    }

    private async geolocateAll(): Promise<void> {
        let success = 0;
        let failed = 0;

        for (const entity of this.locations) {
            try {
                let address: string | undefined;
                let city: string | undefined;
                let state: string | undefined;
                let country: string | undefined;

                if (entity.type === EntityType.Location) {
                    address = entity.properties.address as string;
                    city = entity.properties.city as string;
                    country = entity.properties.country as string;
                } else if (entity.type === 'Address') {
                    address = entity.properties.street as string || entity.properties.full as string;
                    city = entity.properties.city as string;
                    state = entity.properties.state as string;
                    country = entity.properties.country as string;
                }

                const result = await this.geocodingService.geocodeAddressWithRetry(
                    address,
                    city,
                    state,
                    country,
                    (attempt, maxAttempts, delaySeconds) => {
                        new Notice(`Network error, retrying in ${delaySeconds}s... (attempt ${attempt}/${maxAttempts})`);
                    }
                );

                const updates: Record<string, any> = {
                    latitude: result.latitude,
                    longitude: result.longitude
                };

                if (result.city && !city) updates.city = result.city;
                if (result.state && !state && entity.type === 'Address') updates.state = result.state;
                if (result.country && !country) updates.country = result.country;
                if (result.postalCode && entity.type === 'Address' && !entity.properties.postalCode) {
                    updates.postalCode = result.postalCode;
                }

                await this.entityManager.updateEntity(entity.id, updates);
                success++;

            } catch (error) {
                console.error(`Failed to geocode ${entity.label}:`, error);
                failed++;
            }
        }

        new Notice(`Geocoded ${success} location(s). ${failed} failed.`);
        await this.onComplete();
        this.close();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

