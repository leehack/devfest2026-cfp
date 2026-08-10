# Minimum-release screenshot rerun

This is the concrete evidence selection for the handbook's minimum release
pass. It does not replace `npm run verify` or the full flow catalog. Schedule
evidence deliberately crosses private, shared, and public states; one final
agenda screenshot cannot prove that disclosure boundary.

## Run order

1. Record the run in
   [`persona-fixture-manifest.md`](persona-fixture-manifest.md).
2. Run each automated anchor in an isolated automated context **before**
   provisioning the exploratory seed. The specs reset emulator state and do not
   create success screenshots.
3. Provision the selected personas, then use a unique browser context/session
   for every persona. Never run an E2E spec against that shared exploratory
   state.
4. Follow each manual checkpoint below and capture every named file. For a
   transition, keep the evidence under the starting persona's directory so the
   flow stays together.
5. Save a zero-warning console record as
   `<persona-id>/<flow-id>--console.txt`; add `--network.txt` when a flow induces
   or observes a failed request.

Invoke an anchor by substituting its exact table values:

```bash
npx playwright test tests/e2e/<spec> --grep "<exact title>"
```

### Schedule companion anchors

When schedule code changes, add the relevant anchors below to the stable flow's
primary anchor. Responsive schedule anchors assigned to `ADM-08`, `A11Y-03`,
or `LOC-03` in the full handbook are folded into `ADM-07` with the matching
mobile, keyboard, or bilingual lens because those flows are outside this
minimum set. The final row records `ADM-07`'s primary title for inventory
completeness; run that title once, not again as a companion. These mappings do
not add flow IDs or prove that a run passed. The exact titles are also mapped
in the handbook's
[`Schedule regression title map`](persona-flow-handbook.md#schedule-regression-title-map).

| Stable minimum-flow mapping | Spec | Exact Playwright title |
|---|---|---|
| `ADM-07` | [`customScheduleSpeakers.spec.ts`](../../tests/e2e/customScheduleSpeakers.spec.ts) | `custom-item speakers are validated, sanitized, and frozen into releases` |
| `ADM-07` | [`scheduleMetadata.spec.ts`](../../tests/e2e/scheduleMetadata.spec.ts) | `the schedule editor keeps proposal and custom scheduling facts visible and accessible` |
| `ADM-07` | [`scheduleMetadata.spec.ts`](../../tests/e2e/scheduleMetadata.spec.ts) | `the selected-session inspector stays aligned and complete from desktop through 320 pixels` |
| `SPK-09` | [`scheduleMetadata.spec.ts`](../../tests/e2e/scheduleMetadata.spec.ts) | `the public agenda and detail expose frozen taxonomy and full speaker details in both languages` |
| `MOB-01` | [`scheduleMetadata.spec.ts`](../../tests/e2e/scheduleMetadata.spec.ts) | `long scheduling facts stay contained at a 320 pixel viewport` |
| `ADM-07` | [`scheduleTaxonomyLabels.spec.ts`](../../tests/e2e/scheduleTaxonomyLabels.spec.ts) | `schedule releases freeze taxonomy labels and refuse a changed form until re-shared` |
| `ADM-07`, `SPK-09` | [`scheduleTaxonomyLabels.spec.ts`](../../tests/e2e/scheduleTaxonomyLabels.spec.ts) | `a legacy release remains visible to its speaker and upgradeable by its admin` |
| `ADM-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `schedule editing stays complete on mobile and reports conflicts inside a focus-contained dialog` |
| `ADM-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `custom programme items can carry or clear a scheduled language` |
| `MOB-01` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `public agenda groups simultaneous rooms and keeps one room chronological on mobile` |
| `SPK-09` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `programme Back restores the exact filtered agenda position` |
| `SPK-09` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `browser Back restores the exact filtered agenda position` |
| `REV-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `staff Back restores a second-day custom item in the newer shared preview` |
| `SPK-09` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `a directly opened session falls back to a normal programme link` |
| `ADM-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `custom programme item speakers are optional, repeatable, removable, and public in order` |
| `ADM-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `custom speaker rows stay aligned and contained across desktop, tablet, mobile, and French` |
| `ADM-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `timeline geometry keeps short custom items readable and distinguishes quarter, half, and hour guides` |
| `ADM-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `room creation supports an exact five-minute drag target, persists allocation, and contains mobile overflow` |
| `ADM-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `duration resize uses five-minute pointer and keyboard steps, persists, and refuses conflicts and day overflow` |
| `ADM-07` | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `a failed resize waits for persistence and leaves the card unchanged` |
| `ADM-07` primary — run once | [`scheduleUx.spec.ts`](../../tests/e2e/scheduleUx.spec.ts) | `sharing and publishing have separate review steps and stale-version guidance` |

Every screenshot path below is relative to:

```text
output/playwright/persona-report/<run-id>/
```

## Route and selector sheet

Selectors use Playwright notation. Replace values in braces with the run
manifest's seeded title, slug, or target email. **No flow in this minimum set is
proved by an end-state screenshot alone**: read-only flows cross multiple pages
or representations, and mutating flows need before/after evidence.

| Flow | Route and required checkpoint text/selector | End state alone? |
|---|---|---|
| `PUB-01` | `/` → `getByRole('link', { name: '{CFP name}' })`; `/c/{cfpId}` → `getByRole('heading', { name: '{CFP name}' })` | No — listing and event context |
| `PUB-04` | Before publication, `/c/{cfpId}` has no Schedule tab and direct `/schedule` → text `The programme has not been published yet.`; after publication → heading `Programme`; after Take offline → unpublished text again | No — private/shared/public/offline comparison |
| `AUTH-01` | `/c/{cfpId}/submit` → buttons `Sign in with Google` and `Email me a link`; after each separate sign-in → `getByRole('textbox', { name: /^Title\b/ })` | No — origin plus both provider destinations |
| `SPK-02` | `/c/{cfpId}/submit` → `locator('.actions__status').getByText('Draft saved')`; after reload → `getByRole('textbox', { name: /^Title\b/ })` with the saved value | No — persistence needs both states |
| `SPK-03` | `/c/{cfpId}/submit` → `locator('[role="alert"]:not(#__next-route-announcer__)')`; success → `getByRole('heading', { name: 'Submitted' })` | No — validation and success |
| `SPK-05` | `/c/{cfpId}/submit` → `getByRole('button', { name: 'Withdraw proposal' })`; native confirmation text `Withdraw this proposal? This cannot be undone.`; success → heading `Withdrawn` | No — guarded destructive transition |
| `SPK-07` | `/c/{cfpId}/submit` → heading `Accepted`, button `I have to decline`, native text `Decline this slot? We will offer it to someone else, so it may not be available if you change your mind.`, button `Yes, I can present`, error `This one is needed.`, then heading `Confirmed` | No — accepted, dismissed, refused, and confirmed states |
| `SPK-09` | Before publication, `/c/{cfpId}/submit` → heading `Your working schedule`, text `Not public`; after publication, `/schedule` → own talk link and `/schedule/{entryId}` → `locator('dl.session-detail__facts')`, heading `Speakers`, and button `Add session to calendar`; filter and deep-scroll once before using programme Back and browser Back; open the detail URL directly once and use its programme link | No — private placement, frozen detail/ICS, both restored return paths, and direct-link fallback must agree |
| `SPK-13` | In separate speaker contexts, `/submit` → `locator('.submission-schedule')`; each contains only its own time and excludes the other title; repeat before/after re-share, then remove one placement from a newer shared preview and require that locator to disappear despite the older public version; abort `getSharedSchedule` and require reload guidance with no old time | No — two identities, three independent versions, and failure recovery |
| `REV-02` | `/c/{cfpId}/review` → textbox `/^Notes for the committee/`, button `3 — Yes`, text `/\d+ of \d+ responded/`, button `Review queue` | No — before, advance, and return |
| `REV-05` | `/c/{cfpId}/review` → textbox `/^Notes for the committee/`; `/c/{cfpId}/schedule` → link `Review talks`; returned textbox must hold the same note | No — local preservation comparison |
| `REV-06` | `/c/{cfpId}/review` → alert heading `Some reviews did not save`, button `Retry save`, button `Open proposal`, then text `Saved` | No — failure and recovery |
| `REV-07` | Active `/schedule` → heading `Committee preview`, texts `Confirmed sessions only` and `Not public`, no calendar-download button; select day two, open a custom item, then programme Back must restore that day and position in the newer shared preview; after revocation the same direct route exposes no preview. Pending/global-only direct calls are denied. | No — active navigation, current shared version, pending, revoked, and global-only comparison |
| `ADM-05` | `/c/{cfpId}/admin/proposals` → headings `Review progress` and `Selected speakers`; filter `getByRole('combobox', { name: 'Status', exact: true })`; missing detail text `/talks? with no response yet/` | No — coverage and decisions must reconcile |
| `ADM-06` | `/c/{cfpId}/admin/proposals` → `locator('.pending-email-notice')`, link `Review and send`; `/admin/email` → heading `Held speaker notifications`, then text `1 email queued.` | No — pending, reviewed, and released states |
| `ADM-07` | `/c/{cfpId}/admin/schedule` → stage headings `Private draft`, `Shared preview`, `Public programme`; scheduling facts for speaker/category/language; `Add room`; `Add programme item` with Scheduled language and Speakers; exact five-minute drop guide; selected-session duration slider and `Edit selected session`; inline conflict/overflow/save-failure feedback; button `Review and share` → dialog `Share this confirmed preview?`; stale text `Share a new preview before publishing.` after a draft or taxonomy change; button `Review and publish` → dialog warning `Proposals are still open`; Take offline alertdialog; public detail → `Cancelled` | No — editor facts/interactions, frozen release data, all three versions, rollback, and cancellation |
| `OWN-01` | `/c/{cfpId}/admin/settings` → heading `Archiving`, button `Archive it`, native text `Archive this call? Nobody will be able to submit, and it disappears from the public list. Any existing public programme stays available at its direct link and is frozen until you bring the event back.`, result `Archived. It is read-only now.`, button `Bring it back` | No — archive and restoration |
| `PLT-02` | `/new` → heading `Create your call for proposals`, button `Create it`; `/c/{newId}/admin/overview` → headings `Finish the essentials before you share` and `Setup checklist` | No — claim, creation, and ownership |
| `PLT-03` | `/platform` → heading `Platform access`, button `Add creator`, row `locator('.people__row').filter({ hasText: '{target email}' })`, button `Remove creator access`; target-owned `/c/{ownedId}/admin/overview` → heading `Setup checklist`; unrelated `/c/{otherId}/admin/overview` → text `That page is not available to your account.` | No — grant, revoke, retained owner, denial |
| `PLT-04` | `/platform` → text `Platform owner`, textbox `/^Administrator email/`, button `Add platform admin`, target row text `Pending verified sign-in`, button `Remove admin access`; unrelated event route → text `That page is not available to your account.` | No — delegation, protection, denial |
| `MOB-01` | `/c/{cfpId}` and `/c/{cfpId}/schedule` at 320×844 → heading `Programme`, comboboxes `Room / track` and `Scheduled language`, simultaneous-room `locator('.agenda-item--card')`, then one-room `locator('.agenda-list--one-room')`; session detail → `locator('dl.session-detail__facts')`, heading `Speakers`, and button `Add session to calendar`; require document width to equal viewport width throughout | No — hero, grouped/chronological agendas, long facts, and detail layout |
| `A11Y-02` | `/c/{cfpId}/review` → text `Score, and move to the next one`, textbox `/^Notes for the committee/`, button `3 — Yes`, button `Review queue`; record spoken changed state | No — focus and announcement sequence |
| `LOC-01` | `/c/{cfpId}/submit` → button `Français`, button `Soumettre la proposition`, error `Ce champ est obligatoire.`, then localized heading `Soumise` | No — locale, validation, and result |

## Public, speaker, and reviewer flows

| Flow · persona · budget | Automated anchor | Manual checkpoint | Required screenshots |
|---|---|---|---|
| `PUB-01` · `ANON-PUBLIC` · `M0` | `platform.spec.ts` — “lists the public calls and not the private ones” | Open `/`, prove private/archived calls are absent, then open the public event and identify its next action. | `anon-public/pub-01--listing--desktop-1440x1000.png`<br>`anon-public/pub-01--event-hero--desktop-1440x1000.png` |
| `PUB-04` · `ANON-PUBLIC` · `M0` | `schedule.spec.ts` — “keeps private, shared, and public schedule releases isolated by audience” | Compare the event and direct Schedule route with only a draft, with only a shared preview, after publication, and after emergency Take offline. Prove the first two expose no title, speaker, room, calendar, or Schedule tab. | `anon-public/pub-04--draft-hidden--desktop-1440x1000.png`<br>`anon-public/pub-04--shared-still-hidden--desktop-1440x1000.png`<br>`anon-public/pub-04--public-agenda--desktop-1440x1000.png`<br>`anon-public/pub-04--offline-again--desktop-1440x1000.png` |
| `AUTH-01` · `ANON-PUBLIC → SPK-DRAFT` · `M1` | `signInLink.spec.ts` — “a link arrives and signs the person in” | Start from the event submission route. In separate contexts, complete Google sign-in and redeem a fresh emulator email link; both must return to the same CFP destination. | `anon-public/auth-01--signed-out-origin--desktop-1440x1000.png`<br>`anon-public/auth-01--google-destination--desktop-1440x1000.png`<br>`anon-public/auth-01--email-link-destination--desktop-1440x1000.png` |
| `SPK-02` · `SPK-DRAFT` · `M1` | `draft.spec.ts` — “a draft survives a reload” | Edit one talk field, wait for saved status, reload, then switch talks/CFPs and confirm no field crosses tenants. | `spk-draft/spk-02--draft-saved--desktop-1440x1000.png`<br>`spk-draft/spk-02--same-draft-after-reload--desktop-1440x1000.png` |
| `SPK-03` · `SPK-DRAFT` · `MT` | `submit.spec.ts` — “a complete proposal submits and stays on screen” | In a disposable tenant, submit incomplete, capture localized errors, correct every required field/question, and submit. | `spk-draft/spk-03--validation-summary--desktop-1440x1000.png`<br>`spk-draft/spk-03--submitted-state--desktop-1440x1000.png` |
| `SPK-05` · `SPK-SUBMITTED` · `M1` | `submit.spec.ts` — “a submitted proposal can be withdrawn” | Capture the ready state, dismiss the native confirmation once, accept it on the second attempt, reload, and verify Save/Submit is absent. The anchor asserts the native dialog; a page screenshot does not capture browser chrome. | `spk-submitted/spk-05--withdraw-ready--desktop-1440x1000.png`<br>`spk-submitted/spk-05--withdrawn-after-reload--desktop-1440x1000.png` |
| `SPK-07` · `SPK-ACCEPTED` · `M1` | `confirm.spec.ts` — “an accepted speaker confirms, and it sticks across a reload” | Capture accepted guidance, dismiss the native Decline confirmation without changing state, prove a missing required confirmation answer preserves Accepted, complete it, and confirm. | `spk-accepted/spk-07--accepted-decision--desktop-1440x1000.png`<br>`spk-accepted/spk-07--required-error--desktop-1440x1000.png`<br>`spk-accepted/spk-07--confirmed-result--desktop-1440x1000.png` |
| `SPK-09` · `SPK-CONFIRMED` · `M0` | Primary: `schedule.spec.ts` — “an accepted speaker confirms and follows their shared session into the published calendar file”. Companions: `scheduleMetadata.spec.ts`, `scheduleTaxonomyLabels.spec.ts`, and the three public Back/fallback titles mapped above. | Before publication, capture the explicitly private own-placement card. After publication, find that entry from a filtered, deep-scrolled Schedule; inspect frozen taxonomy and full speaker detail; return through programme Back and browser Back and compare day/filter/position; verify a directly opened detail uses a normal programme link. Download the session ICS and compare date/time/zone/room/language/title/UID. Keep the `.ics` beside the screenshots. | `spk-confirmed/spk-09--working-placement--desktop-1440x1000.png`<br>`spk-confirmed/spk-09--agenda-own-talk--desktop-1440x1000.png`<br>`spk-confirmed/spk-09--session-full-detail-calendar--desktop-1440x1000.png`<br>`spk-confirmed/spk-09--programme-back-restored--desktop-1440x1000.png`<br>`spk-confirmed/spk-09--browser-back-restored--desktop-1440x1000.png`<br>`spk-confirmed/spk-09--direct-link-fallback--desktop-1440x1000.png` |
| `SPK-13` · `SPK-CONFIRMED + SPK-CONFIRMED-OTHER` · `M0` | `schedule.spec.ts` — “a shared schedule exposes only each confirmed speaker's own placement” and “does not fall back to an obsolete public placement after a speaker is removed from the shared preview” | In separate browser contexts, prove each working card contains its own placement and excludes the other speaker, tentative talks, custom items, and an unshared draft move. Re-share and capture the newly visible time. Finally remove one placement from a newer shared preview while the old public version stays live; My proposals must show no stale time. Repeat with `getSharedSchedule` unavailable and require recovery guidance instead of the old time. | `spk-confirmed/spk-13--own-only-before--desktop-1440x1000.png`<br>`spk-confirmed-other/spk-13--own-only-before--desktop-1440x1000.png`<br>`spk-confirmed/spk-13--draft-change-hidden--desktop-1440x1000.png`<br>`spk-confirmed/spk-13--reshared-placement--desktop-1440x1000.png`<br>`spk-confirmed/spk-13--removed-no-public-fallback--desktop-1440x1000.png`<br>`spk-confirmed/spk-13--shared-load-warning--desktop-1440x1000.png` |
| `REV-02` · `REVIEWER` · `M1` | `deck.spec.ts` — “a comment written before scoring is saved with the score” | Enter a note containing a digit, score with the keyboard outside the field, wait for the counter/advance, then return through the queue. | `reviewer/rev-02--before-score--desktop-1440x1000.png`<br>`reviewer/rev-02--counter-next-card--desktop-1440x1000.png`<br>`reviewer/rev-02--queue-state--desktop-1440x1000.png` |
| `REV-05` · `REVIEWER` · `MB` | `deck.spec.ts` — “an unscored note survives leaving and returning to review” | Type an unscored note, navigate to Schedule and back, and prove the same proposal and local note return without a review write. | `reviewer/rev-05--note-before-navigation--desktop-1440x1000.png`<br>`reviewer/rev-05--restored-note--desktop-1440x1000.png` |
| `REV-06` · `REVIEWER` · `M1` | `deck.spec.ts` — “a failed score save keeps its exact proposal, note, and score for retry” | Fail only the next `saveReview` callable, preserve note/score and proposal identity, remove interception, retry once, and prove the successful write. | `reviewer/rev-06--note-before-save--desktop-1440x1000.png`<br>`reviewer/rev-06--save-failure--desktop-1440x1000.png`<br>`reviewer/rev-06--successful-recovery--desktop-1440x1000.png` |
| `REV-07` · `REVIEWER + REVIEWER-PENDING + REVIEWER-REVOKED + PLATFORM-GLOBAL-ONLY` · `MX` | Primary: `schedule.spec.ts` — “committee preview follows active event membership and remains read only”. Companion: `scheduleUx.spec.ts` — “staff Back restores a second-day custom item in the newer shared preview”. | Capture the active reviewer’s confirmed-only programme and privacy labels. On day two, open a custom item and prove programme Back restores the newer shared preview and exact position rather than an older public release. Prove tentative entries and calendar actions are absent, then revoke the role and capture the denied route. Record direct-call denials for pending and global-only accounts as companion text evidence. | `reviewer/rev-07--committee-preview--desktop-1440x1000.png`<br>`reviewer/rev-07--second-day-back-restored--desktop-1440x1000.png`<br>`reviewer-revoked/rev-07--preview-denied--desktop-1440x1000.png`<br>Companion: `reviewer/rev-07--access-matrix--desktop-1440x1000.txt` |

## Admin, owner, platform, and cross-cutting flows

| Flow · persona · budget | Automated anchor | Manual checkpoint | Required screenshots |
|---|---|---|---|
| `ADM-05` · `EVENT-ADMIN` · `MT` | `reviewBackend.spec.ts` — “reports missing, scored and conflicted work without exposing the admin’s own talk” | In a disposable tenant, compare coverage with decisions/selection, include withdrawn filter once, and verify missing/scored/conflicted labels and counts agree. | `event-admin/adm-05--coverage--desktop-1440x1000.png`<br>`event-admin/adm-05--decisions--desktop-1440x1000.png`<br>`event-admin/adm-05--selected-speakers--desktop-1440x1000.png` |
| `ADM-06` · `EVENT-ADMIN` · `MX` | `email.spec.ts` — “a saved decision is visibly pending until an admin reviews the email batch” | Save one decision, follow the waiting-notification guidance, preview/release only the reviewed dry-run batch, and verify the pending callout clears. | `event-admin/adm-06--pending-callout--desktop-1440x1000.png`<br>`event-admin/adm-06--batch-preview--desktop-1440x1000.png`<br>`event-admin/adm-06--post-release-log--desktop-1440x1000.png` |
| `ADM-07` · `EVENT-ADMIN` · `MX` | Primary: `scheduleUx.spec.ts` — “sharing and publishing have separate review steps and stale-version guidance”. Run the relevant `ADM-07` schedule companion anchors above for editor facts, custom data, timeline geometry, room/drop, resize, persistence failure, and release snapshots. | Capture scheduling facts before placement; add a room; create a short custom item with language and ordered optional speakers; drag to an exact five-minute target; resize by pointer and keyboard; capture conflict/day-overflow and failed-save recovery without changing the prior card. Then capture all three stage cards, the confirmed-only share review, taxonomy/draft staleness, the open-CFP publication warning, public version, emergency offline confirmation, and a stable cancelled session. Reconcile held-email preview before/after publishing to prove one actionable notification per actual speaker change. | `event-admin/adm-07--editor-facts--desktop-1440x1000.png`<br>`event-admin/adm-07--custom-language-speakers--desktop-1440x1000.png`<br>`event-admin/adm-07--new-room-five-minute-drop--desktop-1440x1000.png`<br>`event-admin/adm-07--duration-resized--desktop-1440x1000.png`<br>`event-admin/adm-07--resize-refused-unchanged--desktop-1440x1000.png`<br>`event-admin/adm-07--mobile-custom-speaker-alignment--phone-390x844.png`<br>`event-admin/adm-07--three-private-stages--desktop-1440x1000.png`<br>`event-admin/adm-07--share-review--desktop-1440x1000.png`<br>`event-admin/adm-07--stale-shared-preview--desktop-1440x1000.png`<br>`event-admin/adm-07--open-cfp-publish-warning--desktop-1440x1000.png`<br>`event-admin/adm-07--live-agenda--desktop-1440x1000.png`<br>`event-admin/adm-07--offline-confirmation--desktop-1440x1000.png`<br>`event-admin/adm-07--cancelled-session--desktop-1440x1000.png` |
| `OWN-01` · `EVENT-OWNER` · `MX` | `platform.spec.ts` — “an archived call refuses a submission, and un-archiving takes it back” | In the disposable tenant, capture the archive warning, archive, prove listing/mutations are frozen, then restore. | `event-owner/own-01--archive-warning--desktop-1440x1000.png`<br>`event-owner/own-01--archived-state--desktop-1440x1000.png`<br>`event-owner/own-01--restored-state--desktop-1440x1000.png` |
| `PLT-02` · `PLATFORM-CREATOR-PENDING → PLATFORM-CREATOR` · `MT` | `platform.spec.ts` — “signing in and starting one makes you its owner” | Claim the exact-email creator grant, create the disposable CFP, then verify owner workspace and resumable home task. | `platform-creator-pending/plt-02--creator-access--desktop-1440x1000.png`<br>`platform-creator-pending/plt-02--created-event--desktop-1440x1000.png`<br>`platform-creator-pending/plt-02--home-task-card--desktop-1440x1000.png` |
| `PLT-03` · `PLATFORM-ADMIN + PLATFORM-CREATOR-TARGET` · `MX` | `platformAccess.spec.ts` — “an admin grants and revokes future creation without taking away an owned CFP” | Grant/claim/revoke creator, prove its pre-existing event ownership remains, then prove the platform admin is denied an unrelated event. | `platform-admin/plt-03--pending-creator--desktop-1440x1000.png`<br>`platform-admin/plt-03--active-creator--desktop-1440x1000.png`<br>`platform-admin/plt-03--revoked-creator--desktop-1440x1000.png`<br>`platform-admin/plt-03--retained-ownership--desktop-1440x1000.png`<br>`platform-admin/plt-03--unrelated-event-denial--desktop-1440x1000.png` |
| `PLT-04` · `PLATFORM-OWNER + PLATFORM-ADMIN-TARGET` · `MX` | `platformAccess.spec.ts` — “an owner delegates administrators while every event remains separately authorised” | Delegate/claim/revoke platform admin, inspect protected owner state, and prove neither platform identity gains event access. | `platform-owner/plt-04--owner-controls--desktop-1440x1000.png`<br>`platform-owner/plt-04--pending-admin--desktop-1440x1000.png`<br>`platform-owner/plt-04--active-admin--desktop-1440x1000.png`<br>`platform-owner/plt-04--protected-owner-state--desktop-1440x1000.png` |
| `MOB-01` · `ANON-PUBLIC + LENS-MOBILE` · `MB` | Primary: `schedule.spec.ts` — “the public agenda stays within a narrow mobile viewport”. Companions: `scheduleUx.spec.ts` — “public agenda groups simultaneous rooms and keeps one room chronological on mobile”; `scheduleMetadata.spec.ts` — “long scheduling facts stay contained at a 320 pixel viewport”. | At 320×844, inspect event hero, prove simultaneous rooms are grouped by start time, filter to one room and prove chronological order, then open a session with long taxonomy and speaker facts. Require document width to equal viewport width throughout. | `anon-public/mob-01--event-hero--phone-320x844.png`<br>`anon-public/mob-01--simultaneous-rooms--phone-320x844.png`<br>`anon-public/mob-01--one-room-timeline--phone-320x844.png`<br>`anon-public/mob-01--long-session-detail--phone-320x844.png` |
| `A11Y-02` · `REVIEWER + LENS-KEYBOARD + LENS-SCREENREADER` · `M1` | `deck.spec.ts` — “the shortcut list can be opened from the keyboard” | With mouse unused, open shortcuts, type a numeric note, score/advance, return through queue, and verify VoiceOver speaks the changed state. | `reviewer/a11y-02--shortcuts--desktop-1440x1000.png`<br>`reviewer/a11y-02--focused-next-card--desktop-1440x1000.png`<br>`reviewer/a11y-02--queue--desktop-1440x1000.png`<br>Companion: `reviewer/a11y-02--spoken-state--desktop-1440x1000.txt` |
| `LOC-01` · `SPK-DRAFT + LENS-BILINGUAL` · `M1` | `submit.spec.ts` — “errors are in the language the page is in” | Switch to French, reload, trigger/fix localized validation, submit one configured French choice, and verify canonical stored state plus localized date/status. | `spk-draft/loc-01--french-form--desktop-1440x1000.png`<br>`spk-draft/loc-01--french-validation--desktop-1440x1000.png`<br>`spk-draft/loc-01--french-result--desktop-1440x1000.png` |

## Coverage caveats

- `ADM-05` and `OWN-01` have strong enforcement anchors, but those anchors are
  backend-oriented and cannot provide the required UI screenshots.
- `AUTH-01`, `SPK-03`, `SPK-07`, `REV-02`, `A11Y-02`, and `LOC-01` deliberately
  cover more in the manual checkpoint than one primary automated title can
  express. Their broader suite mappings remain in the handbook.
- VoiceOver output is manual evidence; a DOM/accessibility-tree assertion does
  not replace the required transcript. Compare against the current native
  [`voiceover-baseline.md`](voiceover-baseline.md).

These are coverage boundaries, not flow-ID, persona, budget, or screenshot
contract mismatches with the handbook.
