import { ALPHABET } from '../../../shared/armenian.ts';
import type {
  AttemptEvent,
  LearnerState,
  Word,
} from '../../../shared/types.ts';
import { TRAINER_CONFIG } from './config.ts';
import { familiarity, updateScores } from './scoring.ts';

const barevWorldWord = 'ԲԱՐԵՎ';
const yerevanWorldWord = 'ԵՐԵՎԱՆ';

export const ACHIEVEMENT_REQUIRED_WORDS = [
  barevWorldWord,
  yerevanWorldWord,
] as const;
export const ACHIEVEMENT_DICTIONARY_REQUIREMENTS = {
  minWords: 20,
  minStrongLetters: 19,
  maxFamiliarity: TRAINER_CONFIG.verificationFamiliarityThreshold,
  maxFreebieFamiliarity: 0.2,
  minDistinctLettersInWord: 6,
} as const;

export const ACHIEVEMENT_IDS = [
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
  'no-more-freebies',
  'redemption-arc',
  'no-repeats',
  'cold-read',
  'sixth-sense',
] as const;

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export interface AchievementUnlock {
  id: AchievementId;
  definitionVersion: number;
  earnedAt: number;
  recordedAt: number;
  triggerAttemptId: string;
  evidence: unknown;
}

type Evidence = Record<string, number | string | string[]>;
type AchievementThresholds = Readonly<Record<string, number>>;
interface Match {
  attempt: AttemptEvent;
  evidence: Evidence;
}
interface EvaluationContext {
  attempts: readonly AttemptEvent[];
}

export interface AchievementDefinition {
  /** Stable persisted ID. Never rename or reuse after release. */
  id: AchievementId;
  /** Increment when this definition's condition or thresholds change. */
  version: number;
  thresholds: AchievementThresholds;
  hidden: boolean;
  icon: string;
  evaluate(
    context: EvaluationContext,
    thresholds: AchievementThresholds,
  ): Match | undefined;
}

const targetLetters = new Set(ALPHABET.map(({ upper }) => upper));

export function validateAchievementDictionary(words: readonly Word[]): void {
  const availableWords = new Set(words.map(({ word }) => word));
  const allLetters = new Set(
    words.flatMap(({ uniqueLetters }) =>
      uniqueLetters.filter((letter) => targetLetters.has(letter)),
    ),
  );
  const strongLetters = new Set(
    words
      .filter(
        (word) =>
          familiarity(word) <=
          ACHIEVEMENT_DICTIONARY_REQUIREMENTS.maxFamiliarity,
      )
      .flatMap(({ uniqueLetters }) =>
        uniqueLetters.filter((letter) => targetLetters.has(letter)),
      ),
  );
  const missing = ACHIEVEMENT_REQUIRED_WORDS.filter(
    (word) => !availableWords.has(word),
  );
  const failures = [
    ...(missing.length ? [`missing words: ${missing.join(', ')}`] : []),
    ...(allLetters.size < targetLetters.size
      ? [`alphabet coverage: ${allLetters.size}/${targetLetters.size}`]
      : []),
    ...(strongLetters.size <
    ACHIEVEMENT_DICTIONARY_REQUIREMENTS.minStrongLetters
      ? [
          `strong-letter coverage: ${strongLetters.size}/${ACHIEVEMENT_DICTIONARY_REQUIREMENTS.minStrongLetters}`,
        ]
      : []),
    ...(words.some(
      (word) =>
        familiarity(word) <
        ACHIEVEMENT_DICTIONARY_REQUIREMENTS.maxFreebieFamiliarity,
    )
      ? []
      : ['missing a word below familiarity 0.2']),
    ...(words.length < ACHIEVEMENT_DICTIONARY_REQUIREMENTS.minWords
      ? [
          `word count: ${words.length}/${ACHIEVEMENT_DICTIONARY_REQUIREMENTS.minWords}`,
        ]
      : []),
    ...(words.some(
      ({ uniqueLetters }) =>
        uniqueLetters.filter((letter) => targetLetters.has(letter)).length >=
        ACHIEVEMENT_DICTIONARY_REQUIREMENTS.minDistinctLettersInWord,
    )
      ? []
      : [
          `missing a word with ${ACHIEVEMENT_DICTIONARY_REQUIREMENTS.minDistinctLettersInWord} distinct Armenian letters`,
        ]),
  ];
  if (failures.length)
    throw new Error(
      `Achievement prerequisites unavailable: ${failures.join('; ')}`,
    );
}

const isUnrevealedFlash = (attempt: AttemptEvent) =>
  attempt.payload.flashMode && !attempt.payload.flashRevealed;
const attemptLetters = (attempt: AttemptEvent) =>
  new Set(
    attempt.payload.evaluation.units.flatMap((unit) =>
      [...unit.source].filter((letter) => targetLetters.has(letter)),
    ),
  );
const hasObservation = (
  attempt: AttemptEvent,
  letter: string,
  observation: number,
) =>
  attempt.payload.evaluation.units.some(
    (unit) => unit.source.includes(letter) && unit.observation === observation,
  );
const first = <T>(items: readonly T[], predicate: (item: T) => boolean) =>
  items.find(predicate);
const nth = <T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
  count: number,
) => {
  let found = 0;
  for (const item of items)
    if (predicate(item) && ++found === count) return item;
};
const streak = (
  attempts: readonly AttemptEvent[],
  predicate: (attempt: AttemptEvent) => boolean,
  count: number,
) => {
  let length = 0;
  for (const attempt of attempts) {
    length = predicate(attempt) ? length + 1 : 0;
    if (length === count) return attempt;
  }
};
const replayWord = (attempt: AttemptEvent) => {
  const letters = attempt.payload.evaluation.units.flatMap((unit) => [
    ...unit.source,
  ]);
  return {
    id: attempt.payload.wordId,
    word: letters.join(''),
    readingLatin: attempt.payload.expected,
    acceptedLatin: [attempt.payload.expected],
    acceptedCyrillic: [attempt.payload.expected],
    letters,
    uniqueLetters: [
      ...new Set(letters.filter((letter) => targetLetters.has(letter))),
    ],
    length: letters.length,
    categories: [],
    tags: [],
    familiarity: {
      [TRAINER_CONFIG.learnerLanguage]: attempt.payload.familiarity,
    },
  };
};

function scoreTransition(
  context: EvaluationContext,
  predicate: (
    attempt: AttemptEvent,
    before: LearnerState,
    after: LearnerState,
    word: ReturnType<typeof replayWord>,
  ) => Evidence | undefined,
) {
  let state: LearnerState = { letters: {}, words: {}, recent: [] };
  for (const attempt of context.attempts) {
    if (isUnrevealedFlash(attempt)) continue;
    const word = replayWord(attempt);
    const before = state;
    state = updateScores(
      state,
      word,
      attempt.payload.evaluation,
      attempt.timestamp,
    );
    const evidence = predicate(attempt, before, state, word);
    if (evidence) return { attempt, evidence };
  }
}

const strong = (
  stat: LearnerState['letters'][string] | undefined,
  threshold: number,
) => Boolean(stat && stat.score >= threshold && stat.verified > 0);
const strongCount = (state: LearnerState, threshold: number) =>
  Object.values(state.letters).filter((stat) => strong(stat, threshold)).length;

export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  {
    id: 'training-wheels-off',
    version: 1,
    thresholds: {
      familiarity: ACHIEVEMENT_DICTIONARY_REQUIREMENTS.maxFamiliarity,
    },
    hidden: false,
    icon: 'bike',
    evaluate: ({ attempts }, thresholds) => {
      const attempt = first(
        attempts,
        (item) =>
          item.payload.correct &&
          item.payload.familiarity <= thresholds.familiarity,
      );
      return attempt
        ? { attempt, evidence: { familiarity: attempt.payload.familiarity } }
        : undefined;
    },
  },
  {
    id: 'alphabet-observed',
    version: 1,
    thresholds: {},
    hidden: false,
    icon: 'languages',
    evaluate: ({ attempts }) => {
      const seen = new Set<string>();
      for (const attempt of attempts) {
        for (const letter of attemptLetters(attempt)) seen.add(letter);
        if (seen.size === targetLetters.size)
          return { attempt, evidence: { letters: [...seen].sort() } };
      }
    },
  },
  {
    id: 'first-strong-letter',
    version: 1,
    thresholds: { strongScore: 0.75 },
    hidden: false,
    icon: 'badge-check',
    evaluate: (context, thresholds) =>
      scoreTransition(context, (_attempt, before, after, word) => {
        const letter = word.uniqueLetters.find(
          (item) =>
            !strong(before.letters[item], thresholds.strongScore) &&
            strong(after.letters[item], thresholds.strongScore),
        );
        return letter
          ? { letter, score: after.letters[letter].score }
          : undefined;
      }),
  },
  {
    id: 'ten-strong-letters',
    version: 1,
    thresholds: { count: 10, strongScore: 0.75 },
    hidden: false,
    icon: 'award',
    evaluate: (context, thresholds) =>
      scoreTransition(context, (_attempt, before, after) =>
        strongCount(before, thresholds.strongScore) < thresholds.count &&
        strongCount(after, thresholds.strongScore) >= thresholds.count
          ? { strong: strongCount(after, thresholds.strongScore) }
          : undefined,
      ),
  },
  {
    id: 'half-alphabet',
    version: 1,
    thresholds: {
      count: ACHIEVEMENT_DICTIONARY_REQUIREMENTS.minStrongLetters,
      strongScore: 0.75,
    },
    hidden: false,
    icon: 'chart-no-axes-column-increasing',
    evaluate: (context, thresholds) =>
      scoreTransition(context, (_attempt, before, after) =>
        strongCount(before, thresholds.strongScore) < thresholds.count &&
        strongCount(after, thresholds.strongScore) >= thresholds.count
          ? { strong: strongCount(after, thresholds.strongScore) }
          : undefined,
      ),
  },
  {
    id: 'backslide',
    version: 1,
    thresholds: { learningScore: 0.6, strongScore: 0.75 },
    hidden: true,
    icon: 'trending-down',
    evaluate: (context, thresholds) => {
      const reachedStrong = new Set<string>();
      return scoreTransition(context, (attempt, before, after, word) => {
        for (const letter of word.uniqueLetters) {
          if (strong(before.letters[letter], thresholds.strongScore))
            reachedStrong.add(letter);
          const previous = before.letters[letter];
          const next = after.letters[letter];
          if (
            reachedStrong.has(letter) &&
            previous?.score !== undefined &&
            previous.score >= thresholds.learningScore &&
            next.score < thresholds.learningScore &&
            hasObservation(attempt, letter, 0)
          )
            return { letter, from: previous.score, to: next.score };
          if (strong(next, thresholds.strongScore)) reachedStrong.add(letter);
        }
      });
    },
  },
  {
    id: 'phoenix-letter',
    version: 1,
    thresholds: { learningScore: 0.6, strongScore: 0.75 },
    hidden: true,
    icon: 'flame',
    evaluate: (context, thresholds) => {
      const reachedStrong = new Set<string>();
      const backslid = new Set<string>();
      return scoreTransition(context, (attempt, before, after, word) => {
        for (const letter of word.uniqueLetters) {
          if (strong(before.letters[letter], thresholds.strongScore))
            reachedStrong.add(letter);
          const previous = before.letters[letter];
          const next = after.letters[letter];
          if (
            reachedStrong.has(letter) &&
            previous?.score !== undefined &&
            previous.score >= thresholds.learningScore &&
            next.score < thresholds.learningScore &&
            hasObservation(attempt, letter, 0)
          )
            backslid.add(letter);
          if (
            backslid.has(letter) &&
            !strong(previous, thresholds.strongScore) &&
            strong(next, thresholds.strongScore) &&
            hasObservation(attempt, letter, 1)
          )
            return { letter, score: next.score };
          if (strong(next, thresholds.strongScore)) reachedStrong.add(letter);
        }
      });
    },
  },
  {
    id: 'read-dont-guess',
    version: 1,
    thresholds: {
      count: 10,
      familiarity: ACHIEVEMENT_DICTIONARY_REQUIREMENTS.maxFamiliarity,
    },
    hidden: false,
    icon: 'book-open-check',
    evaluate: ({ attempts }, thresholds) => {
      const attempt = nth(
        attempts,
        (item) =>
          item.payload.correct &&
          item.payload.familiarity <= thresholds.familiarity,
        thresholds.count,
      );
      return attempt
        ? { attempt, evidence: { count: thresholds.count } }
        : undefined;
    },
  },
  {
    id: 'flash-reader',
    version: 1,
    thresholds: { count: 10, maxBaseExposureMs: 3_000 },
    hidden: false,
    icon: 'zap',
    evaluate: ({ attempts }, thresholds) => {
      const attempt = streak(
        attempts,
        (item) =>
          Boolean(
            isUnrevealedFlash(item) &&
              item.payload.correct &&
              item.payload.flashBaseExposureMs !== undefined &&
              item.payload.flashBaseExposureMs <= thresholds.maxBaseExposureMs,
          ),
        thresholds.count,
      );
      return attempt
        ? {
            attempt,
            evidence: {
              count: thresholds.count,
              maxBaseExposureMs: thresholds.maxBaseExposureMs,
            },
          }
        : undefined;
    },
  },
  {
    id: 'first-flash-hit',
    version: 1,
    thresholds: {},
    hidden: true,
    icon: 'eye',
    evaluate: ({ attempts }) => {
      const attempt = first(attempts, (item) =>
        Boolean(isUnrevealedFlash(item) && item.payload.correct),
      );
      return attempt ? { attempt, evidence: {} } : undefined;
    },
  },
  {
    id: 'barev-world',
    version: 1,
    thresholds: {},
    hidden: true,
    icon: 'hand',
    evaluate: ({ attempts }) => {
      const attempt = first(
        attempts,
        (item) =>
          item.payload.evaluation.units.map((unit) => unit.source).join('') ===
            barevWorldWord && item.payload.correct,
      );
      return attempt
        ? { attempt, evidence: { wordId: attempt.payload.wordId } }
        : undefined;
    },
  },
  {
    id: 'yerevan',
    version: 1,
    thresholds: {},
    hidden: true,
    icon: 'map-pin',
    evaluate: ({ attempts }) => {
      const attempt = first(
        attempts,
        (item) =>
          item.payload.evaluation.units.map((unit) => unit.source).join('') ===
            yerevanWorldWord && item.payload.correct,
      );
      return attempt
        ? { attempt, evidence: { wordId: attempt.payload.wordId } }
        : undefined;
    },
  },
  {
    id: 'no-more-freebies',
    version: 1,
    thresholds: {
      count: 15,
      familiarity: ACHIEVEMENT_DICTIONARY_REQUIREMENTS.maxFreebieFamiliarity,
    },
    hidden: false,
    icon: 'shield-check',
    evaluate: ({ attempts }, thresholds) => {
      const attempt = streak(
        attempts,
        (item) =>
          item.payload.correct &&
          item.payload.familiarity < thresholds.familiarity,
        thresholds.count,
      );
      return attempt
        ? { attempt, evidence: { count: thresholds.count } }
        : undefined;
    },
  },
  {
    id: 'redemption-arc',
    version: 1,
    thresholds: {},
    hidden: true,
    icon: 'rotate-ccw',
    evaluate: ({ attempts }) => {
      const last = new Map<string, AttemptEvent>();
      for (const attempt of attempts) {
        const previous = last.get(attempt.payload.wordId);
        if (attempt.payload.correct && previous && !previous.payload.correct)
          return {
            attempt,
            evidence: {
              wordId: attempt.payload.wordId,
              previousAttemptId: previous.id,
            },
          };
        last.set(attempt.payload.wordId, attempt);
      }
    },
  },
  {
    id: 'no-repeats',
    version: 1,
    thresholds: { count: ACHIEVEMENT_DICTIONARY_REQUIREMENTS.minWords },
    hidden: false,
    icon: 'list-checks',
    evaluate: ({ attempts }, thresholds) => {
      const window: AttemptEvent[] = [];
      for (const attempt of attempts) {
        if (!attempt.payload.correct) {
          window.length = 0;
          continue;
        }
        window.push(attempt);
        if (window.length > thresholds.count) window.shift();
        if (
          window.length === thresholds.count &&
          new Set(window.map((item) => item.payload.wordId)).size ===
            thresholds.count
        )
          return { attempt, evidence: { count: thresholds.count } };
      }
    },
  },
  {
    id: 'cold-read',
    version: 1,
    thresholds: {
      familiarity: ACHIEVEMENT_DICTIONARY_REQUIREMENTS.maxFamiliarity,
    },
    hidden: true,
    icon: 'snowflake',
    evaluate: ({ attempts }, thresholds) => {
      const letters = new Set<string>();
      for (const attempt of attempts) {
        const promptLetters = attemptLetters(attempt);
        if (
          attempt.payload.correct &&
          attempt.payload.familiarity <= thresholds.familiarity &&
          [...promptLetters].every((letter) => letters.has(letter))
        )
          return {
            attempt,
            evidence: {
              wordId: attempt.payload.wordId,
              letters: [...promptLetters],
            },
          };
        for (const letter of promptLetters) letters.add(letter);
      }
    },
  },
  {
    id: 'sixth-sense',
    version: 1,
    thresholds: {
      distinctLetters:
        ACHIEVEMENT_DICTIONARY_REQUIREMENTS.minDistinctLettersInWord,
    },
    hidden: true,
    icon: 'sparkles',
    evaluate: ({ attempts }, thresholds) => {
      for (const attempt of attempts) {
        const letters = attemptLetters(attempt);
        if (
          attempt.payload.correct &&
          letters.size >= thresholds.distinctLetters
        )
          return {
            attempt,
            evidence: { wordId: attempt.payload.wordId, letters: [...letters] },
          };
      }
    },
  },
];

export function evaluateAchievements(
  attempts: readonly AttemptEvent[],
  existing: readonly AchievementUnlock[],
  recordedAt = Date.now(),
): AchievementUnlock[] {
  const unlocked = new Set(existing.map((unlock) => unlock.id));
  const context = { attempts };
  return ACHIEVEMENT_DEFINITIONS.flatMap((definition) => {
    if (unlocked.has(definition.id)) return [];
    const match = definition.evaluate(context, definition.thresholds);
    return match
      ? [
          {
            id: definition.id,
            definitionVersion: definition.version,
            earnedAt: match.attempt.timestamp,
            recordedAt,
            triggerAttemptId: match.attempt.id,
            evidence: match.evidence,
          },
        ]
      : [];
  });
}
