/**
 * Emulator control for the end-to-end tests.
 *
 * Talks to the emulators' REST surface rather than the app, so a test can put
 * the backend in a state the UI has no way to reach — a closed CFP, a paused
 * one, an account that does not exist yet.
 */

const PROJECT = 'demo-devfest-cfp';
const FIRESTORE = 'http://127.0.0.1:8080';
const AUTH = 'http://127.0.0.1:9099';
const FUNCTIONS = 'http://127.0.0.1:5001';
const STORAGE = 'http://127.0.0.1:9199';
const BUCKET = 'demo-devfest-cfp.appspot.com';
const REGION = 'northamerica-northeast1';
const DOCS = `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`;

const day = 24 * 60 * 60 * 1000;

/**
 * The CFP every helper works on unless told otherwise.
 *
 * Everything lives under `cfps/{cfpId}` now, so a spec that wants two tenants
 * side by side passes the second id explicitly — which is exactly what the
 * cross-tenant spec does.
 */
export const CFP_ID = 'devfest-mtl-2026';

async function expectOk(response: Response, what: string) {
  if (!response.ok) throw new Error(`${what} failed: ${response.status} ${await response.text()}`);
}

export async function clearFirestore() {
  await expectOk(
    await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
      method: 'DELETE',
    }),
    'clearFirestore',
  );
}

/**
 * The bucket. Not covered by `clearFirestore`, and a headshot left behind by
 * one test is a headshot the next one sees.
 */
export async function clearStorage() {
  const names = await readStoredObjects();
  await Promise.all(
    names.map((name) =>
      fetch(`${STORAGE}/storage/v1/b/${BUCKET}/o/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),
    ),
  );
}

export async function clearAuth() {
  await expectOk(
    await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' }),
    'clearAuth',
  );
}

export interface Window {
  opensAt?: Date;
  closesAt?: Date;
  paused?: boolean;
}

export async function setCfpWindow(
  {
    opensAt = new Date(Date.now() - 30 * day),
    closesAt = new Date(Date.now() + 30 * day),
    paused = false,
  }: Window = {},
  cfpId = CFP_ID,
) {
  await patch(`cfps/${cfpId}`, {
    paused: { booleanValue: paused },
    opensAt: { timestampValue: opensAt.toISOString() },
    closesAt: { timestampValue: closesAt.toISOString() },
  });
}

/**
 * A whole CFP, written straight to Firestore.
 *
 * The create flow has its own spec; every other spec needs a tenant to hang
 * documents under, not a re-run of the form. `archived` is always written
 * because the rules read it as a boolean rather than testing for its absence.
 */
export async function seedCfp(
  cfpId = CFP_ID,
  {
    name = 'DevFest Montréal 2026',
    visibility = 'public',
    archived = false,
    ownerUid,
    ...window
  }: Window & {
    name?: string;
    visibility?: 'public' | 'private';
    archived?: boolean;
    ownerUid?: string;
  } = {},
) {
  await patch(`cfps/${cfpId}`, {
    name: { stringValue: name },
    visibility: { stringValue: visibility },
    archived: { booleanValue: archived },
    reviewsVisible: { booleanValue: false },
    ownerUids: {
      arrayValue: { values: ownerUid ? [{ stringValue: ownerUid }] : [] },
    },
  });
  await setCfpWindow(window, cfpId);
}

/** Empty backend, one CFP open, nobody signed in. */
export async function reset(window: Window = {}) {
  await Promise.all([clearFirestore(), clearAuth(), clearStorage()]);
  await seedCfp(CFP_ID, window);
}

/** Leaves the accounts and roles alone — only the review queue is emptied. */
export async function clearProposals(cfpId = CFP_ID) {
  const response = await fetch(`${DOCS}/cfps/${cfpId}/proposals`, {
    headers: { authorization: 'Bearer owner' },
  });
  await expectOk(response, 'clearProposals');
  const { documents } = await response.json();
  await Promise.all(
    (documents ?? []).map((d: { name: string }) =>
      fetch(`${FIRESTORE}/v1/${d.name}`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer owner' },
      }),
    ),
  );
}

/** Moves a proposal without going through the callable — puts a test where the UI cannot. */
export async function setProposalStatusDirect(id: string, status: string, cfpId = CFP_ID) {
  await patch(`cfps/${cfpId}/proposals/${id}`, { status: { stringValue: status } });
}

export async function setReviewsVisible(visible: boolean, cfpId = CFP_ID) {
  await patch(`cfps/${cfpId}`, { reviewsVisible: { booleanValue: visible } });
}

/**
 * A pending invitation. `claimRole` turns it into a `members/{uid}` document on
 * that person's first visit to this CFP.
 */
export async function inviteRole(
  email: string,
  role: 'reviewer' | 'admin' | 'owner',
  cfpId = CFP_ID,
) {
  await patch(`cfps/${cfpId}/roleGrants/${email}`, {
    cfpId: { stringValue: cfpId },
    email: { stringValue: email },
    role: { stringValue: role },
    createdBy: { stringValue: 'seed' },
  });
}

/**
 * A role straight onto the membership, skipping the claim.
 *
 * `inviteRole` cannot grant `owner` — the callable refuses it, deliberately —
 * so an owner-only test (archive, delete) has to be seeded here.
 */
export async function seedMember(
  uid: string,
  role: 'reviewer' | 'admin' | 'owner',
  cfpId = CFP_ID,
  email = `${uid}@example.org`,
) {
  await patch(`cfps/${cfpId}/members/${uid}`, {
    cfpId: { stringValue: cfpId },
    uid: { stringValue: uid },
    role: { stringValue: role },
    email: { stringValue: email },
    grantedBy: { stringValue: 'seed' },
  });
  if (role === 'owner') {
    await patch(`cfps/${cfpId}`, {
      ownerUids: { arrayValue: { values: [{ stringValue: uid }] } },
    });
  }
}

/**
 * Creates the account ahead of the browser and returns its uid.
 *
 * The Auth emulator mints its own uid rather than reusing the token's `sub`, so
 * anything that has to name a user — `speakerIds`, a seeded review — has to ask
 * for it first. Signing in again with the same `sub` lands on the same account.
 */
export async function createAccount(who: {
  sub: string;
  email: string;
  name: string;
}): Promise<{ uid: string; idToken: string }> {
  const claims = { sub: who.sub, email: who.email, email_verified: true, name: who.name };
  const response = await fetch(
    `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        postBody: `id_token=${encodeURIComponent(JSON.stringify(claims))}&providerId=google.com`,
        requestUri: 'http://localhost',
        returnSecureToken: true,
      }),
    },
  );
  await expectOk(response, 'createAccount');
  const { localId, idToken } = await response.json();
  return { uid: localId, idToken };
}

/**
 * Which CFP a callable is being asked about, unless the caller named one.
 *
 * Every callable takes a `cfpId`, and almost every spec is about the single
 * seeded tenant — writing it out at each of the ~60 call sites would say
 * nothing. The cross-tenant spec passes its own and this leaves it alone.
 */
function withCfp(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  return 'cfpId' in data ? data : { cfpId: CFP_ID, ...data };
}

/**
 * Calls a callable straight, as a given user.
 *
 * The callable is the enforcement point, so "the UI does not offer the button"
 * is not the assertion worth making — this one goes round the UI entirely.
 * Returns the error code rather than throwing, since refusal is the usual
 * expected outcome.
 */
export async function callAs(
  idToken: string,
  name: string,
  data: unknown,
): Promise<{ ok: boolean; code: string }> {
  const response = await fetch(`${FUNCTIONS}/${PROJECT}/${REGION}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: withCfp(data) }),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, code: body?.error?.status ?? String(response.status) };
}

/**
 * A callable that takes no token at all.
 *
 * Not `callAs('')`: that sends `Bearer ` with nothing after it, which is a
 * malformed token rather than an absent one, and is rejected before the
 * function runs.
 */
export async function callPublic(
  name: string,
  data: unknown,
): Promise<{ ok: boolean; code: string }> {
  const response = await fetch(`${FUNCTIONS}/${PROJECT}/${REGION}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: withCfp(data) }),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, code: body?.error?.status ?? String(response.status) };
}

/** `callAs` for the cases that assert on the payload rather than the refusal. */
export async function callJson(idToken: string, name: string, data: unknown): Promise<any> {
  const response = await fetch(`${FUNCTIONS}/${PROJECT}/${REGION}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: withCfp(data) }),
  });
  await expectOk(response, `${name} call`);
  return (await response.json())?.result ?? {};
}

/**
 * One reviewer's score, written straight to Firestore.
 *
 * `cfpId` goes on the document because the aggregate recompute is a
 * collection-group query and cannot be filtered by ancestor. Seeding it is what
 * lets a test prove the filter is there: without it, a recompute on one CFP
 * would sweep this in.
 */
export async function seedReview(
  proposalId: string,
  reviewerUid: string,
  score: number,
  cfpId = CFP_ID,
  conflictOfInterest = false,
) {
  await patch(`cfps/${cfpId}/proposals/${proposalId}/reviews/${reviewerUid}`, {
    cfpId: { stringValue: cfpId },
    score: { integerValue: String(score) },
    conflictOfInterest: { booleanValue: conflictOfInterest },
  });
}

/** The reviews on one proposal, for asserting which talk a score landed on. */
export async function readReviews(
  proposalId: string,
  cfpId = CFP_ID,
): Promise<Record<string, any>[]> {
  const response = await fetch(`${DOCS}/cfps/${cfpId}/proposals/${proposalId}/reviews`, {
    headers: { authorization: 'Bearer owner' },
  });
  if (!response.ok) return [];
  const { documents } = await response.json();
  return (documents ?? []).map((d: { fields: Record<string, any> }) => unwrap(d.fields));
}

/**
 * The sign-in links the Auth emulator has minted.
 *
 * The callable deliberately never returns the link — it is a bearer credential
 * and is not written to Firestore either — so a test reads it from the place it
 * genuinely exists: the emulator's own out-of-band code list.
 */
export async function readSignInLinks(): Promise<{ email: string; link: string }[]> {
  const response = await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`);
  await expectOk(response, 'readSignInLinks');
  const { oobCodes } = await response.json();
  return (oobCodes ?? [])
    .filter((c: { requestType: string }) => c.requestType === 'EMAIL_SIGNIN')
    .map((c: { email: string; oobLink: string }) => ({ email: c.email, link: c.oobLink }));
}

/** Clears the throttle so a test does not inherit another test's allowance. */
export async function clearSignInAllowance() {
  const response = await fetch(`${DOCS}/signInLinks`, {
    headers: { authorization: 'Bearer owner' },
  });
  if (!response.ok) return;
  const { documents } = await response.json();
  await Promise.all(
    (documents ?? []).map((d: { name: string }) =>
      fetch(`${FIRESTORE}/v1/${d.name}`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer owner' },
      }),
    ),
  );
}

/**
 * Object names in the bucket.
 *
 * `/storage/v1` rather than `/v0`: the latter goes through `storage.rules`,
 * which deny listing — so it answers 403, and a helper that swallowed that
 * returned an empty list. Every "nothing was uploaded" assertion then passed
 * whether or not anything had been. Errors throw here for the same reason.
 */
export async function readStoredObjects(prefix = ''): Promise<string[]> {
  const response = await fetch(
    `${STORAGE}/storage/v1/b/${BUCKET}/o?prefix=${encodeURIComponent(prefix)}`,
  );
  await expectOk(response, 'readStoredObjects');
  const { items } = await response.json();
  return (items ?? []).map((o: { name: string }) => o.name).sort();
}

/**
 * Puts an object in the bucket without going through `storage.rules`, so a test
 * can plant something the rules would have refused and check what the code
 * behind them does with it.
 *
 * Multipart because the emulator only reads a content type out of the metadata
 * part: a plain `uploadType=media` POST ignores the request's own header and
 * files everything as `application/octet-stream`, which is not what these tests
 * are about.
 */
export async function storeObjectDirect(name: string, contentType: string, body = 'x') {
  const parts = [
    '--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify({ name, contentType }),
    `\r\n--B\r\nContent-Type: ${contentType}\r\n\r\n`,
    body,
    '\r\n--B--\r\n',
  ].join('');
  await expectOk(
    await fetch(`${STORAGE}/upload/storage/v1/b/${BUCKET}/o?uploadType=multipart`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/related; boundary=B' },
      body: parts,
    }),
    'storeObjectDirect',
  );
}

/**
 * Where the functions believe this app is reachable, without going through a
 * callable — there is none, because this is platform config rather than any one
 * organiser's to set.
 *
 * `loadPlatform` falls back to `CFP_PUBLIC_URL` and then to a `.web.app` address
 * derived from the project id, so a test that follows a link the server built
 * only lands back on the app if something has said where the app is. Leaving
 * that to the environment meant it worked on a laptop with `.env.local` and
 * failed in CI, which has no such file.
 */
export async function setPublicUrlDirect(url: string) {
  await expectOk(
    await fetch(`${DOCS}/config/platform?updateMask.fieldPaths=publicUrl`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
      body: JSON.stringify({ fields: { publicUrl: { stringValue: url } } }),
    }),
    'setPublicUrlDirect',
  );
}

/**
 * The domain this CFP has registered with Resend.
 *
 * Written directly because the callable that does it spends the API key against
 * the real Resend, which no test should. `setEmailSettings` refuses a sender
 * that is not on it — one Resend account serves the whole platform, so without
 * that check any organiser could write as somebody else's verified domain.
 */
export async function setSendingDomainDirect(domain: string, cfpId = CFP_ID) {
  await patch(`cfps/${cfpId}/config/email`, {
    domain: { stringValue: domain },
    domainId: { stringValue: `dom-${domain}` },
  });
}

/** The organiser's confirmation questions, without going through the callable. */
export async function setConfirmFormDirect(fields: unknown[], cfpId = CFP_ID) {
  await expectOk(
    await fetch(`${DOCS}/cfps/${cfpId}/config/confirmForm`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
      // Written whole rather than through `patch`, which cannot express an
      // array of maps in Firestore's REST encoding.
      body: JSON.stringify({
        fields: { fields: { arrayValue: { values: fields.map(encode) } } },
      }),
    }),
    'setConfirmFormDirect',
  );
}

/**
 * The whole submission-form config, written straight in. Only the keys given
 * are sent; `mergeSubmissionForm` fills the rest from the defaults, which is
 * exactly what a call with no document at all gets.
 */
export async function setSubmissionFormDirect(
  form: Record<string, unknown[]>,
  cfpId = CFP_ID,
) {
  await expectOk(
    await fetch(`${DOCS}/cfps/${cfpId}/config/submissionForm`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
      body: JSON.stringify({
        fields: Object.fromEntries(
          Object.entries(form).map(([key, list]) => [
            key,
            { arrayValue: { values: list.map(encode) } },
          ]),
        ),
      }),
    }),
    'setSubmissionFormDirect',
  );
}

/** The inverse of `unwrap`: enough of it for a form definition. */
function encode(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return {
    mapValue: {
      fields: Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, encode(v)])),
    },
  };
}

/** Puts a queue row into a state the UI cannot reach, e.g. mid-send. */
export async function setEmailStatusDirect(logId: string, status: string, cfpId = CFP_ID) {
  await patch(`cfps/${cfpId}/emailLog/${logId}`, { status: { stringValue: status } });
}

/**
 * A submitted proposal, written straight to Firestore. The submission flow has
 * its own spec; these tests need something in the review queue, not a re-run of
 * the form.
 */
export async function seedProposal(
  id: string,
  {
    speakerUid,
    title,
    status,
    cfpId = CFP_ID,
    speaker = {},
    includeSpeakerSnapshot = true,
    ...rest
  }: {
    speakerUid: string;
    title: string;
    status: string;
    cfpId?: string;
    /** Overrides on the snapshot the committee reads — see `SpeakerSnapshot`. */
    speaker?: Record<string, unknown>;
    /** Drafts have no frozen committee copy until they are first submitted. */
    includeSpeakerSnapshot?: boolean;
    /** Anything else on the document, so a spec can seed the awkward cases. */
    [field: string]: unknown;
  },
) {
  await patch(`cfps/${cfpId}/proposals/${id}`, {
    // Denormalised from the path, and pinned to it by the rules.
    cfpId: { stringValue: cfpId },
    speakerIds: { arrayValue: { values: [{ stringValue: speakerUid }] } },
    // What the review card renders. Written by `submitProposal` in the real
    // flow; seeded here because nothing else on the platform may read a global
    // speaker profile.
    ...(includeSpeakerSnapshot
      ? {
          speakerSnapshot: {
            arrayValue: {
              values: [
                encode({
                  uid: speakerUid,
                  name: 'Test Speaker',
                  bio: 'x'.repeat(120),
                  basedIn: 'Montréal, QC',
                  socials: [],
                  isGde: false,
                  ...speaker,
                }),
              ],
            },
          },
        }
      : {}),
    status: { stringValue: status },
    title: { stringValue: title },
    abstract: { stringValue: 'x'.repeat(400) },
    category: { stringValue: 'ai_ml' },
    format: { stringValue: 'session_40' },
    level: { stringValue: 'intermediate' },
    deliveryLanguage: { stringValue: 'en' },
    // Seeded complete, so a spec can also push it through `submitProposal` —
    // the callable re-runs the whole schema and rejects a half-filled draft.
    acks: {
      mapValue: {
        fields: {
          noTravelSupport: { booleanValue: true },
          coc: { booleanValue: true },
          recording: { booleanValue: true },
        },
      },
    },
    attendance: {
      mapValue: {
        fields: {
          status: { stringValue: 'local' },
          needsVisa: { booleanValue: false },
        },
      },
    },
    // Last, so a spec can override any of the defaults above — the local,
    // visa-free speaker is the easy case, and not the one worth a test.
    ...Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, encode(value)])),
  });
}

export async function seedSpeaker(
  uid: string,
  {
    name,
    email,
    locale,
    bio,
    company,
    jobTitle,
    isGde,
    pastTalks,
  }: {
    name: string;
    email: string;
    locale?: 'en' | 'fr';
    bio?: string;
    company?: string;
    jobTitle?: string;
    isGde?: boolean;
    pastTalks?: string;
  },
) {
  await patch(`speakers/${uid}`, {
    name: { stringValue: name },
    email: { stringValue: email },
    bio: { stringValue: bio ?? 'x'.repeat(120) },
    basedIn: { stringValue: 'Montréal, QC' },
    isGde: { booleanValue: isGde ?? false },
    ...(company ? { company: { stringValue: company } } : {}),
    ...(jobTitle ? { jobTitle: { stringValue: jobTitle } } : {}),
    ...(pastTalks ? { pastTalks: { stringValue: pastTalks } } : {}),
    ...(locale ? { locale: { stringValue: locale } } : {}),
  });
}

/**
 * The email queue, by document id. Nothing may read this as a client — the rules
 * shut the collection entirely — so the assertions go through the emulator's
 * owner credential.
 */
export async function readEmailLog(cfpId = CFP_ID): Promise<Record<string, any>[]> {
  const response = await fetch(`${DOCS}/cfps/${cfpId}/emailLog`, {
    headers: { authorization: 'Bearer owner' },
  });
  await expectOk(response, 'readEmailLog');
  const { documents } = await response.json();
  return (documents ?? []).map((d: { name: string; fields: Record<string, any> }) => ({
    id: d.name.split('/').pop(),
    ...unwrap(d.fields),
  }));
}

/** The sender is a Firestore trigger, so a queued row settles a beat later. */
export async function waitForEmail(
  predicate: (rows: Record<string, any>[]) => boolean,
  what = 'email',
): Promise<Record<string, any>[]> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const rows = await readEmailLog();
    if (predicate(rows)) return rows;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${what}: ${JSON.stringify(await readEmailLog())}`);
}

export async function seedSubmittedProposal(
  id: string,
  talk: { speakerUid: string; title: string; cfpId?: string; speaker?: Record<string, unknown> },
) {
  await seedProposal(id, { ...talk, status: 'submitted' });
}

async function patch(path: string, fields: Record<string, unknown>) {
  const mask = Object.keys(fields)
    .map((key) => `updateMask.fieldPaths=${key}`)
    .join('&');
  await expectOk(
    await fetch(`${DOCS}/${path}?${mask}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
      body: JSON.stringify({ fields }),
    }),
    `patch ${path}`,
  );
}

/** One speaker profile, or undefined when it was never written. */
export async function readSpeaker(uid: string): Promise<Record<string, any> | undefined> {
  const response = await fetch(`${DOCS}/speakers/${uid}`, {
    headers: { authorization: 'Bearer owner' },
  });
  if (response.status === 404) return undefined;
  await expectOk(response, 'readSpeaker');
  const { fields } = await response.json();
  return unwrap(fields ?? {});
}

/** Every proposal, for asserting what actually reached Firestore. */
export async function readProposals(cfpId = CFP_ID): Promise<Record<string, any>[]> {
  const response = await fetch(`${DOCS}/cfps/${cfpId}/proposals`, {
    headers: { authorization: 'Bearer owner' },
  });
  await expectOk(response, 'readProposals');
  const { documents } = await response.json();
  return (documents ?? []).map((d: { fields: Record<string, any> }) => unwrap(d.fields));
}

/** The first one, for the specs that only ever create a single proposal. */
export async function readProposal(): Promise<Record<string, any> | null> {
  return (await readProposals())[0] ?? null;
}

/** By id, since `readProposals` unwraps the fields and drops the document name. */
export async function readProposalById(
  id: string,
  cfpId = CFP_ID,
): Promise<Record<string, any> | null> {
  const response = await fetch(`${DOCS}/cfps/${cfpId}/proposals/${id}`, {
    headers: { authorization: 'Bearer owner' },
  });
  if (!response.ok) return null;
  const { fields } = await response.json();
  return unwrap(fields ?? {});
}

/** Firestore REST wraps every value in a type tag; this is the inverse. */
function unwrap(fields: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if ('stringValue' in value) out[key] = value.stringValue;
    else if ('booleanValue' in value) out[key] = value.booleanValue;
    else if ('integerValue' in value) out[key] = Number(value.integerValue);
    else if ('timestampValue' in value) out[key] = value.timestampValue;
    else if ('mapValue' in value) out[key] = unwrap(value.mapValue.fields);
    else if ('arrayValue' in value) out[key] = (value.arrayValue.values ?? []).map(unwrapOne);
    else out[key] = value;
  }
  return out;
}

function unwrapOne(value: Record<string, any>): unknown {
  return 'mapValue' in value ? unwrap(value.mapValue.fields) : Object.values(value)[0];
}
