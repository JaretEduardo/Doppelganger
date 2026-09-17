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

/**
 * Turns a Doppelganger node id ("n0") into its DOM/CSS selector id ("dg-n0").
 * Exported so other consumers (e.g. the Angular generator, which applies the
 * root's id to its `<app-root>` host) use the exact same id format instead of
 * re-deriving it.
 */
export function toDomId(nodeId: string): string {
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

  const css = serializeCssRules(cssRules);

  return { html, css };
}

/**
 * Renders the full stylesheet for a page — one `#dg-<id>` rule per node,
 * including the root element itself. Shared by {@link renderCapturedPage}
 * and by other consumers (e.g. the Angular generator) that need the exact
 * same CSS without re-deriving it from `CapturedStyles` a second time.
 */
export function renderStyles(page: CapturedPage): string {
  const cssRules: string[] = [];
  if (page.root) renderElement(page.root, cssRules);
  return serializeCssRules(cssRules);
}

/**
 * Renders the root element's *children* as HTML — not the root's own tag.
 * Meant for embedding inside another host element that stands in for the
 * root, e.g. an Angular component's `<app-root>` (which carries the root's
 * id/styles via a host binding instead of a nested `<body>` tag). Reuses the
 * exact same node-rendering path as {@link renderCapturedPage}, so structure,
 * attributes, text and escaping are never re-implemented per consumer.
 */
export function renderDocumentBody(page: CapturedPage): string {
  if (!page.root) return '';
  const cssRules: string[] = [];
  return page.root.children.map((child) => renderNode(child, cssRules)).join('');
}

function serializeCssRules(cssRules: string[]): string {
  return cssRules.length > 0 ? `${cssRules.join('\n\n')}\n` : '';
}

function renderNode(node: CapturedNode, cssRules: string[]): string {
  return node.kind === 'text' ? escapeHtml(node.text) : renderElement(node, cssRules);
}

function renderElement(node: CapturedElementNode, cssRules: string[]): string {
  const domId = toDomId(node.id);
  cssRules.push(`#${domId} {\n${renderDeclarationBlock(node.styles)}\n}`);

  // Real ::before/::after/::marker rules, not synthetic elements — this
  // reuses the browser's own pseudo-element rendering (font metrics, inline
  // flow, positioning) instead of trying to reimplement it. `pseudo.styles`
  // already includes `content` alongside everything else, from the same
  // generic computed-style capture used for real elements.
  for (const pseudo of node.pseudoElements ?? []) {
    cssRules.push(`#${domId}::${pseudo.kind} {\n${renderDeclarationBlock(pseudo.styles)}\n}`);
  }

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
