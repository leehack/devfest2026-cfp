import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { SelectField, TextField } from '../../components/fields';
import { useI18n } from '../../i18n/context';
import { adminError, roleAdminError, transferError } from '../../lib/errors';
import {
  acceptEventOwnershipTransfer,
  cancelEventOwnershipTransfer,
  createRoleInviteLink,
  getEventOwnershipTransfer,
  grantRole,
  initiateEventOwnershipTransfer,
  loadCommittee,
  revokeRole,
  revokeRoleInviteLink,
  type Person,
} from '../../lib/roles';
import { useLatest } from '../../lib/useLatest';
import { GRANTABLE_ROLES, type GrantableRole } from '@shared/cfp';
import type { OwnershipTransfer, RoleGrant, RoleInviteLink } from '@shared/types';
import { Result } from './Result';

/**
 * The role, as a control rather than as a word.
 *
 * Bare rather than a `SelectField`: inside a list row the label and the
 * Required chip are noise, and the column heading is the row itself. The
 * accessible name comes from `aria-label` instead.
 */
function RoleSelect({
  who,
  value,
  onChange,
  disabled,
  options = GRANTABLE_ROLES,
}: {
  who: string;
  value: GrantableRole;
  onChange: (next: GrantableRole) => void;
  disabled: boolean;
  options?: readonly GrantableRole[];
}) {
  const { t } = useI18n();
  return (
    <select
      className="people__role"
      value={value}
      aria-label={t.admin.roleFor(who)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as GrantableRole)}
    >
      {options.map((r) => (
        <option key={r} value={r}>
          {t.enums.role[r]}
        </option>
      ))}
    </select>
  );
}

export function Committee({
  user,
  cfpId,
  readOnly = false,
}: {
  user: User;
  cfpId: string;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [people, setPeople] = useState<Person[]>([]);
  const [pending, setPending] = useState<RoleGrant[]>([]);
  const [inviteLinks, setInviteLinks] = useState<RoleInviteLink[]>([]);
  const [pendingTransfer, setPendingTransfer] = useState<OwnershipTransfer | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<GrantableRole>('reviewer');
  const [linkRole, setLinkRole] = useState<GrantableRole>('reviewer');
  const [linkLabel, setLinkLabel] = useState('');
  const [linkMaxClaims, setLinkMaxClaims] = useState('');
  const [linkExpiryOption, setLinkExpiryOption] = useState<'never' | '7d' | '14d' | '30d' | 'custom'>('7d');
  const [linkCustomDate, setLinkCustomDate] = useState('');
  const [creatingLink, setCreatingLink] = useState(false);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [transferEmail, setTransferEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loadedCfp, setLoadedCfp] = useState('');
  const activeCfp = useRef(cfpId);
  const generation = useRef(0);
  activeCfp.current = cfpId;

  const isOwner = people.some((p) => p.uid === user.uid && p.role === 'owner');
  const isTransferTarget =
    pendingTransfer &&
    ((user.email &&
      pendingTransfer.targetEmail.toLowerCase() === user.email.toLowerCase()) ||
      pendingTransfer.targetUid === user.uid);

  const refresh = useCallback(async (reportError = true, force = false) => {
    const scope = cfpId;
    const request = ++generation.current;
    const current = () =>
      activeCfp.current === scope && generation.current === request;
    try {
      const [committee, transferRes] = await Promise.all([
        loadCommittee(cfpId, { force }),
        getEventOwnershipTransfer({ cfpId }).catch(() => ({ data: { ok: true, transfer: null } })),
      ]);
      if (!current()) return false;
      setPeople(committee.people);
      setPending(committee.pending);
      setInviteLinks(committee.inviteLinks ?? []);
      setPendingTransfer(transferRes.data.transfer ?? null);
      setLoadedCfp(scope);
      setLoadFailed(false);
      if (reportError) setError('');
      return true;
    } catch (e) {
      if (!current()) return false;
      if (reportError) setError(adminError(e, tRef.current));
      setLoadFailed(true);
      return false;
    }
  }, [cfpId, tRef]);

  const reload = useCallback(async () => {
    const scope = cfpId;
    setLoading(true);
    setError('');
    try {
      await refresh(true);
    } finally {
      if (activeCfp.current === scope) setLoading(false);
    }
  }, [cfpId, refresh]);

  /*
   * Keyed on the call, not on the loader's identity. The loader is rebuilt
   * whenever the dictionary changes — and the dictionary changes once on every
   * page load now, because the locale cannot be known until after mount. Running
   * it again would refetch and overwrite whatever is on screen unsaved.
   */
  useEffect(() => {
    generation.current += 1;
    setPeople([]);
    setPending([]);
    setInviteLinks([]);
    setPendingTransfer(null);
    setEmail('');
    setLinkLabel('');
    setLinkMaxClaims('');
    setLinkExpiryOption('7d');
    setLinkCustomDate('');
    setCreatingLink(false);
    setCopiedLinkId(null);
    setTransferEmail('');
    setRole('reviewer');
    setLinkRole('reviewer');
    setLoadedCfp('');
    setLoadFailed(false);
    setBusy(false);
    setTransferring(false);
    setNote('');
    setError('');
    void reload();
  }, [cfpId, reload]);

  async function invite() {
    if (readOnly) return;
    const scope = cfpId;
    setBusy(true);
    setNote('');
    setError('');
    try {
      const { data } = await grantRole({ cfpId, email, role });
      if (activeCfp.current !== scope) return;
      setNote(
        data.applied
          ? tRef.current.admin.granted(data.email)
          : tRef.current.admin.invited(data.email),
      );
      setEmail('');
      await refresh(false, true);
    } catch (e) {
      if (activeCfp.current === scope) setError(roleAdminError(e, tRef.current));
    } finally {
      if (activeCfp.current === scope) setBusy(false);
    }
  }

  /**
   * Re-roling is the same call as inviting — `grant` merges onto the member
   * document. The server refuses the two changes that would break the CFP
   * (touching the owner, demoting the last admin); this only declines to offer
   * the first of them.
   */
  async function changeRole(target: string, next: GrantableRole) {
    if (busy || readOnly) return;
    const scope = cfpId;
    setBusy(true);
    setNote('');
    setError('');
    try {
      const { data } = await grantRole({ cfpId, email: target, role: next });
      if (activeCfp.current !== scope) return;
      setNote(
        data.applied
          ? tRef.current.admin.granted(data.email)
          : tRef.current.admin.invited(data.email),
      );
    } catch (e) {
      if (activeCfp.current === scope) setError(roleAdminError(e, tRef.current));
    } finally {
      // Refresh either way: on failure this is what puts the select back to the
      // role the server actually still holds.
      if (activeCfp.current === scope) {
        await refresh(false, true);
        if (activeCfp.current === scope) setBusy(false);
      }
    }
  }

  async function remove(target: string) {
    if (busy || readOnly) return;
    if (!window.confirm(t.admin.revokeConfirm(target))) return;
    const scope = cfpId;
    setBusy(true);
    setNote('');
    setError('');
    try {
      await revokeRole({ cfpId, email: target });
      if (activeCfp.current !== scope) return;
      setNote(tRef.current.admin.revoked(target));
      await refresh(false, true);
    } catch (e) {
      if (activeCfp.current === scope) setError(roleAdminError(e, tRef.current));
    } finally {
      if (activeCfp.current === scope) setBusy(false);
    }
  }

  async function initiateTransfer() {
    const target = transferEmail.trim();
    if (!window.confirm(t.transfer.confirmPrompt)) return;
    setTransferring(true);
    setNote('');
    setError('');
    try {
      await initiateEventOwnershipTransfer({ cfpId, email: target });
      setNote(tRef.current.transfer.pendingBanner(target));
      setTransferEmail('');
      await refresh(false, true);
    } catch (e) {
      setError(transferError(e, tRef.current));
    } finally {
      setTransferring(false);
    }
  }

  async function cancelTransfer() {
    setTransferring(true);
    setNote('');
    setError('');
    try {
      await cancelEventOwnershipTransfer({ cfpId });
      setNote(tRef.current.transfer.cancelled);
      await refresh(false, true);
    } catch (e) {
      setError(transferError(e, tRef.current));
    } finally {
      setTransferring(false);
    }
  }

  async function acceptTransfer() {
    setTransferring(true);
    setNote('');
    setError('');
    try {
      await acceptEventOwnershipTransfer({ cfpId });
      setNote(tRef.current.transfer.transferred);
      await refresh(false, true);
    } catch (e) {
      setError(transferError(e, tRef.current));
    } finally {
      setTransferring(false);
    }
  }

  async function generateInviteLink() {
    if (readOnly) return;
    const scope = cfpId;
    setCreatingLink(true);
    setError('');
    setNote('');
    try {
      let expiresAt: string | null = null;
      const now = Date.now();
      if (linkExpiryOption === '7d') {
        expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (linkExpiryOption === '14d') {
        expiresAt = new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString();
      } else if (linkExpiryOption === '30d') {
        expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
      } else if (linkExpiryOption === 'custom' && linkCustomDate.trim()) {
        const [year, month, day] = linkCustomDate.trim().split('-').map(Number);
        const dateObj = new Date(year, month - 1, day, 23, 59, 59, 999);
        expiresAt = dateObj.toISOString();
      }

      const parsedMaxClaims = linkMaxClaims.trim() ? Number(linkMaxClaims.trim()) : null;

      const { data } = await createRoleInviteLink({
        cfpId,
        role: linkRole,
        label: linkLabel.trim() || undefined,
        maxClaims: parsedMaxClaims,
        expiresAt,
      });
      if (activeCfp.current !== scope) return;
      setNote(tRef.current.admin.inviteLinkGenerated);
      setLinkLabel('');
      setLinkMaxClaims('');
      setLinkExpiryOption('7d');
      setLinkCustomDate('');

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        const fullUrl = `${window.location.origin}/c/${cfpId}/join?invite=${data.link.id}`;
        void navigator.clipboard.writeText(fullUrl).then(() => {
          setCopiedLinkId(data.link.id);
          setTimeout(() => setCopiedLinkId(null), 3000);
        }).catch(() => {});
      }

      await refresh(false, true);
    } catch (e) {
      if (activeCfp.current === scope) setError(roleAdminError(e, tRef.current));
    } finally {
      if (activeCfp.current === scope) setCreatingLink(false);
    }
  }

  async function revokeLink(token: string) {
    if (readOnly) return;
    if (!window.confirm(t.admin.inviteLinkRevokeConfirm)) return;
    const scope = cfpId;
    setBusy(true);
    setError('');
    setNote('');
    try {
      await revokeRoleInviteLink({ cfpId, token });
      if (activeCfp.current !== scope) return;
      setNote(tRef.current.admin.inviteLinkRevoked);
      await refresh(false, true);
    } catch (e) {
      if (activeCfp.current === scope) setError(roleAdminError(e, tRef.current));
    } finally {
      if (activeCfp.current === scope) setBusy(false);
    }
  }

  function copyLinkUrl(token: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      const fullUrl = `${window.location.origin}/c/${cfpId}/join?invite=${token}`;
      void navigator.clipboard.writeText(fullUrl).then(() => {
        setCopiedLinkId(token);
        setTimeout(() => setCopiedLinkId(null), 3000);
      }).catch(() => {});
    }
  }

  function getLinkStatus(link: RoleInviteLink): 'revoked' | 'expired' | 'exhausted' | 'active' {
    if (link.revokedAt) return 'revoked';
    const raw = link.expiresAt as any;
    const expiresAt =
      typeof raw?.toMillis === 'function'
        ? raw.toMillis()
        : typeof raw?.seconds === 'number'
          ? raw.seconds * 1000
          : typeof raw === 'string' || typeof raw === 'number'
            ? new Date(raw).getTime()
            : null;
    if (expiresAt && expiresAt <= Date.now()) return 'expired';
    if (link.maxClaims !== null && link.claimedCount >= link.maxClaims) return 'exhausted';
    return 'active';
  }

  function formatExpiryDate(raw: unknown): string | null {
    if (!raw) return null;
    const time =
      typeof (raw as any)?.toMillis === 'function'
        ? (raw as any).toMillis()
        : typeof (raw as any)?.seconds === 'number'
          ? (raw as any).seconds * 1000
          : typeof raw === 'string' || typeof raw === 'number'
            ? new Date(raw).getTime()
            : null;
    if (!time || isNaN(time)) return null;
    return new Date(time).toLocaleDateString();
  }

  return (
    <section className="section">
      {isTransferTarget && (
        <section
          className="section section--highlight"
          style={{ marginBottom: '1.5rem', padding: '1.5rem', border: '1.5px solid var(--accent)' }}
        >
          <h3>{t.transfer.acceptTitle}</h3>
          <p>{t.transfer.acceptBanner(t.enums.role.owner)}</p>
          <button
            type="button"
            className="btn btn--primary"
            disabled={transferring}
            onClick={() => void acceptTransfer()}
          >
            {transferring ? t.transfer.accepting : t.transfer.acceptButton}
          </button>
        </section>
      )}

      <h2>{t.admin.people}</h2>
      <p className="section__help">{t.admin.peopleHelp}</p>

      {loading || (loadedCfp !== cfpId && !loadFailed) ? (
        <p className="muted">{t.app.loading}</p>
      ) : loadFailed && people.length === 0 && pending.length === 0 ? (
        <button type="button" className="btn" onClick={() => void reload()}>
          {t.errors.reload}
        </button>
      ) : people.length === 0 &&
        pending.length === 0 ? (
        <p className="muted">{t.admin.noPeople}</p>
      ) : (
        <ul className="people">
          {people.map((person) => {
            const isSelf = person.uid === user.uid;
            const canEditPerson = isOwner && person.role !== 'owner';
            const canAdminEditPerson = !isOwner && person.role === 'reviewer';
            return (
              <li key={person.uid} className="people__row">
                <span>
                  <strong>{person.name ?? person.email}</strong>
                  {isSelf && <span className="people__meta">{t.admin.isYou}</span>}
                </span>
                {person.role === 'owner' ? (
                  <span className="people__meta people__meta--plain">{t.enums.role.owner}</span>
                ) : canEditPerson ? (
                  <span className="people__actions">
                    <RoleSelect
                      who={person.name ?? person.email}
                      value={person.role}
                      options={GRANTABLE_ROLES}
                      onChange={(next) => changeRole(person.email, next)}
                      disabled={busy || readOnly}
                    />
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={busy || readOnly}
                      onClick={() => remove(person.email)}
                    >
                      {t.admin.revoke}
                    </button>
                  </span>
                ) : canAdminEditPerson ? (
                  <span className="people__actions">
                    <RoleSelect
                      who={person.name ?? person.email}
                      value={person.role}
                      options={['reviewer']}
                      onChange={(next) => changeRole(person.email, next)}
                      disabled={busy || readOnly}
                    />
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={busy || readOnly}
                      onClick={() => remove(person.email)}
                    >
                      {t.admin.revoke}
                    </button>
                  </span>
                ) : (
                  <span className="people__meta people__meta--plain">
                    {t.enums.role[person.role] ?? person.role}
                  </span>
                )}
              </li>
            );
          })}
          {pending.map((grant) => {
            const canEditGrant = isOwner;
            const canAdminEditGrant = !isOwner && grant.role === 'reviewer';
            return (
              <li key={grant.email} className="people__row">
                <span>
                  <strong>{grant.email}</strong>
                  <span className="people__meta">{t.admin.awaitingSignIn}</span>
                </span>
                {canEditGrant ? (
                  <span className="people__actions">
                    <RoleSelect
                      who={grant.email}
                      value={grant.role}
                      options={GRANTABLE_ROLES}
                      onChange={(next) => changeRole(grant.email, next)}
                      disabled={busy || readOnly}
                    />
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={busy || readOnly}
                      onClick={() => remove(grant.email)}
                    >
                      {t.admin.revoke}
                    </button>
                  </span>
                ) : canAdminEditGrant ? (
                  <span className="people__actions">
                    <RoleSelect
                      who={grant.email}
                      value={grant.role}
                      options={['reviewer']}
                      onChange={(next) => changeRole(grant.email, next)}
                      disabled={busy || readOnly}
                    />
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={busy || readOnly}
                      onClick={() => remove(grant.email)}
                    >
                      {t.admin.revoke}
                    </button>
                  </span>
                ) : (
                  <span className="people__meta people__meta--plain">
                    {t.enums.role[grant.role] ?? grant.role}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid grid--2">
        <TextField
          label={t.admin.emailLabel}
          type="email"
          value={email}
          onChange={setEmail}
          required
          disabled={busy || loadFailed || readOnly}
        />
        <SelectField
          label={t.admin.roleLabel}
          value={role}
          options={
            isOwner
              ? GRANTABLE_ROLES.map((r) => ({ value: r, label: t.enums.role[r] }))
              : [{ value: 'reviewer', label: t.enums.role.reviewer }]
          }
          onChange={setRole}
          required
          disabled={busy || loadFailed || readOnly}
        />
      </div>
      <button
        type="button"
        className="btn btn--primary"
        disabled={busy || loadFailed || readOnly || !email.trim()}
        onClick={invite}
      >
        {busy ? t.admin.inviting : t.admin.invite}
      </button>

      <section style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
        <h3>{t.admin.inviteLinks}</h3>
        <p className="section__help">{t.admin.inviteLinksHelp}</p>

        {inviteLinks.length > 0 && (
          <ul className="people" style={{ marginBottom: '1.5rem' }}>
            {inviteLinks.map((link) => {
              const status = getLinkStatus(link);
              const isCopied = copiedLinkId === link.id;
              const canRevoke = status === 'active' && (isOwner || link.role === 'reviewer');
              const expiresDate = formatExpiryDate(link.expiresAt);
              return (
                <li key={link.id} className="people__row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <strong>{link.label || t.enums.role[link.role]}</strong>
                      <span className="people__meta people__meta--plain">
                        {t.enums.role[link.role]}
                      </span>
                      <span
                        className={`chip chip--${status === 'active' ? 'success' : status === 'revoked' ? 'danger' : 'muted'}`}
                        style={{ fontSize: '0.75rem', padding: '0.1rem 0.5rem' }}
                      >
                        {t.admin.inviteLinkStatus[status]}
                      </span>
                    </div>
                    <span className="people__meta">
                      {t.admin.inviteLinkClaims(link.claimedCount, link.maxClaims)}
                      {expiresDate && (
                        <> · {t.admin.inviteLinkCustomDate} {expiresDate}</>
                      )}
                    </span>
                  </div>

                  <div className="people__actions">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => copyLinkUrl(link.id)}
                    >
                      {isCopied ? t.admin.inviteLinkCopied : t.admin.inviteLinkCopy}
                    </button>
                    {canRevoke && (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={busy || readOnly}
                        onClick={() => void revokeLink(link.id)}
                      >
                        {t.admin.inviteLinkRevoke}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="grid grid--2" style={{ marginBottom: '1rem' }}>
          <TextField
            label={t.admin.inviteLinkLabel}
            placeholder={t.admin.inviteLinkLabelPlaceholder}
            value={linkLabel}
            onChange={setLinkLabel}
            disabled={creatingLink || busy || loadFailed || readOnly}
          />
          <SelectField
            label={t.admin.roleLabel}
            value={linkRole}
            options={
              isOwner
                ? GRANTABLE_ROLES.map((r) => ({ value: r, label: t.enums.role[r] }))
                : [{ value: 'reviewer', label: t.enums.role.reviewer }]
            }
            onChange={setLinkRole}
            required
            disabled={creatingLink || busy || loadFailed || readOnly}
          />
        </div>

        <div className="grid grid--2" style={{ marginBottom: '1rem' }}>
          <TextField
            label={t.admin.inviteLinkMaxClaims}
            placeholder={t.admin.inviteLinkMaxClaimsPlaceholder}
            type="number"
            value={linkMaxClaims}
            onChange={setLinkMaxClaims}
            disabled={creatingLink || busy || loadFailed || readOnly}
          />
          <SelectField
            label={t.admin.inviteLinkExpiry}
            value={linkExpiryOption}
            options={[
              { value: '7d', label: t.admin.inviteLinkExpiry7d },
              { value: '14d', label: t.admin.inviteLinkExpiry14d },
              { value: '30d', label: t.admin.inviteLinkExpiry30d },
              { value: 'never', label: t.admin.inviteLinkExpiryNever },
              { value: 'custom', label: t.admin.inviteLinkExpiryCustom },
            ]}
            onChange={(val) => setLinkExpiryOption(val as any)}
            required
            disabled={creatingLink || busy || loadFailed || readOnly}
          />
        </div>

        {linkExpiryOption === 'custom' && (
          <div style={{ marginBottom: '1rem', maxWidth: '15rem' }}>
            <TextField
              label={t.admin.inviteLinkCustomDate}
              type="date"
              value={linkCustomDate}
              onChange={setLinkCustomDate}
              required
              disabled={creatingLink || busy || loadFailed || readOnly}
            />
          </div>
        )}

        <button
          type="button"
          className="btn btn--secondary"
          disabled={
            creatingLink ||
            busy ||
            loadFailed ||
            readOnly ||
            (linkExpiryOption === 'custom' && !linkCustomDate.trim())
          }
          onClick={() => void generateInviteLink()}
        >
          {creatingLink ? t.admin.creatingInviteLink : t.admin.createInviteLink}
        </button>
      </section>

      {isOwner && (
        <section style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
          <h3>{t.transfer.title}</h3>
          <p className="section__help">
            {t.transfer.initiateHelp.replace('{scope}', t.admin.ownershipScope)}
          </p>
          {pendingTransfer ? (
            <div>
              <p><strong>{t.transfer.pendingBanner(pendingTransfer.targetEmail)}</strong></p>
              <button
                type="button"
                className="btn btn--secondary"
                disabled={transferring || readOnly}
                onClick={() => void cancelTransfer()}
              >
                {transferring ? t.transfer.cancelling : t.transfer.cancelButton}
              </button>
            </div>
          ) : (
            <div style={{ maxWidth: '30rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <TextField
                  label={t.transfer.emailLabel}
                  help={t.transfer.emailHelp}
                  type="email"
                  value={transferEmail}
                  onChange={setTransferEmail}
                  required
                  disabled={transferring || readOnly}
                />
              </div>
              <button
                type="button"
                className="btn btn--primary"
                disabled={transferring || readOnly || !transferEmail.trim()}
                onClick={() => void initiateTransfer()}
              >
                {transferring ? t.transfer.initiating : t.transfer.initiateButton}
              </button>
            </div>
          )}
        </section>
      )}

      <Result ok={note} error={error} />
    </section>
  );
}
