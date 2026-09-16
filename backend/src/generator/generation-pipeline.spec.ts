import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { Browser, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CapturedPage } from '../capture/ir/captured-page.interface.js';
import { extractCapturedPage } from '../capture/ir/dom-extractor.browser.js';
import { IGNORED_TAGS } from '../capture/ir/ignored-tags.js';
import { generateAngularProject } from './angular/angular-generator.js';
import { zipFiles } from './zip/zip-builder.js';

/**
 * Proves the full local pipeline — fixture -> IR -> AngularGenerator -> ZIP
 * — without going through CaptureService/HTTP (SSRF guarding a real
 * navigation is CaptureService's job and is tested separately) and without
 * needing `npm install`/`ng build` (that's test:angular-generator's job).
 * Fully offline and deterministic, so it belongs in the default `npm test`
 * run — same pattern as dom-extractor.spec.ts, which also launches a real
 * Chromium against a local fixture.
 */
const VIEWPORT = { width: 1440, height: 900 };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(HERE, '../capture/render/fixtures/complex-page.fixture.html');

describe('generation pipeline: fixture -> IR -> AngularGenerator -> ZIP', () => {
  let browser: Browser;
  let tempDir: string;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('generates a ZIP containing a valid Angular project from a local fixture', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dg-generation-pipeline-'));

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

    const projectName = 'doppelganger-fixture-test';
    const projectDir = path.join(tempDir, 'project');
    const project = await generateAngularProject(capturedPage, projectDir, { projectName });

    const buffer = await zipFiles(projectDir, project.files, projectName);
    const zip = await JSZip.loadAsync(buffer);
    const entryNames = Object.keys(zip.files).sort();

    expect(entryNames).toEqual(
      [
        'package.json',
        'angular.json',
        'tsconfig.json',
        'tsconfig.app.json',
        'src/index.html',
        'src/main.ts',
        'src/styles.scss',
        'src/app/app.ts',
        'src/app/app.html',
        'src/app/app.scss',
      ]
        .map((file) => `${projectName}/${file}`)
        .sort(),
    );

    // No test/build tooling artifact should ever end up in the archive.
    expect(entryNames.some((name) => /node_modules|dist\/|\.git\//.test(name))).toBe(false);

    const appHtml = await zip.file(`${projectName}/src/app/app.html`)!.async('string');
    expect(appHtml).toContain('Doppelganger');
    expect(appHtml).toContain('id="dg-n1"');
    expect(appHtml).not.toContain('<body');
    expect(appHtml).not.toContain('onclick');
    expect(appHtml).not.toContain('javascript:');

    const appScss = await zip.file(`${projectName}/src/app/app.scss`)!.async('string');
    expect(appScss).toContain('#dg-n0 {');

    const appTs = await zip.file(`${projectName}/src/app/app.ts`)!.async('string');
    expect(appTs).toContain("id: 'dg-n0'");

    const packageJson = JSON.parse(
      await zip.file(`${projectName}/package.json`)!.async('string'),
    );
    expect(packageJson.name).toBe(projectName);
  });
});
