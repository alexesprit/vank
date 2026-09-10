import i18next from 'i18next';
import type { CaseMode } from '../../../shared/types.ts';
import { en } from './en.ts';
import { ru } from './ru.ts';
import type { LanguagePreference, Locale } from './types.ts';

const supportedLocales = new Set<Locale>(['ru', 'en']);

export function resolveLocale(
  preference: LanguagePreference,
  browserLanguages: readonly string[],
): Locale {
  if (preference !== 'auto') return preference;
  for (const language of browserLanguages) {
    const locale = language.toLowerCase().split('-')[0] as Locale;
    if (supportedLocales.has(locale)) return locale;
  }
  return 'ru';
}

export async function initializeI18n(
  preference: LanguagePreference,
  browserLanguages: readonly string[],
) {
  const locale = resolveLocale(preference, browserLanguages);
  await i18next.init({
    fallbackLng: 'ru',
    interpolation: { escapeValue: false },
    lng: locale,
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
  });
  return locale;
}

export function localizeDocument(locale: Locale, root: Document = document) {
  root.documentElement.lang = locale;
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n;
    if (key) element.textContent = i18next.t(key);
  }
  for (const element of root.querySelectorAll<HTMLElement>(
    '[data-i18n-aria-label]',
  )) {
    const key = element.dataset.i18nAriaLabel;
    if (key) element.setAttribute('aria-label', i18next.t(key));
  }
  for (const element of root.querySelectorAll<HTMLInputElement>(
    '[data-i18n-placeholder]',
  )) {
    const key = element.dataset.i18nPlaceholder;
    if (key) element.placeholder = i18next.t(key);
  }
}

export const t = i18next.t.bind(i18next);

export const fontName = (id: string) => t(`fonts.${id}`, { defaultValue: id });

export function typographyName(caseMode: CaseMode, italic = false) {
  const mode = t(`typography.${caseMode}`);
  return italic ? t('typography.italic', { mode }) : mode;
}
