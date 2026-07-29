# AGENTS.md

Conventions and hard-won facts for this repo. `SPEC.md` is the product spec;
`README.md` is for humans arriving at the project.

## Commands

```bash
npm start            # the whole local stack: emulators, seeded config, next dev on 5173
npm run verify       # lint, build, unit, rules, e2e — what CI runs
```

Three suites: `npm test` (vitest `unit` project, node only), `npm run test:rules`
(vitest `rules` project, needs the Firestore emulator), and `npm run test:e2e`
(Playwright against the `npm start` stack). Both emulator suites go through
`scripts/with-java.mjs`, which finds a Homebrew JVM — macOS has none on PATH.

```bash
node scripts/seed-cfp.mjs --id my-conf --name "My Conf" --opens 2027-01-01 --closes 2027-02-01
node scripts/set-platform.mjs --url https://cfp.example.org
```

Standing a CFP up outside the app (a fresh emulator, or one for somebody else),
and the platform's own settings. Both take the emulator env vars from their own
headers. There is no bootstrap-admin script any more: whoever creates a CFP is
written as its owner in the same transaction.

## Layout

```
shared/      enums, types, zod schema, email copy, pure parsers — BOTH bundles
src/         the app: pages/ (submit, admin, review), lib/ (data access), i18n/
functions/   callables: submit, withdraw, roles, window, aggregates, sessionize,
             emailQueue — plus the sendQueuedEmail Firestore trigger
scripts/     dev.mjs (npm start), seed-cfp.mjs, set-platform.mjs, with-java.mjs
tests/       *.test.ts — rules.test.ts needs the emulator, the rest do not
```

**It is a platform: everything hangs under `cfps/{cfpId}`, where the id is the
slug.** `proposals`, `reviews`, `members`, `roleGrants`, `config` and `emailLog`
are all subcollections of one CFP. Only `speakers/{uid}` (the profile belongs to
the account), `signInLinks` (a platform-wide throttle) and `config/platform` sit
outside. Storage matches: `cfps/{cfpId}/headshots/{uid}/{key}`.

Routes off one path router (`src/lib/router.ts`): `/` the public listing, `/new`
to start one, `/me` the speaker's own profile, then `/c/{cfpId}` the call's
public page, `/c/{cfpId}/submit` the form, `/review` for any role-holder and
`/admin/{tab}` for admins. Only
`/c/{cfpId}` — one segment — is rewritten to the `cfpPage` function for its meta
tags; everything under it stays a static file. Roles are per CFP in `cfps/{cfpId}/members/{uid}` —
`owner` above `admin` above `reviewer`; `roleGrants/{email}` holds an invitation
until its holder first visits. Only an owner archives, deletes or is written by
`createCfp`; `owner` is deliberately not grantable through `grantRole`.

Every callable takes a `cfpId` and checks the caller's role against *that* id.
It is never inferred from the caller's memberships — somebody on two CFPs would
get whichever the server guessed.

A speaker may hold several talks (`LIMITS.maxTalksPerSpeaker`), switched by the
picker on the form. Only the talk half is cleared between them — the speaker
profile and the travel answers carry over (`clearTalk` in `src/lib/formState.ts`).

`src/lib/lifecycle.ts` decides what a speaker may still change: everything until
the committee starts reading, then travel answers only, then nothing. The speaker
profile is outside it — that document belongs to the account and never freezes.
The rules are the enforcement; `editScope` only decides what to disable.

An accepted speaker answers with `respondToDecision` — `confirmed` or `declined`,
from `accepted` only. No token in the link: the CFP is behind Google sign-in and
the proposal is already theirs, so the session is the authentication. Idempotent,
and reversible, because plans change and the alternative is an organiser editing
a status by hand from an email.

Email is a queue, not a send: callables write `emailLog/{kind}__{proposalId}`
inside their own transaction and the `sendQueuedEmail` trigger delivers. Copy
lives in `shared/emailTemplates.ts` (pure, both languages); transport and status
machine in `functions/src/email.ts`. Decisions queue `held` until an admin
releases them together — see the README for why, and for the Resend setup.

Email setup is entirely `/admin`, no redeploy: key, domain, sender, wording.
Copy in `shared/emailTemplates.ts` is placeholder *strings*, not functions, so
the built-in and an organiser's override are the same shape and one editor
prefills from either. Overrides live in `config/email.templates`; a half-written
one (blank subject or body) falls back rather than sending a blank.
Addresses are data (`cfps/{id}/config/email`, `setEmailSettings`); the **key is
Secret Manager only** (`functions/src/secrets.ts`) and never enters Firestore or
a response — the client sees `keyHint`, the last four characters. Resend's domain
API is proxied by `emailDomain` so the DNS records can be shown and re-checked.
`functions/.env*` is only a fallback. `config` is *not* world-readable as a
collection — the rule names the two readable documents one at a time.

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

- **A client component is still rendered on the server.** `'use client'` decides
  where it hydrates, not whether it runs server-side. Anything reading `window`,
  `localStorage` or `navigator` during render crashes the request — `detectLocale`
  and `usePlace` both did. Read them after mount, or take the value as a prop from
  the server.
- **The locale settles one tick after mount, on every page load.** The server
  cannot know it (a cookie read in the root layout would make every route
  per-request, and buys nothing for a crawler, which sends no cookies), so the
  first render uses `SERVER_LOCALE` and the real one arrives in an effect. The
  consequence bites: **never put the dictionary in a data loader's dependency
  list.** Seven loaders keyed their effect on a `useCallback` that closed over
  `t`, so it re-ran on every load and the refetch overwrote whatever was on screen
  unsaved. Key them on `cfpId`.
- **`src/pages/` is a reserved directory** — Next reads it as the Pages Router and
  refuses to build. The screens live in `src/screens/`.
- **Next renders `<div role="alert" id="__next-route-announcer__">`** on every
  page, to announce navigations to screen readers. A bare `getByRole('alert')`
  therefore matches two elements and fails strict mode; use the `alerts` helper in
  `tests/e2e/form.ts`.
- **`npm run check:bundle` asserts what Vite used to give for free:** no emulator
  placeholder config in a client chunk, and no live call to the emulator sign-in.
  A dynamic `import()` is discovered statically, so `devAuth` is *emitted* as a
  chunk no matter what guard surrounds it — what must hold is that the guard folds
  and nothing calls it. That is why the guard at its call site spells out
  `process.env.NEXT_PUBLIC_USE_EMULATORS === 'true'` instead of reading the shared
  constant.
- **`src/server/` is the only server-side data access, and only for documents the
  rules already publish** (`cfps/{id}`, the public listing, the sitemap). The admin
  SDK bypasses rules, so the discipline is the boundary: nothing exported from
  there takes a uid. `server-only` makes the mistake a build error.
- **`/c/{id}` is `force-dynamic` and pinned to `private, no-store`.** Whether a
  call is private is data; a route's cache config is module-level. Unlisting a call
  is a Firestore write with no cache-invalidation hook, so a shared cache would go
  on serving a page that is no longer meant to be found. The cost of that choice is
  `minInstances: 1` in `apphosting.yaml` — every link preview is a real render.

- **`shared/` is compiled twice.** Next resolves `@shared` from `tsconfig.base.json`
  (and `vitest.config.ts` repeats the alias, because vitest does not read
  tsconfig `paths`); functions use
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
- **`reviewsVisible` is a UI convention, not a boundary — do not treat it as
  one.** It hides individual scores and notes, and the rules do enforce that. But
  `aggregate` is a *field on the proposal*, and any reviewer may read any
  submitted proposal, so `aggregate.avgScore` is available to them at any time.
  Firestore rules cannot hide a single field. `src/screens/ReviewPage.tsx` honours
  the intent — it sorts by `stdDev` only once the round is open and never renders
  the aggregate on the card — so the gap is reachable through devtools, not
  through the app. Accepted deliberately: reviewers are already trusted with every
  proposal and this is a committee rather than an adversary. If it ever has to be
  real, the field has to move to its own document (`proposals/{id}/aggregate/…`,
  gated on `reviewsVisible || isAdmin`), which means the rules,
  `recomputeAggregates`, the Proposals dashboard, the review sort, and a backfill.
- **A review document carries exactly five keys**, pinned by `hasOnly` in the
  rules: `cfpId`, `score`, `conflictOfInterest`, `comment`, `updatedAt`. Without
  that the `comment` cap is decorative, because the same text goes in under any
  other name. The cap itself is `LIMITS.reviewCommentMax`, duplicated as a literal
  in the rules because rules cannot import TypeScript, and pinned to it by
  `tests/reviewComment.test.ts`.
- **`status` is function-writable only**, so every decision is a callable.
  `setProposalStatus` is admin-only and refuses `draft` and `withdrawn` — the
  first is not the committee's to touch, the second is the speaker's call.
- **A rules test that writes the same value it seeded proves nothing.**
  `affectedKeys()` never names an unchanged field, so a `hasOnly` guard passes
  either way. Always write a value that differs.
- **The emulator serves `functions/lib`, not `functions/src`.** A mutation test
  against a callable or trigger has to `npm --prefix functions run build` first,
  or it silently re-runs the unmutated code and "passes". Note that the root
  `npm run build` does *not* reach `functions/` — it is its own `tsc`.
- **Rebuilding is not enough; the emulator has to be restarted.** It loads the
  definitions once at startup and does not watch `lib`. A mutation check that
  only rebuilds reports a clean pass against the code it replaced, which is the
  most convincing false negative available.
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
  key rotated from `/admin` would not take effect. `readResendKey()` goes to
  Secret Manager at runtime and short-circuits on `FUNCTIONS_EMULATOR`, since
  there is no Secret Manager emulator.
- **`functions/.env` is tracked and deployed; `.env.local` is neither.** A
  `CFP_PUBLIC_URL` of `http://localhost:5173` sat in the deployed file and went
  out in a real acceptance email as the link the speaker was told to confirm at.
  Local-only values go in `.env.local`, which the emulator reads and deploy
  ignores. The link's default is now derived from `GCLOUD_PROJECT`, and an
  organiser overrides it in `/admin` for a custom domain.
- **The speaker fields have one definition.** `src/components/SpeakerFields.tsx`
  is rendered by both the submission form and `/me`, because `speakers/{uid}` is
  one document belonging to the account. A form opened at a CFP the speaker has
  never submitted to seeds from that profile, not from blank — it is global, so
  they have usually written it already.
- **`/robots.txt` and `/sitemap.xml` come from `src/app/robots.ts` and
  `src/app/sitemap.ts`.** Both are `MetadataRoute` objects, not strings — feeding
  hand-escaped text into the metadata layer double-encodes it. `robots.txt` still
  names no origin: this is a platform, whoever deploys it picks the origin, and
  the sitemap is at the root where a crawler looks anyway.
  The old warning that a *Cloud Functions* runtime answers `/robots.txt` and
  `/favicon.ico` itself with an empty 404, before any handler
  (`app.all("/favicon.ico|/robots.txt", … 404)`), was real and is now irrelevant:
  nothing here is served by a function. Do not generalise it to Cloud Run — App
  Hosting serves both paths from the app.
- **`firebase/storage` is loaded on demand, from `lib/storage.ts`.** It is ~34 KB
  and the only thing that uses it is the image answer on the *confirmation*
  form — an accepted speaker, once, and only if asked for a photo. `firebase.ts`
  must not import it, or the bundler puts it back in the main chunk and every
  visitor pays for it again.
- **Analytics is off until somebody says yes, and off by default entirely.**
  `VITE_FIREBASE_MEASUREMENT_ID` is the single switch: with no id the module is
  inert and the consent banner does not render, which is the state of the
  emulators and of anyone else deploying this. With one, nothing loads until the
  banner is answered — `firebase/analytics` is a dynamic import inside
  `start()`, because a top-level import writes its cookie on init and would
  defeat the gate whatever the banner said. Law 25 and the GDPR also require
  refusing to be as easy as agreeing, which is why both buttons are the same
  plain `.btn`; a quiet grey decline would not survive being looked at.
  Unanswered and declined must behave identically — to somebody who scrolled
  past the banner they are the same thing.
- **Withdrawing consent is checked before the cached instance, not after.**
  `start()` returns null on `!granted()` *first*; the other order looks
  equivalent and is not, because `instance` survives a withdrawal and `track()`
  would keep pushing into `dataLayer`. `setAnalyticsCollectionEnabled` does stop
  those reaching Google — it sets gtag's own `ga-disable-*` flag — but that puts
  the whole withdrawal on one third-party switch. The footer control that
  reopens the banner is not decoration either: GDPR Art. 7(3) and Law 25 require
  withdrawing to be as easy as agreeing, and "clear your browser storage" is not.
- **Never put anything personal in an event parameter.** `track()` takes
  `Record<string, string | number>` so an object cannot be passed by accident,
  and every call site sends codes: a CFP slug, a category value, a route shape.
  The path is reduced by `pageShape` first, so GA sees `/c/{cfpId}/submit` and
  the slug travels separately — one row per screen in the report instead of one
  per call.
- **`#/c/{id}` links are still out there.** The router moved from the hash to the
  path so a call for proposals could have a public page a crawler and a link
  preview can read. Every acceptance and sign-in link mailed before that carries
  the old form, and mail cannot be reissued — `adoptLegacyHash` in
  `src/lib/router.ts` rewrites it before the first render, keeping the query
  string because a sign-in link's one-time code lives there. Anything that emits
  a URL has to move with the router: `cfpUrl` in `functions/src/email.ts` is the
  one that reaches speakers.
- **The email link is never taken from the request.** `sendQueuedEmail` is a
  trigger and has no request; the callables that queue see only a client-supplied
  `Host`, so reading it would let whoever submits a proposal choose the URL in
  mail we send to a speaker. Derive it or store it — never reflect it.
- **`unauthenticated` means the caller, never a third party.** Resend refusing an
  API key was thrown as `unauthenticated`, so `/admin` told the admin their
  session had expired and to sign in again — advice that could not work, for a
  session that was fine. `domains.ts` throws `failed-precondition` and
  `resendError` maps it; a borrowed code becomes a lie in the other mapper.
- **A late load must not overwrite a field someone is typing in.** Every admin
  panel seeds its inputs from an async call; without an `editing` ref the field
  empties under the cursor. It only reproduces under load, so the test holds the
  response open with `page.route` rather than hoping for the race.
- **Charts are hand-rolled SVG/CSS in `src/components/charts.tsx`.** A chart
  library would outweigh the page it draws. (The old reason given here — "the
  deployed CSP blocks CDN scripts" — was never true: the live site sends only
  `strict-transport-security`, and nothing in this repo sets a CSP.)
- **Test a guard through `callAs`, not the UI.** "The button is not rendered" is
  not the claim worth proving; `tests/e2e/backend.ts` calls the callable directly
  with a real ID token. Always pair refusals with one call that succeeds, or a
  broken URL passes as a refusal.
- **`signedIn()` means verified, not merely authenticated.** Google always
  verifies, so while it was the only provider the two were the same. Enabling
  email sign-in also enables email+password signup — the Identity Toolkit has no
  link-only mode — and that verifies nothing, while roles are granted by address.
  Without the `email_verified` check anyone could register a colleague's address
  and pick up their pending grant. `claimRole` and `uidForEmail` check it too.
- **A custom domain needs adding to Auth's authorized domains by hand.** Firebase
  Hosting serving it is not enough: `signInWithPopup` refuses from an unlisted
  origin with `auth/unauthorized-domain`, which looks like a broken button.
- **The sign-in link never touches `emailLog`.** It is a bearer credential, so
  `requestSignInLink` renders it and hands it to `sendViaResend` in the one
  request — no queue row, no retry, nothing to read back. That is also why it
  cannot reuse the `queueEmail` path everything else goes through.
- **Both forms are data.** `config/confirmForm` is what a speaker is asked once
  they accept, readable signed in; `config/submissionForm` is what the call
  itself asks — its categories, formats, levels, languages, consents and any
  questions of its own — readable by anyone, because that is the substance of
  the call's public page. Everything else under `config` stays shut, and the
  rule names each readable document rather than opening the collection.
  Both are written only by their callable. The browser's copy of either is a
  convenience; `validateAnswers` and `submissionSchema(shape)` inside the
  callable are what count.
- **An absent `submissionForm` is a working one.** Every CFP created before the
  form was configurable has no document, and `mergeSubmissionForm` reads that as
  today's DevFest values, key by key. `createCfp` seeds the document anyway, so
  a later change to the defaults cannot move the taxonomy under proposals
  already submitted.
- **`deliveryLanguage`'s values are not the organiser's to change.** `either` is
  what `languagePreference` exists for and what the scheduling dashboard counts,
  so a call picks which of the four to offer and what to call them — not what
  they are. `validateSubmissionForm` refuses anything else.
- **No photographs on the submission form.** ~70% of applicants are turned down
  and we should not be holding their picture, so `image` is refused there (§3)
  and offered on the confirmation form, where the speaker is already in.
- **A field's `key` never moves.** Every stored answer is filed under it, so the
  editor generates it once from the English label and then shows it read-only.
  Renaming it would orphan the answers already collected, silently.
- **One Resend account serves the whole platform.** So `emailDomain` is pinned to
  the domain id stored on *this* CFP — `list` used to return the account's whole
  roster, and `get`/`verify` took an id straight from the caller. `setEmailSettings`
  refuses a sender that is not on that domain, or one organiser could write as
  another organiser's verified event.
- **`config/platform` is unwritable by anyone.** `publicUrl` is the origin of
  every link the server mails, sign-in links included, and those are bearer
  credentials — an organiser who could edit it could aim other people's sign-in
  mail at a host they own. It moves with `scripts/set-platform.mjs`, not a form.
- **The committee reads `speakerSnapshot`, never `speakers/{uid}`.** The profile
  is global and a role is per CFP, so reading profiles would hand every committee
  on the platform the whole speaker directory — and would show a bio edited in
  2028 to the 2026 committee. `submitProposal` freezes the copy; it deliberately
  omits the email address.
- **A collection-group query cannot be filtered by ancestor.** `recomputeAggregates`
  and the "where you help out" listing both are one, so `reviews` and `members`
  carry a denormalised `cfpId`/`uid` that the rules pin to the path on write.
  Both need a `COLLECTION_GROUP` entry in `firestore.indexes.json` `fieldOverrides`
  — a single-field index is `COLLECTION`-scoped by default, and the emulator does
  not enforce indexes, so this only fails in production.
- **`archived` is a boolean that is always written, never an absent timestamp.**
  Absence-testing does not work inside a `list` rule: `keys().hasAny`, `in` and
  `get(k, null)` all read true for every document, so an archived CFP stayed on
  the public listing. The timestamp beside it is for display only.
- **An image answer is a fact about the bucket, not a value the browser sends.**
  The file goes straight to `cfps/{cfpId}/headshots/{uid}/{key}`, which the rules
  confine to its owner, and `respondToDecision` asks the bucket what is there rather than
  believing the answer it was handed. A forged path is worth nothing.
- **Organisers read headshots through `headshotImage`, which returns the bytes.**
  Storage rules cannot read Firestore, so the committee cannot be named there.
  Not a signed URL: `getSignedUrl` needs a private key the emulator lacks, and a
  deployed function only signs by calling IAM `signBlob` — a role the runtime
  service account does not have by default. It would pass here and fail there.
- **`readStoredObjects` in the e2e helpers uses `/storage/v1/`, not `/v0/`.** The
  `/v0/` surface enforces `storage.rules`, which refuse listing, so a helper that
  swallowed the 403 returned `[]` and made every "nothing was uploaded"
  assertion pass whether or not anything had been.
- **The review deck freezes its order at load, and its tests must wait for the
  save.** Sorting by "unscored first" on every render reshuffles the card the
  reviewer is about to score. The reshuffle only lands once the write returns,
  so a position asserted straight after the keypress reads the frame before it
  and passes either way — wait for the `n of m scored` counter first.
- **`check()` cannot be used on a control that navigates.** It verifies and
  retries, so a score button that advances the deck is found unpressed on the
  *next* card and clicked again, scoring the whole queue. Use `click()`. The
  control is a button with `aria-pressed` rather than a radio for the same
  reason: radios are expected to stay put.
- **Population sd for reviewer calibration, sample sd for disagreement.** They
  differ by √(n/(n−1)), which varies with n — mixing them makes proposals with
  unequal review counts incomparable.
- **Real Firebase config is in `.env.production.local`, not `.env.local`.** Next
  loads it for a production build only, so `npm start` stays on the emulators. In
  the cloud it comes from Secret Manager via `apphosting.yaml`; the six secrets
  are named `next-public-firebase-*`. `next.config.ts` fails the build if the
  projectId starts with `demo-`, because the tracked `.env` holds exactly that and
  Next reads `.env` in every mode.
- **Env is read in one place: `src/lib/env.ts`,** spelled out literally. Next
  substitutes `process.env.NEXT_PUBLIC_X` only where it is written in full — a
  destructure or `process.env[name]` silently becomes `undefined` in a browser.
- **Use `npx firebase`.** The globally installed CLI is 12.x and cannot run
  `emulators:exec` or the `nodejs22` runtime.
- Project `devfest-mtl-2026-cfp`; Firestore and the 27 functions both in
  `northamerica-northeast1`. Deploying functions needs the Blaze plan.
- **App Hosting runs in `us-east4`, and there was no choice.** The API offers six
  regions and no Canadian one. Firestore and every callable stay in Montréal, so
  no personal data leaves the country — a proposal goes browser → Firestore
  directly and never touches the backend's region. What renders in Virginia is the
  public page, which holds only what a call has published. Worth stating because
  the rest of this stack was put in Canada on purpose.
- **Deploy with `npx firebase deploy --only apphosting`** — local source, no
  GitHub connection. `next dev` renders the public pages too, so it needs
  `FIRESTORE_EMULATOR_HOST` and `GCLOUD_PROJECT`; `scripts/dev.mjs` passes both.
- **Live at `cfp.gdgmontreal.com`. Do not disable the Hosting site.** `authDomain`
  is `devfest-mtl-2026-cfp.firebaseapp.com`, and that site is what answers
  `/__/auth/*` — every sign-in completes through it. It serves nothing but 301s to
  the canonical origin; `hosting-redirect/` is that release and explains the rest,
  including why App Hosting's domain reconciler will report a CNAME that no
  nameserver serves.
- **`next dev` does not apply `headers()` from `next.config.ts`.** So no e2e test
  can see a header — assert on the config instead, as `tests/headers.test.ts`
  does, and confirm the real thing with `curl -sI` after a deploy. App Hosting
  also sends none of the security headers Firebase Hosting used to add for free,
  which is why they are declared explicitly.

## Keeping this file

Add a fact only if it would change what the next agent does. Delete anything the
code now makes obvious, and compact when sections start to sprawl — this is a
working set, not a changelog.
