import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '../../i18n/context';
import { adminError } from '../../lib/errors';
import { SubmissionFormEditor } from '../../components/SubmissionFormEditor';
import { loadSubmissionForm } from '../../lib/proposals';
import type { SubmissionForm } from '@shared/submissionForm';

/**
 * What the call asks for. Its own tab for the same reason the confirmation form
 * has one: it is set up once before the window opens and then left alone, while
 * the proposals table beside it is worked through every day.
 */
export function Submission({ cfpId }: { cfpId: string }) {
  const { t } = useI18n();
  const [form, setForm] = useState<SubmissionForm | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setForm(await loadSubmissionForm(cfpId));
    } catch (e) {
      setError(adminError(e, t));
    }
  }, [cfpId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="section">
      <h2>{t.admin.submission}</h2>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {/* Mounted only once the stored form has arrived, so the editor seeds
          itself from it. Not re-keyed afterwards: it owns the form from then
          on, and remounting would throw away what is being typed. */}
      {form === null ? (
        <p className="muted">{t.app.loading}</p>
      ) : (
        <SubmissionFormEditor cfpId={cfpId} form={form} />
      )}
    </section>
  );
}
