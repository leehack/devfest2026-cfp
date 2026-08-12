/**
 * Things that must not be true of a production build.
 *
 * Both of these used to be guaranteed by Vite's static replacement, quietly, and
 * neither is guaranteed by anything now — so they are asserted instead of
 * assumed. Run from `npm run verify` after `npm run build`.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = '.next/static/chunks';

if (!existsSync(CLIENT)) {
  console.error(`check-bundle: no ${CLIENT} — run "npm run build" first.`);
  process.exit(1);
}

const chunks = readdirSync(CLIENT)
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ name: f, code: readFileSync(join(CLIENT, f), 'utf8') }));

const problems = [];

/*
 * The emulator placeholders in the tracked `.env`. Next loads `.env` in every
 * mode, so a build that failed to pick up the real values would deploy a site
 * that looks perfect and cannot sign anybody in. `next.config.ts` also refuses
 * this at build time; this catches it in the artefact.
 */
for (const { name, code } of chunks) {
  if (code.includes('demo-devfest-cfp') || code.includes('demo-api-key')) {
    problems.push(`${name} carries the emulator placeholder config`);
  }
}

/*
 * The emulator sign-in. `src/lib/devAuth.ts` mints an unsigned ID token, which a
 * real Auth backend rejects — but it has no business being reachable at all.
 *
 * Turbopack emits the module as its own chunk because a dynamic `import()` is
 * discovered statically, so the file existing is not the thing to assert on. What
 * must hold is that nothing *calls* it: the guards at both call sites are written
 * as literal `process.env` comparisons precisely so the bundler folds them away.
 * If either call reappears in executing client code, its guard stopped working.
 */
for (const { name, code } of chunks) {
  if (/installTestSignIn\s*\(\s*\)/.test(code)) {
    problems.push(`${name} still calls installTestSignIn() — the emulator guard did not fold`);
  }
  if (/signInAsTestSpeaker\s*\(\s*\)/.test(code)) {
    problems.push(`${name} still calls signInAsTestSpeaker() — the emulator guard did not fold`);
  }
}

if (problems.length) {
  console.error('check-bundle: FAILED');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`check-bundle: ${chunks.length} client chunks, both invariants hold`);
