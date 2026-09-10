import type {
  Evaluation,
  LetterStat,
  Word,
  WordStat,
} from '../../shared/types.ts';
import { TRAINER_CONFIG } from './core/config.ts';
import { createFlashSession } from './core/flash-session.ts';
import { hasMetadataHints } from './core/metadata-hints.ts';
import { completeAttempt, countCorrectAnswers } from './core/session.ts';
import {
  type AppSettings,
  availableTypography,
  type FontOption,
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
  const correctAnswers = () => countCorrectAnswers(state.recent);
  let pendingFont = fontLoader(selectFont(settings, correctAnswers()));
  let current = selectWord(words, state, Date.now()),
    font = await pendingFont,
    presentation = selectTypography(settings, correctAnswers()),
    shownAt = Date.now();
  let flashChange: (() => void) | undefined;
  const hintsEnabled = () => options.metadataHints ?? settings.metadataHints;
  let metadataHintsShown = hintsEnabled() && hasMetadataHints(current.word);
  let metadataHintsCaptured = false;
  let result: Evaluation | undefined,
    busy = false,
    lastScoreUpdate: ScoreUpdateDiagnostics | undefined;
  const flash = createFlashSession({
    getEnabled: () => settings.flash.enabled,
    getCorrectAnswers: correctAnswers,
    getBaseExposureMs: () => settings.flash.exposureMs,
    getWordLength: () => current.word.length,
    getHasResult: () => Boolean(result),
    onChange: () => flashChange?.(),
  });
  const startFlash = () => {
    shownAt = Date.now();
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
      return flash.hidden;
    },
    get flashRevealed() {
      return flash.revealed;
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
        const flashAttempt = flash.capture();
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
          flashAttempt,
        );
        await repository.saveAttempt(completed.attempt, completed.state);
        const familiarity = completed.attempt.payload.familiarity;
        lastScoreUpdate =
          flashAttempt && !flashAttempt.revealed
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
        flash.reset();
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
      if (!saved.flash.enabled) flash.show();
      pendingFont = fontLoader(selectFont(saved, correctAnswers()));
      font = await latestFont(pendingFont);
      presentation = selectTypography(saved, correctAnswers());
      if (flash.started && !result && !flash.hidden && !flash.revealed) {
        const wasPaused = flash.paused;
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
    dispose: () => flash.dispose(),
  };
}
export type Trainer = Awaited<ReturnType<typeof createTrainer>>;
