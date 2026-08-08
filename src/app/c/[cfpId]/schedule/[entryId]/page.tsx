import type { Metadata } from 'next';

import { ClientApp } from '../../../../[[...slug]]/ClientApp';
import { readCfp, readPublishedSchedule } from '../../../../../server/publicCfps';
import { paths } from '../../../../../lib/paths';
import { publicEntryTitle } from '@shared/calendar';
import { cfpState } from '@shared/cfpWindow';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ cfpId: string; entryId: string }> }): Promise<Metadata> {
  const { cfpId, entryId } = await params;
  const [cfp, bundle] = await Promise.all([readCfp(cfpId), readPublishedSchedule(cfpId)]);
  const entry = bundle?.entries.find((candidate) => candidate.id === entryId);
  if (!cfp || !entry) return { title: 'Session', robots: { index: false, follow: false } };
  const listed = cfp.visibility === 'public' && !cfp.archived;
  const title = `${publicEntryTitle(entry, 'en')} — ${cfp.name}`;
  const description = entry.kind === 'proposal' ? entry.session.abstract.slice(0, 200) : publicEntryTitle(entry, 'en');
  return {
    title,
    description,
    robots: listed ? undefined : { index: false, follow: false },
    alternates: { canonical: paths.session(cfpId, entryId) },
    openGraph: { title, description, url: paths.session(cfpId, entryId) },
  };
}

export default async function SessionRoute({ params }: { params: Promise<{ cfpId: string; entryId: string }> }) {
  const { cfpId, entryId } = await params;
  const [cfp, schedule] = await Promise.all([readCfp(cfpId), readPublishedSchedule(cfpId)]);
  return <ClientApp initialPath={paths.session(cfpId, entryId)} initialCfp={{ id: cfpId, cfp: cfp ? { ...cfp, state: cfpState(cfp, Date.now()) } : null }} initialSchedule={cfp?.publishedScheduleId ? { releaseId: cfp.publishedScheduleId, value: schedule } : undefined} />;
}
