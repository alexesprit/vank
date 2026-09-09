import type { Evaluation, LearnerState, Word } from '../../../shared/types.ts';
import { TRAINER_CONFIG as config } from './config.ts';
export const familiarity = (word: Word): number =>
  word.familiarity?.[config.learnerLanguage] ?? 0.5;
export function updateScores(
  state: LearnerState,
  word: Word,
  result: Evaluation,
  now: number,
): LearnerState {
  const letters = { ...state.letters };
  const weight = Math.max(
    config.familiarWordEvidenceFloor,
    1 - familiarity(word) * config.familiarityDiscount,
  );
  for (const letter of word.uniqueLetters) {
    const old = letters[letter] ?? {
      score: 0,
      attempts: 0,
      correct: 0,
      lastSeenAt: 0,
      verified: 0,
    };
    const observations = result.units.flatMap((unit) =>
      unit.source.includes(letter) && unit.observation !== null
        ? [unit.observation]
        : [],
    );
    const observation = observations.length ? Math.min(...observations) : null;
    const verified =
      old.verified +
      Number(
        observation === 1 &&
          familiarity(word) <= config.verificationFamiliarityThreshold,
      );
    const nextScore =
      observation === null
        ? old.score
        : old.score * (1 - config.emaAlpha) +
          observation * weight * config.emaAlpha;
    letters[letter] = {
      ...old,
      score: Math.min(verified ? 1 : config.unverifiedScoreCeiling, nextScore),
      attempts: old.attempts + 1,
      correct: old.correct + Number(observation === 1),
      lastSeenAt: now,
      verified,
      ...(observation === 0 ? { lastMistakeAt: now } : {}),
    };
  }
  const oldWord = state.words[word.id] ?? {
    attempts: 0,
    correct: 0,
    lastSeenAt: 0,
  };
  return {
    ...state,
    letters,
    words: {
      ...state.words,
      [word.id]: {
        ...oldWord,
        attempts: oldWord.attempts + 1,
        correct: oldWord.correct + Number(result.correct),
        lastSeenAt: now,
        ...(!result.correct ? { lastMistakeAt: now } : {}),
      },
    },
  };
}
