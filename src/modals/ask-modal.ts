import { App, Modal, Notice, TFile } from "obsidian";
import type { IndexedNote } from "../chat/indexed-note";

export interface AskVaultHost {
	askVault(query: string): Promise<{ answer: string; notes: IndexedNote[] }>;
}

export class AskModal extends Modal {
	private host: AskVaultHost;
	queryInput!: HTMLTextAreaElement;
	answerContainer!: HTMLDivElement;
	notesContainer!: HTMLDivElement;

	constructor(app: App, host: AskVaultHost) {
		super(app);
		this.host = host;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("vault-ai-modal");

		contentEl.createEl("h2", { text: "Ask your vault" });

		contentEl.createEl("label", { text: "Your question:" });
		this.queryInput = contentEl.createEl("textarea", {
			placeholder: "What would you like to know?",
		});

		const buttonContainer = contentEl.createDiv();
		const askButton = buttonContainer.createEl("button", { text: "Ask" });
		askButton.addEventListener("click", () => {
			void this.handleAsk();
		});

		const closeButton = buttonContainer.createEl("button", { text: "Close" });
		closeButton.addEventListener("click", () => this.close());

		this.answerContainer = contentEl.createDiv("vault-ai-answer");
		this.answerContainer.setCssProps({ display: "none" });

		this.notesContainer = contentEl.createDiv("vault-ai-notes-list");
		this.notesContainer.setCssProps({ display: "none" });
	}

	async handleAsk() {
		const query = this.queryInput.value.trim();
		if (!query) {
			new Notice("Please enter a question.");
			return;
		}

		this.answerContainer.empty();
		this.answerContainer.createEl("p", { text: "Thinking..." });
		this.answerContainer.setCssProps({ display: "block" });

		try {
			const result = await this.host.askVault(query);

			this.answerContainer.innerHTML = "";
			const answerPre = this.answerContainer.createEl("pre");
			answerPre.setText(result.answer);

			const copyButton = this.answerContainer.createEl("button", {
				text: "Copy answer",
			});
			copyButton.addEventListener("click", () => {
				void navigator.clipboard.writeText(result.answer);
				new Notice("Answer copied to clipboard.");
			});

			if (result.notes.length > 0) {
				this.notesContainer.innerHTML = "";
				this.notesContainer.createEl("h3", { text: "Matching notes:" });

				for (const note of result.notes) {
					const noteItem = this.notesContainer.createDiv("vault-ai-note-item");
					noteItem.textContent = note.path;
					noteItem.addEventListener("click", () => {
						void (async () => {
							const file = this.app.vault.getAbstractFileByPath(note.path);
							if (file instanceof TFile) {
								await this.app.workspace.getLeaf().openFile(file);
								this.close();
							}
						})();
					});
				}

				this.notesContainer.setCssProps({ display: "block" });
			}
		} catch (error) {
			this.answerContainer.empty();
			const errorP = this.answerContainer.createEl("p", {
				text: `Error: ${error instanceof Error ? error.message : String(error)}`,
			});
			errorP.setCssProps({ color: "var(--text-error)" });
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
