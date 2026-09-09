import type { LearnerState, Word } from '../../../shared/types.ts';
import { TRAINER_CONFIG as config } from './config.ts';
import { familiarity } from './scoring.ts';
export interface Selection { word: Word; phase: 'bootstrap' | 'training' | 'introduction' | 'reinforcement' | 'verification'; introducedLetter?: string }
export const unknownLetters = (word: Word, state: LearnerState): string[] => word.uniqueLetters.filter(l => !(state.letters[l]?.score > 0));
const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
export function personalDifficulty(word: Word, state: LearnerState): number {
  const unknown = word.uniqueLetters.map(l => 1 - (state.letters[l]?.score ?? 0));
  const w = config.difficulty;
  return Math.max(0, Math.min(1,
    w.length * Math.min(1, word.length / 12) + w.visual * (word.visualDifficulty ?? 0.5) + w.reading * (word.readingDifficulty ?? 0.5)
    - w.familiarity * familiarity(word) - w.frequency * (word.frequencyScore ?? 0.5)
    + w.averageUnknown * average(unknown) + w.weakest * Math.max(...unknown)));
}
export function selectWord(words: Word[], state: LearnerState, now: number, random = Math.random): Selection {
  if (!words.length) throw new Error('Cannot train with an empty dictionary');
  const knownCount = Object.values(state.letters).filter(l => l.score > 0).length;
  const bootstrap = knownCount < config.bootstrapKnownLetters;
  let candidates = bootstrap
    ? words.filter(w => familiarity(w) >= config.bootstrapFamiliarityThreshold
      && ((w.loanwordScore ?? 0) >= config.bootstrapLoanwordThreshold || w.tags.includes('loanword')))
    : words.filter(w => unknownLetters(w, state).length <= config.maxUnknownLettersIntroduction);
  if (!candidates.length) throw new Error(bootstrap ? 'Dictionary has no recognizable loanwords' : 'Dictionary has no words within the one-new-letter limit');
  const latest = state.recent[0]?.payload.wordId;
  const different = candidates.filter(w => w.id !== latest);
  if (different.length) candidates = different;
  const target = state.reinforcement;
  if (!bootstrap && target?.remaining) {
    const reinforcement = candidates.filter(w => w.uniqueLetters.includes(target.letter));
    if (reinforcement.length) candidates = reinforcement;
  }
  const priority = (word: Word): number => {
    const recentIndex = state.recent.slice(0, config.recentWordWindow).findIndex(a => a.payload.wordId === word.id);
    const recent = recentIndex < 0 ? 0 : (config.recentWordWindow - recentIndex) / config.recentWordWindow;
    if (bootstrap) return familiarity(word) - word.length / 30 - recent * config.weights.recent;
    const weak = average(word.uniqueLetters.map(l => 1 - (state.letters[l]?.score ?? 0)));
    const stat = state.words[word.id];
    const spacing = stat ? Math.min(1, Math.max(0, now - stat.lastSeenAt) / config.spacingMs) : 0.5;
    const mistakes = average(word.uniqueLetters.map(l => state.letters[l]?.lastMistakeAt === undefined ? 0 : Math.max(0, 1 - (now - state.letters[l].lastMistakeAt!) / config.spacingMs)));
    const match = 1 - Math.abs(1 - personalDifficulty(word, state) - config.targetSuccess);
    const verification = familiarity(word) <= config.verificationFamiliarityThreshold && word.uniqueLetters.some(l => (state.letters[l]?.correct ?? 0) > 0 && !state.letters[l]?.verified);
    const w = config.weights;
    return w.weak * weak + w.spacing * Math.max(spacing, mistakes) + w.difficulty * match + w.novelty * Number(!stat)
      + w.reinforcement * Number(verification || Boolean(target && word.uniqueLetters.includes(target.letter))) - w.recent * recent;
  };
  const ranked = candidates.map(word => ({ word, priority: priority(word) })).sort((a, b) => b.priority - a.priority || a.word.id.localeCompare(b.word.id));
  const best = ranked.filter(candidate => candidate.priority === ranked[0].priority);
  const word = best[Math.floor(random() * best.length)].word;
  const unknown = unknownLetters(word, state);
  return { word, phase: bootstrap ? 'bootstrap' : target?.remaining && word.uniqueLetters.includes(target.letter) ? 'reinforcement'
    : unknown.length ? 'introduction' : familiarity(word) <= config.verificationFamiliarityThreshold ? 'verification' : 'training',
    ...(!bootstrap && unknown.length === 1 ? { introducedLetter: unknown[0] } : {}),
  };
}
