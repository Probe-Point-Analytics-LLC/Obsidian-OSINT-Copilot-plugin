import { vi } from 'vitest';

// Obsidian mock is handled via alias in vitest.config.ts pointing to tests/obsidian-mock.ts

// Mock D3
vi.mock('d3', () => ({
    select: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    data: vi.fn().mockReturnThis(),
    enter: vi.fn().mockReturnThis(),
    append: vi.fn().mockReturnThis(),
    attr: vi.fn().mockReturnThis(),
    style: vi.fn().mockReturnThis(),
    text: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    call: vi.fn().mockReturnThis(),
    transition: vi.fn().mockReturnThis(),
    duration: vi.fn().mockReturnThis(),
    remove: vi.fn().mockReturnThis(),
    forceSimulation: vi.fn().mockReturnValue({
        force: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        stop: vi.fn(),
        alpha: vi.fn().mockReturnThis(),
        restart: vi.fn(),
    }),
    forceLink: vi.fn().mockReturnThis(),
    forceManyBody: vi.fn().mockReturnThis(),
    forceCenter: vi.fn().mockReturnThis(),
    forceX: vi.fn().mockReturnThis(),
    forceY: vi.fn().mockReturnThis(),
    drag: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
    }),
    zoom: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        scaleExtent: vi.fn().mockReturnThis(),
    }),
}));

// Mock window properties if needed
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'ResizeObserver', {
        writable: true,
        value: vi.fn().mockImplementation(() => ({
            observe: vi.fn(),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
        })),
    });
}

// Extend HTMLElement prototype to match Obsidian's API
if (typeof HTMLElement !== 'undefined') {
    (HTMLElement.prototype as any).createDiv = function (o?: any) {
        const div = document.createElement('div');
        if (o?.cls) div.classList.add(o.cls);
        this.appendChild(div);
        return div;
    };
    (HTMLElement.prototype as any).createEl = function (tag: string, o?: any) {
        const el = document.createElement(tag);
        if (o?.cls) el.classList.add(o.cls);
        if (o?.text) el.textContent = o.text;
        this.appendChild(el);
        return el;
    };
    (HTMLElement.prototype as any).addClass = function (cls: string) {
        this.classList.add(cls);
    };
    (HTMLElement.prototype as any).empty = function () {
        while (this.firstChild) {
            this.removeChild(this.firstChild);
        }
    };
}
