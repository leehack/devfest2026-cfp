import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../i18n/context';
import { adminError } from '../../lib/errors';
import { SubmissionFormEditor } from '../../components/SubmissionFormEditor';
import { loadSubmissionForm } from '../../lib/proposals';
import { useLatest } from '../../lib/useLatest';
import type { SubmissionForm } from '@shared/submissionForm';

/**
 * What the call asks for. Its own tab for the same reason the confirmation form
 * has one: it is set up once before the window opens and then left alone, while
 * the proposals table beside it is worked through every day.
 */
export function Submission({
  cfpId,
  readOnly = false,
  onDirtyChange,
}: {
  cfpId: string;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [form, setForm] = useState<SubmissionForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  /*
   * Keyed on the call, not on the loader's identity. The loader is rebuilt
   * whenever the dictionary changes — and the dictionary changes once on every
   * page load now, because the locale cannot be known until after mount. Running
   * it again would refetch and overwrite whatever is on screen unsaved.
   */
  useEffect(() => {
    const request = ++generation.current;
    setForm(null);
    setLoading(true);
    setError('');
    void loadSubmissionForm(cfpId)
      .then((loaded) => {
        if (request === generation.current) setForm(loaded);
      })
      .catch((e) => {
        if (request === generation.current) setError(adminError(e, tRef.current));
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [attempt, cfpId, tRef]);

  return (
    <section className="section section--form">
      <h2>{t.admin.submission}</h2>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {/* Mounted only once the stored form has arrived, so the editor seeds
          itself from it. Not re-keyed afterwards: it owns the form from then
          on, and remounting would throw away what is being typed. */}
      {loading ? (
        <p className="muted">{t.app.loading}</p>
      ) : form ? (
        <SubmissionFormEditor
          cfpId={cfpId}
          form={form}
          readOnly={readOnly}
          onDirtyChange={onDirtyChange}
        />
      ) : (
        <button type="button" className="btn" onClick={() => setAttempt((current) => current + 1)}>
          {t.errors.reload}
        </button>
      )}
    </section>
  );
}
