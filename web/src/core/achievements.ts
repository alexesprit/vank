import {
  ALPHABET,
  deriveWord,
  promptLetters,
  wordTokens,
} from '../../../shared/armenian.ts';
import type {
  AttemptEvent,
  LearnerState,
  Word,
} from '../../../shared/types.ts';
import { TRAINER_CONFIG } from './config.ts';
import { familiarity, updateScores } from './scoring.ts';

const barevWorldWord = 'բարև';
const yerevanWorldWord = 'երևան';
const barevWorld = deriveWord('բարև');
const yerevanWorld = deriveWord('Երևան');
const barevWorldIdentity = JSON.stringify(barevWorld.letters);
const yerevanWorldIdentity = JSON.stringify(yerevanWorld.letters);
const barevWorldId = barevWorld.id;
const yerevanWorldId = yerevanWorld.id;
const requiredWordIdentities = {
  [barevWorldWord]: barevWorldIdentity,
  [yerevanWorldWord]: yerevanWorldIdentity,
};
// ponytail: prompt-text matching; keep these spellings synced with builder/data/curated-countries.json.
const armeniaNeighborWords = new Set([
  'իրան',
  'թուրքիա',
  'վրաստան',
  'ադրբեջան',
]);

export const ACHIEVEMENT_REQUIRED_WORDS = [
  barevWorldWord,
  yerevanWorldWord,
] as const;
export const ACHIEVEMENT_DICTIONARY_REQUIREMENTS = {
  minWords: 20,
  minStrongLetters: Math.ceil(ALPHABET.length / 2),
  maxFamiliarity: TRAINER_CONFIG.verificationFamiliarityThreshold,
  maxFreebieFamiliarity: 0.2,
  minDistinctLettersInWord: 6,
} as const;

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

const targetLetters = new Set(ALPHABET.map(({ lower }) => lower));
const canonicalLetter = (letter: string) =>
  letter === 'և' ? letter : letter.toLocaleLowerCase('hy');
const visibleLetter = (letter: string) =>
  letter === 'և' ? letter : letter.toLocaleUpperCase('hy');
const stateLetter = (letter: string, caseMode: 'caps' | 'normal' | 'lower') =>
  caseMode === 'lower' ? canonicalLetter(letter) : visibleLetter(letter);

export function validateAchievementDictionary(words: readonly Word[]): void {
  const availableWords = new Set(
    words.map((word) => JSON.stringify(wordTokens(word))),
  );
  const allLetters = new Set(
    words.flatMap(({ uniqueLetters }) =>
      uniqueLetters
        .map(canonicalLetter)
        .filter((letter) => targetLetters.has(letter)),
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
        uniqueLetters
          .map(canonicalLetter)
          .filter((letter) => targetLetters.has(letter)),
      ),
  );
  const missing = ACHIEVEMENT_REQUIRED_WORDS.filter(
    (word) => !availableWords.has(requiredWordIdentities[word]),
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
        uniqueLetters
          .map(canonicalLetter)
          .filter((letter) => targetLetters.has(letter)).length >=
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

const STRONG_SCORE = 0.75;
const LEARNING_SCORE = 0.6;
const TEN_STRONG_LETTERS = 10;
const READ_DONT_GUESS_COUNT = 10;
const FLASH_READER_COUNT = 10;
const LOCATION_COUNT = 20;
const NO_MORE_FREEBIES_COUNT = 15;
const NO_REPEATS_COUNT = ACHIEVEMENT_DICTIONARY_REQUIREMENTS.minWords;
const FLASH_MAX_BASE_EXPOSURE_MS = 3_000;
const isUnrevealedFlash = (attempt: AttemptEvent) =>
  Boolean(attempt.payload.flashMode && !attempt.payload.flashRevealed);
interface AttemptFacts {
  attempt: AttemptEvent;
  caseMode: 'caps' | 'normal' | 'lower';
  correct: boolean;
  familiarity: number;
  isUnrevealedFlash: boolean;
  letters: Set<string>;
  observations: Map<string, Set<number>>;
  word: Word;
  wordText: string;
}
const replayWord = (
  attempt: AttemptEvent,
  letters: string[],
  uniqueLetters: string[],
  wordText: string,
) => {
  return {
    id: attempt.payload.wordId,
    word: wordText,
    readingLatin: attempt.payload.expected,
    acceptedLatin: [attempt.payload.expected],
    acceptedCyrillic: [attempt.payload.expected],
    letters,
    uniqueLetters,
    length: letters.length,
    categories: [],
    tags: [],
    familiarity: {
      [TRAINER_CONFIG.learnerLanguage]: attempt.payload.familiarity,
    },
  };
};

const factsFor = (attempt: AttemptEvent): AttemptFacts => {
  const caseMode = attempt.payload.presentation?.caseMode ?? 'caps';
  const letters = attempt.payload.evaluation.units.flatMap((unit) => [
    ...unit.source,
  ]);
  const uniqueLetters = [
    ...new Set(
      promptLetters(letters, caseMode)
        .map((letter) => stateLetter(letter, caseMode))
        .filter((letter) => targetLetters.has(canonicalLetter(letter))),
    ),
  ];
  const logicalLetters = new Set(uniqueLetters.map(canonicalLetter));
  const observations = new Map<string, Set<number>>();
  for (const unit of attempt.payload.evaluation.units) {
    if (unit.observation === null) continue;
    for (const rawLetter of promptLetters([...unit.source], caseMode)) {
      const letter = stateLetter(rawLetter, caseMode);
      if (!targetLetters.has(canonicalLetter(letter))) continue;
      const values = observations.get(letter) ?? new Set<number>();
      values.add(unit.observation);
      observations.set(letter, values);
    }
  }
  const canonicalLetters = letters.map(canonicalLetter);
  const wordText = canonicalLetters.join('');
  return {
    attempt,
    caseMode,
    correct: attempt.payload.correct,
    familiarity: attempt.payload.familiarity,
    isUnrevealedFlash: isUnrevealedFlash(attempt),
    letters: logicalLetters,
    observations,
    word: replayWord(attempt, canonicalLetters, uniqueLetters, wordText),
    wordText,
  };
};

const strong = (
  stat: LearnerState['letters'][string] | undefined,
  threshold: number,
) => Boolean(stat && stat.score >= threshold && stat.verified > 0);
const scoreState = (letters: LearnerState['letters'], letter: string) =>
  letters[letter] ??
  letters[canonicalLetter(letter)] ??
  letters[visibleLetter(letter)];
const strongCount = (letters: LearnerState['letters'], threshold: number) =>
  Object.values(letters).filter((stat) => strong(stat, threshold)).length;

const replayLetterScores = (
  letters: LearnerState['letters'],
  facts: AttemptFacts,
) =>
  updateScores(
    { letters, words: {}, recent: [] },
    facts.word,
    facts.attempt.payload.evaluation,
    facts.attempt.timestamp,
    facts.caseMode,
  ).letters;

interface AchievementAttemptContext {
  facts: AttemptFacts;
  beforeLetters: LearnerState['letters'];
  afterLetters: LearnerState['letters'];
}
type AchievementTracker = (
  context: AchievementAttemptContext,
) => Evidence | undefined;

const maxFamiliarity = ACHIEVEMENT_DICTIONARY_REQUIREMENTS.maxFamiliarity;
const maxFreebieFamiliarity =
  ACHIEVEMENT_DICTIONARY_REQUIREMENTS.maxFreebieFamiliarity;

const correctInMode = (facts: AttemptFacts, mode: 'toponyms' | 'countries') =>
  facts.correct && facts.attempt.payload.practiceMode === mode;
const hasObservation = (
  facts: AttemptFacts,
  letter: string,
  observation: number,
) => facts.observations.get(letter)?.has(observation) ?? false;

const createDistinctModeTracker = (
  mode: 'toponyms' | 'countries',
  count: number,
): AchievementTracker => {
  const wordIds = new Set<string>();
  return ({ facts }) => {
    if (!correctInMode(facts, mode)) return;
    wordIds.add(facts.attempt.payload.wordId);
    if (wordIds.size >= count) return { count: wordIds.size };
  };
};

interface AchievementDefinitionBase {
  /** Stable persisted ID. Never rename or reuse after release. */
  id: string;
  /** Increment when this definition's condition or thresholds change. */
  version: number;
  thresholds: AchievementThresholds;
  hidden: boolean;
  icon: string;
  createTracker: (thresholds: AchievementThresholds) => AchievementTracker;
  requiresScoreReplay?: true;
}

const achievementDefinitions = [
  {
    id: 'training-wheels-off',
    version: 1,
    thresholds: { familiarity: maxFamiliarity },
    hidden: false,
    icon: 'bike',
    createTracker:
      (thresholds) =>
      ({ facts }) =>
        facts.correct && facts.familiarity <= thresholds.familiarity
          ? { familiarity: facts.familiarity }
          : undefined,
  },
  {
    id: 'alphabet-observed',
    version: 2,
    thresholds: {},
    hidden: false,
    icon: 'languages',
    createTracker: () => {
      const seen = new Set<string>();
      return ({ facts }) => {
        for (const letter of facts.letters) seen.add(canonicalLetter(letter));
        if (seen.size === targetLetters.size)
          return { letters: [...seen].sort() };
      };
    },
  },
  {
    id: 'first-strong-letter',
    version: 1,
    thresholds: { strongScore: STRONG_SCORE },
    hidden: false,
    icon: 'badge-check',
    requiresScoreReplay: true,
    createTracker:
      (thresholds) =>
      ({ facts, beforeLetters, afterLetters }) => {
        const letter = facts.word.uniqueLetters.find(
          (item) =>
            !strong(scoreState(beforeLetters, item), thresholds.strongScore) &&
            strong(scoreState(afterLetters, item), thresholds.strongScore),
        );
        const next = letter ? scoreState(afterLetters, letter) : undefined;
        return letter && next ? { letter, score: next.score } : undefined;
      },
  },
  {
    id: 'ten-strong-letters',
    version: 1,
    thresholds: { count: TEN_STRONG_LETTERS, strongScore: STRONG_SCORE },
    hidden: false,
    icon: 'award',
    requiresScoreReplay: true,
    createTracker:
      (thresholds) =>
      ({ beforeLetters, afterLetters }) => {
        const beforeStrong = strongCount(beforeLetters, thresholds.strongScore);
        const afterStrong = strongCount(afterLetters, thresholds.strongScore);
        return beforeStrong < thresholds.count &&
          afterStrong >= thresholds.count
          ? { strong: afterStrong }
          : undefined;
      },
  },
  {
    id: 'half-alphabet',
    version: 2,
    thresholds: {
      count: ACHIEVEMENT_DICTIONARY_REQUIREMENTS.minStrongLetters,
      strongScore: STRONG_SCORE,
    },
    hidden: false,
    icon: 'chart-no-axes-column-increasing',
    requiresScoreReplay: true,
    createTracker:
      (thresholds) =>
      ({ beforeLetters, afterLetters }) => {
        const beforeStrong = strongCount(beforeLetters, thresholds.strongScore);
        const afterStrong = strongCount(afterLetters, thresholds.strongScore);
        return beforeStrong < thresholds.count &&
          afterStrong >= thresholds.count
          ? { strong: afterStrong }
          : undefined;
      },
  },
  {
    id: 'backslide',
    version: 1,
    thresholds: {
      learningScore: LEARNING_SCORE,
      strongScore: STRONG_SCORE,
    },
    hidden: true,
    icon: 'trending-down',
    requiresScoreReplay: true,
    createTracker: (thresholds) => {
      const reachedStrong = new Set<string>();
      return ({ facts, beforeLetters, afterLetters }) => {
        for (const letter of facts.word.uniqueLetters) {
          const logicalLetter = canonicalLetter(letter);
          if (strong(scoreState(beforeLetters, letter), thresholds.strongScore))
            reachedStrong.add(logicalLetter);
          const previous = scoreState(beforeLetters, letter);
          const next = scoreState(afterLetters, letter);
          if (
            reachedStrong.has(logicalLetter) &&
            previous?.score !== undefined &&
            previous.score >= thresholds.learningScore &&
            next.score < thresholds.learningScore &&
            hasObservation(facts, letter, 0)
          )
            return { letter, from: previous.score, to: next.score };
          if (strong(next, thresholds.strongScore))
            reachedStrong.add(logicalLetter);
        }
      };
    },
  },
  {
    id: 'phoenix-letter',
    version: 1,
    thresholds: {
      learningScore: LEARNING_SCORE,
      strongScore: STRONG_SCORE,
    },
    hidden: true,
    icon: 'flame',
    requiresScoreReplay: true,
    createTracker: (thresholds) => {
      const reachedStrong = new Set<string>();
      const backslid = new Set<string>();
      return ({ facts, beforeLetters, afterLetters }) => {
        for (const letter of facts.word.uniqueLetters) {
          const logicalLetter = canonicalLetter(letter);
          if (strong(scoreState(beforeLetters, letter), thresholds.strongScore))
            reachedStrong.add(logicalLetter);
          const previous = scoreState(beforeLetters, letter);
          const next = scoreState(afterLetters, letter);
          if (
            reachedStrong.has(logicalLetter) &&
            previous?.score !== undefined &&
            previous.score >= thresholds.learningScore &&
            next.score < thresholds.learningScore &&
            hasObservation(facts, letter, 0)
          )
            backslid.add(logicalLetter);
          if (
            backslid.has(logicalLetter) &&
            !strong(previous, thresholds.strongScore) &&
            strong(next, thresholds.strongScore) &&
            hasObservation(facts, letter, 1)
          )
            return { letter, score: next.score };
          if (strong(next, thresholds.strongScore))
            reachedStrong.add(logicalLetter);
        }
      };
    },
  },
  {
    id: 'read-dont-guess',
    version: 1,
    thresholds: { count: READ_DONT_GUESS_COUNT, familiarity: maxFamiliarity },
    hidden: false,
    icon: 'book-open-check',
    createTracker: (thresholds) => {
      let count = 0;
      return ({ facts }) => {
        if (facts.correct && facts.familiarity <= thresholds.familiarity)
          count++;
        if (count === thresholds.count) return { count };
      };
    },
  },
  {
    id: 'flash-reader',
    version: 1,
    thresholds: {
      count: FLASH_READER_COUNT,
      maxBaseExposureMs: FLASH_MAX_BASE_EXPOSURE_MS,
    },
    hidden: false,
    icon: 'zap',
    createTracker: (thresholds) => {
      let streak = 0;
      return ({ facts }) => {
        const match = Boolean(
          facts.isUnrevealedFlash &&
            facts.correct &&
            facts.attempt.payload.flashBaseExposureMs !== undefined &&
            facts.attempt.payload.flashBaseExposureMs <=
              thresholds.maxBaseExposureMs,
        );
        streak = match ? streak + 1 : 0;
        if (streak === thresholds.count)
          return {
            count: streak,
            maxBaseExposureMs: thresholds.maxBaseExposureMs,
          };
      };
    },
  },
  {
    id: 'first-flash-hit',
    version: 1,
    thresholds: {},
    hidden: true,
    icon: 'eye',
    createTracker:
      () =>
      ({ facts }) =>
        facts.isUnrevealedFlash && facts.correct ? {} : undefined,
  },
  {
    id: 'flash-reflex',
    version: 1,
    thresholds: {},
    hidden: false,
    icon: 'timer',
    createTracker:
      () =>
      ({ facts }) => {
        const { flashExposureMs, flashVisibleDurationMs } =
          facts.attempt.payload;
        return facts.isUnrevealedFlash &&
          facts.correct &&
          flashVisibleDurationMs !== undefined &&
          flashExposureMs !== undefined &&
          flashVisibleDurationMs < flashExposureMs
          ? {}
          : undefined;
      },
  },
  {
    id: 'barev-world',
    version: 2,
    thresholds: {},
    hidden: true,
    icon: 'hand',
    createTracker:
      () =>
      ({ facts }) =>
        facts.correct && facts.attempt.payload.wordId === barevWorldId
          ? { wordId: facts.attempt.payload.wordId }
          : undefined,
  },
  {
    id: 'yerevan',
    version: 2,
    thresholds: {},
    hidden: true,
    icon: 'map-pin',
    createTracker:
      () =>
      ({ facts }) =>
        facts.correct && facts.attempt.payload.wordId === yerevanWorldId
          ? { wordId: facts.attempt.payload.wordId }
          : undefined,
  },
  {
    id: 'first-landmark',
    version: 1,
    thresholds: {},
    hidden: false,
    icon: 'map-pin',
    createTracker:
      () =>
      ({ facts }) =>
        correctInMode(facts, 'toponyms')
          ? { wordId: facts.attempt.payload.wordId }
          : undefined,
  },
  {
    id: 'local-guide',
    version: 1,
    thresholds: { count: LOCATION_COUNT },
    hidden: false,
    icon: 'map',
    createTracker: (thresholds) =>
      createDistinctModeTracker('toponyms', thresholds.count),
  },
  {
    id: 'passport-stamped',
    version: 1,
    thresholds: {},
    hidden: false,
    icon: 'stamp',
    createTracker:
      () =>
      ({ facts }) =>
        correctInMode(facts, 'countries')
          ? { wordId: facts.attempt.payload.wordId }
          : undefined,
  },
  {
    id: 'border-reader',
    version: 1,
    thresholds: { count: LOCATION_COUNT },
    hidden: false,
    icon: 'route',
    createTracker: (thresholds) =>
      createDistinctModeTracker('countries', thresholds.count),
  },
  {
    id: 'armenia-neighbors',
    version: 1,
    thresholds: { count: armeniaNeighborWords.size },
    hidden: true,
    icon: 'compass',
    createTracker: (thresholds) => {
      const words = new Set<string>();
      return ({ facts }) => {
        if (!correctInMode(facts, 'countries')) return;
        if (!armeniaNeighborWords.has(facts.wordText)) return;
        words.add(facts.wordText);
        if (words.size >= thresholds.count) return { words: [...words].sort() };
      };
    },
  },
  {
    id: 'no-more-freebies',
    version: 1,
    thresholds: {
      count: NO_MORE_FREEBIES_COUNT,
      familiarity: maxFreebieFamiliarity,
    },
    hidden: false,
    icon: 'shield-check',
    createTracker: (thresholds) => {
      let streak = 0;
      return ({ facts }) => {
        const match =
          facts.correct && facts.familiarity < thresholds.familiarity;
        streak = match ? streak + 1 : 0;
        if (streak === thresholds.count) return { count: streak };
      };
    },
  },
  {
    id: 'redemption-arc',
    version: 1,
    thresholds: {},
    hidden: true,
    icon: 'rotate-ccw',
    createTracker: () => {
      const last = new Map<string, AttemptEvent>();
      return ({ facts }) => {
        const wordId = facts.attempt.payload.wordId;
        const previous = last.get(wordId);
        if (
          facts.correct &&
          previous !== undefined &&
          !previous.payload.correct
        )
          return { wordId, previousAttemptId: previous.id };
        last.set(wordId, facts.attempt);
      };
    },
  },
  {
    id: 'no-repeats',
    version: 1,
    thresholds: { count: NO_REPEATS_COUNT },
    hidden: false,
    icon: 'list-checks',
    createTracker: (thresholds) => {
      const window: string[] = [];
      return ({ facts }) => {
        if (!facts.correct) {
          window.length = 0;
          return;
        }
        window.push(facts.attempt.payload.wordId);
        if (window.length > thresholds.count) window.shift();
        if (
          window.length === thresholds.count &&
          new Set(window).size === thresholds.count
        )
          return { count: thresholds.count };
      };
    },
  },
  {
    id: 'cold-read',
    version: 1,
    thresholds: { familiarity: maxFamiliarity },
    hidden: true,
    icon: 'snowflake',
    createTracker: (thresholds) => {
      const letters = new Set<string>();
      return ({ facts }) => {
        if (
          facts.correct &&
          facts.familiarity <= thresholds.familiarity &&
          [...facts.letters].every((letter) => letters.has(letter))
        )
          return {
            wordId: facts.attempt.payload.wordId,
            letters: [...facts.letters],
          };
        for (const letter of facts.letters) letters.add(letter);
      };
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
    createTracker:
      (thresholds) =>
      ({ facts }) =>
        facts.correct && facts.letters.size >= thresholds.distinctLetters
          ? {
              wordId: facts.attempt.payload.wordId,
              letters: [...facts.letters],
            }
          : undefined,
  },
  {
    id: 'ev-one-letter-or-two',
    version: 2,
    thresholds: {},
    hidden: true,
    icon: 'circle-help',
    createTracker: () => {
      let oneLetterAttempt: AttemptEvent | undefined;
      let twoLetterAttempt: AttemptEvent | undefined;
      return ({ facts }) => {
        if (!facts.correct) return;
        const units = facts.attempt.payload.evaluation.units;
        if (
          (facts.caseMode === 'lower' &&
            units.some(({ source }) => source === 'և')) ||
          (facts.caseMode === 'normal' &&
            units.some(
              ({ source, position }) => source === 'և' && position > 0,
            ))
        )
          oneLetterAttempt ??= facts.attempt;
        if (
          (facts.caseMode === 'caps' &&
            units.some(({ source }) => source === 'և')) ||
          (facts.caseMode === 'normal' && units[0]?.source === 'և')
        )
          twoLetterAttempt ??= facts.attempt;
        if (oneLetterAttempt !== undefined && twoLetterAttempt !== undefined)
          return {
            oneLetterAttemptId: oneLetterAttempt.id,
            twoLetterAttemptId: twoLetterAttempt.id,
          };
      };
    },
  },
] as const satisfies readonly AchievementDefinitionBase[];

export type AchievementId = (typeof achievementDefinitions)[number]['id'];
export type AchievementDefinition = AchievementDefinitionBase & {
  id: AchievementId;
};
export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] =
  achievementDefinitions;

export function evaluateAchievements(
  attempts: readonly AttemptEvent[],
  existing: readonly AchievementUnlock[],
  recordedAt = Date.now(),
): AchievementUnlock[] {
  const unlocked = new Set(existing.map((unlock) => unlock.id));
  const trackers = ACHIEVEMENT_DEFINITIONS.filter(
    ({ id }) => !unlocked.has(id),
  ).map((definition) => ({
    definition,
    track: definition.createTracker(definition.thresholds),
    match: undefined as Match | undefined,
  }));
  if (!trackers.length) return [];

  let scoreTrackersRemaining = trackers.filter(
    ({ definition }) => definition.requiresScoreReplay,
  ).length;
  let scoreLetters: LearnerState['letters'] = {};
  let remaining = trackers.length;

  for (const attempt of attempts) {
    const facts = factsFor(attempt);
    const beforeLetters = scoreLetters;
    let afterLetters = scoreLetters;
    if (scoreTrackersRemaining && !facts.isUnrevealedFlash) {
      afterLetters = replayLetterScores(scoreLetters, facts);
      scoreLetters = afterLetters;
    }
    const context = { facts, beforeLetters, afterLetters };
    for (const tracker of trackers) {
      if (tracker.match !== undefined) continue;
      const evidence = tracker.track(context);
      if (evidence === undefined) continue;
      tracker.match = { attempt, evidence };
      remaining--;
      if (tracker.definition.requiresScoreReplay) scoreTrackersRemaining--;
    }
    if (!remaining) break;
  }

  return ACHIEVEMENT_DEFINITIONS.flatMap((definition) => {
    const tracker = trackers.find(
      ({ definition: tracked }) => tracked.id === definition.id,
    );
    const match = tracker?.match;
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
