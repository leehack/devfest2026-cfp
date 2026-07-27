import { defineWorkspace } from 'vitest/config';

/**
 * Two suites, split by what they need. `unit` must stay runnable with nothing
 * installed but node; `rules` needs the Firestore emulator, so it only runs
 * under `npm run test:rules`.
 */
export default defineWorkspace([
  {
    extends: './vite.config.ts',
    test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: ['tests/rules.test.ts'] },
  },
  {
    extends: './vite.config.ts',
    test: { name: 'rules', include: ['tests/rules.test.ts'] },
  },
]);
