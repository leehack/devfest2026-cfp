import { publicApiSessions } from '@shared/publicApi';

import { publicApiJson, publicApiPreflight } from '../../../../../server/publicApi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ cfpId: string }> }) {
  return publicApiJson(request, (await params).cfpId, publicApiSessions);
}

export const OPTIONS = publicApiPreflight;
