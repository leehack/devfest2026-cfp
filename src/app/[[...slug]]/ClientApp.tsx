'use client';

import { App } from '../../App';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import type { CfpWindow } from '../../lib/proposals';
import type { CfpState } from '@shared/cfpWindow';
import type { Localised } from '@shared/confirmForm';
import type { PublishedScheduleBundle } from '../../lib/schedule';

/** The client boundary. Nothing above this line ships to the browser. */
export interface InitialPublicCfp {
  id: string;
  name: string;
  description: Localised | null;
  website: string | null;
  venue: string | null;
  location: string | null;
  opensAtMs: number;
  closesAtMs: number;
  eventDate: string | null;
  eventStartDate: string | null;
  eventEndDate: string | null;
  timeZone: string | null;
  publishedScheduleId: string | null;
  paused: boolean;
  archived: boolean;
  visibility: 'public' | 'private';
  state: CfpState;
}

function toCfpWindow(cfp: InitialPublicCfp): CfpWindow {
  return {
    name: cfp.name,
    opensAt: new Date(cfp.opensAtMs),
    closesAt: new Date(cfp.closesAtMs),
    paused: cfp.paused,
    state: cfp.state,
    visibility: cfp.visibility,
    profile: {
      description: cfp.description ?? undefined,
      eventDate: cfp.eventDate ?? undefined,
      eventStartDate: cfp.eventStartDate ?? cfp.eventDate ?? undefined,
      eventEndDate: cfp.eventEndDate ?? cfp.eventStartDate ?? cfp.eventDate ?? undefined,
      timeZone: cfp.timeZone ?? undefined,
      venue: cfp.venue ?? undefined,
      location: cfp.location ?? undefined,
      website: cfp.website ?? undefined,
    },
    publishedScheduleId: cfp.publishedScheduleId ?? undefined,
  };
}

export function ClientApp({
  initialPath,
  initialCfp,
  initialSchedule,
}: {
  initialPath: string;
  initialCfp?: { id: string; cfp: InitialPublicCfp | null };
  initialSchedule?: { releaseId: string; value: PublishedScheduleBundle | null };
}) {
  return (
    <ErrorBoundary>
      <App
        initialPath={initialPath}
        initialCfp={
          initialCfp
            ? {
                id: initialCfp.id,
                value: initialCfp.cfp ? toCfpWindow(initialCfp.cfp) : null,
              }
            : undefined
        }
        initialSchedule={initialSchedule}
      />
    </ErrorBoundary>
  );
}
