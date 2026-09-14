import { promptLetters } from '../../../shared/armenian.ts';
import type { CaseMode, LearnerState, Word } from '../../../shared/types.ts';
import type { Selection, WordSelector } from './word-selector.ts';

const WORD_HISTORY_LIMIT = 10;
const WORD_LIMIT = 5;

interface LetterPracticeOptions {
  getWords: () => Word[];
  getState: () => LearnerState;
  getCurrent: () => Selection;
  getSelector: () => WordSelector;
}

type StartResult =
  | { status: 'missing' | 'unavailable' }
  | { status: 'target'; selection: Selection; commit: () => void };

interface NextResult {
  selection: Selection;
  commit: () => void;
}

export function createLetterPracticeSession(options: LetterPracticeOptions) {
  const recentWords = new Map<string, string[]>();
  let letter: string | undefined;
  let wordsRemaining = 0;
  let candidateWordIds: string[] = [];

  const end = () => {
    letter = undefined;
    wordsRemaining = 0;
    candidateWordIds = [];
  };
  const selectNormally = (caseMode: CaseMode) =>
    options.getSelector()(
      options.getState(),
      Date.now(),
      undefined,
      undefined,
      caseMode,
    );

  return {
    start(targetLetter: string, caseMode: CaseMode): StartResult {
      const words = options.getWords();
      const current = options.getCurrent();
      const matchesLetter = (word: Word) =>
        promptLetters(word.uniqueLetters, caseMode).includes(targetLetter);
      if (!words.some(matchesLetter)) return { status: 'missing' };

      const recent = recentWords.get(targetLetter) ?? [];
      const excludedWordIds = matchesLetter(current.word)
        ? [
            ...recent.filter((wordId) => wordId !== current.word.id),
            current.word.id,
          ].slice(-WORD_HISTORY_LIMIT)
        : recent;
      const excludedIds = new Set([...excludedWordIds, current.word.id]);
      const candidates = [
        ...new Set(
          words
            .filter((word) => matchesLetter(word) && !excludedIds.has(word.id))
            .map((word) => word.id),
        ),
      ];
      if (!candidates.length) return { status: 'unavailable' };

      const selection = options.getSelector()(
        options.getState(),
        Date.now(),
        Math.random,
        {
          targetLetter,
          excludeWordId: current.word.id,
          excludeWordIds: excludedWordIds,
        },
        caseMode,
      );
      if (!candidates.includes(selection.word.id))
        return { status: 'unavailable' };

      return {
        status: 'target',
        selection,
        commit() {
          recentWords.set(
            targetLetter,
            [
              ...excludedWordIds.filter(
                (wordId) => wordId !== selection.word.id,
              ),
              selection.word.id,
            ].slice(-WORD_HISTORY_LIMIT),
          );
          letter = targetLetter;
          wordsRemaining = Math.min(WORD_LIMIT, candidates.length);
          candidateWordIds = candidates.filter(
            (wordId) => wordId !== selection.word.id,
          );
        },
      };
    },
    recordAttempt() {
      if (!letter || wordsRemaining <= 0) return;
      wordsRemaining--;
      if (!wordsRemaining) end();
    },
    selectNext(caseMode: CaseMode): NextResult {
      if (!letter || wordsRemaining <= 0)
        return { selection: selectNormally(caseMode), commit() {} };

      const targetLetter = letter;
      const candidates = new Set(candidateWordIds);
      const selection = options.getSelector()(
        options.getState(),
        Date.now(),
        Math.random,
        {
          targetLetter,
          excludeWordId: options.getCurrent().word.id,
          excludeWordIds: options
            .getWords()
            .filter((word) => !candidates.has(word.id))
            .map((word) => word.id),
        },
        caseMode,
      );
      if (
        !candidates.has(selection.word.id) ||
        !promptLetters(selection.word.uniqueLetters, caseMode).includes(
          targetLetter,
        )
      ) {
        return { selection: selectNormally(caseMode), commit: end };
      }

      return {
        selection,
        commit() {
          candidateWordIds = candidateWordIds.filter(
            (wordId) => wordId !== selection.word.id,
          );
          const recent = recentWords.get(targetLetter) ?? [];
          recentWords.set(
            targetLetter,
            [
              ...recent.filter((wordId) => wordId !== selection.word.id),
              selection.word.id,
            ].slice(-WORD_HISTORY_LIMIT),
          );
        },
      };
    },
    reset() {
      recentWords.clear();
      end();
    },
  };
}
