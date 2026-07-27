# AGENTS.md

Conventions and hard-won facts for this repo. `SPEC.md` is the product spec;
`README.md` is for humans arriving at the project.

## Commands

```bash
npm start            # the whole local stack: emulators, seeded config, Vite
npm run verify       # lint, build, unit, rules, e2e — what CI runs
```

Three suites: `npm test` (vitest `unit` project, node only), `npm run test:rules`
(vitest `rules` project, needs the Firestore emulator and a JVM), and
`npm run test:e2e` (Playwright against the `npm start` stack).

## Layout

```
shared/      enums, types, zod schema, pure parsers — compiled into BOTH bundles
src/         the form (Vite/React)
functions/   callables: submit, withdraw, recomputeAggregates, sessionize import
tests/       *.test.ts — rules.test.ts needs the emulator, the rest do not
```

## Style

- KISS, DRY, SOLID. Prefer deleting code to adding an abstraction over it.
- Comment only what the code cannot say: a constraint, a rejected alternative, a
  bug being guarded against. One or two lines. No comment that restates the line
  below it.
- Same for docs, commit messages and PR bodies: concise, no padding.
- User-facing strings live in `src/i18n/`. `fr` is typed against `en`, so a new
  key fails the build until it is translated.
- A new schema rule needs a `params: { key }` on its issue and an `errors.rules`
  entry in both dictionaries. `tests/validation.test.ts` fails otherwise — zod's
  own English message must never reach an applicant.
- **Never show a caught error's `.message`.** Map its `code` through
  `src/lib/errors.ts`. Firestore denials arrive as raw rule text, and our own
  callables throw English.

## Facts worth knowing

- **`shared/` is compiled twice.** Vite resolves `@shared`; functions use
  `rootDir: ".."`, which is why `functions/package.json` points `main` at
  `lib/functions/src/index.js`. Nothing in `shared/` may import Firestore.
- **Rules are evaluated per returned document.** A scoped `array-contains` query
  passes where an unconstrained list is denied, so applicants need `list`, not
  just `get` — without it nobody can find their own draft.
- **`{merge: true}` ignores absent keys.** Clearing an optional field needs a
  `deleteField()` sentinel; see `mapEmpty` in `src/lib/formState.ts`.
- **Start emulators with `functions` included.** Without it every callable 404s
  and the failure looks like a client bug.
- **Population sd for reviewer calibration, sample sd for disagreement.** They
  differ by √(n/(n−1)), which varies with n — mixing them makes proposals with
  unequal review counts incomparable.
- **Real Firebase config is in `.env.production.local`, not `.env.local`.** Vite
  loads it for `vite build` only, so `npm run dev` stays on the emulators.
- **Use `npx firebase`.** The globally installed CLI is 12.x and cannot run
  `emulators:exec` or the `nodejs22` runtime.
- Project `devfest-mtl-2026-cfp`; Firestore and functions both in
  `northamerica-northeast1`. Deploying functions needs the Blaze plan.

## Keeping this file

Add a fact only if it would change what the next agent does. Delete anything the
code now makes obvious, and compact when sections start to sprawl — this is a
working set, not a changelog.
