# Critical 17-step CFP journey

This is the release traceability contract for the platform's complete event
lifecycle. It preserves the requested sequence verbatim and maps each step to
the personas, state transition, disclosure boundary, and regression evidence
that must agree. Use it with the broader
[`persona-flow-handbook.md`](persona-flow-handbook.md), not instead of it.

Run this journey only in an emulator or disposable project. Keep one browser
context per identity, record the immutable schedule release IDs, and finish the
observation pass before fixing a failure.

The continuous automated seam is `criticalPath.spec.ts`, “the same proposals
survive the full initial and late-intake lifecycle through archive”. Recipient
filtering and release dedupe are pinned by `staffNotifications.spec.ts`, “a
submitted proposal notifies each eligible active event staff member once
without private proposal data” and “a shared preview notifies current staff
once per release while publish sends nothing”. That suite also pins pending
committee invitation identity and revocation with “a pending committee invite
dedupes role edits, becomes stale on revoke, and re-invite gets a fresh
authenticated link”. The monotonic review lock is pinned by `deck.spec.ts`,
“the first real review freezes talk content and deleting the review does not
reopen it”. Focused suites in the table retain the edge cases that should not
make the continuous test larger or less diagnostic.

## Verbatim requested sequence

The source wording is retained here exactly; the traceability table below uses
separate product language so corrections never rewrite the request silently.

> 1. Admin creates cfp and configure an cfp
> 2. Speakers submit cfps.
> 3. Comittee reviews cfps.
> 4. Admin accepts and rejects cfps
> 5. Speakers get notified and confirm with t-shirts size, headshot photos and different required confirmation forms.
> 6. Admin starts creating schedules.
> 7. Comitees and speakers get notified
> 8. Speakers and comitees starts reviewing it.
> 9. Cfp closed.
> 10. Admin makes the schedule public.
> 11. Admin decides to take some more last moment speakers.
> 12. Take more cfps from speakers.
> 13. Comittee reviews.
> 14. Accepts and rejects some.
> 15.  Speakers get notified and confirm.
> 16. Admin adds the into the public schedule.
> 17. Event is done.

## Product interpretation and traceability

| Step | Normalized product interpretation | Personas and product transition | Required result and boundary | Automated evidence |
|---:|---|---|---|---|
| 1 | Admin creates/configures CFP | `PLATFORM-CREATOR` creates the call and becomes `EVENT-OWNER`; the owner configures event details, submission and confirmation forms, roles, intake window, email, and schedule inputs. | Creation is authorised by platform access, but platform access alone grants no event data. The new call has one event owner, stable form keys, an explicit bounded intake window, and no public schedule. A pending committee grant queues one generic authenticated invitation; editing the role retains its invitation identity, revocation makes it unsendable, and a later re-invite gets a new identity. | `platform.spec.ts`; `submissionForm.spec.ts`; `confirmForm.test.ts`; `confirm.spec.ts`; `roles.spec.ts`; `staffNotifications.spec.ts`; `window.spec.ts` |
| 2 | speakers submit proposals | `SPK-INITIAL-ACCEPTED` and `SPK-INITIAL-REJECTED` complete the configured submission form and submit their own proposals. | Each proposal is owned by its speaker, receives one frozen speaker snapshot and one receipt, and becomes ready for the active committee. No admin-created speaker proposal or consent bypass exists. Active claimed event staff receive one generic ready-for-review notice per proposal and recipient; pending, revoked, global-only, and self-proposal recipients do not. | `criticalPath.spec.ts`; `staffNotifications.spec.ts`; `submit.spec.ts`; `submissionForm.spec.ts` |
| 3 | committee reviews | `REVIEWER` scores both eligible proposals; `REVIEWER-SELF-SPEAKER` cannot review their own. | The first committed committee review atomically moves `submitted` to `under_review`, freezing speaker talk content. A concurrent withdrawal or decision wins instead of being overwritten, and later review deletion never reopens editing. | `criticalPath.spec.ts`; `deck.spec.ts`; `reviewBackend.spec.ts`, “a concurrent withdrawal or decision is never overwritten by the first review” |
| 4 | admin accepts/rejects | `EVENT-ADMIN` accepts one initial proposal and rejects the other. | Only an event admin changes decision status. Each current decision has one held speaker notification; saving or undoing a decision never sends early or duplicates it. | `journey.spec.ts`; `roles.spec.ts`; `email.spec.ts` |
| 5 | speakers are notified and confirm with T-shirt/headshot/other required confirmation fields | `EVENT-ADMIN` previews and releases the decision batch. `SPK-INITIAL-ACCEPTED` signs in from the authenticated deep link, uploads the configured headshot, selects the required T-shirt value, answers another required field, and confirms. The rejected speaker sees the final result and no confirmation form. | Release contains only the reviewed current decisions. Confirmation remains `accepted` until every current required answer and required image exists; success stores canonical answers and changes only the speaker's own proposal to `confirmed`. | `criticalPath.spec.ts`; `email.spec.ts`; `confirm.spec.ts` |
| 6 | admin starts schedule | `EVENT-ADMIN` configures days, rooms, and time zone, then places the confirmed initial talk in the private draft. | Draft editing is admin-only and revision checked. Anonymous visitors, speakers, and committee members cannot read the live draft. | `schedule.spec.ts`; `scheduleUx.spec.ts`; schedule rules tests |
| 7 | committee and speakers are notified | `EVENT-ADMIN` shares the confirmed preview, reviews the held placement batch, and releases it. | Sharing creates one immutable confirmed-only release. Active claimed event admins/reviewers receive one immediate, generic preview-ready notice per release and recipient. Speaker placement messages remain held until the organiser explicitly releases them; the journey verifies delivery before either audience starts reviewing. The acting sharer, pending/revoked/global-only members, and duplicate delivery attempts are excluded. | `criticalPath.spec.ts`; `staffNotifications.spec.ts`; `schedule.spec.ts`; `email.spec.ts` |
| 8 | they review it | `SPK-INITIAL-ACCEPTED` checks My proposals; `REVIEWER` opens the committee preview. | The speaker sees only their own referenced day, room, time, and language with explicit not-public copy. The committee sees the complete confirmed, public-safe, read-only preview. Neither audience sees tentative sessions or the live draft. | `schedule.spec.ts`; `scheduleUx.spec.ts` |
| 9 | CFP closes | `EVENT-ADMIN` lets the configured deadline pass or closes the current window. `ANON-PUBLIC` and a new speaker inspect the call; existing speakers reopen their records. | New drafts/submissions are blocked server-side and the UI explains closure. Existing proposals, reviews, confirmations, and private/shared schedule work remain reachable to authorised identities. | `criticalPath.spec.ts`; `window.spec.ts`; `cfpPage.spec.ts` |
| 10 | admin publishes schedule | `EVENT-ADMIN` reviews and promotes the exact current shared release. `ANON-PUBLIC` opens the programme. | Publication cannot snapshot a dirty draft or stale preview. The immutable public pointer exposes public-safe metadata and entries only. Promotion sends no new placement or staff notification and the open/closed CFP state does not change programme access. | `schedule.spec.ts`; `scheduleUx.spec.ts`; schedule unit/rules tests |
| 11 | admin adds last-minute speakers | `EVENT-ADMIN` makes the explicit decision to open a short, bounded late-intake window. | This step is an intake decision, not an admin-authored proposal. The UI states the new opening and deadline; no organiser can invent a speaker, accept on their behalf, or bypass confirmation. | `criticalPath.spec.ts`; `window.spec.ts` |
| 12 | reopen/take more proposals | `SPK-LATE-ACCEPTED` and `SPK-LATE-REJECTED` self-submit during the bounded late window; an after-deadline attempt is refused. | Reopening affects new speaker submissions only inside the configured interval. Initial proposals, decisions, schedule release IDs, and notification history remain unchanged. New valid submissions produce their own deterministic receipt and ready-for-review staff notices. | `criticalPath.spec.ts`; `staffNotifications.spec.ts`; `window.spec.ts`; `submit.spec.ts` |
| 13 | committee reviews | `REVIEWER` reviews the new eligible proposals after the first public programme already exists. | The same own-talk exclusion, first-review transition, lifecycle lock, privacy, and deterministic staff-notification rules apply in the second intake. Earlier reviews and aggregates are not reset. | `criticalPath.spec.ts`; `deck.spec.ts`; `reviewBackend.spec.ts` |
| 14 | accept/reject | `EVENT-ADMIN` accepts one late proposal and rejects the other. | Initial decisions and the current public programme are unchanged. Exactly one current held decision notification exists per newly decided proposal. | `roles.spec.ts`; `email.spec.ts`; critical-path seam regression |
| 15 | notify/confirm | `EVENT-ADMIN` releases only the newly reviewed decision messages. `SPK-LATE-ACCEPTED` completes the same current required confirmation form and confirms. | Previously sent decision mail is not resent. Required T-shirt, headshot, and other answers are enforced for the late speaker exactly as they were for the initial speaker. | `email.spec.ts`; `confirm.spec.ts`; critical-path seam regression |
| 16 | add them to public schedule | `EVENT-ADMIN` adds the late confirmed talk to the private draft, shares a new preview, then publishes that exact release. | The prior public version stays stable until promotion. The new release contains both confirmed talks, preserves existing entry identity/calendar UID, creates only the new or genuinely changed held speaker placement messages and one staff preview notice per eligible recipient, and publication adds no duplicate. | `criticalPath.spec.ts`; `staffNotifications.spec.ts`; `schedule.spec.ts`; `scheduleUx.spec.ts` |
| 17 | event done | `EVENT-OWNER` revokes obsolete committee access and archives the CFP after the event. | Archive freezes event mutations and unlists the CFP while retaining the direct historical public programme. Revoked staff lose private review, preview, and admin access and receive no later staff notices; public history remains public. | `criticalPath.spec.ts`; `platform.spec.ts`; `confirm.spec.ts`; `schedule.spec.ts`; `roles.spec.ts` |

## Additional notification requirement

“Admins and committee are notified when new proposals are ready for review” is
part of steps 2 and 12, not an out-of-band eighteenth lifecycle step. Test it
against this recipient matrix for both intake rounds:

| Recipient state | Proposal ready for review | Schedule preview shared |
|---|---:|---:|
| Active claimed event owner/admin/reviewer | Yes, unless they speak on that proposal | Yes, unless they are the acting sharer |
| Proposal author who also has an event role | No | Yes, unless they are the acting sharer |
| Acting sharer | Not applicable | No |
| Pending event invitation | No | No |
| Revoked former event member | No | No |
| Global platform owner/admin/creator without an event role | No | No |
| Anonymous or unverified identity | No | No |

Every staff notice must use generic copy that contains no proposal title,
speaker name, email, score, room, or time. Its deep link requires
authentication and stays inside the selected CFP. Dedupe is deterministic by
event, event occurrence (proposal or immutable release), notice kind, and
recipient; retries may update delivery state but cannot create another logical
notice.

## Cross-cutting checkpoints

Run these lenses against both the initial and late-intake seams:

| Lens | Required checkpoints |
|---|---|
| Mobile | At 320×844 and 390×844, the submission/confirmation forms, notification guidance, review deck, schedule stage cards/dialogs, speaker placement, committee preview, and public agenda have no horizontal overflow or unreachable action. |
| Keyboard and screen reader | First error receives focus; review scoring and dialogs work without a pointer; state changes and route changes are announced once; destructive archive and publication actions restore focus meaningfully. |
| French | Submission/confirmation validation, decision and staff-email copy, ready-for-review guidance, shared-preview disclosure, CFP close/reopen copy, schedule publication, and archive state are localized without changing stored codes or authorization. |

## Release evidence

Record one row per run with commit SHA, fixture slug, initial and late window
timestamps, initial and late proposal IDs, first and second shared/public
release IDs, staff-notice IDs by recipient, speaker-notice IDs, archive state,
and role-revocation time. A failure report must name the canonical step, exact
persona, expected transition, observed transition, and screenshot or text
evidence path.
