import 'server-only';

const REGION = 'northamerica-northeast1';

function callableUrl(): string {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT;
  return process.env.FIRESTORE_EMULATOR_HOST
    ? `http://127.0.0.1:5001/${project}/${REGION}/publicSchedulePhoto`
    : `https://${REGION}-${project}.cloudfunctions.net/publicSchedulePhoto`;
}

/**
 * Asks the same anonymous callable the programme page uses, so the release,
 * cancellation and deletion fences stay in one place instead of being re-derived
 * here with the admin SDK.
 */
export async function readPublicSchedulePhoto(
  cfpId: string,
  releaseId: string,
  entryId: string,
  speakerIndex: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  const response = await fetch(callableUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { cfpId, releaseId, entryId, speakerIndex } }),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const { result } = (await response.json()) as {
    result?: { ok?: boolean; contentType?: string; base64?: string };
  };
  if (!result?.ok || !result.base64 || result.contentType !== 'image/webp') return null;
  return { bytes: Uint8Array.from(Buffer.from(result.base64, 'base64')), contentType: result.contentType };
}
