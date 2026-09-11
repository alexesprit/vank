import { describe, expect, it } from 'vitest';
import { parseTargetManifest, selectTargets } from '../builder/src/targets.ts';

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
  });
});
