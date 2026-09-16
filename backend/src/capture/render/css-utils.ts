import type { CapturedStyles } from '../ir/captured-page.interface.js';

export function toKebabCase(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders every captured style property as `  property: value;` lines. */
export function renderDeclarationBlock(styles: CapturedStyles): string {
  return Object.entries(styles)
    .map(([property, value]) => `  ${toKebabCase(property)}: ${value};`)
    .join('\n');
}
