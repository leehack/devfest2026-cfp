# DevFest Montréal 2026 — CFP Platform Spec

Working document for the CFP (Call for Proposals) system. Covers the platform decision, hosting cost, form design, data model, review workflow, and the selection process.

**Status:** draft · **Last updated:** July 2026

---

## 1. Platform decision

We are building rather than adopting, because the event charges for tickets and the hosted options price accordingly.

| Option | Why we passed / kept it |
|---|---|
| **Sessionize** | Free community licence requires a free event. Paid events fall outside it. They do offer a reduced rate for low-priced tickets (under ~50 USD) — worth an email before committing to a build. |
| **Pretalx** | Open source, self-hosted, no per-event fee regardless of ticket price. Covers submission, review, and notification out of the box. **Still the pragmatic fallback if the timeline gets tight.** |
| **Custom (this spec)** | Chosen. Gives us the bilingual handling, the GDE travel-funding fields, and the review UX we want. |

> **Timeline check.** A CFP normally opens 4–5 months before the event and stays open 6–8 weeks. Confirm the event date first. If there is less than ~3 months of runway before the CFP must open, deploy Pretalx instead and revisit the custom build for 2027.

---

## 2. Hosting and cost

Target: Firebase, running at effectively zero cost.

### The Blaze plan is unavoidable

Cloud Functions cannot make outbound calls to third-party services on the Spark plan, and sending acceptance/rejection email requires exactly that. Blaze retains the same free quotas as Spark — the bill stays at zero as long as we stay inside them — but it requires a card on file. New projects typically come with introductory credit as well.

Cloud Storage also requires Blaze as of February 2026, which matters if we accept file uploads.

### Expected usage vs free quota

At our scale (~200 proposals, ~10 reviewers, ~400 emails) every quota has significant headroom:

| Service | Free quota | Our estimate |
|---|---|---|
| Firestore reads | 50k / day | Well under, **if** the review dashboard is built correctly (see below) |
| Firestore writes | 20k / day | ~2k total |
| Cloud Functions | 2M invocations / month | Low hundreds |
| Hosting transfer | 360 MB / day | Fine for a form + dashboard |

### Email provider

| Provider | Free tier | Note |
|---|---|---|
| **Resend** | 3,000/month, 100/day, 1 domain | Cleanest API. The daily cap is the problem — see below. |
| **Brevo** | 300/day, no card required | Free tier adds their branding to the message. |

**The daily cap is a real constraint.** Decision emails go out in one batch. With 200 applicants, Resend's 100/day limit splits the batch across two days, and staggered accept/reject notices look unfair to applicants. Options, in order of preference:

1. Pay for Resend Pro (~$20) for the single month we send decisions, then cancel.
2. Use Brevo for the decision batch (300/day).
3. Queue and stagger — acceptable only if every applicant in a given tier is notified in the same window.

The deployed platform uses one provider account and credential. Only a verified
platform owner or administrator may rotate that shared key. Each Resend domain
id is exclusively bound to one CFP; event admins manage their own bound domain,
sender and wording but cannot adopt an existing unbound domain by name.

### Gotchas to handle before launch

- **Domain authentication (SPF/DKIM) is mandatory.** Without it, decision emails land in spam wholesale. This is the single most common operational failure in CFP tooling.
- **Set a billing alert** (~$5) in the Google Cloud console. Blaze does not cap spend; it bills past the free quota silently.
- **Do not attach `onSnapshot` listeners to proposal list views.** Ten reviewers refreshing a live-listening list view will burn through 50k daily reads quickly. Use paginated `getDocs` for lists; reserve realtime for single-document views.

---

## 3. Form design

### Principle: split submission from post-acceptance

Anything not needed to evaluate the proposal is collected *after* acceptance. This keeps the submission form to roughly one screen, cuts abandonment, and avoids holding personal data on the ~70% of applicants we will reject.

### Collected at submission

**Proposal — this is what gets reviewed**

| Field | Type | Notes |
|---|---|---|
| `title` | string | 100 char limit |
| `abstract` | string | 200–1,200 chars. Published verbatim in the public programme |
| `pitch` | string | Optional, committee-only. Why this talk, why this speaker. Without it, borderline proposals are hard to judge |
| `category` | enum | App Dev · AI & ML · Cloud · Web · UI & UX · Soft Skills & Career · Other |
| `format` | enum | Session 40min · Lightning 15min · Workshop 90min |
| `deliveryLanguage` | enum | `en` · `fr` · `either` · `bilingual` — see §4 |
| `languagePreference` | string | Conditional: only when `deliveryLanguage = either` |
| `level` | enum | Beginner · Intermediate · Advanced · All levels |

Organisers may add custom questions about the talk. Their answers are shown to
reviewers by default, preserving existing forms, but each question has an
explicit reviewer-visibility switch for information intended only for event
organisers. Core proposal fields remain reviewable; acknowledgements never enter
the reviewer payload.

**Speaker**

| Field | Type | Notes |
|---|---|---|
| `name` | string | |
| `bio_en` / `bio_fr` | string | One required, the other optional |
| `company`, `jobTitle` | string | Not required — independents and between-jobs applicants exist |
| `basedIn` | string | City + region |
| `socials` | array | `[{platform, handle}]` — an array is more flexible than fixed columns |
| `isGde` | boolean | Triggers conditional guidance in the form |
| `pastTalks` | string | Optional links to recordings. Reference material, not a filter against new speakers |
| `profilePhoto` | private server pointer | Optional reusable account photo, editable from the profile page or the proposal's account-profile section; never part of the committee snapshot |

**Acknowledgements — every configured checkbox is required**

The DevFest Montréal compatibility form asks for:

- `ackNoTravelSupport` — "I understand that travel and accommodation are not covered by the event."
- `ackCoC` — Code of Conduct
- `ackRecording` — consent to be recorded and published

New generic CFPs omit `ackNoTravelSupport`; organisers own the acknowledgement
list. **Attendance** is also optional per CFP (see §5). In the DevFest template
it follows these checkboxes because the question reads naturally once the
no-travel-support statement is on screen.

### Collected after acceptance

| Field | Why it waits |
|---|---|
| `programme photo approval` | A reusable account photo may already exist, but the event may require one here and freezes the exact speaker-approved generation only after acceptance |
| `tshirtSize` | No reason to hold shirt sizes for 200 rejected applicants |
| `dietaryNeeds` | Same |
| `slidesUrl` | Due shortly before the event |

An individually confirmed speaker may later receive a session-scoped profile
update request. The organiser chooses public profile details, programme photo,
or both. The platform emails the exact session link, badges that talk for the
speaker, and keeps a waiting/ready organiser queue; a copied link remains a
fallback. The speaker owns the update and explicitly adopts each requested item
into that session. A profile comparison is versioned, so an organiser cannot
apply a different account profile than the one they reviewed. Ready requests
remain visible until the session is included in a new shared schedule release.

### Conditional fields

Three places where the DevFest form reveals fields dynamically. Build these as
one shared component:

1. attendance enabled and `isGde = true` → show this CFP's optional GDE guidance (§5)
2. attendance and the corresponding subfield enabled, with `status = secured | pending` → show funding source / decision date
3. `deliveryLanguage = either` → show language preference

---

## 4. Language fields

> **Amended 26 July 2026.** Two decisions overrule what follows:
>
> 1. **`bilingual` is now an allowed value** — a speaker who alternates between
>    languages during the talk. This is case 4 below, which this section argued
>    against. The predicted consequence has not gone away; it has moved from the
>    form to the programme, so bilingual sessions must be labelled as such on the
>    public schedule and the submission form now says so to the applicant.
> 2. **`slideLanguage` is removed from the model entirely** — not deferred to
>    post-acceptance, deleted. Cases 1 and 2 below are therefore no longer
>    expressible, and the programme cannot show slide language at all.
>
> `deliveryLanguage` is now `en | fr | either | bilingual`, and it is the only
> language field. The original analysis is kept below because the reasoning
> still describes the trade-off being accepted.

A single "bilingual" option cannot be used, because applicants mean at least four different things by it:

1. Speaks French, slides in English — **the most common combination in Montréal**
2. Speaks English, slides in French
3. Can present in either language; organisers choose
4. Switches between languages mid-talk

Cases 1–3 are fine. **Case 4 is a bad attendee experience** — anyone comfortable in only one language loses half the talk. A single field lets case 4 in and leaves us unable to label the session on the public programme.

### Two fields instead

```
deliveryLanguage: 'en' | 'fr' | 'either'
slideLanguage:    'en' | 'fr'
```

The combination expresses cases 1 and 2 naturally, and case 4 has no way to be selected. Add one line of form help text:

> Please do not alternate between languages during your talk — attendees will lose the thread.

### `either` is a scheduling asset

Speakers who can present in either language are the cards that fill gaps when building the schedule. If the French track is thin, they go there. Track this as a distinct enum value and surface the count on the selection dashboard — it is the first thing you reach for when the track balance is off.

When `either` is selected, an optional `languagePreference` line opens. Better to capture a soft preference now than to hear "actually I'd rather do French" after assignments go out.

### On the public programme

**Show the delivery language prominently, next to the session title.** It is the most practical filter attendees have, and burying it is a guaranteed complaint at a Montréal event. Slide language belongs in the session detail page, set small.

Sessions submitted as `either` must display a **resolved** language once assigned. "Flexible" on a public schedule means nobody can plan their day.

---

## 5. Attendance and travel

> **Amended 12 August 2026.** Attendance is an optional, per-CFP part of the
> submission form. The organiser owns its bilingual section title, question,
> help, status labels, funding-source copy, decision-date copy, visa copy and
> optional GDE guidance. Funding source, decision date and visa support can each
> be collected or omitted. Status and every enabled subfield have independent
> reviewer-visibility switches, enforced by the review callable rather than only
> by the screen.
>
> The stored status codes remain `local`, `secured` and `pending`; their meaning
> drives validation, dashboards and exports, so an organiser relabels them rather
> than inventing new codes. A missing attendance configuration keeps the legacy
> DevFest Montréal behaviour. Newly created generic CFPs are explicitly seeded
> with attendance disabled and without the travel-support acknowledgement.
> Disabling collection does not silently purge historical answers, but disabled
> values are not newly validated or projected to reviewers. Late co-speaker
> invitations use the same current form. Acceptance email visa guidance appears
> only when the visa question is enabled and the speaker answered yes.

The remainder of this section records the enabled DevFest Montréal template.
This event does not fund travel, and it needs to know whether an accepted speaker
will actually be on stage.

### Ask in a way that produces a real answer

"Can you attend?" gets a yes from everyone. Instead, force the funding path into the open with a required radio group:

| Value | Applicant-facing wording |
|---|---|
| `local` | I'm based in the Montréal area — no travel required |
| `secured` | My travel and accommodation are already covered (employer, GDE program, or self-funded) |
| `pending` | I expect to arrange it but it isn't confirmed yet |

`secured` opens a free-text `fundingSource` — "employer conference budget", "applying to the GDE program". **Requiring them to write something concrete is itself the filter.** Applicants who are vaguely optimistic drift down to `pending` on their own.

`pending` opens a `decisionBy` date. If that date falls after our programme lock date, the applicant is a waitlist candidate.

```
attendance: {
  status,          // enum, required
  fundingSource,   // string, when secured | pending
  decisionBy,      // date, when pending
  needsVisa,       // boolean
}
```

### GDE guidance

Show this **only** when `isGde = true` — displaying it to everyone just confuses non-GDE applicants:

> GDEs should contact their GDE program manager regarding travel support. This event does not provide it directly.

### Don't forget visas

Speakers coming from outside Canada need an eTA or a visitor visa, and processing times run to months depending on nationality. **At a Montréal event this stops more speakers than money does.**

When `needsVisa = true`, show in the form:

> We will issue an invitation letter as soon as you're accepted. Please start your application as early as possible.

Add the same, conditionally, to the acceptance email template.

### The real mechanism is a confirmation deadline

Everything above is a prediction made at submission time. Commitment only exists after acceptance.

1. The acceptance email states a **confirmation deadline** — 7 days is standard
2. The speaker must click a confirmation link: `accepted` → `confirmed`
3. No response by the deadline → automatically `waitlisted`, and the top waitlist candidate is notified

```
proposals/{id}
  status              // ... accepted | confirmed | declined | waitlisted
  confirmDeadline     // timestamp
  confirmedAt         // timestamp | null
```

One Cloud Scheduler job running daily over expired records handles this. Without the automation, organisers end up chasing people from a spreadsheet and something slips.

### Waitlist depth

Size it from the share of `pending` responses and non-Canadian applicants. Holding roughly **20% of the final line-up** in reserve absorbs the cancellations that arrive three weeks out.

---

## 6. Data model

### Collections

```
speakers/{uid}
  name, bio_en, bio_fr, company, jobTitle, basedIn,
  socials[], isGde, email
  profilePhoto?                           // server-owned reusable private original
  createdAt, updatedAt

proposals/{proposalId}
  primarySpeakerId                       // lead; owns talk content and withdrawal
  speakerIds[]                            // active, explicitly consenting presenters
  formerSpeakerIds[]?                     // permanent review-conflict history
  speakerSnapshot[]?                      // submitted event copy, no email; explicit refresh only
  formerSpeakerSnapshot[]?                // audit copy after post-submit removal
  lateSpeakerPendingIds[]?                 // accepted late additions awaiting response
  lateSpeakerScheduleBaselineIds[]?        // roster frozen in the prior release
  lateSpeakerSchedulePreserved?            // prior release remains valid until reshare
  title, abstract, pitch
  category, format, level
  deliveryLanguage, languagePreference          // slideLanguage removed, see §4
  acks, attendance?                       // legacy solo fallback; attendance exists only when
                                          // configured, and reviewers never receive acks
  status                                  // draft | submitted | under_review |
                                          // accepted | confirmed | declined |
                                          // waitlisted | rejected | withdrawn
  confirmDeadline, confirmedAt
  submittedAt, updatedAt
  aggregate {                             // written by Cloud Function only
    avgScore, normalizedScore, reviewCount, stdDev
  }

proposals/{proposalId}/profileUpdateRequests/{speakerUid}
  requestId, generation                   // exact version; terminal requests can be superseded
  scopes[], resolvedScopes[]              // profile | photo
  status                                  // pending | resolved | cancelled
  requestedBy, requestedAt, updatedAt     // callable-only participant workflow

proposals/{proposalId}/speakerInvitations/{invitationId}
  email, status                           // pending | accepted | declined | revoked
  phase                                   // draft | postAcceptance
  expiresAt, createdBy, createdAt, respondedBy?, respondedAt?

proposals/{proposalId}/speakerParticipants/{uid}
  role                                    // primary | coSpeaker
  status                                  // active | inactive
  acks                                    // presenter-private; admins after submission
  attendance?                             // only when configured; direct read remains private
                                          // and reviewer projection follows per-field visibility
  invitationId?, joinedPhase?, joinedAt, removedAt?

proposals/{proposalId}/speakerConfirmations/{uid}
  response                                // confirmed | declined
  answers, headshotUploads                // presenter-private; admins after submission
  speakerPhoto?                           // exact reusable-photo generation frozen for event
  respondedAt, confirmedAt?

proposals/{proposalId}/reviews/{reviewerUid}
  score                                   // 1 Pass · 2 Maybe · 3 Yes · 4 Strong yes
  note
  conflictOfInterest                      // true → excluded from aggregate
  createdAt

reviewers/{uid}
  name, email, role                       // organizer | lead

emailLog/{logId}
  proposalId, template, to, sentAt, providerId

config/schedule
  timeZone, days[], rooms[], revision, needsAttention
  sharedVersion, sharedRevision, sharedFingerprint, sharedTaxonomyFingerprint
  publishedVersion, publishedRevision

scheduleDraft/{entryId}
  kind, date, startsAt, durationMinutes, roomId
  proposalId, assignedLanguage?             // proposal item; assignment only for `either`
  customType, title, description?            // custom item
  language?                                 // optional custom-item attendee language
  speakers[]? { name, bio?, company?, jobTitle?, photoAssetRef? }
                                             // opaque working ref for custom speakers

scheduleSpeakerPhotoAssets/{photoAssetRef}   // callable-only immutable metadata;
                                             // exact Storage path/generation stay private

scheduleReleases/{releaseId}
  version, timeZone, days[], rooms[], publishedAt?
  entries/{entryId}                         // immutable attendee-facing snapshot;
                                             // proposal entries are confirmed only
    kind, date, startsAt, durationMinutes, roomId
    proposalId, session {                   // proposal item
      title, abstract, language
      category, categoryLabel               // attendee labels frozen when shared
      format, formatLabel
      level, levelLabel
      speakers[] { name, bio, company?, jobTitle? }
    }
    customType, title, description?, language? // custom item
    speakers[]? { name, bio?, company?, jobTitle?, photoRef? }
                                             // release-only opaque public photo member
  internal/source                           // admin-only release metadata
    sharedAt, sharedBy, sourceRevision
    sourceFingerprint                       // frozen config + entry projection
    taxonomyFingerprint                     // form taxonomy used for frozen labels

cfps/{cfpId}
  sharedScheduleId, sharedScheduleAt         // authenticated internal preview
  publishedScheduleId, publishedScheduleAt  // anonymous public programme
```

### Indexes

- `proposals`: composite on `status` + `category`
- `proposals`: composite on `status` + `aggregate.normalizedScore` desc
- `proposals`: composite on `status` + `deliveryLanguage`

### Security rules — non-negotiable

- Applicants read/write **only their own** proposal, and only before the deadline
- Co-speakers join only through a verified-email callable while the proposal is a
  draft. The lead owns talk edits; each active presenter owns only their personal
  participation data. Pending invitees receive no proposal access.
- A former presenter remains in the proposal's conflict history and may never
  review it, even after removal from the active roster.
- **Applicants must never be able to read the `reviews` subcollection.** Hiding it in the UI is not enough — the Firestore SDK queries directly from the browser
- `status` and `aggregate` are function-writable only; block all client writes
- Reviewers write only their own review document, so nobody can overwrite a colleague's score
- Deadline enforcement happens server-side, not by disabling the submit button

---

## 7. Review system

A card-based interface: reviewers move through proposals quickly, one at a time. Drag left/right or use the keyboard.

### Four-point scale

| Key | Verdict |
|---|---|
| `1` | Pass |
| `2` | Maybe |
| `3` | Yes |
| `4` | Strong yes |

**Why not a binary swipe.** The most common verdict in a CFP is "this is good, but we already have something similar in this track" — a *Maybe*. Without it, reviewers park everything ambiguous under Yes and re-litigate later. Maybe and Strong yes are mapped to down and up swipes, so the left/right speed is preserved.

**Undo is mandatory.** The cost of a fast swipe interface is mis-swipes. Without undo, reviewers slow down defensively and the speed advantage disappears.

### What the review card shows

Everything about the proposal, plus speaker identity, company, GDE status, and location. **No blind review** — the committee wants speaker context.

> **Amended 12 August 2026.** Travel feasibility is decision-relevant during
> review when the CFP enables it. For every speaker on the current active
> roster, the card may show only the enabled, reviewer-visible subset of
> `status`, `fundingSource`, `decisionBy`, and `needsVisa`. Multi-speaker
> proposals read that subset from each active `speakerParticipants/{uid}` row;
> a legacy solo proposal may use the root `attendance` fallback. In both cases
> the callable constructs the subset field by field and never copies an
> attendance object verbatim.

This does **not** expose acknowledgements, contact details, profile or programme
photos, lifecycle/confirmation state, or post-acceptance confirmation answers
such as dietary and accessibility needs. Reviewer data is a one-shot projection,
not a live subscription: it is current when the review queue is loaded or
refreshed.

### Other interactions

- **Note** (`N`) — optional free text for the committee. What tipped the score
- **Conflict of interest** (`C`) — flags the review for exclusion and reassignment
- **Progress ledger** — a colour tick per decision, so reviewers can see the shape of their own scoring emerging

### Aggregating scores

**Do not sort on raw average.** Reviewers differ in how generously they score. Normalise each reviewer's scores (z-score) across everything they reviewed, then average. At 5–10 reviewers this genuinely reorders the ranking.

**Surface disagreement.** A proposal everyone scored 3 needs less discussion than one that got a 1 and a 4. The final committee screen should sort by **standard deviation descending**, not by average — it puts the meeting time where the decisions actually are.

Reviewers should not see each other's scores until the round closes, to avoid anchoring.

---

## 8. Selection and notification workflow

```
submitted
   ↓  first committed review, atomically
under_review          ← reviewers score independently; speaker content is frozen
   ↓  aggregates refresh automatically as scores arrive
committee meeting     ← sorted by disagreement; track & language balance applied
   ↓
accepted / waitlisted / rejected
   ↓  reviewed decision batch is released
confirmed | declined  ← the speaker answers and completes required follow-up fields
   ↳ a late admin invitation leaves this unchanged until accepted
   ↳ acceptance returns the working session to accepted until everyone confirms
   ↓
private schedule → shared preview → public programme
   ↳ bounded late intake → review → decision → confirmation → republish
```

At the committee stage, the dashboard needs to show — alongside scores — the counts that drive balance decisions: proposals per category, per delivery language, count of `either`, and, when the CFP collects it, the `attendance.status` distribution among likely accepts.

The first review and the `submitted` → `under_review` transition are one server
transaction. A reviewer must never be told that a score was saved while the
speaker can still edit the content underneath it. Direct browser writes to the
review document are denied. Organisers decide `accepted`, `waitlisted` or
`rejected`; `confirmed` and `declined` belong to the authenticated speaker so a
required confirmation answer or headshot cannot be bypassed from the admin
table.

Submitting a proposal queues one generic, private-data-free notice for each
active claimed event owner, admin and reviewer except every current or former
speaker on that proposal. Pending, revoked, unverified and platform-only identities receive nothing. The notice is
deduplicated per proposal and recipient, revalidated immediately before
delivery, and links to the authenticated review workspace. Sharing a schedule
preview applies the same rule per immutable release, excluding the organiser
who performed the share. Speaker placement messages remain held for review;
committee notices are immediate.

### Email templates

The platform has one default sending identity and wording set managed by a
platform owner or administrator. Replacing its domain is a staged operation:
the active identity remains effective during DNS setup, and activation swaps
only a verified candidate and clears a sender that no longer matches. A CFP without its own delivery configuration
inherits that identity while a separate event domain is being staged. Activating
an event-specific sender is an explicit, isolated override: it must have its own
verified domain binding and may not silently fall back to the platform identity
when incomplete or stale. Event
template overrides layer over platform overrides by message kind and language,
then over the built-in copy. Platform and CFP domain bindings remain distinct,
and deleting a CFP cannot delete or transfer the platform binding. Global
sign-in links use the platform identity; CFP-scoped sign-in links use the same
effective identity as that CFP without ever entering `emailLog`.
For rollout compatibility, legacy event identity fields with no `senderMode`
remain an event override; a templates-only legacy document inherits platform
delivery.

| Template | Trigger | Conditional content |
|---|---|---|
| Submission received | On submit | Bilingual, echo of what was submitted |
| Committee invitation | On a new pending event role | Generic authenticated review link; invalidated if revoked or already claimed |
| Proposal ready for review | On submit | Generic authenticated review link; no proposal or speaker data |
| Accepted | Manual, batch | Confirmation link; visa invitation letter note if `needsVisa` |
| Waitlisted | Manual, batch | Honest about odds and timing |
| Rejected | Manual, batch | Send these at the same time as acceptances |
| Shared schedule ready | On preview share | Generic authenticated committee schedule link |
| Schedule assigned / changed / cancelled | On preview share | Held for organiser review; working-placement details |

Confirmation reminders, deadlines and automatic waitlist promotion remain a
future scheduled-job layer. They are not implied by an acceptance today.

Every send goes through `emailLog` to prevent duplicates. Build a dry-run/preview mode before the first real batch.

---

## 9. Programme and schedule disclosure

Organisers build the programme privately from accepted and confirmed talks.
Room, speaker and duplicate-talk overlaps are hard publication errors. An
`either` proposal must be assigned `en` or `fr`; accepted-but-unconfirmed talks
may be placed tentatively but are never copied into a shared release.

Disclosure has three explicit stages. The mutable private draft is visible only
to event admins and owners. **Share preview** writes a complete immutable
confirmed-session release, then advances `sharedScheduleId`; confirmed speakers
receive only their own placement and active committee members receive the
public-safe agenda. Neither audience reads the live draft. **Publish** may only
promote that exact, still-current shared release by advancing
`publishedScheduleId`. A changed draft or proposal status must be shared again
before it can become public. Only the published pointer is anonymously readable.

The submission window and programme disclosure are deliberately independent: a
rolling event may publish confirmed sessions while submissions remain open, but
the admin review warns before doing so. The public agenda supports day, room and
language filters, stable session URLs, bilingual labels, and whole-event or
per-session iCalendar downloads in the event time zone.

Schedule assignment, movement and cancellation messages use the held email
queue when a preview is shared, never while the draft is being edited and never
again merely because the reviewed preview becomes public. A confirmed proposal
that later leaves `confirmed` remains visible as cancelled in the current shared
and public releases until an organiser shares a replacement, avoiding a silent
disappearance for speakers, committee members and attendees. While an event is
active, emergency unpublishing clears only the public pointer; the immutable
release and internal preview remain available. Archiving freezes all event
mutation while retaining the current programme at its direct public URL. The
owner must reactivate the event before taking that historical programme offline.

---

## 10. Build order

1. **Submission form + Firestore write + security rules.** Conditional fields (event-scoped GDE guidance, configured attendance details, language preference) are the fiddly part.
2. **Review interface.** Prototype exists; needs auth, real data binding, and per-reviewer assignment.
3. **Aggregation function.** z-score normalisation, std dev, conflict exclusion.
4. **Selection dashboard.** Sorted by disagreement, with balance counters.
5. **Email pipeline.** Domain auth first, then templates, then the scheduled confirmation job.
6. **Programme.** Private conflict-aware planner, versioned publication, calendar export and schedule notifications.

Items 1 and 5 have the longest lead time — domain authentication in particular should be set up early, since deliverability problems only appear under real volume.

---

## Open questions

- Event date, and therefore the CFP open/close dates
- Ticket price — determines whether the Sessionize low-price rate is worth asking about
- Committee size, and whether every reviewer sees every proposal or a partitioned subset
- Is there a separate track for first-time speakers, or a mentorship offer?
- Who signs invitation letters for visa applicants?

---

## Verify before committing

Pricing and free-tier terms cited here were checked in July 2026 and change often. Re-confirm Firebase quotas, Resend/Brevo limits, and the Sessionize community terms before locking the architecture.
