import assert from 'node:assert';
import { beforeEach, describe, test } from 'node:test';
import type { BasesEntry, BasesPropertyId } from 'obsidian';
import { CSS_CLASSES, DATA_ATTRIBUTES } from '../src/constants.ts';
import { KanbanView } from '../src/kanbanView.ts';
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
const PROPERTY_PRIORITY = 'note.priority' as BasesPropertyId;
const TEST_PROPERTIES = [PROPERTY_STATUS, PROPERTY_PRIORITY];

function createEntries(): BasesEntry[] {
	return [
		createMockBasesEntry(createMockTFile('Task A.md'), { [PROPERTY_STATUS]: 'To Do', [PROPERTY_PRIORITY]: 'High' }),
		createMockBasesEntry(createMockTFile('Task B.md'), { [PROPERTY_STATUS]: 'Done', [PROPERTY_PRIORITY]: 'High' }),
		createMockBasesEntry(createMockTFile('Task C.md'), { [PROPERTY_STATUS]: 'Done', [PROPERTY_PRIORITY]: 'Low' }),
		createMockBasesEntry(createMockTFile('Task D.md'), { [PROPERTY_STATUS]: 'Archived', [PROPERTY_PRIORITY]: 'Low' }),
	];
}

function createView(swimlaneProperty: BasesPropertyId | null = null): { view: KanbanView; controller: any } {
	const scrollEl = createDivWithMethods();
	const controller: any = createMockQueryController(createEntries(), TEST_PROPERTIES);
	const app = createMockApp();
	controller.app = app;
	controller.config.getAsPropertyId = (key: string) => {
		if (key === 'groupByProperty') return PROPERTY_STATUS;
		if (key === 'swimlaneByProperty') return swimlaneProperty;
		return null;
	};

	const view = new KanbanView(controller, scrollEl);
	setupKanbanViewWithApp(view, app);
	return { view, controller };
}

function columnsWithin(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.COLUMN}`));
}

function doneColumnValues(root: HTMLElement): string[] {
	return columnsWithin(root)
		.filter((col) => col.classList.contains(CSS_CLASSES.COLUMN_DONE))
		.map((col) => col.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE) ?? '');
}

describe('Done column', () => {
	let view: KanbanView;
	let controller: any;

	beforeEach(() => {
		({ view, controller } = createView());
	});

	test('no columns are marked done when the option is unset', () => {
		triggerDataUpdate(view);

		assert.ok(columnsWithin(view.containerEl).length > 0, 'board should render columns');
		assert.deepStrictEqual(doneColumnValues(view.containerEl), []);
	});

	test('marks only the nominated column', () => {
		controller.config.set('doneColumn', 'Done');
		triggerDataUpdate(view);

		assert.deepStrictEqual(doneColumnValues(view.containerEl), ['Done']);
	});

	for (const configured of ['done', 'DONE', 'Done', '  DoNe  ']) {
		test(`matching is case-insensitive and trimmed: "${configured}"`, () => {
			const fresh = createView();
			fresh.controller.config.set('doneColumn', configured);
			triggerDataUpdate(fresh.view);

			assert.deepStrictEqual(doneColumnValues(fresh.view.containerEl), ['Done']);
		});
	}

	test('comma-separated values mark several columns', () => {
		controller.config.set('doneColumn', 'Done, Archived');
		triggerDataUpdate(view);

		assert.deepStrictEqual(doneColumnValues(view.containerEl).sort(), ['Archived', 'Done']);
	});

	test('empty segments are ignored', () => {
		controller.config.set('doneColumn', 'Done,,');
		triggerDataUpdate(view);

		assert.deepStrictEqual(doneColumnValues(view.containerEl), ['Done']);
	});

	test('a whitespace-only value marks nothing', () => {
		controller.config.set('doneColumn', '   ');
		triggerDataUpdate(view);

		assert.deepStrictEqual(doneColumnValues(view.containerEl), []);
	});

	test('changing the setting between renders updates which column is marked', () => {
		controller.config.set('doneColumn', 'Done');
		triggerDataUpdate(view);
		assert.deepStrictEqual(doneColumnValues(view.containerEl), ['Done']);

		controller.config.set('doneColumn', 'Archived');
		triggerDataUpdate(view);
		assert.deepStrictEqual(doneColumnValues(view.containerEl), ['Archived']);

		controller.config.set('doneColumn', null);
		triggerDataUpdate(view);
		assert.deepStrictEqual(doneColumnValues(view.containerEl), []);
	});

	test('the done class survives an incremental re-render when only data changes', () => {
		controller.config.set('doneColumn', 'Done');
		triggerDataUpdate(view);
		assert.deepStrictEqual(doneColumnValues(view.containerEl), ['Done']);

		// No option changed, so this second update takes the patch path rather than a
		// full rebuild — the done class must be re-synced there too.
		controller.data.data = [
			...createEntries(),
			createMockBasesEntry(createMockTFile('Task E.md'), { [PROPERTY_STATUS]: 'Done', [PROPERTY_PRIORITY]: 'High' }),
		];
		triggerDataUpdate(view);

		assert.deepStrictEqual(doneColumnValues(view.containerEl), ['Done']);
	});

	test('patching a column re-syncs the done class in both directions', () => {
		controller.config.set('doneColumn', 'Done');
		triggerDataUpdate(view);

		const columns = columnsWithin(view.containerEl);
		const doneCol = columns.find((c) => c.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE) === 'Done');
		const todoCol = columns.find((c) => c.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE) === 'To Do');
		assert.ok(doneCol && todoCol);

		// Patch is the incremental path; drive it directly with a changed setting so a
		// stale class would be caught even if a full rebuild were somehow skipped.
		controller.config.set('doneColumn', 'To Do');
		(view as any).patchColumnCards(doneCol, []);
		(view as any).patchColumnCards(todoCol, []);

		assert.ok(!doneCol.classList.contains(CSS_CLASSES.COLUMN_DONE), 'Done should no longer be marked');
		assert.ok(todoCol.classList.contains(CSS_CLASSES.COLUMN_DONE), 'To Do should now be marked');
	});

	test('every lane copy of the done column is marked in swimlane mode', () => {
		const swimlane = createView(PROPERTY_PRIORITY);
		swimlane.controller.config.set('doneColumn', 'Done');
		triggerDataUpdate(swimlane.view);

		const lanes = Array.from(swimlane.view.containerEl.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.SWIMLANE}`));
		assert.ok(lanes.length > 1, 'expected more than one lane');
		for (const lane of lanes) {
			const laneValue = lane.getAttribute(DATA_ATTRIBUTES.SWIMLANE_VALUE);
			assert.deepStrictEqual(doneColumnValues(lane), ['Done'], `lane ${laneValue} should mark its Done column`);
		}
	});
});

describe('Done column view option', () => {
	test('getViewOptions exposes a text option for the done column', () => {
		const option = KanbanView.getViewOptions().find((o) => 'key' in o && o.key === 'doneColumn');

		assert.ok(option, 'doneColumn option should exist');
		assert.strictEqual(option.type, 'text');
		assert.strictEqual((option as { displayName: string }).displayName, 'Done column');
	});
});
