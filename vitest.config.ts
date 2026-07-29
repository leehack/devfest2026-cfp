import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Vitest's own config, not the app's.
 *
 * It used to `extends: './vite.config.ts'`, which was fine while Vite built the
 * app. Next owns the build now, and it owns `tsconfig.json` with it — including
 * `jsx: "preserve"`, which Vite refuses to transform under. So the two are
 * separated: nothing here is shared with the framework, and deleting the
 * framework cannot take the test suites with it.
 */
export default defineConfig({
  /*
   * Stated rather than inherited. Vite reads `jsx` from the nearest tsconfig and
   * errors on `preserve`; setting it here erases the tsconfig-derived value, so
   * the suites keep running whatever Next writes into tsconfig.json.
   */
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  resolve: {
    alias: {
      // Vitest does not read tsconfig `paths`, so the alias has to be repeated.
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    /*
     * Node, never jsdom. `tests/consent.test.ts` installs its own `window` with
     * a localStorage that throws, to cover the Safari-private-mode path; under
     * jsdom that assignment does not take and those cases quietly assert
     * nothing. The suite is also meant to run with nothing installed but node.
     */
    environment: 'node',
  },
});
