import { Browser, chromium, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractCapturedPage, BrowserExtractionResult } from './dom-extractor.browser.js';
import { IGNORED_TAGS } from './ignored-tags.js';
import { CapturedElementNode, CapturedNode } from './captured-page.interface.js';

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
      <p class="mixed">Hello <strong>Jaret</strong>, welcome back.</p>
      <p class="lead-only">Lead text <em>only-before</em></p>
      <p class="trail-only"><em>only-after</em> Trailing text</p>
      <div class="nested">
        <span class="outer">Outer <span class="inner">Inner</span> text</span>
      </div>
      <p class="whitespace">
        Line one
        Line two
      </p>
      <div class="only-ws">   <span>A</span>   <span>B</span>   </div>
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
  if (node.kind === 'text') return [node];
  return [node, ...node.children.flatMap(flatten)];
}

function findElement(
  root: CapturedElementNode,
  predicate: (node: CapturedElementNode) => boolean,
): CapturedElementNode {
  const match = flatten(root).find(
    (node): node is CapturedElementNode => node.kind === 'element' && predicate(node),
  );
  if (!match) throw new Error('Element not found in captured tree');
  return match;
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
    const tags = flatten(result.root!)
      .filter((node): node is CapturedElementNode => node.kind === 'element')
      .map((node) => node.tag);
    for (const ignoredTag of IGNORED_TAGS) {
      expect(tags).not.toContain(ignoredTag);
    }
  });

  it('preserves exact DOM order for interleaved text and elements', () => {
    const mixed = findElement(result.root!, (node) => node.attributes['class'] === 'mixed');

    expect(mixed.children.map((child) => child.kind)).toEqual(['text', 'element', 'text']);

    const [before, strongEl, after] = mixed.children;
    expect(before).toMatchObject({ kind: 'text', text: 'Hello ' });
    expect(strongEl).toMatchObject({ kind: 'element', tag: 'strong' });
    expect((strongEl as CapturedElementNode).children).toEqual([
      { kind: 'text', id: expect.any(String), text: 'Jaret' },
    ]);
    expect(after).toMatchObject({ kind: 'text', text: ', welcome back.' });
  });

  it('keeps text that comes before an element with no trailing text', () => {
    const leadOnly = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'lead-only',
    );

    expect(leadOnly.children.map((child) => child.kind)).toEqual(['text', 'element']);
    expect(leadOnly.children[0]).toMatchObject({ kind: 'text', text: 'Lead text ' });
    expect(leadOnly.children[1]).toMatchObject({ kind: 'element', tag: 'em' });
  });

  it('keeps text that comes after an element with no leading text', () => {
    const trailOnly = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'trail-only',
    );

    expect(trailOnly.children.map((child) => child.kind)).toEqual(['element', 'text']);
    expect(trailOnly.children[0]).toMatchObject({ kind: 'element', tag: 'em' });
    expect(trailOnly.children[1]).toMatchObject({ kind: 'text', text: ' Trailing text' });
  });

  it('preserves order through nested elements', () => {
    const outer = findElement(result.root!, (node) => node.attributes['class'] === 'outer');

    expect(outer.children.map((child) => child.kind)).toEqual(['text', 'element', 'text']);
    expect(outer.children[0]).toMatchObject({ kind: 'text', text: 'Outer ' });
    expect(outer.children[2]).toMatchObject({ kind: 'text', text: ' text' });

    const inner = outer.children[1] as CapturedElementNode;
    expect(inner.tag).toBe('span');
    expect(inner.attributes['class']).toBe('inner');
    expect(inner.children).toEqual([{ kind: 'text', id: expect.any(String), text: 'Inner' }]);
  });

  it('normalizes internal whitespace without dropping content', () => {
    const whitespaceNode = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'whitespace',
    );

    expect(whitespaceNode.children).toHaveLength(1);
    expect(whitespaceNode.children[0]).toMatchObject({
      kind: 'text',
      text: ' Line one Line two ',
    });
  });

  it('drops edge whitespace-only text but keeps whitespace needed between inline siblings', () => {
    const onlyWs = findElement(result.root!, (node) => node.attributes['class'] === 'only-ws');

    expect(onlyWs.children.map((child) => child.kind)).toEqual(['element', 'text', 'element']);
    expect(onlyWs.children[1]).toMatchObject({ kind: 'text', text: ' ' });
  });

  it('captures element attributes', () => {
    const rootDiv = findElement(result.root!, (node) => node.attributes['id'] === 'root');
    expect(rootDiv.attributes['class']).toBe('container');
  });

  it('captures a bounding rect for every element node', () => {
    const elements = flatten(result.root!).filter(
      (node): node is CapturedElementNode => node.kind === 'element',
    );
    for (const node of elements) {
      expect(typeof node.rect.width).toBe('number');
      expect(typeof node.rect.height).toBe('number');
    }
  });

  it('captures exactly the requested computed style properties', () => {
    const hero = findElement(result.root!, (node) => node.attributes['class'] === 'hero');

    expect(hero.styles.width).toBe('200px');
    expect(Object.keys(hero.styles).sort()).toEqual(
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

  it('assigns unique, stable ids and reports a matching nodeCount', () => {
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

  it('reports a total element count at least as large as the kept element nodes', () => {
    const elementNodeCount = flatten(result.root!).filter(
      (node) => node.kind === 'element',
    ).length;
    expect(result.totalElementCount).toBeGreaterThanOrEqual(elementNodeCount);
  });
});
