import { ALPHABET } from '../../../shared/armenian.ts';

const googleStylesheet = (family: string) =>
  `https://fonts.googleapis.com/css2?family=${family.replaceAll(' ', '+')}:wght@700&display=swap`;

export interface FontOption {
  id: string;
  name: string;
  family: string;
  readability: number;
  unlockAfterAttempts: number;
  stylesheet?: string;
  source: string;
  license: string;
}

export const FONTS: FontOption[] = [
  {
    id: 'default',
    name: 'Системный',
    family: 'ui-sans-serif, system-ui, sans-serif',
    readability: 0,
    unlockAfterAttempts: 0,
    source: 'Шрифт устройства',
    license: 'Зависит от устройства',
  },
  {
    id: 'noto-sans-armenian',
    name: 'Noto Sans Armenian',
    family: '"Noto Sans Armenian", sans-serif',
    readability: 1,
    unlockAfterAttempts: 10,
    stylesheet: googleStylesheet('Noto Sans Armenian'),
    source: 'https://fonts.google.com/noto/specimen/Noto+Sans+Armenian',
    license: 'https://openfontlicense.org/open-font-license-official-text/',
  },
  {
    id: 'google-sans',
    name: 'Google Sans',
    family: '"Google Sans", sans-serif',
    readability: 1,
    unlockAfterAttempts: 20,
    stylesheet: googleStylesheet('Google Sans'),
    source: 'https://fonts.google.com/specimen/Google+Sans',
    license: 'https://openfontlicense.org/open-font-license-official-text/',
  },
  {
    id: 'noto-serif-armenian',
    name: 'Noto Serif Armenian',
    family: '"Noto Serif Armenian", serif',
    readability: 2,
    unlockAfterAttempts: 40,
    stylesheet: googleStylesheet('Noto Serif Armenian'),
    source: 'https://fonts.google.com/noto/specimen/Noto+Serif+Armenian',
    license: 'https://openfontlicense.org/open-font-license-official-text/',
  },
  {
    id: 'iosevka-charon',
    name: 'Iosevka Charon',
    family: '"Iosevka Charon", monospace',
    readability: 3,
    unlockAfterAttempts: 60,
    stylesheet: googleStylesheet('Iosevka Charon'),
    source: 'https://fonts.google.com/specimen/Iosevka+Charon',
    license: 'https://openfontlicense.org/open-font-license-official-text/',
  },
  {
    id: 'handjet',
    name: 'Handjet',
    family: 'Handjet, sans-serif',
    readability: 4,
    unlockAfterAttempts: 80,
    stylesheet: googleStylesheet('Handjet'),
    source: 'https://fonts.google.com/specimen/Handjet',
    license: 'https://openfontlicense.org/open-font-license-official-text/',
  },
];

export interface AppSettings {
  fonts: {
    mode: 'single' | 'rotate';
    selected: string;
    enabled: string[];
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  fonts: {
    mode: 'single',
    selected: 'default',
    enabled: FONTS.map((font) => font.id),
  },
};

export function parseSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object')
    return structuredClone(DEFAULT_SETTINGS);
  const fonts = (value as { fonts?: unknown }).fonts;
  if (!fonts || typeof fonts !== 'object')
    return structuredClone(DEFAULT_SETTINGS);
  const candidate = fonts as Partial<AppSettings['fonts']>;
  const ids = new Set(FONTS.map((font) => font.id));
  if (
    !['single', 'rotate'].includes(candidate.mode ?? '') ||
    !ids.has(candidate.selected ?? '') ||
    !Array.isArray(candidate.enabled) ||
    !candidate.enabled.every((id) => typeof id === 'string' && ids.has(id))
  )
    return structuredClone(DEFAULT_SETTINGS);
  return {
    fonts: {
      mode: candidate.mode as AppSettings['fonts']['mode'],
      selected: candidate.selected as string,
      enabled: [...new Set(candidate.enabled)],
    },
  };
}

export const availableFonts = (attempts: number) =>
  FONTS.filter((font) => attempts >= font.unlockAfterAttempts);

export function selectFont(
  settings: AppSettings,
  attempts: number,
  random = Math.random,
): FontOption {
  const available = availableFonts(attempts);
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
