import type { CapturedPage } from '../../capture/ir/captured-page.interface.js';
import { escapeHtml } from '../../capture/render/html-utils.js';
import { renderDocumentBody, renderStyles, toDomId } from '../../capture/render/static-renderer.js';
import { ANGULAR_VERSIONS } from './angular-versions.js';

/**
 * Neutralizes captured content that would otherwise be misread as Angular
 * template syntax. Verified empirically against the real Angular compiler
 * (see angular-template-safety.angular-generator-spec.ts) rather than
 * assumed — Milestone 4 shipped with only the entity-encoding below, which
 * turned out to be insufficient on its own (a real Wikipedia capture failed
 * to compile). There are two *independent* hazards here, each needing its
 * own defense; neither alone is enough:
 *
 * 1. `{{ ... }}` interpolation (e.g. MediaWiki's `{{CURRENTYEAR}}`,
 *    `{{#time: ...}}`). Entity-encoding the braces does NOT stop this:
 *    Angular decodes HTML entities as part of normal text/attribute
 *    tokenization and then scans the *decoded* value for `{{...}}`, so
 *    `&#123;&#123;` still comes back as literal `{{` before the
 *    interpolation check runs. The actual fix is wrapping the rendered body
 *    in `<ng-container ngNonBindable>` (see {@link buildAppHtml}), which
 *    tells Angular not to extract bindings from that subtree at all —
 *    `<ng-container>` never renders as a real DOM element, so it can't
 *    affect layout.
 *
 * 2. Literal text shaped like Angular's own syntax: an `@`-led sequence
 *    that happens to look like a control-flow block (`@if (x) { ... }`,
 *    plausible in running text, e.g. "email me @if you have questions"), or
 *    a lone/unbalanced `{`/`}` that Angular's ICU (plural/select) message
 *    parser tries to parse as the start of an expression. Both are detected
 *    by the lexer scanning *raw, undecoded* characters to classify the
 *    content, before `ngNonBindable`'s scope even applies — confirmed by
 *    testing that a literal `@if (x) { ... }` inside
 *    `<ng-container ngNonBindable>` still crashes the compiler. Entity-
 *    encoding `@`, `{` and `}` *does* work here, precisely because the
 *    raw-character prescan never sees a literal `@`/`{`/`}` to trigger on.
 *
 * Applied to the whole rendered HTML string (covering both text content and
 * attribute values — block/ICU misdetection turned out to be text-content-
 * only in testing, but encoding both uniformly is simpler than special-
 * casing and costs nothing, since entities round-trip losslessly either way).
 */
function neutralizeAngularTemplateSyntax(html: string): string {
  return html.replace(/@/g, '&#64;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

export function buildAppHtml(page: CapturedPage): string {
  const body = neutralizeAngularTemplateSyntax(renderDocumentBody(page));
  return `<ng-container ngNonBindable>${body}</ng-container>\n`;
}

/**
 * Identical CSS to what StaticRenderer would write to styles.css — same
 * `renderStyles` call, just saved under app.scss instead. `ViewEncapsulation.None`
 * on the component (see {@link buildAppComponentTs}) is what makes these
 * plain `#dg-<id>` selectors behave the same as global CSS despite living in
 * a component stylesheet.
 */
export function buildAppScss(page: CapturedPage): string {
  return renderStyles(page);
}

export function buildAppComponentTs(page: CapturedPage): string {
  const hostId = page.root ? toDomId(page.root.id) : null;
  const host = hostId ? `\n  host: {\n    id: '${hostId}',\n  },` : '';

  return `import { Component, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  encapsulation: ViewEncapsulation.None,${host}
})
export class App {}
`;
}

export function buildMainTs(): string {
  return `import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';

bootstrapApplication(App).catch((err) => console.error(err));
`;
}

export function buildIndexHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <app-root></app-root>
</body>
</html>
`;
}

/**
 * The one bit of global (unencapsulated) CSS the generated app needs: without
 * it, the browser's default 8px <body> margin would offset everything inside
 * <app-root> by 8px, since <app-root> lives inside a *real* <body> tag here
 * (unlike StaticRenderer's output, where the captured root IS the <body>
 * tag, so its own captured margin is the only one in play).
 */
export function buildGlobalStyles(): string {
  return `body {
  margin: 0;
}
`;
}

export function buildPackageJson(projectName: string): string {
  const packageJson = {
    name: projectName,
    version: '0.0.0',
    private: true,
    packageManager: `npm@${ANGULAR_VERSIONS.npm}`,
    scripts: {
      ng: 'ng',
      start: 'ng serve',
      build: 'ng build',
    },
    dependencies: {
      '@angular/common': ANGULAR_VERSIONS.core,
      '@angular/compiler': ANGULAR_VERSIONS.core,
      '@angular/core': ANGULAR_VERSIONS.core,
      '@angular/platform-browser': ANGULAR_VERSIONS.core,
      rxjs: ANGULAR_VERSIONS.rxjs,
      tslib: ANGULAR_VERSIONS.tslib,
    },
    devDependencies: {
      '@angular/build': ANGULAR_VERSIONS.build,
      '@angular/cli': ANGULAR_VERSIONS.cli,
      '@angular/compiler-cli': ANGULAR_VERSIONS.compilerCli,
      typescript: ANGULAR_VERSIONS.typescript,
    },
  };
  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

export function buildAngularJson(projectName: string): string {
  const angularJson = {
    $schema: './node_modules/@angular/cli/lib/config/schema.json',
    version: 1,
    cli: { packageManager: 'npm' },
    newProjectRoot: 'projects',
    projects: {
      [projectName]: {
        projectType: 'application',
        root: '',
        sourceRoot: 'src',
        prefix: 'app',
        architect: {
          build: {
            builder: '@angular/build:application',
            options: {
              browser: 'src/main.ts',
              tsConfig: 'tsconfig.app.json',
              inlineStyleLanguage: 'scss',
              styles: ['src/styles.scss'],
            },
            configurations: {
              production: {
                outputHashing: 'all',
              },
            },
            defaultConfiguration: 'production',
          },
          serve: {
            builder: '@angular/build:dev-server',
            configurations: {
              production: { buildTarget: `${projectName}:build:production` },
            },
            defaultConfiguration: 'production',
          },
        },
      },
    },
  };
  return `${JSON.stringify(angularJson, null, 2)}\n`;
}

export function buildTsConfig(): string {
  const tsConfig = {
    compileOnSave: false,
    compilerOptions: {
      skipLibCheck: true,
      isolatedModules: true,
      experimentalDecorators: true,
      importHelpers: true,
      target: 'ES2022',
      module: 'preserve',
    },
    angularCompilerOptions: {
      strictInjectionParameters: true,
      strictInputAccessModifiers: true,
    },
    files: [],
    references: [{ path: './tsconfig.app.json' }],
  };
  return `${JSON.stringify(tsConfig, null, 2)}\n`;
}

export function buildTsConfigApp(): string {
  const tsConfigApp = {
    extends: './tsconfig.json',
    compilerOptions: { types: [] },
    include: ['src/**/*.ts'],
  };
  return `${JSON.stringify(tsConfigApp, null, 2)}\n`;
}
