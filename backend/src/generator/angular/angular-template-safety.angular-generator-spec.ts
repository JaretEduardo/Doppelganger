import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
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
 * Milestone 4.1 regression: a real Wikipedia capture failed `ng build`
 * because content like `{{CURRENTYEAR}}`, `{{#time: ...}}` and `@`-shaped
 * wikitext inside `data-mw` attributes got misread as Angular template
 * syntax. Verifying this with string assertions alone isn't enough — the
 * bug (and the fix) only show up in the real Angular compiler, so this runs
 * the actual pipeline: fixture -> IR -> AngularGenerator -> `ng build`, then
 * opens the built output and checks the risky content rendered as inert
 * literal text rather than being evaluated or silently dropped.
 */
const VIEWPORT = { width: 1440, height: 900 };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(HERE, 'fixtures/angular-template-safety.fixture.html');
const OUTPUT_DIR = path.resolve(HERE, '../../../output/angular-template-safety');
const PROJECT_NAME = 'doppelganger-template-safety';
const PROJECT_DIR = path.join(OUTPUT_DIR, PROJECT_NAME);
const FRONTEND_NODE_MODULES = path.resolve(HERE, '../../../../frontend/node_modules');

describe('AngularGenerator: robust template neutralization (Milestone 4.1)', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  it(
    'compiles and renders MediaWiki-shaped {{ }} / @if / @for content as literal text',
    async () => {
      await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
      await fs.mkdir(OUTPUT_DIR, { recursive: true });

      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      await page.goto(pathToFileURL(FIXTURE_PATH).href, { waitUntil: 'load' });

      const title = await page.title();
      const extraction = await page.evaluate(extractCapturedPage, IGNORED_TAGS);
      await context.close();

      const capturedPage: CapturedPage = {
        url: pathToFileURL(FIXTURE_PATH).href,
        title,
        viewport: VIEWPORT,
        root: extraction.root,
        assets: extraction.assets,
        nodeCount: extraction.nodeCount,
      };

      await generateAngularProject(capturedPage, PROJECT_DIR, { projectName: PROJECT_NAME });
      await linkNodeModules(PROJECT_DIR, FRONTEND_NODE_MODULES);

      const ngJsPath = path.join(PROJECT_DIR, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');

      // The actual regression check: this must not throw. Before the fix,
      // this step failed with TS2339 ("Property 'CURRENTYEAR' does not
      // exist"), NG5002 ICU/block-parsing errors, or an internal compiler
      // crash ("node.visit is not a function"), depending on which snippet
      // triggered it first.
      await execFileAsync(process.execPath, [ngJsPath, 'build'], {
        cwd: PROJECT_DIR,
        env: { ...process.env, NG_CLI_ANALYTICS: 'false', CI: 'true' },
        maxBuffer: 1024 * 1024 * 20,
      });

      const browserDistDir = path.join(PROJECT_DIR, 'dist', PROJECT_NAME, 'browser');
      const indexHtmlStat = await fs.stat(path.join(browserDistDir, 'index.html'));
      expect(indexHtmlStat.isFile()).toBe(true);

      // Beyond "it compiles": open the real build and confirm the risky
      // content rendered as inert literal text rather than being evaluated,
      // silently dropped, or left encoded (&#123;...) in the visible page.
      const server = await serveStaticDir(browserDistDir);
      try {
        const generatedContext = await browser.newContext({ viewport: VIEWPORT });
        const generatedPage = await generatedContext.newPage();
        await generatedPage.goto(server.url, { waitUntil: 'load' });
        await generatedPage.waitForFunction(
          () => document.querySelector('app-root')?.childNodes.length,
        );

        const bodyText = await generatedPage.textContent('body');

        expect(bodyText).toContain('{{CURRENTYEAR}}');
        expect(bodyText).toContain('{{Portada:Menú | Categoría:Actualidad}}');
        expect(bodyText).toContain('{{#time: j "de" F|-1 day}}');
        expect(bodyText).toContain('Literal {{ hello | pipe }} text');
        expect(bodyText).toContain('{{Efemérides|1 de enero}}');
        expect(bodyText).toContain('Contact us @if you have questions about @for loops.');
        expect(bodyText).toContain('@for (item of items) { do something }');
        expect(bodyText).toContain('The set {1, 2, 3} has three elements.');
        expect(bodyText).toContain(
          'Normal text with braces like {this} should render unchanged visually.',
        );

        // data-mw is metadata, not visual content: dropped entirely, its
        // wikitext JSON must not leak into the page in any form.
        expect(bodyText).not.toContain('"wt"');
        const html = await generatedPage.content();
        expect(html).not.toContain('data-mw');

        await generatedContext.close();
      } finally {
        await server.close();
      }
    },
    180_000,
  );
});
