import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { useI18n } from '../i18n/context';
import { roleInviteError } from '../lib/errors';
import { goTo } from '../lib/router';
import { paths } from '../lib/paths';
import {
  claimRoleInviteLink,
  getRoleInviteLinkInfo,
  useRole,
} from '../lib/roles';
import type { RoleInviteLinkPublicInfo } from '@shared/types';
import type { CfpRole } from '@shared/cfp';
import type { CfpWindow } from '../lib/proposals';

const SIGN_IN_RETURN_PATH = 'cfp.signInReturnPath';

function getInviteToken(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('invite') ?? params.get('token') ?? '';
  if (fromQuery) return fromQuery;
  const parts = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if ((parts[2] === 'invite' || parts[2] === 'join') && parts[3]) {
    return decodeURIComponent(parts[3]);
  }
  return '';
}

export function JoinCommitteePage({
  user,
  cfp,
  cfpId,
  onRoleChanged,
  signInSlot,
}: {
  user: User | null;
  cfp: CfpWindow | null;
  cfpId: string;
  onRoleChanged?: () => void;
  signInSlot?: React.ReactNode;
}) {
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const token = getInviteToken();
  const userRoleState = useRole(user, cfpId);
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<RoleInviteLinkPublicInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinedRole, setJoinedRole] = useState<CfpRole | null>(null);
  const [fetchAttempt, setFetchAttempt] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (user) {
        window.sessionStorage.removeItem(SIGN_IN_RETURN_PATH);
      } else {
        window.sessionStorage.setItem(
          SIGN_IN_RETURN_PATH,
          window.location.pathname + window.location.search,
        );
      }
    }
  }, [user]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getRoleInviteLinkInfo({ cfpId, token })
      .then(({ data }) => {
        if (!cancelled) {
          setInfo(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(roleInviteError(err, tRef.current));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cfpId, token, fetchAttempt]);

  async function acceptInvite() {
    if (!user || !token) return;
    setJoining(true);
    setActionError(null);
    try {
      const { data } = await claimRoleInviteLink({ cfpId, token });
      setJoinedRole(data.role);
      onRoleChanged?.();
      setTimeout(() => {
        if (data.role === 'admin' || data.role === 'owner') {
          goTo(paths.admin(cfpId));
        } else {
          goTo(paths.review(cfpId));
        }
      }, 1000);
    } catch (err) {
      setActionError(roleInviteError(err, t));
      setJoining(false);
    }
  }

  const roleName = info ? t.enums.role[info.role] ?? info.role : '';
  const eventName = cfp?.name ?? cfpId;
  const currentRole = userRoleState.role;
  const isAlreadyRole =
    currentRole &&
    info &&
    (currentRole === info.role || currentRole === 'owner' || (currentRole === 'admin' && info.role === 'reviewer'));

  if (loading) {
    return (
      <main className="container" style={{ padding: '3rem 1rem', maxWidth: '36rem' }}>
        <p className="muted">{t.app.loading}</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="container" style={{ padding: '3rem 1rem', maxWidth: '36rem' }}>
        <div className="panel" style={{ textAlign: 'center', padding: '2rem' }}>
          <h2 style={{ marginBottom: '0.75rem' }}>{t.errors.unavailable}</h2>
          <p className="muted" style={{ marginBottom: '1.5rem' }}>{loadError}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setFetchAttempt((prev) => prev + 1)}
          >
            {t.errors.reload}
          </button>
        </div>
      </main>
    );
  }

  if (!token || !info || !info.isValid) {
    let errorTitle = t.join.invalidTitle;
    let errorHelp = t.join.invalidHelp;
    if (info?.isRevoked) {
      errorTitle = t.join.revokedTitle;
      errorHelp = t.join.revokedHelp;
    } else if (info?.isExpired) {
      errorTitle = t.join.expiredTitle;
      errorHelp = t.join.expiredHelp;
    } else if (info?.isExhausted) {
      errorTitle = t.join.exhaustedTitle;
      errorHelp = t.join.exhaustedHelp;
    }

    return (
      <main className="container" style={{ padding: '3rem 1rem', maxWidth: '36rem' }}>
        <div className="panel" style={{ textAlign: 'center', padding: '2rem' }}>
          <h2 style={{ marginBottom: '0.75rem' }}>{errorTitle}</h2>
          <p className="muted" style={{ marginBottom: '1.5rem' }}>{errorHelp}</p>
          <a href={paths.cfp(cfpId)} className="btn btn--primary">
            {cfp?.name ?? t.app.title}
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ padding: '3rem 1rem', maxWidth: '36rem' }}>
      <div className="panel" style={{ padding: '2rem' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>
          {t.join.heading(eventName, roleName)}
        </h2>
        <p className="muted" style={{ marginBottom: '1.5rem' }}>
          {t.join.invitedNotice(roleName)}
        </p>

        {info.label && (
          <p style={{ marginBottom: '1.5rem', fontStyle: 'italic', color: 'var(--muted)' }}>
            “{info.label}”
          </p>
        )}

        {actionError && (
          <div className="alert alert--danger" role="alert" style={{ marginBottom: '1.5rem' }}>
            {actionError}
          </div>
        )}

        {joinedRole ? (
          <div>
            <div className="alert alert--success" style={{ marginBottom: '1.5rem' }}>
              {t.join.successToast(t.enums.role[joinedRole] ?? joinedRole)}
            </div>
            <a
              href={joinedRole === 'admin' || joinedRole === 'owner' ? paths.admin(cfpId) : paths.review(cfpId)}
              className="btn btn--primary"
            >
              {joinedRole === 'admin' || joinedRole === 'owner' ? t.join.goToAdmin : t.join.goToReview}
            </a>
          </div>
        ) : isAlreadyRole ? (
          <div>
            <p className="muted" style={{ marginBottom: '1.5rem' }}>
              {t.join.alreadyMember(t.enums.role[currentRole] ?? currentRole)}
            </p>
            <a
              href={currentRole === 'admin' || currentRole === 'owner' ? paths.admin(cfpId) : paths.review(cfpId)}
              className="btn btn--primary"
            >
              {currentRole === 'admin' || currentRole === 'owner' ? t.join.goToAdmin : t.join.goToReview}
            </a>
          </div>
        ) : !user ? (
          <div>
            <p style={{ marginBottom: '1.5rem' }}>
              {t.join.signInPrompt(eventName, roleName)}
            </p>
            {signInSlot ? (
              signInSlot
            ) : (
              <a
                href={`/?redirect=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname + window.location.search : '')}`}
                className="btn btn--primary"
              >
                {t.app.signIn}
              </a>
            )}
          </div>
        ) : (
          <div>
            <button
              type="button"
              className="btn btn--primary"
              disabled={joining}
              onClick={() => void acceptInvite()}
            >
              {joining ? t.join.joining : t.join.acceptButton(roleName)}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
