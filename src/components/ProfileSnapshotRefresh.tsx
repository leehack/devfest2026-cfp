import { useState } from 'react';

import type { SpeakerSnapshot } from '@shared/types';

import { useI18n } from '../i18n/context';
import { refreshProposalSpeakerSnapshot } from '../lib/proposals';

interface RefreshResult {
  changed: boolean;
  snapshot: SpeakerSnapshot;
  scheduleNeedsAttention: boolean;
}

function errorCode(error: unknown): string {
  return String((error as { code?: unknown } | null)?.code ?? '').replace(/^functions\//, '');
}

export function ProfileSnapshotRefresh({
  cfpId,
  proposalId,
  speakerUid,
  speakerName,
  compact = false,
  disabled = false,
  beforeRefresh,
  onRefreshed,
}: {
  cfpId: string;
  proposalId: string;
  speakerUid?: string;
  speakerName?: string;
  compact?: boolean;
  disabled?: boolean;
  beforeRefresh?: () => Promise<boolean>;
  onRefreshed?: (result: RefreshResult) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [scheduleNotice, setScheduleNotice] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setBusy(true);
    setNotice('');
    setScheduleNotice(false);
    setError('');
    try {
      if (beforeRefresh && !(await beforeRefresh())) return;
      const { data } = await refreshProposalSpeakerSnapshot({
        cfpId,
        proposalId,
        ...(speakerUid ? { speakerUid } : {}),
      });
      setNotice(data.changed ? t.profileSnapshot.updated : t.profileSnapshot.unchanged);
      setScheduleNotice(data.scheduleNeedsAttention);
      onRefreshed?.(data);
    } catch (refreshError) {
      const code = errorCode(refreshError);
      setError(
        code === 'unauthenticated'
          ? t.errors.signedOut
          : code === 'permission-denied'
            ? t.nav.forbidden
            : code === 'failed-precondition'
              ? t.profileSnapshot.notReady
              : t.profileSnapshot.failed,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`profile-snapshot-refresh${compact ? ' profile-snapshot-refresh--compact' : ''}`}>
      {!compact && (
        <div className="profile-snapshot-refresh__copy">
          <h3>{t.profileSnapshot.title}</h3>
          <p>{t.profileSnapshot.help}</p>
        </div>
      )}
      <button
        type="button"
        className="btn btn--ghost btn--small"
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={() => void refresh()}
      >
        {busy
          ? t.profileSnapshot.updating
          : speakerUid
            ? t.profileSnapshot.updateSpeaker(speakerName || speakerUid)
            : t.profileSnapshot.updateSelf}
      </button>
      <div className="profile-snapshot-refresh__status" aria-live="polite">
        {notice && <span>{notice}</span>}
        {scheduleNotice && <span>{t.profileSnapshot.scheduleNotice}</span>}
        {error && (
          <span className="field__error" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
