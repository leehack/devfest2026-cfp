import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';

import { auth, googleProvider } from './firebase';
import { dictionaries, formatDate, type Locale } from './i18n';
import { detectLocale, I18nContext, SERVER_LOCALE, useI18n } from './i18n/context';
import { GoogleButton } from './components/GoogleButton';
import {
  AppBreadcrumb,
  documentTitle,
  EventNavigation,
  headerTitle,
} from './components/AppNavigation';
// Both have server-rendered segments under `app/c`, so neither can be lazy:
// React has no chunk to hydrate with and drops the server HTML for the Suspense
// fallback until one arrives.
import { CfpPage } from './screens/CfpPage';
import { SchedulePage } from './screens/SchedulePage';
import { loadCfpWindow, type CfpWindow } from './lib/proposals';
import { usePlatformAccess, useRole } from './lib/roles';
import { goTo, navigate, usePlace, type Place } from './lib/router';
import {
  AGENDA_RETURN_STATE,
  agendaReturnContext,
  historyStateWithout,
} from './lib/scheduleHistory';
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
import { Link } from './components/Link';
import { PreferencesMenu } from './components/PreferencesMenu';
import { useLatest } from './lib/useLatest';
import type { CfpRole } from '@shared/cfp';
import { themeForeground } from '@shared/cfpTheme';
import type { PlatformAccessStatus } from '@shared/platform';
import type { PublishedScheduleBundle } from './lib/schedule';
import { coSpeakerInviteQuery } from './lib/coSpeakers';
import { proposalSelectionQuery } from './lib/proposalLinks';

const SubmitPage = lazy(() =>
  import('./screens/SubmitPage').then(({ SubmitPage }) => ({ default: SubmitPage })),
);
const AdminPage = lazy(() =>
  import('./screens/AdminPage').then(({ AdminPage }) => ({ default: AdminPage })),
);
const ReviewPage = lazy(() =>
  import('./screens/ReviewPage').then(({ ReviewPage }) => ({ default: ReviewPage })),
);
const HomePage = lazy(() =>
  import('./screens/HomePage').then(({ HomePage }) => ({ default: HomePage })),
);
const ProfilePage = lazy(() =>
  import('./screens/ProfilePage').then(({ ProfilePage }) => ({ default: ProfilePage })),
);
const NewCfpPage = lazy(() =>
  import('./screens/NewCfpPage').then(({ NewCfpPage }) => ({ default: NewCfpPage })),
);
const PlatformAdminPage = lazy(() =>
  import('./screens/PlatformAdminPage').then(({ PlatformAdminPage }) => ({
    default: PlatformAdminPage,
  })),
);
const OrgsListPage = lazy(() =>
  import('./screens/OrgsListPage').then(({ OrgsListPage }) => ({ default: OrgsListPage })),
);
const OrgWorkspacePage = lazy(() =>
  import('./screens/OrgWorkspacePage').then(({ OrgWorkspacePage }) => ({
    default: OrgWorkspacePage,
  })),
);
const JoinCommitteePage = lazy(() =>
  import('./screens/JoinCommitteePage').then(({ JoinCommitteePage }) => ({
    default: JoinCommitteePage,
  })),
);

const SIGN_IN_RETURN_PATH = 'cfp.signInReturnPath';

export function App({
  initialPath,
  initialCfp,
  initialSchedule,
}: {
  initialPath?: string;
  initialCfp?: { id: string; value: CfpWindow | null };
  initialSchedule?: { releaseId: string; value: PublishedScheduleBundle | null };
} = {}) {
  /*
   * Starts at the locale the server rendered, then settles to the real one after
   * mount. Calling `detectLocale` in the initialiser read `localStorage` during a
   * server render, which is a crash rather than a wrong answer.
   */
  const [locale, setLocale] = useState<Locale>(SERVER_LOCALE);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cfp, setCfp] = useState<CfpWindow | null>(initialCfp?.value ?? null);
  const [loadedCfpId, setLoadedCfpId] = useState<string | null>(initialCfp?.id ?? null);
  const [cfpReady, setCfpReady] = useState(initialCfp !== undefined);
  const [cfpError, setCfpError] = useState(false);
  const [cfpAttempt, setCfpAttempt] = useState(0);
  const currentCfpId = useRef<string | null>(null);
  const loadedCfpRef = useRef<{ id: string | null; hasValue: boolean }>({
    id: initialCfp?.id ?? null,
    hasValue: Boolean(initialCfp?.value),
  });
  loadedCfpRef.current = { id: loadedCfpId, hasValue: Boolean(cfp) };
  const seededCfp = useRef(
    initialCfp ? { id: initialCfp.id, stillOnInitialRoute: true } : null,
  );
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
  const focusedIdentity = useRef<string | null | undefined>(undefined);
  const { route, cfpId } = place;
  currentCfpId.current = cfpId;
  const placeKey = `${route}:${cfpId ?? ''}:${place.orgId ?? ''}:${place.tab}:${place.entryId ?? ''}`;
  const [emailLink, setEmailLink] = useState(false);
  const focusedPlace = useRef(placeKey);
  const {
    role,
    ready: roleReady,
    error: roleError,
    retry: retryRole,
  } = useRole(user, cfpId);
  const {
    status: platformStatus,
    ready: platformReady,
    error: platformError,
    retry: retryPlatform,
  } = usePlatformAccess(user);

  const t = dictionaries[locale];
  const visibleCfp = loadedCfpId === cfpId ? cfp : null;
  const pageLabel = documentTitle(place, visibleCfp?.name ?? null, t);
  const [sessionPageLabel, setSessionPageLabel] = useState<{
    cfpId: string;
    entryId: string;
    label: string;
  } | null>(null);
  const accessiblePageLabel =
    place.route === 'session' &&
    sessionPageLabel?.cfpId === cfpId &&
    sessionPageLabel.entryId === place.entryId
      ? sessionPageLabel.label
      : pageLabel;
  // A session heading only ever arrives from SchedulePage. When the route ends
  // in the error or not-found panel instead, none is coming, and waiting for one
  // would leave focus on the link that disappeared with the previous screen.
  const routeAnnouncementReady =
    place.route !== 'session' ||
    (cfpReady && loadedCfpId === cfpId && (cfpError || !cfp)) ||
    (sessionPageLabel?.cfpId === cfpId && sessionPageLabel.entryId === place.entryId);
  const handleSessionPageLabelChange = useCallback(
    (entryId: string, label: string) => {
      if (!cfpId) return;
      setSessionPageLabel((current) =>
        current?.cfpId === cfpId &&
        current.entryId === entryId &&
        current.label === label
          ? current
          : { cfpId, entryId, label },
      );
    },
    [cfpId],
  );
  const signedOutProtectedRoute = !user && (route === 'review' || route === 'admin');

  const [localeSettled, setLocaleSettled] = useState(false);
  useEffect(() => {
    setLocale(detectLocale());
    setLocaleSettled(true);
  }, []);

  /*
   * The server cannot see the query string, so settle this after mount. Recheck
   * when auth changes: completing the link replaces the URL and signs in its
   * owner, which is what hands the destination back to the ordinary route.
   */
  useEffect(() => {
    setEmailLink(arrivingFromLink());
  }, [placeKey, user]);

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
  // and the task they are actually on rather than whichever screen the HTML
  // was written for.
  useEffect(() => {
    // The session screen owns its loaded entry title. Leaving its server title
    // alone also keeps a direct request and an in-app navigation identical.
    if (place.route === 'session') return;
    document.title = pageLabel;
  }, [pageLabel, place.route]);

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
    if (!routeAnnouncementReady) return;
    focusedPlace.current = placeKey;
    const scheduleReturn = agendaReturnContext(AGENDA_RETURN_STATE);
    if (route === 'schedule' && scheduleReturn?.cfpId === cfpId) {
      const visibleScheduleId =
        role &&
        visibleCfp?.sharedScheduleId &&
        visibleCfp.sharedScheduleId !== visibleCfp.publishedScheduleId
          ? visibleCfp?.sharedScheduleId
          : visibleCfp?.publishedScheduleId;
      if (scheduleReturn.scheduleId === visibleScheduleId) return;
      window.history.replaceState(
        historyStateWithout(AGENDA_RETURN_STATE),
        '',
        window.location.href,
      );
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    requestAnimationFrame(() => {
      const modal = document.querySelector<HTMLElement>('[aria-modal="true"]');
      if (modal) {
        modal.focus({ preventScroll: true });
        return;
      }
      document.getElementById('main-content')?.focus();
    });
  }, [
    cfpId,
    placeKey,
    role,
    route,
    routeAnnouncementReady,
    visibleCfp?.publishedScheduleId,
    visibleCfp?.sharedScheduleId,
  ]);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    setAuthReady(true);
  }), []);

  // Signing in and out replaces the protected screen without changing its URL.
  // Treat that as a screen transition too, after ignoring the initial restored
  // session, so focus never stays on a control that just unmounted.
  useEffect(() => {
    if (!authReady) return;
    const identity = user?.uid ?? null;
    if (focusedIdentity.current === undefined) {
      focusedIdentity.current = identity;
      return;
    }
    if (focusedIdentity.current === identity) return;
    const previousIdentity = focusedIdentity.current;
    focusedIdentity.current = identity;
    if (previousIdentity === null && identity) {
      try {
        const returnPath = window.sessionStorage.getItem(SIGN_IN_RETURN_PATH);
        window.sessionStorage.removeItem(SIGN_IN_RETURN_PATH);
        if (returnPath?.startsWith('/') && !returnPath.startsWith('//')) {
          goTo(returnPath);
          return;
        }
      } catch {
        // Sign-in still succeeds when session storage is unavailable.
      }
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const modal = document.querySelector<HTMLElement>('[aria-modal="true"]');
        const target = modal ?? document.getElementById('sign-in') ?? document.getElementById('main-content');
        target?.focus({ preventScroll: true });
      });
    });
  }, [authReady, user?.uid]);

  const retryCfp = useCallback(() => setCfpAttempt((attempt) => attempt + 1), []);
  const refreshCfp = useCallback(async () => {
    const id = cfpId;
    if (!id) return;
    try {
      const next = await loadCfpWindow(id);
      if (currentCfpId.current !== id) return;
      setCfp(next);
      setLoadedCfpId(id);
      setCfpError(false);
    } catch {
      // The disclosure write already succeeded and the schedule screen has
      // refreshed its own data. Keep it usable; the next route load retries
      // this lightweight navigation metadata naturally.
    }
  }, [cfpId]);

  // Re-read on navigation so an admin who just moved the window does not walk
  // back to a form still rendering the old one. Speakers never change route, so
  // this costs them nothing.
  useEffect(() => {
    let cancelled = false;

    const seeded = seededCfp.current;
    if (
      seeded?.stillOnInitialRoute &&
      seeded.id === cfpId &&
      (route === 'cfp' || route === 'schedule' || route === 'session') &&
      cfpAttempt === 0
    ) {
      setCfpError(false);
      setCfpReady(true);
      return;
    }
    if (seeded) seeded.stillOnInitialRoute = false;

    if (!cfpId) {
      setCfp(null);
      setLoadedCfpId(null);
      setCfpReady(true);
      setCfpError(false);
      return;
    }

    const alreadyLoaded =
      loadedCfpRef.current.id === cfpId && loadedCfpRef.current.hasValue;
    if (!alreadyLoaded) {
      setCfpReady(false);
    }
    setCfpError(false);

    loadCfpWindow(cfpId, { force: cfpAttempt > 0 })
      .then((next) => {
        if (!cancelled) {
          setCfp(next);
          setLoadedCfpId(cfpId);
          setCfpReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          if (!alreadyLoaded) {
            setCfp(null);
            setLoadedCfpId(cfpId);
            setCfpError(true);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setCfpReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [route, cfpId, cfpAttempt]);

  const themeStyle = useMemo(() => {
    const theme = visibleCfp?.theme;
    if (!theme?.primaryColor && !theme?.accentColor && !theme?.mastheadBg) return undefined;
    const style: Record<string, string> = {};
    if (theme.primaryColor) {
      const foreground = themeForeground(theme.primaryColor);
      style['--primary'] = theme.primaryColor;
      style['--primary-fg'] = foreground;
      style['--primary-hover'] = `color-mix(in srgb, ${theme.primaryColor} 82%, ${foreground})`;
      style['--brand-color'] = theme.primaryColor;
      if (!theme.mastheadBg) style['--masthead-bg'] = theme.primaryColor;
    }
    if (theme.accentColor) {
      style['--accent'] = theme.accentColor;
      style['--accent-fg'] = themeForeground(theme.accentColor);
      style['--accent-soft'] = `${theme.accentColor}1f`;
    } else if (theme.primaryColor) {
      style['--accent'] = theme.primaryColor;
      style['--accent-fg'] = themeForeground(theme.primaryColor);
      style['--accent-soft'] = `${theme.primaryColor}1f`;
    }
    if (theme.mastheadBg) style['--masthead-bg'] = theme.mastheadBg;
    return style as React.CSSProperties;
  }, [visibleCfp?.theme]);

  useEffect(() => {
    const root = document.documentElement;
    const properties = [
      '--primary',
      '--primary-fg',
      '--primary-hover',
      '--accent',
      '--accent-fg',
      '--accent-soft',
      '--masthead-bg',
      '--brand-color',
    ];
    for (const property of properties) {
      const value = themeStyle
        ? (themeStyle as Record<string, string>)[property]
        : undefined;
      if (value) root.style.setProperty(property, value);
      else root.style.removeProperty(property);
    }
    return () => {
      for (const property of properties) root.style.removeProperty(property);
    };
  }, [themeStyle]);

  const i18n = useMemo(() => ({ locale, t, setLocale }), [locale, t]);

  return (
    <I18nContext.Provider value={i18n}>
      <ToastProvider>
        <a className="skip-link" href="#main-content">
          {t.app.skipToContent}
        </a>
        {/* One width for the chrome, always. The measure belongs to what you read,
            not to the header above it — capping the whole page on the form routes
            pulled the title and account controls inwards, so they
            jumped every time you moved between a form and anything else. */}
        <div className="page page--wide" style={themeStyle}>
          <header className="header">
            <div className="header__identity">
              <Link to="/" className="brand-home" aria-label={t.nav.allCalls}>
                <span className="brand-mark" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
              </Link>
              <div>
                <AppBreadcrumb
                  place={place}
                  cfpName={visibleCfp?.name ?? null}
                  canAccessAdmin={role === 'admin' || role === 'owner'}
                />
                <h1 className="header__title">
                  {headerTitle(place, visibleCfp?.name ?? null, t)}
                </h1>
              </div>
            </div>
            <div className="header__right">
              <PreferencesMenu />
              {authReady &&
                (user ? (
                  <AccountMenu
                    user={user}
                    showProfile={route !== 'me'}
                    showPlatformAdmin={
                      platformStatus?.isPlatformAdmin === true && route !== 'platform'
                    }
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
                      } else if (cfpId) {
                        navigate('form', { cfpId });
                      } else {
                        try {
                          window.sessionStorage.setItem(
                            SIGN_IN_RETURN_PATH,
                            `${window.location.pathname}${window.location.search}${window.location.hash}`,
                          );
                        } catch {
                          // The account page remains a safe fallback.
                        }
                        navigate('me');
                      }
                    }}
                  >
                    {t.app.signIn}
                  </button>
                ))}
            </div>
          </header>

          {cfpId && visibleCfp && !signedOutProtectedRoute && (
            <EventNavigation
              place={place}
              cfpName={visibleCfp.name}
              role={role}
              hasSchedule={Boolean(
                visibleCfp.publishedScheduleId ||
                  (role && visibleCfp.sharedScheduleId),
              )}
            />
          )}

          {/* Long-form routes set their own readable measure. The submission
              workspace also needs room for its progress rail, so it uses the
              wide shell and constrains the questions inside that workspace. */}
          <main
            className={`main${route === 'new' || route === 'cfp' || route === 'me' ? ' main--narrow' : ''}`}
            id="main-content"
            aria-label={accessiblePageLabel}
            tabIndex={-1}
          >
            {!cfpReady || (!authReady && !['cfp', 'schedule', 'session'].includes(route)) ? (
              <p className="muted">{t.app.loading}</p>
            ) : (
              <Suspense fallback={<p className="muted">{t.app.loading}</p>}>
                <Routed
                  place={place}
                  user={user}
                  authReady={authReady}
                  emailLink={emailLink}
                  cfp={visibleCfp}
                  role={role}
                  roleReady={roleReady}
                  roleError={roleError}
                  retryRole={retryRole}
                  platformStatus={platformStatus}
                  platformReady={platformReady}
                  platformError={platformError}
                  retryPlatform={retryPlatform}
                  cfpError={cfpError}
                  retryCfp={retryCfp}
                  refreshCfp={refreshCfp}
                  initialSchedule={initialSchedule}
                  onSessionPageLabelChange={handleSessionPageLabelChange}
                />
              </Suspense>
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

interface RoutedProps {
  place: Place;
  user: User | null;
  authReady: boolean;
  emailLink: boolean;
  cfp: CfpWindow | null;
  role: CfpRole | null;
  roleReady: boolean;
  roleError: boolean;
  retryRole: () => void;
  platformStatus: PlatformAccessStatus | null;
  platformReady: boolean;
  platformError: boolean;
  retryPlatform: () => void;
  cfpError: boolean;
  retryCfp: () => void;
  refreshCfp: () => Promise<void>;
  initialSchedule?: { releaseId: string; value: PublishedScheduleBundle | null };
  onSessionPageLabelChange: (entryId: string, label: string) => void;
}

/**
 * Only the form is gated on the submission window — reviewing happens after it
 * closes, and an admin needs the window controls precisely when it is shut.
 */
function Routed({
  place,
  user,
  authReady,
  emailLink,
  cfp,
  role,
  roleReady,
  roleError,
  retryRole,
  platformStatus,
  platformReady,
  platformError,
  retryPlatform,
  cfpError,
  retryCfp,
  refreshCfp,
  initialSchedule,
  onSessionPageLabelChange,
}: RoutedProps) {
  const { t } = useI18n();
  const { route, cfpId, tab } = place;

  /*
   * A one-time link names the account that should own this session. Process it
   * even when another account is already signed in; otherwise reviewers and
   * admins who use Google day-to-day silently keep the wrong identity and the
   * code remains stranded in the address bar.
   */
  if (emailLink) {
    const destination: SignInDestination | undefined =
      route === 'admin'
        ? `admin/${tab}`
        : route === 'review'
          ? 'review'
          : route === 'schedule' || route === 'session'
            ? 'schedule'
            : undefined;
    const purpose =
      route === 'admin' || route === 'review' || route === 'schedule' || route === 'session'
        ? 'committee'
        : route === 'new'
          ? 'organising'
          : route === 'form' || route === 'cfp'
            ? 'speaker'
            : 'account';
    return (
      <SignIn
        cfp={cfpId ? cfp : null}
        cfpId={cfpId}
        purpose={purpose}
        destination={destination}
      />
    );
  }

  if (route === 'home') {
    return (
      <HomePage
        user={user}
        platformStatus={platformStatus}
        platformReady={platformReady}
        platformError={platformError}
        retryPlatform={retryPlatform}
      />
    );
  }
  if (route === 'new') {
    if (!user) return <SignIn cfp={null} cfpId={null} purpose="organising" />;
    return <NewCfpPage user={user} />;
  }
  if (
    route === 'platform' ||
    route === 'platformAccess' ||
    route === 'platformLimits' ||
    route === 'platformEmail'
  ) {
    if (!user) return <SignIn cfp={null} cfpId={null} purpose="account" />;
    if (!platformReady) return <p className="muted">{t.app.loading}</p>;
    if (platformError) return <PlatformAccessFailure onRetry={retryPlatform} />;
    if (!platformStatus?.isPlatformAdmin) {
      return (
        <div className="panel platform-access-gate">
          <p>{t.nav.forbidden}</p>
          <div className="platform-access-gate__actions">
            <button type="button" className="btn btn--primary" onClick={retryPlatform}>
              {t.platformAdmin.checkAgain}
            </button>
            <button type="button" className="btn" onClick={() => navigate('home')}>
              {t.platform.back}
            </button>
          </div>
        </div>
      );
    }
    const section = route === 'platformAccess'
      ? 'access'
      : route === 'platformLimits'
        ? 'limits'
        : route === 'platformEmail'
          ? 'email'
          : 'home';
    return <PlatformAdminPage user={user} section={section} />;
  }
  if (route === 'me') {
    return user ? (
      <ProfilePage user={user} />
    ) : (
      <SignIn cfp={null} cfpId={null} purpose="account" />
    );
  }
  if (route === 'orgs') {
    if (!user) return <SignIn cfp={null} cfpId={null} purpose="account" />;
    return <OrgsListPage user={user} />;
  }
  if (route === 'org') {
    return <OrgWorkspacePage orgId={place.orgId || ''} user={user} />;
  }

  // Every route below is inside a CFP, and `currentPlace` will not produce one
  // without an id — but the narrowing has to be written down for the compiler.
  if (!cfpId) {
    return (
      <HomePage
        user={user}
        platformStatus={platformStatus}
        platformReady={platformReady}
        platformError={platformError}
        retryPlatform={retryPlatform}
      />
    );
  }

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
  if (route === 'cfp') {
    return (
      <CfpPage
        cfp={cfp}
        cfpId={cfpId}
        user={user}
        onRoleChanged={retryRole}
      />
    );
  }

  if (route === 'join') {
    const inviteToken =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('invite') ?? undefined
        : undefined;
    return (
      <JoinCommitteePage
        user={user}
        cfp={cfp}
        cfpId={cfpId}
        onRoleChanged={retryRole}
        signInSlot={
          !user ? (
            <SignIn
              cfp={cfp}
              cfpId={cfpId}
              purpose="committee"
              destination="join"
              roleInviteToken={inviteToken}
            />
          ) : undefined
        }
      />
    );
  }

  if (route === 'schedule' || route === 'session') {
    const newerSharedPreview = Boolean(
      cfp.sharedScheduleId && cfp.sharedScheduleId !== cfp.publishedScheduleId,
    );
    return (
      <>
        <SchedulePage
          cfpId={cfpId}
          cfpName={cfp.name}
          releaseId={cfp.publishedScheduleId ?? null}
          sharedReleaseId={cfp.sharedScheduleId ?? null}
          viewerRole={role}
          accessReady={Boolean(
            !newerSharedPreview || (authReady && (!user || roleReady))
          )}
          entryId={place.entryId ?? null}
          onPageLabelChange={onSessionPageLabelChange}
          initialBundle={
            initialSchedule && initialSchedule.releaseId === cfp.publishedScheduleId
              ? initialSchedule.value
              : undefined
          }
        />
        {authReady && !user && newerSharedPreview && (
          <section
            className="schedule-committee-sign-in"
            aria-labelledby="schedule-committee-sign-in-title"
          >
            <h2 id="schedule-committee-sign-in-title">{t.schedule.committeeSignInTitle}</h2>
            <p>{t.schedule.committeeSignInHelp}</p>
            <SignIn
              cfp={cfp}
              cfpId={cfpId}
              purpose="committee"
              destination="schedule"
            />
          </section>
        )}
      </>
    );
  }

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
    const reviewerRecovery = role !== null;
    return (
      <div className="panel">
        <p>{t.nav.forbidden}</p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => navigate(reviewerRecovery ? 'review' : 'cfp', { cfpId })}
        >
          {reviewerRecovery ? t.nav.review : t.nav.cfp}
        </button>
      </div>
    );
  }

  return route === 'admin' ? (
    <AdminPage
      user={user}
      cfpId={cfpId}
      cfpName={cfp.name}
      archived={cfp.state === 'archived'}
      tab={tab}
      role={role!}
      isPlatformAdmin={platformStatus?.isPlatformAdmin === true}
      onCfpChange={() => void refreshCfp()}
    />
  ) : (
    <ReviewPage user={user} cfpId={cfpId} />
  );
}

function PlatformAccessFailure({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="panel">
      <p className="field__error" role="alert">
        {t.platformAdmin.loadError}
      </p>
      <button type="button" className="btn" onClick={onRetry}>
        {t.platformAdmin.retry}
      </button>
    </div>
  );
}

function WindowNotice({ cfp }: { cfp: CfpWindow }) {
  const { t, locale } = useI18n();

  if (cfp.state === 'before') {
    return (
      <div className="panel">
        <p>{t.window.notOpen}</p>
        <p>
          {t.window.opensAt}{' '}
          <strong>
            {formatDate(cfp.opensAt, locale, cfp.profile.timeZone ?? 'America/Toronto')}
          </strong>
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
          {t.window.closedAt}{' '}
          <strong>
            {formatDate(cfp.closesAt, locale, cfp.profile.timeZone ?? 'America/Toronto')}
          </strong>
        </p>
      </div>
    );
  }

  return <div className="panel">{t.window.closed}</div>;
}

function FormRoute({ user, cfp, cfpId }: { user: User | null; cfp: CfpWindow; cfpId: string }) {
  if (!user) {
    return (
      <>
        {cfp.state !== 'open' && <WindowNotice cfp={cfp} />}
        <SignIn cfp={cfp} cfpId={cfpId} />
      </>
    );
  }

  if (cfp.state === 'before') return <WindowNotice cfp={cfp} />;

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
  roleInviteToken,
}: {
  cfp: CfpWindow | null;
  cfpId: string | null;
  purpose?: 'speaker' | 'committee' | 'account' | 'organising';
  destination?: SignInDestination;
  roleInviteToken?: string;
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
      const invite =
        destination === 'submit' ? coSpeakerInviteQuery(window.location.search) : null;
      const proposalId =
        destination === 'submit' && !invite
          ? proposalSelectionQuery(window.location.search)
          : null;
      const roleInvite =
        destination === 'join'
          ? roleInviteToken ??
            (typeof window !== 'undefined'
              ? new URLSearchParams(window.location.search).get('invite') ?? undefined
              : undefined)
          : undefined;
      await requestSignInLink({
        email: email.trim(),
        locale,
        ...(cfpId ? { cfpId, destination } : {}),
        ...(roleInvite ? { roleInviteToken: roleInvite } : {}),
        ...(invite
          ? {
              proposalId: invite.proposalId,
              speakerInvitationId: invite.invitationId,
            }
          : proposalId
            ? { proposalId }
            : {}),
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
            : error?.code === 'functions/failed-precondition' &&
                error?.details?.reason === 'sign_in_email_not_configured'
              ? t.app.linkUnavailable
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
    if (outcome === 'needsEmail') {
      // The address is malformed, so the link itself is still good. Stay here
      // and let them correct what they typed.
      setLinkError(t.app.linkBadEmail);
    } else if (outcome === 'failed') {
      /*
       * Spent, expired, or simply not this address — Firebase reports all three
       * as one code, so the recoverable reading is the one worth offering.
       * Dropping out of `askingWhose` puts "Email me a link" back under the
       * error, which is the control the error tells them to use; without it the
       * button still read "Continue" and there was nothing on screen to press.
       * The address they typed stays in the field, so a new link is one click.
       */
      setAskingWhose(false);
      setLinkError(t.app.linkFailed);
    }
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
          {t.window.closesAt}{' '}
          <strong>
            {formatDate(cfp.closesAt, locale, cfp.profile.timeZone ?? 'America/Toronto')}
          </strong>
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

      <h2 className="card__subtitle">
        {askingWhose ? t.app.linkWhose : t.app.signInEmailTitle}
      </h2>
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
        <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px dashed var(--line)' }}>
          <p style={{ margin: '0 0 0.75rem', fontSize: 'var(--text-xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>
            ⚡ Fast Role Sign-In (Emulator)
          </p>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {[
              { id: 'owner', name: 'Olivia Owner', email: 'owner@example.org', sub: 'usr-owner', badge: '👑 Platform & CFP Owner' },
              { id: 'admin', name: 'Alice Admin', email: 'admin@example.org', sub: 'usr-admin', badge: '🛡️ Event Admin' },
              { id: 'reviewer', name: 'Bob Reviewer', email: 'reviewer@example.org', sub: 'usr-reviewer', badge: '⚖️ Committee Reviewer' },
              { id: 'test-speaker', name: 'Test Speaker', email: 'test.speaker@example.org', sub: 'test-speaker', badge: '🧪 Test Speaker' },
              { id: 'speaker', name: 'Charlie Speaker', email: 'speaker@example.org', sub: 'usr-speaker', badge: '🎤 Demo Speaker' },
              { id: 'manager', name: 'Morgan Manager', email: 'manager@example.org', sub: 'usr-manager', badge: '🏢 Org Team Member' },
            ].map((acc) => (
              <button
                key={acc.id}
                type="button"
                className="btn btn--secondary btn--sm"
                style={{ justifyContent: 'space-between', width: '100%', padding: '0.45rem 0.75rem' }}
                onClick={() => void import('./lib/devAuth').then((m) => m.signInAsTestSpeaker(acc))}
              >
                <span style={{ fontWeight: 650 }}>{acc.badge}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', opacity: 0.8 }}>{acc.email}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
