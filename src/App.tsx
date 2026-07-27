import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';

import { auth, googleProvider } from './firebase';
import {
  dictionaries,
  detectLocale,
  formatDate,
  I18nContext,
  useI18n,
  type Locale,
} from './i18n';
import { SubmitPage } from './pages/SubmitPage';
import { loadCfpWindow, type CfpWindow } from './lib/proposals';
import { signInAsTestSpeaker, usingEmulators } from './lib/devAuth';

export function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cfp, setCfp] = useState<CfpWindow | null>(null);
  const [cfpReady, setCfpReady] = useState(false);

  const t = dictionaries[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem('cfp.locale', locale);
  }, [locale]);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    loadCfpWindow()
      .then(setCfp)
      .catch(() => setCfp(null))
      .finally(() => setCfpReady(true));
  }, []);

  const i18n = useMemo(() => ({ locale, t, setLocale }), [locale, t]);

  return (
    <I18nContext.Provider value={i18n}>
      <div className="page">
        <header className="header">
          <div>
            <p className="header__event">{t.app.event}</p>
            <h1 className="header__title">{t.app.title}</h1>
          </div>
          <div className="header__right">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setLocale(locale === 'en' ? 'fr' : 'en')}
            >
              {t.switchTo}
            </button>
            {user && (
              <button type="button" className="btn btn--ghost" onClick={() => signOut(auth)}>
                {t.app.signOut}
              </button>
            )}
          </div>
        </header>

        <main className="main">
          {!authReady || !cfpReady ? (
            <p className="muted">{t.app.loading}</p>
          ) : (
            <Body user={user} cfp={cfp} />
          )}
        </main>
      </div>
    </I18nContext.Provider>
  );
}

function Body({ user, cfp }: { user: User | null; cfp: CfpWindow | null }) {
  const { t, locale } = useI18n();

  // Fail closed: without a config document we cannot prove the window is open,
  // and the rules would reject every write anyway.
  if (!cfp) {
    return <div className="panel">{t.window.notOpen}</div>;
  }

  if (cfp.state === 'before') {
    return (
      <div className="panel">
        <p>{t.window.notOpen}</p>
        <p>
          {t.window.opensAt} <strong>{formatDate(cfp.opensAt, locale)}</strong>
        </p>
      </div>
    );
  }

  if (cfp.state === 'paused') {
    return <div className="panel">{t.window.paused}</div>;
  }

  if (cfp.state === 'closed') {
    return (
      <div className="panel">
        <p>{t.window.closed}</p>
        <p>
          {t.window.closedAt} <strong>{formatDate(cfp.closesAt, locale)}</strong>
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="panel">
        <p>{t.app.signInHint}</p>
        <p className="muted">
          {t.window.closesAt} <strong>{formatDate(cfp.closesAt, locale)}</strong>
        </p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => signInWithPopup(auth, googleProvider)}
        >
          {t.app.signIn}
        </button>
        {usingEmulators && (
          <p className="muted" style={{ marginBottom: 0 }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => signInAsTestSpeaker()}
            >
              Sign in as a test speaker (emulator only)
            </button>
          </p>
        )}
      </div>
    );
  }

  return <SubmitPage user={user} cfp={cfp} />;
}
