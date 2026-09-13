import { describe, expect, it } from 'vitest';
import {
  parseTargetManifest,
  readTargetManifest,
  selectTargets,
} from '../builder/src/targets.ts';

const manifest = parseTargetManifest({
  targets: {
    words: {
      required: true,
      config: 'builder/config.json',
      dataDir: 'builder/data',
      output: 'web/data/words.json',
      asset: 'words.json',
      enrichment: 'openrouter',
      checks: ['audience', 'achievements'],
    },
    countries: {
      pack: true,
      config: 'builder/config-countries.json',
      dataDir: 'builder/data/countries',
      output: 'web/data/countries.json',
      asset: 'countries.json',
      enrichment: 'none',
      checks: [],
    },
  },
});

describe('dictionary targets', () => {
  it('selects enabled targets and requires the primary dictionary', () => {
    expect(selectTargets(manifest).map(({ id }) => id)).toEqual([
      'words',
      'countries',
    ]);
    expect(() => selectTargets(manifest, ['countries'])).toThrow(
      'Required dictionary target is missing: words',
    );
  });

  it('rejects invalid target policies', () => {
    expect(() =>
      parseTargetManifest({
        targets: {
          words: {
            config: 'builder/config.json',
            dataDir: 'builder/data',
            output: 'web/data/words.json',
            asset: 'words.json',
            enrichment: 'unknown',
          },
        },
      }),
    ).toThrow('Invalid enrichment for target words');
    expect(() =>
      parseTargetManifest({
        targets: {
          words: {
            config: 'builder/config.json',
            dataDir: 'builder/data',
            output: 'web/data/words.json',
            asset: 'words.json',
            pack: 'yes',
          },
        },
      }),
    ).toThrow('Invalid pack setting for target words');
  });

  it('marks pack targets in the real manifest and excludes the AI dictionary', async () => {
    const actual = await readTargetManifest('builder/targets.json');
    const packs = Object.values(actual.targets).filter(({ pack }) => pack);
    expect(actual.targets.words.pack).toBe(false);
    expect(packs.length).toBeGreaterThan(0);
    expect(packs.every(({ enabled }) => enabled)).toBe(true);
  });
});
