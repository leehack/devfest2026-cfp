import { useCallback, useEffect, useState } from 'react';

import { Checkbox, TextField } from '../../components/fields';
import { useI18n } from '../../i18n';
import { toDate, toDateTimeInput } from '../../lib/dates';
import { adminError } from '../../lib/errors';
import { loadCfpConfig, setCfpWindow } from '../../lib/roles';
import { Result } from './Result';

export function Settings() {
  const { t } = useI18n();
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [paused, setPaused] = useState(false);
  const [reviewsVisible, setReviewsVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const config = await loadCfpConfig();
      if (!config) return;
      setOpensAt(toDateTimeInput(toDate(config.opensAt)));
      setClosesAt(toDateTimeInput(toDate(config.closesAt)));
      setPaused(config.paused === true);
      setReviewsVisible(config.reviewsVisible === true);
    } catch (e) {
      setError(adminError(e, t));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save() {
    setBusy(true);
    setNote('');
    setError('');
    try {
      // ISO, so the server stores an instant rather than a wall-clock time in
      // whichever zone the admin happens to be sitting in.
      await setCfpWindow({
        opensAt: new Date(opensAt).toISOString(),
        closesAt: new Date(closesAt).toISOString(),
        paused,
        reviewsVisible,
      });
      setNote(t.admin.windowSaved);
      await refresh();
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h2>{t.admin.window}</h2>

      <div className="grid grid--2">
        <TextField
          label={t.admin.opensAtLabel}
          type="datetime-local"
          value={opensAt}
          onChange={setOpensAt}
          required
          disabled={busy}
        />
        <TextField
          label={t.admin.closesAtLabel}
          type="datetime-local"
          value={closesAt}
          onChange={setClosesAt}
          required
          disabled={busy}
        />
      </div>

      <Checkbox label={t.admin.pausedLabel} checked={paused} onChange={setPaused} disabled={busy} />
      <p className="field__help">{t.admin.pausedHelp}</p>

      <Checkbox
        label={t.admin.reviewsVisibleLabel}
        checked={reviewsVisible}
        onChange={setReviewsVisible}
        disabled={busy}
      />
      <p className="field__help">{t.admin.reviewsVisibleHelp}</p>

      <button
        type="button"
        className="btn btn--primary"
        disabled={busy || !opensAt || !closesAt}
        onClick={save}
      >
        {t.admin.saveWindow}
      </button>

      <Result ok={note} error={error} />
    </section>
  );
}
