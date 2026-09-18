import { promptLetters } from '../../../shared/armenian.ts';
import type {
  AttemptEvent,
  LearnerState,
  Presentation,
} from '../../../shared/types.ts';
import { evaluate } from './answer-checker.ts';
import { TRAINER_CONFIG as config } from './config.ts';
import type { PracticeModeId } from './modes.ts';
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
    baseExposureMs?: number;
    exposureMs: number;
    visibleDurationMs?: number;
    revealed: boolean;
  },
  practiceMode?: PracticeModeId,
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
      ...(practiceMode ? { practiceMode } : {}),
      ...(metadataHintsShown === undefined ? {} : { metadataHintsShown }),
      presentation: { ...presentation, fontId },
      ...(flash
        ? {
            flashMode: true,
            ...(flash.baseExposureMs === undefined
              ? {}
              : { flashBaseExposureMs: flash.baseExposureMs }),
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
      : updateScores(state, word, evaluation, now, presentation.caseMode);
  next.recent = [attempt, ...state.recent];
  const introducedLetter = promptLetters(
    word.uniqueLetters,
    presentation.caseMode,
  ).find(
    (letter) =>
      !(
        (
          state.letters[letter.toLocaleLowerCase('hy')] ??
          state.letters[letter] ??
          state.letters[letter.toLocaleUpperCase('hy')]
        )?.score > 0
      ),
  );
  if (
    !(flash && !flash.revealed) &&
    selection.phase === 'introduction' &&
    introducedLetter !== undefined
  )
    next.reinforcement = {
      letter: introducedLetter,
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
