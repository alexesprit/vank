import { ALPHABET, normalizeArmenian } from './armenian.ts';
import type { Dictionary, Word } from './types.ts';
export const DICTIONARY_SCHEMA_VERSION = 1;
const armenianPattern = /^[Ա-Ֆ]+$/u;
const latinReadingPattern = /^[\p{Script=Latin}\p{M}\s'’ʼ-]+$/u;
const cyrillicReadingPattern = /^[\p{Script=Cyrillic}\p{M}\s'’ʼ-]+$/u;
const latinUnitPattern = /^[\p{Script=Latin}\p{M}'’ʼ]+$/u;
const cyrillicUnitPattern = /^[\p{Script=Cyrillic}\p{M}]+$/u;
export const CATEGORIES = [
  'everyday',
  'greetings',
  'food',
  'restaurant',
  'shopping',
  'transport',
  'signage',
  'country',
  'street',
  'place-name',
  'person-name',
  'household',
  'technology',
  'medical',
  'work',
  'education',
  'family',
  'nature',
  'animals',
  'clothing',
  'colors',
  'numbers-time',
];
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
export function strings(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((v) => typeof v === 'string' && v.trim())
  )
    throw new Error('Expected a string array');
  return value;
}
export function score(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new Error('Score must be in 0..1');
  return value;
}
export function validateMetadata(record: Record<string, unknown>): void {
  for (const key of [
    'frequencyScore',
    'loanwordScore',
    'visualDifficulty',
    'readingDifficulty',
    'usefulnessScore',
    'confidence',
  ]) {
    if (record[key] !== undefined) score(record[key]);
  }
  for (const key of ['meaning', 'familiarity']) {
    if (record[key] === undefined) continue;
    for (const [language, value] of Object.entries(object(record[key]))) {
      try {
        Intl.getCanonicalLocales(language);
      } catch {
        throw new Error(`Invalid language: ${language}`);
      }
      if (key === 'familiarity') score(value);
      else if (typeof value !== 'string' || !value.trim())
        throw new Error('Invalid meaning');
    }
  }
  if (
    record.categories !== undefined &&
    strings(record.categories).some((c) => !CATEGORIES.includes(c))
  )
    throw new Error('Invalid category');
  if (record.tags !== undefined) strings(record.tags);
}
export function parseWord(value: unknown): Word {
  const w = object(value);
  if (typeof w.id !== 'string' || !w.id.trim())
    throw new Error('Missing word ID');
  if (
    typeof w.word !== 'string' ||
    !armenianPattern.test(w.word) ||
    normalizeArmenian(w.word) !== w.word
  )
    throw new Error('Expected CAPS Armenian');
  const letters = strings(w.letters),
    unique = strings(w.uniqueLetters);
  if (
    letters.join('') !== w.word ||
    letters.some((l) => !ALPHABET.some((a) => a.upper === l)) ||
    w.length !== letters.length ||
    JSON.stringify(unique) !== JSON.stringify([...new Set(letters)])
  )
    throw new Error('Invalid letter decomposition');
  const latin = strings(w.acceptedLatin),
    cyrillic = strings(w.acceptedCyrillic);
  if (
    !latin.length ||
    !cyrillic.length ||
    typeof w.readingLatin !== 'string' ||
    !latin.includes(w.readingLatin)
  )
    throw new Error('Missing reading');
  if (
    latin.some((s) => !latinReadingPattern.test(s)) ||
    cyrillic.some((s) => !cyrillicReadingPattern.test(s))
  )
    throw new Error('Invalid reading script');
  strings(w.categories);
  strings(w.tags);
  validateMetadata(w);
  if (w.units !== undefined) {
    if (!Array.isArray(w.units) || !w.units.length)
      throw new Error('Invalid units');
    const units = w.units.map(object);
    if (
      units.map((u) => u.source).join('') !== w.word ||
      units.some(
        (u) =>
          typeof u.source !== 'string' ||
          !u.source ||
          typeof u.latin !== 'string' ||
          !latinUnitPattern.test(u.latin) ||
          typeof u.cyrillic !== 'string' ||
          !cyrillicUnitPattern.test(u.cyrillic),
      )
    )
      throw new Error('Invalid pronunciation units');
    if (
      !latin.includes(units.map((u) => u.latin).join('')) ||
      !cyrillic.includes(units.map((u) => u.cyrillic).join(''))
    )
      throw new Error('Units must describe accepted readings');
  }
  if (w.source !== undefined) {
    const source = object(w.source);
    if (typeof source.type !== 'string' || !source.type)
      throw new Error('Invalid provenance');
    for (const key of ['url', 'name', 'license'])
      if (source[key] !== undefined && typeof source[key] !== 'string')
        throw new Error('Invalid provenance');
  }
  return w as unknown as Word;
}
export function parseDictionary(value: unknown): Dictionary {
  const d = object(value);
  if ((d.schemaVersion ?? d.version) !== DICTIONARY_SCHEMA_VERSION)
    throw new Error('Unsupported dictionary schema version');
  if (
    !Number.isInteger(d.version) ||
    Number(d.version) < 1 ||
    typeof d.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(d.generatedAt))
  )
    throw new Error('Invalid dictionary version/date');
  if (!Array.isArray(d.words) || !d.words.length)
    throw new Error('Dictionary is empty');
  const words = d.words.map((value) => {
    const word = object(value);
    if (typeof word.word !== 'string') return parseWord(word);
    const letters = [...word.word];
    return parseWord({
      ...word,
      letters: word.letters ?? letters,
      uniqueLetters: word.uniqueLetters ?? [...new Set(letters)],
      length: word.length ?? letters.length,
    });
  });
  if (
    new Set(words.map((w) => w.id)).size !== words.length ||
    new Set(words.map((w) => w.word)).size !== words.length
  )
    throw new Error('Duplicate word or ID');
  return {
    version: Number(d.version),
    schemaVersion: DICTIONARY_SCHEMA_VERSION,
    generatedAt: d.generatedAt,
    words,
  };
}
