# CFP platform persona and user-flow handbook

## Purpose

This is the durable contract for testing the whole CFP platform as people use
it. It covers public discovery, speaker lifecycle, committee work, event
administration, platform access, scheduling, email guidance, responsive
layouts, keyboard operation, and both supported languages.

Automated tests remain authoritative for enforcement and deterministic edge
cases. This handbook adds the real-user questions they do not answer by
themselves: Can someone find the next step? Does a transition make sense? Is a
recovery action useful? Does the page remain usable after several roles and
states meet?

Do not fix issues during an observation run. Preserve the state and evidence,
finish the selected flows, then report every deviation together.

## Run protocol

1. Record the commit SHA, browser/version, viewport, locale, theme, seed ID,
   Firebase emulator or project, and start time.
2. Use a fresh browser context for every stable persona ID. A tab is not an
   identity boundary because Firebase Auth is shared between tabs.
3. Use an emulator or disposable project unless a flow is explicitly marked
   read-only. Never send real email, modify production roles, publish a live
   programme, or delete production data in a persona run.
4. Seed every prerequisite before opening the browser. Do not repair missing
   data through the UI while testing a different flow.
5. Take the required screenshots and collect console evidence as the flow runs.
6. Record observed and expected results separately. Continue after a failure
   when doing so cannot corrupt another flow.
7. Finish the entire observation pass before changing product code or seed data.

### Mutation budgets

Every flow has one budget. A run must not exceed it silently.

| Code | Allowed state change |
|---|---|
| `M0` | Read-only. Navigation, filters, DOM inspection, downloads, and screenshots only. |
| `MB` | Browser-local only: locale, theme, filters, viewport, and unsaved form text. |
| `M1` | At most one scoped application write, such as one draft save, response, or review. |
| `MT` | Multiple writes inside a fresh disposable tenant. Reset or discard the tenant after the flow. |
| `MX` | Destructive, role-changing, email-releasing, or publication work. Dedicated emulator/disposable project only; never a shared or production run. |

Authentication in the emulator and deterministic seeding do not consume the
flow budget. An unexpected write is a failed flow and must be reported.

Use the synthetic claims, provisioning checklist, failure-injection rule, and
per-run mapping in [`persona-fixture-manifest.md`](persona-fixture-manifest.md).
The logical prerequisites below are not permission to improvise missing state
through the UI during an observation pass.

For the release-spanning lifecycle from event creation through late intake and
archive, preserve the ordered traceability contract in
[`critical-path-17.md`](critical-path-17.md).

### Screenshot contract

Store screenshots under:

```text
output/playwright/persona-report/<run-id>/<persona-id>/<flow-id>--<checkpoint>--<viewport>.png
```

Use lowercase IDs and hyphens. `<viewport>` is `desktop-1440x1000`,
`phone-320x844`, `phone-390x844`, or `tablet-768x1024`. Examples:

```text
2026-08-08-main-a1b2c3d/spk-accepted/spk-07--decision-before--desktop-1440x1000.png
2026-08-08-main-a1b2c3d/spk-accepted/spk-07--confirmed-after--desktop-1440x1000.png
```

Capture at least one screenshot per flow. State-changing, data-loss, denial,
and recovery flows require a before and after pair. Keep the relevant heading,
status, primary action, and error or result in frame. Full-page screenshots are
optional and do not replace a readable checkpoint. For a screen-reader pass,
also record a short transcript of the spoken page title, heading, status, and
route-change announcement; a screenshot alone cannot prove audible output.

### Checks on every page

- The document title names the task and event where applicable.
- Breadcrumbs and visible tabs contain only useful, reachable destinations.
- The primary next action is understandable without knowing implementation
  terms such as callable, release, document, or role grant.
- Loading, empty, error, success, and permission-denied states have a recovery
  action that matches the persona's task.
- No unexpected horizontal scroll appears at the declared viewport.
- Focus remains visible; keyboard order follows the visual and semantic order.
- Landmarks, headings, labels, status messages, and dialogs have useful
  accessible names. Route changes produce one meaningful announcement; ignore
  Next's empty `#__next-route-announcer__` when locating application alerts.
- Console errors and warnings are zero unless the flow deliberately induces a
  failure. Record unexpected 4xx/5xx requests separately from console output.
- No caught backend or Firestore error text reaches the user.

## Stable seed model

The names below are fixture contracts, not production addresses. A seed may use
different display copy, but IDs and relationships should remain stable.

### CFP fixtures

| Fixture | Required state |
|---|---|
| `CFP-OPEN` | Public, unarchived, currently open, event date/time zone/location/website set, default submission form. |
| `CFP-CLOSED` | Public, unarchived, submission deadline passed; existing proposals remain reachable. |
| `CFP-PRIVATE` | Unarchived and directly reachable, but absent from the public listing. |
| `CFP-ARCHIVED` | Archived, absent from listing, all applicant mutations frozen. |
| `CFP-SCHEDULE-DRAFT` | Based on `CFP-OPEN`; admin-only draft with confirmed and tentative proposal placements plus public-safe custom items. It has neither a shared nor public release pointer. |
| `CFP-SCHEDULE-SHARED` | Based on `CFP-SCHEDULE-DRAFT`; immutable confirmed-only shared preview, no public release, and a private draft that can be one revision newer for stale-version checks. |
| `CFP-SCHEDULED` | Based on `CFP-SCHEDULE-SHARED`; immutable public release with two days, at least two rooms, custom items, English/French/bilingual sessions, and one cancelled entry. Draft, shared, and public IDs are recorded independently. |
| `CFP-DISPOSABLE` | Fresh tenant owned by the flow's creator/owner. Used for `MT` and `MX` flows only. |

Each fixture must carry a unique slug. Cross-tenant flows use two fixtures and
must never infer `cfpId` from membership. In route templates below, `{cfpId}`
is the selected fixture's slug and `{entryId}` is a published schedule entry.
In the Auth emulator, create each account first and use its returned `localId`
for UID-bearing proposal, speaker, member, and review fields; a token's `sub`
is not the emulator UID.

### Account and proposal fixtures

All role-bearing identities are verified. Pending-grant flows additionally seed
the grant before the account's first visit.

| Persona ID | Identity and prerequisite state | Primary routes |
|---|---|---|
| `ANON-PUBLIC` | No account or browser state. | `/`, `/c/{cfpId}`, `/c/{cfpId}/schedule`, `/c/{cfpId}/schedule/{entryId}` |
| `AUTH-UNAUTHORIZED` | Verified account with no event or platform role and no proposal. | protected event deep links, `/me`, `/new` |
| `SPK-DRAFT` | Complete global speaker profile and one autosaved draft in `CFP-OPEN`. | `/me`, `/c/{cfpId}/submit` |
| `SPK-SUBMITTED` | Own submitted proposal; committee has not started reading. | `/c/{cfpId}/submit` |
| `SPK-WITHDRAWN` | Own withdrawn proposal plus one active draft where needed. | `/c/{cfpId}/submit` |
| `SPK-ACCEPTED` | Own accepted, unanswered proposal; confirmation form has one required and one optional question. | `/c/{cfpId}/submit` |
| `SPK-CONFIRMED` | Own confirmed proposal with answers; matching entry in `CFP-SCHEDULE-SHARED`. Before publication, only the own-placement card is available. | `/c/{cfpId}/submit`, public session detail after publication |
| `SPK-CONFIRMED-OTHER` | A second confirmed speaker with a different entry in the same shared preview; used to prove speaker-to-speaker isolation. | `/c/{cfpId}/submit` |
| `SPK-DECLINED` | Own declined proposal that was previously accepted. | `/c/{cfpId}/submit`, published schedule if it was previously released |
| `SPK-WAITLISTED` | Own waitlisted proposal that remains under consideration. | `/c/{cfpId}/submit` |
| `SPK-REJECTED` | Own rejected proposal plus an optional active draft for cap checks. | `/c/{cfpId}/submit` |
| `REVIEWER-PENDING` | Verified account with an exact-email pending reviewer grant and no prior review. | `/c/{cfpId}/review` |
| `COMMITTEE-INVITEE-PENDING` | No matching Auth account yet; exact-email pending reviewer/admin grant with one generic invitation waiting. | Authenticated `/c/{cfpId}/review` deep link after account creation |
| `REVIEWER` | Active reviewer role, two eligible submitted proposals in different categories, one prior review, and one own proposal excluded from the queue. | `/c/{cfpId}/review`, `/c/{cfpId}/schedule` |
| `REVIEWER-REVOKED` | Former active reviewer whose event membership has been revoked after a shared preview exists. | protected event deep links |
| `EVENT-ADMIN` | Active event admin; proposals in every decision state, reviewer coverage, held decision/schedule emails, and configured schedule draft. | `/c/{cfpId}/admin/{tab}`, `/c/{cfpId}/review` |
| `EVENT-OWNER` | Active event owner and at least one other admin. Owns `CFP-DISPOSABLE`. | `/c/{cfpId}/admin/settings`, all event workspaces |
| `PLATFORM-CREATOR-PENDING` | Verified account with an exact-email pending creator grant and no event role. | `/new`, `/` |
| `PLATFORM-CREATOR` | Active creator grant, below the owned-CFP limit. No event role until creation. | `/new`, `/` |
| `PLATFORM-CREATOR-TARGET` | Verified account with no platform role and existing ownership of its disposable CFP; grant target for `PLT-03`. | `/new`, `/platform`, owned event workspace |
| `PLATFORM-ADMIN` | Active platform admin; pending and active creator grants. No event access by implication. | `/platform`, `/new` |
| `PLATFORM-ADMIN-TARGET` | Verified account with no platform or event role; grant target for `PLT-04`. | `/platform` |
| `PLATFORM-OWNER` | Active platform owner plus a second verified owner, pending admin grant, and no implied event access. | `/platform` |
| `PLATFORM-OWNER-SECOND` | Active verified platform owner used only to prove last-owner safety. | `/platform` |
| `PLATFORM-GLOBAL-ONLY` | Active global platform admin or owner with no role in the scheduled CFP. | `/platform`, protected event deep links |

### Cross-cutting persona lenses

These lenses run on top of a base persona and never grant authorization.

| Lens ID | Required setup |
|---|---|
| `LENS-MOBILE` | Chromium at 320×844 and 390×844; tablet boundary at 768×1024 where specified. |
| `LENS-KEYBOARD` | Keyboard-only interaction from the skip link onward; mouse disabled for the flow. |
| `LENS-SCREENREADER` | VoiceOver with current Safari for a release pass; record spoken output. Chromium accessibility-tree/ARIA inspection is the faster CI proxy, not a replacement. |
| `LENS-BILINGUAL` | Start in English, switch to French, reload, and exercise configured French and bilingual content. |

## User-flow catalog

The automated coverage column uses `Automated`, `Partial`, or `Gap`. When one
test is the primary anchor, its exact title is included; broader flows name the
suite that owns the behavior.

### Coverage at a glance

This map is for planning, not for replacing the detailed expected outcomes
below. `Automated` names the strongest regression safety net; `Manual focus`
is what a screenshot-backed persona run still has to judge.

| Persona or lens | Automated strengths | Manual focus |
|---|---|---|
| Anonymous visitor and authentication | Public/private/archive visibility, CFP window copy, route preservation, email-link redemption, theme persistence | Discoverability, useful denial recovery, navigation clarity across signed-out states |
| Draft, submitted, and withdrawn speaker | Autosave, validation, tenant separation, lifecycle locks, withdrawal, deletion, active-talk limits | Comprehension of state changes, primary-action hierarchy, confidence that work was saved |
| Accepted, confirmed, declined, waitlisted, and rejected speaker | Decision responses, required confirmation answers, filtered own-placement preview, speaker isolation, public ICS export, correction, archived freeze, cancellation rules | Distinguish working placement from public programme; understand each decision; judge schedule guidance and republish guidance after reconfirmation |
| Reviewer | Role claim, eligible queue, keyboard scoring, conflict persistence, unsaved-note navigation preservation, confirmed-only read-only programme preview, privacy, score visibility | Failed-save recovery and proposal-specific retry wording |
| Event admin | Settings/forms/roles/coverage/decisions/email/private-share-public schedule stages and security boundaries | Overview readiness, cross-tab guidance, dense responsive layouts, whether stale or pending work is obvious |
| Event owner | Archive and two-step tenant deletion with scoped cleanup | Consequence copy and recovery path before the destructive boundary |
| Creator, platform admin, and platform owner | Grant claim/revocation, CFP creation, delegation limits, last-owner protection, no implied event access | Clear separation between global and event authority; useful unauthorized guidance |
| Mobile | Public agenda, speaker picker/forms, admin cards/navigation, schedule editing | Long translated content, browser zoom, touch-target comfort, 320/390/768 breakpoint transitions |
| Keyboard and screen reader | Reviewer shortcuts and schedule-dialog focus containment | VoiceOver announcement quality, full skip-link route, focus restoration, error association, menu dismissal |
| Bilingual | Form validation, stored codes, dates, email locale, responsive French admin | French/bilingual schedule filtering and localized ICS download; content fit at narrow widths |

### Schedule regression title map

This table maps the exact Playwright titles that protect schedule interaction,
metadata, custom speakers, responsive layout, and programme return behavior.
One title may support more than one stable flow; the flow IDs do not change when
the implementation or test file moves. Listing a title here records coverage,
not the result of a particular run.

| Stable flow mapping | Spec | Exact Playwright title |
|---|---|---|
| `ADM-07` | [`customScheduleSpeakers.spec.ts`](../../tests/e2e/customScheduleSpeakers.spec.ts) | “custom-item speakers are validated, sanitized, and frozen into releases” |
| `ADM-07` | [`scheduleMetadata.spec.ts`](../../tests/e2e/scheduleMetadata.spec.ts) | “the schedule editor keeps proposal and custom scheduling facts visible and accessible” |
| `ADM-08`, `A11Y-03`, `LOC-03` | [`scheduleMetadata.spec.ts`](../../tests/e2e/scheduleMetadata.spec.ts) | “the selected-session inspector stays aligned and complete from desktop through 320 pixels” |
| `SPK-09`, `LOC-02` | [`scheduleMetadata.spec.ts`](../../tests/e2e/scheduleMetadata.spec.ts) | “the public agenda and detail expose frozen taxonomy and full speaker details in both languages” |
| `ADM-08`, `MOB-01` | [`scheduleMetadata.spec.ts`](../../tests/e2e/scheduleMetadata.spec.ts) | “long scheduling facts stay contained at a 320 pixel viewport” |
| `ADM-07` | [`scheduleTaxonomyLabels.spec.ts`](../../tests/e2e/scheduleTaxonomyLabels.spec.ts) | “schedule releases freeze taxonomy labels and refuse a changed form until re-shared” |
| `ADM-07`, `SPK-09` | [`scheduleTaxonomyLabels.spec.ts`](../../tests/e2e/scheduleTaxonomyLabels.spec.ts) | “a legacy release remains visible to its speaker and upgradeable by its admin” |
| `ADM-08`, `A11Y-03` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “schedule editing stays complete on mobile and reports conflicts inside a focus-contained dialog” |
| `ADM-07`, `LOC-03` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “custom programme items can carry or clear a scheduled language” |
| `MOB-01` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “public agenda groups simultaneous rooms and keeps one room chronological on mobile” |
| `SPK-09` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “programme Back restores the exact filtered agenda position” |
| `SPK-09` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “browser Back restores the exact filtered agenda position” |
| `REV-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “staff Back restores a second-day custom item in the newer shared preview” |
| `SPK-09` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “a directly opened session falls back to a normal programme link” |
| `ADM-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “custom programme item speakers are optional, repeatable, removable, and public in order” |
| `ADM-08`, `LOC-03` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “custom speaker rows stay aligned and contained across desktop, tablet, mobile, and French” |
| `ADM-07`, `ADM-08` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “timeline geometry keeps short custom items readable and distinguishes quarter, half, and hour guides” |
| `ADM-07`, `ADM-08` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “room creation supports an exact five-minute drag target, persists allocation, and contains mobile overflow” |
| `ADM-07`, `A11Y-03` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “duration resize uses five-minute pointer and keyboard steps, persists, and refuses conflicts and day overflow” |
| `ADM-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “a failed resize waits for persistence and leaves the card unchanged” |
| `ADM-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | “sharing and publishing have separate review steps and stale-version guidance” |

### Public discovery, authentication, and global navigation

| Flow | Persona | Budget | Steps | Expected outcome | Screenshot checkpoints | Automated coverage |
|---|---|---:|---|---|---|---|
| `PUB-01` | `ANON-PUBLIC` | `M0` | Open `/`; distinguish public, private, and archived fixtures; open `CFP-OPEN`. | Only public, unarchived calls are listed. Event page explains status, dates, location, and next step. Sign in remains globally visible. | listing; event hero | Automated — `platform.spec.ts`, “lists the public calls and not the private ones”; `cfpPage.spec.ts`, “says what the event is, to somebody who is not signed in” |
| `PUB-02` | `ANON-PUBLIC` | `M0` | Open the direct URL for `CFP-PRIVATE`; inspect metadata/noindex. | The event opens but remains unlisted and tells crawlers not to index it. | private event page | Automated — `platform.spec.ts`, “a private call is unlisted, not secret — its link still opens”; `cfpPage.spec.ts`, “an unlisted call renders but tells a crawler to stay away” |
| `PUB-03` | `ANON-PUBLIC` | `M0` | Open calls before, during, paused, closed, and archived windows. | Copy identifies the precise state; impossible submission actions are absent; existing-proposal sign-in remains reachable. | each distinct window state | Automated — `window.spec.ts`; `cfpPage.spec.ts`, “does not offer an impossible submission action outside the open window” |
| `PUB-04` | `ANON-PUBLIC` | `M0` | Open the event and direct Schedule URL with a private draft, then with only a shared preview, and finally after explicit publication. | Draft and shared states expose no programme tab, session, or calendar data. The direct route says publication is pending. Only the public pointer makes the full immutable programme and tab available; taking it offline hides both again without deleting the shared preview. | event without Schedule tab; direct unpublished route; published agenda; offline route | Automated — `schedule.spec.ts`, “keeps private, shared, and public schedule releases isolated by audience” |
| `AUTH-01` | `ANON-PUBLIC` → `SPK-DRAFT` | `M1` | Start sign-in from event/submission; complete Google-emulator sign-in; repeat through an email link in its dedicated run. | Destination stays inside the chosen CFP; email link is redeemed before routing and cannot open-redirect. | signed-out origin; signed-in destination | Automated — `navigation.spec.ts`, “header sign-in on an event keeps the speaker inside that event”; `signInLink.spec.ts`; `routing.spec.ts` |
| `AUTH-02` | `AUTH-UNAUTHORIZED` | `M0` | Open `/c/{cfpId}/review` and `/c/{cfpId}/admin/schedule` directly while signed out and then signed in without a role. | Signed-out page preserves useful context. Signed-in denial exposes no privileged data and offers a reachable next step. | signed-out protected route; signed-in denial | Partial — `navigation.spec.ts`, “a signed-out protected deep link keeps its breadcrumb without misleading tabs”; `roles.spec.ts`, “a speaker sees no committee tabs and cannot open the admin page” |
| `NAV-01` | all base personas | `M0` | Compare header, breadcrumb, event tabs, account menu, and browser title at each persona's primary route. | Every destination is authorized and task-relevant; current location is not a self-link; account switching clears prior-persona content before paint. | one navigation frame per persona | Automated — `navigation.spec.ts`; `responsive-navigation.spec.ts` |
| `THEME-01` | `ANON-PUBLIC` + `LENS-MOBILE` | `MB` | Follow system theme; choose light/dark; reload; repeat with storage unavailable. | Explicit choice wins and controls remain labelled and contained. | system theme; explicit theme after reload | Automated — `platform.spec.ts`, theme tests |

### Applicant, draft, submitted, and withdrawn speaker

| Flow | Persona | Budget | Steps | Expected outcome | Screenshot checkpoints | Automated coverage |
|---|---|---:|---|---|---|---|
| `SPK-01` | `SPK-DRAFT` | `M1` | Open `/me`; complete or edit profile; save; open `CFP-OPEN` submission. | One global profile is reused, validation names the field, and dirty Back navigation cannot silently discard it. | profile before save; saved profile in submission | Automated — `profile.spec.ts` |
| `SPK-02` | `SPK-DRAFT` | `M1` | Edit one talk field; wait for autosave; reload; switch between two talks and CFPs. | Draft survives; only talk fields switch; profile/travel carry over where specified; tenant state never crosses. | draft saved; same draft after reload | Automated — `draft.spec.ts`; `platform.spec.ts`, cross-tenant draft test |
| `SPK-03` | `SPK-DRAFT` | `MT` | Submit incomplete; correct localized errors; complete required taxonomy, acknowledgements, travel, and custom questions; submit. | Invalid data is focused and explained in the current language. Complete proposal remains readable with Submitted status and receipt behavior. | validation summary; submitted state | Automated — `submit.spec.ts`; `submissionForm.spec.ts`; `journey.spec.ts` |
| `SPK-04` | `SPK-SUBMITTED` | `M1` | Reopen before committee reading; edit content; move status to under review in a separate seeded run; edit profile/travel. | Content is editable only before review starts. Locked content, global profile, and logistics match lifecycle copy and enforcement. | submitted editable; under-review locked | Automated — `roles.spec.ts`, submitted/locked edit tests; `snapshot.spec.ts` |
| `SPK-05` | `SPK-SUBMITTED` | `M1` | Choose Withdraw; dismiss confirmation; repeat and accept. Reload and inspect actions. | Dismissal changes nothing. Withdrawal is final, has no Save/Submit action, is excluded from review/counts, and keeps an understandable record. | ready state before native confirmation; withdrawn card after reload | Automated — `submit.spec.ts`, “a submitted proposal can be withdrawn”; `roles.spec.ts`, withdrawn visibility/counting |
| `SPK-06` | `SPK-WITHDRAWN` | `MX` | On disposable tenant, verify an untouched draft can be deleted; inspect historical withdrawn proposal and live-talk limit. | Draft deletion preserves profile. Withdrawn/historical outcomes do not consume the active-talk cap and cannot be decided by admins. | draft delete confirmation; historical picker | Automated — `submit.spec.ts`, draft deletion; `draft.spec.ts`, historical cap; `roles.spec.ts` |

### Accepted, confirmed, declined, waitlisted, rejected, and scheduled speaker

| Flow | Persona | Budget | Steps | Expected outcome | Screenshot checkpoints | Automated coverage |
|---|---|---:|---|---|---|---|
| `SPK-07` | `SPK-ACCEPTED` | `M1` | Open decision; dismiss Decline confirmation; choose Yes; omit required confirmation answer; complete it and confirm in a fresh instance. | Accepted copy does not claim a published time prematurely. Decline is guarded. Missing answer preserves Accepted status. Successful answer persists as Confirmed. | accepted decision; required error; confirmed result | Automated — `confirm.spec.ts`, acceptance and question tests |
| `SPK-08` | `SPK-CONFIRMED` | `M1` | In separate seeded runs, edit either one confirmation answer or one travel detail; reload; inspect locked talk/profile behavior. | The changed detail persists without changing Confirmed status. Talk content stays locked; profile and logistics remain editable. | confirmed detail; reloaded value | Automated — `confirm.spec.ts`, correction/autosave; `roles.spec.ts`, locked edit |
| `SPK-09` | `SPK-CONFIRMED` | `M0` | Before publication, inspect the own-placement card in My proposals. After publication, filter and scroll the Schedule, open the session detail, inspect taxonomy and full speaker details, return with both programme Back and browser Back, then download its ICS. Open a detail URL directly once to exercise the ordinary-link fallback. | The working card is explicitly not public and contains only the speaker’s date, time, room, and language. Once public, the agenda, detail, frozen taxonomy and speaker snapshot, and stable ICS agree. Both return paths restore the selected day, filters, and exact agenda position; a direct visit returns normally without consuming unrelated history. | private own-placement card; public agenda with own talk; full session detail/calendar action; restored filtered agenda | Automated — `schedule.spec.ts`, “an accepted speaker confirms and follows their shared session into the published calendar file”; `scheduleMetadata.spec.ts`, “the public agenda and detail expose frozen taxonomy and full speaker details in both languages”; `scheduleUx.spec.ts`, programme/browser Back and direct-session fallback titles in the schedule regression title map |
| `SPK-10` | `SPK-CONFIRMED` → `SPK-DECLINED` | `MX` | In a disposable tenant with published release, decline; inspect proposal and public session; re-confirm in a separate run. | Public entry remains as Cancelled with stable URL/UID. Admin is guided to republish before it becomes live again; speaker-facing status never contradicts the public programme. | before decline; declined proposal; cancelled session; post-reconfirm state | Partial — `confirm.spec.ts`, reversible response; `schedule.spec.ts`, cancellation |
| `SPK-11` | `SPK-DECLINED` | `M0` | Reopen proposal during closed and archived calls. | Historical response remains readable. Archived state is visibly frozen and exposes no mutation controls. | declined active; archived frozen | Automated — `window.spec.ts`; `confirm.spec.ts`, archived confirmation |
| `SPK-12` | `SPK-WAITLISTED` + `SPK-REJECTED` | `M0` | In separate contexts, open each decision and inspect status help, available actions, live-talk cap, and schedule visibility. | Waitlisted is clearly still under consideration and exposes only the permitted withdrawal, not an acceptance response. Rejected is final, has no response/withdraw action, does not consume the active-talk cap, and is absent from the programme. | waitlisted decision; rejected decision/picker | Partial — response refusal is automated in `confirm.spec.ts`, “there is nothing to answer until a decision has been made”; cap behavior in `draft.spec.ts`; decision comprehension remains exploratory |
| `SPK-13` | `SPK-CONFIRMED` + `SPK-CONFIRMED-OTHER` | `M0` | Open each speaker in a separate context against the same shared preview; inspect My proposals before and after a newer draft is saved and shared; then compare a newer shared preview that removes one still-confirmed placement with the older public programme. Repeat once with the shared-preview request unavailable. | Each speaker receives exactly their own still-confirmed, non-cancelled placement. Neither sees the other speaker, custom programme items, tentative placements, or live draft edits. A new placement appears only after re-share. If the latest shared preview has no placement, My proposals shows no time rather than resurrecting the older public one. A failed current-preview request also suppresses the old time and gives reload guidance. | first own placement; second own placement; unchanged card after draft edit; updated card after re-share; removed placement with older public version; shared-preview load warning | Automated — `schedule.spec.ts`, “a shared schedule exposes only each confirmed speaker's own placement” and “does not fall back to an obsolete public placement after a speaker is removed from the shared preview” |

### Reviewer and committee experience

| Flow | Persona | Budget | Steps | Expected outcome | Screenshot checkpoints | Automated coverage |
|---|---|---:|---|---|---|---|
| `REV-01` | `REVIEWER-PENDING` → `REVIEWER` | `M1` | First visit after email grant; open `/review`; inspect navigation and queue. | Exact verified address claims the role. Review appears; event management does not. Drafts, withdrawn talks, and reviewer's own talk are absent. | first claimed workspace; queue | Automated — `roles.spec.ts`, invited reviewer and own-proposal tests; `navigation.spec.ts` |
| `REV-02` | `REVIEWER` + `LENS-KEYBOARD` | `M1` | Navigate cards with arrows/J/K; type a note containing a digit; press 1–4 outside the field; return through queue. | Text keystrokes are not scores. Score lands on the visible proposal, saves its note, advances once, survives return, and order stays stable. | before score; counter/next card; queue state | Automated — `deck.spec.ts` |
| `REV-03` | `REVIEWER` | `M1` | Declare conflict without a numeric score; save; reload and inspect progress/queue wording. | Conflict is persisted and excluded from aggregates. UI calls it a response/conflict rather than a numeric score. | conflict selected; reloaded queue/progress | Partial — backend behavior automated in `deck.spec.ts`; wording needs exploratory check |
| `REV-04` | `REVIEWER` | `M0` | Inspect speaker context, logistics, privacy, and committee scores before/after an admin opens results in separate seed state. | Frozen snapshot and scheduling logistics are visible; speaker email is not. Other scores are hidden until opened and then labelled clearly. | hidden-scores card; opened committee scores | Automated — `deck.spec.ts`; `roles.spec.ts`, score visibility |
| `REV-05` | `REVIEWER` | `MB` | Type an unscored note; navigate to Schedule and back. | The note is preserved locally, remains attached to the same proposal, and is not written as a review. | note before navigation; restored note | Automated — `deck.spec.ts`, “an unscored note survives leaving and returning to review” |
| `REV-06` | `REVIEWER` | `M1` | Type a note, induce the next save request to fail, and retry without retyping. | Failed work remains recoverable, identifies the affected proposal, and is cleared only after one proven successful review write. | note before save; failure; successful recovery | Automated — `deck.spec.ts`, “a failed score save keeps its exact proposal, note, and score for retry” |
| `REV-07` | `REVIEWER` + `REVIEWER-PENDING` + `REVIEWER-REVOKED` + `PLATFORM-GLOBAL-ONLY` | `MX` | Share a preview; inspect it as the active reviewer; open a second-day custom item and return with programme Back; attempt direct reads and writes as pending, revoked, and global-only identities. | The active committee member gets the confirmed agenda and public-safe custom items with Committee preview, Read-only, and Not public guidance. Staff Back restores the newer shared release, selected second day, and exact agenda position rather than the older public version. Tentative sessions are omitted. No reviewer may edit the draft. Pending, revoked, anonymous, and global-only identities receive no preview data. | active committee preview; second-day position restored; tentative omission; read-only guidance; post-revocation denial | Automated — `schedule.spec.ts`, “committee preview follows active event membership and remains read only”; `scheduleUx.spec.ts`, “staff Back restores a second-day custom item in the newer shared preview” |

### Event admin and owner

| Flow | Persona | Budget | Steps | Expected outcome | Screenshot checkpoints | Automated coverage |
|---|---|---:|---|---|---|---|
| `ADM-01` | `EVENT-ADMIN` | `M0` | Open Overview; inspect readiness, metrics, pending email callout, and preview/workspace links. | Each incomplete item links directly to the place it can be fixed. Counts exclude withdrawn proposals and match detail views. | incomplete overview; ready overview | Partial — several component flows are automated; broad overview remains exploratory |
| `ADM-02` | `EVENT-ADMIN` | `MT` | Edit event details, start/end dates, time zone, visibility, submission window, pause, and score visibility in disposable tenant. | Public page and form reflect changes after reload; invalid URLs/dates are refused; dirty tab navigation is guarded. | settings before/after; matching public page | Automated — `cfpPage.spec.ts`; `roles.spec.ts`; `window.spec.ts` |
| `ADM-03` | `EVENT-ADMIN` | `MT` | Reword taxonomy; add custom submission and confirmation questions; preview as speaker; retire a question. | Stored codes stay stable, both languages remain coherent, required fields are enforced server-side, and retired answers remain visible to admins. | editor; speaker form; retained answer | Automated — `submissionForm.spec.ts`; `confirm.spec.ts` |
| `ADM-04` | `EVENT-ADMIN` | `MX` | Invite reviewer/admin; edit and revoke the pending grant; re-invite; claim in a separate identity; attempt last-admin/self/owner changes. | Grant waits for the exact verified address and queues one generic authenticated review-link invitation. Editing retains its id and does not duplicate; revocation makes it stale and unsendable; re-invite creates a fresh id. Protected owner and last-admin invariants hold, with clear UI guidance. | pending invitation; revoked/stale invitation; active member; protected control | Automated — `roles.spec.ts`; `staffNotifications.spec.ts`, “a pending committee invite dedupes role edits, becomes stale on revoke, and re-invite gets a fresh authenticated link” |
| `ADM-05` | `EVENT-ADMIN` | `MT` | Inspect review coverage; expand missing talks; set decisions; include withdrawn filter; inspect selected speakers. | Missing, scored, and conflicted responses are distinguishable. Own proposals remain private. Withdrawn talks are hidden by default and never ranked/count. | coverage; decisions; selected speakers | Automated — `reviewBackend.spec.ts`; `roles.spec.ts`; `polish.spec.ts`; `journey.spec.ts` |
| `ADM-06` | `EVENT-ADMIN` | `MX` | Configure sender in emulator/dry-run; preview held decisions; release reviewed batch; inspect log/retry/resend and one-off message. | Pending mail is conspicuous after a decision. Stale decisions/schedules cannot send, concurrent release dedupes, and status never suggests re-authentication for provider failure. | pending callout; preview; post-release log | Automated — `email.spec.ts` |
| `ADM-07` | `EVENT-ADMIN` | `MX` | Configure days and add a room; inspect proposal/custom scheduling facts; create a short custom item with language and optional ordered speakers; drag it to an exact five-minute target; resize a session by pointer and keyboard; exercise conflict, day-overflow, and failed-save recovery; share the confirmed preview; edit the draft or taxonomy; re-share; publish; take offline; then withdraw a scheduled talk. | Editor cards and the selected-session inspector keep title, speaker, taxonomy, language, format, level, and confirmation facts visible. Five-minute placement and duration changes persist only after successful writes; conflicts, day overflow, and failed saves leave the prior card unchanged. Short items use proportionate guides and remain readable. Custom speakers are validated/sanitized and language, speaker order, and taxonomy labels freeze into releases. A changed taxonomy blocks promotion until re-share; legacy releases remain usable and upgradeable. The three stages keep independent versions and audiences, with confirmed-only sharing, stale-version protection, stable cancellation, and no duplicate notification. | private editor facts; custom language/speakers; new room and five-minute placement; resized session and refusal feedback; share review; stale taxonomy/stages; open-CFP publish warning; live agenda; offline state; withdrawn session shown as cancelled | Automated — exact titles in the schedule regression title map from `customScheduleSpeakers.spec.ts`, `scheduleMetadata.spec.ts`, `scheduleTaxonomyLabels.spec.ts`, and `scheduleUx.spec.ts`; schedule unit/rules tests |
| `ADM-08` | `EVENT-ADMIN` + `LENS-MOBILE` | `M0` | Open overview, proposals, forms, email, and schedule at 320, 390, and 768 widths; inspect the selected-session facts, short-item timeline, add-room/drop target, and two custom-speaker rows in English and French; use section navigation after deep scroll. | Tabs, section menu, tables/cards, dialogs, schedule grid, facts, and repeated speaker fields remain aligned, contained, and recoverable. Exact five-minute targets remain usable without horizontal page overflow. | each breakpoint's hardest page; selected-session inspector; custom-speaker rows; schedule timeline | Automated — `navigation.spec.ts`; `responsive-navigation.spec.ts`; `polish.spec.ts`; `scheduleMetadata.spec.ts`, selected-session/long-facts titles; `scheduleUx.spec.ts`, mobile dialog, aligned custom-speaker, timeline, and room-creation titles in the schedule regression title map |
| `OWN-01` | `EVENT-OWNER` | `MX` | Archive disposable CFP; attempt applicant mutation; unarchive. | Only owner can archive. It disappears from listing, freezes writes transactionally, and returns intact when restored. | archive warning; archived state; restored state | Automated — `platform.spec.ts`; `confirm.spec.ts` |
| `OWN-02` | `EVENT-OWNER` | `MX` | Archive disposable CFP; type slug; cancel deletion; repeat and confirm. | Two distinct confirmations are required. Deletion removes event-scoped proposals, reviews, photos, and config, never unrelated tenants. | typed confirmation; final absence | Automated — `platform.spec.ts`, “deleting takes two steps, and takes the proposals and photos with it” |

### Platform creator, admin, and owner

| Flow | Persona | Budget | Steps | Expected outcome | Screenshot checkpoints | Automated coverage |
|---|---|---:|---|---|---|---|
| `PLT-01` | `AUTH-UNAUTHORIZED` | `M0` | Open `/new` and `/platform`; attempt direct creation callable in a dedicated backend check. | Creation and platform management are denied without exposing event or role data; access-request guidance is useful. | creation denial; platform denial | Automated — `platformAccess.spec.ts`, anonymous/unapproved test |
| `PLT-02` | `PLATFORM-CREATOR-PENDING` → `PLATFORM-CREATOR` | `MT` | Claim pending creator grant; create `CFP-DISPOSABLE`; revisit home and admin. | Exact verified address claims access. Creator becomes event owner in the creation transaction and can resume the new CFP. Per-owner ceiling holds under races. | creator access; created event; home task card | Automated — `platformAccess.spec.ts`; `platform.spec.ts`, create flow |
| `PLT-03` | `PLATFORM-ADMIN` + `PLATFORM-CREATOR-TARGET` | `MX` | Add pending creator; claim as target; revoke future creation; verify the target still owns its pre-existing disposable CFP; inspect an unrelated event as the platform admin. | Admin manages creators but not platform admins/owners. Revocation does not remove existing event ownership, and the platform admin role grants no access to unrelated events. | pending creator; active/revoked creator; retained ownership; unrelated-event denial | Automated — `platformAccess.spec.ts` |
| `PLT-04` | `PLATFORM-OWNER` + `PLATFORM-ADMIN-TARGET` | `MX` | Delegate pending platform admin; claim; revoke; exercise last-owner protections through bootstrap tests. | Owners alone manage platform admins. Owner changes remain bootstrap-only, and last active verified owner cannot be removed under concurrency. No platform role implies event access. | owner controls; pending/active admin; protected owner state | Automated — `platformAccess.spec.ts`; `platformBootstrap.spec.ts` |

### Mobile, keyboard/screen-reader, and bilingual lenses

| Flow | Persona | Budget | Steps | Expected outcome | Screenshot checkpoints | Automated coverage |
|---|---|---:|---|---|---|---|
| `MOB-01` | `ANON-PUBLIC` + `LENS-MOBILE` | `MB` | Open listing/event/schedule at 320×844; inspect simultaneous rooms, switch to one room, change day/language, and open a session with long taxonomy and speaker facts. | Primary action stays visible, simultaneous sessions group by start time, one room remains chronological, filters and long facts wrap, and document width equals viewport width. | event hero; simultaneous-room agenda; one-room timeline; long session detail | Automated — `responsive-navigation.spec.ts`; `schedule.spec.ts`, narrow agenda; `scheduleUx.spec.ts`, “public agenda groups simultaneous rooms and keeps one room chronological on mobile”; `scheduleMetadata.spec.ts`, “long scheduling facts stay contained at a 320 pixel viewport” |
| `MOB-02` | `SPK-DRAFT` + `LENS-MOBILE` | `M1` | Open long-title picker, progress rail, errors, and conditional travel fields; save/reload. | Status never clips, labels remain attached, actions remain reachable, and no sticky element covers focused fields. | picker; form error; actions | Automated — `polish.spec.ts`; form E2E suites |
| `MOB-03` | `EVENT-ADMIN` + `LENS-MOBILE` | `M0` | Open proposals and email at 320/768; expand filters, missing reviews, and cards. | Controls wrap without overlap; tables become readable cards where designed; no hidden horizontal page scroll. | proposals; email cards | Automated — `polish.spec.ts`; `roles.spec.ts` responsive workspace |
| `A11Y-01` | `ANON-PUBLIC` + `LENS-KEYBOARD` + `LENS-SCREENREADER` | `M0` | Tab from page start; activate Skip to content; traverse header, event tabs, and primary action; navigate Back; repeat the route with VoiceOver. | Skip link targets main content, landmarks/headings are coherent, focus is visible, and route announcement names the new task once. | focused skip link; focused primary action; spoken-output transcript | Partial — semantic locators are pervasive; dedicated full keyboard and VoiceOver paths remain exploratory |
| `A11Y-02` | `REVIEWER` + `LENS-KEYBOARD` + `LENS-SCREENREADER` | `M1` | Open shortcuts with `?`; move with arrows/J/K; enter numeric note; score with number; open queue; verify the change is spoken. | No key is stolen from text input, focus follows the new proposal, current queue item is not a focus-losing button, and state is announced. | shortcuts; focused next card; queue; spoken state transcript | Automated — keyboard behavior in `deck.spec.ts`; native announcement baseline in `voiceover-baseline.md` |
| `A11Y-03` | `EVENT-ADMIN` + `LENS-KEYBOARD` + `LENS-SCREENREADER` | `MB` | Open/close schedule editor and mobile admin menu with keyboard; select a session and resize it with arrow/Page keys; attempt invalid save; press Escape; verify dialog, facts, and error announcements. | Dialog has name/modal semantics, focus remains trapped/restored appropriately, resize exposes useful value text and five-/fifteen-minute keyboard steps, Escape closes, and validation is associated with and announced from its controls. | dialog open; focused resize control; validation/focus after close; spoken error transcript | Partial — `scheduleMetadata.spec.ts`, “the selected-session inspector stays aligned and complete from desktop through 320 pixels”; `scheduleUx.spec.ts`, mobile dialog and duration-resize titles in the schedule regression title map; Escape, restore, menu focus, and spoken output remain exploratory |
| `LOC-01` | `SPK-DRAFT` + `LENS-BILINGUAL` | `M1` | Switch to French; reload; trigger validation; inspect dates/status/window and submit a configured French choice. | Locale persists, validation is French, stored codes remain canonical, and dates use the selected locale. | French form; French validation/result | Automated — `submit.spec.ts`; `submissionForm.spec.ts`; `email.spec.ts`, locale selection |
| `LOC-02` | `ANON-PUBLIC` + `LENS-BILINGUAL` | `MB` | View French and bilingual proposal/custom sessions; change language filter; inspect frozen taxonomy and speaker details; download French ICS. | Labels, custom-item fallbacks, taxonomy, and speaker details are localized; bilingual is explicit; ICS title/description/room use requested locale while stable IDs/times do not change. | filtered agenda; French full session detail/calendar action | Partial — `scheduleMetadata.spec.ts`, “the public agenda and detail expose frozen taxonomy and full speaker details in both languages”; schedule/calendar unit coverage; end-to-end locale download remains exploratory |
| `LOC-03` | `EVENT-ADMIN` + `LENS-BILINGUAL` + `LENS-MOBILE` | `MB` | Switch admin to French at 320×844; open section menu, form editors, selected-session inspector, and a custom item with two speakers; rotate to 768×1024. | French labels, scheduling facts, and repeated speaker fields do not cover controls; stored-code columns remain readable; custom scheduled language remains explicit; and the menu can be dismissed without losing context. | French phone menu; French selected-session inspector; French custom-speaker rows; French tablet editor | Automated — `responsive-navigation.spec.ts`; `polish.spec.ts`; `scheduleMetadata.spec.ts`, selected-session title; `scheduleUx.spec.ts`, custom-language and aligned custom-speaker titles in the schedule regression title map |

## Coverage and reporting rules

Use these result labels:

- `PASS`: observed result matches every expected outcome.
- `FAIL-FUNCTIONAL`: action, data, security boundary, or state transition is
  wrong.
- `FAIL-UX`: task succeeds but guidance, navigation, feedback, accessibility,
  responsive layout, or recovery is misleading or costly.
- `BLOCKED-SEED`: prerequisites are missing or inconsistent. Do not convert this
  into a product failure.
- `NOT-RUN`: explicitly out of the selected scope.

Every finding records flow ID, persona ID, expected result, observed result,
severity, route, viewport/locale/theme, screenshot paths, console/network
evidence, and whether the seed could have bypassed a product validator.

## Maintenance rules

1. Flow and persona IDs are stable API. Never reuse a retired ID; mark it
   `Deprecated` with its replacement.
2. A product change that adds a route, role, lifecycle state, or external-facing
   transition updates this handbook in the same pull request.
3. A new automated E2E test adds or updates the spec mapping here. Include the
   exact title when one test is the primary anchor. Renaming an included title
   updates the mapping; a stale title is a documentation defect.
4. Prefer one automated enforcement test plus one persona flow over duplicating
   every backend edge case manually.
5. A flow marked `Gap` is a candidate for automation when it has caused a
   regression, protects user writing, crosses authorization, or is hard to
   observe reliably.
6. Keep seed identities synthetic and unique. Never put real email, speaker
   biography, API key, DNS value, auth link, or production proposal in committed
   fixtures or screenshots.
7. Shared exploratory seeds are immutable except for declared `M1` flows. Run
   `MT` and `MX` flows in their own tenant and browser context.
8. Screenshots are evidence, not golden tests. Keep visual expectations in
   prose and use DOM/accessibility assertions for deterministic automation.
9. Re-read this handbook after status-set, lifecycle, form-schema, role,
   schedule-draft/shared/public-release, email-queue, router, or responsive
   breakpoint changes.
10. Before a release-level persona pass, run `npm run verify`; after the pass,
    report failures before making fixes so the evidence remains attributable to
    one build.

## Minimum release pass

When time does not allow the full catalog, run at least:

`PUB-01`, `PUB-04`, `AUTH-01`, `SPK-02`, `SPK-03`, `SPK-05`, `SPK-07`,
`SPK-09`, `SPK-13`, `REV-02`, `REV-05`, `REV-06`, `REV-07`, `ADM-05`,
`ADM-06`, `ADM-07`, `OWN-01`, `PLT-02`, `PLT-03`, `PLT-04`, `MOB-01`,
`A11Y-02`, and `LOC-01`.

This set touches every authorization layer and the most expensive user-writing,
decision, notification, and publication transitions without performing a
destructive event deletion.

Use [`minimum-release-rerun.md`](minimum-release-rerun.md) for the exact E2E
anchors, route selectors, and required screenshot filenames.
