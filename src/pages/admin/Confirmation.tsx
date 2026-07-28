import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '../../i18n';
import { adminError } from '../../lib/errors';
import { ConfirmFormEditor } from '../../components/ConfirmFormEditor';
import { loadConfirmForm } from '../../lib/proposals';
import type { ConfirmField } from '@shared/confirmForm';

/**
 * What a speaker is asked once they accept. Its own section rather than part of
 * Proposals: it is set up once at the start of a round and then left alone,
 * while the table above it is worked through every day.
 */
export function Confirmation() {
  const { t } = useI18n();
  const [fields, setFields] = useState<ConfirmField[] | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setFields((await loadConfirmForm()).fields);
    } catch (e) {
      setError(adminError(e, t));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="section">
      <h2>{t.admin.form}</h2>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {/* Mounted only once the stored form has arrived, so the editor seeds
          itself from it. Not re-keyed afterwards: it owns the list from then
          on, and remounting would throw away what is being typed. */}
      {fields === null ? <p className="muted">{t.app.loading}</p> : <ConfirmFormEditor fields={fields} />}
    </section>
  );
}
