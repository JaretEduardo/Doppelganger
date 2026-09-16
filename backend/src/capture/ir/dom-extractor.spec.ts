import { Browser, chromium, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractCapturedPage, BrowserExtractionResult } from './dom-extractor.browser.js';
import { IGNORED_TAGS } from './ignored-tags.js';
import { CapturedNode } from './captured-page.interface.js';

const SAMPLE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Sample</title>
    <style>.hero { color: red; }</style>
    <script>window.__ignored = true;</script>
  </head>
  <body>
    <div id="root" class="container">
      <h1>Hello <span>World</span></h1>
      <p>Some <strong>direct</strong> text.</p>
      <img src="/logo.png" alt="Logo" />
      <picture>
        <source srcset="/banner.webp" type="image/webp" />
        <img src="/banner.jpg" alt="Banner" />
      </picture>
      <div class="hero" style="background-image: url('/hero.jpg'); width: 200px;"></div>
      <svg><use href="/sprite.svg#icon-check"></use></svg>
      <noscript>No JS</noscript>
      <template><span>Ignored template content</span></template>
    </div>
  </body>
</html>`;

function flatten(node: CapturedNode): CapturedNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

describe('extractCapturedPage', () => {
  let browser: Browser;
  let page: Page;
  let result: BrowserExtractionResult;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.setContent(SAMPLE_HTML);
    result = await page.evaluate(extractCapturedPage, IGNORED_TAGS);
  });

  afterAll(async () => {
    await browser.close();
  });

  it('builds a root node from <body>', () => {
    expect(result.root).not.toBeNull();
    expect(result.root?.tag).toBe('body');
  });

  it('excludes ignored tags from the tree', () => {
    const tags = flatten(result.root!).map((node) => node.tag);
    for (const ignoredTag of IGNORED_TAGS) {
      expect(tags).not.toContain(ignoredTag);
    }
  });

  it('captures only text directly owned by each node', () => {
    const nodes = flatten(result.root!);

    const h1 = nodes.find((node) => node.tag === 'h1');
    expect(h1?.text).toBe('Hello');

    const span = nodes.find((node) => node.tag === 'span' && node.text === 'World');
    expect(span).toBeDefined();

    // Both direct text nodes ("Some " and " text.") are joined; "direct" is not
    // just the first text node.
    const paragraph = nodes.find((node) => node.tag === 'p');
    expect(paragraph?.text).toBe('Some text.');
  });

  it('captures element attributes', () => {
    const nodes = flatten(result.root!);
    const rootDiv = nodes.find((node) => node.attributes['id'] === 'root');
    expect(rootDiv?.attributes['class']).toBe('container');
  });

  it('captures a bounding rect for every node', () => {
    const nodes = flatten(result.root!);
    for (const node of nodes) {
      expect(typeof node.rect.width).toBe('number');
      expect(typeof node.rect.height).toBe('number');
    }
  });

  it('captures exactly the requested computed style properties', () => {
    const nodes = flatten(result.root!);
    const hero = nodes.find((node) => node.attributes['class'] === 'hero');

    expect(hero?.styles.width).toBe('200px');
    expect(Object.keys(hero!.styles).sort()).toEqual(
      [
        'alignItems',
        'background',
        'backgroundColor',
        'border',
        'borderRadius',
        'boxShadow',
        'color',
        'display',
        'flexDirection',
        'flexWrap',
        'fontFamily',
        'fontSize',
        'fontStyle',
        'fontWeight',
        'gap',
        'gridTemplateColumns',
        'gridTemplateRows',
        'height',
        'justifyContent',
        'letterSpacing',
        'lineHeight',
        'margin',
        'maxHeight',
        'maxWidth',
        'minHeight',
        'minWidth',
        'opacity',
        'overflow',
        'padding',
        'position',
        'textAlign',
        'textDecoration',
        'transform',
        'width',
        'zIndex',
      ].sort(),
    );
  });

  it('assigns unique sequential ids and reports a matching nodeCount', () => {
    const ids = flatten(result.root!).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.nodeCount).toBe(ids.length);
  });

  it('collects img, source, background-image and svg assets', () => {
    const kinds = result.assets.map((asset) => asset.kind);
    expect(kinds).toContain('img');
    expect(kinds).toContain('source');
    expect(kinds).toContain('background-image');
    expect(kinds).toContain('svg');

    expect(result.assets.find((asset) => asset.url === '/logo.png')?.kind).toBe('img');
    expect(result.assets.find((asset) => asset.url === '/banner.webp')?.kind).toBe('source');
    expect(result.assets.find((asset) => asset.kind === 'background-image')?.url).toBe(
      '/hero.jpg',
    );
    expect(result.assets.find((asset) => asset.kind === 'svg')?.url).toBe('/sprite.svg');
  });

  it('reports a total element count that includes ignored tags', () => {
    expect(result.totalElementCount).toBeGreaterThan(result.nodeCount);
  });
});
