import { useCallback, useEffect, useState } from 'react';

import { Checkbox, RadioGroup, TextField } from '../../components/fields';
import { useI18n } from '../../i18n';
import { toDate, toDateTimeInput } from '../../lib/dates';
import { adminError } from '../../lib/errors';
import { archiveCfp, deleteCfp, loadCfp, setCfpWindow, updateCfp } from '../../lib/roles';
import { navigate } from '../../lib/router';
import { Result } from './Result';
import type { CfpRole, Visibility } from '@shared/cfp';
import { CFP_LIMITS } from '@shared/cfp';

export function Settings({ cfpId, role }: { cfpId: string; role: CfpRole }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [archived, setArchived] = useState(false);
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [paused, setPaused] = useState(false);
  const [reviewsVisible, setReviewsVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const cfp = await loadCfp(cfpId);
      if (!cfp) return;
      setName(cfp.name ?? '');
      setVisibility((cfp.visibility ?? 'public') as Visibility);
      setArchived(cfp.archived === true);
      setOpensAt(toDateTimeInput(toDate(cfp.opensAt)));
      setClosesAt(toDateTimeInput(toDate(cfp.closesAt)));
      setPaused(cfp.paused === true);
      setReviewsVisible(cfp.reviewsVisible === true);
    } catch (e) {
      setError(adminError(e, t));
    }
  }, [cfpId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** One `busy`, one `Result`: two saves running at once is not a state to design for. */
  async function run(work: () => Promise<void>, ok: string) {
    setBusy(true);
    setNote('');
    setError('');
    try {
      await work();
      setNote(ok);
      await refresh();
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="section">
        <h2>{t.admin.identity}</h2>
        <p className="muted">{t.admin.identityHelp}</p>

        <TextField
          label={t.admin.identityName}
          value={name}
          onChange={setName}
          required
          maxLength={CFP_LIMITS.nameMax}
          disabled={busy}
        />

        <RadioGroup
          label={t.admin.identityVisibility}
          help={t.platform.visibilityHelp}
          value={visibility}
          onChange={setVisibility}
          required
          disabled={busy}
          options={[
            { value: 'public', label: t.platform.visibilityPublic },
            { value: 'private', label: t.platform.visibilityPrivate },
          ]}
        />

        <p className="field__help">
          {t.admin.identityAddress.replace('{url}', `${location.origin}/#/c/${cfpId}`)}
        </p>

        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !name.trim()}
          onClick={() =>
            run(
              async () => void (await updateCfp({ cfpId, name: name.trim(), visibility })),
              t.admin.identitySaved,
            )
          }
        >
          {t.admin.identitySave}
        </button>
      </section>

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
          onClick={() =>
            run(
              // ISO, so the server stores an instant rather than a wall-clock
              // time in whichever zone the admin happens to be sitting in.
              async () =>
                void (await setCfpWindow({
                  cfpId,
                  opensAt: new Date(opensAt).toISOString(),
                  closesAt: new Date(closesAt).toISOString(),
                  paused,
                  reviewsVisible,
                })),
              t.admin.windowSaved,
            )
          }
        >
          {t.admin.saveWindow}
        </button>
      </section>

      <Lifecycle
        cfpId={cfpId}
        role={role}
        archived={archived}
        busy={busy}
        run={run}
        note={note}
        error={error}
      />
    </>
  );
}

/**
 * Archiving and deleting, both owner-only and kept together at the foot of the
 * page. The callables refuse a non-owner regardless; hiding the controls is so
 * that an admin is not offered a button that will only ever tell them no.
 */
function Lifecycle({
  cfpId,
  role,
  archived,
  busy,
  run,
  note,
  error,
}: {
  cfpId: string;
  role: CfpRole;
  archived: boolean;
  busy: boolean;
  run: (work: () => Promise<void>, ok: string) => Promise<void>;
  note: string;
  error: string;
}) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState('');

  if (role !== 'owner') {
    return (
      <section className="section">
        <Result ok={note} error={error} />
        <p className="muted">{t.admin.ownerOnly}</p>
      </section>
    );
  }

  return (
    <>
      <section className="section">
        <h2>{t.admin.archive}</h2>
        <p className="muted">{t.admin.archiveHelp}</p>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            if (!archived && !window.confirm(t.admin.archiveConfirm)) return;
            void run(
              async () => void (await archiveCfp({ cfpId, archived: !archived })),
              archived ? t.admin.unarchived : t.admin.archived,
            );
          }}
        >
          {archived ? t.admin.unarchiveAction : t.admin.archiveAction}
        </button>
      </section>

      <section className="section">
        <h2>{t.admin.danger}</h2>
        <p className="muted">{t.admin.dangerHelp}</p>
        {!archived ? (
          <p className="field__help">{t.admin.dangerNeedsArchive}</p>
        ) : (
          <>
            <TextField
              label={t.admin.dangerConfirmLabel.replace('{id}', cfpId)}
              value={confirm}
              onChange={setConfirm}
              disabled={busy}
            />
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy || confirm !== cfpId}
              onClick={() => {
                if (!window.confirm(t.admin.dangerConfirm)) return;
                void run(async () => {
                  await deleteCfp({ cfpId, confirm });
                  navigate('home');
                }, t.admin.dangerDeleting);
              }}
            >
              {t.admin.dangerAction}
            </button>
          </>
        )}
      </section>

      <Result ok={note} error={error} />
    </>
  );
}
