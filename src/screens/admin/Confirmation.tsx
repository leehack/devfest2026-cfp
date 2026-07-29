import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '../../i18n/context';
import { adminError } from '../../lib/errors';
import { ConfirmFormEditor } from '../../components/ConfirmFormEditor';
import { loadConfirmForm } from '../../lib/proposals';
import type { ConfirmField } from '@shared/confirmForm';

/**
 * What a speaker is asked once they accept. Its own section rather than part of
 * Proposals: it is set up once at the start of a round and then left alone,
 * while the table above it is worked through every day.
 */
export function Confirmation({ cfpId }: { cfpId: string }) {
  const { t } = useI18n();
  const [fields, setFields] = useState<ConfirmField[] | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setFields((await loadConfirmForm(cfpId)).fields);
    } catch (e) {
      setError(adminError(e, t));
    }
  }, [cfpId, t]);

  /*
   * Keyed on the call, not on the loader's identity. The loader is rebuilt
   * whenever the dictionary changes — and the dictionary changes once on every
   * page load now, because the locale cannot be known until after mount. Running
   * it again would refetch and overwrite whatever is on screen unsaved.
   */
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfpId]);

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
      {fields === null ? <p className="muted">{t.app.loading}</p> : <ConfirmFormEditor cfpId={cfpId} fields={fields} />}
    </section>
  );
}
