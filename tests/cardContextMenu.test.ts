import assert from 'node:assert';
import { beforeEach, describe, test } from 'node:test';
import { CSS_CLASSES, DATA_ATTRIBUTES } from '../src/constants.ts';
import { KanbanView } from '../src/kanbanView.ts';
import {
	createEntriesWithCustomTitle,
	createEntriesWithStatus,
	PROPERTY_STATUS,
	PROPERTY_TITLE,
	TEST_PROPERTIES,
} from './fixtures.ts';
import {
	createDivWithMethods,
	createMockApp,
	createMockQueryController,
	createMockTFile,
	setupKanbanViewWithApp,
	setupTestEnvironment,
	triggerDataUpdate,
} from './helpers.ts';
import { Menu, type MenuItem } from './mocks/obsidian.ts';

setupTestEnvironment();

// Node exposes a read-only global `navigator`, so the clipboard stub has to be
// installed with defineProperty rather than plain assignment.
function stubClipboard(): { writes: string[]; restore: () => void } {
	const writes: string[] = [];
	const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		writable: true,
		value: {
			clipboard: {
				writeText: (text: string) => {
					writes.push(text);
					return Promise.resolve();
				},
			},
		},
	});
	return {
		writes,
		restore: () => {
			if (original) Object.defineProperty(globalThis, 'navigator', original);
			else delete (globalThis as any).navigator;
		},
	};
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function contextMenuEvent(): MouseEvent {
	return new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
}

function lastMenu(): Menu {
	const menu = Menu.menus[Menu.menus.length - 1];
	assert.ok(menu, 'a menu should have been opened');
	return menu;
}

function itemTitles(menu: Menu): string[] {
	return menu.items.map((item) => String(item.title));
}

function itemNamed(menu: Menu, title: string): MenuItem {
	const item = menu.items.find((candidate) => candidate.title === title);
	assert.ok(item, `menu should contain "${title}"`);
	return item;
}

interface Harness {
	view: any;
	app: any;
	cardFor: (path: string) => HTMLElement;
	rightClick: (el: HTMLElement) => MouseEvent;
}

function setupBoard(
	options: { entries?: any[]; properties?: any[]; doneColumn?: string | null; cardTitleProperty?: any } = {},
): Harness {
	Menu.menus.length = 0;

	const scrollEl = createDivWithMethods();
	const app = createMockApp() as any;
	// createMockApp() covers only what the older suites need; the context menu
	// reaches for vault.copy and fileManager.trashFile as well.
	app.vault.copyCalls = [] as Array<{ file: any; newPath: string }>;
	app.vault.copy = (file: any, newPath: string) => {
		app.vault.copyCalls.push({ file, newPath });
		return Promise.resolve(file);
	};
	app.vault.existingPaths = new Set<string>();
	app.vault.getAbstractFileByPath = (path: string) => (app.vault.existingPaths.has(path) ? createMockTFile(path) : null);
	app.fileManager.trashCalls = [] as any[];
	app.fileManager.trashFile = (file: any) => {
		app.fileManager.trashCalls.push(file);
		return Promise.resolve();
	};

	const controller = createMockQueryController(
		options.entries ?? createEntriesWithStatus(),
		options.properties ?? TEST_PROPERTIES,
	) as any;
	controller.app = app;
	controller.config.getAsPropertyId = (key: string) => {
		if (key === 'groupByProperty') return PROPERTY_STATUS;
		if (key === 'cardTitleProperty') return options.cardTitleProperty ?? null;
		return null;
	};
	if (options.doneColumn !== undefined && options.doneColumn !== null) {
		controller.config.set('doneColumn', options.doneColumn);
	}

	const view = new KanbanView(controller, scrollEl);
	setupKanbanViewWithApp(view, app);
	triggerDataUpdate(view);

	const cardFor = (path: string): HTMLElement => {
		const card = view.containerEl.querySelector(
			`.${CSS_CLASSES.CARD}[${DATA_ATTRIBUTES.ENTRY_PATH}="${path}"]`,
		) as HTMLElement | null;
		assert.ok(card, `card for ${path} should be rendered`);
		return card;
	};

	const rightClick = (el: HTMLElement): MouseEvent => {
		const evt = contextMenuEvent();
		el.dispatchEvent(evt);
		return evt;
	};

	return { view, app, cardFor, rightClick };
}

describe('Card context menu', () => {
	let clipboard: ReturnType<typeof stubClipboard>;

	beforeEach(() => {
		clipboard?.restore();
		clipboard = stubClipboard();
	});

	test('Right-clicking a card opens a menu with the expected items in order', () => {
		const { cardFor, rightClick } = setupBoard();

		const evt = rightClick(cardFor('Task 1.md'));

		const menu = lastMenu();
		assert.deepStrictEqual(itemTitles(menu), ['Open in new tab', 'Copy title', 'Duplicate', 'Delete']);
		assert.strictEqual(menu.entries[3], 'separator', 'a separator should precede Delete');
		assert.ok(menu.shown, 'menu should be shown at the mouse event');
		assert.strictEqual(menu.shownAtEvent, evt);
		assert.strictEqual(evt.defaultPrevented, true, 'the native context menu should be suppressed');
	});

	test('Delete is marked as a warning item', () => {
		const { cardFor, rightClick } = setupBoard();
		rightClick(cardFor('Task 1.md'));

		assert.strictEqual(itemNamed(lastMenu(), 'Delete').warning, true);
	});

	test('Right-clicking an anchor inside a card does not open the menu', () => {
		const { cardFor, rightClick } = setupBoard();
		const card = cardFor('Task 1.md');
		const anchor = document.createElement('a');
		anchor.className = 'internal-link';
		anchor.textContent = 'Linked note';
		card.appendChild(anchor);

		const evt = rightClick(anchor);

		assert.strictEqual(Menu.menus.length, 0, 'no menu should be opened from an anchor');
		assert.strictEqual(evt.defaultPrevented, false, 'the link keeps its native context menu');
	});

	test('Open in new tab opens the note in a focused new tab', () => {
		const { app, cardFor, rightClick } = setupBoard();
		rightClick(cardFor('Task 2.md'));

		itemNamed(lastMenu(), 'Open in new tab').click();

		assert.deepStrictEqual(app.workspace.getLeaf.calls, [['tab']]);
		assert.strictEqual(app.workspace.openFile.calls.length, 1);
		assert.strictEqual(app.workspace.openFile.calls[0][0].path, 'Task 2.md');
		assert.strictEqual(
			app.workspace.openFile.calls[0][1],
			undefined,
			'no { active: false } — this tab should be focused',
		);
	});

	test('Copy title copies the file name when no card title property is set', async () => {
		const { cardFor, rightClick } = setupBoard();
		rightClick(cardFor('Task 3.md'));

		itemNamed(lastMenu(), 'Copy title').click();
		await flush();

		assert.deepStrictEqual(clipboard.writes, ['Task 3']);
	});

	test('Copy title copies the rendered custom card title', async () => {
		const { cardFor, rightClick } = setupBoard({
			entries: createEntriesWithCustomTitle(),
			properties: [PROPERTY_STATUS, PROPERTY_TITLE],
			cardTitleProperty: PROPERTY_TITLE,
		});
		const card = cardFor('README.md');
		assert.strictEqual(card.querySelector(`.${CSS_CLASSES.CARD_TITLE}`)?.textContent, 'My Project');

		rightClick(card);
		itemNamed(lastMenu(), 'Copy title').click();
		await flush();

		assert.deepStrictEqual(clipboard.writes, ['My Project']);
	});

	test('Duplicate copies the note to the first free numbered path in the same folder', async () => {
		const entries = createEntriesWithStatus();
		(entries[0] as any).file = createMockTFile('Projects/Task 1.md');
		const { app, cardFor, rightClick } = setupBoard({ entries });
		app.vault.existingPaths.add('Projects/Task 1 1.md');
		app.vault.existingPaths.add('Projects/Task 1 2.md');

		rightClick(cardFor('Projects/Task 1.md'));
		itemNamed(lastMenu(), 'Duplicate').click();
		await flush();

		assert.strictEqual(app.vault.copyCalls.length, 1);
		assert.strictEqual(app.vault.copyCalls[0].file.path, 'Projects/Task 1.md');
		assert.strictEqual(app.vault.copyCalls[0].newPath, 'Projects/Task 1 3.md');
	});

	test('Duplicate of a vault-root note keeps it at the root', async () => {
		const { app, cardFor, rightClick } = setupBoard();

		rightClick(cardFor('Task 4.md'));
		itemNamed(lastMenu(), 'Duplicate').click();
		await flush();

		assert.strictEqual(app.vault.copyCalls[0].newPath, 'Task 4 1.md');
	});

	test('Delete trashes the card file via the file manager', async () => {
		const { app, cardFor, rightClick } = setupBoard();

		rightClick(cardFor('Task 5.md'));
		itemNamed(lastMenu(), 'Delete').click();
		await flush();

		assert.strictEqual(app.fileManager.trashCalls.length, 1);
		assert.strictEqual(app.fileManager.trashCalls[0].path, 'Task 5.md');
	});

	test('Mark as done writes the configured value with its original casing', async () => {
		const { app, cardFor, rightClick } = setupBoard({ doneColumn: 'DoNe , Archived' });

		rightClick(cardFor('Task 1.md'));
		const menu = lastMenu();
		assert.deepStrictEqual(itemTitles(menu), ['Open in new tab', 'Copy title', 'Duplicate', 'Mark as done', 'Delete']);

		itemNamed(menu, 'Mark as done').click();
		await flush();

		assert.strictEqual(app.fileManager.processFrontMatter.calls.length, 1);
		const [file, apply] = app.fileManager.processFrontMatter.calls[0];
		assert.strictEqual(file.path, 'Task 1.md');
		const frontmatter: Record<string, unknown> = {};
		apply(frontmatter);
		assert.deepStrictEqual(frontmatter, { status: 'DoNe' });
	});

	test('Mark as done is absent when no done column is configured', () => {
		const { cardFor, rightClick } = setupBoard();
		rightClick(cardFor('Task 1.md'));

		assert.ok(!itemTitles(lastMenu()).includes('Mark as done'));
	});

	test('Mark as done is absent when the done column is blank', () => {
		const { cardFor, rightClick } = setupBoard({ doneColumn: '  ,  ' });
		rightClick(cardFor('Task 1.md'));

		assert.ok(!itemTitles(lastMenu()).includes('Mark as done'));
	});
});
