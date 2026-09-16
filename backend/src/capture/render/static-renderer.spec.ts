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

function styles(overrides: Partial<CapturedStyles> = {}): CapturedStyles {
  const base: CapturedStyles = {
    display: 'block',
    position: 'static',
    width: 'auto',
    height: 'auto',
    minWidth: 'auto',
    minHeight: 'auto',
    maxWidth: 'none',
    maxHeight: 'none',
    margin: '0px',
    padding: '0px',
    color: 'rgb(0, 0, 0)',
    background: 'rgba(0, 0, 0, 0)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    fontFamily: 'Arial',
    fontSize: '16px',
    fontWeight: '400',
    fontStyle: 'normal',
    lineHeight: 'normal',
    letterSpacing: 'normal',
    textAlign: 'start',
    textDecoration: 'none solid rgb(0, 0, 0)',
    border: '0px none rgb(0, 0, 0)',
    borderRadius: '0px',
    boxShadow: 'none',
    opacity: '1',
    overflow: 'visible',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'normal',
    justifyContent: 'normal',
    gap: 'normal',
    gridTemplateColumns: 'none',
    gridTemplateRows: 'none',
    transform: 'none',
    zIndex: 'auto',
  };
  return { ...base, ...overrides };
}

function element(
  tag: string,
  options: {
    attributes?: Record<string, string>;
    children?: CapturedNode[];
    styleOverrides?: Partial<CapturedStyles>;
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
    const root = element('body', { styleOverrides: { backgroundColor: 'rgb(255, 0, 0)' } });
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
});
