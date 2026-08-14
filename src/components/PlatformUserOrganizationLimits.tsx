import { useCallback, useEffect, useMemo, useState } from 'react';

import { ORG_LIMITS, type PlatformUserOrgLimitSummary } from '@shared/org';
import { AdminPagination } from './AdminPagination';
import { useI18n } from '../i18n/context';
import {
  findUserOrgLimit,
  listUserOrgLimits,
  resetUserOrgLimit,
  setUserOrgLimit,
} from '../lib/orgs';
import { useLatest } from '../lib/useLatest';
import { Result } from '../screens/admin/Result';

const PAGE_SIZE = 5;

export function PlatformUserOrganizationLimits({
  onDirtyChange,
  refreshKey = 0,
}: {
  onDirtyChange: (dirty: boolean) => void;
  refreshKey?: number;
}) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [users, setUsers] = useState<PlatformUserOrgLimitSummary[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [searchedUser, setSearchedUser] = useState<PlatformUserOrgLimitSummary | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [page, setPage] = useState(0);
  const [pageTokens, setPageTokens] = useState<Array<string | undefined>>([undefined]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      users?.some(
        (user) => drafts[user.uid] !== undefined && Number(drafts[user.uid]) !== user.organizationLimit,
      ) ?? false,
    [drafts, users],
  );

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const load = useCallback(async (targetPage = 0, token?: string) => {
    setError('');
    setUsers(null);
    try {
      const { data } = await listUserOrgLimits({ pageSize: PAGE_SIZE, ...(token ? { pageToken: token } : {}) });
      setUsers(data.users);
      setDrafts((current) => ({
        ...current,
        ...Object.fromEntries(data.users.map((user) => [user.uid, String(user.organizationLimit)])),
      }));
      setNextPageToken(data.nextPageToken);
      setPage(targetPage);
    } catch {
      setError(tRef.current.platformAdmin.userLimitsLoadError);
    }
  }, [tRef]);

  useEffect(() => {
    setPageTokens([undefined]);
    setSearchedUser(null);
    setSearch('');
    void load(0);
  }, [load, refreshKey]);

  async function find(event: React.FormEvent) {
    event.preventDefault();
    const email = search.trim();
    if (!email || busy || dirty) return;
    setBusy('search');
    setError('');
    setNote('');
    try {
      const { data } = await findUserOrgLimit({ email });
      setSearchedUser(data.user);
      setDrafts((current) => ({
        ...current,
        [data.user.uid]: String(data.user.organizationLimit),
      }));
    } catch {
      setSearchedUser(null);
      setError(t.platformAdmin.userLimitsLookupError);
    } finally {
      setBusy('');
    }
  }

  function clearSearch() {
    setSearch('');
    setSearchedUser(null);
    setError('');
    setNote('');
  }

  function previousPage() {
    if (page === 0 || dirty) return;
    const target = page - 1;
    void load(target, pageTokens[target]);
  }

  function nextPage() {
    if (!nextPageToken || dirty) return;
    const target = page + 1;
    setPageTokens((current) => {
      const next = current.slice(0, target);
      next[target] = nextPageToken;
      return next;
    });
    void load(target, nextPageToken);
  }

  function validLimit(value: string): number | null {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 0 || limit > ORG_LIMITS.perOwnerMax) {
      setError(
        t.platformAdmin.userLimitInvalid.replace('{max}', String(ORG_LIMITS.perOwnerMax)),
      );
      return null;
    }
    return limit;
  }

  async function save(emailAddress: string, value: string) {
    const limit = validLimit(value);
    if (limit === null) return;
    setBusy(emailAddress);
    setError('');
    setNote('');
    try {
      const { data } = await setUserOrgLimit({ email: emailAddress, limit });
      setUsers((current) => {
        const rest = current?.filter((user) => user.uid !== data.user.uid) ?? [];
        return [...rest, data.user].sort((a, b) =>
          (a.name || a.email).localeCompare(b.name || b.email),
        );
      });
      setSearchedUser((current) => current?.uid === data.user.uid ? data.user : current);
      setDrafts((current) => ({ ...current, [data.user.uid]: String(limit) }));
      setNote(t.platformAdmin.userLimitSaved.replace('{email}', data.user.email));
    } catch {
      setError(t.platformAdmin.userLimitSaveError);
    } finally {
      setBusy('');
    }
  }

  async function reset(user: PlatformUserOrgLimitSummary) {
    setBusy(user.uid);
    setError('');
    setNote('');
    try {
      const { data } = await resetUserOrgLimit({ uid: user.uid });
      setUsers((current) =>
        current?.flatMap((item) => {
          if (item.uid !== user.uid) return [item];
          return [{ ...item, organizationLimit: data.limit, hasOverride: false }];
        }) ?? null,
      );
      setSearchedUser((current) => current?.uid === user.uid
        ? { ...current, organizationLimit: data.limit, hasOverride: false }
        : current);
      setDrafts((current) => ({ ...current, [user.uid]: String(data.limit) }));
      setNote(t.platformAdmin.userLimitResetDone.replace('{email}', user.email));
    } catch {
      setError(t.platformAdmin.userLimitSaveError);
    } finally {
      setBusy('');
    }
  }

  return (
    <section aria-labelledby="platform-user-limits-title">
      <h2 id="platform-user-limits-title" className="platform-admin__section-title">
        {t.platformAdmin.userLimitsTitle}
      </h2>
      <p className="platform-admin__boundary">{t.platformAdmin.userLimitsHelp}</p>

      <Result ok={note} error={error} />
      {users === null ? (
        error ? (
          <button type="button" className="btn" onClick={() => void load()}>
            {t.platformAdmin.retry}
          </button>
        ) : (
          <p className="muted" role="status">{t.app.loading}</p>
        )
      ) : (
        <div className="platform-org-limits-container">
          <form className="platform-limits-toolbar" onSubmit={(event) => void find(event)}>
            <label htmlFor="user-limits-filter" className="platform-limits-search">
              <span>{t.platformAdmin.userLimitsSearchLabel}</span>
              <input
                id="user-limits-filter"
                className="field__input"
                type="search"
                value={search}
                placeholder={t.platformAdmin.userLimitsSearchPlaceholder}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button className="btn btn--secondary btn--sm" type="submit" disabled={!search.trim() || Boolean(busy) || dirty}>
              {busy === 'search' ? t.app.loading : t.platformAdmin.userLimitsSearchAction}
            </button>
            {searchedUser && (
              <button className="btn btn--ghost btn--sm" type="button" disabled={Boolean(busy) || dirty} onClick={clearSearch}>
                {t.platformAdmin.userLimitsSearchClear}
              </button>
            )}
          </form>

          {(searchedUser ? [searchedUser] : users).length === 0 ? (
            <div className="platform-limits-empty-box" role="status">
              <p className="muted platform-limits-empty">{t.platformAdmin.userLimitsEmpty}</p>
            </div>
          ) : (
            <div className="platform-org-limits">
              {(searchedUser ? [searchedUser] : users).map((user) => {
                const changed = Number(drafts[user.uid]) !== user.organizationLimit;
                return (
                  <form
                    className="platform-org-limit platform-user-limit"
                    key={user.uid}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save(user.email, drafts[user.uid] ?? '');
                    }}
                  >
                    <div className="platform-org-limit__identity">
                      <strong>{user.name || user.email || user.uid}</strong>
                      {user.name && <span className="people__meta">{user.email}</span>}
                    </div>
                    <span className="platform-org-limit__usage">
                      {t.platformAdmin.userLimitUsage
                        .replace('{owned}', String(user.ownedOrganizationCount))
                        .replace('{limit}', String(user.organizationLimit))}
                      {!user.hasOverride && ` · ${t.platformAdmin.userLimitDefault}`}
                    </span>
                    <label className="platform-org-limit__field">
                      <span>{t.platformAdmin.userLimitLabel}</span>
                      <input
                        className="field__input platform-limit-input"
                        type="number"
                        min="0"
                        max={ORG_LIMITS.perOwnerMax}
                        step="1"
                        value={drafts[user.uid] ?? ''}
                        disabled={Boolean(busy)}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [user.uid]: event.target.value }))
                        }
                      />
                    </label>
                    <span className="platform-user-limit__actions">
                      <button
                        type="submit"
                        className="btn btn--primary btn--sm"
                        disabled={Boolean(busy) || !changed || !user.email}
                      >
                        {busy === user.email
                          ? t.platformAdmin.userLimitSaving
                          : t.platformAdmin.userLimitSave}
                      </button>
                      {user.hasOverride && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={Boolean(busy)}
                          onClick={() => void reset(user)}
                        >
                          {busy === user.uid
                            ? t.platformAdmin.userLimitResetting
                            : t.platformAdmin.userLimitReset}
                        </button>
                      )}
                    </span>
                  </form>
                );
              })}
              {!searchedUser && (
                <AdminPagination
                  page={page}
                  hasPrevious={page > 0}
                  hasNext={Boolean(nextPageToken)}
                  busy={users === null || Boolean(busy) || dirty}
                  onPrevious={previousPage}
                  onNext={nextPage}
                />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
