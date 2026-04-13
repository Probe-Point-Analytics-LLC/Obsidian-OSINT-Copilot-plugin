import { App, Modal, Setting } from 'obsidian';

/**
 * Confirm unlocking a vault-protected OSINT entity/connection note (Note Locker–style).
 */
export class VaultUnlockModal extends Modal {
	constructor(
		app: App,
		private readonly onUnlock: () => void,
		private readonly titleText: string = 'Locked note',
		private readonly message: string =
			'This note is locked from the OSINT graph. Unlocking allows editing and agent changes.',
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.titleText });
		contentEl.createEl('p', { text: this.message });
		contentEl.createEl('p', { text: 'Are you sure you want to unlock?' });
		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText('Unlock')
				.setCta()
				.onClick(() => {
					this.onUnlock();
					this.close();
				}),
		).addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
