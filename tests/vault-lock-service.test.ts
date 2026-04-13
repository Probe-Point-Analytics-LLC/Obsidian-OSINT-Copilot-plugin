import { describe, it, expect, vi } from 'vitest';
import { VaultLockService } from '../src/services/vault-lock-service';
import { TFile } from 'obsidian';

describe('VaultLockService', () => {
	it('locks paths and persists via plugin settings', async () => {
		const settings = { lockedVaultPaths: [] as string[] };
		const saveSettings = vi.fn(async () => {});
		const plugin = { settings, saveSettings };
		const svc = new VaultLockService(plugin);
		svc.initializeFromSettings();

		expect(svc.lockPaths(['a/x.md', 'b/y.md'])).toBe(2);
		expect(settings.lockedVaultPaths.sort()).toEqual(['a/x.md', 'b/y.md']);
		expect(saveSettings).toHaveBeenCalled();

		expect(svc.isPathLocked('a/x.md')).toBe(true);
		svc.unlockPath('a/x.md');
		expect(svc.isPathLocked('a/x.md')).toBe(false);
		expect(settings.lockedVaultPaths).toEqual(['b/y.md']);
	});

	it('migrates path on vault rename', async () => {
		const settings = { lockedVaultPaths: ['old/path.md'] };
		const saveSettings = vi.fn(async () => {});
		const svc = new VaultLockService({ settings, saveSettings });
		svc.initializeFromSettings();

		const file = { path: 'new/path.md' } as TFile;
		svc.onVaultRename(file, 'old/path.md');
		expect(settings.lockedVaultPaths).toEqual(['new/path.md']);
	});
});
