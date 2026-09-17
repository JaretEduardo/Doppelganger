import { describe, expect, it } from 'vitest';
import type {
  CapturedElementNode,
  CapturedNode,
  CapturedPage,
  CapturedStyles,
  CapturedTextNode,
} from '../ir/captured-page.interface.js';
import { renderCapturedPage } from './static-renderer.js';

let nextTestId = 0;
function nextId(): string {
  const id = `n${nextTestId}`;
  nextTestId += 1;
  return id;
}

/**
 * A small, representative base of *real* (kebab-case) CSS property names —
 * not an exhaustive replica of everything the real extractor now captures
 * (Milestone 5 removed the manual allowlist entirely; see
 * captured-page.interface.ts). Tests override just the properties they care
 * about via `styleOverrides`.
 */
function styles(overrides: CapturedStyles = {}): CapturedStyles {
  const base: CapturedStyles = {
    display: 'block',
    position: 'static',
    'box-sizing': 'content-box',
    top: 'auto',
    right: 'auto',
    bottom: 'auto',
    left: 'auto',
    width: 'auto',
    height: 'auto',
    'min-width': 'auto',
    'min-height': 'auto',
    'max-width': 'none',
    'max-height': 'none',
    margin: '0px',
    padding: '0px',
    color: 'rgb(0, 0, 0)',
    background: 'rgba(0, 0, 0, 0)',
    'background-color': 'rgba(0, 0, 0, 0)',
    'font-family': 'Arial',
    'font-size': '16px',
    'font-weight': '400',
    'font-style': 'normal',
    'line-height': 'normal',
    'letter-spacing': 'normal',
    'text-align': 'start',
    'text-decoration': 'none solid rgb(0, 0, 0)',
    'border-top': '0px none rgb(0, 0, 0)',
    'border-right': '0px none rgb(0, 0, 0)',
    'border-bottom': '0px none rgb(0, 0, 0)',
    'border-left': '0px none rgb(0, 0, 0)',
    'border-radius': '0px',
    'box-shadow': 'none',
    opacity: '1',
    overflow: 'visible',
    'list-style': 'disc outside none',
    'flex-direction': 'row',
    'flex-wrap': 'nowrap',
    'align-items': 'normal',
    'justify-content': 'normal',
    gap: 'normal',
    'grid-template-columns': 'none',
    'grid-template-rows': 'none',
    transform: 'none',
    'z-index': 'auto',
  };
  return { ...base, ...overrides };
}

function element(
  tag: string,
  options: {
    attributes?: Record<string, string>;
    children?: CapturedNode[];
    styleOverrides?: CapturedStyles;
  } = {},
): CapturedElementNode {
  return {
    kind: 'element',
    id: nextId(),
    tag,
    attributes: options.attributes ?? {},
    rect: { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
    styles: styles(options.styleOverrides),
    children: options.children ?? [],
  };
}

function text(value: string): CapturedTextNode {
  return { kind: 'text', id: nextId(), text: value };
}

function page(root: CapturedElementNode | null, title = 'Sample'): CapturedPage {
  return {
    url: 'https://example.com',
    title,
    viewport: { width: 1440, height: 900 },
    root,
    assets: [],
    nodeCount: 0,
  };
}

describe('renderCapturedPage', () => {
  it('wraps output in a minimal html document that links styles.css', () => {
    const rendered = renderCapturedPage(page(element('body'), 'My Title'));

    expect(rendered.html).toContain('<!doctype html>');
    expect(rendered.html).toContain('<title>My Title</title>');
    expect(rendered.html).toContain('<link rel="stylesheet" href="styles.css" />');
  });

  it('renders an empty body when there is no root', () => {
    const rendered = renderCapturedPage(page(null));
    expect(rendered.html).toContain('<body></body>');
  });

  it('uses dg-<id> as the element selector, not the original class', () => {
    const root = element('body', {
      children: [element('div', { attributes: { class: 'container hero' } })],
    });
    const rendered = renderCapturedPage(page(root));

    const div = root.children[0] as CapturedElementNode;
    expect(rendered.html).toContain(`id="dg-${div.id}"`);
    expect(rendered.html).not.toContain('class="container hero"');
    expect(rendered.css).toContain(`#dg-${div.id} {`);
  });

  it('preserves DOM order for interleaved text and element children', () => {
    const strong = element('strong', { children: [text('Jaret')] });
    const root = element('body', {
      children: [
        element('p', { children: [text('Hello '), strong, text(', welcome back.')] }),
      ],
    });

    const rendered = renderCapturedPage(page(root));
    const p = root.children[0] as CapturedElementNode;

    expect(rendered.html).toContain(
      `<p id="dg-${p.id}">Hello <strong id="dg-${strong.id}">Jaret</strong>, welcome back.</p>`,
    );
  });

  it('escapes text content and attribute values', () => {
    const root = element('body', {
      children: [
        element('a', {
          attributes: { href: 'https://example.com/?a=1&b=2', title: 'Say "hi"' },
          children: [text('<script>alert(1)</script>')],
        }),
      ],
    });

    const rendered = renderCapturedPage(page(root));

    expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(rendered.html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(rendered.html).toContain('title="Say &quot;hi&quot;"');
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
  });

  it('renders void elements without a closing tag or children', () => {
    const img = element('img', { attributes: { src: '/logo.png', alt: 'Logo' } });
    const rendered = renderCapturedPage(page(element('body', { children: [img] })));

    expect(rendered.html).toContain(`<img id="dg-${img.id}" src="/logo.png" alt="Logo" />`);
    expect(rendered.html).not.toContain('</img>');
  });

  it('drops id, class, style and on* attributes from the source', () => {
    const root = element('body', {
      children: [
        element('div', {
          attributes: {
            id: 'original-id',
            class: 'original-class',
            style: 'color: red;',
            onclick: 'alert(1)',
          },
        }),
      ],
    });

    const rendered = renderCapturedPage(page(root));

    expect(rendered.html).not.toContain('original-id');
    expect(rendered.html).not.toContain('original-class');
    expect(rendered.html).not.toContain('style=');
    expect(rendered.html).not.toContain('onclick');
  });

  it('keeps aria-* and data-* attributes', () => {
    const root = element('body', {
      children: [
        element('div', { attributes: { 'aria-hidden': 'true', 'data-test': 'value' } }),
      ],
    });

    const rendered = renderCapturedPage(page(root));

    expect(rendered.html).toContain('aria-hidden="true"');
    expect(rendered.html).toContain('data-test="value"');
  });

  it('drops javascript: URLs from href/src', () => {
    const root = element('body', {
      children: [element('a', { attributes: { href: "javascript:alert('xss')" } })],
    });

    const rendered = renderCapturedPage(page(root));

    expect(rendered.html).not.toContain('javascript:');
    expect(rendered.html).toMatch(/<a id="dg-n\d+">/);
  });

  it('emits one CSS rule per element with every captured style as kebab-case', () => {
    const root = element('body', { styleOverrides: { 'background-color': 'rgb(255, 0, 0)' } });
    const rendered = renderCapturedPage(page(root));

    expect(rendered.css).toContain(`#dg-${root.id} {`);
    expect(rendered.css).toContain('background-color: rgb(255, 0, 0);');
    expect(rendered.css).toContain('z-index: auto;');
    expect(rendered.css).toContain('font-family: Arial;');
  });

  it('renders one rule per node, in document order', () => {
    const child = element('span');
    const root = element('body', { children: [child] });
    const rendered = renderCapturedPage(page(root));

    const rootRuleIndex = rendered.css.indexOf(`#dg-${root.id} {`);
    const childRuleIndex = rendered.css.indexOf(`#dg-${child.id} {`);
    expect(rootRuleIndex).toBeGreaterThanOrEqual(0);
    expect(childRuleIndex).toBeGreaterThan(rootRuleIndex);
  });

  it('renders ::before/::after/::marker as real CSS pseudo-element rules', () => {
    const withPseudos = element('p');
    withPseudos.pseudoElements = [
      { kind: 'before', styles: styles({ content: '"→ "', color: 'rgb(200, 0, 0)' }) },
      { kind: 'after', styles: styles({ content: '" ←"', color: 'rgb(0, 0, 200)' }) },
    ];
    const rendered = renderCapturedPage(page(element('body', { children: [withPseudos] })));

    expect(rendered.css).toContain(`#dg-${withPseudos.id}::before {`);
    expect(rendered.css).toContain('content: "→ ";');
    expect(rendered.css).toContain('color: rgb(200, 0, 0);');
    expect(rendered.css).toContain(`#dg-${withPseudos.id}::after {`);
    expect(rendered.css).toContain('content: " ←";');
  });

  it('renders ::marker with its own content and styles', () => {
    const li = element('li');
    li.pseudoElements = [
      { kind: 'marker', styles: styles({ content: '"* "', color: 'rgb(0, 128, 0)' }) },
    ];
    const rendered = renderCapturedPage(page(element('body', { children: [li] })));

    expect(rendered.css).toContain(`#dg-${li.id}::marker {`);
    expect(rendered.css).toContain('content: "* ";');
    expect(rendered.css).toContain('color: rgb(0, 128, 0);');
  });

  it('does not render pseudo-element rules for a node with none', () => {
    const plain = element('p');
    const rendered = renderCapturedPage(page(element('body', { children: [plain] })));

    expect(rendered.css).not.toContain('::before');
    expect(rendered.css).not.toContain('::after');
    expect(rendered.css).not.toContain('::marker');
  });

  it('preserves SVG geometry and presentation attributes (fill, viewBox, d, cx, cy, r...)', () => {
    // Regression test: these are plain DOM attributes on SVG shape elements,
    // not CSS, so they need their own allowlist entries or the shape renders
    // as an empty, invisible element. Found via the complex visual fixture's
    // inline "verified" checkmark icon (Milestone 2.5).
    const circle = element('circle', {
      attributes: { cx: '10', cy: '10', r: '10', fill: 'rgb(34,197,94)' },
    });
    const path = element('path', {
      attributes: {
        d: 'M6 10l3 3l5-6',
        stroke: 'white',
        'stroke-width': '2',
        fill: 'none',
      },
    });
    const svg = element('svg', {
      attributes: { viewBox: '0 0 20 20', width: '16', height: '16' },
      children: [circle, path],
    });
    const rendered = renderCapturedPage(page(element('body', { children: [svg] })));

    expect(rendered.html).toContain('viewBox="0 0 20 20"');
    expect(rendered.html).toContain('cx="10" cy="10" r="10" fill="rgb(34,197,94)"');
    expect(rendered.html).toContain('d="M6 10l3 3l5-6"');
    expect(rendered.html).toContain('stroke="white"');
    expect(rendered.html).toContain('stroke-width="2"');
  });

  it('emits box-sizing so a captured border-box width is not misread as content-box', () => {
    // Regression test: without box-sizing in the output, a border-box element
    // whose captured `width` already includes its padding/border renders
    // wider than the original (the renderer's elements default to
    // content-box). Found via the Milestone 2.5 complex fixture diff.
    const root = element('body', {
      styleOverrides: { 'box-sizing': 'border-box', width: '100px', padding: '10px' },
    });
    const rendered = renderCapturedPage(page(root));

    expect(rendered.css).toContain('box-sizing: border-box;');
  });

  it('emits border per-side so a border-bottom-only divider is not silently dropped', () => {
    // Regression test: getComputedStyle().border (shorthand) is empty unless
    // all four sides match, which previously meant "border: ;" (invalid,
    // ignored) for the very common border-bottom-only pattern. Found via the
    // Milestone 2.5 complex fixture's table row dividers disappearing.
    const row = element('td', { styleOverrides: { 'border-bottom': '1px solid rgb(226, 232, 240)' } });
    const rendered = renderCapturedPage(page(element('body', { children: [row] })));

    expect(rendered.css).toContain('border-bottom: 1px solid rgb(226, 232, 240);');
    expect(rendered.css).not.toContain('border: ;');
  });

  it('emits list-style so a reset list does not regain default bullets', () => {
    // Regression test: `list-style: none` (near-universal on nav/feature
    // lists) wasn't reproduced, so reconstructed <li>s fell back to the
    // browser's default disc bullets. Found via the Milestone 2.5 complex
    // fixture's sidebar nav and card feature lists.
    const list = element('ul', { styleOverrides: { 'list-style': 'none' } });
    const rendered = renderCapturedPage(page(element('body', { children: [list] })));

    expect(rendered.css).toContain('list-style: none;');
  });

  it('emits top/right/bottom/left so absolutely positioned elements land in place', () => {
    // Regression test: `position: absolute` without its offsets renders at
    // the element's static position instead of the intended corner. Found
    // via the Milestone 2.5 complex fixture (status dot + card ribbon both
    // moved).
    const badge = element('span', {
      styleOverrides: { position: 'absolute', top: '2px', right: '-6px' },
    });
    const rendered = renderCapturedPage(page(element('body', { children: [badge] })));

    expect(rendered.css).toContain('position: absolute;');
    expect(rendered.css).toContain('top: 2px;');
    expect(rendered.css).toContain('right: -6px;');
  });
});
