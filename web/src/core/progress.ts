import { ALPHABET, promptLetters } from '../../../shared/armenian.ts';
import type {
  AttemptEvent,
  LearnerState,
  Presentation,
} from '../../../shared/types.ts';
import { TRAINER_CONFIG as config } from './config.ts';
import { FONTS } from './settings.ts';

const countsAsCorrect = (attempt: AttemptEvent) =>
  attempt.payload.correct &&
  (!attempt.payload.flashMode || attempt.payload.flashRevealed);
const fontAttemptWindow = 50;
const minimumFontLetterObservations = 3;
const minimumFontLetterGapPercent = 20;

function letterObservations(attempts: readonly AttemptEvent[]) {
  const byLetter = new Map<string, number[]>();
  for (const attempt of attempts) {
    const byAttempt = new Map<string, number>();
    for (const unit of attempt.payload.evaluation.units) {
      if (unit.observation === null) continue;
      for (const letter of promptLetters(
        [...unit.source],
        attempt.payload.presentation?.caseMode ?? 'caps',
      )) {
        const previous = byAttempt.get(letter);
        if (previous === undefined || unit.observation < previous)
          byAttempt.set(letter, unit.observation);
      }
    }
    for (const [letter, observation] of byAttempt) {
      const observations = byLetter.get(letter) ?? [];
      observations.push(observation);
      byLetter.set(letter, observations);
    }
  }
  return byLetter;
}

export const countCorrectAnswers = (attempts: AttemptEvent[]) =>
  attempts.filter(countsAsCorrect).length;

export function progress(state: LearnerState) {
  const letters = Object.values(state.letters),
    attempts = state.recent;
  const ordinaryAttempts = attempts.filter(
    (attempt) => !(attempt.payload.flashMode && !attempt.payload.flashRevealed),
  );
  const flashAttempts = attempts.filter((attempt) => attempt.payload.flashMode);
  const unrevealedFlashAttempts = flashAttempts.filter(
    (attempt) => !attempt.payload.flashRevealed,
  );
  const revealedFlashAttempts = flashAttempts.filter(
    (attempt) => attempt.payload.flashRevealed,
  );
  const visibleFontIds = new Set(FONTS.map((font) => font.id));
  const accuracy = (items: AttemptEvent[]) =>
    items.length
      ? items.filter((a) => a.payload.correct).length / items.length
      : null;
  const recentFontAttempts = ordinaryAttempts
    .filter((attempt) =>
      visibleFontIds.has(attempt.payload.fontId ?? 'default'),
    )
    .slice(0, fontAttemptWindow);
  const fontStats = Object.entries(
    recentFontAttempts.reduce<Record<string, AttemptEvent[]>>(
      (byFont, attempt) => {
        const fontId = attempt.payload.fontId ?? 'default';
        byFont[fontId] ??= [];
        byFont[fontId].push(attempt);
        return byFont;
      },
      {},
    ),
  ).map(([fontId, fontAttempts]) => {
    const fontLetters = letterObservations(fontAttempts);
    const otherFontLetters = letterObservations(
      recentFontAttempts.filter((attempt) => attempt.payload.fontId !== fontId),
    );
    return {
      fontId,
      attempts: fontAttempts.length,
      accuracy: accuracy(fontAttempts),
      lowerAccuracyLetters: [...fontLetters].flatMap(
        ([letter, observations]) => {
          const comparison = otherFontLetters.get(letter) ?? [];
          if (
            observations.length < minimumFontLetterObservations ||
            comparison.length < minimumFontLetterObservations
          )
            return [];
          const observedCorrect = observations.reduce(
            (sum, value) => sum + value,
            0,
          );
          const comparisonCorrect = comparison.reduce(
            (sum, value) => sum + value,
            0,
          );
          return (comparisonCorrect * observations.length -
            observedCorrect * comparison.length) *
            100 >=
            observations.length *
              comparison.length *
              minimumFontLetterGapPercent
            ? [letter]
            : [];
        },
      ),
    };
  });
  const typographyStats = Object.values(
    ordinaryAttempts.reduce<
      Record<
        string,
        {
          caseMode: Presentation['caseMode'];
          italic: boolean;
          events: AttemptEvent[];
        }
      >
    >((groups, attempt) => {
      const presentation = attempt.payload.presentation ?? {
        caseMode: 'caps',
        italic: false,
      };
      const key = `${presentation.caseMode}:${presentation.italic}`;
      groups[key] ??= { ...presentation, events: [] };
      groups[key].events.push(attempt);
      return groups;
    }, {}),
  ).map(({ caseMode, italic, events }) => ({
    caseMode,
    italic,
    attempts: events.length,
    accuracy: accuracy(events),
  }));
  return {
    introduced: letters.filter((l) => l.attempts > 0).length,
    strong: letters.filter(
      (l) => l.score >= config.strongThreshold && l.verified > 0,
    ).length,
    averageScore: letters.length
      ? letters.reduce((sum, l) => sum + l.score, 0) / letters.length
      : 0,
    alphabetStats: ALPHABET.map(({ upper }) => {
      const stat = state.letters[upper];
      const introduced = Boolean(stat?.attempts);
      const score = stat?.score ?? 0;
      return {
        letter: upper,
        score,
        introduced,
        state: !introduced
          ? 'new'
          : score >= config.strongThreshold
            ? 'strong'
            : score >= config.alphabetLearningThreshold
              ? 'learning'
              : 'weak',
      } as const;
    }),
    accuracy: accuracy(ordinaryAttempts),
    verifiedAccuracy: accuracy(
      ordinaryAttempts.filter(
        (a) => a.payload.familiarity <= config.verificationFamiliarityThreshold,
      ),
    ),
    rolling20: accuracy(ordinaryAttempts.slice(0, 20)),
    rolling50: accuracy(ordinaryAttempts.slice(0, 50)),
    weakLetters: Object.entries(state.letters)
      .filter(([, s]) => s.score < config.strongThreshold)
      .sort((a, b) => a[1].score - b[1].score)
      .slice(0, 8)
      .map(([l]) => l),
    fontStats,
    typographyStats,
    flashStats: {
      attempts: unrevealedFlashAttempts.length,
      unrevealed: unrevealedFlashAttempts.length,
      revealed: revealedFlashAttempts.length,
      accuracy: accuracy(unrevealedFlashAttempts),
      unrevealedAccuracy: accuracy(unrevealedFlashAttempts),
    },
    flashRevealedStats: {
      attempts: revealedFlashAttempts.length,
      accuracy: accuracy(revealedFlashAttempts),
    },
  };
}
