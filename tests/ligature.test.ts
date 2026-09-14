import { describe, expect, it } from 'vitest';
import { mergeSources } from '../builder/src/pipeline';
import { runtimeDictionary } from '../builder/src/runtime';
import { curatedSource } from '../builder/src/sources/curated';
import { wiktionaryRecord } from '../builder/src/sources/wiktionary';
import { ALPHABET, deriveWord } from '../shared/armenian';
import { parseDictionary } from '../shared/schema';
import type { LearnerState } from '../shared/types';
import { evaluateAchievements } from '../web/src/core/achievements';
import { completeAttempt, progress } from '../web/src/core/session';
import { formatPrompt } from '../web/src/core/settings';

const empty = (): LearnerState => ({ letters: {}, words: {}, recent: [] });

function attempt(
  word: ReturnType<typeof deriveWord>,
  caseMode: 'caps' | 'lower',
) {
  return completeAttempt(
    empty(),
    { word, phase: 'training' },
    word.readingLatin,
    false,
    'client',
    0,
    1,
    `${word.id}-${caseMode}`,
    'default',
    { caseMode, italic: false },
  );
}

describe('Armenian ligature identity', () => {
  it('derives և as one logical letter while preserving the CAPS display', () => {
    const word = deriveWord('բարև');

    expect(word).toMatchObject({
      word: 'ԲԱՐԵՎ',
      ligaturePositions: [3],
      letters: ['Բ', 'Ա', 'Ր', 'և'],
      uniqueLetters: ['Բ', 'Ա', 'Ր', 'և'],
      length: 4,
      units: [
        { source: 'Բ' },
        { source: 'Ա' },
        { source: 'Ր' },
        { source: 'և' },
      ],
    });
    expect(deriveWord('բարեվ').ligaturePositions).toEqual([]);
    expect(word.id).not.toBe(deriveWord('բարեվ').id);
  });

  it('keeps uppercase ԵՎ as two legacy letters when no provenance is present', () => {
    const word = deriveWord('ԵՐԵՎԱՆ');

    expect(word.letters).toEqual(['Ե', 'Ր', 'Ե', 'Վ', 'Ա', 'Ն']);
    expect(word.length).toBe(6);
  });

  it('exposes և as the 39th logical alphabet entry', () => {
    expect(ALPHABET).toHaveLength(39);
    expect(ALPHABET.map(({ lower }) => lower)).toContain('և');
  });

  it('keeps word-initial և as one pronunciation unit with its Eastern reading', () => {
    const word = deriveWord('ևրան');
    expect(word).toMatchObject({
      readingLatin: 'yevran',
      acceptedCyrillic: ['евран'],
    });
    expect(word.units?.[0]).toEqual({
      source: 'և',
      latin: 'yev',
      cyrillic: 'ев',
    });
  });

  it('keeps ligature and separate-letter source spellings distinct when merging', () => {
    const words = mergeSources(
      curatedSource([{ word: 'բարև' }, { word: 'բարեվ' }]),
    ).words;

    expect(words).toHaveLength(2);
    expect(words.map(({ word }) => word)).toEqual(['ԲԱՐԵՎ', 'ԲԱՐԵՎ']);
    const positions = words.map(({ ligaturePositions }) => ligaturePositions);
    expect(positions).toContainEqual([3]);
    expect(positions).toContainEqual([]);
  });

  it('captures explicit Wiktionary ligatures and leaves title-case ԵՎ ambiguous', () => {
    const record = (word: string) => ({
      lang_code: 'hy',
      word,
      pos: 'noun',
      senses: [{ glosses: ['test'] }],
    });

    expect(wiktionaryRecord(record('բարև'))?.ligaturePositions).toEqual([3]);
    expect(wiktionaryRecord(record('Եվգենի'))).not.toHaveProperty(
      'ligaturePositions',
    );

    const ambiguous = wiktionaryRecord(record('ԲԱՐԵՎ'));
    if (!ambiguous) throw new Error('Missing Wiktionary record');
    const merged = mergeSources([
      ...curatedSource([{ word: 'բարև' }]),
      ambiguous,
    ]).words;
    expect(merged).toHaveLength(1);
    expect(merged[0]?.ligaturePositions).toEqual([3]);
  });

  it('serializes provenance and reconstructs logical fields from runtime dictionaries', () => {
    const word = deriveWord('բարև'),
      runtime = runtimeDictionary({
        version: 1,
        schemaVersion: 1,
        generatedAt: '2026-09-14T00:00:00Z',
        words: [word],
      });

    expect(runtime.words[0]).toHaveProperty('ligaturePositions', [3]);
    expect(parseDictionary(runtime).words[0]).toMatchObject({
      word: 'ԲԱՐԵՎ',
      ligaturePositions: [3],
      letters: ['Բ', 'Ա', 'Ր', 'և'],
      length: 4,
      units: expect.arrayContaining([expect.objectContaining({ source: 'և' })]),
    });
  });

  it('accepts distinct logical words with the same CAPS display', () => {
    const dictionary = {
      version: 1,
      schemaVersion: 1,
      generatedAt: '2026-09-14T00:00:00Z',
      words: [deriveWord('բարև'), deriveWord('բարեվ')],
    };

    expect(parseDictionary(dictionary).words.map(({ id }) => id)).toHaveLength(
      2,
    );
  });

  it('loads old dictionaries without positions as separate Ե and Վ letters', () => {
    const legacyWord = { ...deriveWord('ԵՎՐՈՊԱ') } as Record<string, unknown>;
    for (const field of ['letters', 'uniqueLetters', 'length'])
      delete legacyWord[field];
    const [word] = parseDictionary({
      version: 1,
      schemaVersion: 1,
      generatedAt: '2026-09-14T00:00:00Z',
      words: [legacyWord],
    }).words;
    if (!word) throw new Error('Missing legacy dictionary word');

    expect(word?.letters).toEqual(['Ե', 'Վ', 'Ր', 'Ո', 'Պ', 'Ա']);
    expect(word?.length).toBe(6);
    expect(word?.ligaturePositions).toBeUndefined();
    expect(formatPrompt(word, 'lower')).toBe('եվրոպա');
  });

  it('tracks CAPS exposure as Ե and Վ without observing և or unlocking the whole alphabet', () => {
    const caps = attempt(deriveWord('բարև'), 'caps');
    const lower = attempt(deriveWord('բարև'), 'lower');

    expect(Object.keys(caps.state.letters)).toContain('Ե');
    expect(Object.keys(caps.state.letters)).toContain('Վ');
    expect(Object.keys(caps.state.letters)).not.toContain('և');
    expect(Object.keys(lower.state.letters)).toContain('և');

    const otherLetters = ALPHABET.filter(
      ({ upper }) => !['Ե', 'Վ', 'և'].includes(upper),
    );
    const attempts = [
      ...otherLetters.map(
        (letter) => attempt(deriveWord(letter.lower), 'caps').attempt,
      ),
      caps.attempt,
    ];

    expect(
      evaluateAchievements(attempts, []).map(({ id }) => id),
    ).not.toContain('alphabet-observed');
    expect(
      evaluateAchievements(
        [...attempts, attempt(deriveWord('բարև'), 'lower').attempt],
        [],
      ).map(({ id }) => id),
    ).toContain('alphabet-observed');
  });

  it('attributes CAPS ligature observations to the visible Ե and Վ in font stats', () => {
    const sansAttempts = Array.from({ length: 3 }, (_, index) => {
      const event = attempt(deriveWord('բարև'), 'caps').attempt;
      event.id = `sans-${index}`;
      event.payload.fontId = 'noto-sans-armenian';
      if (event.payload.presentation)
        event.payload.presentation.fontId = 'noto-sans-armenian';
      event.payload.evaluation.units = event.payload.evaluation.units.map(
        (unit) => (unit.source === 'և' ? { ...unit, observation: 0 } : unit),
      );
      return event;
    });
    const serifAttempts = Array.from({ length: 3 }, (_, index) => {
      const event = attempt(deriveWord('բարև'), 'caps').attempt;
      event.id = `serif-${index}`;
      event.payload.fontId = 'noto-serif-armenian';
      if (event.payload.presentation)
        event.payload.presentation.fontId = 'noto-serif-armenian';
      return event;
    });
    const state = empty();
    state.recent = [...sansAttempts, ...serifAttempts];

    expect(progress(state).fontStats[0]?.lowerAccuracyLetters).toEqual([
      'Ե',
      'Վ',
    ]);
  });
});
