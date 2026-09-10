import { describe, expect, it } from 'vitest';
import {
  ALPHABET,
  deriveWord,
  normalizeArmenian,
  pronunciationUnits,
} from '../shared/armenian';
import { parseDictionary } from '../shared/schema';

describe('Modern Eastern Armenian domain', () => {
  it('normalizes reformed spelling and derives stable IDs, codepoints and digraphs', () => {
    expect(normalizeArmenian('  բարև  ')).toBe('ԲԱՐԵՎ');
    const word = deriveWord('խանութ');
    expect(word).toMatchObject({
      word: 'ԽԱՆՈՒԹ',
      readingLatin: 'khanut',
      acceptedCyrillic: ['ханут'],
      length: 6,
    });
    expect(word.units?.map((u) => u.source)).toEqual([
      'Խ',
      'Ա',
      'Ն',
      'ՈՒ',
      'Թ',
    ]);
    expect(deriveWord('ԽԱՆՈՒԹ').id).toBe(word.id);
    expect(word.uniqueLetters).toEqual(['Խ', 'Ա', 'Ն', 'Ո', 'Ւ', 'Թ']);
  });
  it('uses Eastern consonants and position-sensitive vowels', () => {
    for (const [word, latin, cyrillic] of [
      ['ԲԱՐԵՎ', 'barev', 'барев'],
      ['ԳԻՆԻ', 'gini', 'гини'],
      ['ԴԱՍ', 'das', 'дас'],
      ['ԾԱՌ', 'tsar', 'цар'],
      ['ՁՈՒ', 'dzu', 'дзу'],
      ['ՃԱՇ', 'chash', 'чаш'],
      ['ՋՈՒՐ', 'jur', 'джур'],
      ['ԵՍ', 'yes', 'ес'],
      ['ՈՍԿԻ', 'voski', 'воски'],
      ['ՈՒՏԵԼ', 'utel', 'утел'],
      ['ԵՎ', 'yev', 'ев'],
      ['ՕՐ', 'or', 'ор'],
    ]) {
      const units = pronunciationUnits(word);
      expect(units.map((u) => u.latin).join('')).toBe(latin);
      expect(units.map((u) => u.cyrillic).join('')).toBe(cyrillic);
    }
    expect(ALPHABET).toHaveLength(38);
  });
  it('rejects malformed and unsupported spellings', () => {
    for (const word of ['', 'taxi', 'ՏԱՔՍԻ!', 'Ա Բ', '123'])
      expect(() => deriveWord(word)).toThrow();
  });
});

describe('runtime dictionary boundary', () => {
  const dataset = () => ({
    version: 1,
    schemaVersion: 1,
    generatedAt: '2026-09-09T00:00:00Z',
    words: [deriveWord('ՏԱՔՍԻ')],
  });
  it('accepts sparse metadata, categories and additional learner languages', () => {
    const data = dataset();
    Object.assign(data.words[0], {
      meaning: { en: 'taxi' },
      familiarity: { en: 1 },
      categories: [],
      tags: [],
    });
    expect(parseDictionary(data).words[0].meaning?.en).toBe('taxi');
  });
  it('derives decomposition omitted from the runtime file', () => {
    const word = { ...deriveWord('ՏԱՔՍԻ') } as Record<string, unknown>;
    for (const field of ['letters', 'uniqueLetters', 'length'])
      delete word[field];
    expect(
      parseDictionary({ ...dataset(), words: [word] }).words[0],
    ).toMatchObject({
      letters: ['Տ', 'Ա', 'Ք', 'Ս', 'Ի'],
      uniqueLetters: ['Տ', 'Ա', 'Ք', 'Ս', 'Ի'],
      length: 5,
    });
  });
  it('rejects future schemas, duplicate IDs, invalid decomposition, scores and readings', () => {
    expect(() => parseDictionary({ ...dataset(), schemaVersion: 2 })).toThrow(
      'schema',
    );
    expect(() =>
      parseDictionary({
        ...dataset(),
        words: [deriveWord('ՏԱՔՍԻ'), deriveWord('ՏԱՔՍԻ')],
      }),
    ).toThrow();
    for (const change of [
      { letters: ['Ա'] },
      { uniqueLetters: ['Ա'] },
      { familiarity: { ru: 2 } },
      { acceptedLatin: ['ՏԱՔՍԻ'] },
      { categories: ['misc'] },
      { tags: 'x' },
      { units: [{ source: 'Ա', latin: 'a', cyrillic: 'а' }] },
    ]) {
      const data = dataset();
      Object.assign(data.words[0], change);
      expect(() => parseDictionary(data)).toThrow();
    }
  });
});
