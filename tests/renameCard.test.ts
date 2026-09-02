import assert from 'node:assert';
import { beforeEach, describe, test } from 'node:test';
import type { BasesPropertyId } from 'obsidian';
import { CSS_CLASSES, DATA_ATTRIBUTES } from '../src/constants.ts';
import { KanbanView } from '../src/kanbanView.ts';
import { validateNewTitle } from '../src/renameModal.ts';
import { createEntriesWithCustomTitle, createEntriesWithStatus, PROPERTY_STATUS, PROPERTY_TITLE } from './fixtures.ts';
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

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Harness {
	view: any;
	app: any;
	controller: any;
	/** Right-clicks the card and clicks "Rename"; returns the opened modal's parts. */
	openRename: (path: string) => { form: HTMLFormElement; input: HTMLInputElement };
	submit: (form: HTMLFormElement, title: string) => Promise<void>;
	errorText: () => string;
	modalIsOpen: () => boolean;
}

function setupBoard(
	options: {
		entries?: any[];
		properties?: BasesPropertyId[];
		cardTitleProperty?: BasesPropertyId | null;
		existingPaths?: string[];
		cardOrders?: Record<string, Record<string, string[]>>;
	} = {},
): Harness {
	Menu.menus.length = 0;
	document.querySelectorAll('.modal-container').forEach((el) => el.remove());

	const scrollEl = createDivWithMethods();
	const app = createMockApp() as any;
	const existing = new Set(options.existingPaths ?? []);
	app.vault.getAbstractFileByPath = (path: string) => (existing.has(path) ? createMockTFile(path) : null);

	const controller = createMockQueryController(
		options.entries ?? createEntriesWithStatus(),
		options.properties ?? [PROPERTY_STATUS, PROPERTY_TITLE],
	) as any;
	controller.app = app;
	controller.config.getAsPropertyId = (key: string) => {
		if (key === 'groupByProperty') return PROPERTY_STATUS;
		if (key === 'cardTitleProperty') return options.cardTitleProperty ?? null;
		return null;
	};
	if (options.cardOrders) controller.config.set('cardOrders', options.cardOrders);

	const view = new KanbanView(controller, scrollEl);
	setupKanbanViewWithApp(view, app);
	triggerDataUpdate(view);

	const openRename = (path: string) => {
		const card = view.containerEl.querySelector(
			`.${CSS_CLASSES.CARD}[${DATA_ATTRIBUTES.ENTRY_PATH}="${path}"]`,
		) as HTMLElement | null;
		assert.ok(card, `card for ${path} should be rendered`);
		card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		const menu = Menu.menus[Menu.menus.length - 1];
		assert.ok(menu, 'a context menu should have opened');
		const item = menu.items.find((candidate: MenuItem) => candidate.title === 'Rename');
		assert.ok(item, 'the menu should contain "Rename"');
		item.click();

		const form = document.querySelector(`.${CSS_CLASSES.RENAME_FORM}`) as HTMLFormElement | null;
		assert.ok(form, 'the rename modal should be open');
		const input = form.querySelector('input') as HTMLInputElement;
		return { form, input };
	};

	const submit = async (form: HTMLFormElement, title: string): Promise<void> => {
		const input = form.querySelector('input') as HTMLInputElement;
		input.value = title;
		form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
		await flush();
	};

	const errorText = (): string => document.querySelector(`.${CSS_CLASSES.RENAME_ERROR}`)?.textContent ?? '';
	const modalIsOpen = (): boolean => !!document.querySelector(`.${CSS_CLASSES.RENAME_FORM}`);

	return { view, app, controller, openRename, submit, errorText, modalIsOpen };
}

describe('validateNewTitle', () => {
	test('rejects an empty or whitespace-only title', () => {
		assert.strictEqual(validateNewTitle('', 'file'), 'The title cannot be empty.');
		assert.strictEqual(validateNewTitle('   ', 'property'), 'The title cannot be empty.');
	});

	test('rejects characters a file name cannot contain', () => {
		for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
			assert.ok(validateNewTitle(bad, 'file'), `"${bad}" should be rejected for a file rename`);
		}
	});

	test('allows those characters when writing a title property', () => {
		// Only a file name is constrained by the file system; a property value is not.
		assert.strictEqual(validateNewTitle('Reading: part 2 / draft', 'property'), null);
	});

	test('accepts an ordinary title', () => {
		assert.strictEqual(validateNewTitle('Weekly review', 'file'), null);
	});
});

describe('Rename card', () => {
	beforeEach(() => {
		document.querySelectorAll('.modal-container').forEach((el) => el.remove());
	});

	test('the modal is prefilled with the file name when no title property is set', () => {
		const h = setupBoard();
		const { input } = h.openRename('Task 1.md');
		assert.strictEqual(input.value, 'Task 1');
	});

	test('renaming writes a new path in the same folder, keeping the extension', async () => {
		const entries = [createEntriesWithStatus()[0]];
		entries[0] = { ...entries[0], file: createMockTFile('Projects/Task 1.md') } as any;
		const h = setupBoard({ entries });

		const { form } = h.openRename('Projects/Task 1.md');
		await h.submit(form, 'Weekly review');

		assert.strictEqual(h.app.fileManager.renameFile.calls.length, 1);
		const [file, newPath] = h.app.fileManager.renameFile.calls[0];
		assert.strictEqual(file.path, 'Projects/Task 1.md');
		assert.strictEqual(newPath, 'Projects/Weekly review.md');
		assert.strictEqual(h.modalIsOpen(), false, 'the modal should close on success');
	});

	test('an existing note at the target path is reported without renaming', async () => {
		const h = setupBoard({ existingPaths: ['Taken.md'] });

		const { form } = h.openRename('Task 1.md');
		await h.submit(form, 'Taken');

		assert.strictEqual(h.app.fileManager.renameFile.calls.length, 0, 'nothing should be renamed');
		assert.match(h.errorText(), /already exists/i);
		assert.strictEqual(h.modalIsOpen(), true, 'the modal stays open so the name can be corrected');
	});

	test('an illegal file name is reported without renaming', async () => {
		const h = setupBoard();

		const { form } = h.openRename('Task 1.md');
		await h.submit(form, 'a/b');

		assert.strictEqual(h.app.fileManager.renameFile.calls.length, 0);
		assert.match(h.errorText(), /cannot contain/i);
		assert.strictEqual(h.modalIsOpen(), true);
	});

	test('an unchanged name closes without touching the vault', async () => {
		const h = setupBoard();

		const { form } = h.openRename('Task 1.md');
		await h.submit(form, 'Task 1');

		assert.strictEqual(h.app.fileManager.renameFile.calls.length, 0);
		assert.strictEqual(h.modalIsOpen(), false);
	});

	test('with a title property configured the property is written, not the file name', async () => {
		const h = setupBoard({
			entries: createEntriesWithCustomTitle(),
			cardTitleProperty: PROPERTY_TITLE,
		});
		const path = (createEntriesWithCustomTitle()[0] as any).file.path;

		const { input, form } = h.openRename(path);
		assert.ok(input.value, 'the field should be seeded with the current property value');
		await h.submit(form, 'Renamed via property');

		assert.strictEqual(h.app.fileManager.renameFile.calls.length, 0, 'the file must not be renamed');
		assert.strictEqual(h.app.fileManager.processFrontMatter.calls.length, 1);
		const [file, apply] = h.app.fileManager.processFrontMatter.calls[0];
		assert.strictEqual(file.path, path);
		const frontmatter: Record<string, unknown> = {};
		apply(frontmatter);
		assert.deepStrictEqual(frontmatter, { title: 'Renamed via property' });
	});

	test('a "/" is accepted for a title property because no file is renamed', async () => {
		const h = setupBoard({
			entries: createEntriesWithCustomTitle(),
			cardTitleProperty: PROPERTY_TITLE,
		});
		const path = (createEntriesWithCustomTitle()[0] as any).file.path;

		const { form } = h.openRename(path);
		await h.submit(form, 'Draft / v2');

		assert.strictEqual(h.errorText(), '');
		assert.strictEqual(h.app.fileManager.processFrontMatter.calls.length, 1);
	});

	test('saved card order follows the renamed file instead of orphaning it', async () => {
		const h = setupBoard({
			cardOrders: { [PROPERTY_STATUS]: { 'To Do': ['Task 2.md', 'Task 1.md'] } },
		});

		const { form } = h.openRename('Task 1.md');
		await h.submit(form, 'Weekly review');

		const saved = h.controller.config.get('cardOrders');
		assert.deepStrictEqual(
			saved[PROPERTY_STATUS]['To Do'],
			['Task 2.md', 'Weekly review.md'],
			'the stored path should be repointed, keeping the card in place',
		);
	});
});
