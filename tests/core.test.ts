import { describe, expect, it } from 'vitest';
import { ALPHABET, deriveWord } from '../shared/armenian';
import type { LearnerState, Word } from '../shared/types';
import { evaluate, normalizeAnswer } from '../web/src/core/answer-checker';
import { updateScores } from '../web/src/core/scoring';
import { completeAttempt, progress } from '../web/src/core/session';
import {
  personalDifficulty,
  selectWord,
  unknownLetters,
} from '../web/src/core/word-selector';

const empty = (): LearnerState => ({ letters: {}, words: {}, recent: [] });
const word = (s: string, familiarity = 0.1): Word => ({
  ...deriveWord(s),
  familiarity: { ru: familiarity },
  loanwordScore: 1,
});
const bootstrapState = (
  successfulWords: number,
  knownLetters: number,
): LearnerState => ({
  letters: Object.fromEntries(
    ALPHABET.slice(0, knownLetters).map((l) => [
      l.upper,
      { score: 0.1, attempts: 1, correct: 1, lastSeenAt: 0, verified: 0 },
    ]),
  ),
  words: Object.fromEntries(
    Array.from({ length: successfulWords }, (_, i) => [
      `done-${i}`,
      { attempts: 1, correct: 1, lastSeenAt: 0 },
    ]),
  ),
  recent: [],
});
function known(words: Word[], score = 0.8): LearnerState {
  const state = bootstrapState(20, 12);
  for (const w of words)
    for (const l of w.uniqueLetters)
      state.letters[l] = {
        score,
        attempts: 10,
        correct: 9,
        lastSeenAt: 0,
        verified: 2,
      };
  return state;
}

describe('answer evaluation', () => {
  it('normalizes without transliterating arbitrary input', () => {
    expect(normalizeAnswer('  TAКSI  ')).toBe('taкsi');
    expect(normalizeAnswer('  A\t  B  ')).toBe('a b');
    expect(normalizeAnswer('E\u0301')).toBe('é');
    const taxi = { ...word('ՏԱՔՍԻ'), acceptedLatin: ['taksi', 'taxi'] };
    expect(evaluate(taxi, ' TAXI ').correct).toBe(true);
    expect(evaluate(taxi, 'ТАКСИ').correct).toBe(true);
    expect(evaluate(taxi, 'taкsi').status).toBe('ambiguous');
    expect(evaluate(taxi, ' ').status).toBe('unknown');
    expect(evaluate(taxi, 'taksi', true).status).toBe('unknown');
  });
  it('attributes a final mistake only to its unit', () => {
    const result = evaluate(word('ԽՈՀԱՆՈՑ'), 'khanots');
    expect(result.correct).toBe(false);
    const final = evaluate(word('ԽՈՀԱՆՈՑ'), 'kohanof');
    expect(final.units.at(-1)?.observation).toBe(0);
    expect(final.units.find((u) => u.source === 'Ա')?.observation).toBe(1);
    const simple = evaluate(word('ՏԱՔՍԻ'), 'таксо');
    expect(simple.status).toBe('partial');
    expect(simple.units.map((u) => u.observation)).toEqual([1, 1, 1, 1, 0]);
    expect(simple.alignment.at(-1)).toMatchObject({
      expected: 'и',
      actual: 'о',
      operation: 'replace',
    });
  });
  it('maps multichar sounds and digraphs, handles insertions/deletions', () => {
    expect(
      evaluate(word('ՇՈՒՆ'), 'shun').units.map((u) => u.observation),
    ).toEqual([1, 1, 1]);
    const insertion = evaluate(word('ՏԱՔՍԻ'), 'taaksi');
    expect(insertion.alignment.some((a) => a.operation === 'insert')).toBe(
      true,
    );
    expect(insertion.correct).toBe(false);
    expect(
      evaluate(word('ՏԱՔՍԻ'), 'tasi').units.find((u) => u.source === 'Ք')
        ?.observation,
    ).toBe(0);
  });
  it('does not invent letter evidence for unmapped accepted aliases', () => {
    const pizza = { ...word('ՊԻՑՑԱ'), acceptedLatin: ['pitstsa', 'pizza'] };
    expect(evaluate(pizza, 'pizza').correct).toBe(true);
    expect(
      evaluate(pizza, 'pizza').units.every((u) => u.observation === null),
    ).toBe(true);
    const unmapped = word('ՏԱՔՍԻ');
    delete unmapped.units;
    expect(evaluate(unmapped, 'taksi').units).toEqual([]);
  });
});

describe('learning evidence', () => {
  it('applies EMA with familiarity discount and only punishes the misread letter', () => {
    const w = word('ՏԱՔՍԻ', 1),
      state = known([w], 0.5);
    const next = updateScores(state, w, evaluate(w, 'таксо'), 100);
    expect(next.letters.Տ.score).toBeCloseTo(0.4625);
    expect(next.letters.Ի.score).toBeCloseTo(0.425);
    expect(next.letters.Ի.lastMistakeAt).toBe(100);
    expect(state.letters.Տ.score).toBe(0.5);
    const low = word('ՏԱՔՍԻ', 0);
    expect(
      updateScores(state, low, evaluate(low, 'такси'), 100).letters.Տ.score,
    ).toBeCloseTo(0.575);
  });
  it('keeps repeated glyphs to one observation per attempt and protects mastery from guesses', () => {
    const w = word('ՄԱՄԱ', 1);
    let state = empty();
    for (let i = 0; i < 50; i++)
      state = updateScores(state, w, evaluate(w, 'mama'), i);
    expect(state.letters.Մ.attempts).toBe(50);
    expect(state.letters.Մ.score).toBeLessThan(0.75);
    expect(state.letters.Մ.verified).toBe(0);
  });
  it('records exposure but no credit on skip; digraph updates both written letters', () => {
    const w = word('ՇՈՒՆ', 0);
    const state = updateScores(empty(), w, evaluate(w, 'shun'), 100);
    expect(state.letters.Ո.score).toBe(0.15);
    expect(state.letters.Ւ.score).toBe(0.15);
    const skipped = updateScores(empty(), w, evaluate(w, '', true), 100);
    expect(skipped.letters.Շ).toMatchObject({
      score: 0,
      attempts: 1,
      correct: 0,
    });
  });
});

describe('adaptive selection', () => {
  it('bootstraps with recognizable loanwords only', () => {
    const native = { ...word('ՄԱՄԱ', 1), loanwordScore: 0 };
    const words = [native, word('ԽՈՀԱՆՈՑ', 0.05), word('ՏԱՔՍԻ', 1)];
    expect(selectWord(words, empty(), 0, () => 0).word.word).toBe('ՏԱՔՍԻ');
    expect(selectWord(words, empty(), 0, () => 0).phase).toBe('bootstrap');
  });
  it('randomizes equally ranked bootstrap words', () => {
    const words = [word('ԳԱԶ', 1), word('ԶԱԼ', 1)];
    expect(selectWord(words, empty(), 0, () => 0).word.word).toBe('ԳԱԶ');
    expect(selectWord(words, empty(), 0, () => 0.999).word.word).toBe('ԶԱԼ');
  });
  it('requires 20 successful words and 12 known letters to finish bootstrap', () => {
    const words = Array.from({ length: 21 }, (_, i) => ({
      ...word('ԳԱԶ', 1),
      id: `word-${i}`,
    }));
    const state = bootstrapState(19, 12);
    expect(selectWord(words, state, 0, () => 0).phase).toBe('bootstrap');
    state.words['done-19'] = { attempts: 1, correct: 1, lastSeenAt: 0 };
    expect(selectWord(words, state, 0, () => 0).phase).not.toBe('bootstrap');
    delete state.letters[ALPHABET[11].upper];
    expect(selectWord(words, state, 0, () => 0).phase).toBe('bootstrap');
  });
  it('avoids bootstrap repeats, then falls back from loanwords to unseen native words', () => {
    const loanword = word('ԳԱԶ', 1),
      native = { ...word('ՄԱՄԱ', 0.1), loanwordScore: 0 };
    const state = empty();
    state.words[loanword.id] = { attempts: 1, correct: 0, lastSeenAt: 0 };
    expect(selectWord([loanword, native], state, 0, () => 0).word).toBe(native);
    state.words[native.id] = { attempts: 1, correct: 0, lastSeenAt: 0 };
    expect(
      selectWord([loanword, native], state, 0, () => 0).word,
    ).toBeDefined();
  });
  it('prefers weak letters over otherwise identical strong words', () => {
    const words = [word('ՄԱՄԱ'), word('ՆԱՆԱ')],
      state = known(words);
    state.letters.Ն.score = 0.1;
    expect(selectWord(words, state, 100).word.word).toBe('ՆԱՆԱ');
    expect(personalDifficulty(words[1], state)).toBeGreaterThan(
      personalDifficulty(words[0], state),
    );
  });
  it('never introduces multiple unknown letters after bootstrap', () => {
    const words = [word('ՄԱՄԱ'), word('ՆԱՆԱ'), word('ՏԱՔՍԻ', 1), word('ՄԱՍ')];
    const state = known(words.slice(0, 2));
    for (let i = 0; i < 20; i++) {
      const selected = selectWord(words, state, i);
      expect(selected.phase).not.toBe('bootstrap');
      expect(unknownLetters(selected.word, state).length).toBeLessThanOrEqual(
        1,
      );
      const result = completeAttempt(
        state,
        selected,
        selected.word.readingLatin,
        false,
        'client',
        i,
        i + 1,
        `id-${i}`,
      );
      Object.assign(state, result.state);
    }
  });
  it('avoids immediate repeats and reinforces an introduction with other words', () => {
    const words = [
      word('ՄԱՄԱ'),
      word('ՆԱՆԱ'),
      word('ՄԱՍ'),
      word('ՍԱ'),
      word('ՍԱՄ'),
    ];
    const state = known(words.slice(0, 2));
    const result = completeAttempt(
      state,
      { word: words[2], phase: 'introduction', introducedLetter: 'Ս' },
      'mas',
      false,
      'c',
      1,
      2,
      'a',
    );
    expect(result.state.reinforcement).toEqual({ letter: 'Ս', remaining: 3 });
    const selected = selectWord(words, result.state, 3);
    expect(selected.word.id).not.toBe(words[2].id);
    expect(selected.word.uniqueLetters).toContain('Ս');
    expect(selected.phase).toBe('reinforcement');
  });
});

it('creates rich immutable attempt events and real progress metrics', () => {
  const w = word('ՏԱՔՍԻ', 0.2);
  const result = completeAttempt(
    empty(),
    { word: w, phase: 'bootstrap' },
    ' такси ',
    false,
    'client-1',
    100,
    500,
    'attempt-1',
  );
  expect(result.attempt).toMatchObject({
    id: 'attempt-1',
    clientId: 'client-1',
    type: 'attempt.completed',
    schemaVersion: 1,
    timestamp: 500,
    payload: {
      wordId: w.id,
      answer: ' такси ',
      expected: 'такси',
      correct: true,
      shownAt: 100,
      answeredAt: 500,
    },
  });
  expect(result.state.words[w.id]).toMatchObject({
    attempts: 1,
    correct: 1,
    lastSeenAt: 500,
  });
  expect(progress(result.state)).toMatchObject({
    introduced: 5,
    strong: 0,
    accuracy: 1,
    verifiedAccuracy: 1,
    skips: 0,
  });
});

it('does not label an unambiguous unit mistake ambiguous just because a digraph has two edit paths', () => {
  const result = evaluate(word('ԱՂ'), 'ax');
  expect(result.status).toBe('incorrect');
  expect(result.units.map((u) => u.observation)).toEqual([1, 0]);
});
