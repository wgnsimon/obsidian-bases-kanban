import type { BasesEntry, TFile } from 'obsidian';
import { Menu, Notice } from 'obsidian';
import { CSS_CLASSES } from '../constants.ts';

export interface CardMenuCtx {
	/**
	 * Column value written when a card is marked done, in the casing the user
	 * configured. Null when no done column is configured or the board has no
	 * group-by property — the item is then omitted entirely.
	 */
	doneColumnValue: string | null;
}

export interface CardMenuCallbacks {
	onOpenInNewTab: (file: TFile) => void;
	onDuplicate: (file: TFile) => void;
	onMarkAsDone: (file: TFile, columnValue: string) => void;
	onDelete: (file: TFile) => void;
}

/**
 * One entry of the card context menu, kept independent of Obsidian's `Menu` so
 * the assembly can be asserted (and its handlers invoked) without a real menu.
 */
export interface CardMenuItem {
	title: string;
	icon: string;
	/** Draw a separator above this item. */
	separatorBefore?: boolean;
	warning?: boolean;
	onClick: () => void;
}

/**
 * The title the card actually shows. The rendered element wins so a configured
 * "Card title property" is copied instead of the file name.
 */
export function getCardTitle(entry: BasesEntry, cardEl: HTMLElement): string {
	const titleEl = cardEl.querySelector(`.${CSS_CLASSES.CARD_TITLE}`);
	const rendered = titleEl?.textContent?.trim();
	return rendered || entry.file.basename;
}

async function copyCardTitle(title: string): Promise<void> {
	// navigator.clipboard is absent on insecure origins and in some mobile webviews.
	const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
	if (!clipboard) {
		new Notice('Clipboard is not available.');
		return;
	}
	try {
		await clipboard.writeText(title);
		new Notice('Copied card title.');
	} catch (error) {
		console.error('Error copying card title:', error);
		new Notice('Could not copy card title.');
	}
}

export function buildCardMenuItems(
	entry: BasesEntry,
	cardEl: HTMLElement,
	ctx: CardMenuCtx,
	cb: CardMenuCallbacks,
): CardMenuItem[] {
	const file = entry.file;
	const items: CardMenuItem[] = [
		{ title: 'Open in new tab', icon: 'file-plus', onClick: () => cb.onOpenInNewTab(file) },
		{ title: 'Copy title', icon: 'copy', onClick: () => void copyCardTitle(getCardTitle(entry, cardEl)) },
		{ title: 'Duplicate', icon: 'files', onClick: () => cb.onDuplicate(file) },
	];

	const doneColumnValue = ctx.doneColumnValue;
	if (doneColumnValue) {
		items.push({ title: 'Mark as done', icon: 'check', onClick: () => cb.onMarkAsDone(file, doneColumnValue) });
	}

	items.push({
		title: 'Delete',
		icon: 'trash-2',
		separatorBefore: true,
		warning: true,
		onClick: () => cb.onDelete(file),
	});

	return items;
}

export function openCardMenu(
	event: MouseEvent,
	entry: BasesEntry,
	cardEl: HTMLElement,
	ctx: CardMenuCtx,
	cb: CardMenuCallbacks,
): Menu {
	const menu = new Menu();
	for (const item of buildCardMenuItems(entry, cardEl, ctx, cb)) {
		if (item.separatorBefore) menu.addSeparator();
		menu.addItem((menuItem) => {
			menuItem
				.setTitle(item.title)
				.setIcon(item.icon)
				.onClick(() => item.onClick());
			if (item.warning) menuItem.setWarning(true);
		});
	}
	menu.showAtMouseEvent(event);
	return menu;
}
