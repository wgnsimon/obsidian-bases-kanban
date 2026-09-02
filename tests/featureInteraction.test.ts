import assert from 'node:assert';
import { beforeEach, describe, test } from 'node:test';
import type { BasesEntry, BasesPropertyId } from 'obsidian';
import { COLOR_PALETTE, CSS_CLASSES, DATA_ATTRIBUTES } from '../src/constants.ts';
import { KanbanView } from '../src/kanbanView.ts';
import { Menu, type MenuItem } from './mocks/obsidian.ts';
import {
	createDivWithMethods,
	createMockApp,
	createMockBasesEntry,
	createMockQueryController,
	createMockTFile,
	setupKanbanViewWithApp,
	setupTestEnvironment,
	triggerDataUpdate,
} from './helpers.ts';

setupTestEnvironment();

/**
 * The six features below were built on separate branches and only meet here.
 * These tests cover the seams between them — the shared column ctx, the shared
 * column header, and the context menu's dependency on the done-column option —
 * rather than re-testing what each feature's own suite already covers.
 */

const PROPERTY_STATUS = 'note.status' as BasesPropertyId;
const PROPERTY_PRIORITY = 'note.priority' as BasesPropertyId;
const TEST_PROPERTIES = [PROPERTY_STATUS, PROPERTY_PRIORITY];

function createEntries(): BasesEntry[] {
	return [
		createMockBasesEntry(createMockTFile('Task A.md'), { [PROPERTY_STATUS]: 'To Do', [PROPERTY_PRIORITY]: 'High' }),
		createMockBasesEntry(createMockTFile('Task B.md'), { [PROPERTY_STATUS]: 'Done', [PROPERTY_PRIORITY]: 'Low' }),
	];
}

function createView(): { view: KanbanView; controller: any } {
	const scrollEl = createDivWithMethods();
	const controller: any = createMockQueryController(createEntries(), TEST_PROPERTIES);
	const app = createMockApp();
	controller.app = app;
	controller.config.getAsPropertyId = (key: string) => (key === 'groupByProperty' ? PROPERTY_STATUS : null);

	const view = new KanbanView(controller, scrollEl);
	setupKanbanViewWithApp(view, app);
	return { view, controller };
}

function column(root: HTMLElement, value: string): HTMLElement {
	const el = Array.from(root.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.COLUMN}`)).find(
		(c) => c.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE) === value,
	);
	assert.ok(el, `column "${value}" should exist`);
	return el;
}

describe('Feature interaction', () => {
	let view: KanbanView;
	let controller: any;

	beforeEach(() => {
		({ view, controller } = createView());
		Menu.menus.length = 0;
	});

	test('done, full-color and collapsed state coexist on one column', () => {
		controller.config.set('doneColumn', 'Done');
		controller.config.set('colorEntireColumn', true);
		controller.config.set('collapsedColumns', { [PROPERTY_STATUS]: ['Done'] });
		controller.config.set('columnColors', { [PROPERTY_STATUS]: { Done: 'dark-green' } });
		triggerDataUpdate(view);

		const doneCol = column(view.containerEl, 'Done');
		assert.ok(doneCol.classList.contains(CSS_CLASSES.COLUMN_DONE), 'done class');
		assert.ok(doneCol.classList.contains(CSS_CLASSES.COLUMN_FULL_COLOR), 'full-color class');
		assert.ok(doneCol.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED), 'collapsed class');
		assert.strictEqual(doneCol.getAttribute(DATA_ATTRIBUTES.COLUMN_COLOR), 'dark-green');

		const todoCol = column(view.containerEl, 'To Do');
		assert.ok(!todoCol.classList.contains(CSS_CLASSES.COLUMN_DONE));
		assert.ok(!todoCol.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED));
		assert.ok(todoCol.classList.contains(CSS_CLASSES.COLUMN_FULL_COLOR));
	});

	test('a column with every header control still renders each one exactly once', () => {
		controller.config.set('quickAddFolder', 'Tasks');
		controller.config.set('colorEntireColumn', true);
		triggerDataUpdate(view);

		const col = column(view.containerEl, 'To Do');
		const header = col.querySelector<HTMLElement>(`.${CSS_CLASSES.COLUMN_HEADER}`);
		assert.ok(header, 'header should exist');
		for (const cls of [
			CSS_CLASSES.COLUMN_DRAG_HANDLE,
			CSS_CLASSES.COLUMN_TOGGLE,
			CSS_CLASSES.COLUMN_COLOR_BTN,
			CSS_CLASSES.COLUMN_TITLE,
			CSS_CLASSES.COLUMN_COUNT,
			CSS_CLASSES.COLUMN_ADD_BTN,
		]) {
			assert.strictEqual(header.querySelectorAll(`.${cls}`).length, 1, `header should hold exactly one .${cls}`);
		}
	});

	test('the new palette colors round-trip through the column accent variable', () => {
		const newColors = COLOR_PALETTE.filter((c) => c.name.includes('-') || c.name === 'teal');
		assert.ok(newColors.length > 0, 'palette should carry the added colors');

		for (const color of newColors) {
			const fresh = createView();
			fresh.controller.config.set('columnColors', { [PROPERTY_STATUS]: { 'To Do': color.name } });
			triggerDataUpdate(fresh.view);

			const col = column(fresh.view.containerEl, 'To Do');
			assert.strictEqual(col.getAttribute(DATA_ATTRIBUTES.COLUMN_COLOR), color.name);
			assert.strictEqual(col.style.getPropertyValue('--obk-column-accent-color'), color.cssVar);
		}
	});

	test('"Mark as done" appears once the done column option is configured', () => {
		controller.config.set('doneColumn', 'Done');
		triggerDataUpdate(view);

		const card = view.containerEl.querySelector<HTMLElement>(`.${CSS_CLASSES.CARD}`);
		assert.ok(card, 'a card should render');
		card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));

		const lastMenu = Menu.menus[Menu.menus.length - 1];
		assert.ok(lastMenu, 'a context menu should have opened');
		const titles = lastMenu.items.map((item: MenuItem) => item.title);
		assert.ok(titles.includes('Mark as done'), `expected "Mark as done" in ${JSON.stringify(titles)}`);
	});

	test('all three column classes survive a re-render after a collapse', () => {
		controller.config.set('doneColumn', 'Done');
		controller.config.set('colorEntireColumn', true);
		triggerDataUpdate(view);

		const before = column(view.containerEl, 'Done');
		const toggle = before.querySelector<HTMLElement>(`.${CSS_CLASSES.COLUMN_TOGGLE}`);
		assert.ok(toggle, 'toggle should exist');
		toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.ok(before.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED));

		triggerDataUpdate(view);

		const after = column(view.containerEl, 'Done');
		// Same node ⇒ the incremental path ran; a full rebuild would replace it.
		assert.strictEqual(after, before, 'a data-only update should take the incremental path');
		assert.ok(after.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED), 'collapsed survives');
		assert.ok(after.classList.contains(CSS_CLASSES.COLUMN_DONE), 'done survives');
		assert.ok(after.classList.contains(CSS_CLASSES.COLUMN_FULL_COLOR), 'full-color survives');
	});
});
