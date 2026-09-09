import type { AttemptEvent, LearnerState } from '../../../shared/types.ts';
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
    },
  };
  const next = updateScores(state, word, evaluation, now);
  next.recent = [attempt, ...state.recent];
  if (selection.phase === 'introduction' && selection.introducedLetter)
    next.reinforcement = {
      letter: selection.introducedLetter,
      remaining: config.reinforcementWords,
    };
  else if (selection.phase === 'reinforcement' && state.reinforcement)
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
  const accuracy = (items: AttemptEvent[]) =>
    items.length
      ? items.filter((a) => a.payload.correct).length / items.length
      : null;
  return {
    introduced: letters.filter((l) => l.attempts > 0).length,
    strong: letters.filter(
      (l) => l.score >= config.strongThreshold && l.verified > 0,
    ).length,
    averageScore: letters.length
      ? letters.reduce((sum, l) => sum + l.score, 0) / letters.length
      : 0,
    accuracy: accuracy(attempts),
    verifiedAccuracy: accuracy(
      attempts.filter(
        (a) => a.payload.familiarity <= config.verificationFamiliarityThreshold,
      ),
    ),
    rolling20: accuracy(attempts.slice(0, 20)),
    rolling50: accuracy(attempts.slice(0, 50)),
    skips: attempts.filter((a) => a.payload.evaluation.status === 'unknown')
      .length,
    weakLetters: Object.entries(state.letters)
      .filter(([, s]) => s.score < config.strongThreshold)
      .sort((a, b) => a[1].score - b[1].score)
      .slice(0, 8)
      .map(([l]) => l),
  };
}
