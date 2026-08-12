# Code and UX inspection — 2026-08-11

## Resolution ledger

Updated against the final QA working tree after the inspection baseline. This table is the source
of truth for follow-up: `verified` means the change passed evidence appropriate to its risk —
focused regressions and exact-tree checks for behavioural changes, or direct configuration and
documentation validation for rollout-only findings. Behavioural findings are never closed from
source inspection alone.

| ID | Status | Disposition | Verification evidence |
|---|---|---|---|
| H1 | verified | sign-in delivery now reports provider/setup failure truthfully | auth-link unit tests; sign-in-link browser suite |
| H2 | verified | seeded owners must already be verified and enabled; no unclaimable pending owner grant is created | platform bootstrap and event bootstrap browser suites |
| H3 | verified | admins can remove a silent co-speaker blocking an accepted session | co-speaker lifecycle and UI browser suites |
| H4 | verified | destructive resets no longer offer impossible or stale Undo actions | proposal-decision unit tests; roles browser suite |
| H5 | verified | select-option editing preserves the initiating keystroke | field-row unit tests; form editor browser coverage |
| H6 | verified | locale changes preserve unsaved email wording | email browser suite |
| M1 | verified | role changes enforce owner/last-admin and duplicate-identity guards | roles and platform bootstrap browser suites |
| M2 | verified | reviewers use a server-whitelisted projection with no private confirmation or logistics data | reviewer-projection unit tests; 149 rules tests; review backend/deck browser suites |
| M3 | verified | talk switching confirms before discarding unsaved confirmation answers | confirmation browser suite |
| M4 | verified | same-origin navigation offers an explicit discard path for unsaved confirmation answers | confirmation and navigation browser suites |
| M5 | verified | starting another talk keeps the talk picker and prior proposal reachable | draft browser suite |
| M6 | verified | only the exact active-talk-cap reason receives actionable cap copy | error-mapper unit tests; roles browser suite |
| M7 | verified | manual confirmation saves announce success and focus/announce failures | confirmation browser suite |
| M8 | verified | paused drafts explain that editing can resume later without calling the window closed | window browser suite |
| M9 | verified | removal clears the speaker's stale confirmation before re-invitation | co-speaker lifecycle browser suite |
| M10 | verified | invitation conflicts, expiry and unavailable state use invitation-specific copy and refresh | error-mapper unit tests; co-speaker browser suites |
| M11 | verified | confirmed speakers see whether another speaker is pending or declined | co-speaker UI browser suite |
| M12 | verified | numeric shortcuts cannot clear an acknowledged conflict | review deck browser suite |
| M13 | verified | role errors specialize only the exact last-admin reason | error-mapper unit tests; roles browser suite |
| M14 | verified | archived overview remains an inspection surface without impossible setup actions | archived-admin browser suite |
| M15 | verified | calendar exports include the required timezone definition | calendar unit tests; schedule browser suite |
| M16 | verified | domain binding and tenancy failures use stable, specific admin copy | email/domain tests; platform browser suite |
| M17 | verified | delivered and superseded email outcomes are labelled separately | email browser suite |
| M18 | verified | required checkbox questions expose the same requirement contract as other fields | field accessibility unit tests; submission browser suite |
| M19 | verified | field errors are associated through both description and error semantics | field accessibility unit tests; form browser suites |
| M20 | verified | photo inputs leave the tab order; visible controls own focus and error associations | profile/headshot/custom-photo browser suites |
| M21 | verified | duration text meets contrast requirements in both themes | style unit tests; schedule browser suite |
| L1 | verified | stale ownership-transfer comments were corrected; transfer remains separate product work | source audit; lint and diff check |
| L2 | verified | proposal document IDs are validated before path construction | schedule unit and browser suites |
| L3 | verified | resend rejects slash-bearing log IDs | email browser suite |
| L4 | verified | plain reviewers cannot read raw member email records | 149 rules tests |
| L5 | verified | proposal creation rejects planted confirmation answers | 149 rules tests |
| L6 | verified | removed four unused composites; retained required collection-group overrides | index parse; 149 rules tests; diff check |
| L7 | verified | profile updates follow the verified account identity rather than a stale stored address | profile browser suite; 149 rules tests |
| L8 | verified | schedule-load failures are distinct from an unscheduled session | schedule browser suite |
| L9 | verified | draft co-speakers receive participant-specific next steps | co-speaker UI browser suite |
| L10 | verified | review-workspace failures use review-specific error copy | error-mapper unit tests; review deck browser suite |
| L11 | verified | lifecycle status sets are centralized and stale comments corrected | enum/unit coverage; full browser suite |
| L12 | verified | platform denial offers an accessible access recheck | platform-access browser suite |
| L13 | verified | the bootstrap script can safely revoke a pending owner grant | bootstrap tests; script static checks |
| L14 | verified | create-event address errors are associated with and focus the address field | platform browser suite |
| L15 | verified | missing programme entries use session vocabulary | schedule browser suite |
| L16 | verified | server-authored email outcomes are mapped to localized copy | email browser suite |
| L17 | verified | public server routes use the branded error boundary | error-boundary unit test; production build |
| L18 | verified | bundle guard covers both emulator-auth call sites | bundle guard; production bundle check |
| L19 | verified | custom-photo loading is stable across locale changes | custom-photo browser suite |
| L20 | verified | route changes focus a landmark named for the exact form or programme session | navigation and schedule UX browser suites |
| L21 | verified | email error text meets contrast requirements | style unit tests; email responsive browser coverage |
| L22 | verified | every social-link row has distinct accessible control names | profile browser suite |
| L23 | verified | DNS priority text is localized | email browser suite |
| L24 | verified | release/version terminology is aligned between languages | bilingual email/schedule browser coverage |
| L25 | verified | score histogram exposes a localized, meaningful accessible name | chart accessibility unit tests |

Final exact-tree gate: `npm run lint`, `npm run typecheck`, Functions build, production build,
bundle guard, 564 unit tests, 149 Firestore/Storage rules tests, 442 Playwright browser tests,
and `git diff --check` all pass. Browser tests ran against rebuilt Functions after a clean
emulator restart. The pre-QA Auth, Firestore and Storage export was restored byte-for-byte
after the destructive suite.

## Verification follow-up findings

The implementation audit found adjacent issues while verifying the original report, and
stabilising the suites afterwards found two more. They are tracked separately so closing the
original IDs does not erase that evidence.

| ID | Status | Finding and disposition | Verification evidence |
|---|---|---|---|
| V1 | verified | Reviewer `submittedAt` is projected as epoch milliseconds instead of an unserializable Firestore timestamp shape. | reviewer-projection unit tests; review backend browser suite |
| V2 | verified | Late acceptance of a legacy solo proposal migrates private root confirmation/photo data before a co-speaker gains proposal access. | co-speaker lifecycle browser suite; 149 rules tests |
| V3 | verified | Visible profile, headshot and custom-photo buttons retain persistent error associations after hidden inputs leave the tab order. | profile/headshot/custom-photo browser suites |
| V4 | verified | Talk-cap, last-admin and invitation-expiry errors use stable server reasons instead of broad status-code guesses. | error-mapper unit tests; roles/co-speaker browser suites |
| V5 | verified | A recreated Auth identity cannot use a stale same-email admin row to bypass the last-admin guard. | roles browser suite |
| V6 | verified | A destructive decision reset invalidates only that proposal's prior Undo history. | proposal-decision unit tests; roles browser suite |
| V7 | verified | A personally confirmed speaker is told when another active speaker declined, not merely that the session is waiting. | co-speaker UI browser suite |
| V8 | verified | The reviewer-safe projection retains only valid current organiser-defined submission answers, in form order and localized. | reviewer-projection unit tests; review backend/deck browser suites |
| V9 | verified | Agenda-to-session, session-to-session and direct speaker placement navigation wait for the exact session label before moving focus. | schedule UX and schedule browser suites |
| V10 | verified | Cross-layer authorization changes have an explicit Functions → app → rules/indexes deployment sequence, avoiding an old-client/new-rules compatibility gap. | package scripts and deployment documentation review |
| V11 | verified | The schedule route is server-rendered but was imported lazily, so React had no chunk to hydrate with and replaced the published agenda with the Suspense fallback — a blink of "Loading…" over programme content the reader could already see. | schedule metadata browser suite; production build and bundle check |
| V12 | open | `shareSchedulePreview` refuses with `schedule-cancellation-processing` while an asynchronous cancellation pass finishes. The copy asks the organiser to wait and share again, but no surface reports when the refusal clears; the flag it turns on is never read by the client. | refusal reproduced against the emulated stack; co-speaker lifecycle browser suite waits on that flag |


Inspection baseline: commit `cc448d4`, then a clean worktree identical to `origin/main`. Ten inspectors swept the
repository; every finding below survived an adversarial verification pass that re-read the
cited lines, checked `tests/` for coverage that would make the behaviour intentional, and
checked `AGENTS.md` / `SPEC.md` / the persona handbook for a decision that would justify it.
Severities and scope reflect that pass, not the original submissions.

## Summary

The platform is in good structural health: the authorization model holds, the Firestore rules
are tight in the places that matter most, and the test suite is dense enough that most of what
follows had to be found by reading rather than by breaking. Nothing here is critical — no data
loss without an explicit user action, no cross-tenant leak, no unrecoverable dead end. The
first theme is error-message mapping: `friendlyError`, `adminError` and `resendError` are each
applied far outside the surface they were written for, so a correct server refusal reaches the
user as "the call for proposals is not open", "that is the only admin left", or "Resend would
not accept that key" — three sentences that are false and unactionable in the flows that
actually produce them (M10, M13, M16, M6, L10). The second theme is work that vanishes without
being reported: a sign-in link that was never sent is announced as sent (H1), a locale switch
silently replaces an unsaved email template (H6), the talk picker drops typed confirmation
answers (M3), and a controlled textarea eats the keystroke that would start a second select
option (H5). The third theme is lifecycle escape hatches: the co-speaker, ownership and
decision lifecycles are carefully built for the paths people take deliberately, but each has
one state reached by silence or accident with no in-product exit — a co-speaker who simply
never answers strands an accepted talk forever (H3), a pending `owner` grant can never be
claimed (H2), and Undo after a decision on a confirmed proposal always fails (H4). The
accessibility findings cluster tightly around the form primitives in `src/components/fields.tsx`
and are cheap to fix in one pass. Documentation drift is the quiet cost throughout: three
comments describe behaviour the code does not have, and one of them names a callable that does
not exist.

## Findings by severity

No critical findings.

| ID | Severity | Area | Persona | Title | File |
|---|---|---|---|---|---|
| H1 | high | email | `ANON-PUBLIC` | A sign-in link that was never delivered is reported to the speaker as sent | `functions/src/index.ts:5021` |
| H2 | high | backend-authz | `EVENT-OWNER` | A pending `owner` grant can never be claimed | `functions/src/roles.ts:298` |
| H3 | high | cospeaker-flow | `EVENT-ADMIN` | A silent draft-phase co-speaker strands an accepted talk with no organiser recovery | `functions/src/coSpeakers.ts:1311` |
| H4 | high | reviewer-admin-flow | `EVENT-ADMIN` | Undo of a decision taken on a confirmed or declined proposal always fails | `src/screens/admin/Proposals.tsx:942` |
| H5 | high | frontend-correctness | `EVENT-ADMIN` | Select-question options textarea strips the keystroke you just typed | `src/components/FieldRows.tsx:268` |
| H6 | high | frontend-correctness | `EVENT-ADMIN` | Switching interface language silently discards an unsaved email template draft | `src/components/EmailPreview.tsx:96` |
| M1 | medium | backend-authz | `EVENT-ADMIN` | `grant()` skips the owner and last-admin refusals for an unresolvable address | `functions/src/roles.ts:140` |
| M2 | medium | security-rules | `SPK-CONFIRMED` | Every reviewer can read a solo speaker's private confirmation answers | `firestore.rules:220` |
| M3 | medium | speaker-flow | `SPK-ACCEPTED` | Switching talks in the picker silently throws away unsaved confirmation answers | `src/screens/SubmitPage.tsx:1524` |
| M4 | medium | speaker-flow | `SPK-ACCEPTED` | An accepted speaker who starts answering the confirmation form cannot navigate away | `src/screens/SubmitPage.tsx:1220` |
| M5 | medium | speaker-flow | `SPK-DRAFT` | "+ Another talk" hides the whole talk picker when there is exactly one existing talk | `src/screens/SubmitPage.tsx:164` |
| M6 | medium | speaker-flow | `SPK-DRAFT` | Hitting the talk cap on submit shows "Something went wrong. Please try again." | `src/lib/errors.ts:49` |
| M7 | medium | speaker-flow | `SPK-CONFIRMED` | "Save details" gives no visible confirmation, and its error lands off-screen | `src/screens/SubmitPage.tsx:596` |
| M8 | medium | speaker-flow | `SPK-DRAFT` | A paused call tells a draft owner the window is closed and invites deletion | `src/screens/SubmitPage.tsx:1975` |
| M9 | medium | cospeaker-flow | `SPK-DECLINED` | `removeCoSpeaker` orphans `speakerConfirmations`; a re-invited speaker rejoins "Declined" | `functions/src/coSpeakers.ts:1390` |
| M10 | medium | cospeaker-flow | `REVIEWER` | Every invitation `failed-precondition` renders as "The call for proposals is not open right now." | `src/components/CoSpeakerInvitation.tsx:240` |
| M11 | medium | cospeaker-flow | `SPK-CONFIRMED` | A speaker blocked on a co-speaker is told to "Wait for the working schedule" | `src/screens/SubmitPage.tsx:1984` |
| M12 | medium | reviewer-admin-flow | `REVIEWER` | Pressing 1-4 clears a declared conflict and saves a counted score | `src/screens/ReviewPage.tsx:289` |
| M13 | medium | reviewer-admin-flow | `EVENT-ADMIN` | `adminError` maps every `failed-precondition` to "That is the only admin left" | `src/lib/errors.ts:61` |
| M14 | medium | reviewer-admin-flow | `EVENT-OWNER` | Overview tells an archived event its setup is incomplete and links to a disabled control | `src/screens/admin/Overview.tsx:223` |
| M15 | medium | schedule-flow | `SPK-CONFIRMED` | Exported `.ics` declares `TZID` but never emits a `VTIMEZONE` component | `shared/calendar.ts:41` |
| M16 | medium | email | `EVENT-ADMIN` | `emailDomain`'s tenancy and binding refusals reach the admin as "Resend would not accept that key" | `src/lib/errors.ts:162` |
| M17 | medium | email | `EVENT-ADMIN` | Successfully delivered mail is labelled "Retained — superseded" | `functions/src/index.ts:4724` |
| M18 | medium | ux-a11y-i18n | `SPK-DRAFT` | Checkbox questions cannot express "required" | `src/components/fields.tsx:319` |
| M19 | medium | ux-a11y-i18n | `SPK-DRAFT` | Field errors are bound only through `aria-errormessage` | `src/components/fields.tsx:124` |
| M20 | medium | ux-a11y-i18n | `SPK-ACCEPTED` | Photo file inputs are invisible but focusable, and their error is unassociated | `src/components/HeadshotField.tsx:173` |
| M21 | medium | ux-a11y-i18n | `EVENT-ADMIN` | The schedule duration readout fails WCAG AA contrast in both themes | `src/styles.css:388` |
| L1 | low | backend-authz | `EVENT-OWNER` | `roles.ts` documents a `transferCfp` path that does not exist | `functions/src/roles.ts:42` |
| L2 | low | backend-authz | `EVENT-ADMIN` | A schedule entry's `proposalId` is interpolated into a document path unvalidated | `functions/src/index.ts:6073` |
| L3 | low | backend-authz | `EVENT-ADMIN` | `emailQueue` action `resend` accepts a `logId` containing `/` | `functions/src/index.ts:4384` |
| L4 | low | security-rules | `REVIEWER` | A plain reviewer can read any committee member's document, email included | `firestore.rules:126` |
| L5 | low | security-rules | `SPK-DRAFT` | `confirmAnswers` is blocked on update but not on create | `firestore.rules:238` |
| L6 | low | security-rules | n/a | All four composite indexes serve no query in the codebase | `firestore.indexes.json:4` |
| L7 | low | security-rules | `SPK-DRAFT` | Profile saves are pinned to the stored email, locking out an auth email change | `firestore.rules:457` |
| L8 | low | speaker-flow | `SPK-CONFIRMED` | A failed published-schedule load says the session is not scheduled yet | `src/screens/SubmitPage.tsx:846` |
| L9 | low | cospeaker-flow | `SPK-DRAFT` | A co-speaker on a draft is told "Finish and submit your proposal" | `src/screens/SubmitPage.tsx:1972` |
| L10 | low | reviewer-admin-flow | `REVIEWER` | Review-workspace failures show applicant copy | `src/screens/ReviewPage.tsx:265` |
| L11 | low | reviewer-admin-flow | n/a | Admin decision vocabulary and review-queue statuses are duplicated as literals | `src/screens/admin/Proposals.tsx:52` |
| L12 | low | platform-flow | `PLATFORM-ADMIN-TARGET` | `/platform` denial has no "check access again" recovery, unlike `/new` | `src/App.tsx:597` |
| L13 | low | platform-flow | `PLATFORM-OWNER` | `set-platform-admin.mjs --remove` refuses to revoke a pending owner grant | `scripts/set-platform-admin.mjs:111` |
| L14 | low | platform-flow | `PLATFORM-CREATOR` | Address errors on the create form are not associated with the address field | `src/screens/NewCfpPage.tsx:249` |
| L15 | low | schedule-flow | `ANON-PUBLIC` | Missing public session deep link says "We could not find that proposal." | `src/screens/SchedulePage.tsx:404` |
| L16 | low | email | `EVENT-ADMIN` | Server-authored English failure prose renders verbatim in the French log | `src/screens/admin/Email.tsx:761` |
| L17 | low | frontend-correctness | `ANON-PUBLIC` | The server-rendered public routes have no error boundary | `src/app/c/[cfpId]/page.tsx:76` |
| L18 | low | frontend-correctness | n/a | `check-bundle` asserts only one of the two guarded `devAuth` call sites | `scripts/check-bundle.mjs:48` |
| L19 | low | frontend-correctness | `EVENT-ADMIN` | The programme photo loader keys its effect on a translated string | `src/components/CustomScheduleSpeakerPhoto.tsx:83` |
| L20 | low | ux-a11y-i18n | `ANON-PUBLIC` | Route changes produce no announcement | `src/App.tsx:436` |
| L21 | low | ux-a11y-i18n | `EVENT-ADMIN` | `--g-red` as text on its own tint fails WCAG AA across the email chrome | `src/styles.css:5954` |
| L22 | low | ux-a11y-i18n | `SPK-DRAFT` | Every social-link row exposes the same three accessible names | `src/components/SocialsInput.tsx:63` |
| L23 | low | ux-a11y-i18n | `EVENT-ADMIN` | Hardcoded English "(priority N)" in the DNS records table | `src/components/EmailSetup.tsx:277` |
| L24 | low | ux-a11y-i18n | `EVENT-ADMIN` | English copy says "release" where the French says "version" | `src/i18n/en.ts:1809` |
| L25 | low | ux-a11y-i18n | `EVENT-ADMIN` | Score histogram's accessible name is an untranslated string of bare numbers | `src/components/charts.tsx:63` |

Counts: 0 critical, 6 high, 21 medium, 25 low.

## User-flow validation by persona

### Anonymous and unauthorized (`ANON-PUBLIC`, `AUTH-UNAUTHORIZED`)

The public surface is the most finished part of the product. Listing visibility, the
private-but-linkable distinction, window-state copy and the three-stage schedule isolation are
all enforced and tested, and the programme's own vocabulary ("session", "programme") is
consistent. Denial states carry a working next action.

Where it breaks: the sign-in path is the one flow that can fail while telling the visitor it
succeeded. On any CFP whose admin has not yet finished email setup — which is every CFP between
creation and `ADM-06` — choosing "Email me a link" burns one of five hourly attempts, sends
nothing, writes no `emailLog` row an admin could later inspect, and shows "a sign-in link is on
its way. It works once, and for about an hour." A speaker with no Google account has no other
route in and no way to learn why (H1). Two smaller gaps sit on the programme: a session deep
link from an older release or an older `.ics` download reports "We could not find that
proposal", using submission-pipeline vocabulary on the one screen written for attendees (L15),
and a route change announces nothing beyond the unnamed `main` landmark, so every destination
sounds identical to a screen-reader user (L20). If the server-side Firestore read fails, the
three public routes have no error boundary and serve Next's unbranded default page rather than
the app's own panel (L17) — infrastructure-triggered only, but it is the one uncovered failure
path in an app that otherwise handles every one deliberately.

### Speaker — draft, submitted, withdrawn (`SPK-DRAFT`, `SPK-SUBMITTED`, `SPK-WITHDRAWN`)

Autosave, tenant separation, lifecycle locks, the withdrawal path and the active-talk cap all
behave correctly and are well covered. The global profile genuinely is reused, and the progress
rail does point at the right sections.

Where it breaks: immediately after submitting a first proposal, pressing "+ Another talk"
unmounts the entire "Your talks" bar, so the speaker sees a blank form, no Submitted banner and
no way back to the talk they just sent — it reads as though the submission was wiped. It
self-heals after one autosave, but only if the speaker types something (M5). If they instead
have three submitted talks and a fourth complete draft, pressing Submit produces "Something
went wrong. Please try again." — a retry invitation for a condition that will never succeed,
and for the co-speaker variant of the cap there is no hint anywhere on the page (M6). During a
pause, the draft owner is told the window is closed and nudged toward a Delete draft button
that still works, while the deadline printed two elements above is still in the future (M8).
On the form itself, a question the organiser marked "must be answered" shows no Required chip
and no `aria-required` when its type is checkbox, unlike every neighbouring question (M18), and
validation messages are bound only through `aria-errormessage`, which the handbook's declared
release-pass screen reader does not map — focus lands on the right field and says nothing about
what is wrong (M19). The social-links editor repeats "Platform / Handle or URL / Remove" once
per row with no way to tell which Remove deletes which link (L22). Two data-shape gaps sit
underneath: `confirmAnswers` can be planted at create time even though it is blocked on every
subsequent update (L5), and a speaker whose OAuth provider changes their primary address is
locked out of every `speakers/{uid}` write — taking draft autosave down with it — because the
update rule compares against the stored email rather than the token (L7).

### Speaker — accepted, confirmed, declined (`SPK-ACCEPTED`, `SPK-CONFIRMED`, `SPK-DECLINED`)

The decision response itself is solid: acceptance copy does not claim a published time, decline
is guarded and reversible, required answers are enforced server-side, and the own-placement
card correctly refuses to resurrect an obsolete public time when the shared preview moves.

Where it breaks: the confirmation-answer buffer is the weakest thing in the product. It cannot
be autosaved before the response is submitted (`saveConfirmationAnswers` refuses while the
speaker is not yet `confirmed`), and two paths out of that state behave badly. Clicking another
talk's tab discards everything typed, with no warning, toast or dialog (M3). Clicking any
header link, breadcrumb, account-menu item or browser Back cancels the navigation and shows
"Changes not saved yet" — forever, since the answers can never be saved from that state. The
only escape is the Back button inside the questions block, which discards the typing and which
the toast never mentions (M4). Once confirmed, pressing "Save details" produces no toast, no
status text and no announcement; if the save fails, the only signal is a red line several
screens below the button (M7). If the confirmed speaker's co-speaker has not answered, the page
says "Confirmed" and "Wait for the working schedule" even though the placement can never appear
until the teammate acts — the roster further down says so, but the primary next-step rail
contradicts it (M11). A failed read of the published release is indistinguishable from having
no placement, so the speaker is told to wait for a preview that already exists (L8). Their
private confirmation answers — dietary needs, accessibility, travel — sit on the reviewer-readable
proposal root for every solo proposal, whereas the identical data on a two-speaker proposal is
correctly restricted (M2). And the calendar file they download declares an IANA `TZID` with no
`VTIMEZONE` component, so clients without their own zone database place the session at the
wrong wall-clock time (M15). For `SPK-DECLINED`, being removed and later re-invited leaves the
stale "declined" confirmation behind, so the moment they rejoin they are shown "You turned down
the slot" (M9).

### Co-speaker (`SPK-DRAFT` as guest, `REVIEWER` as invitee)

The co-speaker lifecycle is the most intricate code in the repository and it mostly holds:
per-speaker confirmations, phase-aware invitations, the reviewer-conflict refusal and the
leave/rejoin path are all real and tested.

Where it breaks: the one uncovered case is silence. A co-speaker who joined during the draft,
was submitted, was accepted, and then simply never responds cannot be removed by the lead or by
an event admin — the escape hatch exists but is gated on `joinedPhase === 'postAcceptance'`. The
proposal can never reach `confirmed`, so it can never be shared or published, and the only
workarounds destroy every other speaker's confirmation or kill the talk (H3). When an invitation
is refused for any reason, the invitee reads "The call for proposals is not open right now." —
false for a post-acceptance invitation, and for the reviewer-conflict case unrecoverable, since
the invitation stays `pending` and every retry repeats it (M10). A freshly joined draft
co-speaker is told to "Finish and submit your proposal" above a form with every field disabled
and no Submit button; the correct instruction exists, but further down the page (L9). Removal
leaves an orphaned confirmation document that re-attaches on rejoin (M9), and a lead who has
confirmed while their guest has not is pointed at the organisers rather than at their
co-presenter (M11).

### Reviewer (`REVIEWER`, `REVIEWER-PENDING`, `REVIEWER-REVOKED`)

Role claim, queue eligibility, own-proposal exclusion, keyboard scoring, note preservation
across navigation and the read-only committee preview are all correct and well protected.

Where it breaks: the keyboard and the mouse disagree about conflicts. The four score buttons are
disabled while a conflict is declared, but pressing 1-4 goes straight through
`scoreAndAdvance`, which rewrites the review with `conflictOfInterest: false` and advances the
deck — the reviewer's declared conflict becomes a counted score in the talk's aggregate and in
their own calibration, with the card already gone from view (M12). When a save fails because
the proposal left the review round or membership was revoked, the reviewer reads applicant copy
about their own proposal and the submission window, with a Retry button (L10) — the banner does
clear on reload, so this is wording rather than a trap. Separately, any role-holder can fetch
any other member document by uid, email included, which makes the `list` denial and the
admin-only `roleGrants` rule cosmetic for anyone who already knows a uid (L4) — and reviewer
uids are visible once scores open. If a reviewer is invited to co-present a proposal they
reviewed, the refusal is correct but the message is not (M10).

### Event admin and owner (`EVENT-ADMIN`, `EVENT-OWNER`)

The admin workspace carries the most surface area and the most careful work: staged
schedule releases, the held-email queue, coverage analysis, form editors, exclusive domain
binding, and archive/delete with real confirmation steps. Most of what follows is the cost of
that breadth rather than of carelessness.

Where it breaks, in order of what an organiser will hit first: a select question's Options
textarea cannot be typed into. Because it round-trips through a trim-and-filter parser on every
keystroke, pressing Enter to start a second option is undone on the same tick, and a trailing
space is eaten — "Vegetarian meal" comes out "Vegetarianmeal". Pasting works, which is why it
has gone unnoticed (H5). Switching the interface language while editing an email template
silently replaces the unsaved subject and body with the stored template for the other language
and disarms the unsaved-work navigation guard, even though every other route into that state
confirms first (H6). In the decisions table, one change of a native select on a `confirmed` or
`declined` row resets that speaker's confirmation answers, photo and profile requests, then
offers an Undo that always fails with "Check the email address and the dates." (H4). Setting up
a new event for someone else via `seed-cfp.mjs --owner` writes a grant the claim path refuses,
so the incoming owner meets a permanent "That service is unavailable right now" panel (H2).

Beyond those: `grantRole` skips its own owner and last-admin refusals when the target address no
longer resolves to a usable account, returning success and mailing a committee invitation for a
role that will never be granted (M1). A speaker withdrawing while the proposals table is open
produces "That is the only admin left — give someone else the role first." (M13), and the same
mapper answers an owner's "Bring it back" after a partial delete. A domain-name collision in the
shared Resend account is reported as a bad API key, to an admin who in many cases cannot even
see the key field (M16). In the delivery history, every committee notification flips to
"Retained — superseded" the moment its proposal is decided, so mail that did go out reads as if
it never did — and it does so under the "Sent" filter (M17). Archiving an event flips the
submission-window checklist item back to todo, drops readiness to 4/5, forces the setup panel
open and offers an "Edit window" button that lands on disabled date fields, while the lifecycle
card beside it correctly reads "Close out the event" (M14). The schedule resize readout — the
only visible statement of the duration being dragged — is white on `--g-blue` at 12px, 3.56:1 in
both themes (M21), and the red email-attention chrome fails AA on three counts (L21). Four
self-authored English failure sentences ride the untranslated provider-error channel into the
French log (L16), the DNS table hardcodes "(priority N)" (L23), the English schedule copy calls
a version a "release" where the French correctly says "version" (L24), and the score histogram's
whole accessible name is "1: 4, 2: 9, 3: 6, 4: 2" (L25). Two callables validate ids less
carefully than their siblings in the same file (L2, L3), the programme photo loader re-fetches
every private image on a language switch (L19), and the status vocabularies that make H4
possible are duplicated as literals in two files with nothing linking them (L11). For an owner
specifically: `roles.ts` promises a `transferCfp` that does not exist, so a lost owning account
leaves an event nobody in the product can archive or delete (L1).

### Platform creator, admin, owner (`PLATFORM-CREATOR`, `PLATFORM-ADMIN-TARGET`, `PLATFORM-OWNER`)

The separation the product cares about most — platform roles grant no event data access — holds
everywhere, and the grant/claim/revoke and last-owner protections are properly transactional
and tested.

Where it breaks: nothing functional. `/platform`'s denial panel offers only "All calls", while
the sibling `/new` gate one branch away explains platform access and offers a working "Check
access again" — a newly granted admin sitting on `/platform` has no way to re-check without
navigating away (L12). On the create form, every fault including "That address is taken" renders
as one paragraph at the foot of the page with no association to the Address field, contradicting
the file's own header comment (L14). And during first-time bootstrap, `set-platform-admin.mjs
--remove` refuses to delete a mistyped pending owner grant because the last-owner guard counts
pending grants as owners while counting only active members as the survivors — recoverable by
completing the intended bootstrap, but the script does not say so (L13).

## Detail

Entries run H, then M, then L; within each severity they are grouped by area in the order
backend-authz, security-rules, speaker-flow, cospeaker-flow, reviewer-admin-flow, platform-flow,
schedule-flow, email, frontend-correctness, ux-a11y-i18n. No two findings were merged; there
were no exact duplicates across areas.

### H1 — A sign-in link that was never delivered is reported to the speaker as sent

**Area:** email
**Persona:** `ANON-PUBLIC`
**Severity:** high
**Location:** `functions/src/index.ts:5021`
**What:** `requestSignInLink` calls `sendViaResend` and treats only `outcome.status === 'failed'`
as an error (index.ts:5032-5034). `sendViaResend` returns `{ status: 'dry_run' }` — not
`failed` — whenever the API key or the sender is empty (`functions/src/email.ts:573-577`).
`loadSettings` deliberately blanks `from` when the CFP's sending domain is not bound
(`functions/src/email.ts:128-132`), and `readResendKey` swallows any Secret Manager error and
returns `''` (`functions/src/secrets.ts:54-59`). In both cases the callable returns `{ ok: true }`,
`src/App.tsx:936` sets `sent`, and the speaker reads `t.app.linkSent`. `takeLinkAllowance`
(index.ts:5019) has already spent one of five hourly attempts.
**Why it matters:** This is the state of every CFP between creation and the moment its admin
finishes email setup, while the public page and `/submit` are already live and inviting sign-in.
A speaker without a Google account has no other route in, is told to wait for mail that does not
exist, and burns their allowance retrying. Unlike every queued kind, a sign-in link writes no
`emailLog` row, so no admin can see it vanished. `sendTestEmail` proves the distinction is meant
to be surfaced — it returns `status: 'dry_run'` and the UI shows `t.admin.emailTestDryRun`
(`src/components/EmailPreview.tsx:340`). The callable's own docstring (index.ts:4897-4902) only
justifies giving the same answer for known and unknown addresses; refusing an event that cannot
send mail at all leaks nothing.
**Repro:** Seed a fresh CFP with no `config/email` domain binding. As `ANON-PUBLIC` open
`/c/{cfpId}/submit`, choose "Email me a link", enter an address, submit. Observed: "If {email}
can receive mail, a sign-in link is on its way" (`src/App.tsx:1020`) and the allowance
decrements; no mail is sent and no trace exists. Expected: a distinct message saying this event
cannot send mail yet, and the allowance left untouched.
**Suggested fix:** Treat `dry_run` as a non-delivery in `requestSignInLink` — throw
`failed-precondition` with a `reason` the sign-in panel can translate into "this event cannot
send mail yet, use Google sign-in or contact the organisers" — and take the link allowance only
once the provider has accepted the message.
**Existing test:** None found. `tests/e2e/signInLink.spec.ts` reads links straight out of the
Auth emulator via `readSignInLinks` and asserts nothing about the provider outcome.

### H2 — A pending `owner` grant can never be claimed

**Area:** backend-authz
**Persona:** `EVENT-OWNER`
**Severity:** high
**Location:** `functions/src/roles.ts:298`
**What:** `claim()` passes the pending grant's stored role through `normalizeRole`, and
`normalizeRole` refuses `owner` outright (roles.ts:45-51). That refusal is correct for
`grantRole`, but `claim()` is also the redemption path for the bootstrap grant. When
`scripts/seed-cfp.mjs` is run with `--owner <address>` and that address has no Auth account yet,
the script takes its else branch and writes `cfps/{id}/roleGrants/{email}` with `role: 'owner'`
(seed-cfp.mjs:150-164); its comment at :151-153 claims this is "the same shape `claimRole`
reads", which is false. The transaction throws before `tx.set(memberRef, ...)` at roles.ts:300,
so no membership is created and `ownerUids` is never written either (seed-cfp.mjs:130 is
conditional on `ownerUid`). `grantRole` cannot bootstrap out of it: `assertAdminInTransaction`
(roles.ts:76-87) needs an existing admin.
**Why it matters:** This is the script's own documented production use case
(seed-cfp.mjs:5-16). The incoming event owner signs in for the first time and meets a permanent
error panel with no explanation. Recovery exists but is entirely out of band: whoever ran the
script must re-run it after the owner has signed in once, at which point `getUserByEmail`
resolves and seed-cfp.mjs:139-149 writes `members/{uid}` directly. Nothing in the product says
so. `npm start` seeds without `--owner` (`scripts/dev.mjs:221-233`), so neither the dev stack nor
any test exercises this branch.
**Repro:** `GCLOUD_PROJECT=<p> node scripts/seed-cfp.mjs --id my-conf --name "My Conf" --opens
2027-01-01 --closes 2027-02-01 --owner chair@example.org`, where `chair@example.org` has never
signed in. The script prints "owner chair@example.org (pending first sign-in)". The owner signs
in and opens `/c/my-conf/admin/overview`; `useRole` (`src/lib/roles.ts:392-400`) finds no member
doc and calls `claimRole`, which throws `invalid-argument: Unknown role: owner` via
`asHttpsError` (index.ts:523-527). `src/App.tsx:717-727` renders "That service is unavailable
right now. Please try again shortly." with a Reload button. Every retry fails identically.
**Suggested fix:** Either give `claim()` a separate role normaliser that accepts `owner` for a
bootstrap grant (the grant is only writable by the Admin SDK, so this is not an escalation
path — `grantRole` still goes through `normalizeRole`), or delete the script's else branch and
have it refuse `--owner` for an address with no account. `AGENTS.md:27` already states "There is
no CFP-owner bootstrap", so removing the branch is the more defensible of the two. Either way add
an e2e case that seeds a pending `owner` grant and claims it.
**Existing test:** None found. `tests/e2e/roles.spec.ts` covers grant/revoke/claim for reviewer
and admin only; `tests/e2e/backend.ts:250-252` types `inviteRole` as accepting `'owner'` but no
spec passes it, and every owner test uses `seedMember` (backend.ts:246-268).

### H3 — A silent draft-phase co-speaker strands an accepted talk with no organiser recovery

**Area:** cospeaker-flow
**Persona:** `EVENT-ADMIN`
**Severity:** high
**Location:** `functions/src/coSpeakers.ts:1311`
**What:** After submission, `removeCoSpeaker` permits removal only when
`targetResponse === 'declined'` or `removableUnconfirmedLateSpeaker` holds, and that flag
requires `participant.joinedPhase === 'postAcceptance'` (coSpeakers.ts:1266-1280, 1306-1310). A
co-speaker who joined while the proposal was a draft and then never responds has
`targetResponse === undefined` and `joinedPhase === 'draft'`, so neither the lead (who passes
`canManage`) nor an event admin can remove them. `respondToDecision` cannot reach `confirmed`
because `everySpeakerConfirmed` needs every active uid
(`functions/src/speakerLifecycle.ts:84-92`), and admins deliberately cannot set a speaker
response (`setProposalStatus` accepts only under_review/accepted/waitlisted/rejected,
index.ts:4177-4182; `AGENTS.md:114-116`).
**Why it matters:** The most common real failure is silence, not an explicit decline — someone
changes jobs, loses the mail, or ghosts. The code already recognises "an unconfirmed speaker
blocking the session" as needing an escape hatch and grants it only to post-acceptance joiners.
Only `confirmed` proposals survive the shared and published projections
(`shared/schedule.ts:193-210`; index.ts:6555, 7388), so the session can be placed in the working
schedule but never shared or published. The alternative — bouncing accepted → under_review →
accepted — wipes every other speaker's confirmation, answers and frozen photo
(index.ts:4280-4295) without removing the silent speaker.
**Repro:** Lead invites a guest during draft; the guest accepts and completes setup; the lead
submits. Admin sets the proposal to `accepted`. Lead calls `respondToDecision` `confirm`; the
proposal stays `accepted`. Guest never returns. Admin or lead calls `removeCoSpeaker` for the
guest: `FAILED_PRECONDITION`, "After submission, only a declined co-speaker or an unconfirmed
late addition can be removed." The roster shows "Awaiting confirmation" with no action.
**Suggested fix:** Allow an event admin to remove any active co-speaker whose confirmation
response is absent once the proposal is `accepted` — mirroring `removableUnconfirmedLateSpeaker`
without the `joinedPhase === 'postAcceptance'` requirement — guarded by the same
schedule-baseline and cancellation bookkeeping already applied to late removals.
**Existing test:** None found. `AGENTS.md:108-109` documents the decline escape hatch only,
which is exactly what leaves silence uncovered.

### H4 — Undo of a decision taken on a confirmed or declined proposal always fails

**Area:** reviewer-admin-flow
**Persona:** `EVENT-ADMIN`
**Severity:** high
**Location:** `src/screens/admin/Proposals.tsx:942`
**What:** The status `<select>` in the decisions table renders all four `ADMIN_PROPOSAL_STATUSES`
for a row whose current status is `confirmed` or `declined` (Proposals.tsx:1414-1436, which adds
the current status only as a disabled option), so one change event fires `decide()` with no
confirmation prompt. `setProposalStatus` treats `current !== status` as a decision reset and
deletes every `speakerConfirmations/{uid}` response, answers, photo and `respondedAt` — or
`confirmAnswers`/`speakerPhoto` on a solo proposal — cancels pending profile-update requests and
sets `scheduleCancellationRequired` (index.ts:4225-4232, 4282-4295, 4321-4331). `decide()` then
records `previous: previous === 'submitted' ? 'under_review' : previous`, i.e. literally
`'confirmed'`, and offers Undo. `undoDecision()` (Proposals.tsx:972-1006) calls
`setProposalStatus` with that value, which index.ts:4178 rejects with `invalid-argument`;
`src/lib/errors.ts:62-63` maps that to `t.admin.badInput`, "Check the email address and the
dates."
**Why it matters:** The admin is offered an Undo affordance immediately after an irreversible
write, and it cannot work in the one case where the change was most costly — the speaker's
confirmation answers, logistics data and programme photo are gone and no status change restores
them. The failure message names an email address and dates, which have nothing to do with the
action. Native selects also change value on arrow key or scroll wheel, so this is reachable by
accident while tabbing the table. `AGENTS.md:257-259` states the intent as "Undo returns to
under_review"; the code applies that mapping only to `submitted`.
**Repro:** Seed a proposal in `confirmed` with confirmation answers. As `EVENT-ADMIN` open
`/c/{cfpId}/admin/proposals` and set that row's Status select to "Rejected". The banner reads
"'X' moved from Confirmed to Rejected." with Undo. Click Undo: `INVALID_ARGUMENT`, the row shows
"Check the email address and the dates.", the proposal stays rejected, and the confirmation
subdocument fields are already deleted.
**Suggested fix:** Do not offer Undo when `previous` is outside the statuses `setProposalStatus`
accepts (map it to `under_review` the same way `submitted` is mapped, or hide the button), and
gate a move away from `confirmed`/`declined` behind an explicit confirmation that names what is
erased.
**Existing test:** `tests/e2e/roles.spec.ts:280-315` ("an admin can restore a decision to under
review but never to submitted") and `tests/e2e/journey.spec.ts:112` cover an original status of
submitted/under_review only. Nothing covers Undo from confirmed or declined.

### H5 — Select-question options textarea strips the keystroke you just typed

**Area:** frontend-correctness
**Persona:** `EVENT-ADMIN`
**Severity:** high
**Location:** `src/components/FieldRows.tsx:268`
**What:** The "Options" textarea is fully controlled by a lossy round-trip. `toLines`
(FieldRows.tsx:23-24) joins `field.options[].value` with newlines; `fromLines`
(FieldRows.tsx:26-31) splits on newline, trims each line and filters empties. Because
`value={toLines(field)}` is recomputed from the parsed result on every keystroke — `patch`
(:71-72) calls `onChange`, and both parents own the state (`ConfirmFormEditor.tsx:122-124`,
`SubmissionFormEditor.tsx:496-500`) — any character `fromLines` normalises away is written back
over the DOM on the same tick. `src/components/fields.tsx:178-181` renders a fully controlled
`<textarea value={value}>`, so React restores it: a trailing space and a trailing newline are
both erased.
**Why it matters:** `ADM-03` has the event admin add custom submission and confirmation
questions, and a select question is the one field type whose options must be authored. The
organiser can never press Enter to start a second option, and can never type a space at the end
of the current word, so "Vegetarian meal" comes out "Vegetarianmeal". The field's own help text
(`src/i18n/en.ts:1404`) promises "One per line. Each line is shown as written and stored as
written." Reachable from both editors: `shared/confirmForm.ts:17` includes `select` in
`FIELD_TYPES`, and `SubmissionFormEditor.tsx:50` includes it in `EXTRA_TYPES`.
**Repro:** `/c/{cfpId}/admin/confirmation` → Add a question → set "Answer type" to a list/select
→ click into "Options" → type `Vegetarian` then press Enter. Observed: the value reverts to
`Vegetarian` with the caret at the end, no second line. Then type `Vegetarian` + Space + `meal`.
Observed: `Vegetarianmeal`. Pasting a multi-line string in one event survives, which is why this
has not been noticed.
**Suggested fix:** Hold the textarea text in local component state (or store the raw text on the
field) and run the trim/filter normalisation only at save time, the way
`SubmissionFormEditor.save()` already mints option codes at save rather than per keystroke.
**Existing test:** None found. `tests/e2e/confirm.spec.ts:220` and
`tests/e2e/submissionForm.spec.ts` seed `options` through the backend and assert only the
rendered preview; no vitest file references `FieldRows`.

### H6 — Switching interface language silently discards an unsaved email template draft

**Area:** frontend-correctness
**Persona:** `EVENT-ADMIN`
**Severity:** high
**Location:** `src/components/EmailPreview.tsx:96`
**What:** `useEffect(() => { if (!localeTouched.current) setPreviewLocale(locale); }, [locale])`
makes the preview language follow the app locale until the organiser explicitly picks one
(`localeTouched` is set only at :195). That write changes `selection` (:68), so the
template-loading effect at :77 sees `changed === true` and runs `setDraft(next)` unconditionally
at :80, overwriting the in-progress subject and body with the stored template for the other
language. It also calls `setBaseline(next)`, so `dirty` (:71) falls to false and
`onDirtyChange(false)` fires, removing AdminPage's confirm-on-navigate guard.
**Why it matters:** Every other route into this state is guarded — `changeSelection` (:110)
confirms before changing kind or preview locale, and tests already pin protection against a late
queue refresh and against tab navigation. The header locale switch is a plain button
(`src/App.tsx:380-386`), so neither `confirmInternalNavigation` (`src/screens/AdminPage.tsx:149`,
which inspects only `a[href]` and the sign-out button) nor `changeSelection` sees it. This is the
class of loss `AGENTS.md:174` warns about — the dictionary reaching a loader's dependency
chain — arriving through `locale` rather than through `t`. `LOC-03` has the event admin switch to
French mid-workspace.
**Repro:** `/c/{cfpId}/admin/email` → tick "Edit the wording" → type a new Subject line and body
without saving → click the `Français`/`English` button in the header. Observed: subject and body
revert to the stored template for the other language with no confirmation, and the
unsaved-changes navigation guard stops firing.
**Suggested fix:** Skip the locale-follow write while `dirty` is true (or route it through
`changeSelection` so it asks first), and/or make the effect at :77 preserve the draft when only
the preview locale moved without an explicit choice.
**Existing test:** `tests/e2e/email.spec.ts:1024` ("a late email refresh does not overwrite
wording being typed") and `:1003` ("changing admin tabs does not discard unsaved email wording")
cover the neighbouring cases; no test switches the interface language while the editor is dirty.

### M1 — `grant()` skips the owner and last-admin refusals for an unresolvable address

**Area:** backend-authz
**Persona:** `EVENT-ADMIN`
**Severity:** medium
**Location:** `functions/src/roles.ts:140`
**What:** `grant()` identifies the existing member two ways only: the Auth uid for the address
when that account is verified and not disabled (roles.ts:113-114), or a `claimedBy` on an
existing `roleGrants` document (:126, :140). If neither resolves, `currentMember` is null
(:141-145), `currentRole` is undefined, and both refusals the function's own docstring promises
(:96-99) are skipped (:150-160). `revoke()` does not have this gap — it resolves targets a third
way, `members.where('email','==',email)` (:228-236), folded into the owner and last-admin checks
at :243-255. The asymmetry matters because `createCfp` writes the owner straight to
`members/{uid}` with no `roleGrants` document (index.ts:3792-3800), so the claimed-grant fallback
never covers an owner.
**Why it matters:** An admin gets a success response for a change the code is documented to
refuse, and `notifyCommitteeRoleInvite` (index.ts:4103-4152) then mails the owner a committee
invitation for a role they will never receive, because `claim()` short-circuits on their existing
member document (roles.ts:279). The stray pending grant sits in `roleGrants` where the committee
screen shows it as a live invitation, and it becomes a real demotion if the address is later
re-registered under a new uid and claims it. `tests/e2e/roles.spec.ts:161-174` shows the author
deliberately hardened `revoke()` for exactly this class of target and left `grant()` behind.
**Repro:** CFP owned by O, created through `createCfp`. O's Auth account is deleted or disabled.
Admin A calls `grantRole({cfpId, email: 'owner@example.org', role: 'reviewer'})`. `userForEmail`
returns undefined or a disabled record, `existingGrant` does not exist, `currentMember` is null.
Result: no `FAILED_PRECONDITION`, a pending `roleGrants/owner@example.org` = `{role:'reviewer'}`
is written with a fresh `invitationId`, the callable returns `{applied:false}` and the trigger
queues a `committee_role_invited` email. Expected (what `tests/e2e/roles.spec.ts:236-244` asserts
for the verified case): `FAILED_PRECONDITION`, "An owner's role cannot be changed."
**Suggested fix:** Give `grant()` the same third resolution route `revoke()` uses — read
`cfps/{cfpId}/members` where `email == email` inside the transaction and fold those documents
into the owner and last-admin checks before either write.
**Existing test:** `tests/e2e/roles.spec.ts:225-244` ("the owner's row offers neither control,
and the callable refuses both") covers only the live, verified owner.

### M2 — Every reviewer can read a solo speaker's private confirmation answers

**Area:** security-rules
**Persona:** `SPK-CONFIRMED`
**Severity:** medium
**Location:** `firestore.rules:220`
**What:** `allow get, list: if isSpeakerOn(resource.data) || (isReviewer(cfpId) &&
resource.data.status != 'draft')` gives every event member — including a plain reviewer — the
whole proposal document once it leaves draft, and Firestore has no field-level reads. For a
proposal that never used the per-speaker lifecycle (`usesPerSpeakerLifecycle` =
`Boolean(primarySpeakerId) || speakerIds.length > 1`, `functions/src/speakerLifecycle.ts:52`),
`respondToDecision` writes `confirmAnswers: answers` and `speakerPhoto` onto that same root
document (index.ts:2544-2564), and `uploadHeadshot` writes `headshotUploads` there. The identical
data on a multi-speaker proposal lives in `speakerConfirmations/{uid}`, which
firestore.rules:398-401 restricts to the speaker and admins. `primarySpeakerId` is written only by
`inviteCoSpeaker`/`respondToCoSpeakerInvitation` (`coSpeakers.ts:630`, ~:1102) — `submitProposal`
(index.ts:1792-1806) and `src/lib/proposals.ts:307-317` never set it — so the root path is the
default for every speaker who never invited a co-speaker, not a legacy tail. `AGENTS.md:106-108`
describes it as the "legacy single-speaker" fallback, which is inaccurate.
**Why it matters:** The confirmation form is organiser-defined and routinely holds dietary
requirements, accessibility needs, travel and visa detail and clothing sizes —
`tests/e2e/profileSnapshots.spec.ts:161` seeds it literally as `{ shirtSize: 'M', dietaryNeeds:
'Private answer' }`. `SPEC.md:307-310` labels `speakerConfirmations/{uid}.answers`
"presenter-private; admins after submission", and the rules enforce that for co-speaker
proposals. The exposure is confined to accounts that already hold a role on the same CFP, and
`AGENTS.md:236-249` records the same class of leak for `aggregate` with the rationale that
reviewers are a committee rather than an adversary — but that note does not name `confirmAnswers`,
so this one is undocumented and unpinned.
**Repro:** Seed CFP-OPEN with a confirm form containing a `dietaryNeeds` question. As
`SPK-ACCEPTED` on a solo proposal, call `respondToDecision` with `{response:'confirm',
answers:{dietaryNeeds:'severe nut allergy'}}`. Sign in as a plain `REVIEWER` and run the review
deck's own query (`src/lib/roles.ts:552`) or `getDoc(doc(db,'cfps',cfpId,'proposals',pid))`. The
returned document contains `confirmAnswers.dietaryNeeds` and the photo pointers. Repeat with a
two-speaker proposal: the same read returns nothing personal and the `speakerConfirmations` read
is denied.
**Suggested fix:** Stop writing confirmation payloads to the reviewer-readable root — have
`respondToDecision`/`uploadHeadshot` always use `speakerConfirmations/{uid}` (set
`primarySpeakerId` at submit so every proposal is on the per-speaker lifecycle) and backfill
existing solo proposals. If that migration is not affordable now, correct the "legacy" wording in
`AGENTS.md:106-108`, record the exposure the way the `aggregate` gap is recorded, and add a rules
test pinning the behaviour so it is a decision rather than an accident.
**Existing test:** `tests/rules.test.ts:909` ("reviewers read every proposal in their own CFP")
asserts the read is allowed but checks only document ids; `:1748`/`:1756` cover the
`speakerConfirmations` subcollection only. Nothing asserts what a reviewer can see on a confirmed
solo proposal.

### M3 — Switching talks in the picker silently throws away unsaved confirmation answers

**Area:** speaker-flow
**Persona:** `SPK-ACCEPTED`
**Severity:** medium
**Location:** `src/screens/SubmitPage.tsx:1524`
**What:** `openTalk` (:1522-1529) and `startNewTalk` (:1531-1537) flush only the talk/profile form
(`if (dirty.current && !(await persist('transition'))) return;`) before calling `showTalk`, which
then unconditionally runs `setAnswers(loadedAnswers)` and `answerDirty.current = false`
(:1496-1516). The confirmation-answer buffer is never flushed and never warned about. The picker's
tabs are plain buttons, so the document-level click interceptor at :1325-1372 — which does flush
answers — never sees them.
**Why it matters:** For `SPK-ACCEPTED` this is unconditional loss, not a race:
`saveConfirmationAnswers` returns false while `speakerStatusRef.current !== 'confirmed'` (:1024-1031)
and the 1.5s autosave effect bails on the same condition (:1080-1091), so an acceptance response
that has been typed but not submitted can never have been persisted. Clicking another talk tab
discards a t-shirt size, dietary note, slides URL and every typed answer with no warning, toast or
dialog. For `SPK-CONFIRMED` the same code loses a correction typed inside the debounce window,
since the picker's `busy` guard covers only `answerSaveState === 'saving'`. `AGENTS.md:95-97`
documents that "the talk half is cleared" on switch — it does not sanction dropping answers.
**Repro:** Seed a speaker with two proposals in CFP-OPEN, one `accepted` with a one-question
confirmation form and one `submitted`. Open `/c/{cfpId}/submit` on the accepted talk → click "Yes,
I can present" → answer the question → without clicking "Confirm my talk", click the other talk's
tab → click back. Observed: the answer is blank and the proposal is still `accepted`; nothing
warned. Expected: the answer is preserved, or the speaker is told it will be lost.
**Suggested fix:** Route `openTalk`/`startNewTalk` through the same `saveForTransition` logic the
navigation handlers use, and when `saveConfirmationAnswers` cannot persist require an explicit
confirm before `showTalk` clears `answerDirty`.
**Existing test:** `tests/e2e/draft.spec.ts:123` ("switching talks keeps every saved talk field and
the latest speaker profile") covers talk/profile fields only; `tests/e2e/confirm.spec.ts` has no
multi-talk switch case.

### M4 — An accepted speaker who starts answering the confirmation form cannot navigate away

**Area:** speaker-flow
**Persona:** `SPK-ACCEPTED`
**Severity:** medium
**Location:** `src/screens/SubmitPage.tsx:1220`
**What:** `saveForTransition` (:1218-1225) returns false whenever `answerDirty.current` is set and
`saveConfirmationAnswers('transition')` fails, and that callable returns false unconditionally
while `speakerStatusRef.current !== 'confirmed'` (:1024-1031). `setConfirmationAnswer` (:973-978)
sets `answerDirty` and arms the history guard for an accepted speaker too, so the state is
reachable. Both exit paths treat false as "stay here": `saveThenLeave` (:1307-1324) has already
called `preventDefault()` on the intercepted click and only resets `historyTransition`, and
`saveBeforeHistoryMove` (:1275-1296) re-pushes the guard entry and never calls `history.go(-2)`.
The click interceptor is registered in capture phase on `document` (:1372) and covers every
same-origin link plus the sign-out button. The only feedback is
`showToast(t.form.unsaved, 'warning')` — "Changes not saved yet" (`src/i18n/en.ts:599`).
**Why it matters:** An accepted speaker's response is the highest-value step in the flow, and this
makes the page a trap during it: every header link, breadcrumb, account-menu item, sign-out button
and browser Back is cancelled, indefinitely, with a toast that explains nothing. There is a
recovery — the questions block renders a Cancel/"Back" button (:582, `onCancelAsk` →
`cancelConfirmationAnswers` at :1750-1757) that clears `answerDirty` and frees navigation — but it
discards the typing and the toast never points at it. The handbook requires every state to have a
recovery action that matches the persona's task.
**Repro:** Seed `SPK-ACCEPTED` in CFP-OPEN with a one-question confirmation form. Open
`/c/{cfpId}/submit` → click "Yes, I can present" → type an answer → click "My profile" in the
account menu, or press browser Back. Observed: the page does not move, a "Changes not saved yet"
toast appears, and repeating the click repeats the toast indefinitely. Expected: the navigation
proceeds, or the speaker is told the answers are only kept once they confirm and is offered
discard/stay.
**Suggested fix:** Distinguish "save failed, retry is possible" from "nothing can be saved in this
state". When the response has not been submitted yet, let the navigation proceed behind an explicit
discard confirmation instead of cancelling it silently.
**Existing test:** `tests/e2e/draft.spec.ts` ("browser Back waits for a dirty draft to save before
leaving") covers the draft path only. None found for the unanswered-acceptance path.

### M5 — "+ Another talk" hides the whole talk picker when there is exactly one existing talk

**Area:** speaker-flow
**Persona:** `SPK-DRAFT`
**Severity:** medium
**Location:** `src/screens/SubmitPage.tsx:164`
**What:** `TalkPicker` returns null when `talks.length === 0 || (talks.length === 1 && !canAdd &&
pastTalks.length === 0)`. `canAdd` requires `proposalId !== null` (:1825-1829), which
`startNewTalk` nulls via `showTalk()` (:1499-1506). With exactly one existing talk and no past
talks the early return fires while the speaker is on the unsaved new talk, removing both the
existing talk's tab (:194) and the "New talk" indicator (:195-199).
**Why it matters:** Immediately after submitting a first proposal and clicking "+ Another talk" —
the exact sequence in `tests/e2e/journey.spec.ts:36` — the speaker sees a blank form, no "Your
talks" bar, no "New talk" marker and no Submitted banner, since `showTalk()` also resets `status`
to draft. It reads as though the submitted proposal was wiped, and there is no in-page control to
get back to it. The state is self-healing after one autosave (1.5s after the first keystroke puts
a second talk in `talks`), so reload is not the only recovery, but nothing tells the speaker that.
**Repro:** Sign in as a speaker with one talk in CFP-OPEN (draft or submitted) and no
withdrawn/rejected/declined talks. Click "+ Another talk", then try to return to the first talk
without typing anything. Observed: the "Your talks" navigation is gone entirely. Expected: the
first talk's tab plus the "New talk" tab stay visible, as they do when a past talk also exists.
**Suggested fix:** Take the early return only when a talk is actually selected — skip it when
`currentId === null`, or fold the new-talk case into `canAdd`.
**Existing test:** `tests/e2e/draft.spec.ts:242-247` exercises "+ Another talk" but seeds three
past talks, so `pastTalks.length > 0` keeps the picker rendered. `tests/e2e/journey.spec.ts:36`
performs the click but asserts only the blank Title and carried-over Bio.

### M6 — Hitting the talk cap on submit shows "Something went wrong. Please try again."

**Area:** speaker-flow
**Persona:** `SPK-DRAFT`
**Severity:** medium
**Location:** `src/lib/errors.ts:49`
**What:** `submitProposal` throws `resource-exhausted` with "You have already submitted 3 talks." /
"A co-speaker has already submitted 3 talks." (index.ts:1717-1723). `friendlyError`
(errors.ts:29-51) has no case for `resource-exhausted`, so it falls through to
`default: t.errors.generic`. `SubmitPage.onSubmit` puts that string in the page banner
(:1618-1619, rendered at :2501-2505). Three other screens do map this code —
`src/App.tsx:939`, `src/screens/NewCfpPage.tsx:89`, `src/components/CoSpeakerRoster.tsx:61` — so
the omission is an oversight.
**Why it matters:** The cap is reachable through the UI because drafts are uncapped while
`canAdd`/`atCap` count only live statuses (:1809): a speaker can build four drafts, submit three,
and the fourth submit fails. They are told a retryable-sounding "please try again" for a condition
that will never succeed, and the Submit button (:2539-2556) is not disabled. The picker does render
`t.form.talkCap` ("That is the maximum of 3.", :215) so the speaker is not entirely unaware a limit
exists, but the banner invites a retry that can never work and never mentions that withdrawing a
talk frees a slot. The co-speaker variant is worse — the blocking talk is not even theirs, and
nothing on the page hints at it.
**Repro:** Seed a speaker with 3 `submitted` proposals plus 1 complete `draft` in CFP-OPEN. Open
the draft and press "Submit proposal". Observed: red banner "Something went wrong. Please try
again." at the bottom of the form; the button stays enabled and repeated presses repeat the
message. Expected: "You can have at most 3 talks in front of the committee" with the withdrawal
route named.
**Suggested fix:** Add a `resource-exhausted` case to `friendlyError` mapping to a new
`t.errors.talkCap`-style string in both dictionaries, and disable or annotate the Submit button
when `submittedCount >= LIMITS.maxTalksPerSpeaker`.
**Existing test:** `tests/e2e/roles.spec.ts:474-493` ("a fourth submitted talk is refused by the
server") asserts only the callable's `RESOURCE_EXHAUSTED` code, not the message the speaker sees.

### M7 — "Save details" gives no visible confirmation, and its error lands off-screen

**Area:** speaker-flow
**Persona:** `SPK-CONFIRMED`
**Severity:** medium
**Location:** `src/screens/SubmitPage.tsx:596`
**What:** The confirmed-speaker "Save details" button (:596-605) calls
`saveConfirmationAnswers('manual')` (:2099-2103). On success that only sets
`answerSaveState = 'saved'` (:1055), which is never rendered — every other reference (:1820,
:2063, :2080) is a `=== 'saving'` busy check, and the `Questions` component has no save indicator.
The `actions__status` live region (:2474-2494) reports `saveState`, i.e. the draft/profile save,
not the answers. On failure `setBanner(...)` (:1064) writes into the banner at :2501, at the very
bottom of the form, while the button sits in the StatusBanner near the top (:2058).
**Why it matters:** The draft path deliberately toasts "Draft saved" for `source === 'manual'`
(:1186-1193); the confirmation path does not. A confirmed speaker corrects a t-shirt size, presses
"Save details" and sees nothing change beyond a brief disabled flicker — the handbook's "confidence
that work was saved" check fails, and the natural response is to press again or assume it did not
work. If the save fails, the only signal is a red line far outside the viewport, so the speaker
leaves believing a correction was stored when it was not.
**Repro:** Seed `SPK-CONFIRMED` with one confirmation question. Open `/c/{cfpId}/submit`, change
the answer, press "Save details". Observed: no toast, no status text, no aria-live announcement.
Repeat with the `respondToDecision` call forced to fail: no message near the button; the only error
text is at the bottom of the page.
**Suggested fix:** Mirror the draft behaviour — toast on a manual answer save, and render
`answerSaveState` plus its failure and retry in an aria-live region inside the StatusBanner next to
the button.
**Existing test:** `tests/e2e/confirm.spec.ts:303-317` and `:319-337` poll Firestore directly and
assert nothing about UI feedback.

### M8 — A paused call tells a draft owner the window is closed and invites deletion

**Area:** speaker-flow
**Persona:** `SPK-DRAFT`
**Severity:** medium
**Location:** `src/screens/SubmitPage.tsx:1975`
**What:** `lifecycleNext` (:1972-1975) branches only on `cfp.state === 'open'` for a draft, so
`paused` collapses into `t.form.nextSteps.draftClosed` — "This draft was not submitted" / "The
proposal window is closed. Keep the draft for your records or delete it if you no longer need it."
(`src/i18n/en.ts:626-630`). `cfpState` returns a distinct `'paused'` (`shared/cfpWindow.ts:9,30`)
and the no-talks branch of this same screen does distinguish it (:1796), so only the has-a-draft
branch does not.
**Why it matters:** A pause is temporary and the rules refuse writes while it lasts, so the whole
form is correctly greyed out — `editScope` (`src/lib/lifecycle.ts:38-44`) gives 'none' for a draft
when the window is not open. But the speaker is told the round is over and nudged toward the still
enabled Delete draft button (:2529-2538), which `deleteDraftProposal` (index.ts:1909-1931) honours
because it checks only `assertCfpNotArchived` and draft status. Meanwhile the context header two
elements above still prints a future submission deadline (:2018-2031), so the page contradicts
itself. `PUB-03` requires copy that identifies the precise state.
**Repro:** Seed a speaker with a `draft` proposal in a CFP, then set `paused: true`. Open
`/c/{cfpId}/submit`. Observed: "This draft was not submitted — the proposal window is closed…
delete it if you no longer need it", a future "Submissions close on" date beside it, and every
field disabled. Expected: paused-specific copy saying submissions are temporarily paused and the
draft will be editable again.
**Suggested fix:** Add a `draftPaused` entry to `nextSteps` in both dictionaries and branch on
`cfp.state === 'paused'` here, as the empty-state branch at :1796 already does.
**Existing test:** `tests/e2e/window.spec.ts:166-170` ("paused is its own message, not 'closed'")
covers only the signed-out page; the paused fixture at :236-240 uses a `confirmed` proposal.

### M9 — `removeCoSpeaker` orphans `speakerConfirmations`; a re-invited speaker rejoins "Declined"

**Area:** cospeaker-flow
**Persona:** `SPK-DECLINED`
**Severity:** medium
**Location:** `functions/src/coSpeakers.ts:1390`
**What:** The removal transaction (:1387-1400) resets the participant document to
`status: 'inactive'` with `removedBy`/`removedAt` but never touches
`cfps/{cfpId}/proposals/{proposalId}/speakerConfirmations/{targetUid}`, which still holds
`response: 'declined'` — removal after submission requires exactly that response (:1311-1320).
`respondToCoSpeakerInvitation`'s accept path re-merges the participant document and explicitly
deletes `removedBy`/`removedAt` (:1126-1145) but likewise never clears the stale confirmation, so
the record survives the round trip. Re-inviting the removed address is permitted: the duplicate
check (:540-550) looks only at active profiles and unexpired pending rows.
**Why it matters:** The moment the re-invited person clicks "Save details and join", `rosterFor`
(:303-311, 347-358) reports `confirmationState: 'declined'` for them, the admin Proposals panel
renders a "Declined" chip (`src/screens/admin/Proposals.tsx:226`), `canRemove` becomes true so an
organiser is offered "Remove co-speaker" for someone who just joined, and on their own page
`speakerStatus` resolves to `declined` (`src/screens/SubmitPage.tsx:765-768`) — they are shown "You
turned down the slot" immediately after joining. The asymmetry with the participant document, which
*is* reset, shows this is an oversight. It is self-healing (index.ts:2035-2037 documents that a
declined speaker can change their answer back from the same screen), so the damage is a wrong chip
and a misleading organiser control rather than a stuck state.
**Repro:** Accepted proposal with lead plus guest, both on the per-speaker lifecycle. Guest calls
`respondToDecision` `decline`. Admin calls `removeCoSpeaker` for the guest. Admin calls
`inviteCoSpeaker` for the same address. Guest accepts the new post-acceptance invitation with acks
and attendance. `getProposalRoster` returns `{ uid: guest, confirmationState: 'declined',
canRemove: true }` and the guest's own submit page shows "Declined" although they were never asked.
**Suggested fix:** Delete or blank `speakerConfirmations/{targetUid}` inside the `removeCoSpeaker`
transaction alongside the participant reset, and/or clear it in `respondToCoSpeakerInvitation`'s
accept path the same way `removedBy`/`removedAt` are cleared.
**Existing test:** None found. `tests/e2e/coSpeakersLifecycle.spec.ts:1471` ("a co-speaker can
leave, rejoin from a fresh invitation, and remains conflicted") exercises only the draft phase,
where no confirmation exists.

### M10 — Every invitation `failed-precondition` renders as "The call for proposals is not open right now."

**Area:** cospeaker-flow
**Persona:** `REVIEWER`
**Severity:** medium
**Location:** `src/components/CoSpeakerInvitation.tsx:240`
**What:** `accept()` (:240) and `decline()` (:254) funnel every callable failure through
`friendlyError`, which maps `failed-precondition` to `t.errors.notOpen` — "The call for proposals
is not open right now." (`src/lib/errors.ts:36-37`, `src/i18n/en.ts:2005`).
`respondToCoSpeakerInvitation` throws that code for several distinct conditions, including the
reviewer conflict ("This person already reviewed the proposal and cannot be added as a speaker",
`functions/src/coSpeakers.ts:975-980`), a revoked or already-answered invitation (:931-932), and
`assertDraft`/window checks (:1005-1012).
**Why it matters:** For the reviewer conflict there is no recovery: `getCoSpeakerInvitation` keeps
returning `state: 'pending'` with `canRespond: true`, so reloading re-renders the same form and
every retry produces the same wrong sentence. A committee member the organisers deliberately
invited to co-present fills in their profile, all acknowledgements and travel details, presses
"Save details and join", and is told the call for proposals is closed — false, since a
post-acceptance invitation is independent of the submission window
(`functions/src/speakerLifecycle.ts:360-368`). The organiser gets no warning either, because
`inviteCoSpeaker` never checks for an existing review at invite time. In the ordinary
revoke-during-response race the same wrong message appears, though a reload does resolve that one
(`coSpeakers.ts:810-816`). `tests/admin.test.ts:196-203` documents that context-specific mappers
exist precisely because `friendlyError`'s reading of this code is wrong outside the applicant
window.
**Repro:** Reviewer R scores proposal P. Admin accepts P and invites R's verified address as a late
co-speaker. R opens `/c/{cfpId}/submit?proposal=P&speakerInvite={id}`, completes profile,
acknowledgements and attendance, presses "Save details and join". The callable throws
`failed-precondition`; the page shows "The call for proposals is not open right now." and stays on
the form. Reloading shows `pending` again; every retry repeats identically.
**Suggested fix:** Give the invitation screen its own error mapper (like `emailError`/
`scheduleError`) keyed on a `details.reason` returned by `respondToCoSpeakerInvitation` — at
minimum distinguishing reviewer-conflict, invitation-no-longer-answerable and window-closed — and
reload the summary after a terminal failure so the invitee lands on the correct `InvitationState`
panel.
**Existing test:** The backend refusal is intentional and tested
(`tests/e2e/coSpeakersLifecycle.spec.ts:960-980`); nothing covers the client message.

### M11 — A speaker blocked on a co-speaker is told to "Wait for the working schedule"

**Area:** cospeaker-flow
**Persona:** `SPK-CONFIRMED`
**Severity:** medium
**Location:** `src/screens/SubmitPage.tsx:1984`
**What:** `speakerStatus` correctly resolves to the caller's own response (:764-768), but the
`lifecycleNext` chain (:1970-2002) and `StatusBanner` (:486-503) branch on `speakerStatus` only,
never on the proposal-level `status`. So a speaker whose own confirmation is recorded while the
proposal is still `accepted` gets the fully-confirmed copy: heading "Confirmed",
`t.form.statusHelp.confirmed` and next step `t.form.nextSteps.confirmedWaiting` — "Wait for the
working schedule … Your own placement will appear here after organisers share a confirmed preview"
(`src/i18n/en.ts:663-666`).
**Why it matters:** Only `confirmed` proposals enter a release (`shared/schedule.ts:193-210`), so
the placement can never appear no matter how long they wait. The journey component exists to say
what to do next, and here it points at the organisers when the blocker is the speaker's own
co-presenter. The truth is on the page — the roster further down shows "Awaiting confirmation" —
but the primary next-step signal contradicts it.
**Repro:** Two-speaker proposal set to `accepted`. Lead opens `/c/{cfpId}/submit` and answers
`confirm`; `respondToDecision` returns status `accepted`. The header chip reads "Confirmed", the
status panel reads "You are confirmed. Schedule details will appear here after organisers share a
confirmed preview", and the journey next step reads "Wait for the working schedule". Nothing at the
top says the session is still waiting on the co-speaker.
**Suggested fix:** When `usesPersonalConfirmation && ownResponse === 'confirmed' && status !==
'confirmed'`, select distinct next-step and status copy — "Your answer is recorded — the session is
waiting on another speaker" — and link to the `#submission-co-speakers` section.
**Existing test:** None found; nothing in `tests/` asserts this copy for a partially confirmed
roster.

### M12 — Pressing 1-4 clears a declared conflict and saves a counted score

**Area:** reviewer-admin-flow
**Persona:** `REVIEWER`
**Severity:** medium
**Location:** `src/screens/ReviewPage.tsx:289`
**What:** `ReviewCard` disables all four score buttons whenever a conflict is declared
(`disabled={saving || draft.conflictOfInterest}`, :811) and the conflict checkbox clears `score`
when ticked (:818-828) — the UI treats them as mutually exclusive. The global keydown handler
(:331-334) routes `1`-`4` straight into `scoreAndAdvance` with no equivalent guard, and
`scoreAndAdvance` (:282-297) unconditionally builds `{...draft, score, conflictOfInterest: false}`,
persists it through `saveReview` and advances the deck. `saveReview` accepts the pair without
complaint (index.ts:3096-3110).
**Why it matters:** A conflict is excluded from every aggregate including the reviewer's own
calibration (`shared/aggregate.ts:85`). Converting it to a score means a reviewer who declared they
cannot judge a talk now contributes a counted score to that talk's `avgScore`, `normalizedScore`
and `stdDev`, and to their own calibration mean — with no visible confirmation, because the deck
has already advanced. The keyboard does what the mouse is explicitly prevented from doing, which
also fails the `LENS-KEYBOARD` parity expectation in `A11Y-02`. The write is one recoverable review
document and the reviewer did press a scoring key, so this is a parity defect rather than silent
corruption.
**Repro:** As `REVIEWER` with a saved conflict on proposal A, the four score buttons render
disabled. Press `3`. The review document is rewritten to `{score:3, conflictOfInterest:false}`, the
deck advances, the workload "Conflicts" counter drops, and the score enters the aggregate.
**Suggested fix:** Return early from `scoreAndAdvance` when the current draft has
`conflictOfInterest` set, or require the reviewer to clear the conflict first, so the shortcut
honours the same mutual exclusion the buttons enforce.
**Existing test:** `tests/e2e/deck.spec.ts:242-263` ("a conflict can be saved without choosing a
numeric score") asserts the conflict survives a reload and that the score buttons read
`aria-pressed=false`, but never presses a number key while it is set.

### M13 — `adminError` maps every `failed-precondition` to "That is the only admin left"

**Area:** reviewer-admin-flow
**Persona:** `EVENT-ADMIN`
**Severity:** medium
**Location:** `src/lib/errors.ts:61`
**What:** `adminError` (errors.ts:60-62) returns `t.admin.lastAdmin` — "That is the only admin left
— give someone else the role first." — for any `failed-precondition`. The comment above it scopes
the intent to role management, but the helper is used by the decisions table
(`src/screens/admin/Proposals.tsx:90, 865, 874, 959, 1009`), the coverage panel, Overview's loader
(`Overview.tsx:190`) and the whole Settings lifecycle including archive/unarchive/delete
(`Settings.tsx:165, 209`). `setProposalStatus` throws `failed-precondition` for a
withdrawn or draft proposal (index.ts:4207-4212) and for an archived CFP (:4200-4202);
`archiveCfp` throws it for "This call for proposals is being deleted" (:3902, :3924).
**Why it matters:** The proposals table is a one-shot load (Proposals.tsx:868-874, no
`onSnapshot`), so a speaker withdrawing while an admin has the list open is an ordinary race. The
admin gets a row error telling them to hand the admin role to somebody else, which is impossible to
act on and hides the real cause. The same applies to the `EVENT-OWNER` recovery path after a
partially failed `deleteCfp`: the CFP is left with `deleting: true` and pressing "Bring it back"
answers "That is the only admin left".
**Repro:** As `EVENT-ADMIN` open `/c/{cfpId}/admin/proposals`. In a second context the speaker
withdraws proposal P. Back in the admin tab, set P's Status select to "Accepted": the row shows
"That is the only admin left — give someone else the role first." instead of naming the withdrawal.
**Suggested fix:** Keep the last-admin wording in the committee/role path only, and give the
decision, overview and lifecycle callers their own `failed-precondition` copy, reusing the
`reasonOf` details pattern already used by `emailError`/`scheduleError`.
**Existing test:** `tests/e2e/roles.spec.ts:191` and `:216` pin the `lastAdmin` string on the
committee screen, where the copy is correct. Nothing asserts it for the decisions table or the
lifecycle.

### M14 — Overview tells an archived event its setup is incomplete and links to a disabled control

**Area:** reviewer-admin-flow
**Persona:** `EVENT-OWNER`
**Severity:** medium
**Location:** `src/screens/admin/Overview.tsx:223`
**What:** `const windowValid = Boolean(opens && closes && closes.getTime() > opens.getTime() &&
!cfp.archived);` folds `!cfp.archived` into the submission-window readiness check, so archiving
flips that checklist item back to todo (:253-265). Readiness drops to 4/5 (:312-315), the hero
switches from `readyTitle` to `setupTitle` (:387), and the setup panel is forced open by
`open={readiness < 100}` (:536), showing "Confirm the submission window" with an "Edit window"
button that targets the settings tab (:264) — where `opensAt`, `closesAt` and "Save window" are all
`disabled={busy || archived}` (`Settings.tsx:537, 545, 577`).
**Why it matters:** `ADM-01` requires that "each incomplete item links directly to the place it can
be fixed" (handbook:277). On `CFP-ARCHIVED` the item is not incomplete and the destination cannot
be used, while the lifecycle card on the same screen correctly sets step 17, "Close out the event"
(:341-343). The page contradicts itself and sends the owner to a dead control whose only
explanation is the generic read-only banner at the top.
**Repro:** As `EVENT-OWNER` archive the disposable CFP (`OWN-01`), then open
`/c/{cfpId}/admin/overview`. State chip says "Archived"; heading says "Finish the essentials before
you share"; readiness reads 4/5; the open checklist shows the window step as todo with an "Edit
window" action that lands on disabled date fields.
**Suggested fix:** Drop `!cfp.archived` from `windowValid` — archive is already surfaced by the
state chip and lifecycle step 17 — or suppress the setup checklist and the setup/ready hero
entirely when `cfp.archived` is true.
**Existing test:** `tests/e2e/archivedAdmin.spec.ts` covers settings, committee, proposals,
submission, confirmation and email on an archived CFP but never opens the overview tab.

### M15 — Exported `.ics` declares `TZID` but never emits a `VTIMEZONE` component

**Area:** schedule-flow
**Persona:** `SPK-CONFIRMED`
**Severity:** medium
**Location:** `shared/calendar.ts:41`
**What:** `scheduleIcs` emits the VCALENDAR header (:38-48) with only
VERSION/PRODID/CALSCALE/METHOD/X-WR-CALNAME/X-WR-TIMEZONE, then writes every VEVENT with
`DTSTART;TZID=America/Toronto:20261114T091500` and the matching DTEND (:60-61). No VTIMEZONE
component is produced anywhere in the repository, so the `TZID` parameter references a zone that is
not defined in the iCalendar object. RFC 5545 requires the referenced VTIMEZONE to be present;
`X-WR-TIMEZONE` is a non-standard Google hint, not a substitute.
**Why it matters:** Clients that do not carry an IANA database keyed by that name cannot resolve
the `TZID` and fall back to treating the value as floating local time, so an attendee or speaker in
another zone gets every session at the wrong wall-clock time, silently. Google, Apple and current
Outlook do resolve IANA `TZID`s, so this is client-dependent rather than universal. `SPK-09`
("download its ICS") and `LOC-02` ("stable IDs/times do not change") both treat this file as an
authoritative deliverable, and DST transitions make the failure non-uniform across a two-day event.
**Repro:** Open a published programme, click "Download calendar" (`src/screens/SchedulePage.tsx:497`)
or "Add session to calendar" (:708). The file contains `DTSTART;TZID=America/Toronto:...` with no
`BEGIN:VTIMEZONE` block. Import into a client without its own zone database while the machine is
set to Europe/Paris: a 09:15 Montréal session shows as 09:15 Paris rather than 15:15.
**Suggested fix:** Emit a VTIMEZONE component for `schedule.timeZone` (STANDARD/DAYLIGHT
sub-components covering the release's date range, derivable from `Intl` offsets) immediately after
the calendar header, before the first VEVENT.
**Existing test:** `tests/calendarExport.test.ts:46-47` asserts the DTSTART/DTEND/UID/SEQUENCE form
and escaping; it asserts nothing about VTIMEZONE, so the omission is not covered either way.

### M16 — `emailDomain`'s tenancy and binding refusals reach the admin as "Resend would not accept that key"

**Area:** email
**Persona:** `EVENT-ADMIN`
**Severity:** medium
**Location:** `src/lib/errors.ts:162`
**What:** `resendError` maps every `failed-precondition` to `t.admin.emailErrors.badKey`, whose text
is "Resend would not accept that key. Check that it was copied whole, and that its permission is
Full access — a sending-only key cannot manage domains." (`src/i18n/en.ts:1129-1130`). `emailDomain`
throws that code for several distinct causes: Resend genuinely rejecting the key
(`functions/src/domains.ts:75`), the exclusive-binding refusal "This existing Resend domain cannot
be assigned automatically. Ask a platform administrator to resolve it."
(`functions/src/index.ts:5560-5570` and the legacy migration at :5473-5476), and "The stored sending
domain no longer matches Resend." (:5510-5515, :5617-5622). The one actionable sentence the server
wrote never reaches the screen.
**Why it matters:** `AGENTS.md` records this exact class of bug as already fixed once for
`unauthenticated`, and `resendError`'s own docstring says the point of the map is not to send an
admin chasing the wrong credential. An event admin who is not a platform admin cannot touch the key
at all — `EmailSetup` renders `t.admin.emailKeyPlatformManaged` and no key field for them
(`src/components/EmailSetup.tsx:158`) — so the only remediation offered is one they cannot perform.
The tenancy invariant is firing correctly and being described as a credential fault. The behaviour
itself is right and no data is at risk, which is why this is medium.
**Repro:** As `EVENT-ADMIN` on a CFP with no bound domain, open `/c/{cfpId}/admin/email` and in
Step 2 type a domain name that already exists in the shared Resend account. `emailDomain` action
'add' finds it via `listDomains`, `existing && !bindingIsOurs && !exactLegacyOwner` is true, and
index.ts:5567 throws `failed-precondition`. `EmailSetup.run`'s catch (:138) renders
`resendError(e, t)`. Observed: "Resend would not accept that key…". Expected: "this domain is
already assigned to another event — ask a platform administrator". The same wrong text appears from
`refresh()` (:105) when `migrateLegacyEmailDomainBinding` cannot resolve a legacy pointer.
**Suggested fix:** Attach a stable `details.reason` to each of these throws (e.g.
`email_domain_unavailable`, `email_domain_mismatch`) as `emailError` already does for
`email_delivery_not_ready`, and branch on it in `resendError` before falling back to `badKey`.
**Existing test:** `tests/admin.test.ts:253-265` pins `failed-precondition` → `badKey` but
constructs `{ code }` with no `details`, so a `reasonOf`-based branch would keep it green — the test
does not make the conflation intentional.

### M17 — Successfully delivered mail is labelled "Retained — superseded"

**Area:** email
**Persona:** `EVENT-ADMIN`
**Severity:** medium
**Location:** `functions/src/index.ts:4724`
**What:** `emailQueue` action 'preview' runs `currentDecisionEmails` over the entire log
(`queueDocs`, terminal `sent` rows included, :4670-4672) and stamps `stale:
historyStaleIds.has(d.id)` on every row (:4680, :4724). `currentDecisionEmails`'s `sendable`
predicate answers "would this be sendable now", not "was this delivered" (:1049-1050). The admin
table then renders `row.stale ? t.admin.emailStaleStatus : … : t.admin.emailStatus[row.status]`
(`src/screens/admin/Email.tsx:754-758`), so a row whose stored status is `sent` displays as
"Retained — superseded" in the column headed "Outcome", and its Resend button is disabled (:771-780)
— while the filter at :741 still matches on `r.status`.
**Why it matters:** The comment at `Email.tsx:694-698` states the log exists because "Counts alone
could not answer 'did this speaker get their acceptance'". This inverts that: mail that did go out
reads as if it never did. The affected set is not marginal — `staffNotificationStillTrue` requires
status ∈ {submitted, under_review} (`functions/src/email.ts:442-450`), so every
`committee_proposal_submitted` notice to every committee member flips to "superseded" the moment
that proposal is decided, and every `committee_schedule_shared` notice flips on the next re-share.
Filtering by "Sent" still returns these rows, which then contradict the filter that produced them.
The in-code comment at index.ts:4722-4723 ("The database row remains held") is itself evidence the
flag was meant for pending rows only.
**Repro:** As `EVENT-ADMIN` on a CFP with committee members, submit a proposal, then set that
proposal to `accepted`. Open `/c/{cfpId}/admin/email`, Delivery history, filter "Sent". Observed:
the committee rows appear under the Sent filter but their Outcome cell reads "Retained —
superseded" and Resend is disabled. Expected: "Sent", with the delivery timestamp.
**Suggested fix:** Mark a row stale only when it is still actionable — compute `stale` from
`pendingState.stale` (held/failed/dry_run/expired-sending) rather than from `historyStaleIds` over
the whole log — and leave terminal `sent` rows reporting their real outcome.
**Existing test:** `tests/e2e/email.spec.ts:433-470` asserts "Retained — superseded" only for a
still-`held` row, and `tests/e2e/staffNotifications.spec.ts:130-132` asserts `stale: true` on a row
that is `dry_run` in the emulator. Because the e2e suite never produces a real `sent` status, no
test covers the terminal case.

### M18 — Checkbox questions cannot express "required"

**Area:** ux-a11y-i18n
**Persona:** `SPK-DRAFT`
**Severity:** medium
**Location:** `src/components/fields.tsx:319`
**What:** `interface CheckboxProps extends Omit<CommonProps, 'label' | 'required'>`, so `Checkbox`
(:324-355) renders neither the `Requirement` chip that `Shell` renders for text/textarea/select
(:47-52) and `RadioGroup` renders in its legend (:285), nor `aria-required`. The consequence is
visible at `src/screens/SubmitPage.tsx:331-345`: the `field.type === 'checkbox'` branch is the only
one that does not forward `required: field.required`, which the shared `common` object at :348-357
forwards for every other type.
**Why it matters:** The server enforces it — `shared/confirmForm.ts:369-374` writes
`faults[field.key] = 'required'` for an unticked required checkbox — and
`src/components/FieldRows.tsx:250-257` shows the "must be answered" control for any non-consent
field including type checkbox. So an organiser marks a confirmation question required, the applicant
sees a tick box carrying neither "Required" nor "Optional" while every neighbouring question carries
one, and only discovers the requirement by failing submission. A screen-reader user gets no
requirement state at all. Scope note: the acknowledgements block is deliberately uniform and
mandatory (`SPEC.md:104`; `FieldRows.tsx:123-127`, "A consent is a required checkbox by
definition"), so its lack of a chip is a decision, not a defect — the actionable case is the
admin-configured checkbox question.
**Repro:** As `EVENT-ADMIN` add a confirmation question of type checkbox with "must be answered"
ticked. As `SPK-ACCEPTED` open `/c/{cfpId}/submit`: every other question shows a Required/Optional
chip beside its label; the checkbox shows nothing and its input carries no `aria-required`. Submit
without ticking and the question is rejected server-side.
**Suggested fix:** Stop omitting `required` from `CheckboxProps`, render `<Requirement required>`
beside the label and set `aria-required` on the input, then forward `required: field.required` from
the checkbox branch in `SubmitPage.tsx:331-345`.
**Existing test:** `tests/fieldsAccessibility.test.ts:58-64` renders `Checkbox` without `required`,
so the gap is invisible to it; no e2e asserts a requirement chip on a checkbox question.

### M19 — Field errors are bound only through `aria-errormessage`

**Area:** ux-a11y-i18n
**Persona:** `SPK-DRAFT`
**Severity:** medium
**Location:** `src/components/fields.tsx:124`
**What:** Every control points `aria-describedby` at help and counter ids only and puts the error id
on `aria-errormessage`: TextField :124-125, TextAreaField :188-189 (`describedBy` is built from
`[helpId, metaId]` at :164, deliberately excluding `errorId`), SelectField :242-243, RadioGroup
:280-281 and :303-304, Checkbox :338-339. The error `<p>` itself (`FieldError`, :18-24) has no role
and is in no describedby chain.
**Why it matters:** `aria-errormessage` is not mapped by WebKit, and the handbook names "VoiceOver
with current Safari" as the `LENS-SCREENREADER` release-pass configuration (handbook:165). On that
configuration the applicant hears "Title, required, invalid data, edit text" and never the sentence
saying what is wrong, while the red text sits visibly beside the field. `A11Y-03` expects
"validation is associated with and announced from its controls" and `SPK-03` expects invalid data to
be "focused and explained in the current language" — `focusFirstInvalidField`
(`src/screens/SubmitPage.tsx:633-642`) delivers the focus but the explanation does not travel with
it. `docs/qa/voiceover-baseline.md` covers the reviewer deck only, not form validation.
**Repro:** Safari plus VoiceOver, `/c/{cfpId}/submit` as `SPK-DRAFT`. Submit an incomplete proposal.
Focus lands on the first invalid input. VoiceOver announces label plus "invalid data" but not the
message in `.field__error`; the same field on Firefox/NVDA does announce it, so the defect is
invisible in a Chromium accessibility-tree proxy pass.
**Suggested fix:** Append `errorId` to the `aria-describedby` list on all five controls, keeping
`aria-errormessage` for the engines that do map it. The existing test's "no burst of live alerts"
intent is unaffected, since describedby is not a live region.
**Existing test:** `tests/fieldsAccessibility.test.ts:72-82` asserts only that the referenced ids
exist in the markup, never that the error is reachable from the control's description.

### M20 — Photo file inputs are invisible but focusable, and their error is unassociated

**Area:** ux-a11y-i18n
**Persona:** `SPK-ACCEPTED`
**Severity:** medium
**Location:** `src/components/HeadshotField.tsx:173`
**What:** The `<input type="file">` at :173-185 is styled by `.headshot__input`
(`src/styles.css:2566-2578`: `position:absolute; width:1px; height:1px; clip-path: inset(50%)`) yet
left in the tab order — no `tabindex="-1"`, no `display:none`, and not wrapped in the visible
control, which reaches it via `input.current?.click()` (:157-168). The global `:focus-visible`
outline (`styles.css:825-828`) is painted on a 1px box that `clip-path` clips away. Separately the
error paragraph (:187-191) has `role="alert"` but no `id`, and the input has only `aria-invalid` —
no `aria-describedby`, no `aria-errormessage`. `src/components/SpeakerProfilePhoto.tsx:259-271` with
`.speaker-photo__input` (`styles.css:2452-2462`) repeats both defects.
**Why it matters:** Under `LENS-KEYBOARD` and the `A11Y-01`/`A11Y-03` "Focus remains visible" check,
an accepted speaker tabbing through the confirmation form hits a stop where focus vanishes, then a
second redundant stop on the visible "Choose a photo" button. When an upload is refused — wrong
type, too large, callable failure (:97-104, :130-131) — the message is announced once and is then
unreachable from the control it belongs to, so anyone who tabs back gets "invalid" with no reason.
The repo already has the right pattern: `src/components/CustomScheduleSpeakerPhoto.tsx:160-176`
nests the input inside a `<label class="btn">` so there is exactly one visible stop.
**Repro:** As `SPK-ACCEPTED` on `/c/{cfpId}/submit` with an image question, keyboard only: Tab past
"Choose a photo" — the next Tab lands on the hidden file input with no focus ring visible anywhere.
Then upload a `.txt` file: `.field__error` appears, but the focused input exposes only
`aria-invalid=true` with no described-by text.
**Suggested fix:** Wrap the input in the visible `<label class="btn">` as
`CustomScheduleSpeakerPhoto` does, or give it `tabIndex={-1}` and drop the duplicate button; and
give the error `<p>` an id referenced from the input's `aria-describedby`.
**Existing test:** `tests/e2e/profilePhoto.spec.ts` exercises upload, replace and remove; it asserts
no focus order and no error association.

### M21 — The schedule duration readout fails WCAG AA contrast in both themes

**Area:** ux-a11y-i18n
**Persona:** `EVENT-ADMIN`
**Severity:** medium
**Location:** `src/styles.css:388`
**What:** `.schedule-resize-inspector__value` sets `background: var(--g-blue)` (#4285f4, declared
once at `:root`, styles.css:59, with no dark-theme override) and `color: white` at
`font-size: var(--text-xs)` (0.75rem = 12px) with `font-weight: 800`. Recomputed contrast is
3.56:1. 12px bold is not WCAG large text — that starts at 18.66px bold — so the requirement is
4.5:1. Neither the dark block (:713-752) nor the `prefers-color-scheme` block overrides `--g-blue`.
**Why it matters:** This span (`src/screens/admin/Schedule.tsx:1714-1716`) is the only visible
readout of the value the admin is currently changing on the resize slider — the pill that says
"45 min". `ADM-08` requires the selected-session facts to stay readable at 320/390/768 and `A11Y-03`
expects "resize exposes useful value text"; a low-vision organiser dragging a session cannot read
the number they are setting. Screen-reader users are unaffected — the same control exposes
`aria-valuetext` (`Schedule.tsx:1705`) and prints the range in
`.schedule-resize-inspector__summary time` — so the failure is visual only.
**Repro:** Open `/c/{cfpId}/admin/schedule` as `EVENT-ADMIN`, select a session; the blue duration
pill renders white on #4285f4. Sample with any contrast checker in light theme and again in dark:
3.56:1 both times.
**Suggested fix:** Use `--accent` (#1769d2 light / #7cadf8 dark, with `--accent-fg`) instead of the
raw brand `--g-blue`, or raise the pill to `var(--text-sm)`/`var(--text-base)` so it qualifies as
large text.
**Existing test:** `tests/styles.test.ts` guards visited-link foregrounds only; there are no
contrast assertions anywhere in `tests/`.

### L1 — `roles.ts` documents a `transferCfp` path that does not exist

**Area:** backend-authz
**Persona:** `EVENT-OWNER`
**Severity:** low
**Location:** `functions/src/roles.ts:42`
**What:** The comment on `normalizeRole` (:41-43) states that owner "is written once, to whoever
created the CFP, and moves only through `transferCfp`". A repo-wide grep finds no `transferCfp`
anywhere — not a callable, script, test, or line in `SPEC.md` or the handbook. The same implication
appears at `functions/src/index.ts:509` ("Archiving, deleting and changing who owns a CFP are the
owner's alone"). Owner is written once and never moves at all.
**Why it matters:** A maintainer reading this file will believe ownership is transferable and will
not notice the dead end. Operationally, once the owning account is lost, that CFP can never be
archived, unarchived or deleted by anyone: `requireOwner` (index.ts:510-520) reads
`cfps/{cfpId}/members/{uid}`, `archiveCfp` (:3888) and `deleteCfp` (:3973) both use it, `revoke()`
refuses owners (roles.ts:243-245), `grant()` refuses owners (:150-152), and platform roles
deliberately grant no event access (`platform.ts:1-7`). No user-facing flow reaches this today —
the handbook's `EVENT-OWNER` row and `OWN-01`/`OWN-02` all assume a live owner — and it is
recoverable out of band by an Admin SDK write to `members/{uid}`, which is why this is low.
**Repro:** Owner O creates a CFP; O's account is later deleted. Admin A opens
`/c/{cfpId}/admin/settings`: the archive and delete controls are owner-only, and `archiveCfp`
answers `PERMISSION_DENIED`. A platform owner gets the same refusal, having no member document.
**Suggested fix:** At minimum correct the comment to say owner never moves, and name the out-of-band
remedy. Better, add the missing owner-transfer path — an owner-only callable that hands `owner` to
an existing admin and demotes itself in one transaction, keeping the CFP root's `ownerUids` in step
(read by `firestore.rules:114`, written only by `createCfp` at index.ts:3777).
**Existing test:** None found.

### L2 — A schedule entry's `proposalId` is interpolated into a document path unvalidated

**Area:** backend-authz
**Persona:** `EVENT-ADMIN`
**Severity:** low
**Location:** `functions/src/index.ts:6073`
**What:** `upsertScheduleEntry` builds `db.doc(\`cfps/${cfpId}/proposals/${id}\`)` from
`entry.proposalId` after `validateScheduleEntry`, but that validator only checks
`typeof entry.proposalId === 'string' && entry.proposalId.length <= 160`
(`shared/schedule.ts:388-390`) — no charset, and the empty string passes. Every other document id on
this surface is regex-checked: `entry.id` against `ENTRY_ID` (shared/schedule.ts:255, used at :370),
`removeScheduleEntry`'s `entryId` against an inline copy (index.ts:6105-6108), and co-speaker ids
against `DOCUMENT_ID` (`coSpeakers.ts:41`). The same unvalidated value is re-read into a path by
`shareSchedulePreview` (index.ts:6516+) and stored on the immutable release.
**Why it matters:** Tenancy is not breached — the `cfps/{cfpId}/` prefix is fixed and
`validateCfpId` guards the tenant segment — but the callable answers `internal` instead of
`invalid-argument`, and `AGENTS.md` forbids surfacing a caught error's message, so the admin sees a
bare generic failure. A slash-bearing value silently addresses a subcollection document that cannot
exist and produces a misleading refusal instead.
**Repro:** Call `upsertScheduleEntry` with `{cfpId, expectedRevision: n, entry: {id: 'e1', kind:
'proposal', proposalId: '', …}}`. `validateScheduleEntry` returns null, then `db.doc(...)` throws a
plain Error ("must point to a document … does not contain an even number of components"), so the
callable answers `internal`. With `proposalId: 'p1/speakerConfirmations/u1'` the path resolves to a
non-existent document and the admin instead gets "Only accepted or confirmed talks can be
scheduled." Expected: `invalid-argument` naming the bad proposal id.
**Suggested fix:** In `validateScheduleEntry`, check `proposalId` against the same `ENTRY_ID`-style
pattern already defined at `shared/schedule.ts:255` instead of a bare length test.
**Existing test:** `tests/schedule.test.ts:49-180` exercises `validateScheduleEntry` heavily but
never a malformed `proposalId`; `tests/e2e/schedule.spec.ts` and `scheduleUx.spec.ts` use real
proposal ids only.

### L3 — `emailQueue` action `resend` accepts a `logId` containing `/`

**Area:** backend-authz
**Persona:** `EVENT-ADMIN`
**Severity:** low
**Location:** `functions/src/index.ts:4384`
**What:** The `resend` branch takes `const logId = String(data.logId ?? '')` and only rejects the
empty string before building `db.doc(\`cfps/${cfpId}/emailLog/${logId}\`)` (:4399). The
`release`/`retry` branch of the same callable validates its ids properly —
`rawLogIds.some((id) => typeof id !== 'string' || !id || id.includes('/'))` at :4802 — against the
identical `log.doc(id)` use.
**Why it matters:** Admin-only and within tenant, so this is hardening rather than a boundary break;
the inconsistency inside one callable is what makes it worth fixing. An even-segment id such as
`a/b/c` resolves to an in-tenant nested document and yields "No such message."; an odd-segment id
such as `a/b` makes the Admin SDK throw and the organiser gets `internal` instead of the
`invalid-argument` the sibling branch produces.
**Repro:** Call `emailQueue` as an event admin with `{cfpId, action: 'resend', logId: 'a/b/c',
reviewedTo: 'x@example.org'}`, then again with `logId: 'a/b'`. Expected in both cases:
`invalid-argument`.
**Suggested fix:** Apply the same guard the sibling branch uses — reject a `logId` that is empty or
contains `/` right after it is read at :4384.
**Existing test:** None found. `tests/e2e/email.spec.ts:264-304, 1226-1257, 1299-1304` cover resend
with real log ids only.

### L4 — A plain reviewer can read any committee member's document, email included

**Area:** security-rules
**Persona:** `REVIEWER`
**Severity:** low
**Location:** `firestore.rules:126`
**What:** `allow get: if signedIn() && (memberUid == uid() || isReviewer(cfpId));` — the second
clause lets any role-holder fetch any other member document in the CFP. Member documents carry
`email` and `name` (written by `createCfp`, index.ts:3795-3801, and by `grantRole`; same shape in
the fixture at `tests/rules.test.ts:112-133`). This contradicts the comment directly above it
(:123-124, "seeing the whole committee is an admin matter") and the adjacent `roleGrants` rule
(:133-136), which is admin-only because it holds addresses. No client code needs the clause: the
only three `'members'` call sites in `src/` are `src/lib/roles.ts:387` (own document),
`:427` (admin listing) and `:625` (the collection-group query served by `firestore.rules:432-434`).
**Why it matters:** It makes the `list` denial cosmetic. A reviewer already learns other members'
uids — `loadReviewsFor` (`src/lib/reviews.ts:73`) returns `reviewerUid` once `reviewsVisible`
flips — so the addresses the `roleGrants` rule protects are reachable one document at a time by
exactly the role that is supposed to be denied them. The disclosure is committee-internal and cannot
be enumerated (list is denied and the uid must already be known), which is why this is low.
**Repro:** As `REVIEWER` on CFP-OPEN with `reviewsVisible = true`, open a proposal's committee
panel; `loadReviewsFor` returns the other reviewers' uids. For any such uid X, run
`getDoc(doc(db,'cfps',cfpId,'members',X))`. It succeeds and returns `{ role, name, email, uid,
cfpId }`. The same reviewer is denied `getDocs(collection(db,'cfps',cfpId,'members'))` and
`getDocs(collection(db,'cfps',cfpId,'roleGrants'))`.
**Suggested fix:** Narrow to `allow get: if signedIn() && memberUid == uid();` and add a rules test
mirroring `tests/rules.test.ts:897` for `get`.
**Existing test:** `tests/rules.test.ts:898` ("denies a plain reviewer listing the committee")
covers `list` only; `:890` covers `get` for an applicant, who holds no role at all.

### L5 — `confirmAnswers` is blocked on update but not on create

**Area:** security-rules
**Persona:** `SPK-DRAFT`
**Severity:** low
**Location:** `firestore.rules:238`
**What:** The create-time blocklist (:237-244) omits `confirmAnswers`, which the update-time
`touchesProtected()` list (:251-258) does include. Every other server-owned key appears in both, and
the remaining update-only entries (`cfpId`, `status`, `primarySpeakerId`, `speakerIds`) are
separately pinned by the create clauses at :232-236. So `confirmAnswers` is the one field a client
may write on `addDoc` and never again — and once planted it survives forever, because
`diff().affectedKeys()` never names a field the update does not change. `submitProposal`
(index.ts:1792) never touches it.
**Why it matters:** It defeats the stated invariant that `confirmAnswers` is written only after
validation against the confirmation form as it stands (the comment at index.ts:2362 says exactly
that). A planted map reaches admin surfaces that read it directly —
`src/screens/admin/Proposals.tsx:191-204` renders it, `src/screens/admin/proposalExport.ts:61,72`
exports it — so an organiser can be shown answers to questions that were never asked, on a proposal
that was never confirmed. A speaker can only forge their own answers on their own proposal, with no
privilege gain, which is why this is low. The neighbouring `headshotUploads` test shows the intended
pattern: it asserts both the update and the create are refused.
**Repro:** Signed in as `SPK-DRAFT` on CFP-OPEN: `addDoc(collection(db,'cfps',cfpId,'proposals'),
{ cfpId, speakerIds:[uid], status:'draft', title:'x', abstract:'x'.repeat(400), category:'app_dev',
format:'session_40', level:'intermediate', deliveryLanguage:'fr', confirmAnswers:{ shirt:'XXL' } })`.
The create succeeds; the equivalent `updateDoc` is refused. Open the admin proposals tab and the
fabricated answers render on a proposal that is still a draft.
**Suggested fix:** Add `'confirmAnswers'` to the create blocklist at :238-244, and extend
`tests/rules.test.ts:406` to assert the `addDoc` case as the `headshotUploads` test at :411 does.
**Existing test:** `tests/rules.test.ts:406-409` ("denies writing the confirmation answers
directly") asserts the update path only; `:411-430` asserts both paths for `headshotUploads`.

### L6 — All four composite indexes serve no query in the codebase

**Area:** security-rules
**Persona:** n/a
**Severity:** low
**Location:** `firestore.indexes.json:4`
**What:** The `indexes` array declares `proposals` composites on `status+category`,
`status+aggregate.normalizedScore`, `status+deliveryLanguage`, and `speakerIds CONTAINS +
updatedAt DESC` (:2-34). A composite index is only needed for a compound filter or an `orderBy` on
a different field. There is no `orderBy(` anywhere in `src/`, `shared/`, `functions/src/` or
`scripts/`, and every proposal query is single-field: `where('status','!=','draft')`
(`src/lib/roles.ts:467`), `where('status','in',[...])` (:555), `where('speakerIds','array-contains',
uid)` (`src/lib/proposals.ts:143`, `roles.ts:651`), and the server-side equivalents. `aggregate.
normalizedScore` is only ever read in memory (index.ts:3306,
`src/screens/admin/proposalExport.ts:207`). The `fieldOverrides` block is a different matter and is
complete — every collection-group query has its COLLECTION_GROUP entry.
**Why it matters:** Purely cleanup — nothing fails either way, and at CFP volumes the write
amplification and storage are negligible. What matters is that it is misleading: the next person
adding a proposals query will assume the sort orders declared here are supported and will not
check, which is the failure mode `AGENTS.md` warns about, since the emulator does not enforce
indexes.
**Repro:** `grep -rn 'orderBy(' src/ shared/ functions/src/` returns nothing, and every `.where(`
chain on `proposals` is single-clause. Deleting the four entries and running `npm run verify` plus
the e2e suite changes no behaviour.
**Suggested fix:** Delete the four unused entries from the `indexes` array, keeping `fieldOverrides`
intact. (`firestore.indexes.json` is strict JSON, so recording the intent in a comment is not an
option — put it in `AGENTS.md` if the entries are being reserved.)
**Existing test:** None. No test compares `firestore.indexes.json` against the queries in the
codebase, and the emulator does not enforce indexes.

### L7 — Profile saves are pinned to the stored email, locking out an auth email change

**Area:** security-rules
**Persona:** `SPK-DRAFT`
**Severity:** low
**Location:** `firestore.rules:457`
**What:** `allow update: if ownProfile() && request.resource.data.email == resource.data.email &&
…` compares the incoming email to the *stored* one, while `allow create` (:454) compares it to
`request.auth.token.email`. The client always sends the token value: `saveDraft` writes
`email: user.email ?? ''` on every autosave (`src/lib/proposals.ts:251-265`) and `saveProfile` does
the same (:339-348). If the account's provider email changes, the two diverge permanently and every
`speakers/{uid}` write is refused — and because `saveDraft` awaits the speaker write before touching
the proposal (:299-303), the talk autosave dies with it. `delete` is `if false` (:459), and no
callable writes an `email` field onto a speaker profile (every `functions/src` reference to
`speakers/{uid}` is a read).
**Why it matters:** It is a write dead end with no in-app recovery for a persona whose whole flow is
autosave, and the failure surfaces only as a mapped generic error. It also works against the stated
intent — the comment at `proposals.ts:255-256` says the email "comes from the identity provider" —
since the stored value can never follow it. The stale address is then what `email.ts` reads as the
delivery `to` (:362, :1212) and what `inviteCoSpeaker` matches an invitation against
(`coSpeakers.ts:541`). The trigger is narrow, which is why this is low: it needs an OAuth provider
whose primary address changes while the Firebase uid stays stable — an email-link user who changes
address gets a new uid and a fresh profile.
**Repro:** Sign in as `SPK-DRAFT` (Google) with address A; a draft autosaves and
`speakers/{uid}.email` is A. Change the Google account's primary address to B (uid unchanged) and
sign in again. Edit any field on `/me` or `/c/{cfpId}/submit`: the `setDoc` sends `email: B`, the
rule compares B to A, and the write is refused. Both the profile edit and the draft edit are lost,
and every subsequent save fails identically.
**Suggested fix:** Make the update clause match create —
`request.resource.data.email == request.auth.token.email` — and add a rules test that writes a
*different* email, per the `AGENTS.md` note that re-writing a seeded value proves nothing.
**Existing test:** `tests/rules.test.ts:950-995` ("allows ordinary profile saves but not forged
server photo pointers") re-saves an unchanged address; no test covers a changed token email.

### L8 — A failed published-schedule load says the session is not scheduled yet

**Area:** speaker-flow
**Persona:** `SPK-CONFIRMED`
**Severity:** low
**Location:** `src/screens/SubmitPage.tsx:846`
**What:** The published release is loaded with `loadPublishedSchedule(...).catch(() => null)` — the
failure is swallowed with no flag. The shared preview immediately below (:848-852) records
`{ value: null, failed: true }`, which drives `sharedScheduleFailed`, `scheduleUnavailable` and
`t.form.nextSteps.confirmedUnavailable` (:1991-1992, :2110-2115). There is no published-side
equivalent, and `src/lib/schedule.ts:117-135` also returns null for a missing release, so a network
failure is indistinguishable from "this proposal is not in the release".
**Why it matters:** When `sharedScheduleId === publishedScheduleId` — the normal state once a
preview has been promoted (`AGENTS.md:495-505`) — the shared branch is skipped entirely, so a failed
read makes `publishedEntry` undefined and the banner renders `t.form.statusHelp.confirmed` plus
`nextSteps.confirmedWaiting` ("Your own placement will appear here after organisers share a
confirmed preview") to a speaker whose session is already on the public programme. That is the
contradiction `SPK-10` forbids, and it offers no reload guidance, unlike the shared-preview path.
The trigger is narrow — `loadPublishedSchedule` sits in the same `Promise.all` as
`loadMyProposals`, so any non-selective outage takes the whole load into the reload panel
(:1781-1791) instead — which is why this is low.
**Repro:** Seed `SPK-CONFIRMED` with a placement in a published release and no newer shared pointer.
Open `/c/{cfpId}/submit` with the `scheduleReleases/{releaseId}` read forced to fail. Observed:
"Wait for the working schedule / Your own placement will appear here after organisers share a
confirmed preview". Expected: the same reload guidance the shared-preview failure gives.
**Suggested fix:** Track the published load failure the same way as `sharedResult.failed` and route
it into the existing `scheduleUnavailable`/`confirmedUnavailable` copy.
**Existing test:** `tests/e2e/schedule.spec.ts:882-889` aborts `**/getSharedSchedule` only; nothing
covers a failed published-release read.

### L9 — A co-speaker on a draft is told "Finish and submit your proposal"

**Area:** cospeaker-flow
**Persona:** `SPK-DRAFT`
**Severity:** low
**Location:** `src/screens/SubmitPage.tsx:1972`
**What:** `lifecycleNext` picks `t.form.nextSteps.draft` ("Finish and submit your proposal — Your
draft is private. Complete the required sections, then submit it before the deadline.",
`src/i18n/en.ts:624`) purely from `speakerStatus === 'draft'`, with no reference to `isCoSpeaker`
(:756-758), and `ProposalJourney` renders it unconditionally (:2034). The Submit button is correctly
hidden for a co-speaker (:2538) and `onSubmit` returns early for them (:1553), so the instruction
names an action that does not exist on their page.
**Why it matters:** `StatusBanner` — the one place carrying `t.coSpeakers.personalEditHelp` (:610) —
is rendered only when `speakerStatus !== 'draft'` (:2057), so a freshly joined co-speaker gets no
co-speaker framing above the fold. Disabled talk fields under a "submit it before the deadline"
heading read as a broken page rather than a role boundary. The correct instruction is present
further down — `t.coSpeakers.yourSetupTitle`/`yourSetupHelp` render via `pendingBlocksSubmit`
(`src/components/CoSpeakerRoster.tsx:541-557`) and the co-speakers step is flagged in the progress
rail — which is why this is low.
**Repro:** Lead invites a co-speaker on a draft in CFP-OPEN. The co-speaker accepts and is routed
into `/c/{cfpId}/submit`. The journey rail's next step reads "Finish and submit your proposal /
Complete the required sections, then submit it before the deadline", every talk field is disabled,
and there is no Submit button anywhere on the page.
**Suggested fix:** Branch `lifecycleNext` on `isCoSpeaker` for the draft case and use co-speaker copy
naming their real task, reusing the wording in `t.coSpeakers.yourSetupTitle`/`yourSetupHelp`.
**Existing test:** None found; no test asserts this copy for a co-speaker.

### L10 — Review-workspace failures show applicant copy

**Area:** reviewer-admin-flow
**Persona:** `REVIEWER`
**Severity:** low
**Location:** `src/screens/ReviewPage.tsx:265`
**What:** `ReviewPage` imports only `friendlyError` (:25) and maps every failure through it — the
queue load at :154, a failed save at :265, and :971. That is the applicant-facing mapper:
`failed-precondition` → `t.errors.notOpen` ("The call for proposals is not open right now.") and
`permission-denied` → `t.errors.readOnlyNow` ("This can no longer be edited — the call may have
closed, or your proposal is already submitted.") (`src/lib/errors.ts:35-40`). `saveReview` throws
`failed-precondition` when the proposal has left `REVIEW_QUEUE_STATUSES` (index.ts:3142-3144) or the
CFP is archived (:3130), and `permission-denied` when membership has been revoked (:3133). None of
those concern the reviewer's own proposal or the submission window.
**Why it matters:** `REV-06` is exactly the flow the handbook keeps as manual focus ("failed-save
recovery and proposal-specific retry wording"). The reviewer is told about their own proposal and
the submission window while reviewing someone else's talk after the window has deliberately closed —
the same screen says "Proposals are closed" two sections above. This is copy-only: the recovery
banner does *not* persist, since `setFailures(new Map())` runs on every load (:94 and :148) and the
offending proposal drops out of the deck anyway on reload
(`src/lib/roles.ts:551-557` queries only submitted/under_review).
**Repro:** As `REVIEWER` open `/c/{cfpId}/review`, then have `EVENT-ADMIN` accept the proposal on
screen. Press `3`. `saveReview` rejects with `failed-precondition`; the recovery banner shows the
proposal title and "The call for proposals is not open right now." with a Retry save button. The
same path with revoked membership yields "…or your proposal is already submitted."
**Suggested fix:** Add a committee-side mapper beside `adminError` in `src/lib/errors.ts` —
`failed-precondition` → "this proposal has left the review round / the event is archived",
`permission-denied` → "your committee access has been removed".
**Existing test:** `tests/e2e/deck.spec.ts:195-227` ("a failed score save keeps its exact proposal,
note, and score for retry") injects a transport failure only and does not assert message text.

### L11 — Admin decision vocabulary and review-queue statuses are duplicated as literals

**Area:** reviewer-admin-flow
**Persona:** n/a
**Severity:** low
**Location:** `src/screens/admin/Proposals.tsx:52`
**What:** `ADMIN_PROPOSAL_STATUSES` is declared verbatim at `src/screens/admin/Proposals.tsx:52` and
again at `functions/src/index.ts:4178-4183`; the review-queue set is declared as
`REVIEW_QUEUE_STATUSES` at `functions/src/index.ts:3084` and repeated as an inline array at
`src/lib/roles.ts:555` (and again at `functions/src/email.ts:449`,
`src/screens/admin/Overview.tsx:320`). Neither grouping is in `STATUS_SETS`
(`shared/enums.ts:77-94`), which is compiled into both bundles and whose own comment says it exists
because these groupings "were drifting apart across the form, the callables and the admin screen".
**Why it matters:** This is the same drift re-introduced. Adding a status the committee may set, or
widening the review queue, requires editing two files that nothing links; the client copy decides
which options a user is offered while the server copy decides which are accepted, and the mismatch
between them is the direct cause of H4.
**Repro:** Add a status to `functions/src/index.ts:4178` without touching
`src/screens/admin/Proposals.tsx:52` (or the reverse): the build and all tests pass while the select
offers a status the callable rejects, or accepts one the UI never shows.
**Suggested fix:** Move both groupings into `STATUS_SETS` and import them from `index.ts`,
`Proposals.tsx` and `roles.ts`. Note that `STATUS_SETS.decidable` (`shared/enums.ts:87`) already
exists, has no consumer anywhere in the repo, and is a *different* set from the admin-settable four,
so this needs a new correctly named entry rather than reusing `decidable`.
**Existing test:** `tests/e2e/roles.spec.ts:311-315` ("a status outside the committee's vocabulary
is refused") pins the server list only; nothing ties the client list to it.

### L12 — `/platform` denial has no "check access again" recovery, unlike `/new`

**Area:** platform-flow
**Persona:** `PLATFORM-ADMIN-TARGET`
**Severity:** low
**Location:** `src/App.tsx:597`
**What:** The `route === 'platform'` gate (:597-605) renders a bare panel containing only
`t.nav.forbidden` ("That page is not available to your account.") and an "All calls" button. The
sibling gate for `/new` two branches above (:589) renders `PlatformCreationRestricted` (:778-793),
which explains what platform access is and offers `checkAgain` wired to `retryPlatform`. The
`/platform` branch offers neither, though `retryPlatform` is already in scope on the same props
object.
**Why it matters:** `PLATFORM-ADMIN-TARGET` and `PLATFORM-CREATOR-TARGET` reach `/platform` exactly
when their grant is being created (`PLT-03`, `PLT-04`). `usePlatformAccess`
(`src/lib/roles.ts:83-99`) only refetches when `uid` or `attempt` changes, so once the denial is on
screen a newly claimed grant is invisible until a reload. The product's tested recovery path is
`/new` — `tests/e2e/platformAccess.spec.ts:88-96` walks exactly that — and
`src/screens/HomePage.tsx:265-273` offers the same button, so the recovery exists one navigation
away. The `/platform` link is also rendered only for `isPlatformAdmin` (`HomePage.tsx:245`), so a
denied user reaches it only by typing the URL. Hence low.
**Repro:** Seed `PLATFORM-ADMIN-TARGET` (verified, no platform role). Open `/platform`: the panel
reads "That page is not available to your account." with a single "All calls" button. As
`PLATFORM-OWNER`, run `grantPlatformAdmin` for that address. Back in the target's tab, nothing on
the page can re-check access.
**Suggested fix:** Render the same `PlatformCreationRestricted`-shaped panel for the `/platform`
denial, or factor the two gates into one component parameterised by the copy.
**Existing test:** `tests/e2e/platformAccess.spec.ts:87` asserts only that the denial sentence is
visible; nothing asserts a recovery control on that route.

### L13 — `set-platform-admin.mjs --remove` refuses to revoke a pending owner grant

**Area:** platform-flow
**Persona:** `PLATFORM-OWNER`
**Severity:** low
**Location:** `scripts/set-platform-admin.mjs:111`
**What:** The last-owner guard (:111-117) fires on `touchesRole && otherUsable.length === 0`, where
`touchesRole` is true when the removal touches *either* a member document *or* a pending
`platformRoleGrants` row (`removesPending`, :107), while `otherUsable` (:108) counts only active
`platformMembers` documents whose uid maps to a usable Auth account. During bootstrap there is by
definition no active owner, so removing a pending owner grant — which is not an owner at all, only
an unclaimed invitation — is rejected with "Refusing to remove the last platform owner." and
`tx.delete(grant)` at :127 never runs. The `role === 'admin'` branch at :118 has the same shape.
**Why it matters:** `--role owner` is documented as the only path for platform-owner changes, and its
very first use is typing an email by hand with no owner yet in the system. A typo leaves
`platformRoleGrants/{typo}` with role owner and no supported way to remove it: whoever can verify
that address becomes a platform owner on first sign-in (`functions/src/platform.ts:85`). The escape
is the bootstrap step the operator is already performing — once the intended owner signs in and
becomes an active member, `otherUsable` is non-empty and the typo grant deletes cleanly — but the
script does not say so. Deleting an unclaimed grant grants nobody anything, so this is
ops/correctness rather than security. `AGENTS.md:83-87` only promises the script "transactionally
refuses to remove the last active owner", which a pending grant is not.
**Repro:** On a fresh project with no `platformMembers`: `GCLOUD_PROJECT=p node
scripts/set-platform-admin.mjs --email typo@wrong-domain.example --role owner` → "Platform owner
pending verified sign-in". Then the same command with `--remove` → exits 1 with "Refusing to remove
the last platform owner." and the grant document survives.
**Suggested fix:** Scope the guard to removals that actually delete an active owner member document —
compute the refusal from `matchingMembers.length > 0` rather than from `touchesRole` — and always
allow deleting an unclaimed grant.
**Existing test:** `tests/e2e/platformBootstrap.spec.ts:133-160` covers the adjacent case (it even
seeds `possibly-mistyped-owner@example.org` as a pending grant, then removes the *active* owner) but
never removes the pending grant itself.

### L14 — Address errors on the create form are not associated with the address field

**Area:** platform-flow
**Persona:** `PLATFORM-CREATOR`
**Severity:** low
**Location:** `src/screens/NewCfpPage.tsx:249`
**What:** All create-form faults — `taken`, `idFormat`, `idLength`, `nameEmpty`, `dates`, `limit`,
`unverified` — are funnelled into one `error` string rendered as a single `create-form__error`
paragraph (:249-253) immediately above the submit button, after three form sections and two asides.
The Address input (:139-150) is a `TextField`, which already accepts an `error` prop and wires
`aria-invalid` and `aria-errormessage` to it (`src/components/fields.tsx:102-125`); that prop is
never passed, and focus is not moved to the offending field. The file's own header comment (:5-7)
states that `already-exists` "is shown against the address field, which is where the fix is".
**Why it matters:** `PLT-02`'s whole failure mode is a slug collision or a slug the platform would
not issue. Nothing marks which of the two identity fields is wrong, and a screen-reader user gets no
association between the message and the control. The rest of the codebase is field-level
(`SubmitPage.tsx:2150-2202`, `CoSpeakerInvitation.tsx:434-478` all pass `error=`), so this screen is
the outlier. Impact is limited because the paragraph carries `role="alert"` and sits beside the
button just pressed, which is why this is low.
**Repro:** As `PLATFORM-CREATOR` open `/new`, enter a name whose derived slug already exists, press
"Create it". "That address is taken. Try another." appears just above the button at the foot of the
form; the Address field at the top is unmarked, is not `aria-invalid`, and does not receive focus.
**Suggested fix:** Keep a separate address-scoped error and pass it to the Address `TextField`'s
`error` prop, moving focus there, and leave the form-level paragraph for faults that are not about
one field such as `limit` and `dates`. Correct the stale header comment either way.
**Existing test:** `tests/e2e/platform.spec.ts:245-255` ("an address already taken is refused, and
says so") asserts only that the alert text appears anywhere on the page.

### L15 — Missing public session deep link says "We could not find that proposal."

**Area:** schedule-flow
**Persona:** `ANON-PUBLIC`
**Severity:** low
**Location:** `src/screens/SchedulePage.tsx:404`
**What:** When a `/c/{cfpId}/schedule/{entryId}` deep link resolves to an entry that is not in the
current release, the page renders `t.errors.notFound` — "We could not find that proposal."
(`src/i18n/en.ts:2002`) / "Cette proposition est introuvable." (`src/i18n/fr.ts:2034`). The same key
is used elsewhere only in admin surfaces (`Settings.tsx:103`, `Overview.tsx:182`,
`src/lib/errors.ts:41`), where "proposal" is the correct noun.
**Why it matters:** The handbook's per-page contract requires the primary next action to be
understandable without implementation terms, and this is the one schedule screen whose audience is
anonymous attendees. "Proposal" is submission-pipeline vocabulary that appears nowhere else on the
attendee-facing programme, which says "session" and "programme" throughout. The state is reachable
for any visitor holding an id from an older release or an older `.ics`, since the bundle comes from
`loadPublishedSchedule` for the current release only (:185-186). The recovery action is already
correct — the same line renders a "Back to the programme" link — so only the noun is off-register.
**Repro:** As `ANON-PUBLIC` open `/c/{cfpId}/schedule/{id-not-in-the-current-release}` on an event
with a published programme. Observed: "We could not find that proposal." with a "Back to the
programme" button. Expected: session-oriented wording, e.g. "That session is not on the current
programme."
**Suggested fix:** Add a dedicated `t.schedule.sessionNotFound` string in both locales and use it
here instead of the shared `t.errors.notFound`.
**Existing test:** None found; no test asserts this string.

### L16 — Server-authored English failure prose renders verbatim in the French log

**Area:** email
**Persona:** `EVENT-ADMIN`
**Severity:** low
**Location:** `src/screens/admin/Email.tsx:761`
**What:** The Outcome cell appends `row.error` unconditionally (:759-762), copied straight from the
stored field (index.ts:4718-4720). That field carries not only Resend's own text — which the
adjacent comment justifies showing as-is — but also sentences this codebase writes itself:
`supersededEmailUpdate`'s defaults "This notification is superseded." (`functions/src/email.ts:711`),
"…because the event was deleted." (:747-748), "…because the event is archived." (:756-757), and
"Email delivery is blocked because this sending domain is not assigned to the event." (:1284-1286).
None have i18n keys, so they render in English regardless of locale.
**Why it matters:** `AGENTS.md:154` is explicit that user-facing strings live in `src/i18n/` and that
`fr` is typed against `en` so a missing translation fails the build — this path routes around that
guarantee by shipping copy through Firestore. The handbook runs the email workspace in French under
`LOC-03` and lists "no caught backend error text reaches the user" as a per-page check. Mitigating:
this cell is an admin-only diagnostic that already shows untranslated third-party English by
explicit design (index.ts:4719-4720, Email.tsx:759-761); only four self-authored sentences ride the
same channel, which is why this is low.
**Repro:** Switch the admin workspace to French at `/c/{cfpId}/admin/email` with a CFP whose
`config/email` has a `from` but whose domain binding is missing. Queue any automatic mail. Observed
in Delivery history: "Échec — Email delivery is blocked because this sending domain is not assigned
to the event."
**Suggested fix:** Store a stable machine code on the row alongside the provider text (e.g.
`errorReason: 'superseded' | 'archived' | 'deleted' | 'domain_unbound'`) and have `Email.tsx`
translate that code, falling back to the raw provider string only when no reason is set. Note that
`tests/e2e/email.spec.ts:182, 212` and `coSpeakersLifecycle.spec.ts:1862` assert the stored English
string and would need updating.
**Existing test:** None found for the rendering; the tests above assert the stored value only.

### L17 — The server-rendered public routes have no error boundary

**Area:** frontend-correctness
**Persona:** `ANON-PUBLIC`
**Severity:** low
**Location:** `src/app/c/[cfpId]/page.tsx:76`
**What:** `src/app` contains no `error.tsx`, `global-error.tsx` or `not-found.tsx` — only
`layout.tsx`, `robots.ts`, `sitemap.ts`, `[[...slug]]/{page,ClientApp}.tsx` and the three
`c/[cfpId]` pages. `ErrorBoundary` is mounted inside `ClientApp`
(`src/app/[[...slug]]/ClientApp.tsx:65`), i.e. below the client boundary, so it cannot catch a throw
from the server component above it. `readCfp` (`src/server/publicCfps.ts:112-115`) and
`readPublishedSchedule` (:140-148) are unguarded awaits, and `db()` (:25-38) calls
`initializeApp({ credential: applicationDefault() })`, which throws when credentials are
unavailable. All three routes are `force-dynamic` (`src/app/c/[cfpId]/page.tsx:26`), so every request
re-runs them.
**Why it matters:** A Firestore `unavailable`, a permissions blip, or missing ADC on the App Hosting
backend turns `/c/{cfpId}`, `/c/{cfpId}/schedule` and `/c/{cfpId}/schedule/{entryId}` into Next's
default error page — no branding, no locale, no recovery action — and a link unfurler gets a 500
with no meta tags. Every other failure path in the app is handled deliberately (`App.tsx:631`,
`ReviewPage:357`, `Overview:203`), so this is the one hole. The only trigger is an infrastructure or
credentials failure outside the app's control, and in most such cases the browser SDK path degrades
too, which is why this is low.
**Repro:** Run with the Firestore backend unreachable, or revoke the runtime service account's
Datastore access, and request `/c/devfest-mtl-2026`. Observed: Next's unstyled default error page
with a digest string in place of the CFP front page.
**Suggested fix:** Add an `error.tsx` (and ideally `global-error.tsx`) under `src/app` rendering the
same panel wording as `t.errors.unavailable` plus a reset button, and/or wrap the
`readCfp`/`readPublishedSchedule` calls so a read failure degrades to the existing client-side
`cfpError` path rather than throwing.
**Existing test:** None found. `tests/e2e/cfpPage.spec.ts` covers the success and unlisted paths
only.

### L18 — `check-bundle` asserts only one of the two guarded `devAuth` call sites

**Area:** frontend-correctness
**Persona:** n/a
**Severity:** low
**Location:** `scripts/check-bundle.mjs:48`
**What:** The emulator-sign-in invariant is enforced by a single regex,
`/installTestSignIn\s*\(\s*\)/`, and the comment above it says the guard lives at "its one call
site" (the final log says "both invariants hold"). There are two `import('./lib/devAuth')` call sites
in `src/App.tsx`: :209 (`m.installTestSignIn()`, covered) and :1059
(`m.signInAsTestSpeaker()`, inside the `process.env.NEXT_PUBLIC_USE_EMULATORS === 'true'` JSX guard
at :1054, not covered).
**Why it matters:** `AGENTS.md:184` states the invariant as "no live call to the emulator sign-in",
and `devAuth` is emitted as a chunk regardless. If the second guard ever stops folding — someone
tidies it to read the shared `USE_EMULATORS` constant, as `src/lib/env.ts:37` warns against —
`npm run verify` still passes while the production bundle ships a live "Sign in as a test speaker
(emulator only)" button and a reachable `signInWithCredential` path. No current exposure exists:
both call sites use the folding literal form today. The actionable part is the missing assertion and
the comment claiming one call site.
**Repro:** Change `process.env.NEXT_PUBLIC_USE_EMULATORS === 'true'` at `src/App.tsx:1054` to the
imported `USE_EMULATORS`, then run `npm run build && npm run check:bundle`. Observed: the check
passes while the emitted chunk still contains the `signInAsTestSpeaker()` call and renders the
button.
**Suggested fix:** Add a second assertion for `signInAsTestSpeaker\s*\(` (excluding the `window.`
assignment inside `devAuth`'s own chunk — better still, assert that no executing chunk references
`lib/devAuth`'s exports at all), and correct the comment to say two call sites.
**Existing test:** `scripts/check-bundle.mjs` is itself the test; it is invoked by `npm run verify`
and asserts only `installTestSignIn()`.

### L19 — The programme photo loader keys its effect on a translated string

**Area:** frontend-correctness
**Persona:** `EVENT-ADMIN`
**Severity:** low
**Location:** `src/components/CustomScheduleSpeakerPhoto.tsx:83`
**What:** The effect that fetches the private photo bytes lists
`t.schedule.customSpeakerPhotoLoadFailed` in its dependency array purely because the catch branch
reads it (:74). Every other loader in the codebase routes the dictionary through `useLatest` or a ref
for exactly this reason — `src/screens/admin/Settings.tsx:31` plus the seven "Keyed on the call, not
on the loader's identity" comments in `ReviewPage.tsx:164`, `Committee.tsx:108`, `Settings.tsx:172`,
`Confirmation.tsx:33`, `Submission.tsx:33`, `Proposals.tsx:885`, `EmailSetup.tsx:110`.
**Why it matters:** `AGENTS.md:174` states the rule flatly: never put the dictionary in a data
loader's dependency list. When the string changes, the effect re-runs `setChanged(false)`,
`setProblem('')` and a fresh `customScheduleSpeakerPhotoImage` callable per speaker photo, revoking
and recreating each object URL. Today the `pendingAssetRef` guard (:48-56) happens to save the
unsaved-photo state, so the damage is a visible flicker plus one privileged image callable per photo
per language switch — but the guard is incidental, and the next edit to this effect inherits the
documented bug.
**Repro:** Open `/c/{cfpId}/admin/schedule` as an event admin, edit a custom programme item with two
or more speaker photos, then click the `Français` button in the header. Observed: each photo preview
blanks and re-resolves, with one `customScheduleSpeakerPhotoImage` call per speaker in the network
log, for a change that alters no stored data.
**Suggested fix:** Read the failure message through a ref (`useLatest(t)`) as every other loader
here does, and key the effect on `[cfpId, photoAssetRef, showPreview]`.
**Existing test:** None found. `tests/e2e/customSchedulePhoto.spec.ts` covers upload, replacement and
release freezing, not a locale switch.

### L20 — Route changes produce no announcement

**Area:** ux-a11y-i18n
**Persona:** `ANON-PUBLIC`
**Severity:** low
**Location:** `src/App.tsx:436`
**What:** `goTo` (`src/lib/router.ts:121-128`) calls `window.history.pushState` directly and
re-dispatches a synthetic `popstate`; no `next/link`, `next/router` or `next/navigation` import
exists anywhere in `src/`, so `#__next-route-announcer__` stays empty for every in-app navigation.
The app's only substitute is `document.getElementById('main-content')?.focus()` on `placeKey` change
(:239-250), and that `<main id="main-content" tabIndex={-1}>` (:436-440) carries no
`aria-label`/`aria-labelledby`. `document.title` is recomputed at :177, but a title change is not
announced in a same-document navigation, and none of the 13 `aria-live` regions in `src/` is a route
announcer.
**Why it matters:** The handbook's per-page contract requires "Route changes produce one meaningful
announcement" (handbook:93) and `A11Y-01` expects the announcement to "name the new task once". A
screen-reader user who activates Schedule, Review talks or Manage event hears only "main" (or, on
NVDA, the whole new page from the top) with no statement of where they now are. Moving focus into
the new content is an accepted technique and a single `<main>` needs no accessible name under WCAG,
so the missing piece is a spoken destination rather than broken focus management — hence low.
**Repro:** VoiceOver plus Safari on `/c/{cfpId}`: activate the "Schedule" tab. The URL and the
visible h1 change; the spoken output is the unnamed main landmark. Repeat for "My proposals" and
"Manage event" — identical announcement, and `#__next-route-announcer__` never receives text.
**Suggested fix:** Either give `<main>` `aria-label={documentTitle(place, cfpName, t)}` (or
`aria-labelledby` pointing at the header h1) before moving focus to it, or add an always-mounted
visually-hidden `aria-live="polite"` element that the `placeKey` effect writes the new task label
into.
**Existing test:** `tests/e2e/navigation.spec.ts` asserts breadcrumbs, tabs and `aria-current` across
routes; no announcement or landmark-name assertion.

### L21 — `--g-red` as text on its own tint fails WCAG AA across the email chrome

**Area:** ux-a11y-i18n
**Persona:** `EVENT-ADMIN`
**Severity:** low
**Location:** `src/styles.css:5954`
**What:** Three rules paint `--g-red` (#ea4335) as text on a near-surface background, all below
4.5:1 in light theme: `.subnav__badge--attention` (:5951-5955, on
`color-mix(in srgb, var(--g-red) 16%, var(--surface))` — 3.17:1 light, 3.82:1 dark, at 12px/800
inherited from `.subnav__badge` :2288-2301); `.pending-email-notice--attention
.pending-email-notice__eyebrow` (:5947-5949 over the panel background at :5933-5936 — 3.53:1 light,
4.16:1 dark, 12px/800 per :6000-6007); and `.email-attention-card--active
.email-attention-card__count` (:3635-3638 on `var(--surface)` — 3.92:1 light, 4.45:1 dark, at
`--text-lg` regular). The `:root` comment at :58 says the four DevFest colours are "never
load-bearing alone".
**Why it matters:** These are the signals telling an event admin that messages are stuck
(`src/screens/AdminPage.tsx:333, 378`; `src/screens/admin/Email.tsx:541`). `ADM-06`'s manual focus is
that "pending mail is conspicuous". Red is also the worst colour to lean on for a colour-vision-
deficient reader. Mitigating: nothing is conveyed only by the failing text — the subnav badge is
`aria-hidden` with the count carried in the tab's own `aria-label` (`AdminPage.tsx:325-336`), and the
eyebrow sits directly above an h3 in `--fg` saying the same thing (:378-381) — so this is a genuine
AA failure on decorative-emphasis copy rather than an information barrier.
**Repro:** Seed an `EVENT-ADMIN` tenant with at least one email row needing attention, open
`/c/{cfpId}/admin/proposals` in light theme, and sample the red count badge against its pink pill:
3.17:1. Same for the eyebrow (3.53:1) and the Email screen's attention count (3.92:1).
**Suggested fix:** Use `var(--error)` (#c0271f light / #f2938b dark, already theme-tuned,
styles.css:40 and 731) for these three foregrounds and keep `--g-red` for borders and rules.
**Existing test:** None. `tests/styles.test.ts` has no contrast coverage; `tests/e2e/roles.spec.ts`
and `polish.spec.ts` assert the badge is present, not that it is readable.

### L22 — Every social-link row exposes the same three accessible names

**Area:** ux-a11y-i18n
**Persona:** `SPK-DRAFT`
**Severity:** low
**Location:** `src/components/SocialsInput.tsx:63`
**What:** Each repeated row renders `aria-label={t.speaker.platform}` ("Platform", :39),
`aria-label={t.speaker.handle}` ("Handle or URL", :52) and a bare `{t.speaker.removeSocial}`
("Remove", :63). The rows live in a plain `<div className="socials__row">` (:33) inside a
`<div className="field">` — not a list — so there is no positional context, and removal
(:21) is immediate with no confirmation.
**Why it matters:** With `LIMITS.maxSocials` links filled in, a screen-reader user's form-controls
rotor reads "Platform, Platform, Platform / Handle or URL, Handle or URL, Handle or URL / Remove,
Remove, Remove" and cannot tell which Remove deletes their GitHub. The repo already solves this
elsewhere: `src/components/FieldRows.tsx:125` and `:138` build `${labels.labelEn} — ${which}` and
`:153/163/171` use `t.admin.moveUpOf/moveDownOf/removeOf(which)`, with a comment at :92-93 explaining
why ("'Remove field 3' is not something anyone can check"). `SPK-01` exercises this editor.
**Repro:** Sign in as `SPK-DRAFT`, open `/me`, add three links. List the form controls with a screen
reader: nine controls, three distinct names, no row identification.
**Suggested fix:** Render the rows as an `<ol>` and qualify each control's accessible name with the
row's platform or handle, mirroring `t.admin.removeOf(which)` — e.g. add
`t.speaker.removeSocialOf(name)` and `t.speaker.handleOf(name)` to both dictionaries.
**Existing test:** None found. `tests/e2e/profile.spec.ts` fills socials by position, never by
accessible name.

### L23 — Hardcoded English "(priority N)" in the DNS records table

**Area:** ux-a11y-i18n
**Persona:** `EVENT-ADMIN`
**Severity:** low
**Location:** `src/components/EmailSetup.tsx:277`
**What:** ``{r.priority !== undefined && ` (priority ${r.priority})`}`` is an English literal built
in JSX rather than looked up in `src/i18n/`. There is no `priority` key in either dictionary, while
the surrounding column headers (:265-267) are all translated.
**Why it matters:** `AGENTS.md:154` states user-facing strings live in `src/i18n/` and that `fr` is
typed against `en` so a missing translation fails the build — this string sidesteps that guarantee
entirely. A French organiser following the DNS instructions in the `LOC-03` flow reads "(priority
10)" in the middle of otherwise fully translated MX-record guidance.
**Repro:** Set the interface to French, open `/c/{cfpId}/admin/email` as `EVENT-ADMIN` with an
unverified sending domain whose records include an MX entry. The value cell reads
`feedback-smtp.… (priority 10)`.
**Suggested fix:** Add an `admin.emailDnsPriority: (n: number) => …` key to `en.ts` and `fr.ts` and
call it here, so the build enforces the French copy.
**Existing test:** None found. `tests/e2e/email.spec.ts` covers domain setup but not the record
table's copy.

### L24 — English copy says "release" where the French says "version"

**Area:** ux-a11y-i18n
**Persona:** `EVENT-ADMIN`
**Severity:** low
**Location:** `src/i18n/en.ts:1809`
**What:** `schedule.takeOfflineKept` reads "The private draft, shared preview, and release history
stay intact." Its French counterpart (`src/i18n/fr.ts:1839-1840`) reads "…et l'historique des
**versions** restent intacts". The same mismatch is at `src/i18n/en.ts:1382` ("until you share and
publish a new release") versus `src/i18n/fr.ts:1403` ("jusqu'à la publication d'une nouvelle
version"). The UI's own vocabulary for the concept is "Version" (`schedule.versionLabel`,
en.ts:1766 / fr.ts:1796), and the three stage cards and `releaseFlow` copy never use "release" as a
noun.
**Why it matters:** The handbook (:88-89) names "release" among the implementation terms that must
not be required to understand the next action, and "release" is the internal name of the
`scheduleReleases` documents (`AGENTS.md:496-505`). The two dictionaries also disagree on what the
same object is called, so an organiser switching languages mid-task (`LENS-BILINGUAL`, `LOC-03`) is
told two different words for the thing they are about to keep or discard — inside a destructive
confirmation dialog (`src/screens/admin/Schedule.tsx:2486`).
**Repro:** As `EVENT-ADMIN` on `/c/{cfpId}/admin/schedule` with a published programme, press "Take
offline". In English the dialog says "release history"; switch to French and reopen — "historique des
versions".
**Suggested fix:** Reword the two English strings to match the product vocabulary the French already
uses: "version history", and "share and publish a new version". Confine the change to those two
strings — the email domain's "release"/"Waiting for release" (en.ts:1138, 1164, 1195, 1288) is
intentional verb-sense vocabulary, not the same term.
**Existing test:** None found. `tests/e2e/scheduleUx.spec.ts` asserts the stale-version guidance
flow, not its wording.

### L25 — Score histogram's accessible name is an untranslated string of bare numbers

**Area:** ux-a11y-i18n
**Persona:** `EVENT-ADMIN`
**Severity:** low
**Location:** `src/components/charts.tsx:63`
**What:** `ScoreHistogram` is `role="img"` with
``aria-label={counts.map((n, i) => `${i + 1}: ${n}`).join(', ')}`` — the whole accessible name is
e.g. "1: 4, 2: 9, 3: 6, 4: 2", assembled in TSX with no `src/i18n/` involvement and no statement of
what either number is. `role="img"` prunes the subtree, so the inner `<text>` ticks and counts
(:79-84) are not exposed. The sibling `StackedBar` in the same file does it correctly, pointing
`aria-labelledby` at a rendered, translated legend (:104, :116-125).
**Why it matters:** The handbook's per-page contract requires images and status content to have
useful accessible names. Under the "Score distribution" heading
(`src/screens/admin/Proposals.tsx:454`) a screen-reader user hears a list of colon-separated
integers with no indication which side is the score and which the count, and the string never
changes with locale. The translated heading provides some context, which is why this is polish.
**Repro:** Open `/c/{cfpId}/admin/proposals` as `EVENT-ADMIN` with reviews recorded and read the
Scores chart with a screen reader: "1: 4, 2: 9, 3: 6, 4: 2, image". Compare with the Decisions chart
beside it, which reads out its labelled legend.
**Suggested fix:** Build the label from a dictionary function (e.g. `t.admin.chartScoresLabel(counts)`
producing "Score 1: 4 reviews, …"), or follow `StackedBar` and point `aria-labelledby` at a
visually-hidden legend so the description is translated and self-describing.
**Existing test:** None found. `tests/e2e/polish.spec.ts` and `roles.spec.ts` render the charts but
assert nothing about their accessible names.

## Resolution outcome

All 52 original findings and eleven of the twelve verification follow-ups are implemented in the
QA follow-up working tree and verified by the exact-tree gate recorded in the resolution ledger.
V12 is left open on purpose: the refusal is brief and its copy is actionable, so a signal for
when it clears was judged not to be worth the surface. The original finding narratives above
remain as the inspection record; their current status is authoritatively tracked in that ledger.
