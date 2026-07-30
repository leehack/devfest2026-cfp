import { useEffect, useId, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { useI18n } from '../i18n/context';
import { href } from '../lib/router';
import { Link } from './Link';

function initials(user: User): string {
  const parts = user.displayName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length > 1) return `${parts[0][0]}${parts.at(-1)?.[0] ?? ''}`.toUpperCase();
  const source = parts[0] || user.email?.split('@')[0] || '?';
  return source.slice(0, 2).toUpperCase();
}

export function AccountMenu({
  user,
  showProfile,
  onSignOut,
}: {
  user: User;
  showProfile: boolean;
  onSignOut: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const display = user.displayName?.trim() || user.email || t.app.account;

  useEffect(() => {
    if (!open) return;

    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }

    function closeWithKeyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        requestAnimationFrame(() => trigger.current?.focus());
      }
    }

    function closeAfterNavigation() {
      setOpen(false);
    }

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithKeyboard);
    window.addEventListener('popstate', closeAfterNavigation);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithKeyboard);
      window.removeEventListener('popstate', closeAfterNavigation);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={root}>
      <button
        type="button"
        ref={trigger}
        className="account-menu__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="account-menu__avatar" aria-hidden="true">
          {initials(user)}
        </span>
        <span className="account-menu__trigger-label">{t.app.account}</span>
        <span className="account-menu__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="account-menu__panel" id={panelId}>
          <p className="account-menu__eyebrow">{t.app.signedInAs}</p>
          <p className="account-menu__identity">{display}</p>
          {user.email && user.email !== display && (
            <p className="account-menu__email">{user.email}</p>
          )}
          <div className="account-menu__actions">
            {showProfile && (
              <Link
                className="account-menu__action"
                to={href({ route: 'me' })}
                onClick={() => setOpen(false)}
              >
                {t.profile.link}
              </Link>
            )}
            <button
              type="button"
              className="account-menu__action account-menu__action--button"
              onClick={() => {
                setOpen(false);
                void onSignOut();
              }}
            >
              {t.app.signOut}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
