import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import { SelectField, TextField } from '../../components/fields';
import { useI18n } from '../../i18n/context';
import { adminError } from '../../lib/errors';
import { grantRole, loadCommittee, revokeRole, type Person } from '../../lib/roles';
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
}: {
  who: string;
  value: GrantableRole;
  onChange: (next: GrantableRole) => void;
}) {
  const { t } = useI18n();
  return (
    <select
      className="people__role"
      value={value}
      aria-label={t.admin.roleFor(who)}
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

export function Committee({ user, cfpId }: { user: User; cfpId: string }) {
  const { t } = useI18n();
  const [people, setPeople] = useState<Person[]>([]);
  const [pending, setPending] = useState<RoleGrant[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<GrantableRole>('reviewer');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const committee = await loadCommittee(cfpId);
      setPeople(committee.people);
      setPending(committee.pending);
    } catch (e) {
      setError(adminError(e, t));
    }
  }, [cfpId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function invite() {
    setBusy(true);
    setNote('');
    setError('');
    try {
      const { data } = await grantRole({ cfpId, email, role });
      setNote(data.applied ? t.admin.granted(data.email) : t.admin.invited(data.email));
      setEmail('');
      await refresh();
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Re-roling is the same call as inviting — `grant` merges onto the member
   * document. The server refuses the two changes that would break the CFP
   * (touching the owner, demoting the last admin); this only declines to offer
   * the first of them.
   */
  async function changeRole(target: string, next: GrantableRole) {
    setNote('');
    setError('');
    try {
      const { data } = await grantRole({ cfpId, email: target, role: next });
      setNote(data.applied ? t.admin.granted(data.email) : t.admin.invited(data.email));
    } catch (e) {
      setError(adminError(e, t));
    }
    // Refresh either way: on failure this is what puts the select back to the
    // role the server actually still holds.
    await refresh();
  }

  async function remove(target: string) {
    if (!window.confirm(t.admin.revokeConfirm(target))) return;
    setNote('');
    setError('');
    try {
      await revokeRole({ cfpId, email: target });
      setNote(t.admin.revoked(target));
      await refresh();
    } catch (e) {
      setError(adminError(e, t));
    }
  }

  return (
    <section className="section">
      <h2>{t.admin.people}</h2>
      <p className="section__help">{t.admin.peopleHelp}</p>

      {people.length === 0 && pending.length === 0 ? (
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
                  />
                  <button
                    type="button"
                    className="btn btn--ghost"
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
                />
                <button type="button" className="btn btn--ghost" onClick={() => remove(grant.email)}>
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
          disabled={busy}
        />
        <SelectField
          label={t.admin.roleLabel}
          value={role}
          options={GRANTABLE_ROLES.map((r) => ({ value: r, label: t.enums.role[r] }))}
          onChange={setRole}
          required
          disabled={busy}
        />
      </div>
      <button
        type="button"
        className="btn btn--primary"
        disabled={busy || !email.trim()}
        onClick={invite}
      >
        {busy ? t.admin.inviting : t.admin.invite}
      </button>

      <Result ok={note} error={error} />
    </section>
  );
}
