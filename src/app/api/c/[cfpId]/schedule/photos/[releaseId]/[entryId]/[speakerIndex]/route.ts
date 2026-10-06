import {
  publicApiHeaders,
  publicApiNotFound,
  publicApiPreflight,
} from '../../../../../../../../../server/publicApi';
import { readPublicSchedulePhoto } from '../../../../../../../../../server/publicSchedulePhoto';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ cfpId: string; releaseId: string; entryId: string; speakerIndex: string }> },
) {
  const { cfpId, releaseId, entryId, speakerIndex } = await params;
  const photo = /^\d{1,2}$/.test(speakerIndex)
    ? await readPublicSchedulePhoto(cfpId, releaseId, entryId, Number(speakerIndex))
    : null;
  if (!photo) return publicApiNotFound();
  return new Response(photo.bytes, {
    headers: publicApiHeaders(photo.contentType, 'public, max-age=300, s-maxage=300'),
  });
}

export const OPTIONS = publicApiPreflight;
