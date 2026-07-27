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
import { AdminPage } from './pages/AdminPage';
import { ReviewPage } from './pages/ReviewPage';
import { loadCfpWindow, type CfpWindow } from './lib/proposals';
import { useRole } from './lib/roles';
import { navigate, useRoute, type Route } from './lib/router';
import { signInAsTestSpeaker, usingEmulators } from './lib/devAuth';
import type { Role } from '@shared/enums';

export function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cfp, setCfp] = useState<CfpWindow | null>(null);
  const [cfpReady, setCfpReady] = useState(false);
  const route = useRoute();
  const { role, ready: roleReady } = useRole(user);

  const t = dictionaries[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem('cfp.locale', locale);
  }, [locale]);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    setAuthReady(true);
  }), []);

  // Re-read on navigation so an admin who just moved the window does not walk
  // back to a form still rendering the old one. Speakers never change route, so
  // this costs them nothing.
  useEffect(() => {
    loadCfpWindow()
      .then(setCfp)
      .catch(() => setCfp(null))
      .finally(() => setCfpReady(true));
  }, [route]);

  const i18n = useMemo(() => ({ locale, t, setLocale }), [locale, t]);

  return (
    <I18nContext.Provider value={i18n}>
      {/* The form is prose you write, so it keeps a readable measure. Admin and
          review are tables you scan, and 46rem on a wide screen wasted it. */}
      <div className={route === 'form' ? 'page' : 'page page--wide'}>
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

        {role && <Nav route={route} role={role} />}

        <main className="main">
          {!authReady || !cfpReady ? (
            <p className="muted">{t.app.loading}</p>
          ) : (
            <Routed route={route} user={user} cfp={cfp} role={role} roleReady={roleReady} />
          )}
        </main>
      </div>
    </I18nContext.Provider>
  );
}

function Nav({ route, role }: { route: Route; role: Role }) {
  const { t } = useI18n();
  const tabs: Route[] = role === 'admin' ? ['form', 'review', 'admin'] : ['form', 'review'];

  return (
    <nav className="nav" aria-label={t.app.title}>
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          className={`nav__tab${tab === route ? ' nav__tab--on' : ''}`}
          aria-current={tab === route ? 'page' : undefined}
          onClick={() => navigate(tab)}
        >
          {t.nav[tab]}
        </button>
      ))}
    </nav>
  );
}

interface RoutedProps {
  route: Route;
  user: User | null;
  cfp: CfpWindow | null;
  role: Role | null;
  roleReady: boolean;
}

/**
 * Only the form is gated on the submission window — reviewing happens after it
 * closes, and an admin needs the window controls precisely when it is shut.
 */
function Routed({ route, user, cfp, role, roleReady }: RoutedProps) {
  const { t } = useI18n();

  if (route === 'form') return <FormRoute user={user} cfp={cfp} />;

  if (!user) return <SignIn cfp={cfp} />;
  if (!roleReady) return <p className="muted">{t.app.loading}</p>;

  const allowed = route === 'admin' ? role === 'admin' : role !== null;
  if (!allowed) {
    return (
      <div className="panel">
        <p>{t.nav.forbidden}</p>
        <button type="button" className="btn btn--primary" onClick={() => navigate('form')}>
          {t.nav.backToForm}
        </button>
      </div>
    );
  }

  return route === 'admin' ? <AdminPage user={user} /> : <ReviewPage user={user} />;
}

function FormRoute({ user, cfp }: { user: User | null; cfp: CfpWindow | null }) {
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

  if (!user) return <SignIn cfp={cfp} />;

  return <SubmitPage user={user} cfp={cfp} />;
}

function SignIn({ cfp }: { cfp: CfpWindow | null }) {
  const { t, locale } = useI18n();
  const [failed, setFailed] = useState(false);

  // Popups get blocked, closed, and cancelled. Swallowing the rejection left the
  // button looking dead.
  async function signIn() {
    setFailed(false);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      if (error?.code === 'auth/popup-closed-by-user') return;
      console.error('sign-in failed', error);
      setFailed(true);
    }
  }

  return (
    <div className="panel">
      <p>{t.app.signInHint}</p>
      {cfp && (
        <p className="muted">
          {t.window.closesAt} <strong>{formatDate(cfp.closesAt, locale)}</strong>
        </p>
      )}
      <button type="button" className="btn btn--primary" onClick={signIn}>
        {t.app.signIn}
      </button>
      {failed && (
        <p className="field__error" role="alert">
          {t.errors.signIn}
        </p>
      )}
      {usingEmulators && (
        <p className="muted" style={{ marginBottom: 0 }}>
          <button type="button" className="btn btn--ghost" onClick={() => signInAsTestSpeaker()}>
            Sign in as a test speaker (emulator only)
          </button>
        </p>
      )}
    </div>
  );
}
