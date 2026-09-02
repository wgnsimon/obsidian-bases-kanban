import { CSS_CLASSES, DATA_ATTRIBUTES } from '../constants.ts';

declare global {
	interface Window {
		/** Assigned by the Pretty Properties community plugin while it is loaded. */
		PrettyPropertiesApi?: unknown;
	}
}

/**
 * Structural subset of the API the Pretty Properties community plugin
 * (anareaty/pretty-properties) publishes on `window.PrettyPropertiesApi`.
 *
 * Pretty Properties is optional, so we describe only the two getters we call
 * rather than depending on its types. Both return `''` when the user has not
 * configured a color for that value, or when the property type is not one
 * Pretty Properties colors at all.
 */
export interface PrettyPropertiesApi {
	getPropertyBackgroundColorValue(propertyName: string, propertyValue: string): string;
	getPropertyTextColorValue(propertyName: string, propertyValue: string): string;
}

function isPrettyPropertiesApi(candidate: unknown): candidate is PrettyPropertiesApi {
	if (typeof candidate !== 'object' || candidate === null) return false;
	return (
		'getPropertyBackgroundColorValue' in candidate &&
		typeof candidate.getPropertyBackgroundColorValue === 'function' &&
		'getPropertyTextColorValue' in candidate &&
		typeof candidate.getPropertyTextColorValue === 'function'
	);
}

/**
 * Returns the Pretty Properties API when that plugin is loaded and exposes the
 * getters we use, `null` otherwise. Never throws.
 */
export function getPrettyPropertiesApi(): PrettyPropertiesApi | null {
	try {
		if (typeof window === 'undefined') return null;
		const candidate: unknown = window.PrettyPropertiesApi;
		return isPrettyPropertiesApi(candidate) ? candidate : null;
	} catch {
		return null;
	}
}

/**
 * Paints `el` with the colors the user configured for `value` of `propertyName`
 * in Pretty Properties, and mirrors that plugin's `data-property-pill-value`
 * attribute so hand-written CSS keeps working inside the kanban.
 *
 * @param propertyName bare frontmatter name (`priority`), not a Bases id (`note.priority`)
 * @returns whether a color was applied
 *
 * A third-party global must never be able to break a card render, so every
 * failure mode — plugin absent, API changed, getter throwing — is swallowed and
 * reported as "no color".
 */
export function applyPrettyPropertyColors(el: HTMLElement, propertyName: string, value: string): boolean {
	try {
		const api = getPrettyPropertiesApi();
		if (!api) return false;
		const trimmed = value.trim();
		if (!trimmed) return false;

		const background = api.getPropertyBackgroundColorValue(propertyName, trimmed);
		const text = api.getPropertyTextColorValue(propertyName, trimmed);

		el.setAttribute(DATA_ATTRIBUTES.PROPERTY_PILL_VALUE, trimmed);
		if (!background && !text) return false;

		if (background) el.style.backgroundColor = background;
		if (text) el.style.color = text;
		el.classList.add(CSS_CLASSES.CARD_PROPERTY_COLORED);
		return true;
	} catch {
		return false;
	}
}
