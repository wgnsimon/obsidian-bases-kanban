import type { App } from 'obsidian';
import { Modal, TextComponent } from 'obsidian';
import { CSS_CLASSES } from './constants.ts';

/**
 * What the card's title actually is, which decides what a rename writes to:
 * the note's file name, or the value of the configured "Card title property".
 */
export type RenameTarget = 'file' | 'property';

/** Characters Obsidian does not accept in a file name. */
const ILLEGAL_FILE_NAME_CHARS = /[\\/:*?"<>|]/;

/**
 * Validate a new title before anything is written. Returns the message to show
 * the user, or null when the title is acceptable.
 *
 * Only checks what can be decided from the string itself — a name collision
 * needs vault access and is reported by the submit handler instead.
 */
export function validateNewTitle(title: string, target: RenameTarget): string | null {
	if (!title.trim()) return 'The title cannot be empty.';
	if (target === 'file' && ILLEGAL_FILE_NAME_CHARS.test(title)) {
		return 'A file name cannot contain any of: \\ / : * ? " < > |';
	}
	return null;
}

export interface RenameModalOptions {
	currentTitle: string;
	target: RenameTarget;
	/**
	 * Performs the rename. Resolves to an error message to show in the modal —
	 * so the user can correct the name instead of starting over — or null when
	 * the rename succeeded and the modal should close.
	 */
	onSubmit: (title: string) => Promise<string | null>;
}

export class RenameModal extends Modal {
	private input: TextComponent | null = null;
	private errorEl: HTMLElement | null = null;
	private submitting = false;

	constructor(
		app: App,
		private readonly options: RenameModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.options.target === 'file' ? 'Rename note' : 'Rename card');

		const formEl = this.contentEl.createEl('form', { cls: CSS_CLASSES.RENAME_FORM });
		this.input = new TextComponent(formEl);
		this.input.setValue(this.options.currentTitle);
		this.input.inputEl.classList.add(CSS_CLASSES.RENAME_INPUT);

		// Stays in the DOM and is hidden by CSS while empty, so showing a message
		// never reflows the buttons out from under the pointer.
		this.errorEl = formEl.createDiv({ cls: CSS_CLASSES.RENAME_ERROR });

		const actionsEl = formEl.createDiv({ cls: CSS_CLASSES.RENAME_ACTIONS });
		const cancelBtn = actionsEl.createEl('button', {
			text: 'Cancel',
			attr: { type: 'button' },
		});
		const submitBtn = actionsEl.createEl('button', {
			text: 'Rename',
			cls: 'mod-cta',
			attr: { type: 'submit' },
		});

		cancelBtn.addEventListener('click', () => this.close());
		formEl.addEventListener('submit', (evt) => {
			evt.preventDefault();
			void this.submit(submitBtn);
		});

		// Select the current title so typing replaces it, but keep it visible so
		// small edits (a typo, an added word) stay easy.
		window.requestAnimationFrame(() => {
			this.input?.inputEl.focus();
			this.input?.inputEl.select();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		this.input = null;
		this.errorEl = null;
		this.submitting = false;
	}

	private showError(message: string): void {
		if (!this.errorEl) return;
		this.errorEl.textContent = message;
		this.input?.inputEl.focus();
	}

	private async submit(submitBtn: HTMLButtonElement): Promise<void> {
		if (this.submitting) return;

		const title = this.input?.getValue().trim() ?? '';
		const validationError = validateNewTitle(title, this.options.target);
		if (validationError) {
			this.showError(validationError);
			return;
		}

		this.submitting = true;
		submitBtn.disabled = true;
		try {
			const error = await this.options.onSubmit(title);
			if (error) {
				this.showError(error);
				return;
			}
			this.close();
		} finally {
			this.submitting = false;
			submitBtn.disabled = false;
		}
	}
}
