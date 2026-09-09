import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { createTrainer } from '../web/src/trainer';
import { openRepository } from '../web/src/storage/repository';
import { deriveWord } from '../shared/armenian';
import { parseDictionary } from '../shared/schema';
import { readFileSync } from 'node:fs';
import { ALPHABET } from '../shared/armenian';
import { curatedSource } from '../builder/src/sources/curated';
import { deriveMetadata, mergeSources } from '../builder/src/pipeline';

const recognizable = (word: string) => ({ ...deriveWord(word), familiarity: { ru: 1 }, loanwordScore: 1 });

it('validates the runtime dictionary and covers every written Armenian letter repeatedly', () => {
  const dictionary = parseDictionary(JSON.parse(readFileSync('web/data/words.json', 'utf8')));
  expect(dictionary.words.length).toBeGreaterThanOrEqual(50);
  for (const letter of ALPHABET) expect(dictionary.words.filter(w => w.uniqueLetters.includes(letter.upper)).length, letter.upper).toBeGreaterThanOrEqual(2);
});
it('submits once, saves before advancing, restores progress and retains stable client ID', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const words = ['ՄԱՄԱ', 'ՆԱՆԱ', 'ՍԱ', 'ՄԱՍ'].map(recognizable);
  const trainer = await createTrainer(words, repo);
  const first = trainer.current.word;
  await Promise.all([trainer.submit(first.readingLatin), trainer.submit(first.readingLatin)]);
  expect(trainer.result?.correct).toBe(true);
  expect(trainer.state.recent).toHaveLength(1);
  const clientId = trainer.state.recent[0].clientId;
  trainer.next(); expect(trainer.current.word.id).not.toBe(first.id);
  const reloaded = await createTrainer(words, repo);
  expect(reloaded.state.recent).toHaveLength(1);
  await reloaded.submit('', true);
  expect(reloaded.state.recent[0].clientId).toBe(clientId);
  repo.close();
});
it('keeps the same prompt and unsaved result retryable after a storage failure', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  let fail = true;
  const trainer = await createTrainer(['ՄԱՄԱ', 'ՆԱՆԱ'].map(recognizable), {
    ...repo, saveAttempt: async (...args) => { if (fail) throw new Error('disk full'); await repo.saveAttempt(...args); },
  });
  const id = trainer.current.word.id;
  await expect(trainer.submit('mama')).rejects.toThrow('disk full');
  expect(trainer.result).toBeUndefined();
  expect(trainer.state.recent).toHaveLength(0);
  trainer.next(); expect(trainer.current.word.id).toBe(id);
  fail = false; await trainer.submit('mama');
  expect(trainer.state.recent).toHaveLength(1);
  repo.close();
});

it.each([['seed', 500], ['runtime', 1000]] as const)('traverses the %s alphabet within %i attempts without repeat or introduction-limit violations', async (dataset, attempts) => {
  const { selectWord, unknownLetters } = await import('../web/src/core/word-selector');
  const { completeAttempt } = await import('../web/src/core/session');
  const words = dataset === 'seed'
    ? deriveMetadata(mergeSources(curatedSource(JSON.parse(readFileSync('builder/data/curated.json', 'utf8')))).words)
    : parseDictionary(JSON.parse(readFileSync('web/data/words.json', 'utf8'))).words;
  let state: import('../shared/types').LearnerState = { letters: {}, words: {}, recent: [] };
  let previous = '';
  for (let i = 0; i < attempts; i++) {
    const choice = selectWord(words, state, i * 10000);
    expect(choice.word.id).not.toBe(previous);
    if (choice.phase !== 'bootstrap') expect(unknownLetters(choice.word, state).length).toBeLessThanOrEqual(1);
    previous = choice.word.id;
    state = completeAttempt(state, choice, choice.word.readingLatin, false, 'simulation', i * 10000, i * 10000 + 2000, String(i)).state;
  }
  expect(Object.keys(state.letters)).toHaveLength(ALPHABET.length);
});
