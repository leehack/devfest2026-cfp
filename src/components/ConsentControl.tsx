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

import { useI18n } from '../i18n/context';
import { analyticsAvailable } from '../lib/analytics';
import type { Consent } from '../lib/consent';

export function ConsentControl({
  answer,
  open,
  onReopen,
}: {
  answer: Consent;
  open: boolean;
  onReopen: () => void;
}) {
  const { t } = useI18n();

  // Nothing to say when nothing is measured, and nothing to withdraw while the
  // banner is still on screen asking.
  if (!analyticsAvailable() || open || answer === 'unasked') return null;

  return (
    <p className="consent__status">
      {answer === 'granted' ? t.consent.stateOn : t.consent.stateOff}{' '}
      <button type="button" className="linkish" onClick={onReopen}>
        {t.consent.change}
      </button>
    </p>
  );
}
