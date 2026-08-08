# Persona fixture and run manifest

This is the provisioning companion to the
[`persona-flow-handbook.md`](persona-flow-handbook.md). It keeps account claims,
logical fixture names, and failure injection reproducible without putting real
people or production data in QA artifacts.

## Provisioning boundary

`npm start` provides the emulator stack and a basic open CFP. It does **not**
create the whole persona catalog. The E2E suites own their deterministic state
with `reset`, `createAccount`, and the focused seed helpers in
`tests/e2e/backend.ts`; a spec's setup is the executable fixture recipe for the
behavior it automates.

A full manual persona pass needs an isolated, pre-provisioned emulator or
disposable project. Until a one-shot persona seed script exists, the runner must
record the actual fixture slugs and returned Auth UIDs in the run manifest
below. If that provisioning has not been supplied, report `BLOCKED-SEED` rather
than repairing a persona through the UI or borrowing production data.

Create Auth accounts before documents that refer to them. In the Auth emulator,
the returned `localId` is the UID for `speakerIds`, members, reviews, and speaker
documents; the stable `sub` below is only the test-hook claim.

### Clean-checkout recipes

The automated route is executable from a clean checkout. Playwright starts the
stack when it is absent, and each mapped spec provisions its own state:

```bash
npx playwright test tests/e2e/deck.spec.ts \
  --grep "an unscored note survives leaving and returning to review"
```

Use `npm run verify` for the full automated gate. Do not run a resetting E2E spec
against an exploratory seed that another browser is using.

For a manual pass, start a clean isolated stack:

```bash
npm start -- --fresh
```

The base tenant comes from `scripts/seed-cfp.mjs`. Additional logical tenants
use that same command shape in another terminal, with run-relative dates
recorded in the manifest:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
GCLOUD_PROJECT=demo-devfest-cfp \
node scripts/seed-cfp.mjs --id <slug> --name "<name>" \
  --opens <YYYY-MM-DD> --closes <YYYY-MM-DD> --visibility <public-or-private>
```

Provision persona documents with the same helper order used by focused specs:
`reset` only at the beginning of an isolated seed, then `createAccount`, then
`seedSpeaker`/`seedProposal`, and finally `inviteRole` or `seedMember`;
platform states use `invitePlatformRole` or `seedPlatformMember`. Schedule and
email fixtures follow `schedule.spec.ts` and `email.spec.ts`. These helpers live
in `tests/e2e/backend.ts` and deliberately talk only to emulators. A full manual
seed orchestrator is not currently committed, so do not claim the whole catalog
is runnable from one command; use `BLOCKED-SEED` when the pre-provisioned state
has not been supplied.

## Stable synthetic identities

State IDs that describe the same transition deliberately reuse one identity.
For example, `PLATFORM-CREATOR-PENDING` becomes `PLATFORM-CREATOR` after claim.

| Persona/state ID | `sub` | Email | Display name |
|---|---|---|---|
| `AUTH-UNAUTHORIZED` | `qa-auth-unauthorized` | `qa-auth-unauthorized@example.org` | Una Authorized |
| `SPK-DRAFT` | `qa-spk-draft` | `qa-spk-draft@example.org` | Drew Draft |
| `SPK-SUBMITTED` | `qa-spk-submitted` | `qa-spk-submitted@example.org` | Sam Submitted |
| `SPK-WITHDRAWN` | `qa-spk-withdrawn` | `qa-spk-withdrawn@example.org` | Wynn Withdrawn |
| `SPK-ACCEPTED` | `qa-spk-accepted` | `qa-spk-accepted@example.org` | Alex Accepted |
| `SPK-CONFIRMED` | `qa-spk-confirmed` | `qa-spk-confirmed@example.org` | Casey Confirmed |
| `SPK-DECLINED` | `qa-spk-declined` | `qa-spk-declined@example.org` | Devon Declined |
| `SPK-WAITLISTED` | `qa-spk-waitlisted` | `qa-spk-waitlisted@example.org` | Wai Waitlisted |
| `SPK-REJECTED` | `qa-spk-rejected` | `qa-spk-rejected@example.org` | Robin Rejected |
| `REVIEWER-PENDING` / `REVIEWER` | `qa-reviewer` | `qa-reviewer@example.org` | Riley Reviewer |
| `EVENT-ADMIN` | `qa-event-admin` | `qa-event-admin@example.org` | Ari Admin |
| `EVENT-OWNER` | `qa-event-owner` | `qa-event-owner@example.org` | Oak Owner |
| `PLATFORM-CREATOR-PENDING` / `PLATFORM-CREATOR` | `qa-platform-creator` | `qa-platform-creator@example.org` | Chris Creator |
| `PLATFORM-CREATOR-TARGET` | `qa-platform-creator-target` | `qa-platform-creator-target@example.org` | Taylor Creator |
| `PLATFORM-ADMIN` | `qa-platform-admin` | `qa-platform-admin@example.org` | Parker Admin |
| `PLATFORM-ADMIN-TARGET` | `qa-platform-admin-target` | `qa-platform-admin-target@example.org` | Morgan Admin |
| `PLATFORM-OWNER` | `qa-platform-owner` | `qa-platform-owner@example.org` | Olive Owner |
| `PLATFORM-OWNER-SECOND` | `qa-platform-owner-second` | `qa-platform-owner-second@example.org` | Sidney Owner |

`ANON-PUBLIC` has no account. All other accounts are verified. Use a unique
email suffix per concurrent run if the environment is shared, but keep the
persona prefix so evidence remains attributable.

## Fixture checklist

Map every logical fixture in the handbook to one actual slug. Verify this list
before the first browser opens:

- `CFP-OPEN`, `CFP-CLOSED`, `CFP-PRIVATE`, `CFP-ARCHIVED`, `CFP-SCHEDULED`, and
  `CFP-DISPOSABLE` all exist with the documented window and visibility.
- Every proposal belongs to the matching returned speaker UID and has a
  complete speaker snapshot where committee or programme pages need it.
- `REVIEWER-PENDING` has only a pending exact-email grant and no prior review;
  `REVIEWER` has the active role, prior review, eligible queue, and excluded own
  proposal described in the handbook.
- Platform target identities start verified and platform-role-free. The creator
  target already owns its disposable event so revocation can prove that event
  ownership survives; the admin target has no event role. Seed a pending global
  grant only when the flow says it already exists.
- The scheduled release is immutable public data; its draft and release IDs are
  recorded separately. Held email rows remain unsent.
- The disposable tenant is unique to one `MT` or `MX` flow and is discarded
  afterward.

## Failure injection

Induce browser-save failures with Playwright request interception, scoped to the
next matching Firestore commit or callable after the form becomes dirty. Record
the intercepted URL pattern and prove that the expected backend row did not
change. Do not kill or reset a shared stack to manufacture an error. An aborted
write remains `MB`; a request that reaches the application and changes data uses
its normal `M1`, `MT`, or `MX` budget.

Firestore Lite writes use the same commit pattern already exercised in
`draft.spec.ts`. Arm the failure only after setup reads and local typing finish:

```ts
let failNextCommit = false;
await page.route('**/documents:commit**', (route) => {
  if (!failNextCommit) return route.continue();
  failNextCommit = false;
  return route.abort();
});

// Fill the note first, then set this immediately before the Save/score action.
failNextCommit = true;
```

For a callable failure, use its existing path as the narrow route pattern (for
example `**/emailQueue`) rather than aborting every emulator request. Always
`unroute` the pattern before proving the retry.

For provider-dependent email flows, use the emulator/dry-run behavior. Never
substitute a real provider key or recipient just to make a persona flow pass.

## Per-run manifest

Keep this manifest with the uncommitted evidence for the run:

```yaml
run_id: 2026-08-08-branch-sha
commit: full-git-sha
environment: emulator-or-disposable-project
browser: name-and-version
started_at: ISO-8601
fixtures:
  CFP-OPEN: actual-slug
  CFP-CLOSED: actual-slug
  CFP-PRIVATE: actual-slug
  CFP-ARCHIVED: actual-slug
  CFP-SCHEDULED: actual-slug
  CFP-DISPOSABLE: actual-slug-per-mutating-flow
auth_local_ids:
  SPK-DRAFT: emulator-localId
  REVIEWER: emulator-localId
  EVENT-ADMIN: emulator-localId
  # Add every selected persona; never record tokens or one-time links.
selected_flows: [PUB-01, SPK-02, REV-05]
failure_injection: none-or-intercepted-pattern
```

Do not commit a filled manifest. It may contain environment-specific identifiers
even though the identity claims themselves are synthetic.
