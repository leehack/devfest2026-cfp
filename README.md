# DevFest Montréal 2026 — CFP

Build order **item 1**: submission form, Firestore write path, security rules.
See `SPEC.md` for the full design.

Stack: Vite + React + TypeScript, Firebase (Auth, Firestore, Cloud Functions,
Hosting). One zod schema in `shared/` is compiled into both the browser bundle
and the Cloud Functions bundle, so the field limits in §3 cannot drift apart.

```
shared/            enums, Firestore document types, zod schema  ← used by both sides
src/               submission form (Vite/React)
functions/src/     submitProposal + withdrawProposal callables
tests/rules.test.ts   Firestore rules tests
firestore.rules    the enforcement boundary (§6)
scripts/seed-config.mjs
```

## Running it locally

Four things have to be true before the form renders. Miss any one and you get a
blank page, because the app fails closed rather than guessing.

**1. Install.**

```bash
npm install && npm --prefix functions install
```

**2. Have a `.env`.** A committed `.env` with emulator placeholders is already
here. Without one, `getAuth()` throws `auth/invalid-api-key` while the module is
still loading and nothing renders at all — no error on screen, just an empty
`<div id="root">`. Use `.env.example` as the template when you point this at a
real project.

**3. Start the emulators — `functions` included.** They need a Java runtime;
there is none on `PATH` on this machine, but Homebrew JDKs are installed:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home && export PATH="$JAVA_HOME/bin:$PATH"
npm --prefix functions run build
npx firebase emulators:start --only auth,firestore,functions --project demo-devfest-cfp
```

**Do not omit `functions`.** `src/firebase.ts` points the SDK at
127.0.0.1:5001 whenever `VITE_USE_EMULATORS=true`, so without it every callable
— submit, withdraw, Sessionize import — fails against a closed port. The form
still loads and drafts still autosave, because those write to Firestore
directly, which makes the breakage look like it is in the import feature rather
than in the emulator setup. Check that `functions` appears in the emulator's
startup table before concluding a callable is broken.

Rebuild `functions/lib` after changing anything under `functions/src` or
`shared/` — the emulator serves the compiled output, not the TypeScript.

**4. Seed `config/cfp`.** The rules and `submitProposal` both read it and both
fail closed when it is missing — a missing config document must never read as
"the CFP is wide open". Pick dates that bracket today or the form will correctly
tell you the CFP is shut.

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-devfest-cfp \
  node scripts/seed-config.mjs --opens 2026-07-01 --closes 2026-09-15
```

Then `npm run dev` and open http://localhost:5173.

### Signing in locally

`signInWithPopup` needs a real popup window to post its result back to, so it
fails with *"Auth Emulator Internal Error: No matching frame"* in headless
browsers, embedded webviews and CI. When `VITE_USE_EMULATORS=true` the sign-in
panel grows a **"Sign in as a test speaker"** button that mints an unsigned token
directly ([`src/lib/devAuth.ts`](src/lib/devAuth.ts)). It is not rendered against
a real project, and a real Firebase backend would reject the token anyway.

## Verify

Two suites, split by what they need.

```bash
npm test          # 16 scoring tests — pure functions, no emulator, no Java
npm run test:rules # 30 rules tests — needs the Firestore emulator
```

`test:rules` **needs a Java runtime.** There is no Java on `PATH` on this
machine, but Homebrew JDKs are installed — prefix with:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home && export PATH="$JAVA_HOME/bin:$PATH"
```

If an emulator is already running on 8080, `emulators:exec` cannot start its own
and will fail on a port conflict. Point vitest at the running one instead:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest run tests/rules.test.ts
```

Note that the rules tests call `clearFirestore()` between cases, so running them
against your dev emulator wipes it — re-run the seed script afterwards.

### Why the scoring tests look the way they do

[`tests/aggregate.test.ts`](tests/aggregate.test.ts) asserts *properties*, not
return values. A fixture where every reviewer is calibrated the same way makes
normalisation a no-op, and a suite built on one would pass while proving the
feature does nothing. So the central test builds a deliberately harsh reviewer
and a deliberately generous one, and asserts that raw and normalised orderings
**disagree** — proposal `alpha` outranks `beta` on the raw average and `beta`
outranks `alpha` once normalised.

The suite was checked by mutation: making normalisation a no-op fails 3 tests,
removing conflict exclusion fails 2, and swapping the sample standard deviation
for the population one fails 1. That last mutation initially passed everything,
because the two estimators only diverge when review counts differ *between*
proposals — which is exactly what happens if reviewers get a partitioned subset
rather than seeing everything. A test with unequal counts now pins it.

## Decisions worth knowing

**`status` is function-writable only, so submission is a callable.** §6 blocks
all client writes to `status`, which means the browser cannot flip a draft to
`submitted`. `submitProposal` does it, and because it has to exist anyway it is
also where the deadline is re-checked against the server clock and the whole
payload is re-validated. A hand-rolled POST that skips the form hits the same
wall. The one concession to practicality: a client may write the literal
`'draft'` at creation time and never touch the field again.

**Optional fields are cleared with `deleteField()`, not by omission.** Draft
saves use `{merge: true}`, which ignores keys that are absent. Omitting an
emptied field would make "delete your pitch and save" look like it worked and
then silently restore the old value on reload.

**Applicants can run list queries, but only scoped ones.** Rules are evaluated
against every document a query returns, so `where('speakerIds', 'array-contains',
uid)` succeeds while an unconstrained listing is denied on the first foreign
document. Rules are not filters — the client must carry that where-clause or the
whole query fails.

**One `Reveal` component drives all three conditional sections**, as §3 asks. It
also fires an `onHide` callback so the parent can clear values that were only
valid while the block was visible — the schema rejects a `fundingSource` on a
`local` applicant, so a value stranded by a changed radio button would otherwise
be a submit-time server error with no visible field to point at.

**No `onSnapshot` anywhere.** §2 is explicit that live listeners on list views
are how the 50k/day read quota disappears. Everything here is one-shot `getDoc`
/ `getDocs`.

## The deployed project

Firebase project **`devfest-mtl-2026-cfp`**, Firestore in
`northamerica-northeast1` (Montréal). Live at
<https://devfest-mtl-2026-cfp.web.app>.

Deployed so far: Firestore rules, Firestore indexes, Hosting.

```bash
npx vite build && npx firebase deploy --only firestore:rules,firestore:indexes,hosting
```

The real project config lives in `.env.production.local` (gitignored). It is
`.env.production.local` rather than `.env.local` on purpose: Vite loads it only
for `vite build`, so `npm run dev` keeps pointing at the emulators. The tracked
`.env` holds `demo-` placeholders and nothing else.

Three things are deliberately not done, because each needs an account decision
rather than a command:

1. **Google sign-in is not enabled.** Authentication → Sign-in method in the
   console. Until then the site loads but nobody can sign in.
2. **`config/cfp` has not been seeded**, so the live site correctly reports
   "not open yet" — the rules and `submitProposal` both fail closed when that
   document is missing. Seeding it needs application-default credentials:
   ```bash
   gcloud auth application-default login
   GCLOUD_PROJECT=devfest-mtl-2026-cfp node scripts/seed-config.mjs --opens 2026-08-01 --closes 2026-09-15
   ```
3. **Cloud Functions are not deployed**, because functions require the Blaze
   plan. Submitting, withdrawing and the Sessionize import all go through
   callables, so on the deployed site those three do nothing until the project
   is upgraded and `firebase deploy --only functions` has run. They work
   locally against the emulators today.

## Open items before this ships

- `firebase-tools` is pinned as a devDependency at 15.x. The globally installed
  one is 12.7.0, which predates the `nodejs22` functions runtime in
  `firebase.json` and cannot run `emulators:exec`. Use `npx firebase`, not
  `firebase`.
- Auth is Google sign-in only. Fine for a Google event, but it does turn "no
  Google account" into "cannot submit" — worth a decision before the CFP opens.
- Nothing in item 1 sends email. The "Submission received" template (item 5)
  hangs off the end of `submitProposal`, via `emailLog` so a retry cannot
  double-send. Domain authentication has the longest lead time of anything in
  the build — start it now, not in item 5.
- `storage.rules` denies everything. Headshots are post-acceptance (§3), so
  Storage is not wired up at all yet.

## Seeding a review corpus

```bash
npm --prefix functions run build   # the script reuses the compiled aggregation
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-devfest-cfp \
  node scripts/seed-corpus.mjs --proposals 40
```

Deterministic — the same `--seed` gives the same corpus, so a ranking that moves
means the code moved. It refuses to run without `FIRESTORE_EMULATOR_HOST`, since
it writes fake data.

Each proposal gets a hidden "true quality" and each reviewer expresses it
through a persona with a different offset. The script then ranks the corpus both
ways and reports which ordering better recovers that hidden quality, so §7's
central claim is **measured rather than assumed**.

### What it measured here

Two findings from running it, both worth knowing before the round opens.

**Normalisation needs reviewers who use the scale.** The first draft of the
personas clamped each reviewer into two adjacent values — only ever 3 or 4, only
ever 1 or 2. Normalisation came out *behind* the raw average, because it cannot
recover information a reviewer never expressed; it just amplified rounding
noise. The `Flat` persona (everything scored 3) is kept in the fixture as a
reminder: a reviewer like that contributes nothing a z-score can rescue.

**The payoff depends almost entirely on panel coverage.** At 200 proposals:

| Reviews per proposal | Raw | Normalised | Gain |
|---|---|---|---|
| 2 | 0.880 | 0.920 | **+0.040** |
| 3 | 0.937 | 0.963 | +0.026 |
| 6 (everyone sees everything) | 0.984 | 0.989 | +0.004 |

That bears directly on the open question of whether reviewers see everything or
a partitioned subset. If every reviewer sees every proposal, each proposal draws
the same reviewer mix, the offsets become a shared constant, and they cancel out
of the ranking — normalisation is nearly free but nearly pointless. **If you
partition, normalisation stops being optional.** Adjust the personas in the
script to match your actual committee and re-run before deciding.

## Importing from Sessionize

Sessionize's API is event-scoped — an organiser generates an endpoint for their
own event — so there is no per-speaker profile lookup. The import therefore
reads the speaker's **public profile page**, which their robots.txt permits
(only `/app/` and `/submission/helper/` are disallowed).

Accepts a profile link (`sessionize.com/your-name`), a bare handle, or a talk
link (`sessionize.com/s/your-name/slug/163127`). It imports the speaker
**and their talks** — title and abstract included.

**Always fetches the profile page, even for a pasted talk link.** A profile
carries the bio *and* every talk with its full abstract inline; a session page
carries the talk but no bio. So resolving a talk link back to the profile is one
request instead of two and returns strictly more. A pasted talk is preselected
from the list; if it is no longer on the profile, the UI says so rather than
importing a different one.

**Profile layouts vary and both shapes exist in the wild.** Some pages list the
events a speaker appeared at (`c-s-event__name`), others list their talks
(`c-s-session__title` / `__summary`). The parser handles both — an early version
only looked for events and reported a profile with seven talks as having
nothing.

**It leads the form.** It fills the talk as well as the speaker, so offering it
under "About you" — three sections down — arrived after the work it exists to
save, and anyone who scrolled straight to the title never learned it was there.

**Switching talks replaces what the import wrote, and asks about anything
else.** Picking from a list of seven means picking wrong sometimes, so the merge
tracks the text it applied and will replace that silently. Text of unknown
provenance is different: it asks first, naming the fields it would overwrite.

That second half matters because **provenance does not survive a reload**. Come
back to a draft tomorrow and the title an import wrote yesterday is
indistinguishable from one you typed, so a rule of "only replace what we wrote"
turns every subsequent pick into a silent no-op — the report said *Using
"Gemma 3"* while the form kept showing a different talk. Storing provenance on
the draft would fix it too, at the cost of a field in the data model, in the
rules' protected-field list, and in every document already written. Asking costs
one dialog and is honest about whose text it is.

- [`shared/sessionize.ts`](shared/sessionize.ts) is a pure parser. Keeping the
  brittle part free of network and DOM means a Sessionize markup change breaks
  [a test](tests/sessionize.test.ts) instead of silently degrading in production.
- `normalizeSessionizeHandle` is the SSRF guard as well as a convenience: the
  Cloud Function rebuilds the fetch URL from a validated single path segment, so
  no caller-supplied host is ever requested. Tested against host-suffix tricks
  (`sessionize.com.evil.example`), `localhost`, and the cloud metadata address.
- The import **fills only blank fields** and reports what it filled, what it
  left alone, and what it could not read. It deliberately does not map
  Sessionize's free-text `tagline` onto `jobTitle` — filing "Advocating for open
  source" as a job title would put it on the public programme.
- **Imported text is checked against our limits and flagged, not silently
  accepted.** Sessionize has no reason to respect a 1,200-character abstract cap
  — a real talk on a live profile is 1,301 — so an over-long value is filled
  anyway (trimming prose beats retyping it) and called out immediately. Without
  this the speaker meets it as a validation error at submit time, on text they
  never wrote.

**LinkedIn was assessed and rejected.** Sign In with LinkedIn (OpenID Connect)
returns only `id`, name, picture and email; the About section, headline and
positions need partner-tier access that is not granted for a CFP form, and
scraping breaches their terms. It would deliver name and email — which Google
sign-in already provides — and specifically not the bio.

## Amendments to the spec

**Bio (26 July 2026).** `bio_en` and `bio_fr` are collapsed into a single
required `bio`. §3 had one required and the other optional; it is now one field,
mandatory, because it feeds promotion as well as review — a speaker with no bio
cannot be announced. Written in whichever language the speaker prefers, so a
bilingual programme entry may need translating at publication time.

**Known gap this exposed:** field-level validation messages come straight from
the zod schema and are English-only, so a French applicant sees English errors.
`shared/schema.ts` already tags custom issues with `params.key` as the hook for
translating them, but nothing consumes it. Worth closing before the CFP opens.

**Language (26 July 2026).** `deliveryLanguage` gained a fourth value,
`bilingual`, for speakers who alternate during the talk — §4 argued against
exactly this, and the decision overrules it. `slideLanguage` was deleted from
the model outright, so "presents in French, slides in English" is no longer
expressible and the programme cannot show slide language at all. §4 in
`SPEC.md` carries the full amendment note.

The consequence §4 predicted still applies, so the mitigation moved to the
programme: selecting `bilingual` now shows the applicant a note saying the
session will be labelled bilingual publicly, and the scheduling view needs to
render that label. Old drafts may still carry a stale `slideLanguage` key; zod
strips unknown keys, so nothing breaks and no migration is needed as long as
the CFP has not opened yet.

## Ambiguity resolved in the spec

§5 prose says `secured` opens `fundingSource`, but the §6 data model comments it
as "when secured | pending" and the §3 conditional-fields list says
`secured | pending → show funding source / decision date`. Implemented as the
two-out-of-three reading: **`fundingSource` for both `secured` and `pending`,
`decisionBy` for `pending` only.** It also reads better — an applicant who is
still arranging things can say what they are waiting on.
