import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAiResponse, enrichmentSchema, cacheKey, enrichWords } from '../builder/src/enrichment';
import { curatedSource } from '../builder/src/sources/curated';
import { deriveMetadata, mergeSources } from '../builder/src/pipeline';
const words = () => deriveMetadata(mergeSources(curatedSource([{ word: 'ՏԱՔՍԻ', familiarity: { ru: 1 } }, { word: 'ԲԱՐԵՎ' }, { word: 'ԱՆՆԱ' }])).words);
const item = (id: string) => ({ id, meaning: { ru: 'слово' }, familiarity: { ru: 0.5 }, loanwordScore: 0.1, usefulnessScore: 0.7, categories: [], tags: [], confidence: 0.9, flags: [] });
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const directory = async () => { const dir = await mkdtemp(join(tmpdir(), 'vank-ai-')); dirs.push(dir); return dir; };

describe('AI response boundary', () => {
  it('matches by stable IDs, never response order, and accepts empty categories', () => {
    const ids = words().map(w => w.id);
    expect(parseAiResponse({ items: [...ids].reverse().map(item) }, ids, ['ru']).map(i => i.id)).toEqual([...ids].reverse());
    expect(enrichmentSchema(['ru']).properties.items.items.properties.categories.items.enum).toContain('person-name');
  });
  it('rejects missing/duplicate/unknown IDs, bad scores, categories, arrays, languages and extra technical fields', () => {
    const id = words()[0].id;
    for (const items of [[], [item(id), item(id)], [item('wrong')], [{ ...item(id), familiarity: { ru: 2 } }],
      [{ ...item(id), meaning: { en: 'word' } }], [{ ...item(id), categories: ['misc'] }], [{ ...item(id), tags: 'x' }],
      [{ ...item(id), word: 'FAKE' }], [{ ...item(id), confidence: -1 }]]) expect(() => parseAiResponse({ items }, [id], ['ru'])).toThrow();
    expect(() => parseAiResponse('prose', [id], ['ru'])).toThrow();
  });
  it('cache identity changes with model, versions, input and learner languages', () => {
    const w = words()[0]; const key = cacheKey(w, 'model-a', ['ru']);
    expect(cacheKey(w, 'model-a', ['ru'])).toBe(key);
    expect(cacheKey(w, 'model-b', ['ru'])).not.toBe(key);
    expect(cacheKey(w, 'model-a', ['en'])).not.toBe(key);
    expect(cacheKey({ ...w, readingLatin: 'other' }, 'model-a', ['ru'])).not.toBe(key);
    expect(cacheKey({ ...w, rawDefinitions: ['different meaning'] }, 'model-a', ['ru'])).not.toBe(key);
    expect(cacheKey({ ...w, recognitionHints: { ru: 'такси' } }, 'model-a', ['ru'])).not.toBe(key);
  });
});
it('batches, validates, caches individual words and resumes after an interruption', async () => {
  const cacheDir = await directory(), dataset = words();
  let calls = 0;
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    if (calls === 2) throw new Error('interrupted');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('test/model');
    expect(body).not.toHaveProperty('temperature');
    expect(body.response_format.type).toBe('json_schema');
    const payload = JSON.parse(body.messages[1].content);
    expect(body.response_format.json_schema.schema.properties.items.items.properties.id.enum).toEqual(payload.words.map((w: { id: string }) => w.id));
    expect(payload.learnerLanguages).toEqual(['ru']);
    expect(payload.words[0]).toHaveProperty('definitions');
    expect(payload.words[0]).toHaveProperty('partsOfSpeech');
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: payload.words.map((w: { id: string }) => item(w.id)) }) } }] });
  });
  const opts = { apiKey: 'fixture-key', model: 'test/model', cacheDir, batchSize: 2, maxRetries: 0, fetcher };
  await expect(enrichWords(dataset, opts)).rejects.toThrow('interrupted');
  const reports: unknown[] = [];
  const result = await enrichWords(dataset, { ...opts, batchSize: 1, report: p => reports.push(p) });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(result).toHaveLength(3);
  expect(reports).toContainEqual(expect.objectContaining({ cached: 2, api: 1, processed: 3, total: 3 }));
  expect(result.find(w => w.word === 'ՏԱՔՍԻ')?.familiarity?.ru).toBe(1);
  expect(result[0].ai).toMatchObject({ model: 'test/model', promptVersion: 2, schemaVersion: 1 });
  await enrichWords(dataset, { ...opts, apiKey: '', fetcher: async () => { throw new Error('must use cache'); } });
});
it('retries a transient failure, reports it, and never caches an invalid payload', async () => {
  const cacheDir = await directory(); let calls = 0;
  const report = vi.fn();
  const fetcher = async () => { calls++; return calls === 1 ? new Response('', { status: 429 }) : Response.json({ choices: [{ message: { content: JSON.stringify({ items: [item(words()[0].id)] }) } }] }); };
  await enrichWords(words().slice(0, 1), { apiKey: 'key', model: 'm', cacheDir, fetcher, sleep: async () => {}, report });
  expect(calls).toBe(2);
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ retries: 1 }));
  const invalid = await directory();
  await expect(enrichWords(words().slice(0, 1), { apiKey: 'key', model: 'm', cacheDir: invalid, maxRetries: 0, fetcher: async () => Response.json({ choices: [{ message: { content: 'not json' } }] }) })).rejects.toThrow();
});

it('reports the provider error reason without exposing the configured API key', async () => {
  const cacheDir = await directory();
  await expect(enrichWords(words().slice(0, 1), {
    apiKey: 'private-fixture-key', model: 'm', cacheDir, maxRetries: 0,
    fetcher: async () => Response.json({ error: { message: 'No endpoints available for private-fixture-key' } }, { status: 404 }),
  })).rejects.toThrow('OpenRouter HTTP 404: No endpoints available for [redacted]');
});
