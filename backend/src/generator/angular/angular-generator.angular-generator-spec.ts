import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CapturedPage } from '../../capture/ir/captured-page.interface.js';
import { extractCapturedPage } from '../../capture/ir/dom-extractor.browser.js';
import { IGNORED_TAGS } from '../../capture/ir/ignored-tags.js';
import { generateAngularProject } from './angular-generator.js';
import { linkNodeModules } from './node-modules-link.js';
import { serveStaticDir } from './static-file-server.js';

const execFileAsync = promisify(execFile);

/**
 * Full pipeline proof: local fixture -> IR -> generated Angular project ->
 * `ng build` -> served build opened in a real browser -> pixel-diffed
 * against the fixture's own render. Separate from `npm test` (see
 * vitest.config.angular-generator.ts) because it shells out to the Angular
 * CLI and is meaningfully slower than a unit test, even with the
 * node_modules reuse strategy below.
 *
 * node_modules strategy: rather than running `npm install` for the generated
 * project (slow, needs network, re-downloads the whole Angular toolchain on
 * every run), this links the generated project's node_modules to
 * frontend/node_modules (see node-modules-link.ts). That's safe specifically
 * because angular-versions.ts pins the exact same versions frontend/ already
 * has installed — so frontend/node_modules already satisfies the generated
 * project's dependency tree exactly. If that ever stops being true (e.g.
 * frontend/ is upgraded and angular-versions.ts isn't), this test's `ng
 * build` step would fail loudly rather than silently building with the wrong
 * versions.
 */
const VIEWPORT = { width: 1440, height: 900 };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(HERE, '../../capture/render/fixtures/complex-page.fixture.html');
const OUTPUT_DIR = path.resolve(HERE, '../../../output/angular');
const PROJECT_NAME = 'generated-project';
const PROJECT_DIR = path.join(OUTPUT_DIR, PROJECT_NAME);
const FRONTEND_NODE_MODULES = path.resolve(HERE, '../../../../frontend/node_modules');

/**
 * Measured baseline for this fixture is ~0.034% (617 / 1,818,720 px) —
 * matching StaticRenderer's own visual test almost exactly, since
 * app.html/app.scss are generated from the exact same
 * renderDocumentBody/renderStyles output (now backed by Milestone 5's full
 * computed-style capture rather than a manual allowlist). 0.5% leaves
 * headroom for minor cross-run rendering jitter without hiding a real
 * regression introduced by the Angular wrapping itself.
 */
const MAX_DIFF_RATIO = 0.005; // 0.5%

describe('AngularGenerator: generate -> ng build -> visual comparison (complex fixture)', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  it(
    'produces a buildable, visually faithful Angular reconstruction of the complex fixture',
    async () => {
      await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
      await fs.mkdir(OUTPUT_DIR, { recursive: true });

      // 1-2. Capture the fixture and extract its IR.
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

      // 3. Generate the Angular project.
      await generateAngularProject(capturedPage, PROJECT_DIR, { projectName: PROJECT_NAME });

      // 4. Prepare dependencies (linked, not reinstalled — see file-level comment).
      await linkNodeModules(PROJECT_DIR, FRONTEND_NODE_MODULES);

      // 5. Run `ng build`.
      const ngJsPath = path.join(PROJECT_DIR, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
      await execFileAsync(process.execPath, [ngJsPath, 'build'], {
        cwd: PROJECT_DIR,
        env: { ...process.env, NG_CLI_ANALYTICS: 'false', CI: 'true' },
        maxBuffer: 1024 * 1024 * 20,
      });

      // 6. Confirm the build actually produced output.
      const browserDistDir = path.join(PROJECT_DIR, 'dist', PROJECT_NAME, 'browser');
      const indexHtmlStat = await fs.stat(path.join(browserDistDir, 'index.html'));
      expect(indexHtmlStat.isFile()).toBe(true);

      // 11. Serve the build locally and screenshot it.
      const server = await serveStaticDir(browserDistDir);
      try {
        const generatedContext = await browser.newContext({ viewport: VIEWPORT });
        const generatedPage = await generatedContext.newPage();
        await generatedPage.goto(server.url, { waitUntil: 'load' });
        // Angular bootstraps asynchronously after the initial HTML load;
        // wait for the host element to actually be populated.
        await generatedPage.waitForFunction(
          () => document.querySelector('app-root')?.childNodes.length,
        );

        const generatedBuffer = await generatedPage.screenshot({
          path: path.join(OUTPUT_DIR, 'angular-generated.png'),
          fullPage: true,
        });
        await generatedContext.close();

        const original = PNG.sync.read(originalBuffer);
        const generated = PNG.sync.read(generatedBuffer);

        expect(generated.width).toBe(original.width);
        expect(generated.height).toBe(original.height);

        const { width, height } = original;
        const diff = new PNG({ width, height });
        const diffPixelCount = pixelmatch(
          original.data,
          generated.data,
          diff.data,
          width,
          height,
          { threshold: 0.1 },
        );
        const totalPixels = width * height;
        const diffRatio = diffPixelCount / totalPixels;

        await fs.writeFile(path.join(OUTPUT_DIR, 'diff.png'), PNG.sync.write(diff));

        // eslint-disable-next-line no-console
        console.log(
          `[angular-generator] ${width}x${height} (${totalPixels} px total) — ` +
            `${diffPixelCount} different pixels (${(diffRatio * 100).toFixed(3)}%), ` +
            `threshold ${(MAX_DIFF_RATIO * 100).toFixed(1)}%`,
        );

        expect(diffRatio).toBeLessThanOrEqual(MAX_DIFF_RATIO);
      } finally {
        await server.close();
      }
    },
    180_000,
  );
});
