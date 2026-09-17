import type { CapturedStyles } from '../ir/captured-page.interface.js';

/**
 * Renders every captured style property as `  property: value;` lines.
 * `CapturedStyles` keys are already real (kebab-case) CSS property names —
 * `dom-extractor.browser.ts` reads them straight off `CSSStyleDeclaration`'s
 * indexed enumeration — so no camelCase-to-kebab-case conversion is needed
 * here anymore (Milestone 5).
 */
export function renderDeclarationBlock(styles: CapturedStyles): string {
  return Object.entries(styles)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n');
}
