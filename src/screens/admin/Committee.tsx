import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { SelectField, TextField } from '../../components/fields';
import { useI18n } from '../../i18n/context';
import { adminError } from '../../lib/errors';
import { grantRole, loadCommittee, revokeRole, type Person } from '../../lib/roles';
import { useLatest } from '../../lib/useLatest';
import { GRANTABLE_ROLES, type GrantableRole } from '@shared/cfp';
import type { RoleGrant } from '@shared/types';
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
}: {
  who: string;
  value: GrantableRole;
  onChange: (next: GrantableRole) => void;
  disabled: boolean;
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
      {GRANTABLE_ROLES.map((r) => (
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
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<GrantableRole>('reviewer');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loadedCfp, setLoadedCfp] = useState('');
  const activeCfp = useRef(cfpId);
  const generation = useRef(0);
  activeCfp.current = cfpId;

  const refresh = useCallback(async (reportError = true) => {
    const scope = cfpId;
    const request = ++generation.current;
    const current = () =>
      activeCfp.current === scope && generation.current === request;
    try {
      const committee = await loadCommittee(cfpId);
      if (!current()) return false;
      setPeople(committee.people);
      setPending(committee.pending);
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
    setEmail('');
    setRole('reviewer');
    setLoadedCfp('');
    setLoadFailed(false);
    setBusy(false);
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
      await refresh(false);
    } catch (e) {
      if (activeCfp.current === scope) setError(adminError(e, tRef.current));
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
      if (activeCfp.current === scope) setError(adminError(e, tRef.current));
    } finally {
      // Refresh either way: on failure this is what puts the select back to the
      // role the server actually still holds.
      if (activeCfp.current === scope) {
        await refresh(false);
        if (activeCfp.current === scope) setBusy(false);
      }
    }
  }

  async function remove(target: string) {
    if (busy) return;
    if (!window.confirm(t.admin.revokeConfirm(target))) return;
    const scope = cfpId;
    setBusy(true);
    setNote('');
    setError('');
    try {
      await revokeRole({ cfpId, email: target });
      if (activeCfp.current !== scope) return;
      setNote(tRef.current.admin.revoked(target));
      await refresh(false);
    } catch (e) {
      if (activeCfp.current === scope) setError(adminError(e, tRef.current));
    } finally {
      if (activeCfp.current === scope) setBusy(false);
    }
  }

  return (
    <section className="section">
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
          {people.map((person) => (
            <li key={person.uid} className="people__row">
              <span>
                <strong>{person.name ?? person.email}</strong>
                {person.uid === user.uid && <span className="people__meta">{t.admin.isYou}</span>}
              </span>
              {/* The owner's row is read-only, because the server refuses both
                  controls on it — showing them would only offer two errors. */}
              {person.role === 'owner' ? (
                <span className="people__meta people__meta--plain">{t.enums.role.owner}</span>
              ) : (
                <span className="people__actions">
                  <RoleSelect
                    who={person.name ?? person.email}
                    value={person.role}
                    onChange={(next) => changeRole(person.email, next)}
                    disabled={busy || readOnly}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busy}
                    onClick={() => remove(person.email)}
                  >
                    {t.admin.revoke}
                  </button>
                </span>
              )}
            </li>
          ))}
          {pending.map((grant) => (
            <li key={grant.email} className="people__row">
              <span>
                <strong>{grant.email}</strong>
                <span className="people__meta">{t.admin.awaitingSignIn}</span>
              </span>
              <span className="people__actions">
                <RoleSelect
                  who={grant.email}
                  value={grant.role}
                  onChange={(next) => changeRole(grant.email, next)}
                  disabled={busy || readOnly}
                />
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => remove(grant.email)}
                >
                  {t.admin.revoke}
                </button>
              </span>
            </li>
          ))}
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
          options={GRANTABLE_ROLES.map((r) => ({ value: r, label: t.enums.role[r] }))}
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

      <Result ok={note} error={error} />
    </section>
  );
}
