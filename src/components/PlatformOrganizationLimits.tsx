import { useCallback, useEffect, useMemo, useState } from 'react';

import { ORG_LIMITS, type PlatformOrgLimitSummary } from '@shared/org';
import { AdminPagination } from './AdminPagination';
import { useI18n } from '../i18n/context';
import { listOrgLimits, setOrgActiveEventLimit } from '../lib/orgs';
import { useLatest } from '../lib/useLatest';
import { Result } from '../screens/admin/Result';

const PAGE_SIZE = 5;

export function PlatformOrganizationLimits({
  onDirtyChange,
}: {
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [organizations, setOrganizations] = useState<PlatformOrgLimitSummary[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      organizations?.some(
        (org) => drafts[org.id] !== undefined && Number(drafts[org.id]) !== org.activeEventLimit,
      ) ?? false,
    [drafts, organizations],
  );

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const load = useCallback(async (targetPage = 0, cursor?: string, query = '') => {
    setError('');
    setOrganizations(null);
    try {
      const { data } = await listOrgLimits({
        pageSize: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
        ...(query ? { query } : {}),
      });
      setOrganizations(data.organizations);
      setDrafts((current) => ({
        ...current,
        ...Object.fromEntries(data.organizations.map((org) => [org.id, String(org.activeEventLimit)])),
      }));
      setNextCursor(data.nextCursor);
      setPage(targetPage);
    } catch {
      setError(tRef.current.platformAdmin.orgLimitsLoadError);
    }
  }, [tRef]);

  useEffect(() => {
    void load(0);
  }, [load]);

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    if (dirty || busy) return;
    const query = search.trim().toLowerCase();
    setActiveSearch(query);
    setCursors([undefined]);
    void load(0, undefined, query);
  }

  function clearSearch() {
    if (dirty || busy) return;
    setSearch('');
    setActiveSearch('');
    setCursors([undefined]);
    void load(0);
  }

  function previousPage() {
    if (page === 0 || dirty) return;
    const target = page - 1;
    void load(target, cursors[target], activeSearch);
  }

  function nextPage() {
    if (!nextCursor || dirty) return;
    const target = page + 1;
    setCursors((current) => {
      const next = current.slice(0, target);
      next[target] = nextCursor;
      return next;
    });
    void load(target, nextCursor, activeSearch);
  }

  async function save(org: PlatformOrgLimitSummary) {
    const limit = Number(drafts[org.id]);
    if (!Number.isInteger(limit) || limit < 0 || limit > ORG_LIMITS.activeEventsMax) {
      setError(t.platformAdmin.orgLimitInvalid.replace('{max}', String(ORG_LIMITS.activeEventsMax)));
      return;
    }
    setBusy(org.id);
    setError('');
    setNote('');
    try {
      await setOrgActiveEventLimit({ orgId: org.id, limit });
      setOrganizations((current) =>
        current?.map((item) => item.id === org.id ? { ...item, activeEventLimit: limit } : item) ?? null,
      );
      setNote(t.platformAdmin.orgLimitSaved.replace('{name}', org.name));
    } catch {
      setError(t.platformAdmin.orgLimitSaveError);
    } finally {
      setBusy('');
    }
  }

  return (
    <section aria-labelledby="platform-organization-limits-title">
      <h2 id="platform-organization-limits-title" className="platform-admin__section-title">
        {t.platformAdmin.orgLimitsTitle}
      </h2>
      <p className="platform-admin__boundary">{t.platformAdmin.orgLimitsHelp}</p>
      <Result ok={note} error={error} />
      {organizations === null ? (
        error ? (
          <button type="button" className="btn" onClick={() => void load()}>
            {t.platformAdmin.retry}
          </button>
        ) : (
          <p className="muted" role="status">{t.app.loading}</p>
        )
      ) : (
        <div className="platform-org-limits-container">
          <form className="platform-limits-toolbar" onSubmit={submitSearch}>
            <label htmlFor="org-limits-filter" className="platform-limits-search">
              <span>{t.platformAdmin.orgLimitsSearchLabel}</span>
              <input
                id="org-limits-filter"
                className="field__input"
                type="search"
                value={search}
                placeholder={t.platformAdmin.orgLimitsSearchPlaceholder}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button className="btn btn--secondary btn--sm" type="submit" disabled={Boolean(busy) || dirty}>
              {t.platformAdmin.orgLimitsSearchAction}
            </button>
            {activeSearch && organizations.length > 0 && (
              <button className="btn btn--ghost btn--sm" type="button" disabled={Boolean(busy) || dirty} onClick={clearSearch}>
                {t.platformAdmin.orgLimitsSearchClear}
              </button>
            )}
          </form>

          {organizations.length === 0 ? (
            <div className="platform-limits-empty-box" role="status">
              <p className="muted platform-limits-empty">
                {activeSearch
                  ? t.platformAdmin.orgLimitsNoResults
                  : t.platformAdmin.orgLimitsEmpty}
              </p>
              {activeSearch && (
                <button
                  className="btn btn--secondary btn--sm"
                  type="button"
                  disabled={Boolean(busy) || dirty}
                  onClick={clearSearch}
                >
                  {t.platformAdmin.orgLimitsSearchClear}
                </button>
              )}
            </div>
          ) : (
            <div className="platform-org-limits">
              {organizations.map((org) => {
                const changed = Number(drafts[org.id]) !== org.activeEventLimit;
                return (
                  <form
                    className="platform-org-limit"
                    key={org.id}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save(org);
                    }}
                  >
                    <div className="platform-org-limit__identity">
                      <strong>{org.name}</strong>
                      <span className="people__meta">/{org.id}</span>
                    </div>
                    <span className="platform-org-limit__usage">
                      {t.platformAdmin.orgLimitUsage
                        .replace('{active}', String(org.activeEventCount))
                        .replace('{limit}', String(org.activeEventLimit))}
                    </span>
                    <label className="platform-org-limit__field">
                      <span>{t.platformAdmin.orgLimitLabel}</span>
                      <input
                        className="field__input platform-limit-input"
                        type="number"
                        min="0"
                        max={ORG_LIMITS.activeEventsMax}
                        step="1"
                        value={drafts[org.id] ?? ''}
                        disabled={Boolean(busy)}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [org.id]: event.target.value }))
                        }
                      />
                    </label>
                    <button
                      type="submit"
                      className="btn btn--primary btn--sm"
                      disabled={Boolean(busy) || !changed}
                    >
                      {busy === org.id ? t.platformAdmin.orgLimitSaving : t.platformAdmin.orgLimitSave}
                    </button>
                  </form>
                );
              })}
              <AdminPagination
                page={page}
                hasPrevious={page > 0}
                hasNext={Boolean(nextCursor)}
                busy={organizations === null || Boolean(busy) || dirty}
                onPrevious={previousPage}
                onNext={nextPage}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
