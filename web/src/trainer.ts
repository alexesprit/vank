import { promptLetters } from '../../shared/armenian.ts';
import type {
  Dictionary,
  Evaluation,
  LetterStat,
  PracticeModeId,
  Word,
  WordStat,
} from '../../shared/types.ts';
import type { AchievementUnlock } from './core/achievements.ts';
import { evaluateAchievements } from './core/achievements.ts';
import { TRAINER_CONFIG } from './core/config.ts';
import { createFlashSession } from './core/flash-session.ts';
import { createLetterPracticeSession } from './core/letter-practice-session.ts';
import { hasMetadataHints } from './core/metadata-hints.ts';
import { getPracticeMode, type PracticeMode } from './core/modes.ts';
import { countCorrectAnswers } from './core/progress.ts';
import { completeAttempt } from './core/session.ts';
import {
  type AppSettings,
  availableTypography,
  type FontOption,
  loadFont,
  parseSettings,
  selectFont,
  selectTypography,
} from './core/settings.ts';
import {
  createWordSelector,
  type Selection,
  unknownLetters,
  type WordSelector,
} from './core/word-selector.ts';
import type { Repository } from './storage/repository.ts';

interface ScoreUpdateDiagnostics {
  wordId: string;
  practiceMode: PracticeModeId;
  phase: Selection['phase'];
  evidenceWeight: number;
  letters: Record<string, { before: LetterStat | null; after: LetterStat }>;
  word: { before: WordStat | null; after: WordStat };
}
export interface TrainerOptions {
  /** Session-level override; diagnostic sessions can explicitly hide hints. */
  metadataHints?: boolean;
  mode?: PracticeMode;
  settings?: AppSettings;
  selector?: WordSelector;
}
export async function createTrainer(
  words: Word[],
  repository: Repository,
  fontLoader: (font: FontOption) => Promise<FontOption> = loadFont,
  options: TrainerOptions = {},
) {
  let state = await repository.loadState();
  let activeWords = words;
  let achievementUnlocks = await repository.getAchievementUnlocks();
  const backfilledAchievementUnlocks = evaluateAchievements(
    [...state.recent].reverse(),
    achievementUnlocks,
  );
  if (backfilledAchievementUnlocks.length) {
    await repository.saveAchievementUnlocks(backfilledAchievementUnlocks);
    achievementUnlocks = [
      ...achievementUnlocks,
      ...backfilledAchievementUnlocks,
    ];
  }
  let lastAchievementUnlocks: AchievementUnlock[] = [];
  let settings =
    options.settings ?? parseSettings(await repository.getSetting('app'));
  let mode = options.mode ?? getPracticeMode(settings.practiceMode);
  let select = options.selector ?? createWordSelector(words, mode.strategy);
  let introShown = (await repository.getSetting('introShown')) === true;
  let clientId = await repository.getSetting('clientId');
  if (typeof clientId !== 'string') {
    clientId = crypto.randomUUID();
    await repository.setSetting('clientId', clientId);
  }
  const installationId = clientId as string;
  const correctAnswers = () => countCorrectAnswers(state.recent);
  let pendingFont = fontLoader(selectFont(settings, correctAnswers()));
  let presentation = selectTypography(settings, correctAnswers());
  let current = select(
      state,
      Date.now(),
      undefined,
      undefined,
      presentation.caseMode,
    ),
    font = await pendingFont,
    shownAt = Date.now();
  let timingInterrupted = false;
  let firstAnswerAt: number | undefined;
  let interruptedAtFirstAnswer = false;
  let flashChange: (() => void) | undefined;
  const hintsEnabled = () => options.metadataHints ?? settings.metadataHints;
  let metadataHintsShown = hintsEnabled() && hasMetadataHints(current.word);
  let metadataHintsCaptured = false;
  let result: Evaluation | undefined,
    lastScoreUpdate: ScoreUpdateDiagnostics | undefined;
  let operation: Promise<void> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>) => {
    const pending = operation.then(task, task);
    operation = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
  const flash = createFlashSession({
    getEnabled: () => settings.flash.enabled,
    getCorrectAnswers: correctAnswers,
    getBaseExposureMs: () => settings.flash.exposureMs,
    getWordLength: () => current.word.length,
    getHasResult: () => Boolean(result),
    onChange: () => flashChange?.(),
  });
  const letterPractice = createLetterPracticeSession({
    getWords: () => activeWords,
    getState: () => state,
    getCurrent: () => current,
    getSelector: () => select,
  });
  const restartResponseTiming = () => {
    shownAt = Date.now();
    timingInterrupted = false;
    firstAnswerAt = undefined;
    interruptedAtFirstAnswer = false;
  };
  const startFlash = () => {
    restartResponseTiming();
    flash.start();
  };
  const pauseFlash = () => flash.pause();
  const resumeFlash = () => flash.resume();
  const latestFont = async (requested: Promise<FontOption>) => {
    let loaded = await requested;
    while (requested !== pendingFont) {
      requested = pendingFont;
      loaded = await requested;
    }
    return loaded;
  };
  const replacePrompt = async (
    next: Selection,
    nextPresentation: ReturnType<typeof selectTypography>,
  ) => {
    pendingFont = fontLoader(selectFont(settings, correctAnswers()));
    font = await latestFont(pendingFont);
    presentation = nextPresentation;
    current = next;
    metadataHintsShown = hintsEnabled() && hasMetadataHints(current.word);
    metadataHintsCaptured = false;
    result = undefined;
    lastAchievementUnlocks = [];
    flash.reset();
    restartResponseTiming();
  };
  return {
    get current() {
      return current;
    },
    get state() {
      return state;
    },
    get result() {
      return result;
    },
    get settings() {
      return settings;
    },
    get introShown() {
      return introShown;
    },
    get font() {
      return font;
    },
    get presentation() {
      return presentation;
    },
    get achievementUnlocks() {
      return achievementUnlocks;
    },
    get backfilledAchievementUnlocks() {
      return backfilledAchievementUnlocks;
    },
    get lastAchievementUnlocks() {
      return lastAchievementUnlocks;
    },
    get metadataHintsEnabled() {
      return hintsEnabled();
    },
    get metadataHintsShown() {
      return metadataHintsShown;
    },
    get flashHidden() {
      return flash.hidden;
    },
    get flashRevealed() {
      return flash.revealed;
    },
    startFlash,
    restartResponseTiming,
    markTimingInterrupted() {
      if (result || firstAnswerAt !== undefined) return;
      timingInterrupted = true;
    },
    pauseFlash,
    resumeFlash,
    onFlashChange(callback: () => void) {
      flashChange = callback;
      return () => {
        if (flashChange === callback) flashChange = undefined;
      };
    },
    revealFlash() {
      flash.reveal();
    },
    setMetadataHintsShown(shown: boolean) {
      if (!metadataHintsCaptured) {
        metadataHintsShown = shown;
        metadataHintsCaptured = true;
      }
    },
    cycleTypography() {
      const available = availableTypography(correctAnswers());
      if (available.length < 2) return false;
      const currentIndex = available.findIndex(
        (mode) =>
          mode.caseMode === presentation.caseMode &&
          mode.italic === presentation.italic,
      );
      const next = available[(currentIndex + 1) % available.length];
      if (
        next.caseMode !== presentation.caseMode &&
        current.phase !== 'bootstrap'
      ) {
        const visibleLetters = promptLetters(
          current.word.uniqueLetters,
          next.caseMode,
        );
        if (
          current.phase === 'reinforcement' &&
          state.reinforcement?.remaining &&
          !visibleLetters.includes(state.reinforcement.letter)
        )
          return false;
        const unknown = unknownLetters(current.word, state, next.caseMode);
        if (unknown.length > TRAINER_CONFIG.maxUnknownLettersIntroduction)
          return false;
        if (unknown.length === 1 && current.phase !== 'reinforcement')
          current = {
            ...current,
            phase: 'introduction',
            introducedLetter: unknown[0],
          };
      }
      presentation = { caseMode: next.caseMode, italic: next.italic };
      return true;
    },
    get lastScoreUpdate() {
      return lastScoreUpdate;
    },
    async submit(answer: string, skipped = false) {
      if (firstAnswerAt === undefined) {
        firstAnswerAt = Date.now();
        interruptedAtFirstAnswer = timingInterrupted;
      }
      const answeredAt = firstAnswerAt;
      return serialize(async () => {
        if (result) return;
        const flashAttempt = flash.capture();
        const completed = completeAttempt(
          state,
          current,
          answer,
          skipped,
          installationId,
          shownAt,
          answeredAt,
          crypto.randomUUID(),
          font.id,
          presentation,
          metadataHintsShown,
          flashAttempt,
          mode.id,
        );
        if (interruptedAtFirstAnswer)
          completed.attempt.payload.timingInterrupted = true;
        const newAchievementUnlocks = evaluateAchievements(
          [...state.recent].reverse().concat(completed.attempt),
          achievementUnlocks,
        );
        await repository.saveAttempt(
          completed.attempt,
          completed.state,
          newAchievementUnlocks,
        );
        const familiarity = completed.attempt.payload.familiarity;
        lastScoreUpdate =
          flashAttempt && !flashAttempt.revealed
            ? undefined
            : {
                wordId: current.word.id,
                practiceMode: mode.id,
                phase: current.phase,
                evidenceWeight: Math.max(
                  TRAINER_CONFIG.familiarWordEvidenceFloor,
                  1 - familiarity * TRAINER_CONFIG.familiarityDiscount,
                ),
                letters: Object.fromEntries(
                  promptLetters(
                    current.word.uniqueLetters,
                    presentation.caseMode,
                  ).map((letter) => [
                    letter,
                    {
                      before: state.letters[letter] ?? null,
                      after: completed.state.letters[letter],
                    },
                  ]),
                ),
                word: {
                  before: state.words[current.word.id] ?? null,
                  after: completed.state.words[current.word.id],
                },
              };
        state = completed.state;
        achievementUnlocks = [...achievementUnlocks, ...newAchievementUnlocks];
        lastAchievementUnlocks = newAchievementUnlocks;
        result = completed.attempt.payload.evaluation;
        letterPractice.recordAttempt();
      });
    },
    async practiceLetter(letter: string) {
      return serialize(async () => {
        const nextPresentation = selectTypography(settings, correctAnswers());
        const started = letterPractice.start(letter, nextPresentation.caseMode);
        if (started.status === 'target') {
          await replacePrompt(started.selection, nextPresentation);
          started.commit();
        }
        return started.status;
      });
    },
    async next() {
      return serialize(async () => {
        if (!result) return;
        const nextPresentation = selectTypography(settings, correctAnswers());
        const next = letterPractice.selectNext(nextPresentation.caseMode);
        await replacePrompt(next.selection, nextPresentation);
        next.commit();
      });
    },
    async setSettings(
      next: Pick<AppSettings, 'fonts'> &
        Partial<
          Pick<
            AppSettings,
            | 'analytics'
            | 'language'
            | 'practiceMode'
            | 'metadataHints'
            | 'syllableColors'
            | 'typography'
            | 'flash'
          >
        >,
      dictionary?: Dictionary,
    ) {
      const practiceModeChanged =
        parseSettings({ ...settings, ...next }).practiceMode !==
        settings.practiceMode;
      const applySettings = async () => {
        const saved = parseSettings({ ...settings, ...next });
        const nextPresentation = selectTypography(saved, correctAnswers());
        const modeChanged = saved.practiceMode !== settings.practiceMode;
        let nextMode = mode;
        let nextSelect = select;
        let nextWords = activeWords;
        let nextCurrent = current;
        if (modeChanged) {
          if (!dictionary)
            throw new Error('A dictionary is required to change practice mode');
          nextMode = getPracticeMode(saved.practiceMode);
          nextSelect = createWordSelector(dictionary.words, nextMode.strategy);
          nextWords = dictionary.words;
          nextCurrent = nextSelect(
            state,
            Date.now(),
            undefined,
            undefined,
            nextPresentation.caseMode,
          );
        }
        await repository.setSetting('app', saved);
        settings = saved;
        if (modeChanged) {
          const wasStarted = flash.started;
          const wasPaused = flash.paused;
          mode = nextMode;
          select = nextSelect;
          activeWords = nextWords;
          letterPractice.reset();
          current = nextCurrent;
          result = undefined;
          lastScoreUpdate = undefined;
          lastAchievementUnlocks = [];
          metadataHintsShown = hintsEnabled() && hasMetadataHints(current.word);
          metadataHintsCaptured = false;
          flash.reset();
          if (wasStarted) {
            startFlash();
            if (wasPaused) pauseFlash();
          }
        }
        if (!saved.flash.enabled) flash.show();
        pendingFont = fontLoader(selectFont(saved, correctAnswers()));
        font = await latestFont(pendingFont);
        presentation = nextPresentation;
        if (flash.started && !result && !flash.hidden && !flash.revealed) {
          const wasPaused = flash.paused;
          startFlash();
          if (wasPaused) pauseFlash();
        }
        if (!metadataHintsCaptured)
          metadataHintsShown = hintsEnabled() && hasMetadataHints(current.word);
      };
      return practiceModeChanged ? serialize(applySettings) : applySettings();
    },
    async markIntroShown() {
      await repository.setSetting('introShown', true);
      introShown = true;
    },
    clearProgress: () => repository.clearProgress(),
    dispose: () => flash.dispose(),
  };
}
export type Trainer = Awaited<ReturnType<typeof createTrainer>>;
