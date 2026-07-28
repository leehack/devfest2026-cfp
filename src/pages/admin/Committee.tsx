import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import { SelectField, TextField } from '../../components/fields';
import { useI18n } from '../../i18n';
import { adminError } from '../../lib/errors';
import { grantRole, loadCommittee, revokeRole, type Person } from '../../lib/roles';
import { ROLES, type Role } from '@shared/enums';
import type { RoleGrant } from '@shared/types';
import { Result } from './Result';

export function Committee({ user }: { user: User }) {
  const { t } = useI18n();
  const [people, setPeople] = useState<Person[]>([]);
  const [pending, setPending] = useState<RoleGrant[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('reviewer');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const committee = await loadCommittee();
      setPeople(committee.people);
      setPending(committee.pending);
    } catch (e) {
      setError(adminError(e, t));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function invite() {
    setBusy(true);
    setNote('');
    setError('');
    try {
      const { data } = await grantRole({ email, role });
      setNote(data.applied ? t.admin.granted(data.email) : t.admin.invited(data.email));
      setEmail('');
      await refresh();
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: string) {
    if (!window.confirm(t.admin.revokeConfirm(target))) return;
    setNote('');
    setError('');
    try {
      await revokeRole({ email: target });
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
                <span className="people__meta">
                  {t.enums.role[person.role]}
                  {person.uid === user.uid && ` · ${t.admin.isYou}`}
                </span>
              </span>
              <button type="button" className="btn btn--ghost" onClick={() => remove(person.email)}>
                {t.admin.revoke}
              </button>
            </li>
          ))}
          {pending.map((grant) => (
            <li key={grant.email} className="people__row">
              <span>
                <strong>{grant.email}</strong>
                <span className="people__meta">
                  {t.enums.role[grant.role]} · {t.admin.awaitingSignIn}
                </span>
              </span>
              <button type="button" className="btn btn--ghost" onClick={() => remove(grant.email)}>
                {t.admin.revoke}
              </button>
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
          options={ROLES.map((r) => ({ value: r, label: t.enums.role[r] }))}
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
