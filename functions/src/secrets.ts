/**
 * The Resend API key.
 *
 * It lives in Secret Manager rather than in `config/email` alongside the
 * addresses, because it is a live credential: Firestore has no version history,
 * no access audit, and a copy of every document ends up in every export and
 * backup. Secret Manager has all three, and IAM decides who may read it.
 *
 * What that costs is a redeploy to change the key — so this reads it at runtime
 * instead of through a `secrets: []` binding, which resolves once when the
 * instance starts. An admin can then rotate the key from `/admin` and the next
 * instance picks it up, with no deploy and nothing pasted into a terminal.
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { logger } from 'firebase-functions';

const SECRET = 'RESEND_API_KEY';

let client: SecretManagerServiceClient | undefined;
function secrets(): SecretManagerServiceClient {
  client ??= new SecretManagerServiceClient();
  return client;
}

function project(): string {
  const id = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!id) throw new Error('no project id in the environment');
  return id;
}

/**
 * Cached for the life of the instance — one API call per cold start, not one
 * per email. A rotation therefore takes effect as instances recycle, which is
 * the trade for not having to redeploy.
 */
let cached: { value: string; at: number } | undefined;
const MAX_AGE_MS = 10 * 60 * 1000;

export async function readResendKey(): Promise<string> {
  // The emulator has no Secret Manager. `functions/.secret.local` puts the key
  // here instead, and an empty one keeps local runs in dry-run.
  if (process.env.FUNCTIONS_EMULATOR === 'true') return process.env.RESEND_API_KEY ?? '';

  if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.value;

  try {
    const [version] = await secrets().accessSecretVersion({
      name: `projects/${project()}/secrets/${SECRET}/versions/latest`,
    });
    const value = version.payload?.data?.toString() ?? '';
    cached = { value, at: Date.now() };
    return value;
  } catch (error) {
    // Not configured yet is the ordinary case on a fresh project, and it must
    // read as "nothing sent" rather than as a crash loop on the trigger.
    logger.warn('could not read the Resend key', { error: String(error) });
    return '';
  }
}

/**
 * Adds a new version of the existing secret.
 *
 * Creating it is deliberately not possible from here: the runtime account holds
 * accessor/viewer/versionAdder on this one secret rather than anything
 * project-wide, so a compromised function cannot mint or read other secrets.
 * The secret itself is created once, out of band:
 *
 *     npx firebase functions:secrets:set RESEND_API_KEY
 */
export async function writeResendKey(value: string): Promise<void> {
  const name = `projects/${project()}/secrets/${SECRET}`;

  try {
    await secrets().getSecret({ name });
  } catch (error) {
    // 5 is gRPC NOT_FOUND. Anything else — a missing role, most likely — must
    // surface as itself rather than as "no such secret".
    const missing = (error as { code?: number })?.code === 5;
    logger.error('cannot reach the secret', { missing, error: String(error) });
    throw new Error(
      missing
        ? `${SECRET} does not exist yet. Create it with: firebase functions:secrets:set ${SECRET}`
        : `Could not read ${SECRET}. Check the runtime account's Secret Manager roles.`,
    );
  }

  await secrets().addSecretVersion({
    parent: name,
    payload: { data: Buffer.from(value, 'utf8') },
  });

  cached = { value, at: Date.now() };
}

/**
 * Enough to tell one key from another without disclosing either. Never return
 * the key itself to a client — an admin who needs it has Secret Manager.
 */
export const keyHint = (value: string) => (value ? `…${value.slice(-4)}` : '');
