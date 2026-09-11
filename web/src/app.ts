import '../styles/main.css';
import { startAnalytics } from './analytics.ts';
import {
  DEFAULT_PRACTICE_MODE,
  getPracticeMode,
  type PracticeModeId,
} from './core/modes.ts';
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  parseSettings,
} from './core/settings.ts';
import { createWordSelector } from './core/word-selector.ts';
import { loadDictionary } from './data/dictionary.ts';
import { initializeI18n, localizeDocument } from './i18n/index.ts';
import type { LanguagePreference } from './i18n/types.ts';
import { openRepository } from './storage/repository.ts';
import { createTrainer } from './trainer.ts';
import { mountTrainer, showError } from './ui/trainer-view.ts';

async function start() {
  let language: LanguagePreference = 'auto';
  let practiceMode: PracticeModeId = DEFAULT_PRACTICE_MODE;
  let settings: AppSettings = DEFAULT_SETTINGS;
  let repository: Awaited<ReturnType<typeof openRepository>>;
  try {
    repository = await openRepository();
    settings = parseSettings(await repository.getSetting('app'));
    language = settings.language;
    practiceMode = settings.practiceMode;
  } catch (error) {
    const locale = await initializeI18n('auto', navigator.languages);
    localizeDocument(locale);
    throw error;
  }
  const locale = await initializeI18n(language, navigator.languages);
  localizeDocument(locale);
  const mode = getPracticeMode(practiceMode);
  const startupAbort = new AbortController();
  const abortStartup = (event: PageTransitionEvent) => {
    if (!event.persisted) startupAbort.abort();
  };
  window.addEventListener('pagehide', abortStartup);
  try {
    const dictionary = await loadDictionary(
      mode.id,
      fetch,
      startupAbort.signal,
    );
    if (startupAbort.signal.aborted) return;
    const trainer = await createTrainer(
      dictionary.words,
      repository,
      undefined,
      {
        settings,
        mode,
        selector: createWordSelector(dictionary.words, mode.strategy),
      },
    );
    if (startupAbort.signal.aborted) {
      trainer.dispose();
      return;
    }
    mountTrainer(trainer, dictionary, () =>
      startAnalytics(trainer.settings.analytics),
    );
    if (trainer.introShown) startAnalytics(trainer.settings.analytics);
  } finally {
    window.removeEventListener('pagehide', abortStartup);
  }
}
start().catch((error) => {
  if (error instanceof Error && error.name === 'AbortError') return;
  const loading = document.getElementById('loading');
  if (loading) loading.hidden = true;
  showError(error);
});
