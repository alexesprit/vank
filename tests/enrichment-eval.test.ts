import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  type EnrichmentProvider,
  enrichWords,
} from '../builder/src/enrichment';
import {
  evaluateEnrichment,
  familiarityClass,
  parseEnrichmentReferences,
  validateEnrichmentReferences,
} from '../builder/src/enrichment-eval';
import { parseRawWords, readJson } from '../builder/src/io';
import { deriveMetadata, mergeSources } from '../builder/src/pipeline';
import { curatedSource } from '../builder/src/sources/curated';

const words = () =>
  deriveMetadata(
    mergeSources(curatedSource([{ word: 'տաքսի' }, { word: 'բարև' }])).words,
  );
const item = (id: string, familiar: boolean) => ({
  id,
  meaning: { ru: familiar ? 'такси' : 'привет' },
  familiarity: { ru: familiar ? 1 : 0.1 },
  loanwordScore: familiar ? 1 : 0,
  usefulnessScore: 0.9,
  categories: [familiar ? 'transport' : 'greetings'],
  tags: [],
  confidence: 0.9,
  flags: [],
});

describe('provider-neutral no-cache evaluation', () => {
  it('keeps the committed evaluation fixture aligned', async () => {
    const source = parseRawWords(
      await readJson(
        join(process.cwd(), 'builder/evals/enrichment/source.json'),
      ),
    );
    const words = deriveMetadata(mergeSources(source).words);
    const references = parseEnrichmentReferences(
      await readJson(
        join(process.cwd(), 'builder/evals/enrichment/reference.json'),
      ),
      'ru',
    );
    expect(words).toHaveLength(30);
    expect(references).toHaveLength(30);
    expect(() => validateEnrichmentReferences(words, references)).not.toThrow();
  });

  it.each<EnrichmentProvider>(['openrouter', 'ollama'])(
    'uses the compatible request shape for %s',
    async (provider) => {
      const cacheDir = await mkdtemp(join(tmpdir(), 'vank-eval-'));
      try {
        const dataset = words();
        const fetcher = vi.fn(
          async (url: string | URL | Request, init?: RequestInit) => {
            expect(String(url)).toBe(
              provider === 'ollama'
                ? 'http://localhost:11434/v1/chat/completions'
                : 'http://provider.test/v1/chat/completions',
            );
            const body = JSON.parse(String(init?.body));
            const payload = JSON.parse(body.messages[1].content);
            expect(body.model).toBe('eval/model');
            expect(body.response_format.type).toBe('json_schema');
            const headers = new Headers(init?.headers);
            expect(headers.has('Authorization')).toBe(
              provider === 'openrouter',
            );
            if (provider === 'openrouter')
              expect(body.provider).toEqual({ require_parameters: true });
            else {
              expect(body).not.toHaveProperty('provider');
              expect(body.reasoning_effort).toBe('none');
            }
            return Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      items: payload.words.map(
                        (word: { id: string }, index: number) =>
                          item(word.id, index === 0),
                      ),
                    }),
                  },
                },
              ],
            });
          },
        );
        const result = await enrichWords(dataset, {
          provider,
          model: 'eval/model',
          apiKey: provider === 'openrouter' ? 'key' : '',
          endpoint:
            provider === 'openrouter'
              ? 'http://provider.test/v1/chat/completions'
              : undefined,
          cacheDir: undefined,
          maxRetries: 0,
          fetcher,
        });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(result[0].ai).toMatchObject({ provider, model: 'eval/model' });
        expect(result[0].metadataSource['meaning.ru']).toBe(provider);
        expect(await readdir(cacheDir)).toEqual([]);
      } finally {
        await rm(cacheDir, { recursive: true, force: true });
      }
    },
  );

  it('scores outputs against threshold-based human references', () => {
    const [taxi, barev] = words();
    if (!taxi || !barev) throw new Error('Missing evaluation fixture words');
    const metrics = evaluateEnrichment(
      [
        {
          ...taxi,
          meaning: { ru: 'такси' },
          familiarity: { ru: 1 },
          categories: ['transport'],
          usefulnessScore: 1,
          flags: [],
        },
        {
          ...barev,
          meaning: { ru: 'привет' },
          familiarity: { ru: 0.1 },
          categories: ['greetings'],
          usefulnessScore: 0.8,
          flags: [],
        },
      ],
      [
        {
          word: taxi.word,
          meaning: { ru: ['такси'] },
          familiarity: { ru: 'familiar' },
          categories: ['transport'],
          usefulnessMin: 0.8,
        },
        {
          word: barev.word,
          meaning: { ru: ['привет'] },
          familiarity: { ru: 'verification' },
          categories: ['greetings'],
          usefulnessMin: 0.8,
        },
      ],
      'ru',
    );
    expect(metrics).toMatchObject({
      total: 2,
      meaningAccuracy: 1,
      familiarityAccuracy: 1,
      flagAccuracy: 1,
      categoryRecall: 1,
      usefulnessAccuracy: 1,
    });
    expect(metrics.familiar.f1).toBe(1);
    expect(metrics.verification.f1).toBe(1);
  });

  it('returns per-word diffs for failed fields', () => {
    const [taxi, barev] = words();
    if (!taxi || !barev) throw new Error('Missing evaluation fixture words');
    const metrics = evaluateEnrichment(
      [
        {
          ...taxi,
          meaning: { ru: 'такси' },
          familiarity: { ru: 1 },
          categories: ['transport'],
          usefulnessScore: 1,
          flags: [],
        },
        {
          ...barev,
          meaning: { ru: 'bonjour' },
          familiarity: { ru: 0.7 },
          categories: ['transport'],
          usefulnessScore: 0.5,
          flags: ['review'],
        },
      ],
      [
        {
          word: taxi.word,
          meaning: { ru: ['такси'] },
          familiarity: { ru: 'familiar' },
          categories: ['transport'],
          usefulnessMin: 0.8,
        },
        {
          word: barev.word,
          meaning: { ru: ['привет'] },
          familiarity: { ru: 'verification' },
          categories: ['greetings'],
          usefulnessMin: 0.8,
        },
      ],
      'ru',
    );
    expect(metrics.items[0]).toMatchObject({
      id: taxi.id,
      word: taxi.word,
      meaning: { actual: 'такси', match: true },
    });
    expect(metrics.items[1]).toMatchObject({
      id: barev.id,
      word: barev.word,
      meaning: { expected: ['привет'], actual: 'bonjour', match: false },
      familiarity: {
        expected: 'verification',
        actual: 'middle',
        score: 0.7,
        match: false,
      },
      flagged: { expected: false, actual: true, match: false },
      categories: {
        expected: ['greetings'],
        actual: ['transport'],
        missing: ['greetings'],
        match: false,
      },
      usefulness: { minimum: 0.8, actual: 0.5, match: false },
    });
  });

  it('calculates category recall across expected categories', () => {
    const [taxi] = words();
    if (!taxi) throw new Error('Missing evaluation fixture word');
    const metrics = evaluateEnrichment(
      [
        {
          ...taxi,
          meaning: { ru: 'такси' },
          familiarity: { ru: 1 },
          categories: ['transport'],
          usefulnessScore: 1,
          flags: [],
        },
      ],
      [
        {
          word: taxi.word,
          meaning: { ru: ['такси'] },
          familiarity: { ru: 'familiar' },
          categories: ['transport', 'everyday'],
        },
      ],
      'ru',
    );
    expect(metrics.categoryRecall).toBe(0.5);
    expect(metrics.items[0]?.categories).toMatchObject({
      missing: ['everyday'],
      match: false,
    });
  });

  it('uses the audience familiarity thresholds', () => {
    expect(familiarityClass(0.8)).toBe('familiar');
    expect(familiarityClass(0.4)).toBe('verification');
    expect(familiarityClass(0.6)).toBe('middle');
  });

  it('rejects malformed reference records', () => {
    expect(() =>
      parseEnrichmentReferences([
        {
          word: 'ՏԱՔՍԻ',
          meaning: { ru: ['такси'] },
          familiarity: { ru: 'familiar' },
          categories: ['not-a-category'],
        },
      ]),
    ).toThrow('Invalid evaluation category');
  });

  it('requires the evaluated language and known reference fields', () => {
    expect(() =>
      parseEnrichmentReferences(
        [
          {
            word: 'ՏԱՔՍԻ',
            meaning: { ru: ['такси'] },
            familiarity: { ru: 'familiar' },
            extra: true,
          },
        ],
        'ru',
      ),
    ).toThrow('Unknown evaluation reference field');
    expect(() =>
      parseEnrichmentReferences(
        [
          {
            word: 'ՏԱՔՍԻ',
            meaning: { en: ['taxi'] },
            familiarity: { en: 'familiar' },
          },
        ],
        'ru',
      ),
    ).toThrow('missing ru meaning');
  });
});
