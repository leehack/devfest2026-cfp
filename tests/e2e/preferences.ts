import type { Locator, Page } from '@playwright/test';

const triggerLabels = {
  en: 'Language and appearance preferences',
  fr: 'Préférences de langue et d’apparence',
} as const;

const themeLabels = {
  en: { system: 'System', light: 'Light', dark: 'Dark' },
  fr: { system: 'Système', light: 'Clair', dark: 'Sombre' },
} as const;

export function preferencesTrigger(page: Page, locale: 'en' | 'fr' = 'en'): Locator {
  return page.getByRole('button', { name: triggerLabels[locale], exact: true });
}
export async function openPreferences(page: Page): Promise<void> {
  const locale = (await page.locator('html').getAttribute('lang')) === 'fr' ? 'fr' : 'en';
  const trigger = preferencesTrigger(page, locale);
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
}

export async function switchInterfaceLanguage(
  page: Page,
  locale: 'en' | 'fr',
): Promise<void> {
  await openPreferences(page);
  await page
    .getByRole('button', { name: locale === 'fr' ? 'Français' : 'English', exact: true })
    .click();
}

export async function selectInterfaceTheme(
  page: Page,
  theme: 'system' | 'light' | 'dark',
): Promise<Locator> {
  await openPreferences(page);
  const locale = (await page.locator('html').getAttribute('lang')) === 'fr' ? 'fr' : 'en';
  const option = page.getByRole('button', { name: themeLabels[locale][theme], exact: true });
  await option.click();
  return option;
}
