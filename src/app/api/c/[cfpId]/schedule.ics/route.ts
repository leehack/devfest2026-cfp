import { scheduleIcs } from '@shared/calendar';

import {
  publicApiHeaders,
  publicApiInput,
  publicApiNotFound,
  publicApiPreflight,
} from '../../../../../server/publicApi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ cfpId: string }> }) {
  const input = await publicApiInput(request, (await params).cfpId);
  if (!input) return publicApiNotFound();
  const { cfpId, eventName, schedule, entries, language, origin } = input;
  return new Response(scheduleIcs(cfpId, eventName, schedule, entries, language, origin), {
    headers: publicApiHeaders('text/calendar; charset=utf-8'),
  });
}

export const OPTIONS = publicApiPreflight;
