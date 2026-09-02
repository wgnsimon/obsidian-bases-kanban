import assert from 'node:assert';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { KanbanView } from '../src/kanbanView.ts';
import { PROPERTY_PRIORITY, PROPERTY_STATUS, TEST_PROPERTIES } from './fixtures.ts';
import {
	createDivWithMethods,
	createMockApp,
	createMockQueryController,
	createMockTFile,
	setupKanbanViewWithApp,
	setupTestEnvironment,
	triggerDataUpdate,
} from './helpers.ts';
import { ListValue, StringValue } from './mocks/obsidian.ts';

setupTestEnvironment();

const COLORED_CLASS = 'obk-card-property-colored';
const PILL_ATTR = 'data-property-pill-value';

interface ApiCall {
	method: string;
	propertyName: string;
	propertyValue: string;
}

/** Installs a stub Pretty Properties API and returns the log of calls made to it. */
function installStubApi(colors: Record<string, { background?: string; text?: string }>): ApiCall[] {
	const calls: ApiCall[] = [];
	(window as any).PrettyPropertiesApi = {
		getPropertyBackgroundColorValue(propertyName: string, propertyValue: string): string {
			calls.push({ method: 'background', propertyName, propertyValue });
			return colors[propertyValue]?.background ?? '';
		},
		getPropertyTextColorValue(propertyName: string, propertyValue: string): string {
			calls.push({ method: 'text', propertyName, propertyValue });
			return colors[propertyValue]?.text ?? '';
		},
	};
	return calls;
}

/** Entry factory that hands back Value instances verbatim (helpers.ts stringifies them). */
function createEntry(path: string, values: Record<string, unknown>): any {
	return {
		file: createMockTFile(path),
		getValue: (propertyId: string) => values[propertyId] ?? null,
		getProperty: (propertyId: string) => values[propertyId] ?? null,
	};
}

describe('Pretty Properties color compatibility', () => {
	let scrollEl: HTMLElement;
	let app: any;

	beforeEach(() => {
		scrollEl = createDivWithMethods();
		app = createMockApp();
	});

	afterEach(() => {
		delete (window as any).PrettyPropertiesApi;
	});

	function renderBoard(entries: any[]): KanbanView {
		const controller: any = createMockQueryController(entries, TEST_PROPERTIES);
		controller.app = app;
		controller.config.getAsPropertyId = () => PROPERTY_STATUS;
		controller.config.getOrder = () => [PROPERTY_STATUS, PROPERTY_PRIORITY];
		controller.config.getDisplayName = (id: string) => id;
		const view = new KanbanView(controller, scrollEl);
		setupKanbanViewWithApp(view, app);
		triggerDataUpdate(view);
		return view;
	}

	function renderSingleValue(value: unknown): HTMLElement {
		const view = renderBoard([
			createEntry('Task.md', { [PROPERTY_STATUS]: new StringValue('To Do'), [PROPERTY_PRIORITY]: value }),
		]);
		const valueEl = view.containerEl.querySelector('.obk-card-property-value') as HTMLElement;
		assert.ok(valueEl, 'Property value element should be rendered');
		return valueEl;
	}

	test('renders cards unchanged when Pretty Properties is not installed', () => {
		const valueEl = renderSingleValue(new StringValue('high'));

		assert.strictEqual(valueEl.textContent, 'high', 'Value should still render its text');
		assert.strictEqual(valueEl.hasAttribute(PILL_ATTR), false, 'No pill attribute without the plugin');
		assert.strictEqual(valueEl.classList.contains(COLORED_CLASS), false, 'No colored class without the plugin');
		assert.strictEqual(valueEl.getAttribute('style'), null, 'No inline styles without the plugin');
	});

	test('ignores a global that is not a usable Pretty Properties API', () => {
		(window as any).PrettyPropertiesApi = { getPropertyBackgroundColorValue: 'not a function' };

		const valueEl = renderSingleValue(new StringValue('high'));

		assert.strictEqual(valueEl.textContent, 'high');
		assert.strictEqual(valueEl.hasAttribute(PILL_ATTR), false, 'No pill attribute for an unusable API');
		assert.strictEqual(valueEl.classList.contains(COLORED_CLASS), false);
	});

	test('applies the configured background and text colors to the value', () => {
		installStubApi({ high: { background: 'rgb(255, 0, 0)', text: 'rgb(255, 255, 255)' } });

		const valueEl = renderSingleValue(new StringValue('high'));

		assert.strictEqual(valueEl.style.backgroundColor, 'rgb(255, 0, 0)', 'Background color should be applied');
		assert.strictEqual(valueEl.style.color, 'rgb(255, 255, 255)', 'Text color should be applied');
		assert.strictEqual(valueEl.getAttribute(PILL_ATTR), 'high', 'Pill attribute should carry the raw value');
		assert.strictEqual(valueEl.classList.contains(COLORED_CLASS), true, 'Colored class should be added');
	});

	test('leaves values uncolored when Pretty Properties has no color for them', () => {
		installStubApi({});

		const valueEl = renderSingleValue(new StringValue('high'));

		assert.strictEqual(valueEl.classList.contains(COLORED_CLASS), false, 'No colored class without a color');
		assert.strictEqual(valueEl.style.backgroundColor, '', 'No background color applied');
		assert.strictEqual(valueEl.style.color, '', 'No text color applied');
		assert.strictEqual(valueEl.getAttribute(PILL_ATTR), 'high', 'Pill attribute still describes the value');
	});

	test('renders successfully when the Pretty Properties API throws', () => {
		(window as any).PrettyPropertiesApi = {
			getPropertyBackgroundColorValue(): string {
				throw new Error('boom');
			},
			getPropertyTextColorValue(): string {
				throw new Error('boom');
			},
		};

		const valueEl = renderSingleValue(new StringValue('high'));

		assert.strictEqual(valueEl.textContent, 'high', 'Value should still render');
		assert.strictEqual(valueEl.classList.contains(COLORED_CLASS), false, 'No colored class when the API throws');
	});

	test('colors each item of a list value independently', () => {
		installStubApi({
			urgent: { background: 'rgb(255, 0, 0)' },
			later: { background: 'rgb(0, 128, 0)' },
		});

		const value = new ListValue([new StringValue('urgent'), new StringValue('someday'), new StringValue('later')]);
		const valueEl = renderSingleValue(value);
		const items = Array.from(valueEl.querySelectorAll('.obk-card-property-item')) as HTMLElement[];

		assert.strictEqual(items.length, 3, 'Each list item should get its own element');
		assert.deepStrictEqual(
			items.map((el) => el.textContent),
			['urgent', 'someday', 'later'],
			'Items should render in order',
		);
		assert.strictEqual(items[0].style.backgroundColor, 'rgb(255, 0, 0)');
		assert.strictEqual(items[1].style.backgroundColor, '', 'Uncolored item stays uncolored');
		assert.strictEqual(items[1].classList.contains(COLORED_CLASS), false);
		assert.strictEqual(items[2].style.backgroundColor, 'rgb(0, 128, 0)');
		assert.deepStrictEqual(
			items.map((el) => el.getAttribute(PILL_ATTR)),
			['urgent', 'someday', 'later'],
			'Each item carries its own pill value',
		);
	});

	test('passes the bare frontmatter property name to Pretty Properties', () => {
		const calls = installStubApi({ high: { background: 'rgb(255, 0, 0)' } });

		renderSingleValue(new StringValue('high'));

		assert.ok(calls.length > 0, 'The API should have been consulted');
		for (const call of calls) {
			assert.strictEqual(call.propertyName, 'priority', 'Bare property name, not the Bases property id');
			assert.strictEqual(call.propertyValue, 'high');
		}
	});
});
