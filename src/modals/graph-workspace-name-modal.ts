import { App, Modal, Notice, Setting, TextComponent } from 'obsidian';

/**
 * Ask for a graph workspace name (Electron has no window.prompt).
 */
export class GraphWorkspaceNameModal extends Modal {
	private textInput: TextComponent | undefined;

	constructor(
		app: App,
		private readonly onCreate: (name: string) => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'New graph workspace' });
		contentEl.createEl('p', {
			text: 'Each workspace saves its own node layout in the vault.',
			cls: 'setting-item-description',
		});

		new Setting(contentEl).setName('Name').addText((text) => {
			this.textInput = text;
			text.setPlaceholder('My investigation graph');
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('Create')
					.setCta()
					.onClick(() => {
						void this.handleCreate();
					}),
			)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()));
	}

	private async handleCreate(): Promise<void> {
		const name = this.textInput?.getValue().trim() ?? '';
		if (!name) {
			new Notice('Enter a name for the graph workspace.');
			return;
		}
		await Promise.resolve(this.onCreate(name));
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
