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
import { GoogleButton } from './components/GoogleButton';
import { SubmitPage } from './pages/SubmitPage';
import { AdminPage } from './pages/AdminPage';
import { ReviewPage } from './pages/ReviewPage';
import { HomePage } from './pages/HomePage';
import { NewCfpPage } from './pages/NewCfpPage';
import { loadCfpWindow, type CfpWindow } from './lib/proposals';
import { useRole } from './lib/roles';
import { href, navigate, usePlace, type Place, type Route } from './lib/router';
import { signInAsTestSpeaker, usingEmulators } from './lib/devAuth';
import {
  arrivingFromLink,
  completeSignInFromLink,
  pendingEmail,
  rememberPendingEmail,
  requestSignInLink,
} from './lib/signIn';
import { TextField } from './components/fields';
import type { CfpRole } from '@shared/cfp';

export function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cfp, setCfp] = useState<CfpWindow | null>(null);
  const [cfpReady, setCfpReady] = useState(false);
  const place = usePlace();
  const { route, cfpId } = place;
  const { role, ready: roleReady } = useRole(user, cfpId);

  const t = dictionaries[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem('cfp.locale', locale);
  }, [locale]);

  // The tab is how someone finds this among twenty others, so it names the CFP
  // they are actually on rather than whichever one the HTML was written for.
  useEffect(() => {
    document.title = cfp?.name ? `${cfp.name} — ${t.app.title}` : t.app.title;
  }, [cfp, t]);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    setAuthReady(true);
  }), []);

  // Re-read on navigation so an admin who just moved the window does not walk
  // back to a form still rendering the old one. Speakers never change route, so
  // this costs them nothing.
  useEffect(() => {
    if (!cfpId) {
      setCfp(null);
      setCfpReady(true);
      return;
    }
    setCfpReady(false);
    loadCfpWindow(cfpId)
      .then(setCfp)
      .catch(() => setCfp(null))
      .finally(() => setCfpReady(true));
  }, [route, cfpId]);

  const i18n = useMemo(() => ({ locale, t, setLocale }), [locale, t]);

  return (
    <I18nContext.Provider value={i18n}>
      {/* One width for the chrome, always. The measure belongs to what you read,
          not to the header above it — capping the whole page on the form routes
          pulled the title, the language switch and the nav inwards, so they
          jumped every time you moved between a form and anything else. */}
      <div className="page page--wide">
        <header className="header">
          <div>
            {/* The way back out, everywhere but the page it leads to. The home
                page needs no eyebrow: it would only repeat its own title. */}
            {route !== 'home' && (
              <p className="header__event">
                <a className="header__home" href={href({ route: 'home' })}>
                  {t.platform.back}
                </a>
              </p>
            )}
            <h1 className="header__title">{cfp?.name ?? t.app.title}</h1>
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

        {role && cfpId && <Nav route={route} cfpId={cfpId} role={role} />}

        {/* The form is prose you write, so it keeps a readable measure. Admin
            and review are tables you scan, and 46rem on a wide screen wasted
            it. Left-aligned rather than centred, so the column starts under the
            title instead of floating away from it. */}
        <main className={`main${route === 'form' || route === 'new' ? ' main--narrow' : ''}`}>
          {!authReady || !cfpReady ? (
            <p className="muted">{t.app.loading}</p>
          ) : (
            <Routed place={place} user={user} cfp={cfp} role={role} roleReady={roleReady} />
          )}
        </main>
      </div>
    </I18nContext.Provider>
  );
}

function Nav({ route, cfpId, role }: { route: Route; cfpId: string; role: CfpRole }) {
  const { t } = useI18n();
  const tabs: Route[] = role === 'reviewer' ? ['form', 'review'] : ['form', 'review', 'admin'];

  return (
    <nav className="nav" aria-label={t.app.title}>
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          className={`nav__tab${tab === route ? ' nav__tab--on' : ''}`}
          aria-current={tab === route ? 'page' : undefined}
          onClick={() => navigate(tab, { cfpId })}
        >
          {t.nav[tab as 'form' | 'review' | 'admin']}
        </button>
      ))}
    </nav>
  );
}

interface RoutedProps {
  place: Place;
  user: User | null;
  cfp: CfpWindow | null;
  role: CfpRole | null;
  roleReady: boolean;
}

/**
 * Only the form is gated on the submission window — reviewing happens after it
 * closes, and an admin needs the window controls precisely when it is shut.
 */
function Routed({ place, user, cfp, role, roleReady }: RoutedProps) {
  const { t } = useI18n();
  const { route, cfpId, tab } = place;

  if (route === 'home') return <HomePage user={user} />;
  if (route === 'new') {
    return user ? <NewCfpPage user={user} /> : <SignIn cfp={null} cfpId={null} organising />;
  }

  // Every route below is inside a CFP, and `currentPlace` will not produce one
  // without an id — but the narrowing has to be written down for the compiler.
  if (!cfpId) return <HomePage user={user} />;

  // A link to a CFP that does not exist, or was deleted. Distinguishable from a
  // closed one, and worth saying plainly rather than rendering an empty form.
  if (!cfp) {
    return (
      <div className="panel">
        <p>{t.platform.notFound}</p>
        <button type="button" className="btn btn--primary" onClick={() => navigate('home')}>
          {t.platform.back}
        </button>
      </div>
    );
  }

  if (route === 'form') return <FormRoute user={user} cfp={cfp} cfpId={cfpId} />;

  if (!user) return <SignIn cfp={cfp} cfpId={cfpId} />;
  if (!roleReady) return <p className="muted">{t.app.loading}</p>;

  const allowed = route === 'admin' ? role === 'admin' || role === 'owner' : role !== null;
  if (!allowed) {
    return (
      <div className="panel">
        <p>{t.nav.forbidden}</p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => navigate('form', { cfpId })}
        >
          {t.nav.backToForm}
        </button>
      </div>
    );
  }

  return route === 'admin' ? (
    <AdminPage user={user} cfpId={cfpId} cfpName={cfp.name} tab={tab} role={role!} />
  ) : (
    <ReviewPage user={user} cfpId={cfpId} />
  );
}

function FormRoute({ user, cfp, cfpId }: { user: User | null; cfp: CfpWindow; cfpId: string }) {
  const { t, locale } = useI18n();

  if (cfp.state === 'archived') {
    return <div className="panel">{t.window.closed}</div>;
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

  if (!user) return <SignIn cfp={cfp} cfpId={cfpId} />;

  return <SubmitPage user={user} cfp={cfp} cfpId={cfpId} />;
}

/**
 * `cfpId` decides only who the sign-in mail comes from and where the link lands.
 * Signing in at the home page is the platform's own, and is how somebody with no
 * CFP yet gets an account.
 */
export function SignIn({
  cfp,
  cfpId,
  organising = false,
}: {
  cfp: CfpWindow | null;
  cfpId: string | null;
  /** Signing in to start a CFP rather than to submit to one — different words. */
  organising?: boolean;
}) {
  const { t, locale } = useI18n();
  const [failed, setFailed] = useState(false);
  const [email, setEmail] = useState(pendingEmail);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [linkError, setLinkError] = useState('');
  /* Set when the link was opened somewhere that never asked for it — typically
     requested on a laptop and tapped on a phone. The link is fine; this browser
     just does not know whose it is. */
  const [askingWhose, setAskingWhose] = useState(false);
  const [finishing, setFinishing] = useState(arrivingFromLink);

  // A link in the address bar is the whole reason this page loaded, so it is
  // finished before anything is offered — landing on a sign-in form after
  // clicking "sign in" reads as the link having failed.
  useEffect(() => {
    if (!arrivingFromLink()) return;
    void (async () => {
      const outcome = await completeSignInFromLink();
      if (outcome === 'needsEmail') setAskingWhose(true);
      if (outcome === 'failed') setLinkError(t.app.linkFailed);
      setFinishing(false);
    })();
  }, [t]);

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

  async function sendLink() {
    setSending(true);
    setLinkError('');
    try {
      await requestSignInLink({ email: email.trim(), locale, ...(cfpId ? { cfpId } : {}) });
      // Stored before the confirmation is shown: this is what lets the link
      // complete without asking again when it is opened in this browser.
      rememberPendingEmail(email.trim());
      setSent(true);
    } catch (error: any) {
      setLinkError(
        error?.code === 'functions/resource-exhausted'
          ? t.app.linkTooMany
          : error?.code === 'functions/invalid-argument'
            ? t.app.linkBadEmail
            : t.app.linkFailed,
      );
    } finally {
      setSending(false);
    }
  }

  async function finishWithEmail() {
    setSending(true);
    setLinkError('');
    const outcome = await completeSignInFromLink(email);
    if (outcome !== 'signedIn') setLinkError(t.app.linkFailed);
    setSending(false);
  }

  if (finishing) return <p className="muted">{t.app.linkChecking}</p>;

  return (
    <div className="panel">
      <p>{organising ? t.platform.signInFirst : t.app.signInHint}</p>
      {cfp && (
        <p className="muted">
          {t.window.closesAt} <strong>{formatDate(cfp.closesAt, locale)}</strong>
        </p>
      )}
      {/* Google's own button, wording included. What the sign-in is *for* is
          said by the sentence above it, not by relabelling somebody else's
          identity control. */}
      <GoogleButton onClick={signIn} />
      {failed && (
        <p className="field__error" role="alert">
          {t.errors.signIn}
        </p>
      )}

      <h3 className="card__subtitle">
        {askingWhose ? t.app.linkWhose : t.app.signInEmailTitle}
      </h3>
      <p className="field__help">{askingWhose ? t.app.linkWhoseHelp : t.app.signInEmailHint}</p>

      {sent ? (
        // Deliberately the same wording whether or not the address is known to
        // us — a different message here would answer "did this person apply?".
        <p className="note note--inline" role="status">
          {t.app.linkSent.replace('{email}', email.trim())}
        </p>
      ) : (
        <>
          <TextField
            label={t.speaker.email}
            type="email"
            value={email}
            onChange={setEmail}
            required
            disabled={sending}
          />
          <button
            type="button"
            className="btn"
            disabled={sending || !email.trim()}
            onClick={askingWhose ? finishWithEmail : sendLink}
          >
            {sending
              ? t.app.linkSending
              : askingWhose
                ? t.app.linkContinue
                : t.app.signInEmail}
          </button>
        </>
      )}

      {linkError && (
        <p className="field__error" role="alert">
          {linkError}
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
