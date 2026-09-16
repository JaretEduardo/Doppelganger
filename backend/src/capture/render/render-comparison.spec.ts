import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CapturedPage } from '../ir/captured-page.interface.js';
import { extractCapturedPage } from '../ir/dom-extractor.browser.js';
import { IGNORED_TAGS } from '../ir/ignored-tags.js';
import { renderCapturedPage } from './static-renderer.js';
import { writeRenderedPage } from './render-output-writer.js';

/**
 * End-to-end proof that extractor -> IR -> renderer round-trips a real page:
 * capture example.com, render it statically, then open the rendered output
 * in a real browser and screenshot both for visual comparison. This is
 * intentionally not a pixel-diff assertion (no automatic visual correction
 * yet, per Milestone 2 scope) — it just proves the pipeline produces a
 * loadable, non-empty reconstruction and writes both screenshots to `output/`
 * for a human to compare.
 */
const VIEWPORT = { width: 1440, height: 900 };
const TARGET_URL = 'https://example.com';
const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../output');

describe('renderer vs. original capture (example.com)', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  it(
    'renders a static reconstruction that loads and preserves the page title and body text',
    async () => {
      await fs.mkdir(OUTPUT_DIR, { recursive: true });

      const originalContext = await browser.newContext({ viewport: VIEWPORT });
      const originalPage = await originalContext.newPage();
      await originalPage.goto(TARGET_URL, { waitUntil: 'load', timeout: 30_000 });

      const title = await originalPage.title();
      const extraction = await originalPage.evaluate(extractCapturedPage, IGNORED_TAGS);
      await originalPage.screenshot({
        path: path.join(OUTPUT_DIR, 'original.png'),
        fullPage: true,
      });
      const originalBodyText = await originalPage.textContent('body');
      await originalContext.close();

      const capturedPage: CapturedPage = {
        url: TARGET_URL,
        title,
        viewport: VIEWPORT,
        root: extraction.root,
        assets: extraction.assets,
        nodeCount: extraction.nodeCount,
      };

      const rendered = renderCapturedPage(capturedPage);
      expect(rendered.html).toContain('id="dg-n0"');
      expect(rendered.css).toContain('#dg-n0');

      const { htmlPath } = await writeRenderedPage(rendered, OUTPUT_DIR);

      const renderedContext = await browser.newContext({ viewport: VIEWPORT });
      const renderedPage = await renderedContext.newPage();
      await renderedPage.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });

      await renderedPage.screenshot({
        path: path.join(OUTPUT_DIR, 'generated.png'),
        fullPage: true,
      });

      expect(await renderedPage.title()).toBe(title);

      const generatedBodyText = await renderedPage.textContent('body');
      expect(generatedBodyText?.replace(/\s+/g, ' ').trim()).toBe(
        originalBodyText?.replace(/\s+/g, ' ').trim(),
      );

      await renderedContext.close();
    },
    60_000,
  );
});
