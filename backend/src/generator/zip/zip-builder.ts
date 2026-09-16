import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

/**
 * Paths containing any of these segments are refused, even though the only
 * caller (GenerationService, zipping straight out of what
 * generateAngularProject just wrote) never produces them. Defense in depth:
 * the node_modules-link helper used by test:angular-generator must never be
 * able to leak into a real ZIP even if something upstream changes.
 */
const FORBIDDEN_PATH_SEGMENT = /(^|[/\\])(node_modules|dist|\.git)([/\\]|$)/;

/**
 * Zips an *exact* list of files (relative to `baseDir`) under a single root
 * folder named `rootFolderName` — not "zip whatever is in this directory",
 * so there is no directory-walking step that could accidentally pick up
 * something that shouldn't be there.
 */
export async function zipFiles(
  baseDir: string,
  relativeFilePaths: readonly string[],
  rootFolderName: string,
): Promise<Buffer> {
  const zip = new JSZip();

  for (const relativePath of relativeFilePaths) {
    if (
      path.isAbsolute(relativePath) ||
      relativePath.split(/[/\\]/).includes('..') ||
      FORBIDDEN_PATH_SEGMENT.test(relativePath)
    ) {
      throw new Error(`Refusing to zip suspicious path: "${relativePath}"`);
    }

    const absolutePath = path.join(baseDir, relativePath);
    const content = await fs.readFile(absolutePath);
    const zipEntryPath = `${rootFolderName}/${relativePath.split(path.sep).join('/')}`;
    // createFolders: false — JSZip otherwise adds an explicit entry for
    // every intermediate directory; skipping them keeps the archive to
    // exactly the files we intend to ship.
    zip.file(zipEntryPath, content, { createFolders: false });
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
