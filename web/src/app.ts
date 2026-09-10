import '../styles/main.css';
import { loadDictionary } from './data/dictionary.ts';
import { openRepository } from './storage/repository.ts';
import { createTrainer } from './trainer.ts';
import { mountTrainer, showError } from './ui/trainer-view.ts';

async function start() {
  const dictionary = await loadDictionary();
  const repository = await openRepository();
  mountTrainer(await createTrainer(dictionary.words, repository), dictionary);
}
start().catch((error) => {
  const loading = document.getElementById('loading');
  if (loading) loading.hidden = true;
  showError(error);
});
