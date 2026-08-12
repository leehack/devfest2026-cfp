import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ScoreHistogram } from '../src/components/charts';
import { I18nContext } from '../src/i18n/context';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';

describe('score histogram accessibility', () => {
  it.each([
    ['en', en],
    ['fr', fr],
  ] as const)('gives the chart a self-describing %s name', (locale, t) => {
    const counts = [1, 4, 0, 2];
    const markup = renderToStaticMarkup(
      createElement(
        I18nContext.Provider,
        { value: { locale, t, setLocale: () => undefined } },
        createElement(ScoreHistogram, { counts }),
      ),
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain(`aria-label="${t.admin.chartScoresLabel(counts)}`);
  });
});
