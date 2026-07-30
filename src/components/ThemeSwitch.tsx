'use client';

import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../i18n/context';
import {
  applyTheme,
  resolveTheme,
  setThemePreference,
  storedTheme,
  type Theme,
} from '../lib/theme';

export function ThemeSwitch() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme | null>(null);
  const manualChoice = useRef(false);

  useEffect(() => {
    const next = resolveTheme();
    applyTheme(next);
    setTheme(next);

    if (typeof window.matchMedia !== 'function') return;
    const preference = window.matchMedia('(prefers-color-scheme: dark)');
    const followSystem = (event: MediaQueryListEvent) => {
      if (manualChoice.current || storedTheme() !== null) return;
      const systemTheme = event.matches ? 'dark' : 'light';
      applyTheme(systemTheme);
      setTheme(systemTheme);
    };
    preference.addEventListener('change', followSystem);
    return () => preference.removeEventListener('change', followSystem);
  }, []);

  const toggle = () => {
    const next = (theme ?? resolveTheme()) === 'dark' ? 'light' : 'dark';
    manualChoice.current = true;
    setThemePreference(next);
    applyTheme(next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      className="btn btn--ghost theme-toggle"
      aria-label={t.app.darkTheme}
      aria-pressed={theme === null ? undefined : theme === 'dark'}
      title={t.app.darkTheme}
      onClick={toggle}
    >
      <svg
        className="theme-toggle__icon theme-toggle__icon--light"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2.5v2M12 19.5v2M4.3 4.3l1.4 1.4M18.3 18.3l1.4 1.4M2.5 12h2M19.5 12h2M4.3 19.7l1.4-1.4M18.3 5.7l1.4-1.4" />
      </svg>
      <svg
        className="theme-toggle__icon theme-toggle__icon--dark"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M20.2 15.2A8.3 8.3 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" />
      </svg>
    </button>
  );
}
