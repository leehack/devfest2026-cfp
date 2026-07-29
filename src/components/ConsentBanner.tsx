/**
 * The measurement question, asked once.
 *
 * Law 25 requires that refusing be as easy as agreeing, so the two buttons are
 * the same size, the same weight and side by side. There is no "manage
 * preferences" behind which "no" hides, and no styling that makes one look like
 * the default — a banner where the decline button is grey and small is a banner
 * designed to be misread, and it would not survive being looked at.
 *
 * It renders nothing at all when analytics is not configured. Asking a question
 * whose answer changes nothing is worse than not asking.
 */

import { useI18n } from '../i18n';
import { analyticsAvailable, applyConsent } from '../lib/analytics';
import { setConsent } from '../lib/consent';

export function ConsentBanner({ open, onAnswered }: { open: boolean; onAnswered: () => void }) {
  const { t } = useI18n();

  if (!open || !analyticsAvailable()) return null;

  function answer(choice: 'granted' | 'denied') {
    setConsent(choice);
    applyConsent();
    onAnswered();
  }

  return (
    // `role="region"` rather than `dialog`: it does not trap focus and it does
    // not block the page. Somebody who came here to write a proposal should be
    // able to get on with it and answer this whenever.
    <aside className="consent" role="region" aria-label={t.consent.title}>
      <div className="consent__inner">
        <p className="consent__text">
          <strong>{t.consent.title}</strong> {t.consent.body}
        </p>
        <div className="consent__actions">
          <button type="button" className="btn" onClick={() => answer('denied')}>
            {t.consent.decline}
          </button>
          <button type="button" className="btn" onClick={() => answer('granted')}>
            {t.consent.accept}
          </button>
        </div>
      </div>
    </aside>
  );
}
