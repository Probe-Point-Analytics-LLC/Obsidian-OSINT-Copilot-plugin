import { vi } from 'vitest';

export class App {
    workspace: any;
    vault: any;
    metadataCache: any;

    constructor() {
        this.workspace = {
            getLeavesOfType: vi.fn().mockReturnValue([]),
            revealLeaf: vi.fn(),
            getLeaf: vi.fn().mockReturnValue({
                setViewState: vi.fn().mockResolvedValue(undefined),
                view: {
                    containerEl: document.createElement('div'),
                }
            }),
        };
        this.vault = {
            adapter: {
                exists: vi.fn().mockResolvedValue(true),
                read: vi.fn().mockResolvedValue(''),
                write: vi.fn().mockResolvedValue(undefined),
            },
            getAbstractFileByPath: vi.fn(),
        };
        this.metadataCache = {
            getFileCache: vi.fn().mockReturnValue({}),
        };
    }
}

export class Plugin {
    app: App;
    manifest: any;
    settings: any;

    constructor(app: App, manifest: any) {
        this.app = app;
        this.manifest = manifest;
    }
    loadData = vi.fn().mockResolvedValue({});
    saveData = vi.fn().mockResolvedValue(undefined);
    addRibbonIcon = vi.fn();
    addStatusBarItem = vi.fn().mockReturnValue({ setText: vi.fn() });
    addCommand = vi.fn();
    addSettingTab = vi.fn();
    registerView = vi.fn();
}

export class PluginSettingTab {
    constructor(app: App, plugin: Plugin) { }
    display() { }
    hide() { }
}

export class Setting {
    constructor(containerEl: HTMLElement) { }
    setName = vi.fn().mockReturnThis();
    setDesc = vi.fn().mockReturnThis();
    addText = vi.fn().mockReturnThis();
    addToggle = vi.fn().mockReturnThis();
    addTextArea = vi.fn().mockReturnThis();
    addDropdown = vi.fn().mockReturnThis();
    addButton = vi.fn().mockReturnThis();
}

export class Notice {
    constructor(message: string, duration?: number) { }
}

export class ItemView {
    contentEl: HTMLElement;
    containerEl: HTMLElement;

    constructor(leaf: WorkspaceLeaf) {
        this.containerEl = document.createElement('div');
        this.contentEl = document.createElement('div');
        this.containerEl.appendChild(this.contentEl);
    }
    getViewType() { return ''; }
    getDisplayText() { return ''; }
    getIcon() { return ''; }
    onOpen() { return Promise.resolve(); }
    onClose() { return Promise.resolve(); }
    addAction() { }
}

export class WorkspaceLeaf {
    view: any;
    constructor() { }
    openFile = vi.fn();
}

export class TFile {
    path: string;
    basename: string;
    constructor() {
        this.path = '';
        this.basename = '';
    }
}

export const requestUrl = vi.fn();

export const MarkdownRenderer = {
    renderMarkdown: vi.fn(),
};

export class Menu {
    addItem = vi.fn().mockReturnThis();
    showAtMouseEvent = vi.fn();
    showAtPosition = vi.fn();
}

export class Component {
    load() { }
    onload() { }
    unload() { }
    onunload() { }
    addChild() { }
    removeChild() { }
}

export class ButtonComponent {
    buttonEl: HTMLButtonElement;
    constructor(containerEl: HTMLElement) {
        this.buttonEl = document.createElement('button');
        containerEl.appendChild(this.buttonEl);
    }
    setButtonText = vi.fn().mockReturnThis();
    setCta = vi.fn().mockReturnThis();
    onClick = vi.fn().mockReturnThis();
    setDisabled = vi.fn().mockReturnThis();
}

export class Modal {
    constructor(app: App) { }
    open() { }
    close() { }
}

export class Editor {
    constructor() { }
}

export class MarkdownView extends ItemView {
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }
}
