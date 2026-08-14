import sharp from 'sharp';
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  CFP_ID,
  callJson,
  createAccount,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
} from './backend';
import { at, signInAs, waitForAppHydration, type Identity } from './form';
import { preferencesTrigger, switchInterfaceLanguage } from './preferences';

const ADMIN: Identity = {
  sub: 'schedule-ux-admin',
  email: 'schedule-ux-admin@example.org',
  name: 'Ari Admin',
};
const FIRST_SPEAKER: Identity = {
  sub: 'schedule-ux-speaker-one',
  email: 'schedule-ux-speaker-one@example.org',
  name: 'Morgan Speaker',
};
const SECOND_SPEAKER: Identity = {
  sub: 'schedule-ux-speaker-two',
  email: 'schedule-ux-speaker-two@example.org',
  name: 'Riley Speaker',
};

const config = {
  timeZone: 'America/Toronto',
  revision: 0,
  days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
  rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
};

const interactionConfig = {
  timeZone: 'America/Toronto',
  revision: 0,
  days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '12:00' }],
  rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
};

async function programmePortrait(
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background },
  })
    .png()
    .toBuffer();
}

test.beforeEach(async () => {
  await reset();
});

async function seedSchedulePeople(secondProposal = false) {
  const [admin, first, second] = await Promise.all([
    createAccount(ADMIN),
    createAccount(FIRST_SPEAKER),
    createAccount(SECOND_SPEAKER),
  ]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedSpeaker(first.uid, { name: FIRST_SPEAKER.name, email: FIRST_SPEAKER.email }),
    seedSpeaker(second.uid, { name: SECOND_SPEAKER.name, email: SECOND_SPEAKER.email }),
    seedProposal('already-scheduled', {
      speakerUid: first.uid,
      title: 'Already scheduled',
      status: 'confirmed',
    }),
    ...(secondProposal
      ? [
          seedProposal('needs-a-place', {
            speakerUid: second.uid,
            title: 'Needs a place',
            status: 'confirmed',
          }),
        ]
      : []),
  ]);
  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    config,
    expectedRevision: 0,
  });
  await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: configured.revision,
    entry: {
      id: 'already-scheduled',
      kind: 'proposal',
      proposalId: 'already-scheduled',
      date: '2026-11-14',
      startsAt: '09:00',
      durationMinutes: 40,
      roomId: 'main',
    },
  });
  return admin;
}

async function seedInteractiveSchedule() {
  const [admin, speaker] = await Promise.all([
    createAccount(ADMIN),
    createAccount(SECOND_SPEAKER),
  ]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedSpeaker(speaker.uid, {
      name: SECOND_SPEAKER.name,
      email: SECOND_SPEAKER.email,
    }),
    seedProposal('needs-a-place', {
      speakerUid: speaker.uid,
      title: 'Needs a place',
      status: 'confirmed',
    }),
  ]);

  let revision = (
    await callJson(admin.idToken, 'setScheduleConfig', {
      config: interactionConfig,
      expectedRevision: 0,
    })
  ).revision as number;

  for (const entry of [
    { id: 'welcome', title: 'Welcome', startsAt: '09:00', durationMinutes: 15 },
    { id: 'coffee', title: 'Coffee', startsAt: '09:30', durationMinutes: 20 },
    { id: 'blocker', title: 'Blocker', startsAt: '09:55', durationMinutes: 5 },
    { id: 'workshop', title: 'Workshop', startsAt: '10:00', durationMinutes: 45 },
    { id: 'odd-slot', title: 'Odd slot', startsAt: '10:45', durationMinutes: 42 },
    { id: 'micro-break', title: 'Micro break', startsAt: '09:20', durationMinutes: 10 },
    { id: 'day-closer', title: 'Day closer', startsAt: '11:40', durationMinutes: 20 },
  ]) {
    revision = (
      await callJson(admin.idToken, 'upsertScheduleEntry', {
        expectedRevision: revision,
        entry: {
          id: entry.id,
          kind: 'custom',
          customType: 'break',
          title: { en: entry.title, fr: entry.title },
          date: '2026-11-14',
          startsAt: entry.startsAt,
          durationMinutes: entry.durationMinutes,
          roomId: 'main',
        },
      })
    ).revision as number;
  }
}

async function seedPublicAgenda() {
  const [admin, first, second] = await Promise.all([
    createAccount(ADMIN),
    createAccount(FIRST_SPEAKER),
    createAccount(SECOND_SPEAKER),
  ]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedSpeaker(first.uid, {
      name: FIRST_SPEAKER.name,
      email: FIRST_SPEAKER.email,
    }),
    seedSpeaker(second.uid, {
      name: SECOND_SPEAKER.name,
      email: SECOND_SPEAKER.email,
    }),
    seedProposal('first-session', {
      speakerUid: first.uid,
      title: 'Opening session',
      status: 'confirmed',
    }),
    seedProposal('second-session', {
      speakerUid: second.uid,
      title: 'Later session',
      status: 'confirmed',
    }),
  ]);

  let revision = (
    await callJson(admin.idToken, 'setScheduleConfig', {
      config: {
        timeZone: 'America/Toronto',
        revision: 0,
        days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
        // Configured room order is intentionally not alphabetical.
        rooms: [
          { id: 'blue', name: { en: 'Blue room', fr: 'Salle bleue' } },
          { id: 'amber', name: { en: 'Amber room', fr: 'Salle ambre' } },
        ],
      },
      expectedRevision: 0,
    })
  ).revision as number;

  for (const entry of [
    {
      id: 'first-session',
      kind: 'proposal',
      proposalId: 'first-session',
      date: '2026-11-14',
      startsAt: '10:00',
      durationMinutes: 40,
      roomId: 'blue',
    },
    {
      id: 'second-session',
      kind: 'proposal',
      proposalId: 'second-session',
      date: '2026-11-14',
      startsAt: '11:00',
      durationMinutes: 40,
      roomId: 'blue',
    },
    {
      id: 'coffee-break',
      kind: 'custom',
      customType: 'break',
      language: 'bilingual',
      title: { en: 'Coffee break', fr: 'Pause café' },
      date: '2026-11-14',
      startsAt: '10:00',
      durationMinutes: 20,
      roomId: 'amber',
    },
  ]) {
    revision = (
      await callJson(admin.idToken, 'upsertScheduleEntry', {
        expectedRevision: revision,
        entry,
      })
    ).revision as number;
  }

  const shared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: revision,
  });
  await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: shared.revision,
  });
}

async function seedNewerTwoDayStaffPreview() {
  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);

  let revision = (
    await callJson(admin.idToken, 'setScheduleConfig', {
      config: {
        timeZone: 'America/Toronto',
        revision: 0,
        days: [
          { date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' },
          { date: '2026-11-15', startsAt: '09:00', endsAt: '17:00' },
        ],
        rooms: [
          { id: 'blue', name: { en: 'Blue room', fr: 'Salle bleue' } },
          { id: 'amber', name: { en: 'Amber room', fr: 'Salle ambre' } },
        ],
      },
      expectedRevision: 0,
    })
  ).revision as number;

  revision = (
    await callJson(admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: revision,
      entry: {
        id: 'published-opening',
        kind: 'custom',
        customType: 'opening',
        title: { en: 'Published opening', fr: 'Ouverture publiée' },
        date: '2026-11-14',
        startsAt: '09:00',
        durationMinutes: 30,
        roomId: 'blue',
      },
    })
  ).revision as number;
  const sharedA = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: revision,
  });
  const publishedA = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: sharedA.revision,
  });
  revision = publishedA.revision as number;

  const previewItems = [
    ['preview-doors', 'Doors open', '09:00', 'opening', 'blue'],
    ['preview-breakfast', 'Community breakfast', '10:00', 'meal', 'amber'],
    ['preview-keynote', 'Second-day keynote', '11:00', 'keynote', 'blue'],
    ['preview-lunch', 'Community lunch', '12:00', 'meal', 'amber'],
    ['preview-mentors', 'Mentor matching', '13:00', 'social', 'blue'],
    ['preview-maintainers', 'Maintainer roundtable', '14:00', 'other', 'amber'],
    ['preview-lounge', 'Community lounge', '15:00', 'social', 'blue'],
    ['preview-closing-circle', 'Shared preview closing circle', '16:00', 'closing', 'amber'],
  ] as const;
  for (const [id, title, startsAt, customType, roomId] of previewItems) {
    revision = (
      await callJson(admin.idToken, 'upsertScheduleEntry', {
        expectedRevision: revision,
        entry: {
          id,
          kind: 'custom',
          customType,
          title: { en: title, fr: title },
          date: '2026-11-15',
          startsAt,
          durationMinutes: 30,
          roomId,
        },
      })
    ).revision as number;
  }
  const sharedB = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: revision,
  });
  return {
    publishedReleaseId: publishedA.releaseId as string,
    sharedReleaseId: sharedB.releaseId as string,
  };
}

async function bounds(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

async function expectHorizontallyContained(inner: Locator, outer: Locator) {
  const [innerBox, outerBox] = await Promise.all([bounds(inner), bounds(outer)]);
  expect(innerBox.x).toBeGreaterThanOrEqual(outerBox.x - 1);
  expect(innerBox.x + innerBox.width).toBeLessThanOrEqual(
    outerBox.x + outerBox.width + 1,
  );
}

async function expectNoHorizontalOverflow(locator: Locator) {
  const overflow = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

interface AgendaPosition {
  scrollY: number;
  viewportTop: number;
}

async function placeAgendaLinkAt(
  page: Page,
  link: Locator,
  viewportTop: number,
): Promise<AgendaPosition> {
  await link.evaluate((element, top) => {
    const root = element.ownerDocument.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - top);
    root.style.scrollBehavior = previous;
  }, viewportTop);
  await expect(link).toBeInViewport();
  const position = await link.evaluate((element) => ({
    scrollY: window.scrollY,
    viewportTop: element.getBoundingClientRect().top,
  }));
  expect(position.scrollY).toBeGreaterThan(0);
  expect(position.viewportTop).toBeGreaterThanOrEqual(0);
  expect(position.viewportTop).toBeLessThan(await page.evaluate(() => window.innerHeight));
  return position;
}

async function expectAgendaLinkPositionRestored(
  page: Page,
  link: Locator,
  expected: AgendaPosition,
) {
  await expect(link).toBeFocused();
  await expect
    .poll(async () =>
      Math.abs(
        (await link.evaluate((element) => element.getBoundingClientRect().top)) -
          expected.viewportTop,
      ),
    )
    .toBeLessThanOrEqual(2);
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - expected.scrollY))
    .toBeLessThanOrEqual(2);
}

async function openLaterSessionFromDeepInTheAgenda(page: Page): Promise<AgendaPosition> {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto(at('/schedule'));
  await waitForAppHydration(page);

  await page.getByRole('combobox', { name: 'Room / track' }).selectOption('blue');
  await page.getByRole('combobox', { name: 'Scheduled language' }).selectOption('en');
  const link = page.getByRole('link', { name: 'Later session', exact: true });
  const position = await placeAgendaLinkAt(page, link, 160);

  await link.click();
  await expect(page).toHaveURL(at('/schedule/second-session'));
  await expect(page.getByRole('heading', { level: 2, name: 'Later session' })).toBeVisible();
  const main = page.locator('#main-content');
  await expect(main).toHaveAttribute(
    'aria-label',
    'Later session — DevFest Montréal 2026',
  );
  await expect(main).toBeFocused();
  return position;
}

async function expectLaterSessionPositionRestored(page: Page, expected: AgendaPosition) {
  await expect(page).toHaveURL(at('/schedule'));
  await expect(page.getByRole('combobox', { name: 'Room / track' })).toHaveValue('blue');
  await expect(page.getByRole('combobox', { name: 'Scheduled language' })).toHaveValue('en');

  const link = page.getByRole('link', { name: 'Later session', exact: true });
  await expectAgendaLinkPositionRestored(page, link, expected);
}

async function beginNativeDrag(
  page: Page,
  source: Locator,
  targetSegment: Locator,
  minutesAfterSegment: number,
) {
  await source.scrollIntoViewIfNeeded();
  await targetSegment.scrollIntoViewIfNeeded();
  const sourceBox = await bounds(source);
  const targetBox = await bounds(targetSegment);
  const x = targetBox.x + targetBox.width / 2;
  const y = targetBox.y + minutesAfterSegment * 1.6;
  await page.mouse.move(sourceBox.x + 9, sourceBox.y + 9);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + 25, sourceBox.y + 20, { steps: 4 });
  await page.mouse.move(x, y, { steps: 12 });
}

test('schedule editing stays complete on mobile and reports conflicts inside a focus-contained dialog', async ({
  page,
}) => {
  await seedSchedulePeople(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, ADMIN, at('/admin/schedule'));

  await page.getByRole('button', { name: 'Move or edit: Already scheduled' }).click();
  let dialog = page.getByRole('dialog', { name: 'Already scheduled' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Remove from schedule' })).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Cancel' }).first();
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Save item' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await close.click();

  await page.getByRole('button', { name: 'Edit placement' }).click();
  dialog = page.getByRole('dialog', { name: 'Needs a place' });
  await dialog.getByRole('button', { name: 'Save item' }).click();
  await expect(
    dialog.getByRole('alert').filter({
      hasText: 'That placement overlaps a room or speaker already scheduled.',
    }),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.schedule-dialog__feedback')).toBeFocused();
  await dialog.getByRole('button', { name: 'Save item' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' }).first()).toBeFocused();
});

test('custom programme items can carry or clear a scheduled language', async ({ page }) => {
  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);
  await callJson(admin.idToken, 'setScheduleConfig', {
    config: interactionConfig,
    expectedRevision: 0,
  });
  await signInAs(page, ADMIN, at('/admin/schedule'));

  await page.getByRole('button', { name: 'Add programme item' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add programme item' });
  const language = dialog.getByRole('combobox', { name: /^Scheduled language/ });
  await expect(language).toHaveValue('');
  await expect(language.locator('option[value=""]')).toHaveText('Not language-specific');
  await language.selectOption('bilingual');
  await dialog.getByRole('textbox', { name: /^Title \(English\)/ }).fill('Community lounge');
  await dialog.getByRole('button', { name: 'Save item' }).click();

  const placement = page.getByRole('button', { name: 'Move or edit: Community lounge' });
  await expect(placement).toBeVisible();
  await placement.click();
  dialog = page.getByRole('dialog', { name: 'Add programme item' });
  await expect(dialog.getByRole('combobox', { name: /^Scheduled language/ })).toHaveValue(
    'bilingual',
  );
  await dialog.getByRole('combobox', { name: /^Scheduled language/ }).selectOption('');
  await dialog.getByRole('button', { name: 'Save item' }).click();

  await placement.click();
  await expect(
    page.getByRole('dialog', { name: 'Add programme item' }).getByRole('combobox', {
      name: /^Scheduled language/,
    }),
  ).toHaveValue('');
});

test('server-rendered programme routes keep their CFP data through hydration', async ({
  page,
}) => {
  await seedPublicAgenda();
  const browserCfpReads: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    const body = request.postData() ?? '';
    if (
      url.includes('/v1/projects/') &&
      (url.includes('/documents/cfps/') || body.includes('/documents/cfps/'))
    ) {
      browserCfpReads.push(url);
    }
  });

  await page.goto(at('/schedule'));
  await waitForAppHydration(page);
  const roomFilter = page.getByRole('combobox', { name: 'Room / track' });
  await roomFilter.selectOption('blue');
  await expect(page.getByRole('link', { name: 'Coffee break' })).toHaveCount(0);
  expect(browserCfpReads).toEqual([]);

  await page.goto(at('/schedule/second-session'));
  await waitForAppHydration(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Later session' })).toBeVisible();
  expect(browserCfpReads).toEqual([]);
});

test('public agenda groups simultaneous rooms and keeps one room chronological on mobile', async ({
  page,
}) => {
  await seedPublicAgenda();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(at('/schedule'));

  const roomFilter = page.getByRole('combobox', { name: 'Room / track' });
  await expect(roomFilter).toHaveValue('all');
  const agenda = page.getByRole('tabpanel');
  const timeBands = agenda.getByRole('listitem', {
    name: /^Sessions starting at /,
  });
  await expect(timeBands).toHaveCount(2);
  expect(await timeBands.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))).toEqual([
    'Sessions starting at 10:00',
    'Sessions starting at 11:00',
  ]);

  const tenOClock = agenda.getByRole('listitem', {
    name: 'Sessions starting at 10:00',
  });
  await expect(tenOClock.getByRole('list')).toHaveCount(1);
  const simultaneousCards = tenOClock.getByRole('article');
  await expect(simultaneousCards).toHaveCount(2);
  await expect(simultaneousCards.nth(0).getByText('Blue room', { exact: true })).toBeVisible();
  await expect(
    simultaneousCards.nth(0).getByRole('link', { name: 'Opening session' }),
  ).toBeVisible();
  await expect(simultaneousCards.nth(1).getByText('Amber room', { exact: true })).toBeVisible();
  await expect(
    simultaneousCards.nth(1).getByRole('link', { name: 'Coffee break' }),
  ).toBeVisible();

  const containment = await agenda.evaluate((node) => {
    const root = document.documentElement;
    const cards = [...node.querySelectorAll<HTMLElement>('.agenda-item--card')];
    return {
      pageClientWidth: root.clientWidth,
      pageScrollWidth: root.scrollWidth,
      agendaClientWidth: (node as HTMLElement).clientWidth,
      agendaScrollWidth: (node as HTMLElement).scrollWidth,
      cardBounds: cards.map((card) => {
        const box = card.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
    };
  });
  expect(containment.pageScrollWidth).toBeLessThanOrEqual(containment.pageClientWidth);
  expect(containment.agendaScrollWidth).toBeLessThanOrEqual(containment.agendaClientWidth);
  for (const card of containment.cardBounds) {
    expect(card.left).toBeGreaterThanOrEqual(0);
    expect(card.right).toBeLessThanOrEqual(containment.pageClientWidth);
  }

  const languageFilter = page.getByRole('combobox', { name: 'Scheduled language' });
  await languageFilter.selectOption('bilingual');
  await expect(page.getByRole('link', { name: 'Coffee break' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Opening session' })).toHaveCount(0);
  await page.reload();
  await expect(languageFilter).toHaveValue('bilingual');
  await expect(page.getByRole('link', { name: 'Coffee break' })).toBeVisible();
  await languageFilter.selectOption('all');

  await roomFilter.selectOption('blue');
  await expect(timeBands).toHaveCount(0);
  const timeline = agenda.locator('.agenda-list--one-room');
  await expect(timeline).toBeVisible();
  const timelineItems = timeline.getByRole('listitem');
  await expect(timelineItems).toHaveCount(2);
  expect(await timelineItems.getByRole('link').allTextContents()).toEqual([
    'Opening session',
    'Later session',
  ]);
  await expect(timelineItems.nth(0).getByText('10:00–10:40', { exact: true })).toBeVisible();
  await expect(timelineItems.nth(1).getByText('11:00–11:40', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Coffee break' })).toHaveCount(0);
  await expect(timeline.locator('.agenda-item__line')).toHaveCount(2);
});

for (const [title, returnWith] of [
  ['programme Back restores the exact filtered agenda position', 'link'],
  ['browser Back restores the exact filtered agenda position', 'history'],
] as const) {
  test(title, async ({ page }) => {
    await seedPublicAgenda();
    const expected = await openLaterSessionFromDeepInTheAgenda(page);

    if (returnWith === 'link') {
      await page
        .getByRole('article')
        .getByRole('link', { name: /Back to the programme/ })
        .click();
    } else {
      await page.goBack();
    }

    await expectLaterSessionPositionRestored(page, expected);
  });
}

test('staff Back restores a second-day custom item in the newer shared preview', async ({
  page,
}) => {
  const releases = await seedNewerTwoDayStaffPreview();
  expect(releases.sharedReleaseId).not.toBe(releases.publishedReleaseId);
  await page.setViewportSize({ width: 1440, height: 700 });
  await signInAs(page, ADMIN, at('/schedule'));

  await expect(page.getByRole('heading', { level: 2, name: 'Committee preview' })).toBeVisible();
  const days = page.getByRole('tab');
  await days.nth(1).click();
  await expect(days.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox', { name: 'Room / track' })).toHaveValue('all');
  await expect(page.getByRole('combobox', { name: 'Scheduled language' })).toHaveValue('all');

  const title = 'Shared preview closing circle';
  const link = page.getByRole('link', { name: title, exact: true });
  const expected = await placeAgendaLinkAt(page, link, 180);
  await link.click();
  await expect(page).toHaveURL(at('/schedule/preview-closing-circle'));
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();

  await page
    .getByRole('article')
    .getByRole('link', { name: /Back to the programme/ })
    .click();
  await expect(page).toHaveURL(at('/schedule'));
  await expect(page.getByRole('heading', { level: 2, name: 'Committee preview' })).toBeVisible();
  await expect(days.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox', { name: 'Room / track' })).toHaveValue('all');
  await expect(page.getByRole('combobox', { name: 'Scheduled language' })).toHaveValue('all');
  await expectAgendaLinkPositionRestored(
    page,
    page.getByRole('link', { name: title, exact: true }),
    expected,
  );
});

test('a directly opened session falls back to a normal programme link', async ({ page }) => {
  await seedPublicAgenda();
  await page.goto(at('/schedule/second-session'));
  await expect(page.getByRole('heading', { level: 2, name: 'Later session' })).toBeVisible();

  await page
    .getByRole('article')
    .getByRole('link', { name: /Back to the programme/ })
    .click();
  await expect(page).toHaveURL(at('/schedule'));
  await expect(page.getByRole('heading', { level: 2, name: 'Programme' })).toBeVisible();
  await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox', { name: 'Room / track' })).toHaveValue('all');
  await expect(page.getByRole('combobox', { name: 'Scheduled language' })).toHaveValue('all');

  // The fallback pushed the programme like an ordinary link; it did not try
  // to consume history that belongs to the direct visit.
  await page.goBack();
  await expect(page).toHaveURL(at('/schedule/second-session'));
  await expect(page.getByRole('heading', { level: 2, name: 'Later session' })).toBeVisible();
});

test('a CFP-less route waits for the session label before moving focus', async ({ page }) => {
  await seedPublicAgenda();
  await page.goto('/');
  await waitForAppHydration(page);
  await expect(page.getByRole('link', { name: 'DevFest Montréal 2026' })).toBeVisible();

  let releaseLookup!: () => void;
  const lookupHeld = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  let markLookupStarted!: () => void;
  const lookupStarted = new Promise<void>((resolve) => {
    markLookupStarted = resolve;
  });
  let holdingLookup = true;
  await page.route('http://127.0.0.1:8080/**', async (route) => {
    const request = route.request();
    const requestData = `${request.url()}\n${request.postData() ?? ''}`;
    if (holdingLookup && requestData.includes(`/documents/cfps/${CFP_ID}`)) {
      holdingLookup = false;
      markLookupStarted();
      await lookupHeld;
    }
    await route.continue();
  });

  const main = page.locator('#main-content');
  await page.locator('.skip-link').focus();
  try {
    await page.evaluate((path) => {
      const focusLabels: string[] = [];
      const content = document.getElementById('main-content');
      (window as typeof window & { __routeFocusLabels?: string[] }).__routeFocusLabels =
        focusLabels;
      content?.addEventListener('focus', () => {
        focusLabels.push(content.getAttribute('aria-label') ?? '');
      });
      window.history.pushState(null, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, at('/schedule/second-session'));
    await lookupStarted;
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

    await expect(main).not.toBeFocused();
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __routeFocusLabels?: string[] }).__routeFocusLabels,
      ),
    ).toEqual([]);
  } finally {
    releaseLookup();
  }

  await expect(page.getByRole('heading', { level: 2, name: 'Later session' })).toBeVisible();
  await expect(main).toHaveAttribute(
    'aria-label',
    'Later session — DevFest Montréal 2026',
  );
  await expect(main).toBeFocused();
  expect(
    await page.evaluate(
      () => (window as typeof window & { __routeFocusLabels?: string[] }).__routeFocusLabels,
    ),
  ).toEqual(['Later session — DevFest Montréal 2026']);
});

test('in-app session navigation focuses a landmark named for each session', async ({ page }) => {
  await seedPublicAgenda();
  await page.goto(at('/schedule'));
  await waitForAppHydration(page);

  await page.getByRole('link', { name: 'Opening session', exact: true }).click();
  const main = page.locator('#main-content');
  await expect(main).toHaveAttribute(
    'aria-label',
    'Opening session — DevFest Montréal 2026',
  );
  await expect(main).toBeFocused();

  await page.evaluate((path) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, at('/schedule/second-session'));
  await expect(page.getByRole('heading', { level: 2, name: 'Later session' })).toBeVisible();
  await expect(main).toHaveAttribute(
    'aria-label',
    'Later session — DevFest Montréal 2026',
  );
  await expect(main).toBeFocused();
});

test('custom programme item speakers are optional, repeatable, removable, and public in order', async ({
  page,
}) => {
  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);
  await callJson(admin.idToken, 'setScheduleConfig', {
    config: interactionConfig,
    expectedRevision: 0,
  });
  await signInAs(page, ADMIN, at('/admin/schedule'));

  await page.getByRole('button', { name: 'Add programme item' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add programme item' });
  await dialog.getByRole('textbox', { name: /^Title \(English\)/ }).fill('Community panel');
  let speakers = dialog.getByRole('group', { name: 'Speakers (optional)' });
  await expect(
    speakers.getByText('No speakers added. This item will appear without a speaker section.'),
  ).toBeVisible();
  await expect(speakers.getByRole('group', { name: /^Speaker / })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Save item' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save item' }).click();

  const placement = page.getByRole('button', { name: 'Move or edit: Community panel' });
  await expect(placement).toBeVisible();
  await placement.click();
  dialog = page.getByRole('dialog', { name: 'Add programme item' });
  speakers = dialog.getByRole('group', { name: 'Speakers (optional)' });
  await speakers.getByRole('button', { name: 'Add speaker' }).click();
  await expect(dialog.getByRole('button', { name: 'Save item' })).toBeDisabled();
  await expect(
    speakers.getByRole('status').filter({
      hasText: 'Add a name for every speaker before saving.',
    }),
  ).toBeVisible();
  await speakers.getByRole('button', { name: 'Add speaker' }).click();
  await expect(speakers.getByRole('group', { name: /^Speaker / })).toHaveCount(2);

  let speakerOne = speakers.getByRole('group', { name: 'Speaker 1' });
  let speakerTwo = speakers.getByRole('group', { name: 'Speaker 2' });
  const speakerOneName = speakerOne.getByRole('textbox', { name: /^Speaker 1 name/ });
  const speakerTwoName = speakerTwo.getByRole('textbox', { name: /^Speaker 2 name/ });
  await speakerOneName.fill('Keya Remove');
  await speakerTwoName.fill('Lucas Maintained');
  await expect(speakerOneName).toHaveValue('Keya Remove');
  await expect(speakerTwoName).toHaveValue('Lucas Maintained');
  await speakerTwo
    .getByRole('textbox', { name: 'Speaker 2 role / job title' })
    .fill('Panel moderator');
  await speakerTwo
    .getByRole('textbox', { name: 'Speaker 2 organization' })
    .fill('Community Guild');
  await speakerTwo
    .getByRole('textbox', { name: 'Speaker 2 bio' })
    .fill('Keeps community conversations useful and welcoming.');
  await expect(dialog.getByRole('button', { name: 'Save item' })).toBeEnabled();

  await speakers.getByRole('button', { name: 'Remove speaker 1' }).click();
  await expect(speakers.getByRole('group', { name: 'Speaker 2' })).toHaveCount(0);
  speakerOne = speakers.getByRole('group', { name: 'Speaker 1' });
  await expect(speakerOne.getByRole('textbox', { name: /^Speaker 1 name/ })).toHaveValue(
    'Lucas Maintained',
  );
  await expect(
    speakerOne.getByRole('textbox', { name: 'Speaker 1 role / job title' }),
  ).toHaveValue('Panel moderator');
  await speakers.getByRole('button', { name: 'Add speaker' }).click();
  speakerTwo = speakers.getByRole('group', { name: 'Speaker 2' });
  await speakerTwo.getByRole('textbox', { name: /^Speaker 2 name/ }).fill('Nadia Added');
  await dialog.getByRole('button', { name: 'Save item' }).click();

  await placement.click();
  dialog = page.getByRole('dialog', { name: 'Add programme item' });
  speakers = dialog.getByRole('group', { name: 'Speakers (optional)' });
  await expect(speakers.getByRole('textbox', { name: /^Speaker 1 name/ })).toHaveValue(
    'Lucas Maintained',
  );
  await expect(speakers.getByRole('textbox', { name: /^Speaker 2 name/ })).toHaveValue(
    'Nadia Added',
  );
  await expect(speakers.getByText('2 of 20 speakers', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).first().click();

  await page.getByRole('button', { name: 'Review and share' }).click();
  let releaseDialog = page.getByRole('dialog', { name: 'Share this confirmed preview?' });
  await releaseDialog.getByRole('button', { name: 'Share preview' }).click();
  await page.getByRole('button', { name: 'Review and publish' }).click();
  releaseDialog = page.getByRole('dialog', { name: 'Publish this programme?' });
  await releaseDialog.getByRole('button', { name: 'Publish programme' }).click();

  await page.goto(at('/schedule'));
  const panelLink = page.getByRole('link', { name: 'Community panel' });
  const agendaCard = page.getByRole('article').filter({ has: panelLink });
  await expect(agendaCard).toContainText('Lucas Maintained, Nadia Added');
  await panelLink.click();

  const detail = page.getByRole('article');
  await expect(detail.getByRole('heading', { name: 'Speakers' })).toBeVisible();
  expect(await detail.getByRole('heading', { level: 4 }).allTextContents()).toEqual([
    'Lucas Maintained',
    'Nadia Added',
  ]);
  await expect(detail.getByText('Panel moderator · Community Guild', { exact: true })).toBeVisible();
  await expect(
    detail.getByText('Keeps community conversations useful and welcoming.', { exact: true }),
  ).toBeVisible();
  await expect(detail.getByText('Keya Remove')).toHaveCount(0);
});

test('an admin uploads, reopens, and removes a custom programme speaker photo', async ({
  page,
}) => {
  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);
  await callJson(admin.idToken, 'setScheduleConfig', {
    config: interactionConfig,
    expectedRevision: 0,
  });
  const tiny = await programmePortrait(799, 900, { r: 55, g: 95, b: 170 });
  const original = await programmePortrait(920, 860, { r: 35, g: 125, b: 185 });
  await signInAs(page, ADMIN, at('/admin/schedule'));

  await page.getByRole('button', { name: 'Add programme item' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add programme item' });
  await dialog.getByRole('textbox', { name: /^Title \(English\)/ }).fill('Guest keynote');
  let speakers = dialog.getByRole('group', { name: 'Speakers (optional)' });
  await speakers.getByRole('button', { name: 'Add speaker' }).click();
  let speaker = speakers.getByRole('group', { name: 'Speaker 1' });
  await speaker.getByRole('textbox', { name: /^Speaker 1 name/ }).fill('Jordan Guest');
  const input = speaker.getByLabel('Choose speaker 1 programme photo');

  await input.setInputFiles({
    name: 'too-small.png',
    mimeType: 'image/png',
    buffer: tiny,
  });
  await expect(
    speaker.getByText('Choose a photo at least 800 pixels on both sides.'),
  ).toBeVisible();
  const photoError = speaker.getByText('Choose a photo at least 800 pixels on both sides.');
  const photoErrorId = await photoError.getAttribute('id');
  expect(photoErrorId).toBeTruthy();
  await expect(input).toHaveAttribute('tabindex', '-1');
  await expect(input).toHaveAttribute('aria-describedby', photoErrorId!);
  await expect(input).toHaveAttribute('aria-errormessage', photoErrorId!);
  await expect(speaker.getByRole('button', { name: 'Choose photo' })).toHaveAttribute(
    'aria-describedby',
    photoErrorId!,
  );

  let releaseUpload = () => {};
  let markUploadStarted = () => {};
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const uploadStarted = new Promise<void>((resolve) => {
    markUploadStarted = resolve;
  });
  await page.route('**/uploadCustomScheduleSpeakerPhoto', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    markUploadStarted();
    await uploadGate;
    await route.continue();
  });

  await input.setInputFiles({
    name: 'jordan.png',
    mimeType: 'image/png',
    buffer: original,
  });
  await uploadStarted;
  await expect(dialog.getByRole('button', { name: 'Save item' })).toBeDisabled();
  await expect(speakers.getByRole('button', { name: 'Add speaker' })).toBeDisabled();
  await expect(speaker.getByRole('button', { name: 'Remove speaker 1' })).toBeDisabled();
  await expect(speaker.getByText('Uploading…')).toBeVisible();
  releaseUpload();
  await expect(speaker.locator('.schedule-custom-speaker-photo img')).toBeVisible();
  await expect(
    speaker.getByText('Photo ready. Save this programme item to attach it.'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save item' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save item' }).click();

  const placement = page.getByRole('button', { name: 'Move or edit: Guest keynote' });
  await expect(placement).toBeVisible();
  await placement.click();
  dialog = page.getByRole('dialog', { name: 'Add programme item' });
  speakers = dialog.getByRole('group', { name: 'Speakers (optional)' });
  speaker = speakers.getByRole('group', { name: 'Speaker 1' });
  await expect(speaker.locator('.schedule-custom-speaker-photo img')).toBeVisible();
  await expect(speaker.getByText('Replace photo', { exact: true })).toBeVisible();

  page.once('dialog', async (confirmation) => {
    expect(confirmation.message()).toBe('Remove this photo from the working programme item?');
    await confirmation.accept();
  });
  await speaker.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(speaker.locator('.schedule-custom-speaker-photo img')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save item' }).click();

  await placement.click();
  dialog = page.getByRole('dialog', { name: 'Add programme item' });
  speaker = dialog
    .getByRole('group', { name: 'Speakers (optional)' })
    .getByRole('group', { name: 'Speaker 1' });
  await expect(speaker.locator('.schedule-custom-speaker-photo img')).toHaveCount(0);
  await expect(speaker.getByText('Choose photo', { exact: true })).toBeVisible();
});

test('custom speaker rows stay aligned and contained across desktop, tablet, mobile, and French', async ({
  page,
}) => {
  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);
  await callJson(admin.idToken, 'setScheduleConfig', {
    config: interactionConfig,
    expectedRevision: 0,
  });
  await signInAs(page, ADMIN, at('/admin/schedule'));

  const copy = {
    en: {
      open: 'Add programme item',
      speakers: 'Speakers (optional)',
      add: 'Add speaker',
      speaker: (number: number) => `Speaker ${number}`,
      name: (number: number) => `Speaker ${number} name`,
      jobTitle: (number: number) => `Speaker ${number} role / job title`,
      company: (number: number) => `Speaker ${number} organization`,
      bio: (number: number) => `Speaker ${number} bio`,
      nameMissing: "Enter this speaker's name.",
      validation: 'Add a name for every speaker before saving.',
      remove: 'Remove from schedule',
      cancel: 'Cancel',
      save: 'Save item',
    },
    fr: {
      open: 'Ajouter un élément',
      speakers: 'Conférenciers (facultatif)',
      add: 'Ajouter un conférencier',
      speaker: (number: number) => `Conférencier ${number}`,
      name: (number: number) => `Nom du conférencier ${number}`,
      jobTitle: (number: number) => `Rôle ou poste du conférencier ${number}`,
      company: (number: number) => `Organisation du conférencier ${number}`,
      bio: (number: number) => `Biographie du conférencier ${number}`,
      nameMissing: 'Saisissez le nom de ce conférencier.',
      validation: 'Ajoutez un nom pour chaque conférencier avant d’enregistrer.',
      remove: 'Retirer de l’horaire',
      cancel: 'Annuler',
      save: 'Enregistrer',
    },
  } as const;
  const scenarios = [
    { width: 1440, height: 900, locale: 'en', stacked: false },
    { width: 700, height: 900, locale: 'en', stacked: false },
    { width: 641, height: 900, locale: 'en', stacked: true },
    { width: 640, height: 900, locale: 'en', stacked: true },
    { width: 390, height: 844, locale: 'en', stacked: true },
    { width: 700, height: 900, locale: 'fr', stacked: false },
  ] as const;
  let locale: 'en' | 'fr' = 'en';

  for (const scenario of scenarios) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    if (scenario.locale !== locale) {
      await switchInterfaceLanguage(page, 'fr');
      await expect(preferencesTrigger(page, 'fr')).toBeVisible();
      locale = 'fr';
    }

    const labels = copy[locale];
    await page.getByRole('button', { name: labels.open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: labels.open });
    const speakers = dialog.getByRole('group', { name: labels.speakers });
    const addSpeaker = speakers.getByRole('button', { name: labels.add, exact: true });
    await addSpeaker.click();
    await addSpeaker.click();
    await expect(
      speakers.getByRole('textbox', { name: new RegExp(`^${labels.name(2)}`) }),
    ).toBeFocused();
    await expect(addSpeaker).toHaveCSS('white-space', 'nowrap');
    expect(
      await addSpeaker.evaluate(
        (node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight,
      ),
    ).toBe(true);
    await expect(
      speakers.getByRole('status').filter({ hasText: labels.validation }),
    ).toBeVisible();

    await expectNoHorizontalOverflow(dialog);
    await expectNoHorizontalOverflow(speakers);
    await expectHorizontallyContained(speakers, dialog);
    await expectHorizontallyContained(addSpeaker, speakers);

    for (const number of [1, 2]) {
      const speaker = speakers.getByRole('group', { name: labels.speaker(number) });
      const controls = [
        speaker.getByRole('textbox', { name: new RegExp(`^${labels.name(number)}`) }),
        speaker.getByRole('textbox', { name: labels.jobTitle(number) }),
        speaker.getByRole('textbox', { name: labels.company(number) }),
        speaker.getByRole('textbox', { name: labels.bio(number) }),
      ];
      await speaker.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(speaker);
      await expectHorizontallyContained(speaker, speakers);
      for (const control of controls) {
        await expect(control).toBeVisible();
        await expectHorizontallyContained(control, speaker);
      }
      await expect(controls[0]).toHaveAttribute('aria-invalid', 'true');
      await expect(speaker.getByText(labels.nameMissing, { exact: true })).toBeVisible();

      const controlBoxes = await Promise.all(controls.map(bounds));
      if (!scenario.stacked) {
        expect(Math.abs(controlBoxes[0].y - controlBoxes[1].y)).toBeLessThanOrEqual(1);
        expect(Math.abs(controlBoxes[2].y - controlBoxes[3].y)).toBeLessThanOrEqual(1);
      } else {
        for (let index = 1; index < controlBoxes.length; index += 1) {
          expect(controlBoxes[index].y).toBeGreaterThan(controlBoxes[index - 1].y);
          expect(Math.abs(controlBoxes[index].x - controlBoxes[0].x)).toBeLessThanOrEqual(1);
          expect(Math.abs(controlBoxes[index].width - controlBoxes[0].width)).toBeLessThanOrEqual(
            1,
          );
        }
      }
    }

    const actions = [
      dialog.getByRole('button', { name: labels.remove, exact: true }),
      dialog.getByRole('button', { name: labels.cancel, exact: true }).last(),
      dialog.getByRole('button', { name: labels.save, exact: true }),
    ];
    for (const action of actions) await expectHorizontallyContained(action, dialog);
    if (scenario.stacked) {
      const actionBoxes = await Promise.all(actions.map(bounds));
      for (const actionBox of actionBoxes.slice(1)) {
        expect(Math.abs(actionBox.x - actionBoxes[0].x)).toBeLessThanOrEqual(1);
        expect(Math.abs(actionBox.width - actionBoxes[0].width)).toBeLessThanOrEqual(1);
      }
    }

    const pageOverflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(pageOverflow.scrollWidth).toBeLessThanOrEqual(pageOverflow.clientWidth + 1);
    await dialog.getByRole('button', { name: labels.cancel, exact: true }).first().click();
    await expect(dialog).toBeHidden();
  }
});

test('timeline geometry keeps short custom items readable and distinguishes quarter, half, and hour guides', async ({
  page,
}) => {
  await seedInteractiveSchedule();
  await signInAs(page, ADMIN, at('/admin/schedule'));

  const entryButton = (title: string) =>
    page.getByRole('button', { name: `Move or edit: ${title}` });
  const entryCard = (title: string) => entryButton(title).locator('..');
  const segment = (time: string) =>
    page.getByRole('button', { name: `Add an item at ${time} in Main room` });

  const nine = await bounds(segment('09:00'));
  const ten = await bounds(segment('10:00'));
  const hourHeight = ten.y - nine.y;
  expect(hourHeight).toBeGreaterThan(0);

  for (const [title, duration] of [
    ['Blocker', 5],
    ['Micro break', 10],
    ['Welcome', 15],
    ['Coffee', 20],
    ['Workshop', 45],
  ] as const) {
    const card = await bounds(entryCard(title));
    expect(Math.abs(card.height - hourHeight * (duration / 60))).toBeLessThanOrEqual(1);
  }

  const welcome = entryButton('Welcome');
  await expect(entryCard('Welcome')).toHaveClass(/schedule-card--custom/);
  await expect(entryCard('Welcome')).toHaveClass(/schedule-card--compact/);
  await expect(entryCard('Coffee')).toHaveClass(/schedule-card--compact/);
  await expect(entryCard('Micro break')).toHaveClass(/schedule-card--micro/);
  const coffeeFacts = entryCard('Coffee').locator('.schedule-card__facts');
  await expect(coffeeFacts).toBeVisible();
  const coffeeFactSize = await coffeeFacts.evaluate((node) => ({
    clientHeight: node.clientHeight,
    clientWidth: node.clientWidth,
    scrollHeight: node.scrollHeight,
    scrollWidth: node.scrollWidth,
  }));
  expect(coffeeFactSize.scrollWidth).toBeLessThanOrEqual(coffeeFactSize.clientWidth);
  expect(coffeeFactSize.scrollHeight).toBeLessThanOrEqual(coffeeFactSize.clientHeight);
  await expect(welcome).toContainText('09:00–09:15');
  const welcomeTitle = welcome.getByText('Welcome', { exact: true });
  await expect(welcomeTitle).toBeVisible();
  const welcomeTitleSize = await welcomeTitle.evaluate((node) => ({
    clientHeight: node.clientHeight,
    clientWidth: node.clientWidth,
    scrollHeight: node.scrollHeight,
    scrollWidth: node.scrollWidth,
  }));
  expect(welcomeTitleSize.scrollWidth).toBeLessThanOrEqual(welcomeTitleSize.clientWidth);
  expect(welcomeTitleSize.scrollHeight).toBeLessThanOrEqual(welcomeTitleSize.clientHeight);

  await expect(segment('09:15')).toHaveClass(/schedule-grid__slot--quarter/);
  await expect(segment('09:30')).toHaveClass(/schedule-grid__slot--half/);
  await expect(segment('10:00')).toHaveClass(/schedule-grid__slot--hour/);
  const guideStyles = await Promise.all(
    [segment('09:15'), segment('09:30'), segment('10:00')].map((locator) =>
      locator.evaluate((node) => {
        const style = getComputedStyle(node);
        return { style: style.borderTopStyle, width: style.borderTopWidth };
      }),
    ),
  );
  expect(guideStyles).toEqual([
    { style: 'dashed', width: '1px' },
    { style: 'solid', width: '1px' },
    { style: 'solid', width: '2px' },
  ]);
  const board = page.getByRole('region', { name: 'Build the programme' });
  await expect(board.getByRole('slider')).toHaveCount(1);
  const microSlider = await selectResizeSession(page, 'micro-break', 'Micro break');
  const microTarget = await bounds(microSlider);
  expect(microTarget.width).toBeGreaterThanOrEqual(44);
  expect(microTarget.height).toBeGreaterThanOrEqual(44);
  await microSlider.press('ArrowUp');
  await expect(microSlider).toHaveAttribute('aria-valuenow', '5');
  await expect(microSlider).toBeFocused();
});

function resizeInspector(page: Page) {
  return page.getByRole('region', { name: 'Adjust session duration' });
}

async function selectResizeSession(page: Page, entryId: string, title: string) {
  const inspector = resizeInspector(page);
  await inspector.getByRole('combobox', { name: 'Selected session' }).selectOption(entryId);
  return inspector.getByRole('slider', { name: `Resize ${title}` });
}

test('room creation supports an exact five-minute drag target, persists allocation, and contains mobile overflow', async ({
  page,
}) => {
  await seedInteractiveSchedule();
  await signInAs(page, ADMIN, at('/admin/schedule'));

  await page.getByRole('button', { name: 'Add room' }).click();
  const roomNameEnglish = page.getByRole('textbox', { name: /^Room name \(English\)/ });
  const roomNameFrench = page.getByRole('textbox', { name: /^Room name \(French\)/ });
  await expect(roomNameEnglish.last()).toBeFocused();
  await roomNameEnglish.last().fill('Studio');
  await roomNameFrench.last().fill('Studio');
  await expect(page.getByRole('button', { name: 'Move Studio left' })).toBeEnabled();
  const removeRooms = page.getByRole('button', { name: 'Remove room' });
  await expect(removeRooms.first()).toBeDisabled();
  await expect(
    page.getByText('Move or remove this room’s programme items first.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save schedule setup' }).click();
  await expect(page.getByText('Schedule setup saved.', { exact: true })).toBeVisible();

  const source = page.getByRole('button', { name: 'Edit placement' }).locator('..');
  const target = page.getByRole('button', {
    name: 'Add an item at 10:15 in Studio',
  });
  await beginNativeDrag(page, source, target, 5);
  const board = page.getByRole('region', { name: 'Build the programme' });
  await expect(board.getByRole('status')).toHaveText('Move to 10:20–11:00 in Studio.');
  await expect(board.locator('.schedule-drop-guide')).toBeVisible();
  await page.mouse.up();

  let dialog = page.getByRole('dialog', { name: 'Needs a place' });
  await expect(dialog.getByRole('textbox', { name: /^Start time/ })).toHaveValue('10:20');
  await expect(dialog.getByRole('combobox', { name: /^Room \/ track/ })).toHaveValue('room-2');
  await dialog.getByRole('button', { name: 'Save item' }).click();
  const placement = page.getByRole('button', { name: 'Move or edit: Needs a place' });
  await expect(placement).toContainText('10:20–11:00');

  await page.reload();
  await expect(placement).toContainText('10:20–11:00');
  await placement.click();
  dialog = page.getByRole('dialog', { name: 'Needs a place' });
  await expect(dialog.getByRole('textbox', { name: /^Start time/ })).toHaveValue('10:20');
  await expect(dialog.getByRole('combobox', { name: /^Room \/ track/ })).toHaveValue('room-2');
  await dialog.getByRole('button', { name: 'Cancel' }).first().click();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => {
    const pageRoot = document.documentElement;
    const gridScroller = document.querySelector<HTMLElement>('.schedule-grid-scroll');
    return {
      pageClient: pageRoot.clientWidth,
      pageScroll: pageRoot.scrollWidth,
      gridClient: gridScroller?.clientWidth ?? 0,
      gridScroll: gridScroller?.scrollWidth ?? 0,
    };
  });
  expect(overflow.pageScroll).toBeLessThanOrEqual(overflow.pageClient);
  expect(overflow.gridScroll).toBeGreaterThan(overflow.gridClient);
});

test('duration resize uses five-minute pointer and keyboard steps, persists, and refuses conflicts and day overflow', async ({
  page,
}) => {
  await seedInteractiveSchedule();
  await signInAs(page, ADMIN, at('/admin/schedule'));

  const board = page.getByRole('region', { name: 'Build the programme' });
  let welcome = await selectResizeSession(page, 'welcome', 'Welcome');
  await expect(welcome).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(welcome).toHaveAttribute('aria-valuenow', '15');
  await expect(welcome).toHaveAttribute('aria-valuetext', '09:00–09:15, 15 minutes');
  await expect(welcome).toBeEnabled();
  const welcomeCard = board.getByRole('button', { name: 'Move or edit: Welcome' }).locator('..');
  const directHandle = welcomeCard.locator('.schedule-card__resize-direct');
  await directHandle.scrollIntoViewIfNeeded();
  const handle = await bounds(directHandle);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await expect(welcomeCard).toHaveClass(/schedule-card--resizing/);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 8, {
    steps: 4,
  });
  await expect(welcome).toHaveAttribute('aria-valuenow', '20');
  await page.mouse.up();
  await expect(welcome).toHaveAttribute('aria-valuenow', '20');
  await expect(welcome).toHaveAttribute('aria-valuetext', '09:00–09:20, 20 minutes');
  await expect(board.getByRole('status')).toHaveText('09:00–09:20, 20 minutes');

  let coffee = await selectResizeSession(page, 'coffee', 'Coffee');
  await coffee.focus();
  await coffee.press('ArrowDown');
  await expect(coffee).toHaveAttribute('aria-valuenow', '25');
  await expect(coffee).toHaveAttribute('aria-valuetext', '09:30–09:55, 25 minutes');
  await expect(board.getByRole('status')).toHaveText('09:30–09:55, 25 minutes');

  let oddSlot = await selectResizeSession(page, 'odd-slot', 'Odd slot');
  await oddSlot.press('ArrowDown');
  await expect(oddSlot).toHaveAttribute('aria-valuenow', '47');
  await expect(oddSlot).toHaveAttribute('aria-valuetext', '10:45–11:32, 47 minutes');
  await expect(board.getByRole('status')).toHaveText('10:45–11:32, 47 minutes');

  await page.reload();
  welcome = await selectResizeSession(page, 'welcome', 'Welcome');
  await expect(welcome).toHaveAttribute('aria-valuenow', '20');
  coffee = await selectResizeSession(page, 'coffee', 'Coffee');
  await expect(coffee).toHaveAttribute('aria-valuenow', '25');
  oddSlot = await selectResizeSession(page, 'odd-slot', 'Odd slot');
  await expect(oddSlot).toHaveAttribute('aria-valuenow', '47');

  welcome = await selectResizeSession(page, 'welcome', 'Welcome');
  await welcome.press('ArrowUp');
  await expect(welcome).toHaveAttribute('aria-valuenow', '15');
  await welcome.press('ArrowUp');
  await expect(welcome).toHaveAttribute('aria-valuenow', '10');
  await expect(welcome).toBeFocused();
  await welcome.press('ArrowDown');
  await expect(welcome).toHaveAttribute('aria-valuenow', '15');

  coffee = await selectResizeSession(page, 'coffee', 'Coffee');
  await coffee.press('ArrowDown');
  await expect(board.getByRole('status')).toHaveText(
    '09:30–10:00 conflicts with another programme item. Duration was not changed.',
  );
  await expect(coffee).toHaveAttribute('aria-valuenow', '25');

  const closer = await selectResizeSession(page, 'day-closer', 'Day closer');
  await closer.press('ArrowDown');
  await expect(board.getByRole('status')).toHaveText(
    'Schedule boundary reached at 11:40–12:00.',
  );
  await expect(closer).toHaveAttribute('aria-valuenow', '20');
});

test('a failed resize waits for persistence and leaves the card unchanged', async ({ page }) => {
  await seedInteractiveSchedule();
  await signInAs(page, ADMIN, at('/admin/schedule'));

  const board = page.getByRole('region', { name: 'Build the programme' });
  const status = board.getByRole('status');
  const cardButton = board.getByRole('button', { name: 'Move or edit: Welcome' });
  const card = cardButton.locator('..');
  const slider = await selectResizeSession(page, 'welcome', 'Welcome');
  const originalCard = await bounds(card);
  const successAnnouncement = '09:00–09:20, 20 minutes';

  let releaseFailure!: () => void;
  const heldFailure = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  let sawResize!: () => void;
  const resizeRequested = new Promise<void>((resolve) => {
    sawResize = resolve;
  });
  await page.route('**/upsertScheduleEntry', async (route) => {
    sawResize();
    await heldFailure;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { status: 'ABORTED', message: 'Deterministic resize persistence failure.' },
      }),
    });
  });

  try {
    await slider.press('ArrowDown');
    await resizeRequested;
    await expect(slider).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(slider).not.toBeFocused();
    await slider.focus();
    await expect(slider).toHaveAttribute('aria-valuenow', '15');
    await expect(slider).toHaveAttribute('aria-valuetext', '09:00–09:15, 15 minutes');
    await expect(cardButton).toContainText('09:00–09:15');
    await expect(status).not.toContainText(successAnnouncement);
    expect((await bounds(card)).height).toBe(originalCard.height);
  } finally {
    releaseFailure();
  }

  await expect(status).toHaveText('Duration was not changed. Reload the schedule and try again.');
  await expect(status).not.toContainText(successAnnouncement);
  await expect(slider).toHaveAttribute('aria-valuenow', '15');
  await expect(slider).toHaveAttribute('aria-valuetext', '09:00–09:15, 15 minutes');
  await expect(cardButton).toContainText('09:00–09:15');
  expect((await bounds(card)).height).toBe(originalCard.height);
  await expect(
    page.getByText('Someone changed the schedule in another tab. Reload before continuing.'),
  ).toBeVisible();
  await page.unroute('**/upsertScheduleEntry');
});

test('sharing and publishing have separate review steps and stale-version guidance', async ({
  page,
}) => {
  await seedSchedulePeople();
  await signInAs(page, ADMIN, at('/admin/schedule'));

  await page.locator('summary').getByText('Schedule setup', { exact: true }).click();
  await page.getByRole('button', { name: 'Add day' }).click();
  const secondDay = page.getByRole('textbox', { name: 'Day 2 Required' });
  await expect(secondDay).toBeVisible();
  await page.getByRole('button', { name: 'Remove day' }).last().click();
  await expect(secondDay).toHaveCount(0);

  const stages = page.locator('.schedule-stages');
  await expect(stages.getByRole('heading', { name: 'Private draft' })).toBeVisible();
  await expect(stages.getByRole('heading', { name: 'Shared preview' })).toBeVisible();
  await expect(stages.getByRole('heading', { name: 'Public programme' })).toBeVisible();
  await expect(stages.getByText('Private', { exact: true })).toBeVisible();
  await expect(stages.getByText('Not shared', { exact: true })).toBeVisible();
  await expect(stages.getByText('Offline', { exact: true })).toBeVisible();

  const publish = page.getByRole('button', { name: 'Review and publish' });
  await expect(publish).toBeDisabled();
  await expect(publish).toHaveAttribute('title', 'Review and share the confirmed preview first.');

  const share = page.getByRole('button', { name: 'Review and share' });
  await share.click();
  const shareDialog = page.getByRole('dialog', { name: 'Share this confirmed preview?' });
  await expect(shareDialog).toContainText('1 items shared');
  await expect(shareDialog).toContainText('0 private placements omitted');
  await expect(shareDialog).toContainText('Confirmed speakers see only their own');
  await expect(shareDialog).toContainText('The public still sees only the currently published programme.');
  await shareDialog.getByRole('button', { name: 'Share preview' }).click();

  await expect(page.getByText(/Preview shared\. Shared version 1/)).toBeVisible();
  await expect(stages.getByText('Shared', { exact: true })).toBeVisible();
  await expect(share).toBeDisabled();
  await expect(share).toHaveAttribute('title', 'The shared preview already matches this draft.');
  await expect(publish).toBeEnabled();

  await page.getByRole('button', { name: 'Move or edit: Already scheduled' }).click();
  const placement = page.getByRole('dialog', { name: 'Already scheduled' });
  await placement.getByRole('textbox', { name: 'Start time Required' }).fill('09:15');
  await placement.getByRole('button', { name: 'Save item' }).click();
  await expect(
    page.getByText(
      'The shared preview no longer matches the current programme details. Share a new preview before publishing.',
    ),
  ).toBeVisible();
  await expect(publish).toBeDisabled();
  await expect(publish).toHaveAttribute(
    'title',
    'The shared preview no longer matches the current programme details. Share a new preview before publishing.',
  );
  await share.click();
  const reshare = page.getByRole('dialog', { name: 'Share this confirmed preview?' });
  await reshare.getByRole('button', { name: 'Share preview' }).click();
  await expect(page.getByText(/Preview shared\. Shared version 2/)).toBeVisible();
  await expect(publish).toBeEnabled();

  await publish.click();
  const publishDialog = page.getByRole('dialog', { name: 'Publish this programme?' });
  await expect(publishDialog).toContainText('1 scheduled');
  await expect(publishDialog).toContainText('0 private placements omitted');
  await expect(publishDialog).toContainText('0 conflicts');
  await expect(publishDialog).toContainText('Proposals are still open');
  await expect(publishDialog).toContainText('Confirm that this timing is intentional.');
  await publishDialog.getByRole('button', { name: 'Publish programme' }).click();

  await expect(page.getByText(/The public programme is live\. Public version 2/)).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: 'Email, 1 awaiting approval, 0 deliveries needing attention',
    }),
  ).toBeVisible();
  await expect(publish).toBeDisabled();
  await expect(publish).toHaveAttribute('title', 'The public programme is already up to date.');

  await page.getByRole('button', { name: 'Take offline' }).click();
  const offline = page.getByRole('alertdialog', {
    name: 'Take the public programme offline?',
  });
  await expect(offline).toContainText('The private draft, shared preview, and version history stay intact.');
  await offline.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(offline).toHaveCount(0);
});
