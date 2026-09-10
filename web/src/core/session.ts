import { ALPHABET } from '../../../shared/armenian.ts';
import type {
  AttemptEvent,
  LearnerState,
  Presentation,
} from '../../../shared/types.ts';
import { evaluate } from './answer-checker.ts';
import { TRAINER_CONFIG as config } from './config.ts';
import { familiarity, updateScores } from './scoring.ts';
import type { Selection } from './word-selector.ts';
export function completeAttempt(
  state: LearnerState,
  selection: Selection,
  answer: string,
  skipped: boolean,
  clientId: string,
  shownAt: number,
  now: number,
  id: string,
  fontId = 'default',
  presentation: Omit<Presentation, 'fontId'> = {
    caseMode: 'caps',
    italic: false,
  },
  metadataHintsShown?: boolean,
  flash?: {
    exposureMs: number;
    visibleDurationMs?: number;
    revealed: boolean;
  },
): { state: LearnerState; attempt: AttemptEvent } {
  const { word } = selection,
    evaluation = evaluate(word, answer, skipped);
  const attempt: AttemptEvent = {
    id,
    type: 'attempt.completed',
    clientId,
    timestamp: now,
    schemaVersion: 1,
    payload: {
      wordId: word.id,
      answer,
      expected: evaluation.expected,
      correct: evaluation.correct,
      shownAt,
      answeredAt: now,
      evaluation,
      familiarity: familiarity(word),
      learnerLanguage: config.learnerLanguage,
      fontId,
      ...(metadataHintsShown === undefined ? {} : { metadataHintsShown }),
      presentation: { ...presentation, fontId },
      ...(flash
        ? {
            flashMode: true,
            flashExposureMs: flash.exposureMs,
            ...(flash.visibleDurationMs === undefined
              ? {}
              : { flashVisibleDurationMs: flash.visibleDurationMs }),
            flashRevealed: flash.revealed,
          }
        : {}),
    },
  };
  const next =
    flash && !flash.revealed
      ? { ...state, recent: [...state.recent] }
      : updateScores(state, word, evaluation, now);
  next.recent = [attempt, ...state.recent];
  if (
    !(flash && !flash.revealed) &&
    selection.phase === 'introduction' &&
    selection.introducedLetter
  )
    next.reinforcement = {
      letter: selection.introducedLetter,
      remaining: config.reinforcementWords,
    };
  else if (
    !(flash && !flash.revealed) &&
    selection.phase === 'reinforcement' &&
    state.reinforcement
  )
    next.reinforcement =
      state.reinforcement.remaining > 1
        ? {
            ...state.reinforcement,
            remaining: state.reinforcement.remaining - 1,
          }
        : undefined;
  return { state: next, attempt };
}
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
  const accuracy = (items: AttemptEvent[]) =>
    items.length
      ? items.filter((a) => a.payload.correct).length / items.length
      : null;
  const fontStats = Object.entries(
    ordinaryAttempts.reduce<Record<string, AttemptEvent[]>>(
      (byFont, attempt) => {
        const fontId = attempt.payload.fontId ?? 'default';
        byFont[fontId] ??= [];
        byFont[fontId].push(attempt);
        return byFont;
      },
      {},
    ),
  ).map(([fontId, fontAttempts]) => ({
    fontId,
    attempts: fontAttempts.length,
    accuracy: accuracy(fontAttempts),
    weakLetters: Object.entries(state.letters)
      .filter(([letter, global]) => {
        const observations = fontAttempts.flatMap((attempt) =>
          attempt.payload.evaluation.units.flatMap((unit) =>
            unit.source.includes(letter) && unit.observation !== null
              ? [unit.observation]
              : [],
          ),
        );
        return (
          observations.length > 0 &&
          global.score -
            observations.reduce((sum, value) => sum + value, 0) /
              observations.length >=
            0.2
        );
      })
      .map(([letter]) => letter),
  }));
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
    skips: ordinaryAttempts.filter(
      (a) => a.payload.evaluation.status === 'unknown',
    ).length,
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
