/**
 * Vault-wide lock for entity/connection markdown paths (graph "Lock area" + editor UX).
 * Paths are stored in plugin settings as sorted arrays for stable diffs.
 */

import { normalizePath, TAbstractFile } from 'obsidian';

export interface VaultLockPluginLike {
	settings: { lockedVaultPaths: string[] };
	saveSettings(): Promise<void>;
}

export class VaultLockService {
	private locked = new Set<string>();

	constructor(private plugin: VaultLockPluginLike) {}

	/** Call after loadSettings(). */
	initializeFromSettings(): void {
		const paths = this.plugin.settings.lockedVaultPaths ?? [];
		this.locked = new Set(paths.map((p) => normalizePath(p)));
	}

	isPathLocked(path: string | undefined | null): boolean {
		if (!path) return false;
		return this.locked.has(normalizePath(path));
	}

	/**
	 * Add paths to the lock set. Returns count of newly added paths.
	 */
	lockPaths(paths: (string | undefined | null)[]): number {
		let n = 0;
		for (const p of paths) {
			if (!p) continue;
			const np = normalizePath(p);
			if (!this.locked.has(np)) {
				this.locked.add(np);
				n++;
			}
		}
		if (n > 0) this.persist();
		return n;
	}

	unlockPath(path: string): void {
		const np = normalizePath(path);
		if (!this.locked.has(np)) return;
		this.locked.delete(np);
		this.persist();
	}

	unlockAll(): void {
		if (this.locked.size === 0) return;
		this.locked.clear();
		this.persist();
	}

	getLockedCount(): number {
		return this.locked.size;
	}

	getLockedPaths(): string[] {
		return Array.from(this.locked).sort();
	}

	/** Migrate lock entry when a file is renamed (same as Note Locker). */
	onVaultRename(_file: TAbstractFile, oldPath: string): void {
		const op = normalizePath(oldPath);
		if (!this.locked.has(op)) return;
		this.locked.delete(op);
		this.locked.add(normalizePath(_file.path));
		this.persist();
	}

	private persist(): void {
		this.plugin.settings.lockedVaultPaths = Array.from(this.locked).sort();
		void this.plugin.saveSettings();
	}
}
