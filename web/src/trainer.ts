import type { Evaluation, Word } from '../../shared/types.ts';
import { completeAttempt } from './core/session.ts';
import { selectWord } from './core/word-selector.ts';
import type { Repository } from './storage/repository.ts';
export async function createTrainer(words: Word[], repository: Repository) {
  let state = await repository.loadState();
  let clientId = await repository.getSetting('clientId');
  if (typeof clientId !== 'string') {
    clientId = crypto.randomUUID();
    await repository.setSetting('clientId', clientId);
  }
  const installationId = clientId as string;
  let current = selectWord(words, state, Date.now()),
    shownAt = Date.now();
  let result: Evaluation | undefined,
    busy = false;
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
        );
        await repository.saveAttempt(completed.attempt, completed.state);
        state = completed.state;
        result = completed.attempt.payload.evaluation;
      } finally {
        busy = false;
      }
    },
    next() {
      if (busy || !result) return;
      current = selectWord(words, state, Date.now());
      shownAt = Date.now();
      result = undefined;
    },
  };
}
export type Trainer = Awaited<ReturnType<typeof createTrainer>>;
