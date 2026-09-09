import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { deriveWord } from '../shared/armenian';
import { completeAttempt } from '../web/src/core/session';
import { openRepository } from '../web/src/storage/repository';

it('creates only MVP stores and persists settings and full attempt events across reopening', async () => {
  const name = `test-${crypto.randomUUID()}`;
  let repo = await openRepository(name);
  await repo.setSetting('clientId', 'client-1');
  expect(await repo.getSetting('clientId')).toBe('client-1');
  expect(await repo.getSetting('missing')).toBeUndefined();
  const state = await repo.loadState();
  expect(state).toMatchObject({ letters: {}, words: {}, recent: [] });
  const word = deriveWord('ՏԱՔՍԻ');
  const result = completeAttempt(
    state,
    { word, phase: 'bootstrap' },
    'такси',
    false,
    'client-1',
    10,
    20,
    'attempt-1',
  );
  await repo.saveAttempt(result.attempt, result.state);
  repo.close();
  repo = await openRepository(name);
  const restored = await repo.loadState();
  expect(restored.recent[0]).toEqual(result.attempt);
  expect(restored.letters).toEqual(result.state.letters);
  expect(restored.words).toEqual(result.state.words);
  expect(await repo.getRecentAttempts(1)).toEqual([result.attempt]);
  expect(await repo.getWordStats(word.id)).toEqual(result.state.words[word.id]);
  expect(await repo.getLetterStats()).toEqual(result.state.letters);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  expect(db.version).toBe(1);
  expect([...db.objectStoreNames]).toEqual([
    'attempts',
    'letterStats',
    'settings',
    'wordStats',
  ]);
  db.close();
  repo.close();
});
it('writes attempts and progress atomically, rejecting duplicate event IDs without double counting', async () => {
  const repo = await openRepository(`test-${crypto.randomUUID()}`);
  const result = completeAttempt(
    await repo.loadState(),
    { word: deriveWord('ՄԱՄԱ'), phase: 'bootstrap' },
    'mama',
    false,
    'c',
    1,
    2,
    'same-id',
  );
  await repo.saveAttempt(result.attempt, result.state);
  const duplicate = completeAttempt(
    result.state,
    { word: deriveWord('ՄԱՄԱ'), phase: 'bootstrap' },
    '',
    true,
    'c',
    3,
    4,
    'same-id',
  );
  await expect(
    repo.saveAttempt(duplicate.attempt, duplicate.state),
  ).rejects.toThrow();
  expect((await repo.loadState()).letters).toEqual(result.state.letters);
  expect(await repo.getRecentAttempts(10)).toHaveLength(1);
  repo.close();
});
