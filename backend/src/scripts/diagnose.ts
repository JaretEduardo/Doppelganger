/**
 * Manual diagnostic tool: URL -> IR -> Angular project -> `ng build` ->
 * screenshot both the original page and the generated app -> pixel diff.
 *
 * Not part of `npm test` on purpose — this hits a real, arbitrary URL over
 * the network and shells out to `ng build`, which is exactly what the
 * deterministic/offline test suites deliberately avoid. Use this to check
 * fidelity against real sites (e.g. Wikipedia) without adding network
 * dependence to CI.
 *
 * Deliberately does not go through CaptureService/SsrfGuardService: this is
 * a local CLI tool a developer runs against a URL of their own choosing, not
 * a network-facing endpoint accepting untrusted input — the SSRF threat
 * model this app defends against (a remote caller tricking the server into
 * fetching an internal address) doesn't apply to a script the operator
 * invokes directly on their own machine.
 *
 * Lives under src/ (not backend/scripts/) specifically so `nest build`
 * compiles it with plain tsc — running it through an esbuild-based runner
 * (tried: tsx) injects a `__name` helper around functions, which breaks
 * extractCapturedPage: page.evaluate() only serializes a function's own
 * source text, and that injected helper isn't defined inside the browser.
 *
 * Usage (after `npm run build`):
 *   node dist/scripts/diagnose.js <URL>
 * or via the npm script (builds first):
 *   npm run diagnose -- <URL>
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright';
import type { CapturedPage } from '../capture/ir/captured-page.interface.js';
import { extractCapturedPage } from '../capture/ir/dom-extractor.browser.js';
import { IGNORED_TAGS } from '../capture/ir/ignored-tags.js';
import { generateAngularProject } from '../generator/angular/angular-generator.js';
import { linkNodeModules } from '../generator/angular/node-modules-link.js';
import { serveStaticDir } from '../generator/angular/static-file-server.js';
import { deriveProjectName } from '../generator/project-naming.js';

const execFileAsync = promisify(execFile);
const VIEWPORT = { width: 1440, height: 900 };
const NAVIGATION_TIMEOUT_MS = 30_000;
// Runtime location is dist/scripts/diagnose.js (compiled from src/scripts/),
// so these are resolved relative to *that*, not the .ts source location.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(HERE, '../..');
const FRONTEND_NODE_MODULES = path.resolve(BACKEND_ROOT, '../frontend/node_modules');

function slugForDir(url: string): string {
  // deriveProjectName is already filesystem-safe (see project-naming.ts);
  // reused here purely for a readable, collision-resistant folder name.
  return `${deriveProjectName(url)}-${Date.now()}`;
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npm run diagnose -- <URL>');
    process.exitCode = 1;
    return;
  }

  const outputDir = path.join(BACKEND_ROOT, 'output', 'diagnose', slugForDir(url));
  await fs.mkdir(outputDir, { recursive: true });

  console.log(`Diagnosing ${url}`);
  console.log(`Output directory: ${outputDir}\n`);

  const browser = await chromium.launch();
  try {
    console.log('[1/5] Capturing the original page...');
    const captureContext = await browser.newContext({ viewport: VIEWPORT });
    const capturePage = await captureContext.newPage();
    await capturePage.goto(url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });

    const title = await capturePage.title();
    const extraction = await capturePage.evaluate(extractCapturedPage, IGNORED_TAGS);
    const originalPath = path.join(outputDir, 'original.png');
    await capturePage.screenshot({ path: originalPath, fullPage: true });
    await captureContext.close();

    console.log(`   ${extraction.nodeCount} IR nodes, ${extraction.assets.length} assets captured.`);

    const capturedPage: CapturedPage = {
      url,
      title,
      viewport: VIEWPORT,
      root: extraction.root,
      assets: extraction.assets,
      nodeCount: extraction.nodeCount,
    };

    console.log('[2/5] Generating the Angular project...');
    const projectName = deriveProjectName(url);
    const projectDir = path.join(outputDir, 'project');
    await generateAngularProject(capturedPage, projectDir, { projectName });

    console.log('[3/5] Linking dependencies and running `ng build`...');
    await linkNodeModules(projectDir, FRONTEND_NODE_MODULES);
    const ngJsPath = path.join(projectDir, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
    await execFileAsync(process.execPath, [ngJsPath, 'build'], {
      cwd: projectDir,
      env: {
        ...process.env,
        NG_CLI_ANALYTICS: 'false',
        CI: 'true',
        // Milestone 5 captures every enumerable computed style property
        // instead of ~40 curated ones, so a large real page's app.scss can
        // be tens of MB — the esbuild/sass worker that processes it runs
        // out of heap under Node's default limit on pages like a full
        // Wikipedia article. This is a resource accommodation for the
        // current "capture everything, dedupe later" tradeoff (explicitly
        // deferred per the Milestone 5 brief), not a fix to that tradeoff.
        NODE_OPTIONS: '--max-old-space-size=8192',
      },
      maxBuffer: 1024 * 1024 * 20,
    });

    console.log('[4/5] Serving the generated build and capturing a screenshot...');
    const browserDistDir = path.join(projectDir, 'dist', projectName, 'browser');
    const server = await serveStaticDir(browserDistDir);
    const generatedPath = path.join(outputDir, 'generated.png');
    try {
      const generatedContext = await browser.newContext({ viewport: VIEWPORT });
      const generatedPage = await generatedContext.newPage();
      await generatedPage.goto(server.url, { waitUntil: 'load' });
      await generatedPage.waitForFunction(
        () => document.querySelector('app-root')?.childNodes.length,
      );
      await generatedPage.screenshot({ path: generatedPath, fullPage: true });
      await generatedContext.close();
    } finally {
      await server.close();
    }

    console.log('[5/5] Comparing screenshots...\n');
    const original = PNG.sync.read(await fs.readFile(originalPath));
    const generated = PNG.sync.read(await fs.readFile(generatedPath));

    const sameSize = original.width === generated.width && original.height === generated.height;
    let diffPixelCount: number | null = null;
    let diffPath: string | null = null;

    if (sameSize) {
      const { width, height } = original;
      const diff = new PNG({ width, height });
      diffPixelCount = pixelmatch(original.data, generated.data, diff.data, width, height, {
        threshold: 0.1,
      });
      diffPath = path.join(outputDir, 'diff.png');
      await fs.writeFile(diffPath, PNG.sync.write(diff));
    }

    console.log('=== Diagnosis report ===');
    console.log(`URL:                ${url}`);
    console.log(`Original size:      ${original.width}x${original.height}`);
    console.log(`Generated size:     ${generated.width}x${generated.height}`);
    if (diffPixelCount !== null) {
      const totalPixels = original.width * original.height;
      const ratio = (diffPixelCount / totalPixels) * 100;
      console.log(
        `Different pixels:   ${diffPixelCount} / ${totalPixels} (${ratio.toFixed(4)}%)`,
      );
    } else {
      console.log('Different pixels:   N/A — original and generated dimensions differ.');
    }
    console.log('');
    console.log(`Original screenshot:  ${originalPath}`);
    console.log(`Generated screenshot: ${generatedPath}`);
    if (diffPath) console.log(`Diff image:           ${diffPath}`);
    console.log(`Angular project:      ${projectDir}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error('\nDiagnosis failed:', error);
  process.exitCode = 1;
});
