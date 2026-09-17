import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CapturedPage } from '../ir/captured-page.interface.js';
import { extractCapturedPage } from '../ir/dom-extractor.browser.js';
import { IGNORED_TAGS } from '../ir/ignored-tags.js';
import { renderCapturedPage } from './static-renderer.js';
import { writeRenderedPage } from './render-output-writer.js';

/**
 * Renders a considerably more complex, fully local/deterministic fixture
 * (header, sidebar, CSS grid, flexbox, cards, table, form, inline SVG,
 * background-image, absolute positioning...) through the full
 * extractor -> IR -> static renderer pipeline, then does a real pixel diff
 * between the original render and the reconstruction. Unlike
 * render-comparison.integration-spec.ts, this never touches the network.
 */
const VIEWPORT = { width: 1440, height: 900 };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(HERE, 'fixtures', 'complex-page.fixture.html');
const OUTPUT_DIR = path.resolve(HERE, '../../../output/visual');

/**
 * Maximum allowed share of mismatched pixels between the original fixture
 * render and the Doppelganger reconstruction. Kept above 0 deliberately:
 * ordinary font anti-aliasing jitter produces a small, real, non-zero diff
 * even with a pixel-perfect style capture.
 *
 * Milestone 5 replaced the ~40-property manual allowlist with a full dump of
 * every enumerable computed CSS property (see captured-page.interface.ts),
 * so gaps like the old "vertical-align isn't captured" are gone by
 * construction rather than fixed one property at a time. The fixture also
 * grew a dedicated grid/flex/logical-properties section (Milestone 5).
 * Measured baseline after both changes is ~0.034% (~620 / 1.8M pixels) —
 * comparable to the pre-Milestone-5 ~0.01% given the fixture is now larger
 * and exercises more layout modes. 0.5% leaves a comfortable margin above
 * that for minor cross-run rendering jitter without hiding a real
 * regression.
 */
const MAX_DIFF_RATIO = 0.005; // 0.5%

describe('visual comparison: complex fixture vs. Doppelganger reconstruction', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  it(
    'reconstructs the complex fixture within the pixel-diff threshold',
    async () => {
      await fs.mkdir(OUTPUT_DIR, { recursive: true });

      const originalContext = await browser.newContext({ viewport: VIEWPORT });
      const originalPage = await originalContext.newPage();
      await originalPage.goto(pathToFileURL(FIXTURE_PATH).href, { waitUntil: 'load' });

      const title = await originalPage.title();
      const extraction = await originalPage.evaluate(extractCapturedPage, IGNORED_TAGS);
      const originalBuffer = await originalPage.screenshot({
        path: path.join(OUTPUT_DIR, 'original.png'),
        fullPage: true,
      });
      await originalContext.close();

      const capturedPage: CapturedPage = {
        url: pathToFileURL(FIXTURE_PATH).href,
        title,
        viewport: VIEWPORT,
        root: extraction.root,
        assets: extraction.assets,
        nodeCount: extraction.nodeCount,
      };

      const rendered = renderCapturedPage(capturedPage);
      const { htmlPath } = await writeRenderedPage(rendered, OUTPUT_DIR);

      const generatedContext = await browser.newContext({ viewport: VIEWPORT });
      const generatedPage = await generatedContext.newPage();
      await generatedPage.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });

      const generatedBuffer = await generatedPage.screenshot({
        path: path.join(OUTPUT_DIR, 'generated.png'),
        fullPage: true,
      });
      await generatedContext.close();

      const original = PNG.sync.read(originalBuffer);
      const generated = PNG.sync.read(generatedBuffer);

      expect(generated.width).toBe(original.width);
      expect(generated.height).toBe(original.height);

      const { width, height } = original;
      const diff = new PNG({ width, height });

      const diffPixelCount = pixelmatch(original.data, generated.data, diff.data, width, height, {
        threshold: 0.1,
      });

      const totalPixels = width * height;
      const diffRatio = diffPixelCount / totalPixels;

      await fs.writeFile(path.join(OUTPUT_DIR, 'diff.png'), PNG.sync.write(diff));

      // eslint-disable-next-line no-console
      console.log(
        `[visual] ${width}x${height} (${totalPixels} px total) — ${diffPixelCount} ` +
          `different pixels (${(diffRatio * 100).toFixed(3)}%), threshold ${(
            MAX_DIFF_RATIO * 100
          ).toFixed(1)}%`,
      );

      expect(diffRatio).toBeLessThanOrEqual(MAX_DIFF_RATIO);
    },
    60_000,
  );
});
