import type {
  CapturedElementNode,
  CapturedNode,
  CapturedPage,
} from '../ir/captured-page.interface.js';
import type { RenderedPage } from './rendered-page.interface.js';
import {
  escapeAttributeValue,
  escapeHtml,
  isSafeAttribute,
  sanitizeAttributeValue,
  VOID_ELEMENT_TAGS,
} from './html-utils.js';
import { renderDeclarationBlock } from './css-utils.js';

const STYLESHEET_HREF = 'styles.css';

/** Turns a Doppelganger node id ("n0") into its DOM/CSS selector id ("dg-n0"). */
function toDomId(nodeId: string): string {
  return `dg-${nodeId}`;
}

/**
 * Renders a {@link CapturedPage} into a static `index.html` + `styles.css`
 * pair. Structure, attributes, text and hierarchy come straight from the IR;
 * every element is styled purely through a `#dg-<id>` CSS rule generated from
 * its `CapturedStyles` — original classes are never copied over.
 */
export function renderCapturedPage(page: CapturedPage): RenderedPage {
  const cssRules: string[] = [];
  const bodyHtml = page.root ? renderElement(page.root, cssRules) : '<body></body>';

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    `    <title>${escapeHtml(page.title)}</title>`,
    `    <link rel="stylesheet" href="${STYLESHEET_HREF}" />`,
    '  </head>',
    bodyHtml,
    '</html>',
    '',
  ].join('\n');

  const css = cssRules.length > 0 ? `${cssRules.join('\n\n')}\n` : '';

  return { html, css };
}

function renderNode(node: CapturedNode, cssRules: string[]): string {
  return node.kind === 'text' ? escapeHtml(node.text) : renderElement(node, cssRules);
}

function renderElement(node: CapturedElementNode, cssRules: string[]): string {
  const domId = toDomId(node.id);
  cssRules.push(`#${domId} {\n${renderDeclarationBlock(node.styles)}\n}`);

  const attributes = renderAttributes(node, domId);

  if (VOID_ELEMENT_TAGS.has(node.tag)) {
    return `<${node.tag}${attributes} />`;
  }

  const childrenHtml = node.children.map((child) => renderNode(child, cssRules)).join('');
  return `<${node.tag}${attributes}>${childrenHtml}</${node.tag}>`;
}

function renderAttributes(node: CapturedElementNode, domId: string): string {
  const parts = [`id="${domId}"`];

  for (const [name, value] of Object.entries(node.attributes)) {
    if (!isSafeAttribute(name)) continue;
    const sanitized = sanitizeAttributeValue(name, value);
    if (sanitized === null) continue;
    parts.push(`${name}="${escapeAttributeValue(sanitized)}"`);
  }

  return ` ${parts.join(' ')}`;
}
