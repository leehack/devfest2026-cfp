import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';

import { useI18n } from '../i18n/context';
import { goTo } from '../lib/router';
import {
  acceptOrgOwnershipTransfer,
  cancelOrgOwnershipTransfer,
  deleteOrg,
  grantOrgRole,
  initiateOrgOwnershipTransfer,
  revokeOrgRole,
  updateOrg,
  useOrg,
} from '../lib/orgs';
import { SelectField, TextField } from '../components/fields';
import { Result } from './admin/Result';
import type { OrgRole } from '@shared/org';
import { orgError, transferError } from '../lib/errors';

type OrgTab = 'events' | 'members' | 'settings';

export function OrgWorkspacePage({ orgId, user }: { orgId: string; user: User | null }) {
  const { t } = useI18n();
  const { org, role, pendingTransfer, events, members, loading, error, refresh } = useOrg(
    orgId,
    user,
  );

  const [tab, setTab] = useState<OrgTab>('events');

  // Settings form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [settingsError, setSettingsError] = useState('');

  // Delete org state
  const [deleteConfirmSlug, setDeleteConfirmSlug] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Member invite state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteNotice, setInviteNotice] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [removingUid, setRemovingUid] = useState('');

  // Transfer state
  const [transferEmail, setTransferEmail] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferNotice, setTransferNotice] = useState('');
  const [transferErr, setTransferErr] = useState('');

  useEffect(() => {
    if (org) {
      setName(org.name || '');
      setDescription(org.description || '');
      setWebsiteUrl(org.websiteUrl || '');
      setLogoUrl(org.logoUrl || '');
    }
  }, [org]);

  const isOwner = role === 'owner';
  const isAdmin = role === 'admin';
  const canManage = isOwner || isAdmin;
  const availableTabs: OrgTab[] = [
    'events',
    ...(role ? (['members'] as const) : []),
    ...(canManage ? (['settings'] as const) : []),
  ];
  const isTransferTarget =
    pendingTransfer &&
    ((user?.email &&
      pendingTransfer.targetEmail.toLowerCase() === user.email.toLowerCase()) ||
      pendingTransfer.targetUid === user?.uid);

  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>, current: OrgTab) {
    const currentIndex = availableTabs.indexOf(current);
    let target: OrgTab | undefined;
    if (event.key === 'ArrowRight') {
      target = availableTabs[(currentIndex + 1) % availableTabs.length];
    } else if (event.key === 'ArrowLeft') {
      target = availableTabs[(currentIndex - 1 + availableTabs.length) % availableTabs.length];
    } else if (event.key === 'Home') {
      target = availableTabs[0];
    } else if (event.key === 'End') {
      target = availableTabs.at(-1);
    }
    if (!target) return;
    event.preventDefault();
    setTab(target);
    window.requestAnimationFrame(() => document.getElementById(`org-tab-${target}`)?.focus());
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || savingSettings) return;
    setSavingSettings(true);
    setSettingsNotice('');
    setSettingsError('');
    try {
      await updateOrg({
        orgId,
        name: name.trim(),
        description: description.trim(),
        websiteUrl: websiteUrl.trim(),
        logoUrl: logoUrl.trim(),
      });
      setSettingsNotice(t.orgs.settingsSaved);
      await refresh();
    } catch (err) {
      setSettingsError(orgError(err, t));
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleDeleteOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner || deleting || !org) return;
    if (deleteConfirmSlug.trim() !== org.slug) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteOrg({ orgId: org.slug, confirm: deleteConfirmSlug.trim() });
      goTo('/orgs');
    } catch (err) {
      setDeleteError(orgError(err, t));
      setDeleting(false);
    }
  }

  async function handleInviteMember(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || inviting || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteNotice('');
    setInviteError('');
    try {
      await grantOrgRole({
        orgId,
        email: inviteEmail.trim().toLowerCase(),
        role: isOwner ? inviteRole : 'member',
      });
      setInviteNotice(t.orgs.memberAdded.replace('{email}', inviteEmail));
      setInviteEmail('');
      await refresh();
    } catch (error) {
      setInviteError(orgError(error, t));
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveMember(uid: string, label: string) {
    if (!canManage || removingUid) return;
    if (!window.confirm(t.orgs.removeMemberConfirm(label))) return;
    setRemovingUid(uid);
    setInviteNotice('');
    setInviteError('');
    try {
      await revokeOrgRole({ orgId, targetUid: uid });
      setInviteNotice(t.orgs.memberRemoved.replace('{member}', label));
      await refresh();
    } catch (error) {
      setInviteError(orgError(error, t));
    } finally {
      setRemovingUid('');
    }
  }

  async function handleInitiateTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner || transferring || !transferEmail.trim()) return;
    if (!window.confirm(t.transfer.confirmPrompt)) return;
    setTransferring(true);
    setTransferNotice('');
    setTransferErr('');
    try {
      await initiateOrgOwnershipTransfer({ orgId, email: transferEmail.trim() });
      setTransferNotice(t.transfer.pendingBanner(transferEmail.trim()));
      setTransferEmail('');
      await refresh();
    } catch (err) {
      setTransferErr(transferError(err, t));
    } finally {
      setTransferring(false);
    }
  }

  async function handleCancelTransfer() {
    if (!isOwner || transferring) return;
    setTransferring(true);
    setTransferNotice('');
    setTransferErr('');
    try {
      await cancelOrgOwnershipTransfer({ orgId });
      setTransferNotice(t.transfer.cancelled);
      await refresh();
    } catch (err) {
      setTransferErr(transferError(err, t));
    } finally {
      setTransferring(false);
    }
  }

  async function handleAcceptTransfer() {
    if (transferring) return;
    setTransferring(true);
    setTransferNotice('');
    setTransferErr('');
    try {
      await acceptOrgOwnershipTransfer({ orgId });
      setTransferNotice(t.transfer.transferred);
      await refresh();
    } catch (err) {
      setTransferErr(transferError(err, t));
    } finally {
      setTransferring(false);
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

  if (loading) {
    return (
      <div className="org-workspace-page container">
        <div className="org-workspace__loading" role="status" aria-label={t.app.loading}>
          <div className="skeleton-card" />
        </div>
      </div>
    );
  }

  if (error || !org) {
    return (
      <div className="org-workspace-page container">
        <Result ok="" error={error ? orgError(error, t) : t.orgs.errors.notFound} />
        <button
          className="btn btn--secondary org-workspace__back"
          type="button"
          onClick={() => goTo('/orgs')}
        >
          ← {t.orgs.title}
        </button>
      </div>
    );
  }

  return (
    <div className="org-workspace-page container">
      {/* Accept Pending Transfer Banner */}
      {isTransferTarget && (
        <section
          className="card org-transfer-banner"
          aria-labelledby="org-transfer-accept-title"
        >
          <h3 id="org-transfer-accept-title">{t.transfer.acceptTitle}</h3>
          <p>{t.transfer.acceptBanner(org.name)}</p>
          {transferNotice && <Result ok={transferNotice} error="" />}
          {transferErr && <Result ok="" error={transferErr} />}
          <button
            type="button"
            className="btn btn--primary"
            disabled={transferring}
            onClick={() => void handleAcceptTransfer()}
          >
            {transferring ? t.transfer.accepting : t.transfer.acceptButton}
          </button>
        </section>
      )}

      {/* Organization Hero Header */}
      <header className="org-hero">
        <div className="org-hero__info">
          <div className="org-avatar" aria-hidden="true">
            {getInitials(org.name)}
          </div>
          <div className="org-hero__details">
            <div className="org-hero__title-row">
              <h2 className="org-hero__name">{org.name}</h2>
              {role && (
                <span className={`org-badge org-badge--${role}`}>
                  {t.orgs.roles[role] ?? role}
                </span>
              )}
            </div>
            <div className="org-meta">
              <span className="org-meta__slug">/orgs/{org.slug}</span>
              {org.websiteUrl && (
                <>
                  <span className="org-meta__sep" aria-hidden="true">•</span>
                  <a
                    href={org.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="org-meta__link"
                  >
                    {org.websiteUrl.replace(/^https?:\/\//, '')} ↗
                  </a>
                </>
              )}
            </div>
            {org.description && (
              <p className="org-hero__desc">{org.description}</p>
            )}
          </div>
        </div>

        {canManage && (
          <button
            className="btn btn--primary org-hero__new-event-btn"
            type="button"
            onClick={() => goTo(`/new?orgId=${org.slug}`)}
          >
            + {t.orgs.newEventButton}
          </button>
        )}
      </header>

      {/* Segmented Tab Navigation */}
      <nav className="org-tabs" role="tablist" aria-label={t.orgs.sectionsLabel}>
        <button
          role="tab"
          id="org-tab-events"
          aria-controls="org-panel-events"
          aria-selected={tab === 'events'}
          tabIndex={tab === 'events' ? 0 : -1}
          className={`org-tab ${tab === 'events' ? 'org-tab--active' : ''}`}
          onClick={() => setTab('events')}
          onKeyDown={(event) => moveTab(event, 'events')}
        >
          {t.orgs.eventsTab}
          <span className="org-tab__count">{events.length}</span>
        </button>
        {role && (
          <button
            role="tab"
            id="org-tab-members"
            aria-controls="org-panel-members"
            aria-selected={tab === 'members'}
            tabIndex={tab === 'members' ? 0 : -1}
            className={`org-tab ${tab === 'members' ? 'org-tab--active' : ''}`}
            onClick={() => setTab('members')}
            onKeyDown={(event) => moveTab(event, 'members')}
          >
            {t.orgs.membersTab}
          </button>
        )}
        {canManage && (
          <button
            role="tab"
            id="org-tab-settings"
            aria-controls="org-panel-settings"
            aria-selected={tab === 'settings'}
            tabIndex={tab === 'settings' ? 0 : -1}
            className={`org-tab ${tab === 'settings' ? 'org-tab--active' : ''}`}
            onClick={() => setTab('settings')}
            onKeyDown={(event) => moveTab(event, 'settings')}
          >
            {t.orgs.settingsTab}
          </button>
        )}
      </nav>

      {/* Events Tab */}
      {tab === 'events' && (
        <div id="org-panel-events" role="tabpanel" aria-labelledby="org-tab-events">
          {events.length === 0 ? (
            <div className="card org-empty-card">
              <h3 className="org-empty-card__title">{t.orgs.noEvents}</h3>
              <p className="org-empty-card__text">{t.orgs.noEventsHelp}</p>
              {canManage && (
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={() => goTo(`/new?orgId=${org.slug}`)}
                >
                  + {t.orgs.newEventButton}
                </button>
              )}
            </div>
          ) : (
            <div className="org-grid">
              {events.map((event) => (
                <article key={event.id} className="org-card">
                  <div className="org-card__content">
                    <div className="org-card__topline">
                      <h3 className="org-card__title">{event.name}</h3>
                      <span className="org-badge">
                        {event.archived ? t.orgs.eventArchived : t.orgs.eventActive}
                      </span>
                    </div>
                    <span className="org-card__slug">/c/{event.id}</span>
                  </div>
                  <div className="org-card__footer">
                    <button
                      className="btn btn--ghost btn--sm"
                      type="button"
                      onClick={() => goTo(`/c/${event.id}`)}
                    >
                      {t.nav.cfp} ↗
                    </button>
                    {event.canAdmin && (
                      <button
                        className="btn btn--secondary btn--sm"
                        type="button"
                        onClick={() => goTo(`/c/${event.id}/admin`)}
                      >
                        {t.nav.admin} →
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Members Tab */}
      {tab === 'members' && role && (
        <div
          id="org-panel-members"
          role="tabpanel"
          aria-labelledby="org-tab-members"
          className="org-workspace-tab-content"
        >
          <section className="card org-section-card" aria-labelledby="members-list-heading">
            <h3 id="members-list-heading" className="org-section-card__title">
              {t.orgs.membersListTitle}
            </h3>
            <ul className="people" aria-label={t.orgs.membersListTitle}>
              {members.map((member) => {
                const label = member.name || member.email;
                const removable = isOwner
                  ? member.role !== 'owner' && member.uid !== user?.uid
                  : isAdmin
                    ? member.role === 'member'
                    : false;
                return (
                  <li key={member.uid} className="people__row">
                    <div>
                      <strong>{label}</strong>
                      {member.name && <div className="muted">{member.email}</div>}
                    </div>
                    <div className="card__actions">
                      <span className={`org-badge org-badge--${member.role}`}>
                        {t.orgs.roles[member.role]}
                      </span>
                      {removable && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={Boolean(removingUid)}
                          onClick={() => void handleRemoveMember(member.uid, label)}
                        >
                          {removingUid === member.uid
                            ? t.orgs.removingMember
                            : t.orgs.removeMember}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {canManage && (
            <section className="card org-section-card" aria-labelledby="invite-member-heading">
              <h3 id="invite-member-heading" className="org-section-card__title">
                {t.orgs.inviteMemberTitle}
              </h3>
              <p className="org-section-card__help">{t.orgs.inviteMemberHelp}</p>
              {inviteNotice && <Result ok={inviteNotice} error="" />}
              {inviteError && <Result ok="" error={inviteError} />}
              <form onSubmit={handleInviteMember}>
                <div className="grid grid--2 org-invite-grid">
                  <TextField
                    label={t.orgs.memberEmailLabel}
                    type="email"
                    placeholder="teammate@example.org"
                    value={inviteEmail}
                    onChange={(val) => setInviteEmail(val)}
                    required
                    disabled={inviting}
                  />
                  {isOwner ? (
                    <SelectField
                      label={t.orgs.memberRoleLabel}
                      value={inviteRole}
                      options={[
                        { value: 'member', label: t.orgs.roles.member },
                        { value: 'admin', label: t.orgs.roles.admin },
                      ]}
                      onChange={(val) => setInviteRole(val as OrgRole)}
                      required
                      disabled={inviting}
                    />
                  ) : (
                    <TextField
                      label={t.orgs.memberRoleLabel}
                      value={t.orgs.roles.member}
                      onChange={() => {}}
                      disabled
                    />
                  )}
                </div>
                <button
                  className="btn btn--primary"
                  type="submit"
                  disabled={inviting || !inviteEmail.trim()}
                >
                  {inviting ? t.orgs.inviting : t.orgs.inviteButton}
                </button>
              </form>
            </section>
          )}

          {isOwner && (
            <section className="card org-section-card" aria-labelledby="org-transfer-heading">
              <h3 id="org-transfer-heading" className="org-section-card__title">
                {t.transfer.title}
              </h3>
              <p className="org-section-card__help">
                {t.transfer.initiateHelp.replace('{scope}', org.name)}
              </p>
              {transferNotice && <Result ok={transferNotice} error="" />}
              {transferErr && <Result ok="" error={transferErr} />}
              {pendingTransfer ? (
                <div>
                  <p>
                    <strong>{t.transfer.pendingBanner(pendingTransfer.targetEmail)}</strong>
                  </p>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={transferring}
                    onClick={() => void handleCancelTransfer()}
                  >
                    {transferring ? t.transfer.cancelling : t.transfer.cancelButton}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleInitiateTransfer}>
                  <div className="org-form-stack">
                    <TextField
                      label={t.transfer.emailLabel}
                      help={t.transfer.emailHelp}
                      type="email"
                      placeholder="successor@example.org"
                      value={transferEmail}
                      onChange={(val) => setTransferEmail(val)}
                      required
                      disabled={transferring}
                    />
                    <div>
                      <button
                        className="btn btn--primary"
                        type="submit"
                        disabled={transferring || !transferEmail.trim()}
                      >
                        {transferring ? t.transfer.initiating : t.transfer.initiateButton}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </section>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {tab === 'settings' && canManage && (
        <div
          id="org-panel-settings"
          role="tabpanel"
          aria-labelledby="org-tab-settings"
          className="org-workspace-tab-content"
        >
          <section className="card org-section-card" aria-labelledby="org-settings-heading">
            <h3 id="org-settings-heading" className="org-section-card__title">
              {t.orgs.settingsTitle}
            </h3>
            {settingsNotice && <Result ok={settingsNotice} error="" />}
            {settingsError && <Result ok="" error={settingsError} />}
            <form onSubmit={handleSaveSettings}>
              <div className="org-form-stack">
                <TextField
                  label={t.orgs.nameLabel}
                  value={name}
                  onChange={(val) => setName(val)}
                  required
                />
                <TextField
                  label={t.orgs.descriptionLabel}
                  value={description}
                  onChange={(val) => setDescription(val)}
                />
                <TextField
                  label={t.orgs.websiteLabel}
                  placeholder="https://example.org"
                  value={websiteUrl}
                  onChange={(val) => setWebsiteUrl(val)}
                />
                <TextField
                  label={t.orgs.logoUrlLabel}
                  placeholder="https://example.org/logo.png"
                  value={logoUrl}
                  onChange={(val) => setLogoUrl(val)}
                />
                <div className="org-form-stack__actions">
                  <button className="btn btn--primary" type="submit" disabled={savingSettings}>
                    {savingSettings ? t.orgs.savingSettings : t.orgs.saveSettings}
                  </button>
                </div>
              </div>
            </form>
          </section>

          {isOwner && (
            <section
              className="card org-section-card org-danger-zone"
              aria-labelledby="org-delete-heading"
            >
              <h3 id="org-delete-heading" className="org-danger-zone__title">
                {t.orgs.deleteTitle}
              </h3>
              <p className="org-danger-zone__help">{t.orgs.deleteHelp}</p>
              {deleteError && <Result ok="" error={deleteError} />}
              <form onSubmit={handleDeleteOrg}>
                <div className="org-form-stack">
                  <TextField
                    label={t.orgs.deleteConfirm(org.slug)}
                    placeholder={org.slug}
                    value={deleteConfirmSlug}
                    onChange={(val) => setDeleteConfirmSlug(val)}
                    required
                    disabled={deleting}
                  />
                  <div>
                    <button
                      className="btn btn--danger"
                      type="submit"
                      disabled={deleting || deleteConfirmSlug.trim() !== org.slug}
                    >
                      {deleting ? t.orgs.deleting : t.orgs.deleteButton}
                    </button>
                  </div>
                </div>
              </form>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
