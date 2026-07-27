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
  const body = {
    fields: {
      paused: { booleanValue: paused },
      opensAt: { timestampValue: opensAt.toISOString() },
      closesAt: { timestampValue: closesAt.toISOString() },
    },
  };
  await expectOk(
    await fetch(`${DOCS}/config/cfp?updateMask.fieldPaths=paused` +
      `&updateMask.fieldPaths=opensAt&updateMask.fieldPaths=closesAt`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
      body: JSON.stringify(body),
    }),
    'setCfpWindow',
  );
}

/** Empty backend, CFP open, nobody signed in. */
export async function reset(window: Window = {}) {
  await Promise.all([clearFirestore(), clearAuth()]);
  await setCfpWindow(window);
}

/** The single proposal document, for asserting what actually reached Firestore. */
export async function readProposal(): Promise<Record<string, any> | null> {
  const response = await fetch(`${DOCS}/proposals`, {
    headers: { authorization: 'Bearer owner' },
  });
  await expectOk(response, 'readProposal');
  const { documents } = await response.json();
  if (!documents?.length) return null;
  return unwrap(documents[0].fields);
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
