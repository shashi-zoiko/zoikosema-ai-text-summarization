import { defineConfig } from 'vitest/config'

/**
 * Test runner for the client (ZS-MTG-IMP-04 introduced the first one).
 *
 * Default environment is `node` — the large pure suite (reducer/engine/
 * selectors/resolvers/flags) never pays for jsdom startup and stays free of
 * jsdom's persistent localStorage. React component + a11y tests opt into jsdom
 * per-file with a `// @vitest-environment jsdom` docblock (named `*.dom.test.jsx`
 * by convention).
 *
 * esbuild's automatic JSX runtime is used directly (no @vitejs/plugin-react —
 * Fast Refresh is irrelevant under test) so JSX needs no `React` import.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
  },
})
