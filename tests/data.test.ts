import { expect, it } from 'vitest';
import { deriveWord } from '../shared/armenian';
import { PRACTICE_MODES } from '../web/src/core/modes';
import { dictionaryUrl, loadDictionary } from '../web/src/data/dictionary';

it('loads and runtime-validates static JSON; reports HTTP and schema errors', async () => {
  const data = {
    version: 1,
    schemaVersion: 1,
    generatedAt: '2026-09-09',
    words: [deriveWord('ՄԱՄԱ')],
  };
  expect(
    (await loadDictionary(async () => Response.json(data))).words,
  ).toHaveLength(1);
  await expect(
    loadDictionary(async () => new Response('', { status: 404 })),
  ).rejects.toThrow('404');
  await expect(
    loadDictionary(async () => Response.json({ ...data, schemaVersion: 99 })),
  ).rejects.toThrow('schema');
});

it('loads the requested practice mode without caching the payload', async () => {
  const data = {
    version: 1,
    schemaVersion: 1,
    generatedAt: '2026-09-09',
    words: [deriveWord('ՄԱՄԱ')],
  };
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    requests.push(String(input));
    return Response.json(data);
  };

  await loadDictionary('words', fetcher);
  await loadDictionary('words', fetcher);

  expect(requests).toEqual([dictionaryUrl('words'), dictionaryUrl('words')]);
});

it('loads both specialized dictionaries through the mode registry', async () => {
  const data = {
    version: 1,
    schemaVersion: 1,
    generatedAt: '2026-09-09',
    words: [deriveWord('ՄԱՄԱ')],
  };
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    requests.push(String(input));
    return Response.json(data);
  };

  for (const mode of PRACTICE_MODES.filter(({ id }) => id !== 'words')) {
    expect((await loadDictionary(mode.id, fetcher)).words).toHaveLength(1);
  }

  expect(requests).toEqual([
    dictionaryUrl('toponyms'),
    dictionaryUrl('countries'),
  ]);
});

it('groups modes by selection strategy for the settings UI', () => {
  expect(
    PRACTICE_MODES.map(({ id, group, strategy }) => ({ id, group, strategy })),
  ).toEqual([
    { id: 'words', group: 'adaptive', strategy: 'adaptive' },
    { id: 'toponyms', group: 'packs', strategy: 'finite-pack' },
    { id: 'countries', group: 'packs', strategy: 'finite-pack' },
  ]);
});

it('forwards an abort signal to dictionary requests', async () => {
  const data = {
    version: 1,
    schemaVersion: 1,
    generatedAt: '2026-09-09',
    words: [deriveWord('ՄԱՄԱ')],
  };
  const controller = new AbortController();
  let received: AbortSignal | null | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    received = init?.signal;
    return Response.json(data);
  };

  await loadDictionary('words', fetcher, controller.signal);

  expect(received).toBe(controller.signal);
});
