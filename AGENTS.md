# AGENTS.md

Conventions and hard-won facts for this repo. `SPEC.md` is the product spec;
`README.md` is for humans arriving at the project.

## Commands

```bash
npm start            # the whole local stack: emulators, seeded config, Vite
npm run verify       # lint, build, unit, rules, e2e — what CI runs
```

Three suites: `npm test` (vitest `unit` project, node only), `npm run test:rules`
(vitest `rules` project, needs the Firestore emulator), and `npm run test:e2e`
(Playwright against the `npm start` stack). Both emulator suites go through
`scripts/with-java.mjs`, which finds a Homebrew JVM — macOS has none on PATH.

```bash
node scripts/grant-role.mjs --email you@example.org --role admin
```

Makes the first admin; every later role goes through `#/admin`. Add the emulator
env vars from the script's own header to point it at the local stack.

## Layout

```
shared/      enums, types, zod schema, email copy, pure parsers — BOTH bundles
src/         the app: pages/ (submit, admin, review), lib/ (data access), i18n/
functions/   callables: submit, withdraw, roles, window, aggregates, sessionize,
             emailQueue — plus the sendQueuedEmail Firestore trigger
scripts/     dev.mjs (npm start), grant-role.mjs (first admin), with-java.mjs
tests/       *.test.ts — rules.test.ts needs the emulator, the rest do not
```

Three routes off one hash router (`src/lib/router.ts`): `#/` the form, `#/review`
for any role-holder, `#/admin` for admins. Roles live in `reviewers/{uid}`;
`roleGrants/{email}` holds an invitation until its holder first signs in.

A speaker may hold several talks (`LIMITS.maxTalksPerSpeaker`), switched by the
picker on the form. Only the talk half is cleared between them — the speaker
profile and the travel answers carry over (`clearTalk` in `src/lib/formState.ts`).

`src/lib/lifecycle.ts` decides what a speaker may still change: everything until
the committee starts reading, then travel answers only, then nothing. The speaker
profile is outside it — that document belongs to the account and never freezes.
The rules are the enforcement; `editScope` only decides what to disable.

Email is a queue, not a send: callables write `emailLog/{kind}__{proposalId}`
inside their own transaction and the `sendQueuedEmail` trigger delivers. Copy
lives in `shared/emailTemplates.ts` (pure, both languages); transport and status
machine in `functions/src/email.ts`. Decisions queue `held` until an admin
releases them together — see the README for why, and for the Resend setup.

Email setup is entirely `#/admin`, no redeploy: key, domain, sender, wording.
Copy in `shared/emailTemplates.ts` is placeholder *strings*, not functions, so
the built-in and an organiser's override are the same shape and one editor
prefills from either. Overrides live in `config/email.templates`; a half-written
one (blank subject or body) falls back rather than sending a blank.
Addresses are data (`config/email`, `setEmailSettings`); the **key is Secret
Manager only** (`functions/src/secrets.ts`) and never enters Firestore or a
response — the client sees `keyHint`, the last four characters. Resend's domain
API is proxied by `emailDomain` so the DNS records can be shown and re-checked.
`functions/.env*` is only a fallback. `config` is *not* world-readable as a
collection — the rule names `cfp`.

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
- **The Auth emulator mints its own uid; a token's `sub` is not it.** Anything
  that has to name a user — `speakerIds`, a seeded review — must create the
  account first and read back `localId` (`createAccount` in `tests/e2e/backend.ts`).
- **No `onSnapshot`.** Every read is one-shot, refreshed by its caller after a
  write. Ten reviewers on a live list view is how the read quota disappears.
- **Status groupings live in `STATUS_SETS` (`shared/enums.ts`).** They had drifted
  across the form, the callables and the admin screen. `firestore.rules` restates
  them because the rules language cannot import — change one, change both.
- **Reviewers never see a draft.** An unsubmitted proposal is nobody's but its
  author's, so committee queries must carry `where('status', '!=', 'draft')` or
  the rules deny the whole listing.
- **`speakerIds` is fixed at creation** and must equal `[uid()]`. Naming someone
  hands them write access and disqualifies them from reviewing the talk; that
  needs their consent, so co-presenters wait for an invitation callable.
- **A role-holder must never read reviews of their own proposal.** Blocked on
  reads and writes alike, admins included — `firestore.rules` and six tests
  around the `reviewsVisible` flip.
- **`status` is function-writable only**, so every decision is a callable.
  `setProposalStatus` is admin-only and refuses `draft` and `withdrawn` — the
  first is not the committee's to touch, the second is the speaker's call.
- **A rules test that writes the same value it seeded proves nothing.**
  `affectedKeys()` never names an unchanged field, so a `hasOnly` guard passes
  either way. Always write a value that differs.
- **The emulator serves `functions/lib`, not `functions/src`.** A mutation test
  against a callable or trigger has to `npm --prefix functions run build` first,
  or it silently re-runs the unmutated code and "passes".
- **A listening functions port is not a working one.** It accepts connections
  ~4s before it registers the code, and callables 404 with "does not exist" in
  between — indistinguishable from a real missing function. `dev.mjs` probes an
  actual callable (`waitForCallables`); do not weaken that back to a port check.
- **A deterministic `emailLog` id is not by itself the dedupe.** It keeps the row
  count at one, but an overwrite resets a `sent` row to `held` and mails the
  person again — the existence check in `queueEmail` is the actual guard, so
  test the row's *status*, not how many rows there are.
- **No `defineString`, and no `secrets:` binding either.** `emulators:start`
  stops and prompts for any param without a value, hanging `npm start` with no
  visible error; and a `secrets:` binding resolves once at instance start, so a
  key rotated from `#/admin` would not take effect. `readResendKey()` goes to
  Secret Manager at runtime and short-circuits on `FUNCTIONS_EMULATOR`, since
  there is no Secret Manager emulator.
- **A late load must not overwrite a field someone is typing in.** Every admin
  panel seeds its inputs from an async call; without an `editing` ref the field
  empties under the cursor. It only reproduces under load, so the test holds the
  response open with `page.route` rather than hoping for the race.
- **Charts are hand-rolled SVG/CSS in `src/components/charts.tsx`.** The deployed
  CSP blocks CDN scripts, and a chart library would outweigh the page it draws.
- **Test a guard through `callAs`, not the UI.** "The button is not rendered" is
  not the claim worth proving; `tests/e2e/backend.ts` calls the callable directly
  with a real ID token. Always pair refusals with one call that succeeds, or a
  broken URL passes as a refusal.
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
