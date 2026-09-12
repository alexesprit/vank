import { ALPHABET } from '../../../shared/armenian.ts';
import type { CaseMode, Presentation } from '../../../shared/types.ts';
import {
  LANGUAGE_PREFERENCES,
  type LanguagePreference,
} from '../i18n/types.ts';
import {
  DEFAULT_PRACTICE_MODE,
  getPracticeMode,
  type PracticeModeId,
} from './modes.ts';

const googleStylesheet = (family: string) =>
  `https://fonts.googleapis.com/css2?family=${family.replaceAll(' ', '+')}:wght@700&display=swap`;
const canonicalArmenianPattern = /^[Ա-Ֆ]+$/u;

export const SYLLABLE_COLOR_THRESHOLDS = [0, 2, 3, 4] as const;
export type SyllableColorThreshold = (typeof SYLLABLE_COLOR_THRESHOLDS)[number];

export interface FontOption {
  id: string;
  family: string;
  readability: number;
  unlockAfterCorrect: number;
  stylesheet?: string;
  source: string;
  license: string;
}

export const FONTS: FontOption[] = [
  {
    id: 'noto-sans-armenian',
    family: '"Noto Sans Armenian", sans-serif',
    readability: 1,
    unlockAfterCorrect: 0,
    stylesheet: googleStylesheet('Noto Sans Armenian'),
    source: 'https://fonts.google.com/noto/specimen/Noto+Sans+Armenian',
    license: 'https://openfontlicense.org/open-font-license-official-text/',
  },
  {
    id: 'noto-serif-armenian',
    family: '"Noto Serif Armenian", serif',
    readability: 2,
    unlockAfterCorrect: 40,
    stylesheet: googleStylesheet('Noto Serif Armenian'),
    source: 'https://fonts.google.com/noto/specimen/Noto+Serif+Armenian',
    license: 'https://openfontlicense.org/open-font-license-official-text/',
  },
  {
    id: 'iosevka-charon',
    family: '"Iosevka Charon", monospace',
    readability: 3,
    unlockAfterCorrect: 60,
    stylesheet: googleStylesheet('Iosevka Charon'),
    source: 'https://fonts.google.com/specimen/Iosevka+Charon',
    license: 'https://openfontlicense.org/open-font-license-official-text/',
  },
];

export interface AppSettings {
  analytics: boolean;
  language: LanguagePreference;
  practiceMode: PracticeModeId;
  metadataHints: boolean;
  syllableColors: SyllableColorThreshold;
  flash: {
    enabled: boolean;
    exposureMs: number;
  };
  fonts: {
    mode: 'single' | 'rotate';
    selected: string;
    enabled: string[];
  };
  typography: {
    mode: 'single' | 'rotate';
    selected: string;
    enabled: string[];
  };
}

export const TYPOGRAPHY_MODES = [
  {
    id: 'caps',
    caseMode: 'caps',
    italic: false,
    unlockAfterCorrect: 0,
  },
  {
    id: 'normal',
    caseMode: 'normal',
    italic: false,
    unlockAfterCorrect: 0,
  },
  {
    id: 'lower',
    caseMode: 'lower',
    italic: false,
    unlockAfterCorrect: 0,
  },
  {
    id: 'caps-italic',
    caseMode: 'caps',
    italic: true,
    unlockAfterCorrect: 40,
  },
  {
    id: 'normal-italic',
    caseMode: 'normal',
    italic: true,
    unlockAfterCorrect: 40,
  },
  {
    id: 'lower-italic',
    caseMode: 'lower',
    italic: true,
    unlockAfterCorrect: 40,
  },
] satisfies Array<{
  id: string;
  caseMode: CaseMode;
  italic: boolean;
  unlockAfterCorrect: number;
}>;

export const DEFAULT_PRESENTATION = {
  caseMode: 'caps',
  italic: false,
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  // Existing installations keep analytics off until the learner opts in.
  analytics: false,
  language: 'auto',
  practiceMode: DEFAULT_PRACTICE_MODE,
  metadataHints: false,
  syllableColors: 0,
  flash: {
    enabled: false,
    exposureMs: 3000,
  },
  fonts: {
    mode: 'single',
    selected: 'noto-sans-armenian',
    enabled: FONTS.map((font) => font.id),
  },
  typography: {
    mode: 'single',
    selected: 'caps',
    enabled: TYPOGRAPHY_MODES.map((mode) => mode.id),
  },
};

export function parseSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object')
    return structuredClone(DEFAULT_SETTINGS);
  const saved = value as {
    analytics?: unknown;
    fonts?: unknown;
    language?: unknown;
    practiceMode?: unknown;
    metadataHints?: unknown;
    syllableColors?: unknown;
    flash?: unknown;
    typography?: unknown;
  };
  const fonts = saved.fonts;
  if (!fonts || typeof fonts !== 'object')
    return structuredClone(DEFAULT_SETTINGS);
  const candidate = fonts as Partial<AppSettings['fonts']>;
  const ids = new Set(FONTS.map((font) => font.id));
  const retiredIds = new Set(['default', 'google-sans', 'handjet']);
  const selectedCandidate: unknown = candidate.selected;
  const enabledCandidates: unknown = candidate.enabled;
  const isKnownFontId = (id: unknown): id is string =>
    typeof id === 'string' && (ids.has(id) || retiredIds.has(id));
  if (
    !['single', 'rotate'].includes(candidate.mode ?? '') ||
    !isKnownFontId(selectedCandidate) ||
    !Array.isArray(enabledCandidates) ||
    !enabledCandidates.every(isKnownFontId)
  )
    return structuredClone(DEFAULT_SETTINGS);
  const selectedFont = ids.has(selectedCandidate)
    ? selectedCandidate
    : FONTS[0].id;
  const enabledFonts = [
    ...new Set(enabledCandidates.map((id) => (ids.has(id) ? id : FONTS[0].id))),
  ];
  const typography = saved.typography;
  const parsedTypography = (() => {
    if (!typography || typeof typography !== 'object')
      return structuredClone(DEFAULT_SETTINGS.typography);
    const candidate = typography as Partial<AppSettings['typography']>;
    const ids = new Set(TYPOGRAPHY_MODES.map((mode) => mode.id));
    if (
      !['single', 'rotate'].includes(candidate.mode ?? '') ||
      !ids.has(candidate.selected ?? '') ||
      !Array.isArray(candidate.enabled) ||
      !candidate.enabled.every((id) => typeof id === 'string' && ids.has(id))
    )
      return structuredClone(DEFAULT_SETTINGS.typography);
    return {
      mode: candidate.mode as AppSettings['typography']['mode'],
      selected: candidate.selected as string,
      enabled: [...new Set(candidate.enabled)],
    };
  })();
  const flash =
    saved.flash && typeof saved.flash === 'object'
      ? (saved.flash as Partial<AppSettings['flash']> & {
          durationMs?: unknown;
        })
      : {};
  const rawExposureMs = flash.exposureMs ?? flash.durationMs;
  const exposureMs =
    typeof rawExposureMs === 'number' &&
    Number.isFinite(rawExposureMs) &&
    rawExposureMs >= 1000 &&
    rawExposureMs <= 10000
      ? Math.round(rawExposureMs / 1000) * 1000
      : DEFAULT_SETTINGS.flash.exposureMs;
  return {
    analytics:
      typeof saved.analytics === 'boolean'
        ? saved.analytics
        : DEFAULT_SETTINGS.analytics,
    language: LANGUAGE_PREFERENCES.includes(
      saved.language as LanguagePreference,
    )
      ? (saved.language as LanguagePreference)
      : 'auto',
    practiceMode: getPracticeMode(saved.practiceMode).id,
    metadataHints:
      typeof saved.metadataHints === 'boolean'
        ? saved.metadataHints
        : DEFAULT_SETTINGS.metadataHints,
    syllableColors:
      saved.syllableColors === true
        ? 2
        : (SYLLABLE_COLOR_THRESHOLDS.find(
            (threshold) => threshold === saved.syllableColors,
          ) ?? DEFAULT_SETTINGS.syllableColors),
    flash: {
      enabled:
        typeof flash.enabled === 'boolean'
          ? flash.enabled
          : DEFAULT_SETTINGS.flash.enabled,
      exposureMs,
    },
    fonts: {
      mode: candidate.mode as AppSettings['fonts']['mode'],
      selected: selectedFont,
      enabled: enabledFonts,
    },
    typography: parsedTypography,
  };
}

export const FLASH_UNLOCK_AFTER_CORRECT = 10;
export const FLASH_EXTRA_MS_PER_LETTER = 250;
export const FLASH_BASELINE_LETTERS = 4;
export const FLASH_MAX_EXPOSURE_MS = 12000;

export function flashExposureMs(baseMs: number, wordLength: number) {
  return Math.min(
    FLASH_MAX_EXPOSURE_MS,
    baseMs +
      Math.max(0, wordLength - FLASH_BASELINE_LETTERS) *
        FLASH_EXTRA_MS_PER_LETTER,
  );
}

export function flashAvailable(correctAnswers: number) {
  return correctAnswers >= FLASH_UNLOCK_AFTER_CORRECT;
}

export function selectTypography(
  settings: AppSettings,
  correctAnswers: number,
  random = Math.random,
): Omit<Presentation, 'fontId'> {
  const { typography } = settings;
  const available = availableTypography(correctAnswers);
  const choices =
    typography.mode === 'single'
      ? available.filter((mode) => mode.id === typography.selected)
      : available.filter((mode) => typography.enabled.includes(mode.id));
  const selected =
    choices[Math.floor(random() * choices.length)] ?? TYPOGRAPHY_MODES[0];
  return { caseMode: selected.caseMode, italic: selected.italic };
}

export const availableTypography = (correctAnswers: number) =>
  TYPOGRAPHY_MODES.filter((mode) => correctAnswers >= mode.unlockAfterCorrect);

export function formatPrompt(word: string, caseMode: CaseMode): string {
  if (!canonicalArmenianPattern.test(word)) return word;
  if (caseMode === 'caps') return word;
  const lower = word.toLocaleLowerCase('hy').replaceAll('եվ', 'և');
  return caseMode === 'normal'
    ? lower[0].toLocaleUpperCase('hy') + lower.slice(1)
    : lower;
}

export const availableFonts = (correctAnswers: number) =>
  FONTS.filter((font) => correctAnswers >= font.unlockAfterCorrect);

export function selectFont(
  settings: Pick<AppSettings, 'fonts'>,
  correctAnswers: number,
  random = Math.random,
): FontOption {
  const available = availableFonts(correctAnswers);
  if (settings.fonts.mode === 'single')
    return (
      available.find((font) => font.id === settings.fonts.selected) ?? FONTS[0]
    );
  const enabled = available.filter((font) =>
    settings.fonts.enabled.includes(font.id),
  );
  return enabled[Math.floor(random() * enabled.length)] ?? FONTS[0];
}

const loading = new Map<string, Promise<FontOption>>();

export function loadFont(font: FontOption): Promise<FontOption> {
  if (!font.stylesheet) return Promise.resolve(font);
  const cached = loading.get(font.id);
  if (cached) return cached;
  const promise = new Promise<FontOption>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = font.stylesheet as string;
    const fallback = () => {
      if (loading.get(font.id) === promise) loading.delete(font.id);
      resolve(FONTS[0]);
    };
    const timeout = window.setTimeout(fallback, 5000);
    link.onerror = () => {
      window.clearTimeout(timeout);
      fallback();
    };
    link.onload = async () => {
      try {
        const loaded = await document.fonts.load(
          `700 92px ${font.family}`,
          ALPHABET.map((letter) => letter.upper).join(''),
        );
        window.clearTimeout(timeout);
        resolve(loaded.length ? font : FONTS[0]);
      } catch {
        window.clearTimeout(timeout);
        fallback();
      }
    };
    document.head.append(link);
  });
  loading.set(font.id, promise);
  return promise;
}
