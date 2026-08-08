import type { Metadata } from 'next';

import { ClientApp } from '../../../[[...slug]]/ClientApp';
import { readCfp, readPublishedSchedule } from '../../../../server/publicCfps';
import { paths } from '../../../../lib/paths';
import { cfpState } from '@shared/cfpWindow';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ cfpId: string }> }): Promise<Metadata> {
  const { cfpId } = await params;
  const cfp = await readCfp(cfpId);
  if (!cfp?.publishedScheduleId) return { title: 'Programme', robots: { index: false, follow: false } };
  const listed = cfp.visibility === 'public' && !cfp.archived;
  const title = `Programme — ${cfp.name}`;
  return {
    title,
    description: `The published programme for ${cfp.name}.`,
    robots: listed ? undefined : { index: false, follow: false },
    alternates: { canonical: paths.schedule(cfpId) },
    openGraph: { title, description: `The published programme for ${cfp.name}.`, url: paths.schedule(cfpId) },
  };
}

export default async function ScheduleRoute({ params }: { params: Promise<{ cfpId: string }> }) {
  const { cfpId } = await params;
  const [cfp, schedule] = await Promise.all([readCfp(cfpId), readPublishedSchedule(cfpId)]);
  return <ClientApp initialPath={paths.schedule(cfpId)} initialCfp={{ id: cfpId, cfp: cfp ? { ...cfp, state: cfpState(cfp, Date.now()) } : null }} initialSchedule={cfp?.publishedScheduleId ? { releaseId: cfp.publishedScheduleId, value: schedule } : undefined} />;
}
