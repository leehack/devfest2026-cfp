import { defineWorkspace } from 'vitest/config';

/**
 * Two suites, split by what they need. `unit` must stay runnable with nothing
 * installed but node; `rules` needs the Firestore and Storage emulators, so it
 * only runs under `npm run test:rules`.
 */
const RULES = ['tests/rules.test.ts', 'tests/storageRules.test.ts'];
export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: RULES },
  },
  {
    extends: './vitest.config.ts',
    test: { name: 'rules', include: RULES },
  },
]);
