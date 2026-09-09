import { expect, it } from 'vitest';
import { deriveWord } from '../shared/armenian';
import { loadDictionary } from '../web/src/data/dictionary';

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
