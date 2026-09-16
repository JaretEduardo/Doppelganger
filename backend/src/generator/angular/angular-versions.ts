/**
 * Exact (non-range) versions written into every generated project's
 * package.json. Pinned to whatever `frontend/` currently has installed, so a
 * generation today and a generation next year produce the identical
 * dependency set — no "latest", no caret ranges that could resolve
 * differently over time. Bump deliberately if `frontend/` is upgraded.
 */
export const ANGULAR_VERSIONS = {
  core: '22.1.7',
  build: '22.1.8',
  cli: '22.1.8',
  compilerCli: '22.1.7',
  typescript: '6.0.3',
  rxjs: '7.8.2',
  tslib: '2.8.1',
  npm: '11.12.1',
} as const;
