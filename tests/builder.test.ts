import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyOverrides,
  composeDataset,
  deriveMetadata,
  mergeSources,
  validateDataset,
} from '../builder/src/pipeline';
import { curatedSource } from '../builder/src/sources/curated';
import { wiktionaryRecord } from '../builder/src/sources/wiktionary';
import { deriveWord } from '../shared/armenian';

const fixture = () =>
  readFileSync('tests/fixtures/wiktionary.jsonl', 'utf8')
    .trim()
    .split('\n')
    .map((line) =>
      wiktionaryRecord(JSON.parse(line), {
        priority: 10,
        datasetUrl: 'https://example.org/dump.jsonl',
      }),
    )
    .filter((w) => w !== null);

describe('source adapters and field-level merge', () => {
  it('admits selected names while retaining the default protection against bulk name imports', () => {
    const entry = {
      lang_code: 'hy',
      word: 'Լոնդոն',
      pos: 'name',
      senses: [{ glosses: ['London'] }],
    };
    expect(wiktionaryRecord(entry)).toBeNull();
    expect(
      wiktionaryRecord(entry, { allowedNames: new Set(['ԼՈՆԴՈՆ']) })
        ?.rawDefinitions,
    ).toEqual(['London']);
    expect(
      wiktionaryRecord(entry, { allowedNames: new Set(['ՄՈՍԿՎԱ']) }),
    ).toBeNull();
  });
  it('imports reliable Armenian lemmas and filters names, archaic, inflected, Western-only and other languages', () => {
    expect(fixture().map((w) => w.word)).toEqual(['տաքսի', 'տաքսի', 'բարև']);
    expect(fixture()[0].source).toMatchObject({
      type: 'wiktionary',
      license: 'CC-BY-SA-4.0',
    });
    expect(() => wiktionaryRecord({ word: 12, lang_code: 'hy' })).toThrow();
  });
  it('curated sources introduce new names and distrust generated technical fields', () => {
    const raw = curatedSource([
      {
        word: 'ԱՆԴՐԵՅ',
        meaning: { ru: 'Андрей' },
        categories: ['person-name'],
        letters: ['Ա'],
        id: 'fake',
      },
    ]);
    const result = deriveMetadata(mergeSources(raw).words)[0];
    expect(result.word).toBe('ԱՆԴՐԵՅ');
    expect(result.id).toBe(deriveWord('ԱՆԴՐԵՅ').id);
    expect(result.letters).toHaveLength(6);
    expect(() =>
      curatedSource([{ word: 'ԲԱՐ', familiarity: { ru: -1 } }]),
    ).toThrow();
  });
  it('deduplicates reformed CAPS and merges at field/language level with explicit priority', () => {
    const curated = curatedSource([
      {
        word: ' ՏԱՔՍԻ ',
        meaning: { ru: 'такси' },
        familiarity: { ru: 1 },
        categories: [],
        tags: ['beginner'],
      },
    ]);
    const source = fixture();
    source[0].metadata = {
      meaning: { en: 'taxi', ru: 'неправильно' },
      frequencyScore: 0.8,
      tags: ['external'],
    };
    const result = mergeSources([...curated, ...source]).words;
    expect(result).toHaveLength(2);
    const taxi = result.find((w) => w.word === 'ՏԱՔՍԻ');
    if (!taxi) throw new Error('Missing taxi fixture');
    expect(taxi.metadata).toMatchObject({
      meaning: { en: 'taxicab', ru: 'такси' },
      frequencyScore: 0.8,
      categories: [],
      tags: ['beginner'],
    });
    expect(taxi.rawDefinitions).toEqual(['taxi', 'taxicab']);
    expect(taxi.sources.map((s) => s.type)).toContain('wiktionary');
    expect(taxi.metadataSource['meaning.ru']).toBe('curated');
    expect(taxi.metadataSource['meaning.en']).toBe('wiktionary');
    expect(mergeSources([...source, ...curated]).words).toEqual(result);
  });
  it('rejects malformed spelling and records why', () => {
    const records = curatedSource([{ word: 'hello' }, { word: 'ԲԱՐ' }]);
    expect(mergeSources(records).rejected).toMatchObject([
      { word: 'hello', reason: expect.any(String) },
    ]);
  });
});

it('runs an offline end-to-end fixture with deterministic enrichment, final overrides and composition', () => {
  const raw = [
    ...fixture(),
    ...curatedSource([
      {
        word: 'ՏԱՔՍԻ',
        familiarity: { ru: 1 },
        acceptedLatin: ['taxi'],
        categories: ['transport'],
      },
      { word: 'ԱՆՆԱ', categories: ['person-name'] },
    ]),
  ];
  const words = deriveMetadata(mergeSources(raw).words);
  const taxi = words.find((w) => w.word === 'ՏԱՔՍԻ');
  if (!taxi) throw new Error('Missing taxi fixture');
  expect(taxi).toMatchObject({
    readingLatin: 'taksi',
    acceptedLatin: ['taksi', 'taxi'],
    categories: ['transport'],
    tags: [],
    transliterationVersion: 1,
  });
  const enriched = words.map((w) => ({ ...w, familiarity: { ru: 0.5 } }));
  const final = applyOverrides(enriched, {
    [taxi.id]: { familiarity: { ru: 0.2 }, tags: ['reviewed'] },
  });
  expect(final.find((w) => w.id === taxi.id)?.familiarity?.ru).toBe(0.2);
  expect(
    final.find((w) => w.id === taxi.id)?.metadataSource['familiarity.ru'],
  ).toBe('manual');
  expect(() => applyOverrides(words, { nonexistent: {} })).toThrow('override');
  const dictionary = validateDataset(
    composeDataset(final, 1000),
    '2026-09-09T00:00:00Z',
  );
  expect(dictionary.words).toHaveLength(3);
  expect(
    dictionary.words.every(
      (w) => Array.isArray(w.tags) && Array.isArray(w.categories),
    ),
  ).toBe(true);
  expect(
    composeDataset(final, 1)[0].sources.some((s) => s.type === 'curated'),
  ).toBe(true);
  expect(() => validateDataset([...final, final[0]])).toThrow();
  expect(() => validateDataset([{ ...final[0], length: 99 }])).toThrow();
});

it('filters numeral glyphs, abbreviations, alternate lemmas and dialect-only senses from the external corpus', () => {
  for (const entry of [
    {
      word: 'Ա',
      pos: 'num',
      senses: [{ glosses: ['1 in Armenian numerals'] }],
    },
    {
      word: 'ԱԱ',
      pos: 'noun',
      senses: [{ glosses: ['initialism'], tags: ['initialism'] }],
    },
    {
      word: 'ած',
      pos: 'noun',
      senses: [{ glosses: ['alternative form'], alt_of: [{ word: 'ածք' }] }],
    },
    {
      word: 'արեւ',
      pos: 'noun',
      tags: ['Western-Armenian'],
      senses: [{ glosses: ['sun'] }],
    },
  ])
    expect(wiktionaryRecord({ lang_code: 'hy', ...entry })).toBeNull();
});
