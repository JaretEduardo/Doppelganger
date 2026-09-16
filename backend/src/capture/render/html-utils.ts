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
]);

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttributeValue(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

export function isSafeAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  // id/class/style are the renderer's own styling hooks; carrying over the
  // original ones would collide with dg-* selectors or fight CapturedStyles.
  if (lower === 'id' || lower === 'class' || lower === 'style') return false;
  if (lower.startsWith('on')) return false;
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
