import { expect, it } from 'vitest';
import { ALPHABET, deriveWord } from '../shared/armenian';
import type { LearnerState, Word } from '../shared/types';
import {
  ACHIEVEMENT_DEFINITIONS,
  type AchievementUnlock,
  evaluateAchievements,
  validateAchievementDictionary,
} from '../web/src/core/achievements';
import { completeAttempt } from '../web/src/core/session';
import {
  orderAchievements,
  revealHiddenAchievements,
} from '../web/src/ui/achievements-view';

const empty = (): LearnerState => ({ letters: {}, words: {}, recent: [] });
const known = (word: string, familiarity = 0.2): Word => ({
  ...deriveWord(word),
  familiarity: { ru: familiarity },
});
function completeHistory(
  entries: readonly { word: Word; correct: boolean }[],
  practiceMode?: 'toponyms' | 'countries',
  idPrefix = 'attempt',
) {
  let state = empty();
  return entries.map(({ word, correct }, index) => {
    const completed = completeAttempt(
      state,
      { word, phase: 'training' },
      correct ? word.readingLatin : '',
      !correct,
      'client',
      index,
      index + 1,
      `${idPrefix}-${index}`,
      'default',
      { caseMode: 'caps', italic: false },
      undefined,
      undefined,
      practiceMode,
    );
    state = completed.state;
    return completed.attempt;
  });
}

it('validates final dictionary prerequisites for achievements', () => {
  const knownWord = (word: string, familiarity = 0.1) => ({
    ...deriveWord(word),
    familiarity: { ru: familiarity },
  });
  const dictionary = [
    knownWord('ԲԱՐԵՎ'),
    knownWord('ԵՐԵՎԱՆ'),
    knownWord(ALPHABET.map(({ upper }) => upper).join('')),
    ...ALPHABET.map(({ upper }) => knownWord(upper)),
  ];

  expect(() => validateAchievementDictionary(dictionary)).not.toThrow();
  expect(() =>
    validateAchievementDictionary([knownWord('ԲԱՐԵՎ', 0.2)]),
  ).toThrow('Achievement prerequisites unavailable');
});

it('keeps every Part 1 achievement in the stable catalogue', () => {
  expect(ACHIEVEMENT_DEFINITIONS.map((definition) => definition.id)).toEqual([
    'training-wheels-off',
    'alphabet-observed',
    'first-strong-letter',
    'ten-strong-letters',
    'half-alphabet',
    'backslide',
    'phoenix-letter',
    'read-dont-guess',
    'flash-reader',
    'first-flash-hit',
    'barev-world',
    'yerevan',
    'first-landmark',
    'local-guide',
    'passport-stamped',
    'border-reader',
    'armenia-neighbors',
    'no-more-freebies',
    'redemption-arc',
    'no-repeats',
    'cold-read',
    'sixth-sense',
  ]);
  expect(
    ACHIEVEMENT_DEFINITIONS.every((definition) => definition.version > 0),
  ).toBe(true);
});

it('reveals hidden achievements only for Ctrl/Cmd review clicks', () => {
  expect(revealHiddenAchievements({ ctrlKey: false, metaKey: false })).toBe(
    false,
  );
  expect(revealHiddenAchievements({ ctrlKey: true, metaKey: false })).toBe(
    true,
  );
  expect(revealHiddenAchievements({ ctrlKey: false, metaKey: true })).toBe(
    true,
  );
});

it('lists newest unlocks before visible and then hidden locked achievements', () => {
  const unlock = (id: AchievementUnlock['id'], earnedAt: number) => ({
    id,
    definitionVersion: 1,
    earnedAt,
    recordedAt: earnedAt,
    triggerAttemptId: id,
    evidence: {},
  });
  const ordered = orderAchievements([
    unlock('no-repeats', 100),
    unlock('training-wheels-off', 200),
  ]);

  expect(ordered.slice(0, 2).map(({ definition }) => definition.id)).toEqual([
    'training-wheels-off',
    'no-repeats',
  ]);
  expect(
    ordered
      .filter(({ definition, unlock }) => !unlock && !definition.hidden)
      .map(({ definition }) => definition.id),
  ).toEqual(
    ACHIEVEMENT_DEFINITIONS.filter((definition) => !definition.hidden)
      .filter(
        (definition) =>
          definition.id !== 'training-wheels-off' &&
          definition.id !== 'no-repeats',
      )
      .map((definition) => definition.id),
  );
  expect(
    ordered
      .filter(({ definition, unlock }) => !unlock && definition.hidden)
      .map(({ definition }) => definition.id),
  ).toEqual(
    ACHIEVEMENT_DEFINITIONS.filter((definition) => definition.hidden).map(
      (definition) => definition.id,
    ),
  );
});

it('uses persisted flash baselines and can unlock matching definitions together', () => {
  const word = known('ԲԱՐԵՎ');
  const completed = completeAttempt(
    empty(),
    { word, phase: 'bootstrap' },
    word.readingLatin,
    false,
    'client',
    100,
    200,
    'flash-1',
    'default',
    { caseMode: 'caps', italic: false },
    undefined,
    {
      baseExposureMs: 3_000,
      exposureMs: 3_500,
      visibleDurationMs: 3_500,
      revealed: false,
    },
  );

  expect(completed.attempt.payload.flashBaseExposureMs).toBe(3_000);
  expect(evaluateAchievements([completed.attempt], [])).toMatchObject([
    { id: 'training-wheels-off', triggerAttemptId: 'flash-1' },
    { id: 'first-flash-hit', triggerAttemptId: 'flash-1' },
    { id: 'barev-world', triggerAttemptId: 'flash-1' },
  ]);
});

it('unlocks ԲԱՐԵՎ on its first correct reading after earlier failures', () => {
  const word = known('ԲԱՐԵՎ');
  const attempts = completeHistory([
    { word, correct: false },
    { word, correct: true },
  ]);

  expect(
    evaluateAchievements(attempts, []).find(
      (unlock) => unlock.id === 'barev-world',
    ),
  ).toMatchObject({ triggerAttemptId: 'attempt-1' });
});

it('unlocks ԵՐԵՎԱՆ on its first correct reading after earlier failures', () => {
  const word = known('ԵՐԵՎԱՆ');
  const attempts = completeHistory([
    { word, correct: false },
    { word, correct: true },
  ]);

  expect(
    evaluateAchievements(attempts, []).find(
      (unlock) => unlock.id === 'yerevan',
    ),
  ).toMatchObject({ triggerAttemptId: 'attempt-1' });
});

it('unlocks location achievements from mode-specific readings', () => {
  const toponyms = Array.from({ length: 20 }, (_, index) => ({
    word: { ...known(index === 0 ? 'ՍԵՎԱՆ' : 'ՄԱ'), id: `toponym-${index}` },
    correct: true,
  }));
  const countries = [
    'ԻՐԱՆ',
    'ԹՈՒՐՔԻԱ',
    'ՎՐԱՍՏԱՆ',
    'ԱԴՐԲԵՋԱՆ',
    ...Array.from({ length: 16 }, () => 'ՄԱ'),
  ].map((word, index) => ({
    word: { ...known(word), id: `country-${index}` },
    correct: true,
  }));
  const attempts = [
    ...completeHistory(toponyms, 'toponyms'),
    ...completeHistory(countries, 'countries', 'country'),
  ];
  const unlocks = evaluateAchievements(attempts, []);

  expect(unlocks.map((unlock) => unlock.id)).toEqual(
    expect.arrayContaining([
      'first-landmark',
      'local-guide',
      'passport-stamped',
      'border-reader',
      'armenia-neighbors',
    ]),
  );
  expect(unlocks.find((unlock) => unlock.id === 'local-guide')).toMatchObject({
    triggerAttemptId: 'attempt-19',
    evidence: { count: 20 },
  });
  expect(
    unlocks.find((unlock) => unlock.id === 'armenia-neighbors'),
  ).toMatchObject({ triggerAttemptId: 'country-3' });
});

it('requires 20 distinct successful readings in the matching location mode', () => {
  const toponyms = Array.from({ length: 20 }, (_, index) => ({
    word: { ...known('ՄԱ'), id: `toponym-${index}` },
    correct: true,
  }));
  const nineteenToponyms = evaluateAchievements(
    completeHistory(toponyms.slice(0, 19), 'toponyms'),
    [],
  ).map((unlock) => unlock.id);
  expect(nineteenToponyms).not.toContain('local-guide');

  const duplicateToponyms = evaluateAchievements(
    completeHistory([...toponyms.slice(0, 19), toponyms[0]], 'toponyms'),
    [],
  ).map((unlock) => unlock.id);
  expect(duplicateToponyms).not.toContain('local-guide');

  const wrongMode = evaluateAchievements(
    completeHistory(toponyms, 'countries'),
    [],
  ).map((unlock) => unlock.id);
  expect(wrongMode).not.toEqual(
    expect.arrayContaining(['first-landmark', 'local-guide']),
  );

  const incorrect = evaluateAchievements(
    completeHistory(
      [{ ...toponyms[0], correct: false }, ...toponyms.slice(1)],
      'toponyms',
    ),
    [],
  ).map((unlock) => unlock.id);
  expect(incorrect).not.toContain('local-guide');

  expect(
    evaluateAchievements(
      completeHistory(toponyms.slice(0, 19), 'countries'),
      [],
    ).map((unlock) => unlock.id),
  ).not.toContain('border-reader');
});

it('unlocks cold-read and sixth-sense after earlier failed attempts', () => {
  const coldRead = known('ՄԱ');
  const sixthSense = known('ԱԲԳԴԵԶ');
  const attempts = completeHistory([
    { word: coldRead, correct: false },
    { word: coldRead, correct: true },
    { word: sixthSense, correct: false },
    { word: sixthSense, correct: true },
  ]);
  const unlocks = evaluateAchievements(attempts, []);

  expect(unlocks.find((unlock) => unlock.id === 'cold-read')).toMatchObject({
    triggerAttemptId: 'attempt-1',
  });
  expect(unlocks.find((unlock) => unlock.id === 'sixth-sense')).toMatchObject({
    triggerAttemptId: 'attempt-3',
  });
});

it('does not reconstruct flash-reader baselines from effective exposure', () => {
  const word = known('ՄԱՄԱ');
  const baseAttempt = completeAttempt(
    empty(),
    { word, phase: 'bootstrap' },
    word.readingLatin,
    false,
    'client',
    1,
    2,
    'template',
  ).attempt;
  const flashAttempts = Array.from({ length: 10 }, (_, index) => ({
    ...baseAttempt,
    id: `flash-${index}`,
    timestamp: index,
    payload: {
      ...baseAttempt.payload,
      flashMode: true,
      flashExposureMs: 3_000,
      flashRevealed: false,
    },
  }));

  expect(
    evaluateAchievements(flashAttempts, []).map((unlock) => unlock.id),
  ).not.toContain('flash-reader');
  expect(
    evaluateAchievements(
      flashAttempts.map((attempt) => ({
        ...attempt,
        payload: { ...attempt.payload, flashBaseExposureMs: 3_000 },
      })),
      [],
    ).map((unlock) => unlock.id),
  ).toContain('flash-reader');
});

it('keeps unlocked definitions skipped and preserves catalogue unlock order', () => {
  const word = known('ԲԱՐԵՎ');
  const attempt = completeAttempt(
    empty(),
    { word, phase: 'bootstrap' },
    word.readingLatin,
    false,
    'client',
    1,
    2,
    'flash',
    'default',
    { caseMode: 'caps', italic: false },
    undefined,
    { baseExposureMs: 3_000, exposureMs: 3_500, revealed: false },
  ).attempt;
  const existing: AchievementUnlock = {
    id: 'training-wheels-off',
    definitionVersion: 1,
    earnedAt: 2,
    recordedAt: 3,
    triggerAttemptId: attempt.id,
    evidence: {},
  };

  expect(
    evaluateAchievements([attempt], [existing]).map((unlock) => unlock.id),
  ).toEqual(['first-flash-hit', 'barev-world']);
});

it('replays score transitions for regression and recovery achievements', () => {
  const word = known('ՄԱՄԱ');
  let state = empty();
  const attempts = [];
  for (let index = 0; index < 12; index++) {
    const completed = completeAttempt(
      state,
      { word, phase: 'verification' },
      word.readingLatin,
      false,
      'client',
      index,
      index + 1,
      `correct-${index}`,
    );
    state = completed.state;
    attempts.push(completed.attempt);
  }
  for (let index = 0; index < 2; index++) {
    const completed = completeAttempt(
      state,
      { word, phase: 'training' },
      '',
      true,
      'client',
      20 + index,
      21 + index,
      `incorrect-${index}`,
    );
    state = completed.state;
    attempts.push(completed.attempt);
  }
  for (let index = 0; index < 10; index++) {
    const completed = completeAttempt(
      state,
      { word, phase: 'verification' },
      word.readingLatin,
      false,
      'client',
      30 + index,
      31 + index,
      `recovery-${index}`,
    );
    state = completed.state;
    attempts.push(completed.attempt);
  }

  const ids = evaluateAchievements(attempts, []).map((unlock) => unlock.id);
  expect(ids).toContain('first-strong-letter');
  expect(ids).toContain('backslide');
  expect(ids).toContain('phoenix-letter');
});

it('derives alphabet observation from stored prompt units', () => {
  const words = ALPHABET.map((letter) => known(letter.upper));
  let state = empty();
  const attempts = words.map((word, index) => {
    const completed = completeAttempt(
      state,
      { word, phase: 'introduction' },
      '',
      true,
      'client',
      index,
      index + 1,
      `letter-${index}`,
    );
    state = completed.state;
    return completed.attempt;
  });

  expect(
    evaluateAchievements(attempts, []).map((unlock) => unlock.id),
  ).toContain('alphabet-observed');
});

it('unlocks the strong-letter count milestones at their definition thresholds', () => {
  const words = ALPHABET.slice(0, 19).map((letter) => known(letter.upper));
  const attempts = completeHistory(
    words.flatMap((word) =>
      Array.from({ length: 12 }, () => ({ word, correct: true })),
    ),
  );
  const ids = evaluateAchievements(attempts, []).map((unlock) => unlock.id);

  expect(ids).toContain('ten-strong-letters');
  expect(ids).toContain('half-alphabet');
});

it('evaluates the remaining sequential and reading definitions', () => {
  const failed = { ...known('ՄԱ'), id: 'failed' };
  const recovered = { ...failed };
  const unfamiliar = known('ԱԲ', 0.19);
  const atThreshold = known('ԳԴ', 0.2);
  const seenM = { ...known('Մ'), id: 'seen-m' };
  const seenA = { ...known('Ա'), id: 'seen-a' };
  const cold = { ...known('ՄԱ'), id: 'cold' };
  const sixthSense = known('ԱԲԳԴԵԶ');
  const distinct = Array.from({ length: 20 }, (_, index) => ({
    ...known('ՄՆ'),
    id: `distinct-${index}`,
  }));
  const attempts = completeHistory([
    { word: failed, correct: false },
    { word: recovered, correct: true },
    ...Array.from({ length: 10 }, () => ({
      word: known('ԼԵ', 0.4),
      correct: true,
    })),
    ...Array.from({ length: 15 }, () => ({ word: unfamiliar, correct: true })),
    { word: atThreshold, correct: true },
    { word: seenM, correct: false },
    { word: seenA, correct: false },
    { word: cold, correct: true },
    { word: sixthSense, correct: true },
    ...distinct.map((word) => ({ word, correct: true })),
  ]);
  const ids = evaluateAchievements(attempts, []).map((unlock) => unlock.id);

  expect(ids).toEqual(
    expect.arrayContaining([
      'read-dont-guess',
      'no-more-freebies',
      'redemption-arc',
      'no-repeats',
      'cold-read',
      'sixth-sense',
    ]),
  );
  expect(
    evaluateAchievements(
      completeHistory(
        Array.from({ length: 15 }, () => ({
          word: atThreshold,
          correct: true,
        })),
      ),
      [],
    ).map((unlock) => unlock.id),
  ).not.toContain('no-more-freebies');
});
