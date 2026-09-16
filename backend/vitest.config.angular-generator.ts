import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Generates a temporary Angular project, runs `ng build` against it, and
// visually compares the result. Offline (uses a linked node_modules, see
// node-modules-link.ts) but meaningfully slower than a unit test since it
// shells out to the Angular CLI — kept out of `npm test`.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.angular-generator-spec.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
