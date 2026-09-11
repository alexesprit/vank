import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDictionary } from '../../shared/schema.ts';
import type { Dictionary } from '../../shared/types.ts';
import config from '../config.json' with { type: 'json' };
import { countLetterCoverage, parseAudience } from '../src/audience.ts';
import { runtimeDictionary } from '../src/runtime.ts';

interface RunResult {
  status: number;
  stdout: string;
}
type Run = (args: string[], quiet?: boolean) => RunResult;
export interface PublishAsset {
  path: string;
  name: string;
  quality?: PublishQuality;
}
export interface PublishQuality {
  language: string;
  maxWords: number;
  minFamiliarWords: number;
  minFamiliarShare: number;
  minLetterCoverage: number;
}
if (!Number.isInteger(config.maxWords) || config.maxWords < 1)
  throw new Error('Invalid dictionary size');
const audience = parseAudience(
  config.audience,
  config.learnerLanguages,
  config.maxWords,
);
export const PRODUCTION_QUALITY: PublishQuality = {
  language: audience.language,
  maxWords: config.maxWords,
  minFamiliarWords: audience.minFamiliarWords,
  minFamiliarShare: audience.minFamiliarShare,
  minLetterCoverage: audience.minLetterCoverage,
};

export const dictionaryReleaseNotes = (dictionary: Dictionary) =>
  `${dictionary.words.length} runtime words\n\nAlphabet coverage (words containing each letter):\n\n| Letter | Words |\n| --- | ---: |\n${countLetterCoverage(
    dictionary.words,
  )
    .map(({ letter, words }) => `| ${letter} | ${words} |`)
    .join('\n')}`;

export function validatePublishableDictionary(
  dictionary: Dictionary,
  quality: PublishQuality = PRODUCTION_QUALITY,
): void {
  const { words } = dictionary;
  if (words.length > quality.maxWords)
    throw new Error(
      `Dictionary quality: ${words.length} words; maximum is ${quality.maxWords}`,
    );
  const familiar = words.filter(
    (word) => (word.familiarity?.[quality.language] ?? 0) >= 0.8,
  ).length;
  if (familiar < quality.minFamiliarWords)
    throw new Error(
      `Dictionary quality: ${familiar} familiar ${quality.language} words; need at least ${quality.minFamiliarWords}`,
    );
  if (familiar / words.length < quality.minFamiliarShare)
    throw new Error(
      `Dictionary quality: familiar share ${familiar / words.length}; need at least ${quality.minFamiliarShare}`,
    );
  for (const { letter, words: coverage } of countLetterCoverage(words)) {
    if (coverage < quality.minLetterCoverage)
      throw new Error(
        `Dictionary quality: letter ${letter} appears in ${coverage} words; need at least ${quality.minLetterCoverage}`,
      );
  }
}

const runGh: Run = (args, quiet = false) => {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'ignore'] : 'inherit',
  });
  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
  };
};

export async function publishDictionaries(
  assets: PublishAsset[],
  run: Run = runGh,
) {
  if (!assets.length)
    throw new Error('At least one dictionary asset is required');
  const prepared = await Promise.all(
    assets.map(async (asset) => {
      const data = await readFile(asset.path, 'utf8');
      const dictionary = parseDictionary(JSON.parse(data));
      validatePublishableDictionary(
        dictionary,
        asset.quality ?? PRODUCTION_QUALITY,
      );
      if (data !== JSON.stringify(runtimeDictionary(dictionary)))
        throw new Error(
          'Dictionary must be a stripped, minified runtime build',
        );
      return {
        ...asset,
        data,
        dictionary,
        digest: createHash('sha256').update(data).digest('hex'),
      };
    }),
  );
  const ordered = [...prepared].sort((a, b) => a.name.localeCompare(b.name));
  const releaseDigest = createHash('sha256')
    .update(ordered.map(({ name, digest }) => `${name}\0${digest}`).join('\0'))
    .digest('hex');
  const tag = `dictionary-${releaseDigest.slice(0, 12)}`;
  const title = `Dictionaries ${ordered[0].dictionary.generatedAt.slice(0, 10)}`;
  const notes =
    ordered.length === 1
      ? dictionaryReleaseNotes(ordered[0].dictionary)
      : ordered
          .map(
            ({ name, dictionary }) =>
              `# ${name}\n\n${dictionaryReleaseNotes(dictionary)}`,
          )
          .join('\n\n');
  const assetNames = ordered.map(({ name }) => name);
  const jqAssets = assetNames
    .map(
      (name) =>
        `([.assets[] | select(.name == ${JSON.stringify(name)}) | .digest][0] // "")`,
    )
    .join(', ');
  const inspect = () => {
    const result = run(
      [
        'api',
        'repos/{owner}/{repo}/releases?per_page=100',
        '--paginate',
        '--jq',
        `.[] | select(.tag_name == "${tag}") | [.draft, ${jqAssets}] | @tsv`,
      ],
      true,
    );
    if (result.status || !result.stdout.trim()) return undefined;
    const fields = result.stdout.trim().split('\t');
    if (!['true', 'false'].includes(fields[0]))
      throw new Error('Could not inspect the existing dictionary release');
    return {
      draft: fields[0] === 'true',
      digests: fields.slice(1),
    };
  };
  const files = ordered.map(({ path, name }) =>
    basename(path) === name ? path : `${path}#${name}`,
  );
  const existing = inspect();
  if (existing) {
    if (existing.draft) {
      if (run(['release', 'upload', tag, ...files, '--clobber']).status)
        throw new Error('Could not repair the draft dictionary release');
      if (
        run([
          'release',
          'edit',
          tag,
          '--draft=false',
          '--latest',
          '--notes',
          notes,
        ]).status
      )
        throw new Error('Could not publish the dictionary release');
    } else {
      const missing: string[] = [];
      ordered.forEach(({ digest }, index) => {
        const existingDigest = existing.digests[index] ?? '';
        if (existingDigest && existingDigest !== `sha256:${digest}`)
          throw new Error('Existing dictionary release has a different digest');
        if (!existingDigest) missing.push(files[index]);
      });
      if (missing.length && run(['release', 'upload', tag, ...missing]).status)
        throw new Error('Could not repair the dictionary release assets');
      if (run(['release', 'edit', tag, '--latest', '--notes', notes]).status)
        throw new Error('Could not mark the dictionary release as latest');
    }
  } else if (
    run([
      'release',
      'create',
      tag,
      ...files,
      '--title',
      title,
      '--notes',
      notes,
      '--latest',
    ]).status
  )
    throw new Error('Could not create the dictionary release');

  const verified = inspect();
  if (
    !verified ||
    verified.draft ||
    ordered.some(
      ({ digest }, index) => verified.digests[index] !== `sha256:${digest}`,
    )
  )
    throw new Error('Dictionary release verification failed');

  if (run(['workflow', 'run', 'deploy.yml']).status)
    throw new Error('Could not start the Vercel deployment');
  return tag;
}

export async function publishDictionary(
  path = 'web/data/words.json',
  run: Run = runGh,
  quality: PublishQuality = PRODUCTION_QUALITY,
) {
  return publishDictionaries([{ path, name: basename(path), quality }], run);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(await publishDictionary());
}
