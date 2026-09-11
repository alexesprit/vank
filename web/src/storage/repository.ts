import type {
  AttemptEvent,
  LearnerState,
  LetterStat,
  WordStat,
} from '../../../shared/types.ts';
import type { AchievementUnlock } from '../core/achievements.ts';

export const PROGRESS_SCHEMA_VERSION = 2;
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error('Progress transaction aborted'));
    tx.onerror = () => reject(tx.error);
  });
}
export async function openRepository(name = 'vank') {
  const opening = indexedDB.open(name, PROGRESS_SCHEMA_VERSION);
  opening.onupgradeneeded = (event) => {
    const db = opening.result;
    if (event.oldVersion < 1) {
      db.createObjectStore('settings');
      db.createObjectStore('letterStats');
      db.createObjectStore('wordStats');
      db.createObjectStore('attempts', { keyPath: 'id' }).createIndex(
        'timestamp',
        'timestamp',
      );
    }
    if (event.oldVersion < 2)
      db.createObjectStore('achievements', { keyPath: 'id' });
  };
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
    opening.onblocked = () =>
      reject(
        new Error('Close other Vank tabs to upgrade local progress storage.'),
      );
  });
  db.onversionchange = () => db.close();
  const getSetting = (key: string): Promise<unknown> =>
    request(db.transaction('settings').objectStore('settings').get(key));
  const getLetterStats = async (): Promise<Record<string, LetterStat>> => {
    const store = db.transaction('letterStats').objectStore('letterStats');
    const [keys, values] = await Promise.all([
      request(store.getAllKeys()),
      request<LetterStat[]>(store.getAll()),
    ]);
    return Object.fromEntries(keys.map((key, i) => [String(key), values[i]]));
  };
  const getRecentAttempts = (limit: number): Promise<AttemptEvent[]> =>
    new Promise((resolve, reject) => {
      if (limit <= 0) {
        resolve([]);
        return;
      }
      const events: AttemptEvent[] = [];
      const cursor = db
        .transaction('attempts')
        .objectStore('attempts')
        .index('timestamp')
        .openCursor(null, 'prev');
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        if (!cursor.result || events.length >= limit) {
          resolve(events);
          return;
        }
        events.push(cursor.result.value as AttemptEvent);
        cursor.result.continue();
      };
    });
  const getAchievementUnlocks = (): Promise<AchievementUnlock[]> =>
    request(
      db.transaction('achievements').objectStore('achievements').getAll(),
    );
  return {
    close: () => db.close(),
    getSetting,
    getLetterStats,
    getRecentAttempts,
    getAchievementUnlocks,
    getWordStats: (id: string): Promise<WordStat | undefined> =>
      request(db.transaction('wordStats').objectStore('wordStats').get(id)),
    async setSetting(key: string, value: unknown) {
      const tx = db.transaction('settings', 'readwrite'),
        done = committed(tx);
      tx.objectStore('settings').put(value, key);
      await done;
    },
    async clearProgress() {
      const tx = db.transaction(
          ['achievements', 'attempts', 'letterStats', 'wordStats', 'settings'],
          'readwrite',
        ),
        done = committed(tx);
      tx.objectStore('achievements').clear();
      tx.objectStore('attempts').clear();
      tx.objectStore('letterStats').clear();
      tx.objectStore('wordStats').clear();
      tx.objectStore('settings').delete('reinforcement');
      await done;
    },
    async loadState(): Promise<LearnerState> {
      const store = db.transaction('wordStats').objectStore('wordStats');
      const [keys, values, letters, recent, reinforcement] = await Promise.all([
        request(store.getAllKeys()),
        request<WordStat[]>(store.getAll()),
        getLetterStats(),
        // ponytail: full history in memory; paginate analytics if years of use makes startup slow.
        getRecentAttempts(Infinity),
        getSetting('reinforcement'),
      ]);
      return {
        letters,
        words: Object.fromEntries(
          keys.map((key, i) => [String(key), values[i]]),
        ),
        recent,
        reinforcement: reinforcement as LearnerState['reinforcement'],
      };
    },
    async saveAchievementUnlocks(unlocks: readonly AchievementUnlock[]) {
      if (!unlocks.length) return;
      const tx = db.transaction('achievements', 'readwrite'),
        done = committed(tx),
        store = tx.objectStore('achievements');
      for (const unlock of unlocks) store.add(unlock);
      await done;
    },
    async saveAttempt(
      attempt: AttemptEvent,
      state: LearnerState,
      unlocks: readonly AchievementUnlock[] = [],
    ) {
      const tx = db.transaction(
          ['achievements', 'attempts', 'letterStats', 'wordStats', 'settings'],
          'readwrite',
        ),
        done = committed(tx);
      tx.objectStore('attempts').add(attempt);
      for (const [letter, stat] of Object.entries(state.letters))
        tx.objectStore('letterStats').put(stat, letter);
      tx.objectStore('wordStats').put(
        state.words[attempt.payload.wordId],
        attempt.payload.wordId,
      );
      tx.objectStore('settings').put(state.reinforcement, 'reinforcement');
      for (const unlock of unlocks) tx.objectStore('achievements').add(unlock);
      await done;
    },
  };
}
export type Repository = Awaited<ReturnType<typeof openRepository>>;
