import { describe, expect, it } from 'vitest';
import {
  parseTargetManifest,
  readTargetManifest,
  selectTargets,
  targetEnvironment,
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
    local: {
      config: 'builder/config.json',
      dataDir: 'builder/data',
      output: 'web/data/local.json',
      asset: 'local.json',
      enrichment: 'ollama',
      checks: [],
    },
  },
});

describe('dictionary targets', () => {
  it('selects enabled targets and requires the primary dictionary', () => {
    expect(selectTargets(manifest).map(({ id }) => id)).toEqual([
      'words',
      'countries',
      'local',
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

  it('lets an explicit provider override the target default', () => {
    expect(
      targetEnvironment(manifest.targets.words, { AI_PROVIDER: 'ollama' })
        .AI_PROVIDER,
    ).toBe('ollama');
    expect(targetEnvironment(manifest.targets.words, {}).AI_PROVIDER).toBe(
      'openrouter',
    );
  });

  it('marks pack targets in the real manifest and excludes the AI dictionary', async () => {
    const actual = await readTargetManifest('builder/targets.json');
    const packs = Object.values(actual.targets).filter(({ pack }) => pack);
    expect(actual.targets.words.pack).toBe(false);
    expect(packs.length).toBeGreaterThan(0);
    expect(packs.every(({ enabled }) => enabled)).toBe(true);
  });
});
