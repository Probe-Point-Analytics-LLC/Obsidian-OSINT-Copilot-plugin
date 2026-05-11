import { App, Modal } from "obsidian";

export class RenameConversationModal extends Modal {
	private currentTitle: string;
	private onSubmit: (newTitle: string) => void;
	private inputEl!: HTMLInputElement;

	constructor(app: App, currentTitle: string, onSubmit: (newTitle: string) => void) {
		super(app);
		this.currentTitle = currentTitle;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("vault-ai-modal");

		contentEl.createEl("h3", { text: "Rename conversation" });

		const inputContainer = contentEl.createDiv({ cls: "vault-ai-rename-input-container" });
		inputContainer.createEl("label", { text: "New title:" });
		this.inputEl = inputContainer.createEl("input", {
			type: "text",
			value: this.currentTitle,
			cls: "vault-ai-rename-input",
		});
		this.inputEl.setCssProps({
			width: "100%",
			"margin-top": "8px",
			padding: "8px",
		});

		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			} else if (e.key === "Escape") {
				this.close();
			}
		});

		const buttonContainer = contentEl.createDiv({ cls: "vault-ai-rename-buttons" });
		buttonContainer.setCssProps({
			"margin-top": "16px",
			display: "flex",
			"justify-content": "flex-end",
			gap: "8px",
		});

		const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const saveBtn = buttonContainer.createEl("button", { text: "Save", cls: "mod-cta" });
		saveBtn.addEventListener("click", () => this.submit());

		setTimeout(() => {
			this.inputEl.focus();
			this.inputEl.select();
		}, 10);
	}

	private submit() {
		const newTitle = this.inputEl.value.trim();
		if (newTitle && newTitle !== this.currentTitle) {
			this.onSubmit(newTitle);
		}
		this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
