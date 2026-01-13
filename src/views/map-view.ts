
/**
 * Map View for visualizing Location entities using Leaflet.
 */

import { App, ItemView, WorkspaceLeaf, Notice, Modal, Menu } from 'obsidian';
import { Entity, EntityType, ENTITY_CONFIGS } from '../entities/types';
import { EntityManager } from '../services/entity-manager';
import { EntityCreationModal } from '../modals/entity-modal';
import { GeocodingService, GeocodingError } from '../services/geocoding-service';

// Leaflet types (simplified for bundling)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const L: any;

export const MAP_VIEW_TYPE = 'graph_copilot-map-view';

// Leaflet CSS inlined to avoid CSP issues with external stylesheets
// Leaflet CSS moved to styles.css

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private map: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        this.container.id = 'graph_copilot-map-' + Date.now();
        this.container.setCssProps({
            width: '100%',
            height: 'calc(100% - 50px)'
        });

        // Load Leaflet and initialize
        await this.loadLeaflet();
        this.initializeMap();

        // Wait for map to be ready before refreshing
        setTimeout(async () => {
            await this.refresh();
        }, 200);
    }

    async onClose(): Promise<void> {
        // Initialize handlers
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((this.map as any)._handlers) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this.map as any)._handlers.forEach((handler: any) => {
                handler.enable();
            });
        }
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

        // CSS is now loaded via styles.css

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
        toolbar.setCssProps({
            display: 'flex',
            gap: '10px',
            padding: '10px',
            background: 'var(--background-secondary)',
            'border-bottom': '1px solid var(--background-modifier-border)'
        });

        // Add Location button
        const addBtn = toolbar.createEl('button', { text: '+ add location' });
        addBtn.addClass('graph_copilot-add-entity-btn');
        addBtn.onclick = () => this.openLocationCreator();

        // Separator
        toolbar.createDiv({ cls: 'graph_copilot-toolbar-separator' });

        // Refresh button
        const refreshBtn = toolbar.createEl('button', { text: '↻ refresh' });
        refreshBtn.onclick = () => { this.refresh(); };

        // Fit all button
        const fitBtn = toolbar.createEl('button', { text: '⊡ fit all' });
        fitBtn.onclick = () => this.fitAllMarkers();

        // Geolocate button
        const geolocateBtn = toolbar.createEl('button', { text: '📍 geolocate missing' });
        geolocateBtn.onclick = () => this.showGeolocateMissingDialog();

        // Info label
        const infoSpan = toolbar.createEl('span', {
            text: 'Map shows all location entities with coordinates',
            cls: 'graph_copilot-map-info'
        });
        infoSpan.setCssProps({
            'margin-left': 'auto',
            color: 'var(--text-muted)',
            'font-size': '12px'
        });
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
            console.debug('OSM tiles failed, trying fallback...');
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
                    container.setCssProps({ 'background-image': 'url("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/4/5/8")' });
                } else if (layerName === 'Carto Light') {
                    // Carto Light tile (clean/grey)
                    container.setCssProps({ 'background-image': 'url("https://a.basemaps.cartocdn.com/light_all/5/15/12.png")' });
                } else {
                    // Default OSM tile (standard map colors)
                    container.setCssProps({ 'background-image': 'url("https://tile.openstreetmap.org/5/16/10.png")' });
                }
            }
        };

        // Listen for layer changes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                                void this.refresh();
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
        console.debug('[MapView] refresh() called, map exists:', !!this.map);
        if (!this.map) return;

        // Reload entities from notes to ensure we have the latest data
        try {
            await this.entityManager.loadEntitiesFromNotes();
            console.debug('[MapView] Entities reloaded from notes');
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
        console.debug('[MapView] Found Location and Address entities:', entities.length, entities);

        const locations = this.parseLocations(entities);
        console.debug('[MapView] Parsed locations with coordinates:', locations.length, locations);

        // Add markers
        locations.forEach(location => {
            console.debug('[MapView] Adding marker for:', location.label, 'at', location.lat, location.lng);
            this.addMarker(location);
        });

        console.debug('[MapView] Total markers added:', this.markers.size);

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
            console.debug('[MapView] Parsing entity:', entity.label, 'properties:', entity.properties);
            const lat = this.parseCoordinate(entity.properties.latitude as string | number | undefined);
            const lng = this.parseCoordinate(entity.properties.longitude as string | number | undefined);
            console.debug('[MapView] Parsed coordinates - lat:', lat, 'lng:', lng);

            if (lat !== null && lng !== null) {
                // Handle both Location and Address entity types
                const address = entity.type === 'Address'
                    ? ((entity.properties.street || entity.properties.full) as string)
                    : (entity.properties.address as string);

                locations.push({
                    id: entity.id,
                    label: entity.label,
                    lat,
                    lng,
                    address: address,
                    city: entity.properties.city as string,
                    country: entity.properties.country as string
                });
            } else {
                console.debug('[MapView] Skipping entity - missing coordinates');
            }
        }

        return locations;
    }

    /**
     * Parse a coordinate string to number.
     */
    private parseCoordinate(value: string | number | undefined): number | null {
        if (value === undefined || value === null || value === '') {
            console.debug('[MapView] parseCoordinate: value is empty/undefined:', value);
            return null;
        }

        const num = typeof value === 'number' ? value : parseFloat(value);
        if (isNaN(num)) {
            console.debug('[MapView] parseCoordinate: value is NaN:', value);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

        const lat = this.parseCoordinate(entity.properties.latitude as string | number | undefined);
        const lng = this.parseCoordinate(entity.properties.longitude as string | number | undefined);

        if (lat !== null && lng !== null) {
            this.addMarker({
                id: entity.id,
                label: entity.label,
                lat,
                lng,
                address: entity.properties.address as string,
                city: entity.properties.city as string,
                country: entity.properties.country as string
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
     * Highlight a specific location.
     */
    highlightLocation(entityId: string): void {
        const entity = this.entityManager.getEntity(entityId);
        if (!entity || !this.map) return;

        const marker = this.markers.get(entity.id);
        if (marker) {
            marker.openPopup();
            this.map.setView(marker.getLatLng(), 15);
        }
    }

    /**
     * Focus on a specific location.
     */
    focusLocation(entityId: string): void {
        console.debug('[MapView] focusLocation called for:', entityId);
        console.debug('[MapView] Available markers:', Array.from(this.markers.keys()));
        const marker = this.markers.get(entityId);
        if (marker && this.map) {
            console.debug('[MapView] Found marker, focusing...');
            this.map.setView(marker.getLatLng(), 15);
            marker.openPopup();
        } else {
            console.debug('[MapView] Marker not found for entity:', entityId);
        }
    }

    /**
     * Show dialog to geolocate locations without coordinates.
     */
    private showGeolocateMissingDialog(): void {
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
        listContainer.setCssProps({
            'max-height': '400px',
            'overflow-y': 'auto',
            margin: '20px 0'
        });

        this.locations.forEach(entity => {
            const item = listContainer.createDiv({ cls: 'geolocate-item' });
            item.setCssProps({
                padding: '10px',
                margin: '5px 0',
                border: '1px solid var(--background-modifier-border)',
                'border-radius': '4px',
                display: 'flex',
                'justify-content': 'space-between',
                'align-items': 'center'
            });

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
        buttonContainer.setCssProps({
            display: 'flex',
            'justify-content': 'flex-end',
            gap: '10px',
            'margin-top': '20px'
        });

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
            const updates: Record<string, unknown> = {
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
            btn.setCssProps({ color: 'var(--text-success)' });
            item.setCssProps({ 'border-color': 'var(--text-success)' });

        } catch (error) {
            btn.textContent = '✗ failed';
            btn.setCssProps({ color: 'var(--text-error)' });
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

                const updates: Record<string, unknown> = {
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

