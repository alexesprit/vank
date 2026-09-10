import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ALPHABET } from '../../shared/armenian.ts';
import { parseDictionary } from '../../shared/schema.ts';
import type { Dictionary } from '../../shared/types.ts';
import { runtimeDictionary } from '../src/runtime.ts';

interface RunResult {
  status: number;
  stdout: string;
}
type Run = (args: string[], quiet?: boolean) => RunResult;
export interface PublishQuality {
  language: string;
  maxWords: number;
  minFamiliarWords: number;
  minFamiliarShare: number;
  minLetterCoverage: number;
}
// Mirrors the production audience policy in builder/config.json.
export const PRODUCTION_QUALITY: PublishQuality = {
  language: 'ru',
  maxWords: 3000,
  minFamiliarWords: 700,
  minFamiliarShare: 0.7,
  minLetterCoverage: 2,
};

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
  for (const { upper } of ALPHABET) {
    const coverage = words.filter((word) =>
      word.uniqueLetters.includes(upper),
    ).length;
    if (coverage < quality.minLetterCoverage)
      throw new Error(
        `Dictionary quality: letter ${upper} appears in ${coverage} words; need at least ${quality.minLetterCoverage}`,
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

export async function publishDictionary(
  path = 'web/data/words.json',
  run: Run = runGh,
  quality: PublishQuality = PRODUCTION_QUALITY,
) {
  const data = await readFile(path, 'utf8');
  const dictionary = parseDictionary(JSON.parse(data));
  validatePublishableDictionary(dictionary, quality);
  if (data !== JSON.stringify(runtimeDictionary(dictionary)))
    throw new Error('Dictionary must be a stripped, minified runtime build');

  const digest = createHash('sha256').update(data).digest('hex');
  const tag = `dictionary-${digest.slice(0, 12)}`;
  const title = `Dictionary ${dictionary.generatedAt.slice(0, 10)}`;
  const inspect = () => {
    const result = run(
      [
        'api',
        'repos/{owner}/{repo}/releases?per_page=100',
        '--paginate',
        '--jq',
        `.[] | select(.tag_name == "${tag}") | [.draft, ([.assets[] | select(.name == "words.json") | .digest][0] // "")] | @tsv`,
      ],
      true,
    );
    if (result.status || !result.stdout.trim()) return undefined;
    const [draft, assetDigest] = result.stdout.trim().split('\t');
    if (!['true', 'false'].includes(draft))
      throw new Error('Could not inspect the existing dictionary release');
    return { draft: draft === 'true', digest: assetDigest ?? '' };
  };

  const existing = inspect();
  if (existing) {
    if (existing.draft) {
      if (run(['release', 'upload', tag, path, '--clobber']).status)
        throw new Error('Could not repair the draft dictionary release');
      if (run(['release', 'edit', tag, '--draft=false', '--latest']).status)
        throw new Error('Could not publish the dictionary release');
    } else {
      if (existing.digest && existing.digest !== `sha256:${digest}`)
        throw new Error('Existing dictionary release has a different digest');
      if (!existing.digest && run(['release', 'upload', tag, path]).status)
        throw new Error('Could not repair the dictionary release asset');
      if (run(['release', 'edit', tag, '--latest']).status)
        throw new Error('Could not mark the dictionary release as latest');
    }
  } else if (
    run([
      'release',
      'create',
      tag,
      path,
      '--title',
      title,
      '--notes',
      `${dictionary.words.length} runtime words`,
      '--latest',
    ]).status
  )
    throw new Error('Could not create the dictionary release');

  const verified = inspect();
  if (!verified || verified.draft || verified.digest !== `sha256:${digest}`)
    throw new Error('Dictionary release verification failed');

  if (run(['workflow', 'run', 'deploy.yml']).status)
    throw new Error('Could not start the Vercel deployment');
  return tag;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(await publishDictionary());
}
