import type { Metadata } from 'next';

import { legacyHashScript } from '@shared/legacyHash';
import '../styles.css';

/**
 * The shell. Generic on purpose: one deploy serves every call for proposals on
 * it, so the per-CFP title and description come from each route's own
 * `generateMetadata` rather than from here.
 */
export const metadata: Metadata = {
  title: 'Call for Proposals',
  description: 'Submit a talk proposal. Soumettez une proposition de conférence.',
};

export const viewport = { width: 'device-width', initialScale: 1 };

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
        {/* Before anything renders. See shared/legacyHash.ts. */}
        <script dangerouslySetInnerHTML={{ __html: legacyHashScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
