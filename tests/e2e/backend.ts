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
const REGION = 'northamerica-northeast1';
const DOCS = `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`;

const day = 24 * 60 * 60 * 1000;

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

export async function setCfpWindow({
  opensAt = new Date(Date.now() - 30 * day),
  closesAt = new Date(Date.now() + 30 * day),
  paused = false,
}: Window = {}) {
  await patch('config/cfp', {
    paused: { booleanValue: paused },
    opensAt: { timestampValue: opensAt.toISOString() },
    closesAt: { timestampValue: closesAt.toISOString() },
  });
}

/** Empty backend, CFP open, nobody signed in. */
export async function reset(window: Window = {}) {
  await Promise.all([clearFirestore(), clearAuth()]);
  await setCfpWindow(window);
}

/** Leaves the accounts and roles alone — only the review queue is emptied. */
export async function clearProposals() {
  const response = await fetch(`${DOCS}/proposals`, {
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
export async function setProposalStatusDirect(id: string, status: string) {
  await patch(`proposals/${id}`, { status: { stringValue: status } });
}

export async function setReviewsVisible(visible: boolean) {
  await patch('config/cfp', { reviewsVisible: { booleanValue: visible } });
}

/**
 * A pending role, as the bootstrap script writes the first admin. `claimRole`
 * turns it into a `reviewers/{uid}` document on that person's first sign-in.
 */
export async function inviteRole(email: string, role: 'reviewer' | 'admin') {
  await patch(`roleGrants/${email}`, {
    email: { stringValue: email },
    role: { stringValue: role },
    createdBy: { stringValue: 'bootstrap' },
  });
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
    body: JSON.stringify({ data }),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, code: body?.error?.status ?? String(response.status) };
}

/** `callAs` for the cases that assert on the payload rather than the refusal. */
export async function callJson(idToken: string, name: string, data: unknown): Promise<any> {
  const response = await fetch(`${FUNCTIONS}/${PROJECT}/${REGION}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  await expectOk(response, `${name} call`);
  return (await response.json())?.result ?? {};
}

/** Puts a queue row into a state the UI cannot reach, e.g. mid-send. */
export async function setEmailStatusDirect(logId: string, status: string) {
  await patch(`emailLog/${logId}`, { status: { stringValue: status } });
}

/**
 * A submitted proposal, written straight to Firestore. The submission flow has
 * its own spec; these tests need something in the review queue, not a re-run of
 * the form.
 */
export async function seedProposal(
  id: string,
  { speakerUid, title, status }: { speakerUid: string; title: string; status: string },
) {
  await patch(`proposals/${id}`, {
    speakerIds: { arrayValue: { values: [{ stringValue: speakerUid }] } },
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
export async function readEmailLog(): Promise<Record<string, any>[]> {
  const response = await fetch(`${DOCS}/emailLog`, {
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
  talk: { speakerUid: string; title: string },
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

/** Every proposal, for asserting what actually reached Firestore. */
export async function readProposals(): Promise<Record<string, any>[]> {
  const response = await fetch(`${DOCS}/proposals`, {
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
export async function readProposalById(id: string): Promise<Record<string, any> | null> {
  const response = await fetch(`${DOCS}/proposals/${id}`, {
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
