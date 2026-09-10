export const LANGUAGE_PREFERENCES = ['auto', 'ru', 'en'] as const;

export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];
export type Locale = Exclude<LanguagePreference, 'auto'>;
