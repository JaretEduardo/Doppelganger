import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipFiles } from './zip-builder.js';

describe('zipFiles', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dg-zip-'));
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  async function writeFile(relativePath: string, content: string): Promise<void> {
    const absolutePath = path.join(baseDir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf-8');
  }

  it('zips exactly the given files, nested under the root folder name', async () => {
    await writeFile('package.json', '{"name":"demo"}');
    await writeFile('src/app/app.ts', 'export class App {}');

    const buffer = await zipFiles(baseDir, ['package.json', 'src/app/app.ts'], 'doppelganger-demo');
    const zip = await JSZip.loadAsync(buffer);

    const entryNames = Object.keys(zip.files).sort();
    expect(entryNames).toEqual(['doppelganger-demo/package.json', 'doppelganger-demo/src/app/app.ts']);

    const packageJsonContent = await zip.file('doppelganger-demo/package.json')!.async('string');
    expect(packageJsonContent).toBe('{"name":"demo"}');
  });

  it('never includes node_modules, dist, or .git even if asked to', async () => {
    await writeFile('package.json', '{}');
    await writeFile('node_modules/some-pkg/index.js', 'module.exports = {};');
    await writeFile('dist/main.js', 'console.log(1);');
    await writeFile('.git/HEAD', 'ref: refs/heads/main');

    await expect(
      zipFiles(baseDir, ['package.json', 'node_modules/some-pkg/index.js'], 'project'),
    ).rejects.toThrow(/suspicious path/);
    await expect(zipFiles(baseDir, ['dist/main.js'], 'project')).rejects.toThrow(/suspicious path/);
    await expect(zipFiles(baseDir, ['.git/HEAD'], 'project')).rejects.toThrow(/suspicious path/);
  });

  it('refuses path traversal and absolute paths', async () => {
    await writeFile('package.json', '{}');

    await expect(zipFiles(baseDir, ['../outside.txt'], 'project')).rejects.toThrow(
      /suspicious path/,
    );
    await expect(
      zipFiles(baseDir, [path.resolve(baseDir, 'package.json')], 'project'),
    ).rejects.toThrow(/suspicious path/);
  });

  it('produces a zip containing only the requested Angular project files', async () => {
    const files = [
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
    for (const file of files) {
      await writeFile(file, `content of ${file}`);
    }

    const buffer = await zipFiles(baseDir, files, 'doppelganger-example-com');
    const zip = await JSZip.loadAsync(buffer);
    const entryNames = Object.keys(zip.files).sort();

    expect(entryNames).toEqual(files.map((file) => `doppelganger-example-com/${file}`).sort());
    expect(entryNames.some((name) => name.includes('node_modules'))).toBe(false);
  });
});
