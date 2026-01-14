import { App, Modal, Setting } from 'obsidian';

export class ConfirmModal extends Modal {
    private title: string;
    private message: string;
    private onConfirm: () => void;
    private onCancel: (() => void) | undefined;
    private destructive: boolean;

    constructor(
        app: App,
        title: string,
        message: string,
        onConfirm: () => void,
        onCancel?: () => void,
        destructive: boolean = false
    ) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
        this.destructive = destructive;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('vault-ai-confirm-modal');

        contentEl.createEl('h2', { text: this.title });
        contentEl.createDiv({ text: this.message, cls: 'vault-ai-confirm-message' });

        const buttonContainer = contentEl.createDiv({ cls: 'vault-ai-confirm-buttons' });
        buttonContainer.setCssProps({
            marginTop: '20px',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px'
        });

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => {
            if (this.onCancel) this.onCancel();
            this.close();
        });

        const confirmButton = buttonContainer.createEl('button', {
            text: 'Confirm',
            cls: this.destructive ? 'mod-warning' : 'mod-cta'
        });

        if (this.destructive) {
            confirmButton.setCssProps({
                backgroundColor: 'var(--text-error)',
                color: 'var(--text-on-accent)'
            });
        }

        confirmButton.addEventListener('click', () => {
            this.onConfirm();
            this.close();
        });

        // Focus confirm button for easy keyboard usage
        setTimeout(() => confirmButton.focus(), 50);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
