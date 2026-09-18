import { promptLetters } from '../../../shared/armenian.ts';
import type { CaseMode, LearnerState, Word } from '../../../shared/types.ts';
import { TRAINER_CONFIG as config } from './config.ts';
import { familiarity } from './scoring.ts';
export interface Selection {
  word: Word;
  phase:
    | 'bootstrap'
    | 'training'
    | 'introduction'
    | 'reinforcement'
    | 'verification';
  introducedLetter?: string;
  diagnostics?: SelectionDiagnostics;
}
export interface CandidateDiagnostics {
  wordId: string;
  word: string;
  priority: number;
  components: Record<string, number>;
}
export interface SelectionDiagnostics {
  bootstrap: boolean;
  knownLetters: number;
  successfulWords: number;
  unknownLetters: string[];
  needsConfidence: boolean;
  confidenceBreak: boolean;
  reinforcement?: LearnerState['reinforcement'];
  candidates: {
    dictionary: number;
    unseen: number;
    bootstrapPool: number;
    loanwords: number;
    eligible: number;
    afterRecentExclusion: number;
    afterConfidenceBreak: number;
    afterReinforcement: number;
    afterFamiliarInjection: number;
    afterPreviousLetterConstraint: number;
  };
  selected: CandidateDiagnostics;
  alternatives: CandidateDiagnostics[];
}
export type SelectionStrategy = 'adaptive' | 'finite-pack';
export interface SelectionRequest {
  targetLetter?: string;
  excludeWordId?: string;
  excludeWordIds?: readonly string[];
}
const letterState = (state: LearnerState, letter: string) =>
  state.letters[letter.toLocaleLowerCase('hy')] ??
  state.letters[letter] ??
  state.letters[letter.toLocaleUpperCase('hy')];
export type WordSelector = (
  state: LearnerState,
  now: number,
  random?: () => number,
  request?: SelectionRequest,
  caseMode?: CaseMode,
) => Selection;
export const unknownLetters = (
  word: Word,
  state: LearnerState,
  caseMode: CaseMode = 'caps',
): string[] =>
  promptLetters(word.uniqueLetters, caseMode).filter(
    (letter) => !(letterState(state, letter)?.score > 0),
  );
export const matchesTargetLetter = (
  word: Word,
  letter: string,
  caseMode: CaseMode,
) =>
  word.uniqueLetters.includes(letter) ||
  promptLetters(word.uniqueLetters, caseMode).includes(letter);
const average = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;
const isFamiliarCandidate = (word: Word) =>
  familiarity(word) >= config.bootstrapFamiliarityThreshold &&
  ((word.loanwordScore ?? 0) >= config.bootstrapLoanwordThreshold ||
    word.tags.includes('loanword'));
export function personalDifficulty(
  word: Word,
  state: LearnerState,
  caseMode: CaseMode = 'caps',
): number {
  const unknown = promptLetters(word.uniqueLetters, caseMode).map(
    (letter) => 1 - (letterState(state, letter)?.score ?? 0),
  );
  const w = config.difficulty;
  return Math.max(
    0,
    Math.min(
      1,
      w.length * Math.min(1, word.length / 12) +
        w.visual * (word.visualDifficulty ?? 0.5) +
        w.reading * (word.readingDifficulty ?? 0.5) -
        w.familiarity * familiarity(word) -
        w.frequency * (word.frequencyScore ?? 0.5) +
        w.averageUnknown * average(unknown) +
        w.weakest * Math.max(...unknown),
    ),
  );
}
export function selectAdaptiveWord(
  words: Word[],
  state: LearnerState,
  now: number,
  random = Math.random,
  request?: SelectionRequest,
  caseMode: CaseMode = 'caps',
): Selection {
  if (!words.length) throw new Error('Cannot train with an empty dictionary');
  const targetLetter = request?.targetLetter;
  const excludedWordIds = new Set(request?.excludeWordIds);
  if (request?.excludeWordId) excludedWordIds.add(request.excludeWordId);
  const matchingTargets = targetLetter
    ? words.filter(
        (word) =>
          !excludedWordIds.has(word.id) &&
          matchesTargetLetter(word, targetLetter, caseMode),
      )
    : [];
  const knownLetterCount = Object.values(state.letters).filter(
    (l) => l.score > 0,
  ).length;
  const successfulWordCount = Object.values(state.words).filter(
    (w) => w.correct > 0,
  ).length;
  const bootstrap =
    successfulWordCount < config.bootstrapSuccessfulWords ||
    knownLetterCount < config.bootstrapKnownLetters;
  const unseen = words.filter((w) => !state.words[w.id]);
  const bootstrapPool = unseen.length ? unseen : words;
  const latestWord = state.recent[0]?.payload.wordId
    ? (words.find((word) => word.id === state.recent[0]?.payload.wordId) ??
      bootstrapPool.find((word) => word.id === state.recent[0]?.payload.wordId))
    : undefined;
  const loanwords = bootstrapPool.filter(isFamiliarCandidate);
  const attemptsSinceLastFamiliarWord = () => {
    let count = 0;
    for (const attempt of state.recent) {
      if (attempt.payload.familiarity >= config.bootstrapFamiliarityThreshold)
        break;
      count += 1;
    }
    return count;
  };
  let candidates = bootstrap
    ? loanwords.length
      ? loanwords
      : bootstrapPool
    : words.filter(
        (w) =>
          unknownLetters(w, state, caseMode).length <=
          config.maxUnknownLettersIntroduction,
      );
  const eligible = candidates.length;
  if (!candidates.length) {
    const current = request?.excludeWordId
      ? words.find((word) => word.id === request.excludeWordId)
      : undefined;
    if (current) candidates = [current];
    else if (matchingTargets.length) candidates = matchingTargets;
    else
      throw new Error(
        'Dictionary has no words within the one-new-letter limit',
      );
  }
  const latest = state.recent[0]?.payload.wordId;
  const different = candidates.filter((w) => w.id !== latest);
  if (different.length) candidates = different;
  const afterRecentExclusion = candidates.length;
  const sharesPrevious = latestWord
    ? (word: Word) =>
        word.uniqueLetters.some((letter) =>
          latestWord.uniqueLetters.includes(letter),
        )
    : () => true;
  if (bootstrap) {
    const shared = candidates.filter((word) => sharesPrevious(word));
    if (shared.length) candidates = shared;
  }
  const afterPreviousLetterConstraint = candidates.length;
  const needsConfidence =
    !bootstrap &&
    state.recent.length >= 2 &&
    state.recent
      .slice(0, 2)
      .every(
        (attempt) =>
          !attempt.payload.correct &&
          attempt.payload.familiarity <=
            config.verificationFamiliarityThreshold,
      );
  let confidenceBreak = false;
  if (needsConfidence) {
    const familiar = candidates.filter(
      (w) =>
        isFamiliarCandidate(w) && !unknownLetters(w, state, caseMode).length,
    );
    if (familiar.length) {
      candidates = familiar;
      confidenceBreak = true;
    }
  }
  const afterConfidenceBreak = candidates.length;
  const target = state.reinforcement;
  if (!bootstrap && !confidenceBreak && target?.remaining) {
    const reinforcement = candidates.filter((w) =>
      matchesTargetLetter(w, target.letter, caseMode),
    );
    if (reinforcement.length) candidates = reinforcement;
  }
  const afterReinforcement = candidates.length;
  const shouldInjectFamiliar =
    !bootstrap &&
    !confidenceBreak &&
    !target?.remaining &&
    attemptsSinceLastFamiliarWord() >= config.familiarInjectionInterval &&
    config.familiarInjectionInterval > 0;
  if (shouldInjectFamiliar) {
    const familiar = candidates.filter(
      (w) =>
        isFamiliarCandidate(w) && !unknownLetters(w, state, caseMode).length,
    );
    if (familiar.length) candidates = familiar;
  }
  const afterFamiliarInjection = candidates.length;
  let requestedWord: Word | undefined;
  if (request) {
    if (matchingTargets.length) {
      const familiar = matchingTargets.filter(isFamiliarCandidate);
      candidates = familiar.length ? familiar : matchingTargets;
      requestedWord = candidates[Math.floor(random() * candidates.length)];
    } else if (request.targetLetter && request.excludeWordId) {
      const current = words.find((word) => word.id === request.excludeWordId);
      if (current) candidates = [current];
    } else {
      const eligibleDifferent = request.excludeWordId
        ? candidates.filter((word) => word.id !== request.excludeWordId)
        : candidates;
      if (eligibleDifferent.length) candidates = eligibleDifferent;
    }
  }
  const diagnose = (word: Word): CandidateDiagnostics => {
    const recentIndex = state.recent
      .slice(0, config.recentWordWindow)
      .findIndex((a) => a.payload.wordId === word.id);
    const recent =
      recentIndex < 0
        ? 0
        : (config.recentWordWindow - recentIndex) / config.recentWordWindow;
    if (bootstrap) {
      const components = {
        familiarity: familiarity(word),
        length: -word.length / 30,
        recent: -recent * config.weights.recent,
      };
      return {
        wordId: word.id,
        word: word.word,
        priority:
          components.familiarity + components.length + components.recent,
        components,
      };
    }
    const visibleLetters = promptLetters(word.uniqueLetters, caseMode);
    const weak = average(
      visibleLetters.map(
        (letter) => 1 - (letterState(state, letter)?.score ?? 0),
      ),
    );
    const stat = state.words[word.id];
    const spacing = stat
      ? Math.min(1, Math.max(0, now - stat.lastSeenAt) / config.spacingMs)
      : 0.5;
    const mistakes = average(
      visibleLetters.map((letter) => {
        const lastMistakeAt = letterState(state, letter)?.lastMistakeAt;
        return lastMistakeAt === undefined
          ? 0
          : Math.max(0, 1 - (now - lastMistakeAt) / config.spacingMs);
      }),
    );
    const match =
      1 -
      Math.abs(
        1 - personalDifficulty(word, state, caseMode) - config.targetSuccess,
      );
    const verification =
      familiarity(word) <= config.verificationFamiliarityThreshold &&
      visibleLetters.some(
        (letter) =>
          (letterState(state, letter)?.correct ?? 0) > 0 &&
          !letterState(state, letter)?.verified,
      );
    const w = config.weights;
    const components = {
      weak: w.weak * weak,
      spacingOrMistake: w.spacing * Math.max(spacing, mistakes),
      difficulty: w.difficulty * match,
      novelty: w.novelty * Number(!stat),
      reinforcement:
        w.reinforcement *
        Number(
          verification ||
            Boolean(target && visibleLetters.includes(target.letter)),
        ),
      recent: -w.recent * recent,
    };
    return {
      wordId: word.id,
      word: word.word,
      priority:
        components.weak +
        components.spacingOrMistake +
        components.difficulty +
        components.novelty +
        components.reinforcement +
        components.recent,
      components,
    };
  };
  const ranked = candidates
    .map((word) => ({ word, diagnostic: diagnose(word) }))
    .sort(
      (a, b) =>
        b.diagnostic.priority - a.diagnostic.priority ||
        a.word.id.localeCompare(b.word.id),
    );
  const best = ranked.filter(
    (candidate) =>
      candidate.diagnostic.priority === ranked[0].diagnostic.priority,
  );
  const chosen =
    ranked.find((candidate) => candidate.word === requestedWord) ??
    best[Math.floor(random() * best.length)];
  const word = chosen.word;
  const unknown = unknownLetters(word, state, caseMode);
  const phase = bootstrap
    ? 'bootstrap'
    : !confidenceBreak &&
        target?.remaining &&
        matchesTargetLetter(word, target.letter, caseMode)
      ? 'reinforcement'
      : unknown.length
        ? 'introduction'
        : familiarity(word) <= config.verificationFamiliarityThreshold
          ? 'verification'
          : 'training';
  return {
    word,
    phase,
    ...(!bootstrap && unknown.length === 1
      ? { introducedLetter: unknown[0] }
      : {}),
    diagnostics: {
      bootstrap,
      knownLetters: knownLetterCount,
      successfulWords: successfulWordCount,
      unknownLetters: unknown,
      needsConfidence,
      confidenceBreak,
      reinforcement: target,
      candidates: {
        dictionary: words.length,
        unseen: unseen.length,
        bootstrapPool: bootstrapPool.length,
        loanwords: loanwords.length,
        eligible,
        afterRecentExclusion,
        afterPreviousLetterConstraint,
        afterConfidenceBreak,
        afterReinforcement,
        afterFamiliarInjection,
      },
      selected: chosen.diagnostic,
      alternatives: ranked
        .filter((candidate) => candidate.word !== word)
        .slice(0, 5)
        .map((candidate) => candidate.diagnostic),
    },
  };
}

export function createWordSelector(
  words: Word[],
  strategy: SelectionStrategy = 'adaptive',
): WordSelector {
  if (strategy === 'adaptive')
    return (state, now, random, request, caseMode) =>
      selectAdaptiveWord(words, state, now, random, request, caseMode);
  if (strategy === 'finite-pack') {
    if (!words.length) throw new Error('Cannot train with an empty dictionary');
    const pack = [...words];
    let index = 0;
    let needsShuffle = true;
    const shuffle = (random: () => number) => {
      for (let i = pack.length - 1; i > 0; i--) {
        const value = random();
        const normalized = Number.isFinite(value)
          ? Math.min(1 - Number.EPSILON, Math.max(0, value))
          : 0;
        const j = Math.floor(normalized * (i + 1));
        [pack[i], pack[j]] = [pack[j], pack[i]];
      }
    };
    const createSelection = (
      word: Word,
      state: LearnerState,
      caseMode: CaseMode,
    ): Selection => {
      const unknown = unknownLetters(word, state, caseMode);
      return {
        word,
        phase: unknown.length ? 'introduction' : 'training',
        ...(unknown.length === 1 ? { introducedLetter: unknown[0] } : {}),
      };
    };
    const selectFromPack = (candidates: Word[]): Word | undefined => {
      if (!candidates.length) return undefined;
      const ordered = [...pack.slice(index), ...pack.slice(0, index)];
      const candidateIds = new Set(candidates.map((word) => word.id));
      const selected = ordered.find((word) => candidateIds.has(word.id));
      if (!selected) return undefined;
      const selectedIndex = pack.findIndex((word) => word.id === selected.id);
      if (selectedIndex >= index) {
        [pack[index], pack[selectedIndex]] = [pack[selectedIndex], pack[index]];
        index++;
      }
      return selected;
    };
    return (state, _now, random = Math.random, request, caseMode = 'caps') => {
      if (needsShuffle) {
        shuffle(random);
        needsShuffle = false;
      }
      if (index >= pack.length) {
        shuffle(random);
        index = 0;
      }
      if (request) {
        const different = request.excludeWordId
          ? pack.filter((word) => word.id !== request.excludeWordId)
          : pack;
        const targetLetter = request.targetLetter;
        const excludedWordIds = new Set(request.excludeWordIds);
        if (request.excludeWordId) excludedWordIds.add(request.excludeWordId);
        const matching = targetLetter
          ? pack.filter(
              (word) =>
                !excludedWordIds.has(word.id) &&
                matchesTargetLetter(word, targetLetter, caseMode),
            )
          : [];
        const familiar = matching.filter(isFamiliarCandidate);
        const targets = familiar.length ? familiar : matching;
        const target = targets.length
          ? targets[Math.floor(random() * targets.length)]
          : undefined;
        const targeted = target ? selectFromPack([target]) : undefined;
        if (targeted) return createSelection(targeted, state, caseMode);
        if (request.targetLetter && request.excludeWordId) {
          const current = pack.find(
            (word) => word.id === request.excludeWordId,
          );
          if (current) return createSelection(current, state, caseMode);
        }
        const fallback = selectFromPack(different);
        if (fallback) return createSelection(fallback, state, caseMode);
        const current = request.excludeWordId
          ? pack.find((word) => word.id === request.excludeWordId)
          : undefined;
        if (current) return createSelection(current, state, caseMode);
      }
      const word = pack[index++];
      return createSelection(word, state, caseMode);
    };
  }
  throw new Error(`Selection strategy is not implemented: ${strategy}`);
}

export function selectWord(
  words: Word[],
  state: LearnerState,
  now: number,
  random?: () => number,
  request?: SelectionRequest,
  caseMode: CaseMode = 'caps',
): Selection {
  return selectAdaptiveWord(words, state, now, random, request, caseMode);
}
