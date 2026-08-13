import { expect, test } from '@playwright/test';

import {
  callAs,
  callJson,
  createAccount,
  readProposals,
  reviewedEmailConfiguration,
  reset,
  seedMember,
  seedProposal,
  seedReview,
  seedSpeaker,
  setEmailDeliveryReadyDirect,
  setSubmissionFormDirect,
  waitForEmail,
} from './backend';
import { at, signIn, signInAs, type Identity } from './form';
import { en } from '../../src/i18n/en';
import { fr } from '../../src/i18n/fr';

const ADMIN: Identity = {
  sub: 'polish-admin',
  email: 'polish-admin@example.org',
  name: 'Ada Admin',
};
const SPEAKER: Identity = {
  sub: 'polish-speaker',
  email: 'polish-speaker@example.org',
  name: 'Samira Speaker',
};

test.use({ hasTouch: true });

test.beforeEach(async () => {
  await reset();
});

test('a long talk title keeps its status visible inside the 320px picker', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const speaker = await createAccount(SPEAKER);
  await seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email });
  await seedProposal('long-mobile-title', {
    speakerUid: speaker.uid,
    title:
      'Design systems that survive several very large teams and an unusually long conference title',
    status: 'submitted',
  });
  await seedProposal('withdrawn-long-mobile-title-1', {
    speakerUid: speaker.uid,
    title:
      'A withdrawn proposal with a very long title that must never widen the mobile submission page',
    status: 'withdrawn',
  });
  await seedProposal('withdrawn-long-mobile-title-2', {
    speakerUid: speaker.uid,
    title:
      'Another withdrawn proposal whose title remains readable without creating document overflow',
    status: 'withdrawn',
  });

  await signInAs(page, SPEAKER);

  const tab = page.locator('.talks__tab--on');
  await expect(tab).toBeVisible();
  await expect(tab.locator('.talks__status')).toHaveText('Submitted');

  const layout = await tab.evaluate((element) => {
    const tabBox = element.getBoundingClientRect();
    const title = element.querySelector<HTMLElement>('.talks__title');
    const status = element.querySelector<HTMLElement>('.talks__status');
    const progress = document.querySelector<HTMLElement>('.form-progress__list');
    if (!title || !status || !progress) throw new Error('Talk picker or progress navigation is missing');
    const statusBox = status.getBoundingClientRect();
    const progressBox = progress.getBoundingClientRect();
    return {
      statusInside: statusBox.right <= tabBox.right + 1,
      titleTruncated: title.scrollWidth > title.clientWidth,
      progressInside:
        progressBox.left >= -1 &&
        progressBox.right <= document.documentElement.clientWidth + 1,
      progressScrollable:
        progress.scrollWidth > progress.clientWidth &&
        ['auto', 'scroll'].includes(getComputedStyle(progress).overflowX),
    };
  });

  expect(layout.statusInside).toBe(true);
  expect(layout.titleTruncated).toBe(true);
  expect(layout.progressInside).toBe(true);
  expect(layout.progressScrollable).toBe(true);

  const past = page.locator('.talks__past');
  await past.getByText('Past talks (2)', { exact: true }).click();
  await expect(past).toHaveAttribute('open', '');
  const pastLayout = await past.evaluate((element) => {
    const container = element.getBoundingClientRect();
    const tabs = [...element.querySelectorAll<HTMLElement>('.talks__tab')];
    return {
      containerInside: container.right <= document.documentElement.clientWidth + 1,
      tabsInside: tabs.every((talk) => talk.getBoundingClientRect().right <= container.right + 1),
      documentOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(pastLayout.containerInside).toBe(true);
  expect(pastLayout.tabsInside).toBe(true);
  expect(pastLayout.documentOverflow).toBe(0);
});

test('proposal decisions use cards at exactly 768px and keep the results separated', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 });
  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);
  await seedProposal('responsive-current', {
    speakerUid: 'responsive-speaker',
    title: 'A current proposal',
    status: 'submitted',
  });
  await seedProposal('responsive-accepted', {
    speakerUid: 'responsive-speaker',
    title: 'An accepted proposal',
    status: 'accepted',
  });

  await signInAs(page, ADMIN, at('/admin/proposals'));
  await expect(page.locator('.decision-table tbody tr')).toHaveCount(2);

  const layout = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.decision-panel');
    const row = document.querySelector<HTMLElement>('.decision-table tbody tr');
    const results = [...document.querySelectorAll<HTMLElement>('section')].find(
      (section) => section.querySelector('h2')?.textContent?.trim() === 'Selected speakers',
    );
    if (!panel || !row || !results) throw new Error('Proposal layout is incomplete');
    return {
      rowDisplay: getComputedStyle(row).display,
      sectionGap: results.getBoundingClientRect().top - panel.getBoundingClientRect().bottom,
      documentOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(layout.rowDisplay).toBe('grid');
  expect(layout.sectionGap).toBeGreaterThanOrEqual(16);
  expect(layout.documentOverflow).toBe(0);
});

test('proposal decisions and selected speakers follow normalized ranking', async ({ page }) => {
  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);
  const proposals = [
    ['alpha', 'Raw average leader', 'accepted'],
    ['beta', 'Calibrated leader', 'accepted'],
    ['gamma', 'Generous 4 one', 'submitted'],
    ['delta', 'Generous 4 two', 'submitted'],
    ['epsilon', 'Generous 4 three', 'submitted'],
    ['zeta', 'Harsh 1 one', 'submitted'],
    ['eta', 'Harsh 1 two', 'submitted'],
    ['theta', 'Harsh 1 three', 'submitted'],
  ] as const;
  for (const [id, title, status] of proposals) {
    await seedProposal(id, { speakerUid: 'ranking-speaker', title, status });
  }
  await seedProposal('not-scored', {
    speakerUid: 'ranking-speaker',
    title: 'Not scored yet',
    status: 'accepted',
  });

  for (const [proposalId, reviewerUid, score] of [
    ['alpha', 'generous', 3],
    ['gamma', 'generous', 4],
    ['delta', 'generous', 4],
    ['epsilon', 'generous', 4],
    ['beta', 'harsh', 2],
    ['zeta', 'harsh', 1],
    ['eta', 'harsh', 1],
    ['theta', 'harsh', 1],
  ] as const) {
    await seedReview(proposalId, reviewerUid, score);
  }

  await expect
    .poll(async () => {
      const stored = await readProposals();
      const alpha = stored.find((proposal) => proposal.title === 'Raw average leader')?.aggregate;
      const beta = stored.find((proposal) => proposal.title === 'Calibrated leader')?.aggregate;
      return Boolean(
        alpha &&
          beta &&
          alpha.reviewCount === 1 &&
          beta.reviewCount === 1 &&
          alpha.avgScore > beta.avgScore,
      );
    }, { timeout: 15_000 })
    .toBe(true);

  await signInAs(page, ADMIN, at('/admin/proposals'));

  const decisions = page.locator('.section', {
    has: page.getByRole('heading', { name: 'Proposal decisions' }),
  });
  await expect(decisions.locator('.decision-table tbody tr')).toHaveCount(9);
  const decisionTitles = await decisions
    .locator('.decision-table tbody tr td:first-child strong')
    .allInnerTexts();
  expect(decisionTitles.indexOf('Calibrated leader')).toBeLessThan(
    decisionTitles.indexOf('Raw average leader'),
  );
  expect(decisionTitles.at(-1)).toBe('Not scored yet');

  const selected = page.locator('.section', {
    has: page.getByRole('heading', { name: 'Selected speakers' }),
  });
  await expect(selected.locator('.people__row')).toHaveCount(3);
  expect(
    (await selected.locator('.people__meta').allInnerTexts()).map(
      (summary) => summary.split(' · ')[0],
    ),
  ).toEqual(['Calibrated leader', 'Raw average leader', 'Not scored yet']);
});

test('wide form editors keep a readable measure and sign-in methods stay separated', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(at());

  const signInPanel = page.locator('.sign-in-panel');
  const emailHeading = signInPanel.locator('.card__subtitle');
  await expect(emailHeading).toBeVisible();
  const signInGap = await emailHeading.evaluate((heading, button) => {
    const previous = document.querySelector<HTMLElement>(button as string);
    if (!previous) throw new Error('Google sign-in button is missing');
    return heading.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
  }, '.sign-in-panel .google-btn');
  expect(signInGap).toBeGreaterThanOrEqual(20);

  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);
  await signInAs(page, ADMIN, at('/admin/submission'));

  for (const route of ['/admin/submission', '/admin/confirmation']) {
    if (!page.url().endsWith(route)) await page.goto(at(route));
    const section = page.locator('#main-content .section--form');
    await expect(section).toBeVisible();
    expect(await section.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(
      929,
    );
  }
});

test('mobile form-editor rows retain visible labels and wrap stored codes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);
  const longCode = `category_${'a'.repeat(60)}`;
  await setSubmissionFormDirect({
    category: [{ value: longCode, label: { en: 'A long category' } }],
    format: [{ value: 'talk', label: { en: 'Talk' } }],
    level: [{ value: 'all', label: { en: 'All levels' } }],
    deliveryLanguage: [{ value: 'en', label: { en: 'English' } }],
    acks: [
      {
        key: 'recording',
        type: 'checkbox',
        required: true,
        label: {
          en: 'I agree that this session may be recorded and shared after the event.',
          fr: 'J’accepte que cette séance soit enregistrée et partagée après l’événement.',
        },
      },
    ],
    fields: [],
  });

  await signInAs(page, ADMIN, at('/admin/submission'));
  const categories = page.locator('fieldset').filter({ hasText: 'Categories' });
  await expect(categories.locator('.optionlist__mobile-label')).toContainText([
    'English',
    'French',
    'Stored as',
    'Order',
  ]);
  await expect(categories.locator('.optionlist__head').first()).toBeHidden();

  const layout = await categories.locator('.optionlist__code').evaluate((code) => {
    const codeBox = code.getBoundingClientRect();
    const fieldsetBox = code.closest('fieldset')!.getBoundingClientRect();
    const fontSize = parseFloat(getComputedStyle(code).fontSize);
    const action = code
      .closest('.optionlist__grid')!
      .querySelector<HTMLElement>('.iconbtn');
    return {
      codeInside: codeBox.right <= fieldsetBox.right + 1,
      codeWrapped: codeBox.height > fontSize * 1.5,
      actionHeight: action?.getBoundingClientRect().height ?? 0,
      documentOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(layout.codeInside).toBe(true);
  expect(layout.codeWrapped).toBe(true);
  expect(layout.actionHeight).toBeGreaterThanOrEqual(44);
  expect(layout.documentOverflow).toBe(0);

  const acknowledgements = page.locator('fieldset.optionlist', {
    has: page.getByText('What speakers agree to', { exact: true }),
  });
  await expect(acknowledgements.locator('.optionlist__mobile-label')).toContainText([
    'English',
    'French',
    'Order',
  ]);
  await expect(acknowledgements.locator('.optionlist__cell')).toHaveCount(3);

  const acknowledgementLayout = await acknowledgements.evaluate((fieldset) => {
    const fieldsetBox = fieldset.getBoundingClientRect();
    const cells = [...fieldset.querySelectorAll<HTMLElement>('.optionlist__cell')];
    return {
      cellsInside: cells.every((cell) => {
        const box = cell.getBoundingClientRect();
        return box.left >= fieldsetBox.left - 1 && box.right <= fieldsetBox.right + 1;
      }),
      documentOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(acknowledgementLayout.cellsInside).toBe(true);
  expect(acknowledgementLayout.documentOverflow).toBe(0);
});

test('full localized analytics consent copy clears sticky actions at phone and tablet widths', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await signIn(page);

  for (const copy of [en.consent, fr.consent]) {
    // Analytics is deliberately absent in the emulator, so mount the production
    // markup and copy here and mirror ConsentBanner's ResizeObserver contract.
    await page.evaluate((text) => {
      const scope = window as typeof window & {
        consentHeightObserver?: ResizeObserver;
      };
      scope.consentHeightObserver?.disconnect();
      document.querySelector('.consent')?.remove();
      document.documentElement.style.removeProperty('--consent-height');

      const consent = document.createElement('aside');
      consent.className = 'consent';
      consent.setAttribute('role', 'region');
      consent.setAttribute('aria-label', text.title);

      const inner = document.createElement('div');
      inner.className = 'consent__inner';

      const message = document.createElement('p');
      message.className = 'consent__text';
      const title = document.createElement('strong');
      title.textContent = text.title;
      message.append(title, document.createTextNode(` ${text.body}`));

      const actions = document.createElement('div');
      actions.className = 'consent__actions';
      for (const label of [text.decline, text.accept]) {
        const button = document.createElement('button');
        button.className = 'btn';
        button.type = 'button';
        button.textContent = label;
        actions.append(button);
      }

      inner.append(message, actions);
      consent.append(inner);
      document.body.append(consent);

      const update = () => {
        document.documentElement.style.setProperty(
          '--consent-height',
          `${Math.ceil(consent.getBoundingClientRect().height)}px`,
        );
      };
      update();
      scope.consentHeightObserver = new ResizeObserver(update);
      scope.consentHeightObserver.observe(consent);
    }, copy);

    for (const viewport of [
      { width: 320, height: 844 },
      { width: 768, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const consent = document.querySelector<HTMLElement>('.consent');
            if (!consent) return Number.POSITIVE_INFINITY;
            const measured = Number.parseFloat(
              document.documentElement.style.getPropertyValue('--consent-height'),
            );
            return Math.abs(measured - Math.ceil(consent.getBoundingClientRect().height));
          }),
        )
        .toBeLessThanOrEqual(1);

      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

      await expect
        .poll(() =>
          page.evaluate(() => {
            const actions = document.querySelector<HTMLElement>('.actions');
            const consent = document.querySelector<HTMLElement>('.consent');
            if (!actions || !consent) return Number.POSITIVE_INFINITY;
            return actions.getBoundingClientRect().bottom - consent.getBoundingClientRect().top;
          }),
        )
        .toBeLessThanOrEqual(1);

      const layout = await page.evaluate(() => {
        const actions = document.querySelector<HTMLElement>('.actions');
        const consent = document.querySelector<HTMLElement>('.consent');
        if (!actions || !consent) throw new Error('Sticky actions or consent bar is missing');
        const actionStyle = getComputedStyle(actions);
        return {
          actionBottom: actions.getBoundingClientRect().bottom,
          consentTop: consent.getBoundingClientRect().top,
          stickyBottom: Number.parseFloat(actionStyle.bottom),
          transform: actionStyle.transform,
          actionButtonHeight:
            actions.querySelector('button')?.getBoundingClientRect().height ?? 0,
          pagePaddingBottom: Number.parseFloat(
            getComputedStyle(document.querySelector<HTMLElement>('.page')!).paddingBottom,
          ),
          consentHeight: Math.ceil(consent.getBoundingClientRect().height),
        };
      });

      expect(layout.actionBottom).toBeLessThanOrEqual(layout.consentTop + 1);
      expect(layout.stickyBottom).toBeCloseTo(layout.consentHeight, 0);
      expect(layout.transform).toBe('none');
      expect(layout.actionButtonHeight).toBeGreaterThanOrEqual(44);
      expect(layout.pagePaddingBottom).toBeGreaterThanOrEqual(layout.consentHeight + 63);
    }
  }
});

test('pending and completed email rows become readable cards on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const admin = await createAccount(ADMIN);
  const speaker = await createAccount(SPEAKER);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);
  await seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email });
  await seedProposal('email-card', {
    speakerUid: speaker.uid,
    title: 'A pending decision with a readable mobile summary',
    status: 'submitted',
    speaker: { name: SPEAKER.name },
  });
  await seedProposal('email-card-complete', {
    speakerUid: speaker.uid,
    title: 'A completed decision with a readable mobile summary',
    status: 'submitted',
    speaker: { name: SPEAKER.name },
  });
  await callAs(admin.idToken, 'setProposalStatus', {
    proposalId: 'email-card',
    status: 'accepted',
  });
  await callAs(admin.idToken, 'setProposalStatus', {
    proposalId: 'email-card-complete',
    status: 'accepted',
  });
  await setEmailDeliveryReadyDirect();
  const emailPreview = await callJson(admin.idToken, 'emailQueue', { action: 'preview' });
  await callAs(admin.idToken, 'emailQueue', {
    action: 'release',
    logIds: ['accepted__email-card-complete'],
    reviewedRecipients: [
      { logId: 'accepted__email-card-complete', to: SPEAKER.email },
    ],
    ...reviewedEmailConfiguration(emailPreview),
  });
  await waitForEmail(
    (rows) =>
      rows.some(
        (row) => row.id === 'accepted__email-card-complete' && row.status === 'dry_run',
      ),
    'the completed decision email',
  );

  await signInAs(page, ADMIN, at('/admin/email'));
  const held = page.locator('.table--held tbody tr');
  const completed = page
    .locator('.email-log-table tbody tr')
    .filter({ hasText: en.admin.emailStatus.dry_run });
  await expect(held).toHaveCount(1);
  await expect(completed).toHaveCount(1);

  for (const row of [held, completed]) {
    const layout = await row.evaluate((element) => ({
      display: getComputedStyle(element).display,
      labels: [...element.querySelectorAll('td')].map((cell) => cell.dataset.label),
      inside:
        element.getBoundingClientRect().right <=
        document.documentElement.getBoundingClientRect().right + 1,
    }));
    expect(layout.display).toBe('block');
    expect(layout.labels.every(Boolean)).toBe(true);
    expect(layout.inside).toBe(true);
  }
  await expect(completed.getByRole('button', { name: en.admin.emailRetryOne })).toBeEnabled();
  expect(
    await completed
      .getByRole('button', { name: en.admin.emailRetryOne })
      .evaluate((button) => button.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
});
