import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../web/src/core/settings.ts';
import {
  initializeI18n,
  localizeDocument,
  resolveLocale,
  t,
} from '../web/src/i18n';
import { en } from '../web/src/i18n/en.ts';

describe('interface localization', () => {
  beforeAll(() => initializeI18n('ru', []));

  it('uses the explicit preference, browser match, then Russian fallback', () => {
    expect(resolveLocale('en', ['ru-RU'])).toBe('en');
    expect(resolveLocale('auto', ['fr-FR', 'en-US'])).toBe('en');
    expect(resolveLocale('auto', ['fr-FR'])).toBe('ru');
  });

  it('accepts supported persisted preferences and defaults old or invalid data', () => {
    expect(
      parseSettings({ ...DEFAULT_SETTINGS, language: 'en' }).language,
    ).toBe('en');
    expect(
      parseSettings({ ...DEFAULT_SETTINGS, language: 'fr' }).language,
    ).toBe('auto');
    const { language: _language, ...oldSettings } = DEFAULT_SETTINGS;
    expect(parseSettings(oldSettings).language).toBe('auto');
  });

  it('interpolates values and follows Russian plural rules', () => {
    expect(t('settings.unlockAfter', { count: 1, name: 'Handjet' })).toBe(
      'Handjet · после 1 верного ответа',
    );
    expect(t('settings.unlockAfter', { count: 2, name: 'Handjet' })).toBe(
      'Handjet · после 2 верных ответов',
    );
    expect(t('settings.unlockAfter', { count: 5, name: 'Handjet' })).toBe(
      'Handjet · после 5 верных ответов',
    );
  });

  it('defines every message referenced by the static document', () => {
    const html = readFileSync('web/index.html', 'utf8');
    const keys = [
      ...html.matchAll(
        /data-i18n(?:-aria-label|-placeholder|-title)?="([^"]+)"/g,
      ),
    ].map(([, key]) => key);
    expect(keys.every((key) => t(key) !== key)).toBe(true);
    expect(html.match(/<code>/g)).toHaveLength(3);
    expect(html).not.toContain('data-i18n="intro.partial"');
    expect(
      `${en.intro.partialPrefix} _, - ${en.intro.or} *. ${en.intro.partialSuffix}`,
    ).toBe(
      "If you don't know one letter, enter _, - or *. The other letters will still count.",
    );
  });

  it('localizes document text, attributes, placeholders, and language', () => {
    const text = { dataset: { i18n: 'actions.check' }, textContent: '' };
    const attributes = new Map<string, string>();
    const aria = {
      dataset: { i18nAriaLabel: 'actions.close' },
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
    };
    const placeholder = {
      dataset: { i18nPlaceholder: 'trainer.answer' },
      placeholder: '',
    };
    const title = {
      dataset: { i18nTitle: 'progress.strongHint' },
      title: '',
    };
    const root = {
      documentElement: { lang: '' },
      querySelectorAll: (selector: string) =>
        ({
          '[data-i18n]': [text],
          '[data-i18n-aria-label]': [aria],
          '[data-i18n-placeholder]': [placeholder],
          '[data-i18n-title]': [title],
        })[selector] ?? [],
    } as unknown as Document;

    localizeDocument('ru', root);

    expect(root.documentElement.lang).toBe('ru');
    expect(text.textContent).toBe('Проверить');
    expect(attributes.get('aria-label')).toBe('Закрыть');
    expect(placeholder.placeholder).toBe('Как читается слово?');
    expect(title.title).toBe(
      'Буквы со счётом не ниже 75% и хотя бы одной правильной попыткой в незнакомом слове.',
    );
  });

  it('switches to the English catalog', async () => {
    await initializeI18n('en', []);
    expect(t('trainer.mistakes', { mistakes: 'Մ → մ' })).toBe(
      'Pay attention to: Մ → մ',
    );
    expect(t('trainer.mapping', { mapping: 'Մ → մ' })).toBe(
      'Letter mapping: Մ → մ',
    );
    expect(t('progress.sessionWords', { count: 2 })).toBe(
      'Words this session: 2',
    );
  });
});
