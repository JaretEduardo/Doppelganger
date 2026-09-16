import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Local, offline pixel-diff comparisons against fixtures under
// src/**/fixtures/. Kept separate from `npm test` because they launch a
// browser twice and write screenshots to disk, so they're slower than plain
// unit tests even though they never touch the network.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.visual-spec.ts'],
  },
});
