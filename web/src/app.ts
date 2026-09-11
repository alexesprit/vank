import '../styles/main.css';
import { startAnalytics } from './analytics.ts';
import { parseSettings } from './core/settings.ts';
import { loadDictionary } from './data/dictionary.ts';
import { initializeI18n, localizeDocument } from './i18n/index.ts';
import type { LanguagePreference } from './i18n/types.ts';
import { openRepository } from './storage/repository.ts';
import { createTrainer } from './trainer.ts';
import { mountTrainer, showError } from './ui/trainer-view.ts';

async function start() {
  let language: LanguagePreference = 'auto';
  let repository: Awaited<ReturnType<typeof openRepository>>;
  try {
    repository = await openRepository();
    language = parseSettings(await repository.getSetting('app')).language;
  } catch (error) {
    const locale = await initializeI18n('auto', navigator.languages);
    localizeDocument(locale);
    throw error;
  }
  const locale = await initializeI18n(language, navigator.languages);
  localizeDocument(locale);
  const dictionary = await loadDictionary();
  const trainer = await createTrainer(dictionary.words, repository);
  mountTrainer(trainer, dictionary, () =>
    startAnalytics(trainer.settings.analytics),
  );
  if (trainer.introShown) startAnalytics(trainer.settings.analytics);
}
start().catch((error) => {
  const loading = document.getElementById('loading');
  if (loading) loading.hidden = true;
  showError(error);
});
