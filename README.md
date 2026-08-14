# A call-for-proposals platform

Any verified user can create and own one organization by default. Platform
administrators may set a per-account ownership override without changing existing
ownership. Organization owners and admins create events, and the creator owns
that event. Each organization starts
with one active event slot; platform administrators may change that limit without
inheriting access to the organization or event. Submission form, Firestore write path,
security rules. `SPEC.md` is the design;
[`AGENTS.md`](AGENTS.md) is the working conventions.

It began as one event's CFP — DevFest Montréal 2026 — whose form remains the
compatibility fallback for older calls. Each CFP now owns its submission form,
including whether it asks about attendance at all. A newly created generic call
starts with attendance disabled.

Next.js App Router + React + TypeScript on Firebase. One zod schema in `shared/` compiles into
both the browser bundle and the functions bundle, so the field limits cannot
drift apart.

```
shared/       enums, types, schema, pure parsers — compiled into both bundles
src/          screens/ submission, review, administration and public programme
functions/    proposal, role, email, aggregate and schedule operations
firestore.rules   the enforcement boundary (§6)
```

Everything hangs under `cfps/{cfpId}`, where the id is the slug — `proposals`,
`reviews`, `members`, `roleGrants`, `config` and `emailLog` are subcollections of
one call. The document id being the slug means creating one *is* the uniqueness
check: there is no second index to keep honest, and no window in which two people
both believe they hold the name. Only `speakers/{uid}` (a profile belongs to the
account, not to any one talk), `platformMembers/{uid}` and
`platformRoleGrants/{email}` (platform administration invitations),
`platformUserLimits/{uid}` (callable-only organization ownership overrides),
`config/platformLimits` (callable-only global organization ownership default),
`signInLinks` (hashed address/network throttles and a platform circuit breaker),
`speakerInvitationLimits` (hashed invitation-rate limits), `config/platform`
(public platform identity and link origin), `config/platformEmail` (platform
email defaults), `config/emailProvider` (provider key hint) and
`emailDomainBindings/{hash(domainId)}` (exclusive event/platform domain
ownership) sit outside.

Screens behind one path router: `/` lists the public calls, `/new` starts one,
`/platform` is the administration overview, with dedicated `/platform/access`,
`/platform/limits`, and `/platform/email` pages, and then `/c/{cfpId}` is that call's
public page, `/submit` the form, `/review` for anyone holding a role on it and
`/schedule` the published agenda or an authenticated committee preview,
`/schedule/{entryId}` a session, and
`/admin/{tab}` for its admins. The public pages are server-rendered by their Next
App Router segment, which puts the call's own title and description into the
HTML — a crawler and a link preview never run the script, so `document.title`
alone buys nothing. Everyone may submit a talk, reviewers and admins included —
they simply never get their own in the queue.

A call is **public** (listed on the home page) or **private** (unlisted, but
readable by anyone with the link — private means unlisted, not secret). Its owner
can **archive** it, which makes it read-only and drops it off the listing, and
then **delete** it, which destroys every proposal, review, photo and email record
under it. Deleting is two steps and needs the address typed back, because it is
other people's writing as well as the owner's. Archive preserves the current
public programme and all history. Only role revocation, owner unarchive and the
confirmed delete closeout remain writable afterward.
Deletion first reserves the archived call, then clears Storage before Firestore;
if Storage is unavailable the owner can retry without leaving private files
behind or letting another tab unarchive the call mid-delete.

A speaker may lead up to three talks and invite up to three verified
co-speakers onto each draft. After a session is accepted or confirmed, an event
admin may send the same verified invitation for a late co-speaker. The pending
invitation changes nothing; acceptance reopens the working session until the new
speaker completes their own participation details and confirmation. The picker on the form switches between talks; the
speaker profile and, when this CFP collects them, travel answers carry over, so
a second submission does not mean retyping a bio. The talk cap is enforced in
`submitProposal`, because rules cannot count documents — drafts above it are
allowed and simply never reach a reviewer.

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

Creation is restricted even locally. After signing in as the test speaker,
grant that account platform-admin access through the emulators:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
GCLOUD_PROJECT=demo-devfest-cfp \
node scripts/set-platform-admin.mjs --email test.speaker@example.org
```

For a deployed project, deploy the Functions that understand the `owner` role
before running the script with its project id and application default
credentials. A verified existing account becomes active immediately; otherwise
the grant waits for that address's first verified sign-in. Existing
administrators keep working unchanged. Promote the first owner explicitly:

```bash
env -u FIRESTORE_EMULATOR_HOST \
  -u FIREBASE_AUTH_EMULATOR_HOST \
  -u FIREBASE_STORAGE_EMULATOR_HOST \
  GCLOUD_PROJECT=devfest-mtl-2026-cfp \
  GOOGLE_CLOUD_PROJECT=devfest-mtl-2026-cfp \
  node scripts/set-platform-admin.mjs --email owner@example.org --role owner
```

Owners delegate administrators from `/platform`; owners and administrators
manage organization event limits there. Owner changes stay out of band, and the script
transactionally refuses to remove the last active owner. Disabled, deleted and
unverified accounts do not count as a safe replacement; have the replacement
open `/platform` successfully before removing the previous owner. Deploy the web
app only after that first owner can open `/platform`.

## Verify

```bash
npm run verify   # lint, build, unit, rules, end-to-end
```

| Suite | Needs | Covers |
|---|---|---|
| `npm test` | node | schema, scoring, parser, import merge, message translation |
| `npm run test:rules` | Firestore emulator, JVM | `firestore.rules` |
| `npm run test:e2e` | the full stack | every applicant, reviewer and admin flow |
| `npm run test:e2e:changed` | the full stack | browser tests affected by uncommitted changes |
| `npm run test:e2e:failed` | the full stack | failures recorded by the previous browser run |

For release-level exploratory testing, the reusable persona, seed-state,
mutation-budget, screenshot, accessibility, and flow catalog lives in
[`docs/qa/persona-flow-handbook.md`](docs/qa/persona-flow-handbook.md). Keep it
in sync when a route, role, lifecycle state, or user-facing transition changes.

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
out from under its owner. Immediate application and first-visit claiming live
together in `functions/src/roles.ts`, so the two paths enforce the same role
rules.

A new pending grant also queues a generic committee invitation. Its authenticated
review link is valid only while that exact grant is still pending; claiming or
revoking it makes an unsent row stale. People whose verified account already
exists receive the role immediately and join the active notification audience.

**Platform access is separate from event roles.** `platformMembers` answers who
may administer shared platform settings; a platform owner or admin cannot read
or administer an event unless that CFP separately grants them a role. Owners
delegate admins from `/platform/access`. Any verified user may own one organization
by default; platform administrators can change that global default or set
per-account overrides from `/platform/limits`, and
organization owners or admins create events within its active-event limit. These
global access and limit documents are unreadable and unwritable from every browser, so the
directory and every change go through verified, role-checked callables. The
first platform owner is deliberately bootstrapped out of band with
`scripts/set-platform-admin.mjs --role owner`.

**A reviewer who is also a speaker must never read the reviews of their own
proposal.** §6 outranks any role, so the block is on reads and writes alike,
admins included, and holds through the moment `reviewsVisible` flips. Six rules
tests pin it, including that flip.

**Reviewers cannot see each other's scores until an admin opens the round** (§7,
anchoring). Enforced in `firestore.rules`, not by hiding the section — and the
review queue re-sorts by disagreement once it is open, because that is what the
selection meeting is actually for.

**Attendance is optional event data, not platform copy.** An organiser may turn
the section on for a CFP and owns its English and French title, question, status
labels, subfield wording and optional GDE guidance. Funding source, decision date
and visa support can each be collected or omitted, and every collected value has
its own reviewer-visibility switch. The status codes stay fixed as `local`,
`secured` and `pending`, because validation, dashboards and exports use their
meaning rather than their labels.

A missing attendance configuration belongs to a legacy call and preserves the
DevFest Montréal questions and reviewer visibility. `createCfp` instead writes an
explicit generic form with attendance disabled and no travel-support
acknowledgement, so another event never inherits Montréal or Canada-specific
questions by accident. Disabling the section stops new validation and reviewer
projection; it does not silently purge previously submitted personal data.
Post-acceptance co-speaker invitations follow the same current configuration,
and visa email copy is included only when that question is enabled and answered
yes.

**Submitting is not what closes a proposal — the deadline is.** A speaker keeps
editing after they submit, and keeps seeing what they sent: the form stays on
screen with a status banner rather than being replaced by a dead end. Once the
committee starts reading, the content freezes. If this CFP collects attendance,
those answers remain editable after the window shuts — accepted in September,
visa refused in October. `src/lib/lifecycle.ts` names the three states;
`firestore.rules` enforces them, down to refusing an abstract smuggled in beside
an attendance change.

The first saved review and `submitted → under_review` happen in one callable
transaction. Review documents are not browser-writable: acknowledging a score
before the lifecycle lock landed left a real interval in which the speaker could
change the content already being judged. Admins choose committee outcomes;
`confirmed` and `declined` remain speaker responses, so the required confirmation
form and photo cannot be bypassed from the proposal table.

**A draft is private to its active speaker roster.** Before accepting, an exact
invited account sees only the talk summary needed to make an informed choice.
Event admins see a proposal only once it has been submitted — someone may have
typed something into a pitch and thought better of sending it, and the committee
has no claim on that. Reviewers use a callable-projected queue containing only
public speaker snapshots and review-relevant proposal fields; their browser
cannot read raw proposal documents.

**A roster changes only through verified invitations.** A proposal starts with
one lead speaker. While it is still a draft, the lead may invite up to three
co-speakers by verified email; the invitation grants nothing until that exact
account reviews the talk, accepts, and completes its own profile and participation
details. Pending invitations block submission. The lead owns talk content and
withdrawal, while each active speaker owns any personal logistics this CFP asks,
confirmation answers, and photo. Every active speaker must confirm before the
proposal becomes `confirmed`.

Once accepted, only an event admin may add a late co-speaker. The current roster,
confirmation state, and published programme remain unchanged while the invite is
pending. Acceptance adds the person, moves a confirmed working session back to
`accepted`, and marks its schedule stale. The previous immutable public release
stays visible until every active speaker confirms and an organiser shares and
publishes a new release.

Accepting also creates a permanent conflict for that proposal. Removing someone
from the active roster does not make them eligible to review material they have
already seen; their inactive participant record and `formerSpeakerIds` preserve
that history. Invite delivery is throttled through hashed counters, and its
private draft title/address never appears in the admin email queue.

**The speaker profile belongs to the account, not to a talk.** One
`speakers/{uid}` shared by every proposal, editable throughout — including while
a talk is frozen, because a changed employer is not a changed talk.

The reusable speaker photo belongs there too. A speaker may add or replace it
from `/me` or from the account-profile section while preparing a proposal; it
remains optional and is not copied into the proposal reviewers see. Its private
original is replaced through a server callable, not a browser Storage write. An
event may make the photo mandatory at confirmation; confirming freezes that
exact generation into the speaker's event response. A published programme
serves a square derivative through an opaque release member, so replacing or
removing the global profile photo never rewrites an already-published schedule.

**But the committee reads a copy, not the profile.** `submitProposal` freezes a
`speakerSnapshot` onto the proposal. Two reasons, one answer: a profile is global
while a role is per call, so letting reviewers read profiles would hand every
committee on the platform the whole speaker directory; and a bio rewritten in
2028 would otherwise change what the 2026 committee is recorded as having judged.
The snapshot deliberately omits the email address — a reviewer judging a talk has
no need of it. Later profile edits do not silently rewrite that event copy. The
speaker, or an event admin acting on an active speaker, may explicitly refresh
one proposal from the current profile. The refresh first shows the changed public
fields side by side and refuses to apply a profile that changed after that
comparison. An admin never sees or adopts a newer private location or the photo
itself; photo approval remains the speaker's action.

After a speaker has confirmed, an admin may request updated profile details, the
programme photo, or both. A targeted email opens that exact session, the speaker
picker shows a task badge, and the admin proposal table keeps a waiting/ready
queue; copying the session link remains a fallback. The speaker edits the account
profile, explicitly applies the requested details or photo to that session, and
marks the request complete. Confirmation answers and travel details stay
untouched. The ready state remains visible until an organiser includes the
session in a new shared release; an existing shared or published programme never
changes in place.

**Selection is a callable, for the same reason submission is.** `status` is what
every other permission keys off, so an applicant who could write it could accept
themselves. `setProposalStatus` accepts the committee workflow states in
`STATUS_SETS.adminSettable`. Undo returns to `under_review`; `submitted` remains
the speaker-editable state before the first review. It refuses `draft` (not
theirs to touch) and `withdrawn` (the speaker's call, which outranks the
committee's). Moving an `accepted`, personally `confirmed`, or `declined`
proposal back into the committee workflow is an explicit reset: it clears
speaker responses and is not presented as undoable.

## The deployed project

Project **`devfest-mtl-2026-cfp`**. Firestore and the Cloud Functions are in
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

### Moving a legacy CFP into an organization

`scripts/migrate-single-cfp-to-org.mjs` preserves every CFP subcollection,
Auth account and Storage object. It is dry-run by default and has two phases so
the old release never loses its owner while the new release is rolling out.
Take and verify a Firestore backup before applying either phase.

```bash
# 1. Inspect, then add orgId/ownerUid while retaining legacy ownerUids.
npm run migrate:organization -- \
  --project devfest-mtl-2026-cfp \
  --cfp devfest-mtl-2026 \
  --org your-organization \
  --org-name "Your Organization"

# Repeat with writes explicitly confirmed.
npm run migrate:organization -- \
  --project devfest-mtl-2026-cfp \
  --cfp devfest-mtl-2026 \
  --org your-organization \
  --org-name "Your Organization" \
  --apply --confirm-project devfest-mtl-2026-cfp
```

Deploy Functions, the app, and rules in the order below, verify the owner can
open both the organization and event workspaces, then dry-run and apply the
cleanup phase:

```bash
npm run migrate:organization -- \
  --project devfest-mtl-2026-cfp \
  --cfp devfest-mtl-2026 \
  --org your-organization \
  --phase finalize

# Add only after reviewing the dry-run output:
# --apply --confirm-project devfest-mtl-2026-cfp
```

Prepare refuses ambiguous or mismatched event ownership, an unusable Auth
owner, or an organization owned by somebody else. Finalize refuses to run until
the organization, canonical owner and owner membership agree; it then removes
the legacy owner array and obsolete platform `creator` records.

```bash
npm run verify                                  # lint, types, build, bundle gates, 3 suites
npm run deploy:functions                        # new callables first
npm run deploy:app                              # then the app, from local source
npm run deploy:rules                            # restrictive rules and indexes last
npm run smoke:production                        # edge headers, public routes and Auth handler
```

Keep that order when a release adds a callable and replaces a client-side read
with it: the old app needs the old rules until the new app is live, while the new
app needs the callable before it starts using it. `deploy:backend` remains a
combined convenience command only for changes without that compatibility edge.

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

One Resend account serves every call on the platform. Platform owners and
administrators manage its shared key and a default domain, sender and reply-to.
Replacing the platform domain is staged too: the active identity keeps
serving inheriting events while DNS is verified, and only an explicit activation
swaps the verified pointer. A sender that does not match the replacement is
cleared at that cutover and must be saved on the new domain. A CFP inherits that default while an event-specific domain is being
staged; only explicitly activating the event override switches identity, after
which delivery fails closed until its exact binding is ready. A callable-only binding assigns
each Resend domain id either to the platform default or to exactly one CFP, so
typing another scope's public domain name cannot adopt it.
The defaults live in callable-only `config/platformEmail`; an event records its
selection and overrides in `cfps/{cfpId}/config/email`. Existing CFPs that
already have a sender or domain remain event-scoped when `senderMode` is absent;
the rollout does not silently move their mail to the platform identity.
`config/platform` holds the site's own origin and is writable by nobody through
the app — it is where every mailed link points, sign-in links included, and those
are bearer credentials. Move it with `scripts/set-platform.mjs`.

Google sign-in is enabled and the live CFP is `cfps/devfest-mtl-2026`. Its
window and organisers are managed from `/admin`. An organization owner or
admin's `createCfp` flow checks its quota and writes the CFP and its owner in one transaction;
`scripts/seed-cfp.mjs` is the outside-the-app option for a fresh environment. It
requires `--org` and `--owner`, creates the organization when absent, and links
the event without bypassing the single-owner model. The organiser must already
have a verified, enabled Auth account; the script refuses instead of creating a
pending owner grant.
`scripts/set-platform-admin.mjs` bootstraps global owners or administrators, and
`scripts/set-platform.mjs` sets the platform-wide public origin.

## Schedule

The Schedule tab in `/admin` is a private planning board. Set the event time
zone and day hours, then add, order, rename or remove unused rooms and tracks.
Drag accepted or confirmed talks to a 5-minute placement guide and resize them
in 5-minute steps. A form behind every card provides the keyboard/touch fallback
and edits the start, duration, room and resolved language. Planner cards keep the
title, speakers, category, format, level, language and confirmation state visible.
Custom programme items cover breaks, meals, opening/closing remarks, keynotes and
social events, with optional language, description and attendee-facing speaker
names, roles, organisations, bios and photos. A custom photo upload returns only
an opaque working-asset handle to the editor. Sharing substitutes a different
release-scoped reference, and the anonymous programme receives only a derived
square image for the current published release—never a Storage path or object
generation.

Draft writes are admin-only callables with an optimistic `revision`; a stale tab
must reload instead of overwriting another organiser. The server rejects room,
speaker and duplicate-proposal overlaps. Accepted talks may be planned
tentatively, but they stay private until they are confirmed and the organiser
shares a new preview. Every flexible language in that preview must be resolved.
When a placed proposal returns to review or otherwise becomes ineligible, its
private placement keeps enough proposal metadata to identify and remove it; it
cannot be moved or enter the next shared release.

Disclosure is explicit and versioned. **Share preview** creates an immutable
`scheduleReleases/{releaseId}` snapshot and moves
`cfps/{cfpId}.sharedScheduleId`. Confirmed speakers receive only their own
placement; active event reviewers see the confirmed agenda read-only. Both use a
role-filtered callable and can never list the private release or draft directly.
**Publish** then promotes that exact, still-current release by moving
`publishedScheduleId`. Anonymous readers can read only that public pointer. If
the draft or a scheduled proposal changes, it must be shared again before it can
be published. The release freezes proposal taxonomy labels and public-safe
speaker details, so the public agenda can show category, language and speakers
while each detail page retains format, level, abstract or description, and full
speaker introductions.

The CFP submission window is a separate control. A rolling event may publish a
programme while submissions remain open, but the publish review calls that out
before the public pointer moves. While the event is active, emergency unpublish
clears only the public pointer and leaves the immutable release and committee
preview intact. Archiving freezes the current public programme too; an owner
must reactivate the event before taking it offline. CSV export remains available
from the private planner.

Assignment, move and cancellation notices enter `emailLog` as `held` when a
preview is shared, so an admin reviews and releases them from Email like
decision messages. Editing the draft sends nothing, and promoting an unchanged
preview to public does not duplicate them. If a confirmed talk later becomes
declined, withdrawn or otherwise non-confirmed, a trigger marks both shared and
public copies cancelled immediately and flags the draft for attention; it does
not silently remove a speaker's or attendee's saved schedule item.

Sharing also queues one immediate, generic schedule-preview notice for every
other active event owner, admin and reviewer. It contains no room, time or
speaker data and points back to the authenticated committee preview. Pending,
revoked, disabled, unverified and platform-only identities are excluded, and a
newer shared release supersedes an unsent older notice.

## Email

Resend, called over its REST API from a Firestore trigger. Every message is a
row in `emailLog` with a deterministic id derived from its kind, subject and,
when needed, immutable schedule release or staff recipient. Queueing the same
logical message twice finds the same document, so a decision reversed and
reinstated or a retried trigger does not mail anyone twice. The trigger claims a
row by moving it `queued → sending` in a transaction, which is what makes
at-least-once trigger delivery safe.

Decisions and schedule changes are queued **`held`**. They sit there until an
admin releases the batch from `/admin`, so sensitive results and programme
changes are reviewed before delivery. Receipts do not wait.

Committee operations do not depend on somebody refreshing a dashboard at the
right moment. Submitting a proposal queues one immediate, generic review notice
per active event owner/admin/reviewer and recipient, excluding the proposal's
current and former speakers. Sharing a preview does the same for the committee, excluding the acting
organiser. An explicit locale on the event member or pending grant is honoured;
without one, the single committee notice contains both English and French.
These messages deliberately omit proposal, speaker and schedule
details; access is checked again immediately before send, and their deterministic
per-recipient ids prevent trigger retries from becoming duplicate mail.

With no API key configured the trigger renders the message, logs it, and records
`dry_run` instead of `sent` — the pipeline runs end to end locally and in tests
without sending anything, and the log never claims a send that did not happen.

**Set the platform default up from the account menu's Platform email settings
link**, then inspect or override it for one CFP from `/admin`, under Email. Each screen says which scope supplies the
effective setup and whether it is ready, because the failure this replaces was
silent — the pipeline queued perfectly and sent nothing, and no screen said why.

1. **Shared API key.** A platform owner or administrator pastes the platform's
   Resend key. Event administrators can see whether it is ready but cannot
   replace it. Give it **Full access** when you create it:
   the next step manages domains, and Resend's sending-only keys cannot. The key
   is checked against Resend before being saved, so a typo fails here rather than
   on the night the decisions go out. It goes to **Secret Manager, never to
   Firestore** — Firestore has no version history, no access audit, and a copy of
   every document lands in every export. The page shows the last four characters
   and nothing more.
2. **Default sending domain.** Add it on the platform page, which lists the exact
   DNS records Resend wants and re-checks them on a button. Those records are
   generated per domain and exist only in Resend's dashboard. This is the long
   pole — DNS propagation plus Resend's own check. The platform binding is not
   an event binding, even when both use the same Resend account.
3. **Default sender and reply-to.** New and unconfigured CFPs inherit these. An
   event may give that sender an event-specific display name; the platform-owned
   address does not change.
   An event administrator may stage a separate domain and sender from `/admin`
   without interrupting the inherited setup. Explicitly activating that event
   override makes it exclusive: an incomplete or stale override does not silently
   send through the platform identity instead. Event deletion never deletes the
   platform default or its binding. A missing event reply-to inherits the
   platform value; deliberately saving an empty reply-to suppresses it.
4. **Preview and wording**, then send one to yourself. The preview renders
   through the same pure `renderEmail` the sender uses, so it is the message
   rather than an impression of it — and it renders from the editor's text, so
   an unsaved edit is visible before it can reach anyone. Test sends deliberately
   skip `emailLog`: that collection is the record of what applicants were told,
   and a test is not that.

Every message can be rewritten per language from that last step. Event wording
overlays the built-in copy one template and language at a time. Placeholders are `{speakerName}`, `{title}`,
`{proposalUrl}`, `{reviewUrl}`, `{scheduleUrl}`, `{scheduleDate}`,
`{scheduleTime}`, `{scheduleRoom}`, `{event}` and `{visa}` — the last is
conditional, so a paragraph containing only `{visa}` disappears for speakers
who do not need one. A blank
subject or body, or a mistyped placeholder that would print braces to an
applicant, is refused in the browser *and* in the callable. Restoring an event
override reveals the built-in copy.

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
- **Platform administration cannot be self-served.** `platformMembers` and
  `platformRoleGrants` are closed to every client. `createOrg` enforces the
  per-owner organization limit, and `createCfp` rechecks the organization role
  and active-event quota in its creation transaction. Owners may delegate
  platform admins. Owner changes stay with the guarded
  bootstrap script, and nobody may remove their own platform access.
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
  our verified domain, so the deny covers writes as well as reads. Draft
  co-speaker invitation rows are deliberately excluded even from that callable;
  only the lead and invited address may see the draft roster flow.
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
  and no view uses `onSnapshot`. Public sign-in mail also consumes atomic
  per-address, best-effort per-network and platform-wide hourly allowances before
  Auth mints its bearer link. The shared platform circuit breaker is the hard
  ceiling and deliberately fails closed under attack.

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

- **`importSessionizeProfile` has no per-user rate limit.** `maxInstances` caps
  the bill and the outbound fan-out at Sessionize, but one authenticated user
  can still call it in a loop.
- **No domain is verified with Resend yet**, so the pipeline is in dry-run. Every
  other part of it is built and tested; see [Email](#email) for the four steps.
- **No confirmation reminder or waitlist-promotion job.** An acceptance sets no
  `confirmDeadline` and nothing chases a speaker who does not confirm. §8 lists
  both; both want a scheduled function, which is the next thing to build.
- **Definitive failed sends still need a human.** Trigger retries and a
  ten-minute claim lease recover interrupted delivery automatically; the admin
  page can retry a provider refusal, but nothing proactively alerts the team.

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
