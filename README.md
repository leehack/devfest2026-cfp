# DevFest Montréal 2026 — CFP

Submission form, Firestore write path, security rules. `SPEC.md` is the design;
[`AGENTS.md`](AGENTS.md) is the working conventions.

Vite + React + TypeScript on Firebase. One zod schema in `shared/` compiles into
both the browser bundle and the functions bundle, so the field limits cannot
drift apart.

```
shared/       enums, types, schema, pure parsers — compiled into both bundles
src/          the form
functions/    submit, withdraw, recomputeAggregates, sessionize import
firestore.rules   the enforcement boundary (§6)
```

## Running it locally

```bash
npm install && npm --prefix functions install
npm start
```

[`scripts/dev.mjs`](scripts/dev.mjs) does the four things that each fail
silently if you skip them: finds a JVM, rebuilds `functions/lib` (the emulator
serves the compiled output, not the TypeScript), starts **auth, firestore and
functions**, and seeds `config/cfp` with a window around today. Then Vite on
<http://localhost:5173>.

Emulator data is kept in `.emulator-data/` between runs; `npm start -- --fresh`
discards it.

Miss any of those and the app fails closed rather than guessing: without
`functions` every callable hits a closed port while drafts still autosave, so
the breakage looks like a bug in the import feature; without `config/cfp` the
form correctly reports "not open yet". A committed `.env` supplies emulator
placeholders — without one, `getAuth()` throws `auth/invalid-api-key` during
module load and nothing renders at all.

`signInWithPopup` fails with *"No matching frame"* in headless browsers and
embedded webviews, so under the emulators the sign-in panel grows a **"Sign in as
a test speaker"** button ([`src/lib/devAuth.ts`](src/lib/devAuth.ts)). It is not
rendered against a real project.

## Verify

```bash
npm run verify   # lint, build, unit, rules, end-to-end
```

| Suite | Needs | Covers |
|---|---|---|
| `npm test` | node | schema, scoring, parser, import merge, message translation |
| `npm run test:rules` | Firestore emulator, JVM | `firestore.rules` |
| `npm run test:e2e` | the full stack | every applicant flow, in a browser |

The end-to-end suite drives the same stack `npm start` brings up, reusing it if
it is already running. It resets the emulators between tests through their REST
surface ([`tests/e2e/backend.ts`](tests/e2e/backend.ts)), which lets a test put
the backend somewhere the UI cannot reach — a closed window, a paused CFP, a
missing config document. The Sessionize specs are the only ones that touch the
network; `E2E_SKIP_NETWORK=1` drops them.

If an emulator is already running on 8080, `emulators:exec` cannot start its own
for the rules suite — point vitest at the running one instead, remembering that
those tests call `clearFirestore()` and will wipe it:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest run --project rules
```

### Why the tests look the way they do

[`tests/aggregate.test.ts`](tests/aggregate.test.ts) asserts *properties*, not
return values: a fixture where every reviewer is calibrated alike makes
normalisation a no-op, and a suite built on one would pass while proving the
feature does nothing. So it builds a harsh reviewer and a generous one and
asserts the raw and normalised orderings **disagree**.

Checked by mutation: making normalisation a no-op fails 3 tests, removing
conflict exclusion fails 2, swapping sample for population standard deviation
fails 1. That last mutation initially passed everything, because the two
estimators only diverge when review counts differ *between* proposals — a test
with unequal counts now pins it.

[`tests/validation.test.ts`](tests/validation.test.ts) asserts that no zod
message reaches an applicant untranslated, and that French never equals English.

The end-to-end suite was mutation-checked too: restoring the raw Firebase
message in the banner, ignoring `replaceExisting`, and dropping the
`deleteField()` sentinel each fail exactly the test written for them.

## Decisions worth knowing

**`status` is function-writable only, so submission is a callable.** The browser
cannot flip a draft to `submitted`; `submitProposal` does, and since it must
exist anyway it is also where the deadline is re-checked against the server clock
and the payload re-validated. The one concession: a client may write the literal
`'draft'` at creation and never touch the field again.

**Optional fields are cleared with `deleteField()`.** `{merge: true}` ignores
absent keys, so omitting an emptied field would make "delete your pitch and save"
appear to work and then restore the old value on reload.

**Applicants can run list queries, but only scoped ones.** Rules are evaluated
against every document a query returns, so `array-contains uid` succeeds while an
unconstrained listing is denied on the first foreign document. Rules are not
filters — the client must carry that where-clause.

**One `Reveal` component drives all three conditional sections** (§3), with an
`onHide` callback so the parent clears values that were only valid while the
block was visible. Otherwise a `fundingSource` stranded by a changed radio button
becomes a submit-time error with no visible field to point at.

**No `onSnapshot` anywhere** (§2). Live listeners on list views are how the
50k/day read quota disappears.

## The deployed project

Project **`devfest-mtl-2026-cfp`**, Firestore and functions both in
`northamerica-northeast1`. Live at <https://devfest-mtl-2026-cfp.web.app>.

```bash
npm run build && npx firebase deploy
```

Real config lives in `.env.production.local` (gitignored) rather than
`.env.local`, so `npm run dev` stays on the emulators; the tracked `.env` holds
only `demo-` placeholders.

Every callable sets `maxInstances: 10`. Blaze bills per invocation, and a CFP
peaking at a few hundred submissions in the final hour has no legitimate reason
to autoscale past that — anything beyond is a loop or an attack, and should
queue rather than bill.

Still needs a console decision rather than a command:

- **Google sign-in must be enabled** under Authentication → Sign-in method.
  Until then the site loads but nobody can sign in.
- **`config/cfp` must be seeded**, or the live site reports "not open yet":
  ```bash
  gcloud auth application-default login
  GCLOUD_PROJECT=devfest-mtl-2026-cfp node scripts/seed-config.mjs --opens 2026-08-01 --closes 2026-09-15
  ```
- **Storage is not set up** and `firebase deploy` fails on it, so deploy
  `--only firestore,functions,hosting`. Headshots are post-acceptance (§3).

## Open items

- **`functions/src` has no tests.** The guards it repeated are now extracted and
  pure, but the transaction bodies are only covered indirectly, through the
  rules suite and by hand. They need an emulator-backed suite of their own.
- **`importSessionizeProfile` has no per-user rate limit.** `maxInstances` caps
  the bill and the outbound fan-out at Sessionize, but one authenticated user
  can still call it in a loop.
- Auth is Google sign-in only. Fine for a Google event, but it turns "no Google
  account" into "cannot submit".
- Nothing sends email yet. "Submission received" hangs off `submitProposal` via
  `emailLog`, so a retry cannot double-send. Domain authentication has the
  longest lead time in the build — start it now.

## Seeding a review corpus

```bash
npm --prefix functions run build
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-devfest-cfp \
  node scripts/seed-corpus.mjs --proposals 40
```

Deterministic: the same `--seed` gives the same corpus, so a ranking that moves
means the code moved. Refuses to run without `FIRESTORE_EMULATOR_HOST`.

Each proposal gets a hidden "true quality" and each reviewer a persona that
distorts it. The script ranks the corpus both ways and reports which ordering
better recovers that quality, so §7's central claim is measured, not assumed.

**Normalisation needs reviewers who use the scale.** The first personas clamped
each reviewer to two adjacent values; normalisation came out *behind* the raw
average, because it cannot recover information nobody expressed. The `Flat`
persona is kept as a reminder.

**The payoff depends on panel coverage.** At 200 proposals:

| Reviews per proposal | Raw | Normalised | Gain |
|---|---|---|---|
| 2 | 0.880 | 0.920 | **+0.040** |
| 3 | 0.937 | 0.963 | +0.026 |
| 6 (everyone sees everything) | 0.984 | 0.989 | +0.004 |

If every reviewer sees every proposal the offsets become a shared constant and
cancel out of the ranking. **If you partition reviewers, normalisation stops
being optional.** Re-run with personas matching your real committee before
deciding.

## Importing from Sessionize

Sessionize's API is event-scoped, so there is no per-speaker lookup. The import
reads the public profile page, which their robots.txt permits. It accepts a
profile link, a bare handle, or a talk link, and imports the speaker **and their
talks** — title and abstract included.

**Always fetches the profile page, even for a talk link.** A profile carries the
bio *and* every talk with its full abstract; a session page has the talk but no
bio. A pasted talk is preselected; if it is no longer listed, the UI says so
rather than importing a different one.

**Two profile layouts exist in the wild** — events (`c-s-event__name`) and talks
(`c-s-session__title`). The parser handles both; an early version looked only for
events and reported a profile with seven talks as having nothing.

**It leads the form**, because it fills fields in every section below it.

**Switching talks replaces what the import wrote, and asks about anything else.**
Provenance does not survive a reload: a title an import wrote yesterday is
indistinguishable from one you typed, so "only replace what we wrote" turned
every pick on a saved draft into a no-op that reported success. Storing
provenance on the draft would also fix it, at the cost of a field in the data
model, in the rules' protected list, and in every existing document. Asking costs
one dialog.

- [`shared/sessionize.ts`](shared/sessionize.ts) is a pure parser, so a markup
  change breaks [a test](tests/sessionize.test.ts) instead of degrading silently.
- `parseSessionizeUrl` is the SSRF guard: the function rebuilds the fetch URL
  from a validated single path segment, so no caller-supplied host is requested.
  Tested against `sessionize.com.evil.example`, `localhost` and the cloud
  metadata address.
- Fills only blank fields, and reports what it filled, skipped and could not
  read. Does not map `tagline` onto `jobTitle` — that would put "Advocating for
  open source" on the public programme.
- **Over-limit text is filled and flagged, not silently accepted.** A real talk
  on a live profile is 1,301 characters against our 1,200 cap.

**LinkedIn was assessed and rejected.** Sign In with LinkedIn returns only id,
name, picture and email; About, headline and positions need partner-tier access,
and scraping breaches their terms. It would deliver exactly what Google sign-in
already gives us, and specifically not the bio.

## Amendments to the spec

**Bio (26 July 2026).** `bio_en` and `bio_fr` collapse into one required `bio`.
It feeds promotion as well as review, so a speaker without one cannot be
announced. Written in whichever language the speaker prefers, so a bilingual
programme entry may need translating at publication.

**Language (26 July 2026).** `deliveryLanguage` gained `bilingual`, for speakers
who alternate during the talk; §4 argued against exactly this and the decision
overrules it. `slideLanguage` was deleted outright, so "presents in French,
slides in English" is no longer expressible.

The consequence §4 predicted still applies, so the mitigation moved to the
programme: selecting `bilingual` shows a note that the session will be labelled
bilingual publicly, and the scheduling view must render that label. Old drafts
may carry a stale `slideLanguage`; zod strips unknown keys, so no migration is
needed while the CFP is unopened.

## Ambiguity resolved in the spec

§5 prose says `secured` opens `fundingSource`, but §6 comments it as
"secured | pending" and §3 lists `secured | pending`. Implemented two-out-of-
three: **`fundingSource` for both, `decisionBy` for `pending` only.** It reads
better too — someone still arranging things can say what they are waiting on.
