import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Points `projectDir/node_modules` at an already-installed `node_modules`
 * directory (a symlink on POSIX, a junction on Windows — junctions don't
 * need elevated privileges) instead of running a real `npm install`.
 *
 * Rationale: the generated project's package.json pins the exact same
 * Angular versions frontend/ already has installed (see angular-versions.ts),
 * so frontend/node_modules already satisfies the generated project's
 * dependency tree byte-for-byte. Reusing it makes `ng build` on a generated
 * project near-instant and fully offline instead of re-downloading the whole
 * Angular toolchain on every test run — the "reasonable strategy" called out
 * in the Milestone 3 brief instead of hiding a real `npm install` inside a
 * test. Falls back to a real install being the caller's responsibility if
 * `sourceNodeModulesDir` doesn't exist.
 */
export async function linkNodeModules(
  projectDir: string,
  sourceNodeModulesDir: string,
): Promise<void> {
  const sourceStat = await fs.stat(sourceNodeModulesDir).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error(
      `Cannot link node_modules: "${sourceNodeModulesDir}" does not exist. ` +
        'Run `npm install` there first.',
    );
  }

  const targetPath = path.join(projectDir, 'node_modules');
  await fs.rm(targetPath, { recursive: true, force: true });

  const absoluteSource = path.resolve(sourceNodeModulesDir);
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  await fs.symlink(absoluteSource, targetPath, linkType);
}
