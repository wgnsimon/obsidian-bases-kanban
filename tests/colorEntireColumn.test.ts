import assert from 'node:assert';
import { describe, test } from 'node:test';
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
const PROPERTY_ASSIGNEE = 'note.assignee' as BasesPropertyId;
const TEST_PROPERTIES = [PROPERTY_STATUS, PROPERTY_ASSIGNEE];

function createEntries(): BasesEntry[] {
	return [
		createMockBasesEntry(createMockTFile('Task A.md'), { [PROPERTY_STATUS]: 'To Do', [PROPERTY_ASSIGNEE]: 'Alice' }),
		createMockBasesEntry(createMockTFile('Task B.md'), { [PROPERTY_STATUS]: 'Done', [PROPERTY_ASSIGNEE]: 'Alice' }),
		createMockBasesEntry(createMockTFile('Task C.md'), { [PROPERTY_STATUS]: 'To Do', [PROPERTY_ASSIGNEE]: 'Bob' }),
	];
}

function createView(options: { swimlane?: boolean } = {}): { view: KanbanView; controller: any } {
	const scrollEl = createDivWithMethods();
	const controller: any = createMockQueryController(createEntries(), TEST_PROPERTIES);
	const app = createMockApp();
	controller.app = app;
	controller.config.getAsPropertyId = (key: string) => {
		if (key === 'groupByProperty') return PROPERTY_STATUS;
		if (key === 'swimlaneByProperty') return options.swimlane ? PROPERTY_ASSIGNEE : null;
		return null;
	};

	const view = new KanbanView(controller, scrollEl);
	setupKanbanViewWithApp(view, app);
	return { view, controller };
}

function columns(view: KanbanView): HTMLElement[] {
	return Array.from(view.containerEl.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.COLUMN}`));
}

function hasFullColor(col: HTMLElement): boolean {
	return col.classList.contains(CSS_CLASSES.COLUMN_FULL_COLOR);
}

describe('Color entire column option', () => {
	test('is exposed as a toggle in the view options', () => {
		const option = KanbanView.getViewOptions().find((o) => 'key' in o && o.key === 'colorEntireColumn');
		assert.ok(option, 'colorEntireColumn option should be present');
		assert.strictEqual(option.type, 'toggle', 'Option should be a toggle');
		assert.strictEqual(option.displayName, 'Color entire column', 'Option label should use sentence case');
	});

	test('columns are not fully colored when the option is unset', () => {
		const { view } = createView();
		triggerDataUpdate(view);

		const cols = columns(view);
		assert.ok(cols.length > 0, 'Columns should be rendered');
		assert.ok(
			cols.every((col) => !hasFullColor(col)),
			'No column should carry the full-color class when the option is unset',
		);
	});

	test('columns are not fully colored when the option is explicitly off', () => {
		const { view, controller } = createView();
		controller.config.set('colorEntireColumn', false);
		triggerDataUpdate(view);

		assert.ok(
			columns(view).every((col) => !hasFullColor(col)),
			'No column should carry the full-color class when the option is off',
		);
	});

	test('every column is fully colored when the option is on, colored or not', () => {
		const { view, controller } = createView();
		controller.config.set('columnColors', { [PROPERTY_STATUS]: { 'To Do': 'red' } });
		controller.config.set('colorEntireColumn', true);
		triggerDataUpdate(view);

		const cols = columns(view);
		assert.strictEqual(cols.length, 2, 'Both status columns should be rendered');
		cols.forEach((col) => {
			assert.ok(
				hasFullColor(col),
				`Column ${col.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE)} should carry the full-color class`,
			);
		});

		const uncolored = cols.find((col) => col.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE) === 'Done');
		assert.ok(uncolored, 'Done column should exist');
		assert.strictEqual(
			uncolored.getAttribute(DATA_ATTRIBUTES.COLUMN_COLOR),
			null,
			'An uncolored column stays uncolored — the CSS makes the class a no-op for it',
		);
	});

	test('toggling the option between renders adds and removes the class', () => {
		const { view, controller } = createView();
		triggerDataUpdate(view);
		assert.ok(
			columns(view).every((col) => !hasFullColor(col)),
			'Columns should start without the full-color class',
		);

		controller.config.set('colorEntireColumn', true);
		triggerDataUpdate(view);
		assert.ok(
			columns(view).every((col) => hasFullColor(col)),
			'Turning the option on should add the class to every column',
		);

		controller.config.set('colorEntireColumn', false);
		triggerDataUpdate(view);
		assert.ok(
			columns(view).every((col) => !hasFullColor(col)),
			'Turning the option off should remove the class from every column',
		);
	});

	test('the class survives a re-render that does not change any option', () => {
		const { view, controller } = createView();
		controller.config.set('colorEntireColumn', true);
		triggerDataUpdate(view);
		triggerDataUpdate(view);

		assert.ok(
			columns(view).every((col) => hasFullColor(col)),
			'The incremental render path should keep the class in sync',
		);
	});

	test('every lane column carries the class in swimlane mode', () => {
		const { view, controller } = createView({ swimlane: true });
		controller.config.set('columnColors', { [PROPERTY_STATUS]: { 'To Do': 'blue' } });
		controller.config.set('colorEntireColumn', true);
		triggerDataUpdate(view);

		const lanes = Array.from(view.containerEl.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.SWIMLANE}`));
		assert.ok(lanes.length >= 2, 'Multiple swimlanes should be rendered');
		lanes.forEach((lane) => {
			const laneColumns = Array.from(lane.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.COLUMN}`));
			assert.ok(laneColumns.length > 0, 'Each lane should render columns');
			laneColumns.forEach((col) => {
				assert.ok(
					hasFullColor(col),
					`Column ${col.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE)} in a lane should carry the full-color class`,
				);
			});
		});
	});

	test('per-column color assignment is unchanged by the option', () => {
		const withOption = createView();
		withOption.controller.config.set('columnColors', { [PROPERTY_STATUS]: { 'To Do': 'red' } });
		withOption.controller.config.set('colorEntireColumn', true);
		triggerDataUpdate(withOption.view);

		const without = createView();
		without.controller.config.set('columnColors', { [PROPERTY_STATUS]: { 'To Do': 'red' } });
		triggerDataUpdate(without.view);

		const read = (view: KanbanView): Array<[string | null, string, string | null]> =>
			columns(view).map((col) => [
				col.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE),
				col.style.getPropertyValue('--obk-column-accent-color'),
				col.getAttribute(DATA_ATTRIBUTES.COLUMN_COLOR),
			]);

		assert.deepStrictEqual(
			read(withOption.view),
			read(without.view),
			'Accent color variable and data attribute should be identical with and without the option',
		);
		assert.deepStrictEqual(
			read(withOption.view).find(([value]) => value === 'To Do'),
			['To Do', 'var(--color-red)', 'red'],
			'The colored column should still get its accent variable and data attribute',
		);
	});
});
