import { describe, expect, it } from 'vitest';

import {
  documentTitle,
  headerTitle,
  sessionDocumentTitle,
} from '../src/components/AppNavigation';
import { en } from '../src/i18n/en';
import type { Place } from '../src/lib/router';

const cfp = 'DevFest Montréal 2026';

describe('navigation labels', () => {
  const cases: Array<[Place, string, string]> = [
    [{ route: 'home', cfpId: null, tab: 'overview' }, 'Call for Proposals', 'Call for Proposals'],
    [
      { route: 'new', cfpId: null, tab: 'overview' },
      'Create your call for proposals',
      'Create your call for proposals — Call for Proposals',
    ],
    [
      { route: 'platform', cfpId: null, tab: 'overview' },
      'Platform administration',
      'Platform administration — Call for Proposals',
    ],
    [
      { route: 'me', cfpId: null, tab: 'overview' },
      'Your profile',
      'Your profile — Call for Proposals',
    ],
    [
      { route: 'cfp', cfpId: 'devfest-mtl-2026', tab: 'overview' },
      cfp,
      cfp,
    ],
    [
      { route: 'form', cfpId: 'devfest-mtl-2026', tab: 'overview' },
      cfp,
      `My proposals — ${cfp} — Call for Proposals`,
    ],
    [
      { route: 'review', cfpId: 'devfest-mtl-2026', tab: 'overview' },
      cfp,
      `Review talks — ${cfp} — Call for Proposals`,
    ],
    [
      { route: 'schedule', cfpId: 'devfest-mtl-2026', tab: 'overview' },
      cfp,
      `Programme — ${cfp}`,
    ],
    [
      { route: 'session', cfpId: 'devfest-mtl-2026', tab: 'overview', entryId: 'one' },
      cfp,
      `Programme — ${cfp}`,
    ],
    [
      { route: 'admin', cfpId: 'devfest-mtl-2026', tab: 'email' },
      cfp,
      `Email — ${cfp} — Call for Proposals`,
    ],
  ];

  it.each(cases)('names %j as a page and browser task', (place, heading, title) => {
    expect(headerTitle(place, place.cfpId ? cfp : null, en)).toBe(heading);
    expect(documentTitle(place, place.cfpId ? cfp : null, en)).toBe(title);
  });

  it('uses the session title once a public detail is loaded', () => {
    expect(sessionDocumentTitle('Building reliable systems', cfp)).toBe(
      `Building reliable systems — ${cfp}`,
    );
  });
});
