import { expect, test, type Locator, type Page } from '@playwright/test';

import { DEFAULT_SUBMISSION_FORM } from '@shared/submissionForm';
import {
  callJson,
  createAccount,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
} from './backend';
import { at, signInAs, type Identity } from './form';

const ADMIN: Identity = {
  sub: 'schedule-metadata-admin',
  email: 'schedule-metadata-admin@example.org',
  name: 'Maya Admin',
};

const SPEAKER: Identity = {
  sub: 'schedule-metadata-speaker',
  email: 'schedule-metadata-speaker@example.org',
  name: 'Morgan Speaker',
};

const TALK_TITLE = 'Metadata-driven scheduling';
const CUSTOM_TITLE = 'Community exchange';
const DISTANT_TITLE = 'Closing reflection';

test.beforeEach(async () => {
  await reset();
});

function formWithCategory(en: string, fr: string) {
  return {
    ...DEFAULT_SUBMISSION_FORM,
    category: DEFAULT_SUBMISSION_FORM.category.map((option) =>
      option.value === 'ai_ml' ? { ...option, label: { en, fr } } : option,
    ),
  };
}

async function seedMetadataSchedule({
  categoryEn = 'AI & ML',
  categoryFr = 'IA et apprentissage automatique',
  speakerName = SPEAKER.name,
  customSpeakerName = 'Jules Host',
  proposalStatus = 'confirmed',
  includeDistantEntry = false,
  publish = false,
}: {
  categoryEn?: string;
  categoryFr?: string;
  speakerName?: string;
  customSpeakerName?: string;
  proposalStatus?: 'accepted' | 'confirmed';
  includeDistantEntry?: boolean;
  publish?: boolean;
} = {}) {
  const [admin, speaker] = await Promise.all([
    createAccount(ADMIN),
    createAccount(SPEAKER),
  ]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedSpeaker(speaker.uid, {
      name: speakerName,
      email: SPEAKER.email,
      bio: 'Builds inclusive developer communities and practical AI systems.',
      company: 'GDG Montréal',
      jobTitle: 'Community architect',
    }),
    seedProposal('metadata-talk', {
      speakerUid: speaker.uid,
      title: TALK_TITLE,
      status: proposalStatus,
      speaker: {
        name: speakerName,
        bio: 'Frozen biography for the published programme.',
        company: 'GDG Montréal',
        jobTitle: 'Community architect',
      },
    }),
    seedProposal('waiting-for-slot', {
      speakerUid: speaker.uid,
      title: 'Waiting for a slot',
      status: 'accepted',
      category: 'app_dev',
      format: 'lightning_15',
      level: 'beginner',
      deliveryLanguage: 'fr',
      speaker: { name: 'Taylor Tentative' },
    }),
  ]);

  await callJson(
    admin.idToken,
    'setSubmissionForm',
    formWithCategory(categoryEn, categoryFr),
  );
  let revision = (
    await callJson(admin.idToken, 'setScheduleConfig', {
      expectedRevision: 0,
      config: {
        timeZone: 'America/Toronto',
        revision: 0,
        days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
        rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
      },
    })
  ).revision as number;

  revision = (
    await callJson(admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: revision,
      entry: {
        id: 'metadata-talk',
        kind: 'proposal',
        proposalId: 'metadata-talk',
        date: '2026-11-14',
        startsAt: '10:00',
        durationMinutes: 40,
        roomId: 'main',
      },
    })
  ).revision as number;
  revision = (
    await callJson(admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: revision,
      entry: {
        id: 'community-exchange',
        kind: 'custom',
        customType: 'social',
        language: 'bilingual',
        title: { en: CUSTOM_TITLE, fr: 'Échange communautaire' },
        description: {
          en: 'Meet the people who keep the community connected.',
          fr: 'Rencontrez les personnes qui rassemblent la communauté.',
        },
        speakers: [
          {
            name: customSpeakerName,
            bio: 'Facilitates welcoming technical conversations.',
            company: 'Community Guild',
            jobTitle: 'Moderator',
          },
        ],
        date: '2026-11-14',
        startsAt: '11:00',
        durationMinutes: 15,
        roomId: 'main',
      },
    })
  ).revision as number;

  if (includeDistantEntry) {
    revision = (
      await callJson(admin.idToken, 'upsertScheduleEntry', {
        expectedRevision: revision,
        entry: {
          id: 'closing-reflection',
          kind: 'custom',
          customType: 'other',
          title: { en: DISTANT_TITLE, fr: 'Réflexion de clôture' },
          description: {
            en: 'Close the day with shared lessons and next steps.',
            fr: 'Terminons la journée avec les apprentissages et les prochaines étapes.',
          },
          date: '2026-11-14',
          startsAt: '16:30',
          durationMinutes: 15,
          roomId: 'main',
        },
      })
    ).revision as number;
  }

  if (publish) {
    const shared = await callJson(admin.idToken, 'shareSchedulePreview', {
      expectedRevision: revision,
    });
    await callJson(admin.idToken, 'publishSchedule', {
      expectedRevision: shared.revision,
    });
  }

  return admin;
}

function card(page: Page, title: string) {
  return page.getByRole('button', { name: new RegExp(`^Move or edit: ${title},`) });
}

function schedulingFacts(page: Page) {
  return page.locator('dl.schedule-resize-inspector__facts[aria-label="Scheduling facts"]');
}

/**
 * The public agenda arrives server-rendered, is replaced by the loading
 * paragraph while the client takes over, then rebuilt. A single measurement can
 * land in that gap and read a null box off an unmounted node, so poll until one
 * settled layout answers.
 */
async function expectWithinViewport(locator: Locator, viewportWidth: number) {
  await expect(locator).toBeVisible();
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      if (!box) return 'not laid out';
      if (box.x < 0) return `starts at ${box.x}`;
      if (box.x + box.width > viewportWidth) return `ends at ${box.x + box.width}`;
      return 'within the viewport';
    })
    .toBe('within the viewport');
}

async function expectContained(locator: Locator, viewportWidth: number) {
  await expectWithinViewport(locator, viewportWidth);
  expect(await locator.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
}

async function expectNoPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
}

test('the schedule editor keeps proposal and custom scheduling facts visible and accessible', async ({
  page,
}) => {
  await seedMetadataSchedule();
  await signInAs(page, ADMIN, at('/admin/schedule'));

  const proposal = card(page, TALK_TITLE);
  const proposalFacts = proposal.locator('.schedule-card__facts');
  await expect(proposalFacts).toBeVisible();
  await expect(proposalFacts).toContainText(SPEAKER.name);
  await expect(proposalFacts).toContainText('AI & ML');
  await expect(proposalFacts).toContainText('English');
  await expect(proposalFacts).toContainText('Confirmed');
  await expect(proposal).toHaveAccessibleDescription(
    'Speakers: Morgan Speaker. Category: AI & ML. Scheduled language: English. ' +
      'Format: Session — 40 minutes. Audience level: Intermediate. Confirmation: Confirmed',
  );

  const poolCard = page.locator('.schedule-pool-card').filter({ hasText: 'Waiting for a slot' });
  await expect(poolCard).toContainText('Taylor Tentative');
  const poolFacts = poolCard.locator('.schedule-pool-card__facts');
  await expect(poolFacts.getByText('App Dev', { exact: true })).toBeVisible();
  await expect(poolFacts.getByText('Lightning talk — 15 minutes', { exact: true })).toBeVisible();
  await expect(poolFacts.getByText('Beginner', { exact: true })).toBeVisible();
  await expect(poolFacts.getByText('French', { exact: true })).toBeVisible();
  await expect(poolFacts.getByText('Awaiting confirmation', { exact: true })).toBeVisible();

  const custom = card(page, CUSTOM_TITLE);
  const customFacts = custom.locator('.schedule-card__facts');
  await expect(customFacts).toBeVisible();
  await expect(customFacts).toContainText('Jules Host');
  await expect(customFacts).toContainText('Social');
  await expect(customFacts).toContainText('Bilingual');
  await expect(custom).toHaveAccessibleDescription(
    'Speakers: Jules Host. Item type: Social. Scheduled language: Bilingual',
  );
  await page.getByRole('combobox', { name: 'Selected session' }).selectOption('community-exchange');
  const inspectorFacts = schedulingFacts(page);
  await expect(inspectorFacts).toBeVisible();
  await expect(inspectorFacts.getByText('Jules Host', { exact: true })).toBeVisible();
  await expect(inspectorFacts.getByText('Social', { exact: true })).toBeVisible();
  await expect(inspectorFacts.getByText('Bilingual', { exact: true })).toBeVisible();
});

test('the selected-session inspector stays aligned and complete from desktop through 320 pixels', async ({
  page,
}) => {
  const speakerName =
    'Morgan Speaker with a long community accessibility and developer education remit';
  const categoryName =
    'Applied artificial intelligence, machine learning, and responsible community systems';
  await seedMetadataSchedule({
    speakerName,
    categoryEn: categoryName,
    proposalStatus: 'accepted',
    includeDistantEntry: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs(page, ADMIN, at('/admin/schedule'));

  const inspector = page.getByRole('region', { name: 'Adjust session duration' });
  const selectedField = inspector.locator('.schedule-resize-inspector__field');
  const picker = inspector.getByRole('combobox', { name: 'Selected session' });
  await picker.selectOption('metadata-talk');
  const slider = inspector.getByRole('slider', { name: `Resize ${TALK_TITLE}` });
  const edit = inspector.getByRole('button', { name: 'Edit selected session' });
  const duration = inspector.locator('.schedule-resize-inspector__value');
  const facts = schedulingFacts(page);

  await expect(picker.locator('option:checked')).toHaveText(
    `${TALK_TITLE} · 10:00–10:40 · Main room`,
  );
  await expect(slider).toHaveAttribute('aria-valuenow', '40');
  await expect(slider).toHaveAttribute('aria-valuetext', '10:00–10:40, 40 minutes');
  await expect(slider.locator('strong')).toHaveText(TALK_TITLE);
  await expect(slider.locator('time')).toHaveText('10:00–10:40');
  await expect(duration).toHaveText('40 min');
  await expect(facts).toBeVisible();
  expect(
    await facts.locator(':scope > div').evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.querySelector('dt')?.textContent ?? '',
        value: node.querySelector('dd')?.textContent ?? '',
      })),
    ),
  ).toEqual([
    { label: 'Speakers', value: speakerName },
    { label: 'Category', value: categoryName },
    { label: 'Scheduled language', value: 'English' },
    { label: 'Format', value: 'Session — 40 minutes' },
    { label: 'Audience level', value: 'Intermediate' },
    { label: 'Confirmation', value: 'Awaiting confirmation' },
  ]);

  for (const width of [1440, 1064, 901, 900, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(inspector).toBeVisible();
    await expectNoPageOverflow(page);

    const inspectorBox = await inspector.boundingBox();
    const pickerBox = await picker.boundingBox();
    const sliderBox = await slider.boundingBox();
    const editBox = await edit.boundingBox();
    const durationBox = await duration.boundingBox();
    expect(inspectorBox, `${width}px inspector box`).not.toBeNull();
    expect(pickerBox, `${width}px session picker box`).not.toBeNull();
    expect(sliderBox, `${width}px duration control box`).not.toBeNull();
    expect(editBox, `${width}px edit control box`).not.toBeNull();
    expect(durationBox, `${width}px duration value box`).not.toBeNull();

    for (const [name, box] of [
      ['session picker', pickerBox!],
      ['duration control', sliderBox!],
      ['session action', editBox!],
    ] as const) {
      expect(box.x, `${width}px ${name} left edge`).toBeGreaterThanOrEqual(
        inspectorBox!.x - 1,
      );
      expect(box.x + box.width, `${width}px ${name} right edge`).toBeLessThanOrEqual(
        inspectorBox!.x + inspectorBox!.width + 1,
      );
      expect(box.y, `${width}px ${name} top edge`).toBeGreaterThanOrEqual(
        inspectorBox!.y - 1,
      );
      expect(box.y + box.height, `${width}px ${name} bottom edge`).toBeLessThanOrEqual(
        inspectorBox!.y + inspectorBox!.height + 1,
      );
    }

    const pills = await facts.locator(':scope > div').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
        };
      }),
    );
    expect(pills, `${width}px fact pill count`).toHaveLength(6);
    for (const [index, pill] of pills.entries()) {
      expect(pill.left, `${width}px fact pill ${index + 1} left edge`).toBeGreaterThanOrEqual(
        inspectorBox!.x - 1,
      );
      expect(pill.right, `${width}px fact pill ${index + 1} right edge`).toBeLessThanOrEqual(
        inspectorBox!.x + inspectorBox!.width + 1,
      );
      expect(
        pill.scrollWidth,
        `${width}px fact pill ${index + 1} content width`,
      ).toBeLessThanOrEqual(pill.clientWidth + 1);
    }
    for (const [index, metric] of (
      await facts.locator('dt, dd').evaluateAll((nodes) =>
        nodes.map((node) => ({
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
        })),
      )
    ).entries()) {
      expect(
        metric.scrollWidth,
        `${width}px fact label/value ${index + 1} width`,
      ).toBeLessThanOrEqual(metric.clientWidth + 1);
      expect(
        metric.scrollHeight,
        `${width}px fact label/value ${index + 1} height`,
      ).toBeLessThanOrEqual(metric.clientHeight + 1);
    }

    expect(durationBox!.x, `${width}px duration value left edge`).toBeGreaterThanOrEqual(
      sliderBox!.x - 1,
    );
    expect(
      durationBox!.x + durationBox!.width,
      `${width}px duration value right edge`,
    ).toBeLessThanOrEqual(sliderBox!.x + sliderBox!.width + 1);
    if (width > 640) {
      expect(
        Math.abs(pickerBox!.y - sliderBox!.y),
        `${width}px picker/slider top alignment`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(pickerBox!.height - sliderBox!.height),
        `${width}px picker/slider height alignment`,
      ).toBeLessThanOrEqual(1);
    } else {
      for (const [name, box] of [
        ['duration control', sliderBox!],
        ['edit control', editBox!],
      ] as const) {
        expect(
          Math.abs(pickerBox!.x - box.x),
          `${width}px picker/${name} left alignment`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(pickerBox!.width - box.width),
          `${width}px picker/${name} width alignment`,
        ).toBeLessThanOrEqual(1);
      }
    }

    if (width <= 390) {
      const selectedTitle = inspector.locator('.schedule-resize-inspector__selected-title');
      await expect(selectedTitle).toBeVisible();
      await expect(selectedTitle).toHaveText(TALK_TITLE);
      const fieldBox = await selectedField.boundingBox();
      const titleBox = await selectedTitle.boundingBox();
      expect(fieldBox, `${width}px selected-session field box`).not.toBeNull();
      expect(titleBox, `${width}px selected title box`).not.toBeNull();
      expect(titleBox!.x, `${width}px selected title left edge`).toBeGreaterThanOrEqual(
        fieldBox!.x - 1,
      );
      expect(
        titleBox!.x + titleBox!.width,
        `${width}px selected title right edge`,
      ).toBeLessThanOrEqual(fieldBox!.x + fieldBox!.width + 1);
      const titleMetric = await selectedTitle.evaluate((node) => ({
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
      }));
      expect(titleMetric.scrollWidth, `${width}px selected title width`).toBeLessThanOrEqual(
        titleMetric.clientWidth + 1,
      );
      expect(titleMetric.scrollHeight, `${width}px selected title height`).toBeLessThanOrEqual(
        titleMetric.clientHeight + 1,
      );
    }
  }

  await page.setViewportSize({ width: 900, height: 900 });
  const gridScroller = page.locator('.schedule-grid-scroll');
  await picker.scrollIntoViewIfNeeded();
  await gridScroller.evaluate((node) => node.scrollTo({ top: 0, left: 0 }));
  await expect.poll(() => gridScroller.evaluate((node) => node.scrollTop)).toBe(0);
  const pageScrollBeforeReveal = await page.evaluate(() => window.scrollY);
  const pickerTopBeforeReveal = await picker.evaluate(
    (node) => node.getBoundingClientRect().top,
  );
  await picker.selectOption('closing-reflection');
  await expect(picker.locator('option:checked')).toContainText(DISTANT_TITLE);
  await expect
    .poll(() => gridScroller.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  const pageScrollAfterReveal = await page.evaluate(() => window.scrollY);
  const pickerTopAfterReveal = await picker.evaluate(
    (node) => node.getBoundingClientRect().top,
  );
  expect(
    Math.abs(pageScrollAfterReveal - pageScrollBeforeReveal),
    'selecting a distant session keeps the document scroll stable',
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(pickerTopAfterReveal - pickerTopBeforeReveal),
    'selecting a distant session keeps the picker viewport position stable',
  ).toBeLessThanOrEqual(1);
  await picker.selectOption('metadata-talk');
  await expect(picker.locator('option:checked')).toContainText(TALK_TITLE);

  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole('button', { name: 'Français', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  const frenchInspector = page.locator('.schedule-resize-inspector');
  const frenchField = frenchInspector.locator('.schedule-resize-inspector__field');
  const frenchTitle = frenchInspector.locator('.schedule-resize-inspector__selected-title');
  const frenchFacts = frenchInspector.locator('.schedule-resize-inspector__facts');
  const frenchStatusFact = frenchFacts
    .locator(':scope > div')
    .filter({ hasText: 'Confirmation en attente' });
  const frenchStatus = frenchStatusFact.locator('dd');
  await expect(frenchStatusFact.locator('dt')).toHaveText('Confirmation');
  await expect(frenchStatus).toHaveText('Confirmation en attente');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoPageOverflow(page);
    await expect(frenchTitle).toBeVisible();
    await expect(frenchTitle).toHaveText(TALK_TITLE);
    const inspectorBox = await frenchInspector.boundingBox();
    const fieldBox = await frenchField.boundingBox();
    const titleBox = await frenchTitle.boundingBox();
    const statusFactBox = await frenchStatusFact.boundingBox();
    const statusBox = await frenchStatus.boundingBox();
    expect(inspectorBox, `${width}px French inspector box`).not.toBeNull();
    expect(fieldBox, `${width}px French selected-session field box`).not.toBeNull();
    expect(titleBox, `${width}px French selected title box`).not.toBeNull();
    expect(statusFactBox, `${width}px French status fact box`).not.toBeNull();
    expect(statusBox, `${width}px French status value box`).not.toBeNull();

    for (const [name, box] of [
      ['selected title', titleBox!],
      ['localized status fact', statusFactBox!],
      ['localized status value', statusBox!],
    ] as const) {
      expect(box.x, `${width}px French ${name} left edge`).toBeGreaterThanOrEqual(
        inspectorBox!.x - 1,
      );
      expect(box.x + box.width, `${width}px French ${name} right edge`).toBeLessThanOrEqual(
        inspectorBox!.x + inspectorBox!.width + 1,
      );
    }
    expect(titleBox!.x, `${width}px French selected title control left edge`).toBeGreaterThanOrEqual(
      fieldBox!.x - 1,
    );
    expect(
      titleBox!.x + titleBox!.width,
      `${width}px French selected title control right edge`,
    ).toBeLessThanOrEqual(fieldBox!.x + fieldBox!.width + 1);
    expect(statusBox!.x, `${width}px French status value fact left edge`).toBeGreaterThanOrEqual(
      statusFactBox!.x - 1,
    );
    expect(
      statusBox!.x + statusBox!.width,
      `${width}px French status value fact right edge`,
    ).toBeLessThanOrEqual(statusFactBox!.x + statusFactBox!.width + 1);
    for (const [name, locator] of [
      ['selected title', frenchTitle],
      ['localized status', frenchStatus],
    ] as const) {
      const metric = await locator.evaluate((node) => ({
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
      }));
      expect(metric.scrollWidth, `${width}px French ${name} width`).toBeLessThanOrEqual(
        metric.clientWidth + 1,
      );
      expect(metric.scrollHeight, `${width}px French ${name} height`).toBeLessThanOrEqual(
        metric.clientHeight + 1,
      );
    }
  }
});

test('the public agenda and detail expose frozen taxonomy and full speaker details in both languages', async ({
  page,
}) => {
  await seedMetadataSchedule({
    categoryEn: 'Applied AI',
    categoryFr: 'IA appliquée',
    publish: true,
  });
  await page.goto(at('/schedule'));

  const talkLink = page.getByRole('link', { name: TALK_TITLE });
  const talkCard = page.getByRole('article').filter({ has: talkLink });
  await expect(talkCard.getByLabel('Category: Applied AI')).toBeVisible();
  await expect(talkCard.getByText('English', { exact: true })).toBeVisible();
  await expect(talkCard.getByText(SPEAKER.name, { exact: true })).toBeVisible();

  const customLink = page.getByRole('link', { name: CUSTOM_TITLE });
  const customCard = page.getByRole('article').filter({ has: customLink });
  await expect(customCard.getByLabel('Item type: Social')).toBeVisible();
  await expect(customCard.getByText('Bilingual', { exact: true })).toBeVisible();
  await expect(customCard.getByText('Jules Host', { exact: true })).toBeVisible();

  await talkLink.click();
  let detail = page.getByRole('article');
  let facts = detail.locator('dl.session-detail__facts');
  await expect(facts).toHaveAttribute('aria-label', 'Scheduling facts');
  await expect(facts.getByText('Applied AI', { exact: true })).toBeVisible();
  await expect(facts.getByText('Session — 40 minutes', { exact: true })).toBeVisible();
  await expect(facts.getByText('Intermediate', { exact: true })).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Speakers' })).toBeVisible();
  await expect(detail.getByRole('heading', { level: 4, name: SPEAKER.name })).toBeVisible();
  await expect(detail.getByText('Community architect · GDG Montréal', { exact: true })).toBeVisible();
  await expect(
    detail.getByText('Frozen biography for the published programme.', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Français', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  detail = page.getByRole('article');
  facts = detail.locator('dl.session-detail__facts');
  await expect(facts).toHaveAttribute('aria-label', 'Détails de planification');
  await expect(facts.getByText('IA appliquée', { exact: true })).toBeVisible();
  await expect(facts.getByText('Session — 40 minutes', { exact: true })).toBeVisible();
  await expect(facts.getByText('Intermédiaire', { exact: true })).toBeVisible();
  await expect(detail.getByText('Anglais', { exact: true })).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Conférenciers' })).toBeVisible();

  await page.getByRole('link', { name: 'Retour au programme' }).click();
  const frenchTalk = page.getByRole('article').filter({
    has: page.getByRole('link', { name: TALK_TITLE }),
  });
  await expect(frenchTalk.getByLabel('Catégorie: IA appliquée')).toBeVisible();
  await expect(frenchTalk.getByText('Anglais', { exact: true })).toBeVisible();
  const frenchCustom = page.getByRole('article').filter({
    has: page.getByRole('link', { name: 'Échange communautaire' }),
  });
  await expect(frenchCustom.getByLabel('Type d’élément: Activité sociale')).toBeVisible();
  await expect(frenchCustom.getByText('Bilingue', { exact: true })).toBeVisible();
});

test('long scheduling facts stay contained at a 320 pixel viewport', async ({ page }) => {
  const longCategory = `Category-${'C'.repeat(72)}`;
  const longCategoryFr = `Catégorie-${'F'.repeat(70)}`;
  const longSpeaker = `Speaker-${'S'.repeat(72)}`;
  const longCustomSpeaker = `Host-${'H'.repeat(76)}`;
  await seedMetadataSchedule({
    categoryEn: longCategory,
    categoryFr: longCategoryFr,
    speakerName: longSpeaker,
    customSpeakerName: longCustomSpeaker,
    publish: true,
  });
  await page.setViewportSize({ width: 320, height: 844 });

  await signInAs(page, ADMIN, at('/admin/schedule'));
  await page.getByRole('combobox', { name: 'Selected session' }).selectOption('community-exchange');
  const inspectorFacts = schedulingFacts(page);
  await expectContained(inspectorFacts, 320);
  await expectContained(inspectorFacts.getByText(longCustomSpeaker, { exact: true }), 320);
  await expectNoPageOverflow(page);

  await page.goto(at('/schedule'));
  const talkLink = page.getByRole('link', { name: TALK_TITLE });
  const agendaCard = page.getByRole('article').filter({ has: talkLink });
  await expectContained(agendaCard, 320);
  await expectWithinViewport(agendaCard.getByLabel(`Category: ${longCategory}`), 320);
  await expectNoPageOverflow(page);

  await talkLink.click();
  const detail = page.getByRole('article');
  await expectContained(detail, 320);
  await expectContained(detail.getByText(longCategory, { exact: true }), 320);
  await expectContained(detail.getByRole('heading', { level: 4, name: longSpeaker }), 320);
  await expectNoPageOverflow(page);
});
