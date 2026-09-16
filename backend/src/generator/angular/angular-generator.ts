import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CapturedPage } from '../../capture/ir/captured-page.interface.js';
import {
  buildAngularJson,
  buildAppComponentTs,
  buildAppHtml,
  buildAppScss,
  buildGlobalStyles,
  buildIndexHtml,
  buildMainTs,
  buildPackageJson,
  buildTsConfig,
  buildTsConfigApp,
} from './angular-project-files.js';

export interface GenerateAngularProjectOptions {
  /** Name used for package.json and the angular.json project entry. */
  projectName?: string;
}

export interface GeneratedAngularProject {
  rootDir: string;
  projectName: string;
  /** Paths of every file written, relative to `rootDir`. */
  files: string[];
}

const DEFAULT_PROJECT_NAME = 'generated-project';

/**
 * Writes a minimal, valid, standalone Angular project that statically
 * reproduces `page`. Structure, text, attributes and styles come straight
 * from the IR via the same functions StaticRenderer itself uses
 * (`renderDocumentBody`/`renderStyles`/`toDomId`), so this generator never
 * re-implements the IR -> HTML/CSS transformation — only the Angular
 * project scaffolding around it.
 *
 * Deliberately knows nothing about Playwright or how `page` was captured;
 * it only depends on the `CapturedPage` shape.
 */
export async function generateAngularProject(
  page: CapturedPage,
  outputDir: string,
  options: GenerateAngularProjectOptions = {},
): Promise<GeneratedAngularProject> {
  const projectName = options.projectName ?? DEFAULT_PROJECT_NAME;

  const files: Record<string, string> = {
    'package.json': buildPackageJson(projectName),
    'angular.json': buildAngularJson(projectName),
    'tsconfig.json': buildTsConfig(),
    'tsconfig.app.json': buildTsConfigApp(),
    'src/index.html': buildIndexHtml(page.title),
    'src/main.ts': buildMainTs(),
    'src/styles.scss': buildGlobalStyles(),
    'src/app/app.ts': buildAppComponentTs(page),
    'src/app/app.html': buildAppHtml(page),
    'src/app/app.scss': buildAppScss(page),
  };

  const writtenPaths: string[] = [];
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(outputDir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf-8');
    writtenPaths.push(relativePath);
  }

  return { rootDir: outputDir, projectName, files: writtenPaths };
}
