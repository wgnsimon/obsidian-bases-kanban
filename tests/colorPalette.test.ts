import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import './helpers.ts';
import { applyColumnColor } from '../src/components/column.ts';
import { COLOR_PALETTE, DATA_ATTRIBUTES } from '../src/constants.ts';

const ACCENT_PROPERTY = '--obk-column-accent-color';

function createColumnEl(): HTMLElement {
	return document.createElement('div');
}

describe('COLOR_PALETTE', () => {
	// Column colors are persisted by name in each base's `columnColors` config.
	// Renaming, reordering or removing any of these eight entries silently drops
	// the color from every board saved before the change — new colors must be
	// appended after them instead.
	it('keeps the original eight entries first, in their original order', () => {
		const original = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];
		assert.deepEqual(
			COLOR_PALETTE.slice(0, original.length).map((c) => c.name),
			original,
		);
	});

	it('has unique, non-empty kebab-case names', () => {
		const names = COLOR_PALETTE.map((c) => c.name);
		assert.equal(new Set(names).size, names.length, 'names must be unique');
		for (const name of names) {
			assert.ok(name.length > 0, 'name must be non-empty');
			assert.match(name, /^[a-z]+(-[a-z]+)*$/, `"${name}" must be kebab-case`);
		}
	});

	it('gives every entry a non-empty cssVar and label', () => {
		for (const color of COLOR_PALETTE) {
			assert.ok(color.cssVar.length > 0, `${color.name} must have a cssVar`);
			assert.ok(color.label.length > 0, `${color.name} must have a label`);
		}
	});

	it('uses sentence-case labels', () => {
		for (const color of COLOR_PALETTE) {
			assert.match(color.label, /^[A-Z][a-z]*( [a-z]+)*$/, `"${color.label}" must be sentence case`);
		}
	});

	it('offers at least two distinct red variants and two distinct green variants', () => {
		const reds = COLOR_PALETTE.filter((c) => c.name.includes('red'));
		const greens = COLOR_PALETTE.filter((c) => c.name.includes('green'));
		assert.ok(reds.length >= 2, 'expected at least two reds');
		assert.ok(greens.length >= 2, 'expected at least two greens');
		assert.equal(new Set(reds.map((c) => c.cssVar)).size, reds.length, 'red variants must resolve differently');
		assert.equal(new Set(greens.map((c) => c.cssVar)).size, greens.length, 'green variants must resolve differently');
	});

	it('resolves every entry to a distinct css value', () => {
		const cssVars = COLOR_PALETTE.map((c) => c.cssVar);
		assert.equal(new Set(cssVars).size, cssVars.length);
	});
});

describe('applyColumnColor', () => {
	it('applies each palette color as the accent custom property and data attribute', () => {
		for (const color of COLOR_PALETTE) {
			const columnEl = createColumnEl();
			applyColumnColor(columnEl, color.name);
			assert.equal(columnEl.style.getPropertyValue(ACCENT_PROPERTY), color.cssVar);
			assert.equal(columnEl.getAttribute(DATA_ATTRIBUTES.COLUMN_COLOR), color.name);
		}
	});

	it('clears the accent and data attribute for an unknown color name', () => {
		const columnEl = createColumnEl();
		applyColumnColor(columnEl, 'dark-green');
		applyColumnColor(columnEl, 'chartreuse');
		assert.equal(columnEl.style.getPropertyValue(ACCENT_PROPERTY), '');
		assert.equal(columnEl.getAttribute(DATA_ATTRIBUTES.COLUMN_COLOR), null);
	});

	it('clears the accent and data attribute when no color is set', () => {
		const columnEl = createColumnEl();
		applyColumnColor(columnEl, 'light-red');
		applyColumnColor(columnEl, null);
		assert.equal(columnEl.style.getPropertyValue(ACCENT_PROPERTY), '');
		assert.equal(columnEl.getAttribute(DATA_ATTRIBUTES.COLUMN_COLOR), null);
	});
});
