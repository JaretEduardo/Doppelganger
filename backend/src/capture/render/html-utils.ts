/** Elements that never have a closing tag or children in HTML. */
export const VOID_ELEMENT_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Attributes whose value is a URL, and so gets scheme-sanitized. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'srcset']);

/**
 * Attributes preserved on rendered elements. Deliberately a narrow allowlist:
 * `id`/`class`/`style` are owned by the renderer (see {@link isSafeAttribute}),
 * and anything not listed here (including all `on*` event handlers) is dropped
 * rather than risk carrying over something unsafe or irrelevant.
 */
const SAFE_ATTRIBUTE_ALLOWLIST = new Set([
  'href',
  'src',
  'srcset',
  'alt',
  'title',
  'placeholder',
  'value',
  'name',
  'type',
  'for',
  'colspan',
  'rowspan',
  'target',
  'rel',
  'width',
  'height',
  'role',
  // SVG geometry/presentation attributes. Without these, inline <svg> shapes
  // (rect/circle/path/line/polygon/use...) lose their fill, stroke and
  // geometry and render as invisible empty elements — found via the complex
  // visual fixture's inline "verified" checkmark icon (Milestone 2.5).
  // Lowercased here to match isSafeAttribute's case-insensitive lookup; the
  // rendered output still uses whatever original case was captured (e.g.
  // "viewBox"), since only the safety check, not the emitted name, is
  // lowercased.
  'viewbox',
  'xmlns',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'preserveaspectratio',
]);

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttributeValue(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

/**
 * `data-*` attributes known to carry large, purely non-visual metadata
 * rather than anything a CSS selector or script would reasonably hook into.
 * Denied explicitly, by name — NOT a blanket "drop all data-*", since many
 * sites legitimately use data attributes for visual state or CSS hooks.
 *
 * - `data-mw`: MediaWiki/Parsoid — a JSON blob of the *original wikitext*
 *   and template-expansion bookkeeping for the element (can be many KB per
 *   element on a template-heavy page). Zero visual relevance, and its
 *   contents are exactly the kind of `{{...}}`/`@`-shaped wikitext that
 *   broke Angular compilation before this attribute was dropped.
 * - `data-parsoid`: MediaWiki/Parsoid — DOM-diffing/serialization
 *   bookkeeping (source offsets, whitespace trivia) for round-tripping back
 *   to wikitext. Also zero visual relevance.
 */
const KNOWN_NON_VISUAL_DATA_ATTRIBUTES = new Set(['data-mw', 'data-parsoid']);

export function isSafeAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  // id/class/style are the renderer's own styling hooks; carrying over the
  // original ones would collide with dg-* selectors or fight CapturedStyles.
  if (lower === 'id' || lower === 'class' || lower === 'style') return false;
  if (lower.startsWith('on')) return false;
  if (KNOWN_NON_VISUAL_DATA_ATTRIBUTES.has(lower)) return false;
  if (lower.startsWith('data-') || lower.startsWith('aria-')) return true;
  return SAFE_ATTRIBUTE_ALLOWLIST.has(lower);
}

const UNSAFE_URL_SCHEME = /^\s*(javascript|data:text\/html):/i;

/** Returns null when the value should be dropped entirely (unsafe URL scheme). */
export function sanitizeAttributeValue(name: string, value: string): string | null {
  if (URL_ATTRIBUTES.has(name.toLowerCase()) && UNSAFE_URL_SCHEME.test(value)) {
    return null;
  }
  return value;
}
