import type { Metadata, Viewport } from 'next';

import { legacyHashScript } from '@shared/legacyHash';
import { themeBootstrapScript } from '../lib/theme';
import { SITE_ORIGIN } from '../server/site';
import '../styles.css';

/**
 * The shell. Generic on purpose: one deploy serves every call for proposals on
 * it, so the per-CFP title and description come from each route's own
 * `generateMetadata` rather than from here.
 *
 * `metadataBase` is the exception, and it is not cosmetic. Next emits a relative
 * `canonical` or `og:url` verbatim when it has no origin to resolve against, and
 * Open Graph requires an absolute URL — so `og:url` of `/c/devfest-mtl-2026` is
 * one an unfurler cannot follow. That defeats the reason this render moved to a
 * server at all. Set once here; every route inherits it.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: 'Call for Proposals',
  description: 'Submit a talk proposal. Soumettez une proposition de conférence.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * `lang` is stamped here as `en` and corrected on the client once the locale
     * is known, so the two disagree for one paint — hence
     * `suppressHydrationWarning`. Reading the real locale here would mean a
     * cookie, and a cookie read in the root layout makes every route
     * per-request; it would also buy nothing for a crawler, which sends no
     * cookies.
     */
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta id="cfp-theme-color" name="theme-color" content="#f8f9fb" />
        {/* Apply an explicit choice before paint; an effect would flash the OS theme. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript() }} />
        {/* Before anything renders. See shared/legacyHash.ts. */}
        <script dangerouslySetInnerHTML={{ __html: legacyHashScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
