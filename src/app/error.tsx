'use client';

import { useEffect, useState } from 'react';

import { dictionaries } from '../i18n';
import { detectLocale, SERVER_LOCALE } from '../i18n/context';

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState(SERVER_LOCALE);

  useEffect(() => {
    setLocale(detectLocale());
  }, []);

  const t = dictionaries[locale];
  return (
    <main className="page" id="main-content">
      <section className="panel" role="alert" aria-labelledby="page-error-title">
        <h1 id="page-error-title">{t.errors.pageUnavailableTitle}</h1>
        <p>{t.errors.unavailable}</p>
        <button type="button" className="btn btn--primary" onClick={reset}>
          {t.errors.reload}
        </button>
      </section>
    </main>
  );
}
