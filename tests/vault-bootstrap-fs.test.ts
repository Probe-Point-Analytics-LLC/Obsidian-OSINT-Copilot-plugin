import { describe, expect, it, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import { createFileIfMissing, ensureFolderExists } from '../src/utils/vault-bootstrap-fs';

function makeApp(options: {
    existing?: TFile | TFolder | null;
    createFolder?: () => Promise<void>;
    create?: () => Promise<void>;
    stat?: ((path: string) => Promise<{ type: 'file' | 'folder' } | null>) | undefined;
}) {
    return {
        vault: {
            getAbstractFileByPath: vi.fn().mockReturnValue(options.existing ?? null),
            createFolder: vi.fn(options.createFolder ?? (() => Promise.resolve())),
            create: vi.fn(options.create ?? (() => Promise.resolve())),
            adapter: { stat: options.stat },
        },
    } as any;
}

describe('vault bootstrap filesystem helpers', () => {
    it('treats an inconclusive stat as a benign already-existing folder race', async () => {
        const originalError = new Error('Folder already exists.');
        const app = makeApp({
            createFolder: () => Promise.reject(originalError),
            stat: vi.fn().mockResolvedValue(null),
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await expect(ensureFolderExists(app, 'OSINTCopilot')).resolves.toBeUndefined();
        expect(warn).not.toHaveBeenCalled();

        warn.mockRestore();
    });

    it('keeps already-existing races compatible with adapters that do not expose stat', async () => {
        const app = makeApp({
            createFolder: () => Promise.reject(new Error('Folder already exists.')),
            stat: undefined,
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await expect(ensureFolderExists(app, 'OSINTCopilot')).resolves.toBeUndefined();
        expect(warn).not.toHaveBeenCalled();

        warn.mockRestore();
    });

    it('warns only when stat positively reports the opposite type', async () => {
        const app = makeApp({
            createFolder: () => Promise.reject(new Error('Folder already exists.')),
            stat: vi.fn().mockResolvedValue({ type: 'file' }),
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await expect(ensureFolderExists(app, 'OSINTCopilot')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledOnce();

        warn.mockRestore();
    });

    it('does not overwrite a folder that occupies a requested file path', async () => {
        const folder = new TFolder();
        const app = makeApp({ existing: folder });

        await expect(createFileIfMissing(app, 'OSINTCopilot/config.md', 'content'))
            .rejects.toThrow('a folder already exists at that path');
        expect(app.vault.create).not.toHaveBeenCalled();
    });

    it('propagates create failures that are not already-exists races', async () => {
        const app = makeApp({
            createFolder: () => Promise.reject(new Error('Permission denied')),
            stat: vi.fn(),
        });

        await expect(ensureFolderExists(app, 'OSINTCopilot')).rejects.toThrow('Permission denied');
        expect(app.vault.adapter.stat).not.toHaveBeenCalled();
    });
});
