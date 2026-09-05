import { defineWorkspace } from 'vitest/config';

/**
 * Two suites, split by what they need. `unit` must stay runnable with nothing
 * installed but node; `rules` needs the Firestore and Storage emulators, so it
 * only runs under `npm run test:rules`. The email batch drain lives there too:
 * it exercises real transactions rather than a mocked Firestore.
 */
const RULES = ['tests/rules.test.ts', 'tests/storageRules.test.ts', 'tests/emailBatchFlow.test.ts'];
export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: RULES },
  },
  {
    extends: './vitest.config.ts',
    // One file at a time: rules.test.ts clears the whole Firestore emulator,
    // which would empty the batch-flow suite's rows under it.
    test: { name: 'rules', include: RULES, poolOptions: { forks: { singleFork: true } } },
  },
]);
