import assert from 'node:assert';
import { describe, test } from 'node:test';
import type { BasesEntry, BasesPropertyId } from 'obsidian';
import { CSS_CLASSES, DATA_ATTRIBUTES } from '../src/constants.ts';
import { isCollapsedColumns, KanbanView } from '../src/kanbanView.ts';
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

const PROPERTY_STATUS = 'note.status' as BasesPropertyId;
const PROPERTY_STAGE = 'note.stage' as BasesPropertyId;
const PROPERTY_ASSIGNEE = 'note.assignee' as BasesPropertyId;
const TEST_PROPERTIES = [PROPERTY_STATUS, PROPERTY_STAGE, PROPERTY_ASSIGNEE];

// `status` and `stage` deliberately share the value "To Do" so the per-property
// scoping of collapsed state is observable.
function createEntries(): BasesEntry[] {
	return [
		createMockBasesEntry(createMockTFile('Task A.md'), {
			[PROPERTY_STATUS]: 'To Do',
			[PROPERTY_STAGE]: 'To Do',
			[PROPERTY_ASSIGNEE]: 'Ann',
		}),
		createMockBasesEntry(createMockTFile('Task B.md'), {
			[PROPERTY_STATUS]: 'To Do',
			[PROPERTY_STAGE]: 'Later',
			[PROPERTY_ASSIGNEE]: 'Bob',
		}),
		createMockBasesEntry(createMockTFile('Task C.md'), {
			[PROPERTY_STATUS]: 'Done',
			[PROPERTY_STAGE]: 'Later',
			[PROPERTY_ASSIGNEE]: 'Ann',
		}),
	];
}

function createView(
	groupByProperty: () => BasesPropertyId = () => PROPERTY_STATUS,
	swimlaneByProperty: () => BasesPropertyId | null = () => null,
): { view: KanbanView; controller: any } {
	const scrollEl = createDivWithMethods();
	const controller: any = createMockQueryController(createEntries(), TEST_PROPERTIES);
	const app = createMockApp();
	controller.app = app;
	controller.config.getAsPropertyId = (key: string) => {
		if (key === 'groupByProperty') return groupByProperty();
		if (key === 'swimlaneByProperty') return swimlaneByProperty();
		return null;
	};

	const view = new KanbanView(controller, scrollEl);
	setupKanbanViewWithApp(view, app);
	return { view, controller };
}

function getColumns(root: HTMLElement, columnValue: string): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.COLUMN}`)).filter(
		(col) => col.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE) === columnValue,
	);
}

function getColumn(root: HTMLElement, columnValue: string): HTMLElement {
	const columns = getColumns(root, columnValue);
	assert.ok(columns.length > 0, `Expected column ${columnValue} to exist`);
	return columns[0];
}

function getToggle(columnEl: HTMLElement): HTMLElement {
	const toggle = columnEl.querySelector<HTMLElement>(`.${CSS_CLASSES.COLUMN_TOGGLE}`);
	assert.ok(toggle, 'Expected column collapse toggle to exist');
	return toggle;
}

function getToggleIcon(toggle: HTMLElement): string | null {
	return toggle.querySelector('svg')?.getAttribute('data-icon') ?? null;
}

function savedCollapsedColumns(controller: any): Record<string, string[]> {
	const raw = controller.config.get('collapsedColumns');
	return isCollapsedColumns(raw) ? raw : {};
}

describe('isCollapsedColumns type guard', () => {
	test('accepts a record of string arrays keyed by property id', () => {
		assert.ok(isCollapsedColumns({ 'note.status': ['To Do'], 'note.stage': [] }));
		assert.ok(isCollapsedColumns({}));
	});

	test('rejects anything that is not a record of string arrays', () => {
		assert.ok(!isCollapsedColumns(null));
		assert.ok(!isCollapsedColumns(undefined));
		assert.ok(!isCollapsedColumns('To Do'));
		assert.ok(!isCollapsedColumns([]));
		assert.ok(!isCollapsedColumns({ 'note.status': 'To Do' }));
		assert.ok(!isCollapsedColumns({ 'note.status': [1, 2] }));
	});
});

describe('Collapsible columns', () => {
	test('every column renders a toggle and starts expanded', () => {
		const { view, controller } = createView();
		triggerDataUpdate(view);

		const columns = Array.from(view.containerEl.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.COLUMN}`));
		assert.ok(columns.length >= 2, 'Expected the board to render several columns');
		for (const column of columns) {
			const toggle = getToggle(column);
			assert.ok(!column.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED), 'Columns should start expanded');
			assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
			assert.strictEqual(toggle.getAttribute('aria-label'), 'Collapse column');
			assert.strictEqual(getToggleIcon(toggle), 'chevron-down');
			const body = column.querySelector(`.${CSS_CLASSES.COLUMN_BODY}`);
			assert.ok(body, 'An expanded column keeps its card body');
		}

		assert.deepStrictEqual(savedCollapsedColumns(controller), {}, 'An untouched board should not write collapsedColumns');
	});

	test('clicking the toggle collapses the column and persists the state', () => {
		const { view, controller } = createView();
		triggerDataUpdate(view);

		const column = getColumn(view.containerEl, 'To Do');
		const toggle = getToggle(column);
		toggle.click();

		assert.ok(column.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED), 'Column should be collapsed');
		assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
		assert.strictEqual(toggle.getAttribute('aria-label'), 'Expand column');
		assert.strictEqual(getToggleIcon(toggle), 'chevron-right');
		// The header stays in the DOM — only the body is hidden (by CSS).
		assert.ok(column.querySelector(`.${CSS_CLASSES.COLUMN_HEADER}`), 'Collapsed column keeps its header');
		assert.deepStrictEqual(savedCollapsedColumns(controller)[PROPERTY_STATUS], ['To Do']);
	});

	test('toggling a second time expands the column and drops it from the saved state', () => {
		const { view, controller } = createView();
		triggerDataUpdate(view);

		const column = getColumn(view.containerEl, 'To Do');
		const toggle = getToggle(column);
		toggle.click();
		toggle.click();

		assert.ok(!column.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED), 'Column should be expanded again');
		assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
		assert.strictEqual(getToggleIcon(toggle), 'chevron-down');
		assert.deepStrictEqual(savedCollapsedColumns(controller)[PROPERTY_STATUS], []);
	});

	test('a saved collapsed state is restored on render and survives a patch render', () => {
		const { view, controller } = createView();
		controller.config.set('collapsedColumns', { [PROPERTY_STATUS]: ['Done'] });
		triggerDataUpdate(view);

		const done = getColumn(view.containerEl, 'Done');
		const toDo = getColumn(view.containerEl, 'To Do');
		assert.ok(done.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED), 'Saved column should render collapsed');
		assert.strictEqual(getToggle(done).getAttribute('aria-expanded'), 'false');
		assert.ok(!toDo.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED), 'Other columns stay expanded');

		// Second update takes the incremental patch path; it must not drop the state.
		triggerDataUpdate(view);
		const doneAfter = getColumn(view.containerEl, 'Done');
		assert.strictEqual(doneAfter, done, 'Expected the patch path to reuse the column element');
		assert.ok(doneAfter.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED), 'Collapsed state should survive a patch');
		assert.strictEqual(getToggleIcon(getToggle(doneAfter)), 'chevron-right');
	});

	test('collapsing a column in one swimlane collapses that value in every lane', () => {
		const { view, controller } = createView(
			() => PROPERTY_STATUS,
			() => PROPERTY_ASSIGNEE,
		);
		triggerDataUpdate(view);

		const lanes = view.containerEl.querySelectorAll(`.${CSS_CLASSES.SWIMLANE}`);
		assert.strictEqual(lanes.length, 2, 'Expected one lane per assignee');

		const toDoColumns = getColumns(view.containerEl, 'To Do');
		assert.strictEqual(toDoColumns.length, 2, 'Expected the To Do column to be rendered once per lane');

		getToggle(toDoColumns[0]).click();

		for (const column of toDoColumns) {
			assert.ok(column.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED), 'Every lane copy should collapse');
			assert.strictEqual(getToggle(column).getAttribute('aria-expanded'), 'false');
			assert.strictEqual(getToggleIcon(getToggle(column)), 'chevron-right');
		}
		for (const column of getColumns(view.containerEl, 'Done')) {
			assert.ok(!column.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED), 'Other column values stay expanded');
		}

		// Stored under the bare group-by property id, not a swimlane-scoped key.
		assert.deepStrictEqual(savedCollapsedColumns(controller), { [PROPERTY_STATUS]: ['To Do'] });
	});

	test('collapsed state is scoped per group-by property', () => {
		let groupByProperty = PROPERTY_STATUS;
		const { view, controller } = createView(() => groupByProperty);
		triggerDataUpdate(view);

		getToggle(getColumn(view.containerEl, 'To Do')).click();
		assert.deepStrictEqual(savedCollapsedColumns(controller)[PROPERTY_STATUS], ['To Do']);

		groupByProperty = PROPERTY_STAGE;
		triggerDataUpdate(view);

		const stageToDo = getColumn(view.containerEl, 'To Do');
		assert.ok(
			!stageToDo.classList.contains(CSS_CLASSES.COLUMN_COLLAPSED),
			'The same column label under another group-by property should not inherit collapsed state',
		);
		assert.strictEqual(getToggle(stageToDo).getAttribute('aria-expanded'), 'true');

		getToggle(getColumn(view.containerEl, 'Later')).click();
		const saved = savedCollapsedColumns(controller);
		assert.deepStrictEqual(saved[PROPERTY_STATUS], ['To Do'], 'The other property keeps its own state');
		assert.deepStrictEqual(saved[PROPERTY_STAGE], ['Later']);
	});
});
