import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AppError from '../src/app/error';
import { en } from '../src/i18n/en';

describe('the App Router error boundary', () => {
  it('offers a branded recovery action without exposing the server error', () => {
    const raw = 'PERMISSION_DENIED: runtime detail 7812';
    const markup = renderToStaticMarkup(
      createElement(AppError, { error: new Error(raw), reset: () => undefined }),
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(en.errors.pageUnavailableTitle);
    expect(markup).toContain(en.errors.unavailable);
    expect(markup).toContain(en.errors.reload);
    expect(markup).not.toContain(raw);
  });
});
