import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';

import { auth, googleProvider } from './firebase';
import { dictionaries, formatDate, type Locale } from './i18n';
import { detectLocale, I18nContext, SERVER_LOCALE, useI18n } from './i18n/context';
import { GoogleButton } from './components/GoogleButton';
import { Link } from './components/Link';
import { SubmitPage } from './screens/SubmitPage';
import { AdminPage } from './screens/AdminPage';
import { ReviewPage } from './screens/ReviewPage';
import { HomePage } from './screens/HomePage';
import { CfpPage } from './screens/CfpPage';
import { ProfilePage } from './screens/ProfilePage';
import { NewCfpPage } from './screens/NewCfpPage';
import { loadCfpWindow, type CfpWindow } from './lib/proposals';
import { useRole } from './lib/roles';
import { href, navigate, usePlace, type Place, type Route } from './lib/router';
import { ConsentBanner } from './components/ConsentBanner';
import { ConsentControl } from './components/ConsentControl';
import { applyConsent, trackPageView } from './lib/analytics';
import { consent, type Consent } from './lib/consent';
import {
  arrivingFromLink,
  completeSignInFromLink,
  pendingEmail,
  rememberPendingEmail,
  requestSignInLink,
  type SignInDestination,
} from './lib/signIn';
import { TextField } from './components/fields';
import { ToastProvider } from './components/Toast';
import { AccountMenu } from './components/AccountMenu';
import { ThemeSwitch } from './components/ThemeSwitch';
import { useLatest } from './lib/useLatest';
import type { CfpRole } from '@shared/cfp';

export function App({ initialPath }: { initialPath?: string } = {}) {
  /*
   * Starts at the locale the server rendered, then settles to the real one after
   * mount. Calling `detectLocale` in the initialiser read `localStorage` during a
   * server render, which is a crash rather than a wrong answer.
   */
  const [locale, setLocale] = useState<Locale>(SERVER_LOCALE);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cfp, setCfp] = useState<CfpWindow | null>(null);
  const [cfpReady, setCfpReady] = useState(false);
  const [cfpError, setCfpError] = useState(false);
  const [cfpAttempt, setCfpAttempt] = useState(0);
  const place = usePlace(initialPath);
  /*
   * Owned here rather than inside the banner, so the footer control can put the
   * question back on screen. Withdrawing has to be as easy as agreeing.
   *
   * Starts false and is decided after mount, never in the initialiser. On a
   * server there is no storage, `consent()` reads that as `unasked`, and the
   * prerendered HTML would carry the banner for every visitor including the ones
   * who already answered — a hydration mismatch that also asks twice.
   */
  const [askConsent, setAskConsent] = useState(false);
  const [analyticsConsent, setAnalyticsConsent] = useState<Consent>('unasked');
  const { route, cfpId } = place;
  const placeKey = `${route}:${cfpId ?? ''}:${place.tab}`;
  const focusedPlace = useRef(placeKey);
  const {
    role,
    ready: roleReady,
    error: roleError,
    retry: retryRole,
  } = useRole(user, cfpId);

  const t = dictionaries[locale];

  const [localeSettled, setLocaleSettled] = useState(false);
  useEffect(() => {
    setLocale(detectLocale());
    setLocaleSettled(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    // Not before the detected locale has been read, or this would write the
    // server's placeholder over what the visitor actually chose last time.
    if (localeSettled) {
      try {
        localStorage.setItem('cfp.locale', locale);
      } catch {
        // The language still applies for this page; only persistence is unavailable.
      }
    }
  }, [locale, localeSettled]);

  // The tab is how someone finds this among twenty others, so it names the CFP
  // they are actually on rather than whichever one the HTML was written for.
  useEffect(() => {
    document.title = cfp?.name ? `${cfp.name} — ${t.app.title}` : t.app.title;
  }, [cfp, t]);

  /*
   * Starts the SDK for somebody who agreed on an earlier visit. A no-op for
   * everyone else, including anyone who has simply never been asked.
   *
   * The banner's own question is settled here too, for the reason above: the
   * answer lives in storage, and storage does not exist until this runs.
   */
  useEffect(() => {
    const current = consent();
    setAnalyticsConsent(current);
    applyConsent();
    if (current === 'unasked') setAskConsent(true);
  }, []);

  /*
   * The end-to-end tests reach for `window.signInAsTestSpeaker`. Installed from
   * a chunk production never requests, rather than from a branch we hope the
   * bundler removes. `tests/e2e/form.ts` already waits for the function to
   * appear, so arriving a tick late changes nothing.
   */
  useEffect(() => {
    /*
     * The comparison is written out in full rather than reading the shared
     * constant, because that literal form is what lets the bundler fold this to
     * `false` and drop the import — and with it the whole module, rather than
     * emitting it as a chunk nothing ever asks for. A downloadable file
     * containing signInWithCredential is not worth the tidier import.
     */
    if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
      void import('./lib/devAuth').then((m) => m.installTestSignIn());
    }
  }, []);

  // One page_view per navigation, with the CFP slug as a parameter and out of
  // the path — see `pageShape`. The router is a real router now, so nothing
  // else would report a screen change.
  useEffect(() => {
    trackPageView(window.location.pathname, cfpId || null);
  }, [route, cfpId]);

  // Our path router replaces screens without a document navigation. Move
  // keyboard and screen-reader focus to the new content so it does not remain
  // on a link that disappeared with the previous screen.
  useEffect(() => {
    if (focusedPlace.current === placeKey) return;
    focusedPlace.current = placeKey;
    requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  }, [placeKey]);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    setAuthReady(true);
  }), []);

  const retryCfp = useCallback(() => setCfpAttempt((attempt) => attempt + 1), []);

  // Re-read on navigation so an admin who just moved the window does not walk
  // back to a form still rendering the old one. Speakers never change route, so
  // this costs them nothing.
  useEffect(() => {
    let cancelled = false;

    if (!cfpId) {
      setCfp(null);
      setCfpReady(true);
      setCfpError(false);
      return;
    }
    setCfpReady(false);
    setCfpError(false);
    loadCfpWindow(cfpId)
      .then((next) => {
        if (!cancelled) setCfp(next);
      })
      .catch(() => {
        if (!cancelled) {
          setCfp(null);
          setCfpError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setCfpReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [route, cfpId, cfpAttempt]);

  const i18n = useMemo(() => ({ locale, t, setLocale }), [locale, t]);

  return (
    <I18nContext.Provider value={i18n}>
      <ToastProvider>
        <a className="skip-link" href="#main-content">
          {t.app.skipToContent}
        </a>
        {/* One width for the chrome, always. The measure belongs to what you read,
            not to the header above it — capping the whole page on the form routes
            pulled the title, the language switch and the nav inwards, so they
            jumped every time you moved between a form and anything else. */}
        <div className="page page--wide">
          <header className="header">
            <div className="header__identity">
              <span className="brand-mark" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
              <div>
                {/* The way back out, everywhere but the page it leads to. The home
                    page needs no eyebrow: it would only repeat its own title. */}
                {route !== 'home' && (
                  <p className="header__event">
                    <Link className="header__home" to={href({ route: 'home' })}>
                      {t.platform.back}
                    </Link>
                  </p>
                )}
                <h1 className="header__title">{cfp?.name ?? t.app.title}</h1>
              </div>
            </div>
            <div className="header__right">
              <div className="header__preferences">
                <button
                  type="button"
                  className="btn btn--ghost locale-switch"
                  onClick={() => setLocale(locale === 'en' ? 'fr' : 'en')}
                >
                  {t.switchTo}
                </button>
                <ThemeSwitch />
              </div>
              {authReady &&
                (user ? (
                  <AccountMenu
                    user={user}
                    showProfile={route !== 'me'}
                    onSignOut={() => signOut(auth)}
                  />
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary header__sign-in"
                    onClick={() => {
                      const signIn = document.getElementById('sign-in');
                      if (signIn) {
                        signIn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        signIn.focus({ preventScroll: true });
                      } else {
                        navigate('me');
                      }
                    }}
                  >
                    {t.app.signIn}
                  </button>
                ))}
            </div>
          </header>

          {role && cfpId && <Nav route={route} cfpId={cfpId} role={role} />}

          {/* Long-form routes set their own readable measure. The submission
              workspace also needs room for its progress rail, so it uses the
              wide shell and constrains the questions inside that workspace. */}
          <main
            className={`main${route === 'new' || route === 'cfp' || route === 'me' ? ' main--narrow' : ''}`}
            id="main-content"
            tabIndex={-1}
          >
            {!authReady || !cfpReady ? (
              <p className="muted">{t.app.loading}</p>
            ) : (
              <Routed
                place={place}
                user={user}
                cfp={cfp}
                role={role}
                roleReady={roleReady}
                roleError={roleError}
                retryRole={retryRole}
                cfpError={cfpError}
                retryCfp={retryCfp}
              />
            )}
          </main>

          <footer className="footer">
            <ConsentControl
              answer={analyticsConsent}
              open={askConsent}
              onReopen={() => setAskConsent(true)}
            />
          </footer>
        </div>
        <ConsentBanner
          open={askConsent}
          onAnswered={(choice) => {
            const wasGranted = analyticsConsent === 'granted';
            setAnalyticsConsent(choice);
            setAskConsent(false);
            // The initial page-view attempt was suppressed while consent was
            // unanswered. Count this visit now that the visitor opted in.
            if (choice === 'granted' && !wasGranted) {
              trackPageView(window.location.pathname, cfpId || null);
            }
          }}
        />
      </ToastProvider>
    </I18nContext.Provider>
  );
}

function Nav({ route, cfpId, role }: { route: Route; cfpId: string; role: CfpRole }) {
  const { t } = useI18n();
  const tabs: Route[] = role === 'reviewer' ? ['form', 'review'] : ['form', 'review', 'admin'];

  return (
    <nav className="nav" aria-label={t.app.title}>
      {tabs.map((tab) => (
        <Link
          key={tab}
          to={href({ route: tab, cfpId })}
          className={`nav__tab${tab === route ? ' nav__tab--on' : ''}`}
          aria-current={tab === route ? 'page' : undefined}
        >
          {t.nav[tab as 'form' | 'review' | 'admin']}
        </Link>
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
  roleError: boolean;
  retryRole: () => void;
  cfpError: boolean;
  retryCfp: () => void;
}

/**
 * Only the form is gated on the submission window — reviewing happens after it
 * closes, and an admin needs the window controls precisely when it is shut.
 */
function Routed({
  place,
  user,
  cfp,
  role,
  roleReady,
  roleError,
  retryRole,
  cfpError,
  retryCfp,
}: RoutedProps) {
  const { t } = useI18n();
  const { route, cfpId, tab } = place;

  if (route === 'home') return <HomePage user={user} />;
  if (route === 'new') {
    return user ? (
      <NewCfpPage user={user} />
    ) : (
      <SignIn cfp={null} cfpId={null} purpose="organising" />
    );
  }
  if (route === 'me') {
    return user ? (
      <ProfilePage user={user} />
    ) : (
      <SignIn cfp={null} cfpId={null} purpose="account" />
    );
  }

  // Every route below is inside a CFP, and `currentPlace` will not produce one
  // without an id — but the narrowing has to be written down for the compiler.
  if (!cfpId) return <HomePage user={user} />;

  if (cfpError) {
    return (
      <div className="panel">
        <p className="field__error" role="alert">
          {t.errors.unavailable}
        </p>
        <button type="button" className="btn" onClick={retryCfp}>
          {t.errors.reload}
        </button>
      </div>
    );
  }

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

  // The front page is public on purpose: it is the one screen whose audience
  // has not signed in, and being asked to before reading what the event is
  // would be asking in the wrong order.
  if (route === 'cfp') return <CfpPage cfp={cfp} cfpId={cfpId} />;

  if (route === 'form') return <FormRoute user={user} cfp={cfp} cfpId={cfpId} />;

  if (!user) {
    const destination: SignInDestination =
      route === 'admin' ? `admin/${tab}` : 'review';
    return (
      <SignIn
        cfp={cfp}
        cfpId={cfpId}
        purpose="committee"
        destination={destination}
      />
    );
  }
  if (!roleReady) return <p className="muted">{t.app.loading}</p>;
  if (roleError) {
    return (
      <div className="panel">
        <p className="field__error" role="alert">
          {t.errors.unavailable}
        </p>
        <button type="button" className="btn" onClick={retryRole}>
          {t.errors.reload}
        </button>
      </div>
    );
  }

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

function WindowNotice({ cfp }: { cfp: CfpWindow }) {
  const { t, locale } = useI18n();

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

  return <div className="panel">{t.window.closed}</div>;
}

function FormRoute({ user, cfp, cfpId }: { user: User | null; cfp: CfpWindow; cfpId: string }) {
  const { t, locale } = useI18n();

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

  if (!user) {
    return (
      <>
        {cfp.state !== 'open' && <WindowNotice cfp={cfp} />}
        <SignIn cfp={cfp} cfpId={cfpId} />
      </>
    );
  }

  // A closed call blocks creating a proposal, not opening one that already
  // belongs to this account. SubmitPage decides which case this is after its
  // scoped proposal query returns. The tenant id is also the component identity:
  // a route change must not let an in-flight save from one CFP finish against
  // the refs and state already reused for another one.
  return <SubmitPage key={cfpId} user={user} cfp={cfp} cfpId={cfpId} />;
}

/**
 * `cfpId` decides only who the sign-in mail comes from and where the link lands.
 * Signing in at the home page is the platform's own, and is how somebody with no
 * CFP yet gets an account.
 */
export function SignIn({
  cfp,
  cfpId,
  purpose = 'speaker',
  destination = 'submit',
}: {
  cfp: CfpWindow | null;
  cfpId: string | null;
  purpose?: 'speaker' | 'committee' | 'account' | 'organising';
  destination?: SignInDestination;
}) {
  const { t, locale } = useI18n();
  const tRef = useLatest(t);
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
      if (outcome === 'failed') setLinkError(tRef.current.app.linkFailed);
      setFinishing(false);
    })();
  }, [tRef]);

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
      await requestSignInLink({
        email: email.trim(),
        locale,
        ...(cfpId ? { cfpId, destination } : {}),
      });
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

  const hint =
    purpose === 'organising'
      ? t.platform.signInFirst
      : purpose === 'committee'
        ? t.app.signInCommitteeHint
        : purpose === 'account'
          ? t.app.signInAccountHint
          : t.app.signInHint;

  return (
    <div
      className="panel sign-in-panel"
      id="sign-in"
      role="region"
      aria-label={t.app.signIn}
      tabIndex={-1}
    >
      <p>{hint}</p>
      {cfp?.state === 'open' && (
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

      {sent && (
        // Deliberately the same wording whether or not the address is known to
        // us — a different message here would answer "did this person apply?".
        <p className="note note--inline" role="status">
          {t.app.linkSent.replace('{email}', email.trim())}
        </p>
      )}
      <TextField
        label={t.speaker.email}
        type="email"
        value={email}
        onChange={(next) => {
          setEmail(next);
          setSent(false);
          setLinkError('');
        }}
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

      {linkError && (
        <p className="field__error" role="alert">
          {linkError}
        </p>
      )}

      {process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' && (
        <p className="muted" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void import('./lib/devAuth').then((m) => m.signInAsTestSpeaker())}
          >
            Sign in as a test speaker (emulator only)
          </button>
        </p>
      )}
    </div>
  );
}
