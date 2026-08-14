'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { useI18n } from '../i18n/context';
import {
  applyTheme,
  clearThemePreference,
  resolveTheme,
  setThemePreference,
  storedTheme,
  type Theme,
} from '../lib/theme';

type ThemePreference = Theme | 'system';

function ThemeIcon({ theme }: { theme: Theme }) {
  return theme === 'dark' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.2 15.2A8.3 8.3 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v2M12 19.5v2M4.3 4.3l1.4 1.4M18.3 18.3l1.4 1.4M2.5 12h2M19.5 12h2M4.3 19.7l1.4-1.4M18.3 5.7l1.4-1.4" />
    </svg>
  );
}

export function PreferencesMenu() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [preference, setPreference] = useState<ThemePreference | null>(null);
  const [resolvedTheme, setResolvedTheme] = useState<Theme | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    const stored = storedTheme();
    const resolved = resolveTheme(stored);
    applyTheme(resolved);
    setPreference(stored ?? 'system');
    setResolvedTheme(resolved);
  }, []);

  useEffect(() => {
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const followSystem = (event: MediaQueryListEvent) => {
      const next = event.matches ? 'dark' : 'light';
      applyTheme(next);
      setResolvedTheme(next);
    };
    media.addEventListener('change', followSystem);
    return () => media.removeEventListener('change', followSystem);
  }, [preference]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      requestAnimationFrame(() => trigger.current?.focus());
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [open]);

  function chooseTheme(next: ThemePreference) {
    const resolved = next === 'system' ? resolveTheme(null) : next;
    if (next === 'system') clearThemePreference();
    else setThemePreference(next);
    applyTheme(resolved);
    setPreference(next);
    setResolvedTheme(resolved);
  }

  const theme = resolvedTheme ?? 'light';

  return (
    <div className="preferences-menu" ref={root}>
      <button
        type="button"
        ref={trigger}
        className="preferences-menu__trigger"
        aria-label={t.preferences.open}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{locale.toUpperCase()}</span>
        <span className="preferences-menu__divider" aria-hidden="true" />
        <span className="preferences-menu__theme-icon">
          <ThemeIcon theme={theme} />
        </span>
      </button>

      {open && (
        <div className="preferences-menu__panel" id={panelId}>
          <p className="preferences-menu__eyebrow">{t.preferences.title}</p>
          <div className="preferences-menu__group">
            <span>{t.preferences.language}</span>
            <div className="preferences-menu__choices">
              <button
                type="button"
                aria-pressed={locale === 'en'}
                onClick={() => setLocale('en')}
              >
                {t.preferences.english}
              </button>
              <button
                type="button"
                aria-pressed={locale === 'fr'}
                onClick={() => setLocale('fr')}
              >
                {t.preferences.french}
              </button>
            </div>
          </div>
          <div className="preferences-menu__group">
            <span>{t.preferences.appearance}</span>
            <div className="preferences-menu__choices preferences-menu__choices--themes">
              {(['system', 'light', 'dark'] as const).map((option) => (
                <button
                  type="button"
                  key={option}
                  aria-pressed={preference === option}
                  onClick={() => chooseTheme(option)}
                >
                  {t.preferences.themes[option]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
