import { parseArgs } from 'node:util';
import { object, strings } from '../../shared/schema.ts';
import { parseAudience } from '../src/audience.ts';
import { readJson } from '../src/io.ts';
import { readTargetManifest, selectTargets } from '../src/targets.ts';
import {
  type PublishAsset,
  type PublishQuality,
  publishDictionaries,
} from './publish-dictionary.ts';

const { values } = parseArgs({
  options: {
    manifest: { type: 'string', default: 'builder/targets.json' },
    target: { type: 'string', multiple: true },
  },
});

const qualityForConfig = async (path: string): Promise<PublishQuality> => {
  const config = object(await readJson(path));
  const languages = strings(config.learnerLanguages ?? ['ru']);
  const maxWords = config.maxWords;
  if (
    typeof maxWords !== 'number' ||
    !Number.isInteger(maxWords) ||
    maxWords < 1
  )
    throw new Error(`Invalid dictionary size in ${path}`);
  if (config.audience !== undefined) {
    const audience = parseAudience(config.audience, languages, maxWords);
    return {
      language: audience.language,
      maxWords,
      minFamiliarWords: audience.minFamiliarWords,
      minFamiliarShare: audience.minFamiliarShare,
      minLetterCoverage: audience.minLetterCoverage,
    };
  }
  return {
    language: languages[0],
    maxWords,
    minFamiliarWords: 0,
    minFamiliarShare: 0,
    minLetterCoverage: 0,
  };
};

const manifest = await readTargetManifest(
  values.manifest ?? 'builder/targets.json',
);
const assets: PublishAsset[] = await Promise.all(
  selectTargets(manifest, values.target).map(async (target) => ({
    path: target.output,
    name: target.asset,
    quality: await qualityForConfig(target.config),
  })),
);
console.log(
  `Publishing dictionary assets: ${assets.map(({ name }) => name).join(', ')}`,
);
console.log(await publishDictionaries(assets));
