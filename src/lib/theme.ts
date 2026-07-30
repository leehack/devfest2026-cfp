export const THEME_KEY = 'cfp.theme';

export type Theme = 'light' | 'dark';

export interface ThemeStorageReader {
  getItem(key: string): string | null;
}

export interface ThemeStorageWriter {
  setItem(key: string, value: string): void;
}

const THEME_COLORS: Record<Theme, string> = {
  light: '#f8f9fb',
  dark: '#0d1117',
};

function browserStorage(): (ThemeStorageReader & ThemeStorageWriter) | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function storedTheme(
  storage: ThemeStorageReader | null = browserStorage(),
): Theme | null {
  try {
    const value = storage?.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function resolveTheme(
  preference: Theme | null = storedTheme(),
  systemDark: boolean = systemPrefersDark(),
): Theme {
  return preference ?? (systemDark ? 'dark' : 'light');
}

export function setThemePreference(
  theme: Theme,
  storage: ThemeStorageWriter | null = browserStorage(),
): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    // The selection still applies for this page; only persistence is unavailable.
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector<HTMLMetaElement>('#cfp-theme-color')?.setAttribute(
    'content',
    THEME_COLORS[theme],
  );
}

/**
 * Runs in `<head>` before the body is painted. Keeping this fixed and tiny
 * avoids a light flash for somebody who explicitly chose dark, without making
 * every route dynamic for a preference the server never needs to know.
 */
export function themeBootstrapScript(): string {
  return `(()=>{var r=document.documentElement,m=document.getElementById("cfp-theme-color"),q=()=>typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: dark)").matches,a=t=>{r.dataset.theme=t;r.style.colorScheme=t;if(m)m.setAttribute("content",t==="dark"?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)});};try{var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});a(s==="light"||s==="dark"?s:q()?"dark":"light");}catch{a(q()?"dark":"light");}})();`;
}
