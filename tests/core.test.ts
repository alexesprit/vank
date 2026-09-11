import { describe, expect, it } from 'vitest';
import { ALPHABET, deriveWord } from '../shared/armenian';
import type { LearnerState, Word } from '../shared/types';
import { evaluate, normalizeAnswer } from '../web/src/core/answer-checker';
import { TRAINER_CONFIG as config } from '../web/src/core/config';
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
  const state = bootstrapState(config.bootstrapSuccessfulWords, 12);
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
  it('treats fillers as one unknown pronunciation unit', () => {
    const latin = evaluate(word('ՇՈՒՆ'), '_un');
    expect(latin.units.map((u) => u.observation)).toEqual([0, 1, 1]);
    expect(latin.distance).toBe(1);
    expect(latin.alignment[0]).toMatchObject({ expected: 'sh', actual: '_' });

    expect(
      evaluate(word('ՁՈՒԿ'), '_ук').units.map((u) => u.observation),
    ).toEqual([0, 1, 1]);
    for (const filler of ['-', '*'])
      expect(
        evaluate(word('ՇՈՒՆ'), `${filler}un`).units.map((u) => u.observation),
      ).toEqual([0, 1, 1]);
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
  it('discounts familiar evidence without lowering correctly read letters', () => {
    const w = word('ՏԱՔՍԻ', 1),
      state = known([w], 0.5);
    const next = updateScores(state, w, evaluate(w, 'таксо'), 100);
    expect(next.letters.Տ.score).toBeCloseTo(0.51875);
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

    const completed = completeAttempt(
      known([w], 0.8),
      { word: w, phase: 'training' },
      '',
      true,
      'client',
      0,
      200,
      'skip',
    );
    expect(completed.state.letters.Շ).toMatchObject({
      score: 0.68,
      attempts: 11,
      correct: 9,
      lastMistakeAt: 200,
    });
    expect(completed.state.words[w.id]).toMatchObject({
      attempts: 1,
      correct: 0,
    });
    expect(completed.attempt.payload.evaluation.status).toBe('unknown');
  });
});

describe('adaptive selection', () => {
  it('bootstraps with recognizable loanwords only', () => {
    const native = { ...word('ՄԱՄԱ', 1), loanwordScore: 0 };
    const words = [native, word('ԽՈՀԱՆՈՑ', 0.05), word('ՏԱՔՍԻ', 1)];
    expect(selectWord(words, empty(), 0, () => 0).word.word).toBe('ՏԱՔՍԻ');
    expect(selectWord(words, empty(), 0, () => 0).phase).toBe('bootstrap');
  });
  it('prefers bootstrap words sharing letters with the previous word', () => {
    const previous = word('ԹԱՄ', 1);
    const shared = word('ՄԱՐ', 0.82);
    const independent = word('ԲՈ', 1);
    const state = completeAttempt(
      empty(),
      { word: previous, phase: 'bootstrap' },
      previous.readingLatin,
      false,
      'client',
      0,
      1,
      'attempt',
    ).state;
    const selected = selectWord(
      [previous, shared, independent],
      state,
      2,
      () => 0,
    );
    expect(selected.word.id).toBe(shared.id);
  });
  it('randomizes equally ranked bootstrap words', () => {
    const words = [word('ԳԱԶ', 1), word('ԶԱԼ', 1)];
    expect(selectWord(words, empty(), 0, () => 0).word.word).toBe('ԳԱԶ');
    expect(selectWord(words, empty(), 0, () => 0.999).word.word).toBe('ԶԱԼ');
  });
  it('retains the selection decision for diagnostics', () => {
    const words = [word('ԳԱԶ', 1), word('ԶԱԼ', 1)];
    const selected = selectWord(words, empty(), 0, () => 0);
    expect(selected.diagnostics).toMatchObject({
      bootstrap: true,
      unknownLetters: selected.word.uniqueLetters,
      candidates: { dictionary: 2, unseen: 2, loanwords: 2, eligible: 2 },
      selected: { wordId: selected.word.id },
    });
    expect(selected.diagnostics?.alternatives).toHaveLength(1);
    expect(
      Object.values(selected.diagnostics?.selected.components ?? {}).reduce(
        (sum, component) => sum + component,
        0,
      ),
    ).toBeCloseTo(selected.diagnostics?.selected.priority ?? 0);
  });
  it('requires bootstrap thresholds to finish bootstrap', () => {
    const words = Array.from(
      { length: config.bootstrapSuccessfulWords + 1 },
      (_, i) => ({
        ...word('ԳԱԶ', 1),
        id: `word-${i}`,
      }),
    );
    const state = bootstrapState(config.bootstrapSuccessfulWords - 1, 12);
    expect(selectWord(words, state, 0, () => 0).phase).toBe('bootstrap');
    state.words[`done-${config.bootstrapSuccessfulWords - 1}`] = {
      attempts: 1,
      correct: 1,
      lastSeenAt: 0,
    };
    expect(selectWord(words, state, 0, () => 0).phase).not.toBe('bootstrap');
    delete state.letters[ALPHABET[11].upper];
    expect(selectWord(words, state, 0, () => 0).phase).toBe('bootstrap');
  });
  it('injects familiar words periodically after bootstrap', () => {
    const familiar = { ...word('ԳԱԶ', 1), id: 'familiar-1' };
    const unfamiliar = { ...word('ՆԱՄ', 0.05), id: 'unfamiliar-1' };
    const filler = { ...word('ՏԱՔՍԻ', 0.05), id: 'filler' };
    let state = bootstrapState(config.bootstrapSuccessfulWords, 12);
    for (let i = 0; i < config.familiarInjectionInterval; i++) {
      state = completeAttempt(
        state,
        { word: filler, phase: 'training' },
        filler.readingLatin,
        false,
        'client',
        i,
        i + 1,
        `attempt-${i}`,
      ).state;
    }
    const selected = selectWord([familiar, unfamiliar], state, 10, () => 0);
    expect(selected.word).toBe(familiar);
  });
  it('does not inject familiar words before the interval elapses', () => {
    const familiar = { ...word('ԳԱԶ', 1), id: 'familiar-2' };
    const unfamiliar = { ...word('ՆԱՄ', 0.05), id: 'unfamiliar-2' };
    const filler = { ...word('ՏԱՔՍԻ', 0.05), id: 'filler-2' };
    let state = bootstrapState(config.bootstrapSuccessfulWords, 12);
    for (let i = 0; i < config.familiarInjectionInterval - 1; i++) {
      state = completeAttempt(
        state,
        { word: filler, phase: 'training' },
        filler.readingLatin,
        false,
        'client',
        i,
        i + 1,
        `before-${i}`,
      ).state;
    }
    const selected = selectWord([familiar, unfamiliar], state, 10, () => 0);
    expect(selected.diagnostics?.candidates.afterFamiliarInjection).toBe(
      selected.diagnostics?.candidates.afterReinforcement,
    );
  });
  it('resets familiar-word interval after a familiar attempt', () => {
    const familiar = { ...word('ԳԱԶ', 1), id: 'familiar-3' };
    const unfamiliar = { ...word('ՆԱՄ', 0.05), id: 'unfamiliar-3' };
    const filler = { ...word('ՏԱՔՍԻ', 0.05), id: 'filler-3' };
    let state = bootstrapState(config.bootstrapSuccessfulWords, 12);
    for (let i = 0; i < config.familiarInjectionInterval; i++) {
      state = completeAttempt(
        state,
        { word: filler, phase: 'training' },
        filler.readingLatin,
        false,
        'client',
        i,
        i + 1,
        `reset-before-${i}`,
      ).state;
    }
    const selected = selectWord([familiar, unfamiliar], state, 10, () => 0);
    expect(selected.diagnostics?.candidates.afterFamiliarInjection).toBe(1);

    state = completeAttempt(
      state,
      { word: familiar, phase: 'training' },
      familiar.readingLatin,
      false,
      'client',
      config.familiarInjectionInterval,
      config.familiarInjectionInterval + 1,
      'familiar-attempt',
    ).state;
    state = completeAttempt(
      state,
      { word: filler, phase: 'training' },
      filler.readingLatin,
      false,
      'client',
      config.familiarInjectionInterval + 1,
      config.familiarInjectionInterval + 2,
      'after-familiar',
    ).state;

    const reset = selectWord([familiar, unfamiliar], state, 12, () => 0);
    expect(reset.diagnostics?.candidates.afterFamiliarInjection).toBe(
      reset.diagnostics?.candidates.afterReinforcement,
    );
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
  it('throws when no post-bootstrap word fits the introduction limit', () => {
    expect(() =>
      selectWord(
        [word('ՖՔ')],
        bootstrapState(config.bootstrapSuccessfulWords, 12),
        0,
      ),
    ).toThrow('Dictionary has no words within the one-new-letter limit');
  });
  it('falls back to regular candidates when reinforcement has no match', () => {
    const candidate = word('ՄԱՄԱ', 1),
      state = known([candidate]);
    state.reinforcement = { letter: 'Է', remaining: 3 };
    const selected = selectWord([candidate], state, 0);
    expect(selected.word).toBe(candidate);
    expect(selected.phase).toBe('training');
    expect(selected.diagnostics?.candidates.afterReinforcement).toBe(1);
  });
  it('allows the latest word when it is the only candidate', () => {
    const candidate = word('ՄԱՄԱ', 1),
      state = completeAttempt(
        known([candidate]),
        { word: candidate, phase: 'training' },
        candidate.readingLatin,
        false,
        'client',
        0,
        1,
        'attempt',
      ).state;
    const selected = selectWord([candidate], state, 2);
    expect(selected.word).toBe(candidate);
    expect(selected.diagnostics?.candidates.afterRecentExclusion).toBe(1);
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
  it('offers a familiar word after two failed verification words', () => {
    const familiar = word('ԲԱՆԿ', 1),
      native = [word('ԵՍ', 0.05), word('ՆԱ', 0.05)],
      state = known([familiar, ...native]);
    state.reinforcement = { letter: 'Ե', remaining: 3 };
    let next = completeAttempt(
      state,
      { word: native[0], phase: 'verification' },
      '',
      true,
      'c',
      0,
      1,
      'a',
    ).state;
    next = completeAttempt(
      next,
      { word: native[1], phase: 'verification' },
      '_',
      false,
      'c',
      2,
      3,
      'b',
    ).state;
    expect(selectWord([familiar, ...native], next, 4).word).toBe(familiar);
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

it('reports every Armenian letter with an introduced mastery state', () => {
  const state = empty();
  state.letters = {
    Ա: { score: 0.8, attempts: 1, correct: 1, lastSeenAt: 1, verified: 1 },
    Բ: { score: 0.65, attempts: 1, correct: 1, lastSeenAt: 1, verified: 0 },
    Գ: { score: 0.5, attempts: 1, correct: 0, lastSeenAt: 1, verified: 0 },
  };
  const stats = progress(state).alphabetStats;
  expect(stats).toHaveLength(ALPHABET.length);
  expect(stats.slice(0, 4)).toMatchObject([
    { letter: 'Ա', introduced: true, state: 'strong', score: 0.8 },
    { letter: 'Բ', introduced: true, state: 'learning', score: 0.65 },
    { letter: 'Գ', introduced: true, state: 'weak', score: 0.5 },
    { letter: 'Դ', introduced: false, state: 'new', score: 0 },
  ]);
});

it('does not label an unambiguous unit mistake ambiguous just because a digraph has two edit paths', () => {
  const result = evaluate(word('ԱՂ'), 'ax');
  expect(result.status).toBe('incorrect');
  expect(result.units.map((u) => u.observation)).toEqual([1, 0]);
});
