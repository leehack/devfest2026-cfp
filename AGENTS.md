# AGENTS.md

Conventions and hard-won facts for this repo. `SPEC.md` is the product spec;
`README.md` is for humans arriving at the project.

## Commands

```bash
npm start            # the whole local stack: emulators, seeded config, next dev on 5173
npm run verify       # lint, build, unit, rules, e2e — what CI runs
npm run test:e2e:changed  # browser tests affected by uncommitted changes
npm run test:e2e:failed   # failures recorded by the previous browser run
```

Three suites: `npm test` (vitest `unit` project, node only), `npm run test:rules`
(vitest `rules` project, needs the Firestore emulator), and `npm run test:e2e`
(Playwright against the `npm start` stack). Both emulator suites go through
`scripts/with-java.mjs`, which finds a Homebrew JVM — macOS has none on PATH.
CI splits Playwright across four isolated runners, each with its own stack, while
keeping `workers: 1` inside every shard because each test resets shared emulator
state. The live Sessionize probe runs separately and does not gate a merge.

```bash
node scripts/seed-cfp.mjs --id my-conf --name "My Conf" --opens 2027-01-01 --closes 2027-02-01
node scripts/set-platform.mjs --url https://cfp.example.org
GCLOUD_PROJECT=my-project node scripts/set-platform-admin.mjs --email admin@example.org
GCLOUD_PROJECT=my-project node scripts/set-platform-admin.mjs --email owner@example.org --role owner
```

Standing a CFP up outside the app (a fresh emulator, or one for somebody else),
the platform's own settings, an administrator, and the first global owner. The seeding scripts
take emulator env vars from their own headers. `seed-cfp --owner` requires that
organiser to already have a verified, enabled Auth account; it never leaves a
pending owner grant. There is no in-app CFP-owner bootstrap: an approved creator
is written as owner in the creation transaction. Platform
owners are different and deliberately bootstrapped out of band; they delegate
platform admins, and owners or admins delegate creator access.

## Layout

```
shared/      enums, types, zod schema, email copy, pure parsers — BOTH bundles
src/         the app: screens/ (submit, admin, review), lib/ (data access), i18n/
functions/   callables: submit, withdraw, event/platform roles, window,
             aggregates, sessionize, emailQueue — plus email delivery
scripts/     dev.mjs, seed-cfp.mjs, set-platform.mjs,
             set-platform-admin.mjs, with-java.mjs
tests/       *.test.ts — rules.test.ts needs the emulator, the rest do not
```

**It is a platform: everything hangs under `cfps/{cfpId}`, where the id is the
slug.** `proposals`, `reviews`, `members`, `roleGrants`, `config` and `emailLog`
are all subcollections of one CFP. Only `speakers/{uid}` (the profile belongs to
the account), `platformMembers/{uid}` and `platformRoleGrants/{email}` (global
creator access), `signInLinks` and `speakerInvitationLimits` (platform-wide
hashed address/network/global throttles), `config/platform`, callable-only
`config/platformEmail`, callable-only `config/emailProvider` and
`emailDomainBindings/{hash(domainId)}` sit outside.
Storage keeps server-only
working versions under
`cfps/{cfpId}/workingHeadshots/{proposalId}/{uid}/{key}/{uploadId}` and confirmed
copies under
`cfps/{cfpId}/confirmedHeadshots/{proposalId}/{uid}/{key}/{generation}`.
Reusable profile originals live under `speakerProfilePhotos/{uid}/{uploadId}`;
custom programme originals live under
`cfps/{cfpId}/workingScheduleSpeakerPhotos/{assetRef}` with callable-only
metadata in `scheduleSpeakerPhotoAssets/{assetRef}`;
public square derivatives are cached under the immutable release prefix
`cfps/{cfpId}/publicSchedulePhotos/{releaseId}/{photoRef}.webp` and remain
callable-only.
`headshots/{uid}/{key}` is a read-only compatibility fallback for uploads made
before proposal pointers existed.

Routes off one path router (`src/lib/router.ts`): `/` the public listing, `/new`
to start one, `/platform` for global creator access, `/me` the speaker's own
profile, then `/c/{cfpId}` the call's public page, `/c/{cfpId}/submit` the form,
`/review` for any role-holder and `/admin/{tab}` for admins. Only
`/c/{cfpId}` — one segment — is rewritten to the `cfpPage` function for its meta
tags; everything under it stays a static file. Roles are per CFP in `cfps/{cfpId}/members/{uid}` —
`owner` above `admin` above `reviewer`; `roleGrants/{email}` holds an invitation
until its holder first visits. Only an owner archives, deletes or is written by
`createCfp`; `owner` is deliberately not grantable through `grantRole`.

A pending event grant carries an opaque `invitationId`. The grant trigger uses
that id for one generic committee invitation and revalidates the exact pending
grant before delivery. Changing a pending role does not spam another invite;
revoking and later inviting again creates a fresh id. A claimed grant is already
active and receives later proposal/schedule staff notices instead.

Platform roles are separate: `owner`, `admin` and `creator` answer who may
delegate platform access and create a CFP. They grant no access to event data.
Both global collections are callable-only; owners grant/revoke admins, while
owners and admins grant/revoke creators. `scripts/set-platform-admin.mjs --role
owner` is the only path for platform-owner changes and transactionally refuses
to remove the last active owner. A disabled, deleted or unverified Auth account
does not count as a fallback. Auth and Firestore cannot share a transaction, so
there is an unavoidable narrow race if an account is disabled during that
removal; the role-document check itself is transactional. `createCfp` checks
the global role again inside its creation transaction.

Every callable takes a `cfpId` and checks the caller's role against *that* id.
It is never inferred from the caller's memberships — somebody on two CFPs would
get whichever the server guessed.

A speaker may hold several talks (`LIMITS.maxTalksPerSpeaker`), switched by the
picker on the form. Only the talk half is cleared between them — the speaker
profile and, when the CFP collects them, the travel answers carry over
(`clearTalk` in `src/lib/formState.ts`).

`src/lib/lifecycle.ts` decides what a speaker may still change: everything until
the committee starts reading, then configured travel answers only, then nothing.
When attendance is disabled, the logistics scope has no attendance UI or write.
The speaker profile is outside it — that document belongs to the account and
never freezes. The rules are the enforcement; `editScope` only decides what to
disable.

Each accepted speaker answers with `respondToDecision` — `confirmed` or
`declined`, from `accepted` only. Proposals that have entered roster mode store
the answer, required form data and image pointers under
`speakerConfirmations/{uid}`; a solo proposal that has never entered roster mode
retains the root fallback. The proposal becomes
`confirmed` only when every active speaker confirms. A co-speaker decline leaves
the talk accepted and needing organiser attention; a lead decline declines it.
An admin may invite a late co-speaker after acceptance. The pending invite changes
nothing; acceptance moves a confirmed working session back to `accepted`, while
the previous immutable release stays valid for its original roster until the new
speaker confirms and an organiser re-shares it.
No token in the link: the signed-in session is the authentication. Admins cannot
set a speaker response, because doing so would bypass that person's required
answers and image. Moving a committee decision back clears every personal
response and re-enters `under_review`, never editable `submitted`.

Email is a queue, not a send: callables write a deterministic `emailLog` row and
the `sendQueuedEmail` trigger delivers. Proposal decisions key by proposal;
schedule placement rows also key by immutable release, and staff notices by
recipient. Copy lives in `shared/emailTemplates.ts` (pure, both languages);
transport and status machine in `functions/src/email.ts`. Decisions and speaker
schedule changes queue `held` until an admin releases them together. Generic
committee invitations, proposal-ready notices and shared-preview notices are
immediate, but re-check the grant/member, proposal or shared pointer before send.
An explicit `locale` on the event member or pending grant is honoured; otherwise
one notice renders both EN and FR, including both organiser overrides.

Email setup needs no redeploy: a platform owner/admin rotates the one shared key
and manages the default domain, sender and reply-to from Platform email settings
in the account menu.
Adding a replacement platform domain only stages its binding; the active domain
continues serving events until a verified candidate is explicitly activated.
Activation swaps the pointer, removes only the old platform binding, and clears
an old sender that does not belong to the new domain.
An event inherits that default while its admin stages a separate sender setup
from `/admin`. Only explicitly activating the event override switches identity;
after that it fails closed until its own domain binding is valid rather than
silently borrowing the platform identity.
Copy in `shared/emailTemplates.ts` is placeholder *strings*, not functions, so
the built-in and an organiser's event override are the same shape and one editor
prefills from either. Event templates fall back directly to built-ins; platform
administration does not own wording. A half-written override (blank subject or
body) falls back rather than sending a blank.
Addresses are data; the **key is
Secret Manager only** (`functions/src/secrets.ts`) and never enters Firestore or
a response — callable-only `config/emailProvider` holds only `keyHint`, the last
four characters. Platform defaults live in callable-only `config/platformEmail`;
events store `senderMode` and their own fields in `cfps/{id}/config/email`.
Platform-mode events may store `platformSenderName` as a display-name override;
the effective address always remains the platform-owned address.
An absent/null event `replyTo` inherits; an explicit empty string clears it.
Resend's domain API is proxied by scope-specific callables so the DNS
records can be shown and re-checked. `emailDomainBindings/{hash(domainId)}` is a
callable-only, exclusive scope assignment: platform and event bindings are
distinct, and an event may not adopt an existing unbound or differently scoped
domain by typing its public name. A platform administrator may reclaim an
unbound domain already in the shared provider account only when no event config
references its exact provider id.
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
- **Reviewers never read raw proposal documents.** They receive the active review
  queue through a callable-owned whitelist projection. When this CFP enables
  attendance, the only travel data in that projection is the configured,
  reviewer-visible subset for each speaker on the current active roster:
  `status`, `fundingSource`, `decisionBy` and `needsVisa`. Each subfield has its
  own collection and reviewer-visibility switch; disabled values never enter the
  DTO. A disabled attendance section produces no travel projection at all.
  Read active `speakerParticipants` rows first and use root `attendance` only as
  the legacy solo fallback; never copy an attendance map verbatim. The projection
  still strips acknowledgements, contact and photo data, lifecycle state, and all
  post-acceptance confirmation answers, including dietary and accessibility
  needs. Core proposal fields are always reviewable. For organiser-defined
  submission questions, `reviewerVisible: false` excludes that answer; an absent
  flag is the legacy-compatible visible default. Acknowledgements never enter the
  review payload. It filters active or former speakers out of their own
  proposals. Drafts are outside that queue. Active speakers and event admins
  retain the raw reads they need. An exact pending invitee sees only a separate
  callable-projected consent summary. The queue is a one-shot read, so attendance
  is current as of its most recent load or refresh rather than updated live.
- **`speakerIds` starts as `[uid()]` and is callable-only thereafter.** A verified
  email invitation is still only pending metadata: the exact invited account must
  accept before its uid is added. The first speaker remains `primarySpeakerId`
  and owns talk edits. Removed participants stay in `formerSpeakerIds` and remain
  conflicted from reviews permanently.
- **Late invitations do not mutate a confirmed roster until acceptance.** Only an
  event admin may create one, and the invitee must supply their own configured
  acknowledgements and attendance before joining. Attendance is neither rendered
  nor required when the current submission form disables it. A marker preserves
  only the roster in the prior immutable schedule release; it is cleared by a
  successful re-share, not merely by the new speaker confirming.
- **A role-holder must never read reviews of their own proposal.** Blocked on
  reads and writes alike, admins included — `firestore.rules` and six tests
  around the `reviewsVisible` flip.
- **`reviewsVisible` is a boundary for reviewer aggregates.** Rules deny a plain
  reviewer the raw proposal document, and the review-queue callable includes the
  numeric aggregate only after the flag flips. Admins keep direct proposal access;
  individual review documents remain independently protected for every role.
- **A review save is a callable transaction, not a browser write.** It writes
  exactly `cfpId`, `score`, `conflictOfInterest`, optional `comment`, and
  `updatedAt`, while atomically moving the first `submitted` review to
  `under_review`. Direct review writes are denied: an acknowledged score followed
  by a delayed lifecycle trigger left a real edit race. The comment cap remains
  `LIMITS.reviewCommentMax`, pinned by `tests/reviewComment.test.ts`.
- **`status` is function-writable only**, so every decision is a callable.
  `setProposalStatus` is admin-only and refuses `draft`, `submitted`,
  `withdrawn`, `confirmed` and `declined`. Undo returns to `under_review`:
  `submitted` is still speaker-editable and ends permanently at the first review.
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
- **The app bundle does not import `firebase/storage`.** Confirmation photos go
  through callable upload and preview paths, so browser rules can keep the whole
  bucket closed and Admin SDK writes never need a public download token. Keep
  Storage out of `firebase.ts`; it would add the client SDK back to every page.
- **Analytics is off until somebody says yes, and off by default entirely.**
  `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` is the single switch: with no id the
  module is inert and the consent banner does not render, which is the state of
  the emulators and of anyone else deploying this. With one, nothing loads until
  the banner is answered — `firebase/analytics` is a dynamic import inside
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
- **A link is redeemed ahead of the route, not by it.** `SignIn` is the only
  thing that calls `completeSignInFromLink`, and it used to be reachable only
  where a route happened to render it — so a link asked for on `/me`, `/new` or
  `/platform` (all of which send no `cfpId`, leaving the server nowhere to
  return to but `/`) landed on the one route with no sign-in panel, and the code
  sat unredeemed in the address bar until the first click threw it away. `Routed`
  now answers `emailLink` before any route branch, so this cannot come back for
  a route added later. Two things follow: the check is *not* conditional on
  being signed out — a one-time link names the account that should own the
  session, so it overrides whoever is already in it — and `emailLink` is settled
  in an effect keyed on `[placeKey, user]`, because a server render cannot see a
  query string and completing the link is what releases the destination.
- **`withCfp` in `tests/e2e/backend.ts` fills in the seeded tenant.** So a spec
  that omits `cfpId` is testing the CFP-*scoped* path, not the platform one —
  which is exactly how a dead CFP-less sign-in link sat there fully "covered".
  Pass `cfpId: null` to mean no CFP.
- **Both forms are data.** `config/confirmForm` is what a speaker is asked once
  they accept, readable signed in; `config/submissionForm` is what the call
  itself asks — its categories, formats, levels, languages, consents, optional
  attendance module and any questions of its own — readable by anyone, because
  that is the substance of the call's public page. Attendance owns bilingual
  section/status/subfield copy, per-subfield collection and reviewer visibility,
  and optional event-scoped GDE guidance. Everything else under `config` stays
  shut, and the rule names each readable document rather than opening the
  collection. Both are written only by their callable. The browser's copy of
  either is a convenience; `validateAnswers` and `submissionSchema(shape)`
  inside the callable are what count.
- **An absent `submissionForm` is a working legacy one.** Every CFP created before
  the form was configurable has no document, and `mergeSubmissionForm` reads that
  as the DevFest Montréal compatibility form, including enabled attendance and
  its travel-support acknowledgement. `createCfp` instead seeds
  `NEW_CFP_SUBMISSION_FORM`: generic calls start with attendance disabled and no
  travel-support acknowledgement, so they never inherit Montréal or
  Canada-specific questions. Saving resolves the complete form explicitly, so a
  later default change cannot move the taxonomy under submitted proposals.
- **Attendance configuration changes collection and projection, not history.**
  The organiser owns its bilingual copy and optional GDE guidance, but the
  stored codes `local`, `secured` and `pending` never move. Funding source,
  decision date and visa support may each be disabled or hidden from reviewers.
  `attendanceSchemaFor` ignores disabled values, the late-invitation path uses
  the same current shape, and the review callable projects only enabled and
  reviewer-visible keys. Turning the module off never silently purges historical
  answers. Visa email guidance is conditional on both the question being enabled
  and the stored answer being true.
- **`deliveryLanguage`'s values are not the organiser's to change.** `either` is
  what `languagePreference` exists for and what the scheduling dashboard counts,
  so a call picks which of the four to offer and what to call them — not what
  they are. `validateSubmissionForm` refuses anything else.
- **No proposal-scoped photographs on the submission form.** ~70% of applicants
  are turned down, so `image` is refused there (§3). The account-profile section
  may expose the same optional reusable photo control as `/me`, but that private
  asset is not copied into the proposal or shown to reviewers. An event may
  require it only after acceptance; confirmation freezes one exact generation
  for the programme without exposing the private profile pointer.
- **A field's `key` never moves.** Every stored answer is filed under it, so the
  editor generates it once from the English label and then shows it read-only.
  Renaming it would orphan the answers already collected, silently.
- **One Resend account serves the whole platform.** Its default sending identity
  has an exclusive platform binding; every event override has an exclusive CFP
  binding. Absent or platform `senderMode` inherits the platform settings even
  while event fields are staged. Explicit event mode selects the event scope and
  fails closed until complete; legacy identity fields without a mode remain
  event-scoped for compatibility. Event wording falls back directly to built-in
  copy and never inherits from platform administration.
  Readiness, test sends, sign-in links and the delivery trigger all resolve the
  same effective configuration and re-check its binding. Deleting a CFP removes
  only that CFP's binding; it cannot touch the platform default. The shared key
  and platform defaults are writable only by a current verified platform
  owner/admin; event administration alone is deliberately insufficient.
- **`config/platform` is unwritable by anyone.** `publicUrl` is the origin of
  every link the server mails, sign-in links included, and those are bearer
  credentials — an organiser who could edit it could aim other people's sign-in
  mail at a host they own. It moves with `scripts/set-platform.mjs`, not a form.
- **The committee reads `speakerSnapshot`, never `speakers/{uid}`.** The profile
  is global and a role is per CFP, so reading profiles would hand every committee
  on the platform the whole speaker directory — and would show a bio edited in
  2028 to the 2026 committee. `submitProposal` freezes the copy; it deliberately
  omits the email address. Later profile writes never propagate automatically.
  An active speaker may explicitly refresh their own proposal copy; an event
  admin may do the same for an active speaker. The callable copies only the
  public whitelist, leaves confirmation and logistics alone, and marks an
  existing schedule config stale so immutable releases change only on reshare.
- **A collection-group query cannot be filtered by ancestor.** `recomputeAggregates`
  and the "where you help out" listing both are one, so `reviews` and `members`
  carry a denormalised `cfpId`/`uid` that the rules pin to the path on write.
  Both need a `COLLECTION_GROUP` entry in `firestore.indexes.json` `fieldOverrides`
  — a single-field index is `COLLECTION`-scoped by default, and the emulator does
  not enforce indexes, so this only fails in production.
- **`archived` is a boolean that is always written, never an absent timestamp.**
  Absence-testing does not work inside a `list` rule: `keys().hasAny`, `in` and
  `get(k, null)` all read true for every document, so an archived CFP stayed on
  the public listing. The timestamp beside it is for display only. Archive is a
  historical write fence: reads and the current public programme remain, while
  only role revocation, owner unarchive and confirmed deletion may mutate event
  data. Delayed triggers and email claims re-read the CFP transactionally; a
  provider request already in flight is the one unavoidable handoff race.
  Storage, Secret Manager and Resend mutations take the private
  `config/externalMutation` lease, whose duration exceeds the callable timeout;
  archive refuses a live lease and reclaims an expired one. Delete reserves the
  root with `deleting: true`, clears Storage first, and keeps the owner/member
  tree intact when that step fails so the same confirmed delete can retry.
- **An image answer is a fact about the bucket, not a value the browser sends.**
  `uploadHeadshot` verifies the speaker, their accepted/confirmed/declined
  proposal and current image question, validates both MIME and magic bytes, and
  writes a unique working object under the CFP external-mutation lease. Its
  finishing transaction revalidates the proposal/form and atomically changes
  `headshotUploads[key]`; a failed or ambiguous replacement never deletes the
  previously referenced object. Browser Storage reads and writes are closed.
  `respondToDecision` follows only that server pointer (with a legacy canonical
  fallback), checks the recorded generation, then copies it to
  `confirmedHeadshots` and stores the immutable answer. Unreferenced working
  versions may remain until the CFP's bounded Storage prefix is deleted.
- **`headshotImage` returns private bytes through two explicit branches.** A
  verified accepted/confirmed/declined speaker may request `working: true` only
  for their own proposal's current image field. The default organiser branch
  checks the event role and reads only the immutable answer recorded on that
  proposal, so neither branch is an arbitrary bucket reader. A legacy live-path
  answer is upgraded under the CFP external-mutation lease, including after
  archive, so deletion cannot clear the bucket and then race a late copy back.
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
- **The schedule has three disclosure stages, not one visibility toggle.**
  Admins edit `config/schedule` and `scheduleDraft` through revision-checked
  callables. Sharing writes an immutable `scheduleReleases/{releaseId}` and
  flips `cfps/{id}.sharedScheduleId`; a callable returns a confirmed speaker's
  own entries or the active committee's public-safe preview, never the live
  draft. Publishing can only promote that exact, still-current release through
  `publishedScheduleId`, which is the only pointer anonymous rules open. A later
  status change marks shared and public copies cancelled rather than deleting
  them, so links and calendar UIDs remain stable. Schedule emails are held when
  sharing, not while editing or promoting, and dedupe by release id.
- **Custom programme photos have two opaque identities.** The admin editor keeps
  only a server-generated `photoAssetRef`; its callable-owned metadata binds the
  exact private object and generation. Sharing replaces it with a release-only
  `photoRef` and a private source record. The anonymous image callable accepts
  only the exact current published entry and speaker index, so a working ref,
  path or generation never appears in attendee data. Replacing or removing the
  draft photo cannot rewrite an immutable release.
- **Profile-update requests are tasks, not profile access.** A new request
  generation queues one exact-speaker email and appears in that speaker's talk
  picker plus the organiser's waiting/ready queue. Claim, send, resend and
  completion revalidate the exact active confirmed speaker and request
  generation. Only the speaker adopts the photo or completes the request; an
  included schedule re-share marks that resolved generation handled.
- **An email send is leased and idempotent at the provider.** The queue claim
  stores the CloudEvent id, `sendingStartedAt`, and a durable provider-attempt
  id. Automatic retries and recovery of an ambiguous failure use the same
  Resend idempotency key even when re-queuing creates a new CloudEvent; an
  explicit one-row resend clears it and deliberately starts a new delivery.
  After ten minutes an admin retry may reclaim an abandoned `sending` row,
  while a fresh claim remains untouchable. Resend retains idempotency keys for
  24 hours, so the remaining ambiguity is a process that stays lost beyond that
  provider window.
- **Population sd for reviewer calibration, sample sd for disagreement.** They
  differ by √(n/(n−1)), which varies with n — mixing them makes proposals with
  unequal review counts incomparable.
- **Real Firebase config is in `.env.production.local`, not `.env.local`.** Next
  loads it for a production build only, so `npm start` stays on the emulators. In
  the cloud it comes from Secret Manager via `apphosting.yaml`; the seven secrets
  are named `next-public-firebase-*`. `next.config.ts` fails the build if the
  projectId starts with `demo-`, because the tracked `.env` holds exactly that and
  Next reads `.env` in every mode.
- **Env is read in one place: `src/lib/env.ts`,** spelled out literally. Next
  substitutes `process.env.NEXT_PUBLIC_X` only where it is written in full — a
  destructure or `process.env[name]` silently becomes `undefined` in a browser.
- **Use `npx firebase`.** The globally installed CLI is 12.x and cannot run
  `emulators:exec` or the `nodejs22` runtime.
- **Deploy cross-layer authorization changes in compatibility order:** Functions
  first, App Hosting second, then Firestore indexes/rules and Storage rules. The
  combined `deploy:backend` command is unsafe when new rules remove a read path
  that the old client still uses.
- Project `devfest-mtl-2026-cfp`; Firestore and the Cloud Functions both in
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
- **The redirect release must not touch `/__/`.** Email-link sign-in goes through
  `/__/auth/action`, and that handler fetches `/__/firebase/init.json` from its own
  origin at runtime. A `/:rest*` catch-all swallows it, the cross-origin XHR fails
  CORS, and every link dies on `Error encountered` — while Google sign-in, which
  uses `/__/auth/handler`, keeps working and hides it. Only `/__/auth/*` is served
  ahead of user config, so the exclusion has to be in the config: it is the RE2
  `regex` in `hosting-redirect/firebase.json`, not a glob, because RE2 has no
  lookahead. After any change there, check `/__/firebase/init.json` returns 200
  rather than 301 — the handler answering 200 does not prove sign-in works.
- **New email links deliberately use the `.web.app` action handler.** The bad
  catch-all was a 301, so browsers that reached the broken
  `.firebaseapp.com/__/firebase/init.json` may keep replaying that redirect after
  Hosting is fixed. `requestSignInLink` moves the Admin SDK's generated URL onto
  the project's equivalent `.web.app` origin; do not use `linkDomain` for this —
  Firebase rejects default `web.app` and `firebaseapp.com` domains there. Leave
  Google popup auth on the configured `.firebaseapp.com` `authDomain`. An old
  mailed link cannot be rewritten — its recipient needs a newly issued one.
- **`next dev` does not apply `headers()` from `next.config.ts`.** So no e2e test
  can see a header — assert on the config instead, as `tests/headers.test.ts`
  does, and confirm the real thing with `curl -sI` after a deploy. App Hosting
  also sends none of the security headers Firebase Hosting used to add for free,
  which is why they are declared explicitly.

## Keeping this file

Add a fact only if it would change what the next agent does. Delete anything the
code now makes obvious, and compact when sections start to sprawl — this is a
working set, not a changelog.
