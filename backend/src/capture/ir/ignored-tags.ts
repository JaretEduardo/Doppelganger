/**
 * Tags that don't contribute visual representation and are excluded from the
 * captured tree. Passed into the browser as an evaluate() argument rather than
 * imported by dom-extractor.browser.ts, which must stay self-contained.
 */
export const IGNORED_TAGS = [
  'script',
  'style',
  'meta',
  'link',
  'noscript',
  'template',
] as const;
