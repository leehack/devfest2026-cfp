/**
 * The platform's front door: the calls anyone can find, plus the ones you run.
 *
 * Two separate queries rather than one. `list` on `cfps` allows exactly the
 * public-and-not-archived query and exactly the owner's own — rules are not
 * filters, so a single wider listing would be denied outright rather than
 * trimmed to what the caller may see.
 */

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import { useI18n, formatDay } from '../i18n';
import { href, navigate } from '../lib/router';
import { Link } from '../components/Link';
import {
  loadMyCfps,
  loadMyMemberships,
  loadPublicCfps,
  type CfpSummary,
} from '../lib/roles';

export function HomePage({ user }: { user: User | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<CfpSummary[] | null>(null);
  const [mine, setMine] = useState<CfpSummary[]>([]);
  const [helping, setHelping] = useState<CfpSummary[]>([]);

  useEffect(() => {
    loadPublicCfps()
      .then(setOpen)
      .catch(() => setOpen([]));
  }, []);

  useEffect(() => {
    if (!user) {
      setMine([]);
      setHelping([]);
      return;
    }
    loadMyCfps(user.uid)
      .then(setMine)
      .catch(() => setMine([]));
    loadMyMemberships(user.uid)
      .then(setHelping)
      .catch(() => setHelping([]));
  }, [user]);

  // Owning one already lists it above; this section is for the calls somebody
  // else runs and invited you onto.
  const owned = new Set(mine.map((cfp) => cfp.id));
  const elsewhere = helping.filter((cfp) => !owned.has(cfp.id));

  return (
    <>
      <section className="panel">
        <h2 className="card__title">{t.platform.title}</h2>
        <p className="muted">{t.platform.help}</p>

        {open === null ? (
          <p className="muted">{t.app.loading}</p>
        ) : open.length === 0 ? (
          <p className="muted">{t.platform.none}</p>
        ) : (
          <ul className="cfp-list">
            {open.map((cfp) => (
              <CfpCard key={cfp.id} cfp={cfp} />
            ))}
          </ul>
        )}

        <button type="button" className="btn btn--primary" onClick={() => navigate('new')}>
          {t.platform.create}
        </button>
        {!user && <p className="field__help">{t.platform.signInFirst}</p>}
      </section>

      {mine.length > 0 && (
        <section className="panel">
          <h2 className="card__title">{t.platform.yours}</h2>
          <p className="muted">{t.platform.yoursHelp}</p>
          <ul className="cfp-list">
            {mine.map((cfp) => (
              <CfpCard key={cfp.id} cfp={cfp} />
            ))}
          </ul>
        </section>
      )}

      {elsewhere.length > 0 && (
        <section className="panel">
          <h2 className="card__title">{t.platform.helping}</h2>
          <p className="muted">{t.platform.helpingHelp}</p>
          <ul className="cfp-list">
            {elsewhere.map((cfp) => (
              <CfpCard key={cfp.id} cfp={cfp} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Timestamps arrive from Firestore, not from the callable's JSON. */
const toDate = (value: unknown): Date | null => {
  const at = (value as { toDate?: () => Date } | undefined)?.toDate?.();
  return at instanceof Date ? at : null;
};

function CfpCard({ cfp }: { cfp: CfpSummary }) {
  const { t, locale } = useI18n();
  const opensAt = toDate(cfp.opensAt);
  const closesAt = toDate(cfp.closesAt);
  const now = Date.now();

  const when = cfp.archived
    ? t.platform.closed
    : opensAt && now < opensAt.getTime()
      ? t.platform.opensOn.replace('{date}', formatDay(opensAt, locale))
      : closesAt && now >= closesAt.getTime()
        ? t.platform.closed
        : closesAt
          ? t.platform.closesOn.replace('{date}', formatDay(closesAt, locale))
          : '';

  return (
    <li className="cfp-list__item">
      <Link className="cfp-list__link" to={href({ route: 'form', cfpId: cfp.id })}>
        {cfp.name}
      </Link>
      <span className="cfp-list__meta">
        {when}
        {cfp.visibility === 'private' && <span className="tag">{t.platform.private}</span>}
        {cfp.archived && <span className="tag">{t.platform.archived}</span>}
      </span>
    </li>
  );
}
