import type {
  Evaluation,
  LetterStat,
  Word,
  WordStat,
} from '../../shared/types.ts';
import { TRAINER_CONFIG } from './core/config.ts';
import { hasMetadataHints } from './core/metadata-hints.ts';
import { completeAttempt } from './core/session.ts';
import {
  type AppSettings,
  availableTypography,
  type FontOption,
  flashAvailable,
  flashExposureMs,
  loadFont,
  parseSettings,
  selectFont,
  selectTypography,
} from './core/settings.ts';
import type { Selection } from './core/word-selector.ts';
import { selectWord } from './core/word-selector.ts';
import type { Repository } from './storage/repository.ts';

interface ScoreUpdateDiagnostics {
  wordId: string;
  phase: Selection['phase'];
  evidenceWeight: number;
  letters: Record<string, { before: LetterStat | null; after: LetterStat }>;
  word: { before: WordStat | null; after: WordStat };
}
export interface TrainerOptions {
  /** Session-level override; diagnostic sessions can explicitly hide hints. */
  metadataHints?: boolean;
}
export async function createTrainer(
  words: Word[],
  repository: Repository,
  fontLoader: (font: FontOption) => Promise<FontOption> = loadFont,
  options: TrainerOptions = {},
) {
  let state = await repository.loadState();
  let settings = parseSettings(await repository.getSetting('app'));
  let introShown = (await repository.getSetting('introShown')) === true;
  let clientId = await repository.getSetting('clientId');
  if (typeof clientId !== 'string') {
    clientId = crypto.randomUUID();
    await repository.setSetting('clientId', clientId);
  }
  const installationId = clientId as string;
  const correctAnswers = () =>
    state.recent.filter(
      (attempt) =>
        attempt.payload.correct &&
        (!attempt.payload.flashMode || attempt.payload.flashRevealed),
    ).length;
  let pendingFont = fontLoader(selectFont(settings, correctAnswers()));
  let current = selectWord(words, state, Date.now()),
    font = await pendingFont,
    presentation = selectTypography(settings, correctAnswers()),
    shownAt = Date.now();
  let flashHidden = false;
  let flashRevealed = false;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let flashChange: (() => void) | undefined;
  let flashTimingInvalid = false;
  let flashStarted = false;
  let flashPaused = false;
  let flashVisibilityPaused = false;
  let flashVisibleSince: number | undefined;
  let flashElapsedMs = 0;
  let flashPlannedExposureMs = 0;
  const hintsEnabled = () => options.metadataHints ?? settings.metadataHints;
  let metadataHintsShown = hintsEnabled() && hasMetadataHints(current.word);
  let metadataHintsCaptured = false;
  let result: Evaluation | undefined,
    busy = false,
    lastScoreUpdate: ScoreUpdateDiagnostics | undefined;
  const clearFlashTimer = () => {
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    flashTimer = undefined;
  };
  const recordVisibleTime = () => {
    if (flashVisibleSince === undefined) return;
    flashElapsedMs += Math.max(0, Date.now() - flashVisibleSince);
    flashVisibleSince = undefined;
  };
  const hideFlash = () => {
    if (!flashStarted || flashPaused || result) return;
    recordVisibleTime();
    clearFlashTimer();
    flashHidden = true;
    flashChange?.();
  };
  const armFlashTimer = () => {
    if (
      result ||
      !flashStarted ||
      flashPaused ||
      flashHidden ||
      flashRevealed ||
      !settings.flash.enabled ||
      !flashAvailable(correctAnswers())
    )
      return;
    const remaining = Math.max(0, flashPlannedExposureMs - flashElapsedMs);
    if (!remaining) {
      hideFlash();
      return;
    }
    flashVisibleSince = Date.now();
    flashTimer = setTimeout(hideFlash, remaining);
  };
  const startFlash = () => {
    clearFlashTimer();
    flashHidden = false;
    flashRevealed = false;
    flashTimingInvalid = false;
    flashStarted = true;
    flashPaused = false;
    flashVisibilityPaused = false;
    flashElapsedMs = 0;
    shownAt = Date.now();
    flashPlannedExposureMs = flashExposureMs(
      settings.flash.exposureMs,
      current.word.length,
    );
    armFlashTimer();
  };
  const pauseFlash = () => {
    if (!flashStarted || flashPaused || flashHidden || flashRevealed || result)
      return;
    recordVisibleTime();
    clearFlashTimer();
    flashPaused = true;
  };
  const resumeFlash = () => {
    if (!flashStarted || !flashPaused || flashHidden || flashRevealed || result)
      return;
    flashPaused = false;
    armFlashTimer();
  };
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => {
      if (result) return;
      if (document.visibilityState === 'hidden') {
        if (!flashStarted || flashHidden || flashRevealed) return;
        const alreadyPaused = flashPaused;
        recordVisibleTime();
        clearFlashTimer();
        flashPaused = true;
        flashVisibilityPaused = !alreadyPaused;
        flashTimingInvalid = true;
      } else if (
        document.visibilityState === 'visible' &&
        flashVisibilityPaused
      ) {
        flashVisibilityPaused = false;
        if (flashPaused && !flashHidden && !flashRevealed) {
          flashPaused = false;
          armFlashTimer();
        }
      }
    });
  const latestFont = async (requested: Promise<FontOption>) => {
    let loaded = await requested;
    while (requested !== pendingFont) {
      requested = pendingFont;
      loaded = await requested;
    }
    return loaded;
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
    get metadataHintsEnabled() {
      return hintsEnabled();
    },
    get metadataHintsShown() {
      return metadataHintsShown;
    },
    get flashHidden() {
      return flashHidden;
    },
    get flashRevealed() {
      return flashRevealed;
    },
    startFlash,
    pauseFlash,
    resumeFlash,
    onFlashChange(callback: () => void) {
      flashChange = callback;
      return () => {
        if (flashChange === callback) flashChange = undefined;
      };
    },
    revealFlash() {
      if (!flashHidden || result) return;
      flashRevealed = true;
      flashHidden = false;
      clearFlashTimer();
      flashChange?.();
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
      const current = available.findIndex(
        (mode) =>
          mode.caseMode === presentation.caseMode &&
          mode.italic === presentation.italic,
      );
      const next = available[(current + 1) % available.length];
      presentation = { caseMode: next.caseMode, italic: next.italic };
      return true;
    },
    get lastScoreUpdate() {
      return lastScoreUpdate;
    },
    async submit(answer: string, skipped = false) {
      if (busy || result) return;
      busy = true;
      try {
        recordVisibleTime();
        clearFlashTimer();
        const flash =
          flashStarted &&
          settings.flash.enabled &&
          flashAvailable(correctAnswers())
            ? {
                exposureMs: flashPlannedExposureMs,
                ...(flashTimingInvalid
                  ? {}
                  : {
                      visibleDurationMs: flashElapsedMs,
                    }),
                revealed: flashRevealed,
              }
            : undefined;
        const completed = completeAttempt(
          state,
          current,
          answer,
          skipped,
          installationId,
          shownAt,
          Date.now(),
          crypto.randomUUID(),
          font.id,
          presentation,
          metadataHintsShown,
          flash,
        );
        await repository.saveAttempt(completed.attempt, completed.state);
        const familiarity = completed.attempt.payload.familiarity;
        lastScoreUpdate =
          flash && !flash.revealed
            ? undefined
            : {
                wordId: current.word.id,
                phase: current.phase,
                evidenceWeight: Math.max(
                  TRAINER_CONFIG.familiarWordEvidenceFloor,
                  1 - familiarity * TRAINER_CONFIG.familiarityDiscount,
                ),
                letters: Object.fromEntries(
                  current.word.uniqueLetters.map((letter) => [
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
        result = completed.attempt.payload.evaluation;
      } finally {
        busy = false;
      }
    },
    async next() {
      if (busy || !result) return;
      busy = true;
      try {
        const next = selectWord(words, state, Date.now());
        pendingFont = fontLoader(selectFont(settings, correctAnswers()));
        font = await latestFont(pendingFont);
        presentation = selectTypography(settings, correctAnswers());
        current = next;
        metadataHintsShown = hintsEnabled() && hasMetadataHints(current.word);
        metadataHintsCaptured = false;
        result = undefined;
        flashHidden = false;
        flashRevealed = false;
        flashStarted = false;
        flashPaused = false;
        flashVisibilityPaused = false;
        flashVisibleSince = undefined;
        clearFlashTimer();
      } finally {
        busy = false;
      }
    },
    async setSettings(
      next: Pick<AppSettings, 'fonts'> &
        Partial<
          Pick<
            AppSettings,
            'language' | 'metadataHints' | 'typography' | 'flash'
          >
        >,
    ) {
      const saved = parseSettings(next);
      await repository.setSetting('app', saved);
      settings = saved;
      if (!saved.flash.enabled && flashHidden) {
        flashHidden = false;
        flashChange?.();
      }
      pendingFont = fontLoader(selectFont(saved, correctAnswers()));
      font = await latestFont(pendingFont);
      presentation = selectTypography(saved, correctAnswers());
      if (flashStarted && !result && !flashHidden && !flashRevealed) {
        const wasPaused = flashPaused;
        startFlash();
        if (wasPaused) pauseFlash();
      }
      if (!metadataHintsCaptured)
        metadataHintsShown = hintsEnabled() && hasMetadataHints(current.word);
    },
    async markIntroShown() {
      await repository.setSetting('introShown', true);
      introShown = true;
    },
    clearProgress: () => repository.clearProgress(),
  };
}
export type Trainer = Awaited<ReturnType<typeof createTrainer>>;
