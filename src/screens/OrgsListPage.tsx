import { useState } from 'react';
import type { User } from 'firebase/auth';

import { useI18n } from '../i18n/context';
import { goTo } from '../lib/router';
import { createOrg, useMyOrgs } from '../lib/orgs';
import { TextField } from '../components/fields';
import { Link } from '../components/Link';
import { validateOrgSlug } from '@shared/org';
import { Result } from './admin/Result';
import { orgError } from '../lib/errors';

export function OrgsListPage({ user }: { user: User }) {
  const { t } = useI18n();
  const { orgs, canCreateOrg, loading, error } = useMyOrgs(user);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [slugError, setSlugError] = useState('');

  const autoSlug = (val: string) =>
    val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const effectiveSlug = slugTouched ? slug : autoSlug(name);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormError('');
    setSlugError('');

    if (!name.trim()) {
      setFormError(t.orgs.nameLabel);
      return;
    }

    const fault = validateOrgSlug(effectiveSlug);
    if (fault) {
      setSlugError(t.orgs.errors[fault] ?? t.errors.generic);
      return;
    }

    setBusy(true);
    try {
      const res = await createOrg({
        name: name.trim(),
        slug: effectiveSlug,
      });
      if (res.data.ok) {
        goTo(`/orgs/${effectiveSlug}`);
      }
    } catch (err: any) {
      const code = String(err?.code ?? '');
      if (code === 'functions/already-exists') {
        setSlugError(t.orgs.errors.taken);
      } else {
        setFormError(orgError(err, t));
      }
    } finally {
      setBusy(false);
    }
  }

  const getInitials = (orgName: string) => {
    return (
      orgName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('') || 'OG'
    );
  };

  return (
    <div className="orgs-page container">
      <header className="org-hero">
        <div className="org-hero__intro">
          <p className="org-hero__eyebrow">{t.orgs.breadcrumb}</p>
          <p className="org-hero__subtitle">{t.orgs.createSubtitle}</p>
        </div>
        {canCreateOrg && !showCreate && (
          <button
            className="btn btn--primary org-hero__create-btn"
            type="button"
            onClick={() => setShowCreate(true)}
          >
            + {t.orgs.createTitle}
          </button>
        )}
      </header>

      {canCreateOrg && showCreate && (
        <section className="card org-create-card" aria-labelledby="create-org-title">
          <div className="org-create-card__header">
            <h2 id="create-org-title" className="org-create-card__title">
              {t.orgs.createTitle}
            </h2>
            <button
              className="btn btn--ghost btn--sm org-create-card__close"
              type="button"
              aria-label={t.orgs.closeCreate}
              onClick={() => {
                setShowCreate(false);
                setName('');
                setSlug('');
                setSlugTouched(false);
                setFormError('');
                setSlugError('');
              }}
            >
              ✕
            </button>
          </div>
          {formError && <Result ok="" error={formError} />}
          <form onSubmit={handleCreate}>
            <div className="org-create-form__fields">
              <TextField
                label={t.orgs.nameLabel}
                placeholder={t.orgs.namePlaceholder}
                value={name}
                onChange={(val) => {
                  setName(val);
                  if (!slugTouched) {
                    setSlug(autoSlug(val));
                  }
                }}
                required
              />
              <TextField
                label={t.orgs.slugLabel}
                help={t.orgs.slugHelp}
                value={effectiveSlug}
                error={slugError}
                onChange={(val) => {
                  setSlugTouched(true);
                  setSlug(val);
                }}
                required
              />
              <p className="section__help">{t.orgs.ownerByDefault}</p>
              <div className="org-create-form__actions">
                <button className="btn btn--primary" type="submit" disabled={busy}>
                  {busy ? t.orgs.creating : t.orgs.createButton}
                </button>
                <button
                  className="btn btn--secondary"
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setName('');
                    setSlug('');
                    setSlugTouched(false);
                    setFormError('');
                    setSlugError('');
                  }}
                >
                  {t.orgs.cancel}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      {loading && (
        <div className="org-grid" aria-busy="true" aria-label={t.app.loading}>
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
      )}
      {error !== null && <Result ok="" error={orgError(error, t)} />}

      {!loading && orgs.length === 0 && !showCreate && (
        <section className="card org-empty-card" aria-labelledby="no-orgs-title">
          <div className="org-avatar org-avatar--empty" aria-hidden="true">
            +
          </div>
          <h2 id="no-orgs-title" className="org-empty-card__title">
            {t.orgs.noOrgs}
          </h2>
          <p className="org-empty-card__text">
            {canCreateOrg ? t.orgs.createFirstPrompt : t.orgs.createLimitHelp}
          </p>
          {canCreateOrg && (
            <button
              className="btn btn--primary btn--lg"
              type="button"
              onClick={() => setShowCreate(true)}
            >
              + {t.orgs.createTitle}
            </button>
          )}
        </section>
      )}

      {!loading && orgs.length > 0 && (
        <div className="org-grid">
          {orgs.map((org) => (
            <article key={org.id} className="org-card">
              <div className="org-card__content">
                <div className="org-card__header">
                  <div className="org-avatar org-avatar--sm" aria-hidden="true">
                    {getInitials(org.name)}
                  </div>
                  <div className="org-card__identity">
                    <h2 className="org-card__title">
                      <Link to={`/orgs/${org.slug}`} className="org-card__title-link">
                        {org.name}
                      </Link>
                    </h2>
                    <span className="org-card__slug">/orgs/{org.slug}</span>
                  </div>
                </div>
                {org.description && <p className="org-card__desc">{org.description}</p>}
              </div>
              <div className="org-card__footer">
                <span className="org-card__badges">
                  <span className={`org-badge org-badge--${org.membershipRole}`}>
                    {t.orgs.yourRole}: {t.orgs.roles[org.membershipRole]}
                  </span>
                  {org.websiteUrl ? (
                    <a
                      className="org-badge org-badge--link"
                      href={org.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      ↗ {t.orgs.website}
                    </a>
                  ) : (
                    <span className="org-badge">{t.orgs.eventActive}</span>
                  )}
                </span>
                <button
                  className="btn btn--secondary btn--sm"
                  type="button"
                  onClick={() => goTo(`/orgs/${org.slug}`)}
                >
                  {t.orgs.viewWorkspace} →
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
