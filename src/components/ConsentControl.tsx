/**
 * The way back out.
 *
 * A banner with no way to change the answer is not consent, it is a one-time
 * toll — GDPR Art. 7(3) and Law 25 both require withdrawing to be as easy as
 * agreeing, and "clear your browser storage" is not as easy as clicking Allow.
 * So the current answer is stated in the footer, on every page, with one button
 * that reopens the question.
 *
 * It says which way the answer went rather than just offering a link, because
 * somebody who wants to check whether they are being measured should be able to
 * find that out by reading, not by clicking something and seeing what happens.
 */

import { useEffect, useState } from 'react';

import { useI18n } from '../i18n/context';
import { analyticsAvailable } from '../lib/analytics';
import { consent, type Consent } from '../lib/consent';

export function ConsentControl({ onReopen }: { onReopen: () => void }) {
  const { t } = useI18n();
  /*
   * Read after mount, not during render. The answer is in storage, which does
   * not exist on a server — rendered there this reads `unasked` and the control
   * is absent from the HTML, so rendering it during hydration is a mismatch.
   */
  const [answer, setAnswer] = useState<Consent>('unasked');
  useEffect(() => setAnswer(consent()), []);

  // Nothing to say when nothing is measured, and nothing to withdraw while the
  // banner is still on screen asking.
  if (!analyticsAvailable() || answer === 'unasked') return null;

  return (
    <p className="consent__status">
      {answer === 'granted' ? t.consent.stateOn : t.consent.stateOff}{' '}
      <button type="button" className="linkish" onClick={onReopen}>
        {t.consent.change}
      </button>
    </p>
  );
}
