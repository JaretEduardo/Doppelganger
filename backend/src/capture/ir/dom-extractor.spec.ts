import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
    <style>
      .hero { color: red; }
      .before-after-demo::before { content: "→ "; color: rgb(200, 0, 0); }
      .before-after-demo::after { content: " ←"; color: rgb(0, 0, 200); }
      .no-pseudo-content::before { content: none; }
      .marker-demo li::marker { content: "* "; color: rgb(0, 128, 0); }
    </style>
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
      <div class="border-box-demo" style="box-sizing: border-box; width: 100px; padding: 10px; border: 2px solid black;"></div>
      <div class="positioned-parent" style="position: relative; width: 40px; height: 40px;">
        <span class="positioned-badge" style="position: absolute; top: 2px; right: -6px; bottom: auto; left: auto;"></span>
      </div>
      <div class="border-bottom-only" style="border-bottom: 3px solid rgb(1, 2, 3);"></div>
      <ul class="no-bullets" style="list-style: none;"><li>Item</li></ul>
      <svg><use href="/sprite.svg#icon-check"></use></svg>
      <noscript>No JS</noscript>
      <template><span>Ignored template content</span></template>

      <div class="custom-prop-root" style="--brand-color: rebeccapurple;">
        <div class="custom-prop-child" style="color: var(--brand-color);"></div>
      </div>

      <div class="grid-parent" style="display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-flow: dense;">
        <div class="grid-item" style="grid-column: 2 / 4; grid-row: 1;"></div>
        <div class="grid-area-item" style="grid-area: 2 / 1 / 3 / 2;"></div>
      </div>

      <div class="flex-parent" style="display: flex;">
        <div class="flex-item" style="flex-grow: 2; flex-shrink: 0; flex-basis: 30%; order: 3; align-self: flex-end;"></div>
        <div class="justify-self-item" style="justify-self: end;"></div>
      </div>

      <div
        class="modern-layout"
        style="float: left; clear: both; vertical-align: middle; white-space: pre-wrap; text-indent: 2em; overflow-x: scroll; overflow-y: hidden; visibility: hidden; margin-inline-start: 12px;"
      ></div>

      <img
        class="object-fit-demo"
        alt="Photo"
        src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='9'><rect width='16' height='9' fill='rgb(100,100,200)'/></svg>"
        style="object-fit: cover; object-position: top; aspect-ratio: 16 / 9; width: 200px; height: 100px;"
      />

      <p class="before-after-demo">Text with pseudo</p>
      <p class="no-pseudo-content">No pseudo here</p>
      <ul class="marker-demo"><li>Item</li></ul>
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

  it('captures hundreds of real (kebab-case) computed CSS properties, not a curated allowlist', () => {
    // Milestone 5: replaced the ~40-property manual allowlist with a full
    // dump of CSSStyleDeclaration's indexed enumeration. This asserts the
    // new breadth (hundreds of properties) and spot-checks a sample of
    // well-known longhands rather than an exhaustive key list, since the
    // exact count/set is however many properties this Chromium version
    // exposes — pinning it exactly would make the test brittle across
    // browser upgrades for no real benefit.
    const hero = findElement(result.root!, (node) => node.attributes['class'] === 'hero');

    expect(hero.styles['width']).toBe('200px');
    expect(Object.keys(hero.styles).length).toBeGreaterThan(300);
    for (const knownLonghand of [
      'display',
      'position',
      'color',
      'background-color',
      'font-family',
      'font-size',
      'margin-top',
      'padding-left',
      'border-top-width',
      'z-index',
    ]) {
      expect(hero.styles).toHaveProperty(knownLonghand);
    }
    // Shorthands are NOT individually enumerable in Chromium — their
    // longhands (asserted above) carry the same information losslessly.
    expect(hero.styles).not.toHaveProperty('margin');
    expect(hero.styles).not.toHaveProperty('border');
  });

  it('captures box-sizing, since width/padding alone are ambiguous without it', () => {
    // A border-box element's computed `width` already includes its padding and
    // border (100px stays 100px total) — reproducing that width under the
    // renderer's default content-box would make the element render ~24px
    // wider (100 + 2*10 padding + 2*2 border). Regression test for the fixed
    // pixel-diff discovered via the complex visual fixture (Milestone 2.5).
    const borderBoxDemo = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'border-box-demo',
    );

    expect(borderBoxDemo.styles['box-sizing']).toBe('border-box');
    expect(borderBoxDemo.styles['width']).toBe('100px');
  });

  it('captures top/right/bottom/left offsets for absolutely positioned elements', () => {
    // Regression test: `position: absolute` alone is not enough to place an
    // element — without its offsets it renders at its static position
    // instead of the intended corner. Found via the complex visual fixture's
    // avatar status dot and card "New" ribbon both landing in the wrong spot
    // (Milestone 2.5).
    const badge = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'positioned-badge',
    );

    expect(badge.styles['position']).toBe('absolute');
    expect(badge.styles['top']).toBe('2px');
    expect(badge.styles['right']).toBe('-6px');
    // bottom/left were left as `auto` in the source, but the browser resolves
    // them to a used pixel value here since the containing block's size is
    // definite (CSSOM resolved-value rules) — asserting they're captured as
    // *some* concrete value, not necessarily the literal string "auto".
    expect(badge.styles['bottom']).toMatch(/^-?\d+(\.\d+)?px$/);
    expect(badge.styles['left']).toMatch(/^-?\d+(\.\d+)?px$/);
  });

  it('captures border per-side longhands, since the shorthand is empty for non-uniform borders', () => {
    // Regression test: getComputedStyle().border (the shorthand) resolves to
    // an empty string unless all four sides share the same width/style/color
    // — an extremely common case being a border-bottom-only divider (table
    // rows). Milestone 5 captures the true longhands (border-*-width/style/
    // color) directly, which are always independently well-defined
    // regardless of the other sides — a more robust fix than Milestone 2.5's
    // composite `border-bottom` value. Found via the complex visual
    // fixture's "Recent activity" table.
    const el = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'border-bottom-only',
    );

    expect(el.styles['border-bottom-width']).toBe('3px');
    expect(el.styles['border-bottom-style']).toBe('solid');
    expect(el.styles['border-bottom-color']).toBe('rgb(1, 2, 3)');
    expect(el.styles['border-top-style']).toBe('none');
  });

  it('captures list-style-type, since a reset list otherwise reappears with default bullets', () => {
    // Regression test: `list-style: none` (near-universal on nav/feature
    // lists) wasn't captured, so reconstructed <li>s fell back to the
    // browser's default disc bullets. Found via the complex visual fixture's
    // sidebar nav and card feature lists (Milestone 2.5).
    const list = findElement(result.root!, (node) => node.attributes['class'] === 'no-bullets');
    expect(list.styles['list-style-type']).toBe('none');
  });

  it('captures CSS custom properties (--foo), including inherited values', () => {
    const root = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'custom-prop-root',
    );
    const child = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'custom-prop-child',
    );

    expect(root.styles['--brand-color']).toBe('rebeccapurple');
    // Custom properties inherit like `color` does; the child never sets
    // --brand-color itself but still reports the inherited value.
    expect(child.styles['--brand-color']).toBe('rebeccapurple');
    expect(child.styles['color']).toBe('rgb(102, 51, 153)');
  });

  it('captures modern grid placement and auto-flow', () => {
    const parent = findElement(result.root!, (node) => node.attributes['class'] === 'grid-parent');
    const item = findElement(result.root!, (node) => node.attributes['class'] === 'grid-item');
    const areaItem = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'grid-area-item',
    );

    expect(parent.styles['grid-auto-flow']).toBe('dense');
    expect(item.styles['grid-column-start']).toBe('2');
    expect(item.styles['grid-column-end']).toBe('4');
    expect(item.styles['grid-row-start']).toBe('1');
    expect(areaItem.styles['grid-row-start']).toBe('2');
    expect(areaItem.styles['grid-column-start']).toBe('1');
  });

  it('captures flex sizing, order and alignment', () => {
    const item = findElement(result.root!, (node) => node.attributes['class'] === 'flex-item');
    const justifySelfItem = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'justify-self-item',
    );

    expect(item.styles['flex-grow']).toBe('2');
    expect(item.styles['flex-shrink']).toBe('0');
    expect(item.styles['flex-basis']).toBe('30%');
    expect(item.styles['order']).toBe('3');
    expect(item.styles['align-self']).toBe('flex-end');
    expect(justifySelfItem.styles['justify-self']).toBe('end');
  });

  it('captures float/clear, vertical-align, white-space, text-indent, overflow-x/y, visibility and logical properties', () => {
    const el = findElement(result.root!, (node) => node.attributes['class'] === 'modern-layout');

    expect(el.styles['float']).toBe('left');
    expect(el.styles['clear']).toBe('both');
    expect(el.styles['vertical-align']).toBe('middle');
    expect(el.styles['white-space-collapse']).toBe('preserve');
    expect(el.styles['text-wrap-mode']).toBe('wrap');
    expect(el.styles['text-indent']).toBe('32px');
    expect(el.styles['overflow-x']).toBe('scroll');
    expect(el.styles['overflow-y']).toBe('hidden');
    expect(el.styles['visibility']).toBe('hidden');
    expect(el.styles['margin-inline-start']).toBe('12px');
  });

  it('captures object-fit/object-position and aspect-ratio on a replaced element', () => {
    const img = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'object-fit-demo',
    );

    expect(img.styles['object-fit']).toBe('cover');
    expect(img.styles['object-position']).toBe('50% 0%');
    expect(img.styles['aspect-ratio']).toBe('16 / 9');
  });

  it('captures ::before/::after with their content and computed styles', () => {
    const el = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'before-after-demo',
    );

    expect(el.pseudoElements).toBeDefined();
    const before = el.pseudoElements!.find((p) => p.kind === 'before');
    const after = el.pseudoElements!.find((p) => p.kind === 'after');

    expect(before?.styles['content']).toBe('"→ "');
    expect(before?.styles['color']).toBe('rgb(200, 0, 0)');
    expect(after?.styles['content']).toBe('" ←"');
    expect(after?.styles['color']).toBe('rgb(0, 0, 200)');
  });

  it('does not capture a pseudo-element when content is none', () => {
    const el = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'no-pseudo-content',
    );
    expect(el.pseudoElements).toBeUndefined();
  });

  it('captures ::marker with custom content, distinct from the default browser marker', () => {
    const list = findElement(result.root!, (node) => node.attributes['class'] === 'marker-demo');
    const item = list.children.find(
      (child): child is CapturedElementNode => child.kind === 'element' && child.tag === 'li',
    )!;

    expect(item.pseudoElements).toBeDefined();
    const marker = item.pseudoElements!.find((p) => p.kind === 'marker');
    expect(marker?.styles['content']).toBe('"* "');
    expect(marker?.styles['color']).toBe('rgb(0, 128, 0)');
  });

  it('does not capture ::marker on an element whose marker is just the browser default', () => {
    // content: normal for ::marker means "use the browser's default
    // bullet/number" — that's not a custom pseudo-element to reproduce, the
    // element's own list-style-type already covers it.
    const plainList = findElement(
      result.root!,
      (node) => node.attributes['class'] === 'no-bullets',
    );
    const item = plainList.children.find(
      (child): child is CapturedElementNode => child.kind === 'element' && child.tag === 'li',
    )!;
    expect(item.pseudoElements).toBeUndefined();
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

describe('extractCapturedPage — CSS url() normalization', () => {
  // page.setContent() (used by the suite above) leaves document.baseURI as
  // "about:blank", against which relative URLs don't meaningfully resolve —
  // so this needs a page actually navigated to a real (file://) URL, unlike
  // every other test in this file.
  const FIXTURE_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    'fixtures/url-resolution.fixture.html',
  );

  let browser: Browser;
  let result: BrowserExtractionResult;

  beforeAll(async () => {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pathToFileURL(FIXTURE_PATH).href, { waitUntil: 'load' });
    result = await page.evaluate(extractCapturedPage, IGNORED_TAGS);
  });

  afterAll(async () => {
    await browser.close();
  });

  function findByTestId(id: string): CapturedElementNode {
    const match = flatten(result.root!).find(
      (node): node is CapturedElementNode => node.kind === 'element' && node.attributes['id'] === id,
    );
    if (!match) throw new Error(`Element #${id} not found`);
    return match;
  }

  it('resolves a document-relative background-image URL to an absolute one', () => {
    const el = findByTestId('bg-document-relative');
    expect(el.styles['background-image']).toBe(
      `url("${pathToFileURL(path.join(path.dirname(FIXTURE_PATH), 'relative-image.png')).href}")`,
    );
  });

  it('resolves a root-relative background-image URL against the origin', () => {
    const el = findByTestId('bg-root-relative');
    // Root-relative from a file:// URL resolves against the filesystem root.
    expect(el.styles['background-image']).toMatch(/^url\("file:\/\/.*\/root-relative-image\.png"\)$/);
    expect(el.styles['background-image']).not.toContain("'/root-relative-image.png'");
  });

  it('resolves a relative list-style-image URL to an absolute one', () => {
    const el = findByTestId('li-image');
    expect(el.styles['list-style-image']).toBe(
      `url("${pathToFileURL(path.join(path.dirname(FIXTURE_PATH), 'bullet.png')).href}")`,
    );
  });

  it('leaves a data: URI untouched (already absolute, nothing to resolve)', () => {
    const el = findByTestId('bg-data-uri');
    expect(el.styles['background-image']).toContain('url("data:image/svg+xml');
    expect(el.styles['background-image']).not.toContain('file://');
  });
});
