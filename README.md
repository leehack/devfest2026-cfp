# A call-for-proposals platform

Anyone signed in starts a call for proposals and owns it. Submission form,
Firestore write path, security rules. `SPEC.md` is the design;
[`AGENTS.md`](AGENTS.md) is the working conventions.

It began as one event's CFP — DevFest Montréal 2026 — which is still the shape
of the form and of the spec.

Next.js App Router + React + TypeScript on Firebase. One zod schema in `shared/` compiles into
both the browser bundle and the functions bundle, so the field limits cannot
drift apart.

```
shared/       enums, types, schema, pure parsers — compiled into both bundles
src/          screens/ the form, the admin screen, the review screen
functions/    submit, withdraw, roles, window, aggregates, sessionize import
firestore.rules   the enforcement boundary (§6)
```

Everything hangs under `cfps/{cfpId}`, where the id is the slug — `proposals`,
`reviews`, `members`, `roleGrants`, `config` and `emailLog` are subcollections of
one call. The document id being the slug means creating one *is* the uniqueness
check: there is no second index to keep honest, and no window in which two people
both believe they hold the name. Only `speakers/{uid}` (a profile belongs to the
account, not to any one talk), `signInLinks` (a platform-wide throttle) and
`config/platform` sit outside.

Screens behind one path router: `/` lists the public calls, `/new` starts one,
and then `/c/{cfpId}` is that call's public page, `/submit` the form, `/review`
for anyone holding a role on it and `/admin/{tab}` for its admins. The public
page is server-rendered by its Next App Router segment, which puts the call's
own title and description into the HTML — a crawler and a link preview never
run the script, so `document.title` alone buys nothing. Everyone may submit a
talk, reviewers and admins included — they simply never get their own in the
queue.

A call is **public** (listed on the home page) or **private** (unlisted, but
readable by anyone with the link — private means unlisted, not secret). Its owner
can **archive** it, which makes it read-only and drops it off the listing, and
then **delete** it, which destroys every proposal, review, photo and email record
under it. Deleting is two steps and needs the address typed back, because it is
other people's writing as well as the owner's.

One speaker, up to three talks. The picker on the form switches between them;
the speaker profile and the travel answers are shared, so a second submission
does not mean retyping a bio. The cap is enforced in `submitProposal`, because
rules cannot count documents — drafts above it are allowed and simply never
reach a reviewer.

## Running it locally

```bash
npm install && npm --prefix functions install
npm start
```

[`scripts/dev.mjs`](scripts/dev.mjs) does the four things that each fail
silently if you skip them: finds a JVM, rebuilds `functions/lib` (the emulator
serves the compiled output, not the TypeScript), starts **auth, firestore and
functions**, and seeds a `devfest-mtl-2026` call with a window around today.
Then `next dev` on <http://localhost:5173>.

Emulator data is kept in `.emulator-data/` between runs; `npm start -- --fresh`
discards it.

Miss any of those and the app fails closed rather than guessing: without
`functions` every callable hits a closed port while drafts still autosave, so
the breakage looks like a bug in the import feature; with no call seeded the home
page is simply an empty list. A committed `.env` supplies emulator
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
| `npm run test:e2e` | the full stack | every applicant, reviewer and admin flow |

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
message in the banner, ignoring `replaceExisting`, dropping the `deleteField()`
sentinel, dropping the self-review filter from the queue, and forcing
`reviewsVisible` on each fail exactly the test written for them.

Signing in as somebody other than the default test speaker goes through
`signInAs` — and the Auth emulator mints its own uid rather than reusing the
token's `sub`, so anything that names a user creates the account first and reads
back `localId`.

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
50k/day read quota disappears. Every read is one-shot and refreshed by its caller
after a write.

**Roles are granted by email, before the person has ever signed in.** There is no
uid to key on yet, so `cfps/{cfpId}/roleGrants/{email}` holds the invitation and
`claimRole` turns it into `cfps/{cfpId}/members/{uid}` on first visit. There is
no bootstrap problem any more: whoever creates a call is written as its `owner`
in the same transaction. `owner` is deliberately not grantable through
`grantRole` — otherwise an admin could promote themselves and archive the call
out from under its owner. The callables call the same `grant()` the
callable does, so "what granting means" cannot drift between them.

**A reviewer who is also a speaker must never read the reviews of their own
proposal.** §6 outranks any role, so the block is on reads and writes alike,
admins included, and holds through the moment `reviewsVisible` flips. Six rules
tests pin it, including that flip.

**Reviewers cannot see each other's scores until an admin opens the round** (§7,
anchoring). Enforced in `firestore.rules`, not by hiding the section — and the
review queue re-sorts by disagreement once it is open, because that is what the
selection meeting is actually for.

**Submitting is not what closes a proposal — the deadline is.** A speaker keeps
editing after they submit, and keeps seeing what they sent: the form stays on
screen with a status banner rather than being replaced by a dead end. Once the
committee starts reading, the content freezes but the travel answers do not, and
they stay editable after the window shuts — accepted in September, visa refused
in October. `src/lib/lifecycle.ts` names the three states; `firestore.rules`
enforces them, down to refusing an abstract smuggled in beside an attendance
change.

**A draft is private to its author.** Reviewers see a proposal only once it has
been submitted — someone may have typed something into a pitch and thought better
of sending it, and the committee has no claim on that. Committee-side queries
carry `where('status', '!=', 'draft')`; without it the rules deny the listing
outright rather than quietly filtering.

**`speakerIds` is fixed at creation.** The field is an array because §6 wants
co-presenters, but naming someone is a claim about *them* — it grants them write
access and, since nobody may review their own talk, silently disqualifies them
from reviewing it. Both need consent, so the write surface stays shut until there
is an invitation flow.

**The speaker profile belongs to the account, not to a talk.** One
`speakers/{uid}` shared by every proposal, editable throughout — including while
a talk is frozen, because a changed employer is not a changed talk.

**But the committee reads a copy, not the profile.** `submitProposal` freezes a
`speakerSnapshot` onto the proposal. Two reasons, one answer: a profile is global
while a role is per call, so letting reviewers read profiles would hand every
committee on the platform the whole speaker directory; and a bio rewritten in
2028 would otherwise change what the 2026 committee is recorded as having judged.
The snapshot deliberately omits the email address — a reviewer judging a talk has
no need of it.

**Selection is a callable, for the same reason submission is.** `status` is what
every other permission keys off, so an applicant who could write it could accept
themselves. `setProposalStatus` accepts the committee workflow states in
`STATUS_SETS.decidable`, plus `submitted` so an accidental decision can be
undone. It refuses `draft` (not theirs to touch) and `withdrawn` (the speaker's
call, which outranks the committee's).

## The deployed project

Project **`devfest-mtl-2026-cfp`**. Firestore and the 27 functions are in
`northamerica-northeast1`; the App Hosting backend is in `us-east4`, because App
Hosting has no Canadian region. No personal data leaves the country — a proposal
goes from the browser to Firestore directly and never touches the backend.

Live at <https://cfp.gdgmontreal.com>. The `.web.app` and `.firebaseapp.com`
addresses belong to the old Hosting site, which stays published rather than
disabled because `.firebaseapp.com` is the `authDomain` and serves
`/__/auth/handler` — every sign-in completes through it. What it serves is
replaced by redirects to the canonical origin; see
[hosting-redirect/](hosting-redirect/README.md), which explains why disabling the
site is not the same thing.

```bash
npm run verify                                  # lint, types, build, bundle gates, 3 suites
npm run deploy:app                              # the app, from local source
npm run deploy:backend                          # callables and both rule sets
npm run smoke:production                        # edge headers, public routes and Auth handler
```

The seven public Firebase values reach a cloud build from Secret Manager, named
`next-public-firebase-*`, wired up in `apphosting.yaml`. Production builds also
require credential-free HTTPS values for `NEXT_PUBLIC_COC_URL` and `SITE_ORIGIN`;
the checked-in hosting config pins both for the Montréal deployment.

Real config lives in `.env.production.local` (gitignored) rather than
`.env.local`, so `npm start` stays on the emulators; the tracked `.env` holds
only `demo-` placeholders. `next.config.ts` refuses to build if the projectId
still starts with `demo-`, because Next reads `.env` in every mode and a build
that picked those up would deploy a site that cannot sign anybody in.

Google Analytics uses the Firebase web app's GA4 measurement ID. It remains
consent-gated: the SDK is not downloaded until a visitor opts in, declining does
not affect the CFP, and the footer lets a visitor change that choice later.
The linked property keeps automatic page views, Google signals, advertising
personalization and granular location/device collection off. User and event data
retention is two months without an activity reset; URL query values are redacted.
`cfp_id`, `category`, `format` and `delivery_language` are event-scoped custom
dimensions for the explicit events the app sends.

The App Hosting backend is pinned to `nodejs22` in its Settings tab, matching
both package manifests and keeping automatic base-image security updates
enabled. Local-source rollouts preserve that backend setting.
Next 16 is currently in App Hosting's preview support tier, so a successful
rollout is followed by `npm run smoke:production`, not treated as proof by
itself.

Every callable sets `maxInstances: 10`. Blaze bills per invocation, and a CFP
peaking at a few hundred submissions in the final hour has no legitimate reason
to autoscale past that — anything beyond is a loop or an attack, and should
queue rather than bill.

One Resend account serves every call on the platform, so each one registers its
own sending domain and `setEmailSettings` refuses a `from` that is not on it.
`config/platform` holds the site's own origin and is writable by nobody through
the app — it is where every mailed link points, sign-in links included, and those
are bearer credentials. Move it with `scripts/set-platform.mjs`.

Google sign-in is enabled and the live CFP is `cfps/devfest-mtl-2026`. Its
window and organisers are managed from `/admin`. The ordinary `createCfp` flow
writes the CFP and its owner in one transaction; `scripts/seed-cfp.mjs` is the
outside-the-app option for a fresh environment. `scripts/set-platform.mjs` sets
the platform-wide public origin.

## Email

Resend, called over its REST API from a Firestore trigger. Every message is a
row in `emailLog` whose id is `{kind}__{proposalId}` — queueing the same message
twice writes the same document, and the queue step refuses to touch a row that
already exists, so a decision reversed and reinstated does not mail anyone
twice. The trigger claims a row by moving it `queued → sending` in a
transaction, which is what makes at-least-once trigger delivery safe.

Decisions are queued **`held`**. They sit there until an admin releases the
batch from `/admin`, so acceptances and rejections go out together rather than
trickling out alphabetically over an afternoon. Receipts do not wait.

With no API key configured the trigger renders the message, logs it, and records
`dry_run` instead of `sent` — the pipeline runs end to end locally and in tests
without sending anything, and the log never claims a send that did not happen.

**Set it all up from `/admin`**, under Email. Four steps, each of which says
whether it is done, because the failure this replaces was silent — the pipeline
queued perfectly and sent nothing, and no screen said why.

1. **API key.** Paste a Resend key. Give it **Full access** when you create it:
   the next step manages domains, and Resend's sending-only keys cannot. The key
   is checked against Resend before being saved, so a typo fails here rather than
   on the night the decisions go out. It goes to **Secret Manager, never to
   Firestore** — Firestore has no version history, no access audit, and a copy of
   every document lands in every export. The page shows the last four characters
   and nothing more.
2. **Sending domain.** Add it, and the page lists the exact DNS records Resend
   wants and re-checks them on a button. Those records are generated per domain
   and exist only in Resend's dashboard, which is the one part of the setup
   nobody can be told in advance. This is the long pole — DNS propagation plus
   Resend's own check.
3. **Sender.** The from address and reply-to, stored in `config/email`.
   `CFP_EMAIL_FROM` and `CFP_REPLY_TO` in `functions/.env*` remain a fallback for
   a fresh project, empty on purpose so nothing sends until someone says so.
4. **Preview and wording**, then send one to yourself. The preview renders
   through the same pure `renderEmail` the sender uses, so it is the message
   rather than an impression of it — and it renders from the editor's text, so
   an unsaved edit is visible before it can reach anyone. Test sends deliberately
   skip `emailLog`: that collection is the record of what applicants were told,
   and a test is not that.

Every message can be rewritten per language from that last step, stored in
`config/email.templates`. Placeholders are `{speakerName}`, `{title}`,
`{proposalUrl}`, `{event}` and `{visa}` — the last is conditional, so a paragraph
containing only `{visa}` disappears for speakers who do not need one. A blank
subject or body, or a mistyped placeholder that would print braces to an
applicant, is refused in the browser *and* in the callable. "Restore ours" drops
the override and the built-in copy applies again.

Nothing here needs a redeploy. Checking DNS from a terminal is still quicker than
any dashboard — no Resend DKIM record means the domain is not verified, whatever
the dashboard says:

```bash
dig +short TXT resend._domainkey.YOUR-DOMAIN
```

Rotating the key takes effect as instances recycle: the sender reads it from
Secret Manager at runtime and caches it for ten minutes, rather than taking it
from a `secrets:` binding that only resolves at deploy time.

## Security

The threat model is small and specific: applicants must not read each other's
work or their own reviews, reviewers must not anchor on each other, and nobody
must be able to grant themselves a role. `firestore.rules` is the boundary — the
SDK queries straight from the browser, so anything the UI merely hides is still
readable. The rules suite exercises every boundary and is mutation-checked.

- **Roles cannot be self-served.** `cfps/{cfpId}/members/{uid}` is
  `allow write: if false`; only the callables touch it, and each checks the
  caller's role for that CFP server-side. `createCfp` writes its owner in the
  creation transaction. `claimRole` trusts only the verified auth token's email,
  and requires `email_verified === true` rather than merely "not false".
- **Every callable authorises before it acts** — `requireUid`, `requireAdmin`, or
  ownership via `readOwnProposal`, which reports `not-found` for someone else's
  proposal so a prober learns nothing either way.
- **SSRF**: the Sessionize import rebuilds its URL from one validated path
  segment, so no caller-supplied host is ever fetched, and re-checks the host
  after redirects. Tested against `sessionize.com.evil.example`, `localhost` and
  `169.254.169.254`.
- **PII**: review cards use the CFP-scoped `speakerSnapshot`, which deliberately
  omits email; only the speaker may read the global profile. `roleGrants` is
  admin-only because it is a list of addresses; `emailLog` is closed to every
  client including admins, who reach its recipient data through the
  `emailQueue` callable. A client that could write there could mail anyone from
  our verified domain, so the deny covers writes as well as reads.
- **`config` is closed by default.** `submissionForm` is public because it
  defines what the call asks, and `confirmForm` is readable only after sign-in.
  The window lives on the public CFP document. `config/email` remains private
  and reaches the admin page only through a callable.
- **The bundle carries no secrets.** The Firebase web config is public by design;
  the emulator sign-in hook is behind a build-time flag and is absent from the
  production build (checked, not assumed). Direct dependencies are current and
  production audits report no critical advisory; the remaining findings are
  transitive in the current Next and Firebase/Google dependency trees rather
  than ignored behind a claim of zero.
- **Cost is a security property here.** Every callable sets `maxInstances: 10`,
  and no view uses `onSnapshot`.

Still open, in rough order of how much they would matter on the day:

- **`importSessionizeProfile` has no per-user rate limit.** `maxInstances` caps
  the bill and the fan-out at Sessionize, but one authenticated user can still
  call it in a loop. A counter on the speaker document would close it.
- **No abuse ceiling on draft creation.** Submitted talks are capped at
  `LIMITS.maxTalksPerSpeaker`; drafts are not, so an authenticated account can
  create documents until someone notices. Bounded by requiring a Google account,
  not by us.
- **No audit log for admin actions.** Grants, revocations, window changes and
  decisions are written by callables and logged to Cloud Logging, but nothing is
  queryable in-app. Fine for a committee of five; not fine if this outlives them.

## Open items

- **`functions/src` has no tests.** The guards it repeated are now extracted and
  pure, but the transaction bodies are only covered indirectly, through the
  rules suite and by hand. They need an emulator-backed suite of their own.
- **`importSessionizeProfile` has no per-user rate limit.** `maxInstances` caps
  the bill and the outbound fan-out at Sessionize, but one authenticated user
  can still call it in a loop.
- Auth is Google sign-in only. Fine for a Google event, but it turns "no Google
  account" into "cannot submit".
- **No domain is verified with Resend yet**, so the pipeline is in dry-run. Every
  other part of it is built and tested; see [Email](#email) for the four steps.
- **No confirmation reminder or waitlist-promotion job.** An acceptance sets no
  `confirmDeadline` and nothing chases a speaker who does not confirm. §8 lists
  both; both want a scheduled function, which is the next thing to build.
- **Failed sends need a human.** The trigger records `failed` and the admin page
  offers a retry button, but nothing retries on its own or alerts anyone.

## Seeding a review corpus

```bash
npm --prefix functions run build
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-devfest-cfp \
  node scripts/seed-corpus.mjs --proposals 40 --cfp devfest-mtl-2026
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
