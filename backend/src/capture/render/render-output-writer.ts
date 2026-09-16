import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RenderedPage } from './rendered-page.interface.js';

export interface WrittenRenderedPage {
  htmlPath: string;
  cssPath: string;
}

/** Writes a rendered page as `output/index.html` + `output/styles.css`. */
export async function writeRenderedPage(
  rendered: RenderedPage,
  outputDir: string,
): Promise<WrittenRenderedPage> {
  await fs.mkdir(outputDir, { recursive: true });

  const htmlPath = path.join(outputDir, 'index.html');
  const cssPath = path.join(outputDir, 'styles.css');

  await fs.writeFile(htmlPath, rendered.html, 'utf-8');
  await fs.writeFile(cssPath, rendered.css, 'utf-8');

  return { htmlPath, cssPath };
}
