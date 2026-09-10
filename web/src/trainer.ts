import type { Evaluation, Word } from '../../shared/types.ts';
import { completeAttempt } from './core/session.ts';
import {
  type AppSettings,
  type FontOption,
  loadFont,
  parseSettings,
  selectFont,
  selectTypography,
} from './core/settings.ts';
import { selectWord } from './core/word-selector.ts';
import type { Repository } from './storage/repository.ts';
export async function createTrainer(
  words: Word[],
  repository: Repository,
  fontLoader: (font: FontOption) => Promise<FontOption> = loadFont,
) {
  let state = await repository.loadState();
  let settings = parseSettings(await repository.getSetting('app'));
  let clientId = await repository.getSetting('clientId');
  if (typeof clientId !== 'string') {
    clientId = crypto.randomUUID();
    await repository.setSetting('clientId', clientId);
  }
  const installationId = clientId as string;
  const correctAnswers = () =>
    state.recent.filter((attempt) => attempt.payload.correct).length;
  let pendingFont = fontLoader(selectFont(settings, correctAnswers()));
  let current = selectWord(words, state, Date.now()),
    font = await pendingFont,
    presentation = selectTypography(settings, correctAnswers()),
    shownAt = Date.now();
  let result: Evaluation | undefined,
    busy = false;
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
    get font() {
      return font;
    },
    get presentation() {
      return presentation;
    },
    async submit(answer: string, skipped = false) {
      if (busy || result) return;
      busy = true;
      try {
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
        );
        await repository.saveAttempt(completed.attempt, completed.state);
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
        shownAt = Date.now();
        result = undefined;
      } finally {
        busy = false;
      }
    },
    async setSettings(
      next: Pick<AppSettings, 'fonts'> &
        Partial<Pick<AppSettings, 'typography'>>,
    ) {
      const saved = parseSettings(next);
      await repository.setSetting('app', saved);
      settings = saved;
      pendingFont = fontLoader(selectFont(saved, correctAnswers()));
      font = await latestFont(pendingFont);
      presentation = selectTypography(saved, correctAnswers());
    },
  };
}
export type Trainer = Awaited<ReturnType<typeof createTrainer>>;
