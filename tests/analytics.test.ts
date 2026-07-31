import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const analytics = { kind: 'analytics' };
  return {
    allowed: false,
    analytics,
    app: { name: 'test-app' },
    initializeAnalytics: vi.fn(() => analytics),
    isSupported: vi.fn<() => Promise<boolean>>(),
    logEvent: vi.fn(),
    setAnalyticsCollectionEnabled: vi.fn(),
  };
});

vi.mock('../src/firebase', () => ({ app: mocks.app }));
vi.mock('../src/lib/consent', () => ({ granted: () => mocks.allowed }));
vi.mock('../src/lib/env', () => ({ MEASUREMENT_ID: 'G-ANALYTICS-TEST' }));
vi.mock('firebase/analytics', () => ({
  initializeAnalytics: mocks.initializeAnalytics,
  isSupported: mocks.isSupported,
  logEvent: mocks.logEvent,
  setAnalyticsCollectionEnabled: mocks.setAnalyticsCollectionEnabled,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function loadAnalytics() {
  return import('../src/lib/analytics');
}

beforeEach(() => {
  vi.resetModules();
  mocks.allowed = false;
  mocks.initializeAnalytics.mockClear();
  mocks.isSupported.mockReset().mockResolvedValue(true);
  mocks.logEvent.mockClear();
  mocks.setAnalyticsCollectionEnabled.mockClear();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://cfp.gdgmontreal.com' } },
    writable: true,
  });
});

describe('analytics startup', () => {
  it('initialises without Firebase automatic page views', async () => {
    mocks.allowed = true;
    const { applyConsent } = await loadAnalytics();

    applyConsent();

    await vi.waitFor(() =>
      expect(mocks.initializeAnalytics).toHaveBeenCalledWith(mocks.app, {
        config: { send_page_view: false },
      }),
    );
    expect(mocks.setAnalyticsCollectionEnabled).toHaveBeenCalledWith(mocks.analytics, true);
  });

  it('does not initialise when consent is withdrawn while support detection is pending', async () => {
    const support = deferred<boolean>();
    mocks.isSupported.mockImplementationOnce(() => support.promise).mockResolvedValue(true);
    mocks.allowed = true;
    const { applyConsent } = await loadAnalytics();

    applyConsent();
    await vi.waitFor(() => expect(mocks.isSupported).toHaveBeenCalledTimes(1));
    mocks.allowed = false;
    support.resolve(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(mocks.initializeAnalytics).not.toHaveBeenCalled();

    // The cancelled attempt must not leave a settled `starting` promise behind.
    mocks.allowed = true;
    applyConsent();
    await vi.waitFor(() => expect(mocks.isSupported).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(mocks.initializeAnalytics).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(mocks.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith(mocks.analytics, true),
    );
  });

  it('re-enables the existing instance when consent is granted again', async () => {
    mocks.allowed = true;
    const { applyConsent } = await loadAnalytics();

    applyConsent();
    await vi.waitFor(() =>
      expect(mocks.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith(mocks.analytics, true),
    );

    mocks.allowed = false;
    applyConsent();
    await vi.waitFor(() =>
      expect(mocks.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith(mocks.analytics, false),
    );

    mocks.allowed = true;
    applyConsent();
    await vi.waitFor(() =>
      expect(mocks.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith(mocks.analytics, true),
    );

    expect(mocks.initializeAnalytics).toHaveBeenCalledTimes(1);
    expect(mocks.setAnalyticsCollectionEnabled.mock.calls.map(([, enabled]) => enabled)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('retries after a transient startup failure', async () => {
    mocks.isSupported.mockRejectedValueOnce(new Error('blocked')).mockResolvedValue(true);
    mocks.allowed = true;
    const { applyConsent } = await loadAnalytics();

    applyConsent();
    await vi.waitFor(() => expect(mocks.isSupported).toHaveBeenCalledTimes(1));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(mocks.initializeAnalytics).not.toHaveBeenCalled();

    applyConsent();
    await vi.waitFor(() => expect(mocks.initializeAnalytics).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(mocks.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith(mocks.analytics, true),
    );
    expect(mocks.isSupported).toHaveBeenCalledTimes(2);
  });
});

describe('analytics events', () => {
  it('uses an absolute shaped page location without the slug, query or fragment', async () => {
    mocks.allowed = true;
    const { trackPageView } = await loadAnalytics();

    trackPageView(
      '/c/devfest-mtl-2026/submit?mode=signIn&oobCode=bearer-secret#confirmation',
      'devfest-mtl-2026',
    );

    await vi.waitFor(() => expect(mocks.logEvent).toHaveBeenCalledTimes(1));
    expect(mocks.logEvent).toHaveBeenCalledWith(mocks.analytics, 'page_view', {
      page_location: 'https://cfp.gdgmontreal.com/c/{cfpId}/submit',
      cfp_id: 'devfest-mtl-2026',
    });
    const pageLocation = mocks.logEvent.mock.calls[0][2].page_location;
    expect(pageLocation).not.toContain('devfest-mtl-2026');
    expect(pageLocation).not.toContain('?');
    expect(pageLocation).not.toContain('#');
    expect(pageLocation).not.toContain('bearer-secret');
  });

  it('drops an event when consent is withdrawn before the SDK import resolves', async () => {
    const support = deferred<boolean>();
    mocks.isSupported.mockImplementationOnce(() => support.promise);
    mocks.allowed = true;
    const { track } = await loadAnalytics();

    track('proposal_submitted', { category: 'web' });
    await vi.waitFor(() => expect(mocks.isSupported).toHaveBeenCalledTimes(1));
    mocks.allowed = false;
    support.resolve(true);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(mocks.initializeAnalytics).not.toHaveBeenCalled();
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });
});
