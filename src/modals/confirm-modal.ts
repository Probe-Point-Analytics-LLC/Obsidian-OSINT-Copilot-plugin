import { App, Modal, Setting } from 'obsidian';

export interface CheckboxItem {
    label: string;
    value: string;
    checked?: boolean;
}

export class ConfirmModal extends Modal {
    private title: string;
    private message: string;
    private onConfirm: (selectedValues?: string[]) => void;
    private onCancel: (() => void) | undefined;
    private destructive: boolean;
    private checkboxItems?: CheckboxItem[];

    constructor(
        app: App,
        title: string,
        message: string,
        onConfirm: (selectedValues?: string[]) => void,
        onCancel?: () => void,
        destructive: boolean = false,
        checkboxItems?: CheckboxItem[]
    ) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
        this.destructive = destructive;
        this.checkboxItems = checkboxItems;
    }

    onOpen() {
        const { contentEl, containerEl } = this;
        contentEl.addClass('vault-ai-confirm-modal');

        // Prevent closing when clicking outside the modal
        const modalBg = containerEl.querySelector('.modal-bg');
        if (modalBg) {
            modalBg.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        }

        contentEl.createEl('h2', { text: this.title });
        contentEl.createDiv({ text: this.message, cls: 'vault-ai-confirm-message' });

        const selectedValues = new Set<string>();

        if (this.checkboxItems && this.checkboxItems.length > 0) {
            const checkboxContainer = contentEl.createDiv({ cls: 'vault-ai-confirm-checkboxes' });
            checkboxContainer.style.maxHeight = '300px';
            checkboxContainer.style.overflowY = 'auto';
            checkboxContainer.style.marginBottom = '20px';
            checkboxContainer.style.padding = '10px';
            checkboxContainer.style.border = '1px solid var(--background-modifier-border)';
            checkboxContainer.style.borderRadius = '4px';

            for (const item of this.checkboxItems) {
                if (item.checked !== false) {
                    selectedValues.add(item.value);
                }

                const labelEl = checkboxContainer.createEl('label', { cls: 'vault-ai-checkbox-label' });
                labelEl.style.display = 'flex';
                labelEl.style.alignItems = 'flex-start'; // Align top in case of wrapping
                labelEl.style.marginBottom = '8px';
                labelEl.style.cursor = 'pointer';

                const cb = labelEl.createEl('input');
                cb.type = 'checkbox';
                cb.value = item.value;
                cb.checked = item.checked !== false; // Default to true unless explicitly false
                cb.style.marginRight = '8px';
                cb.style.marginTop = '4px'; // Better vertical alignment for multi-line

                // Use markdown-style parsing for bold syntax using a helper
                const textContainer = labelEl.createSpan();
                this.renderMarkdownText(textContainer, item.label);

                cb.addEventListener('change', (e) => {
                    const target = e.target as HTMLInputElement;
                    if (target.checked) {
                        selectedValues.add(item.value);
                    } else {
                        selectedValues.delete(item.value);
                    }
                });
            }
        }

        const buttonContainer = contentEl.createDiv({ cls: 'graph_copilot-confirm-buttons' });

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => {
            if (this.onCancel) this.onCancel();
            this.close();
        });

        const confirmButton = buttonContainer.createEl('button', {
            text: 'Confirm',
            cls: this.destructive ? 'mod-warning graph_copilot-confirm-btn--danger' : 'mod-cta'
        });

        confirmButton.addEventListener('click', () => {
            this.onConfirm(this.checkboxItems && this.checkboxItems.length > 0 ? Array.from(selectedValues) : undefined);
            this.close();
        });

        // Focus confirm button for easy keyboard usage
        setTimeout(() => confirmButton.focus(), 50);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private renderMarkdownText(container: HTMLElement, text: string) {
        // Simple markdown parser for **bold** text
        const parts = text.split(/(\*\*.*?\*\*)/g);
        for (const part of parts) {
            if (part.startsWith('**') && part.endsWith('**')) {
                const boldText = part.substring(2, part.length - 2);
                container.createEl('strong', { text: boldText });
            } else if (part) {
                container.appendChild(document.createTextNode(part));
            }
        }
    }
}
