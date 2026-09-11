import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDictionary } from '../../shared/schema.ts';
import { readTargetManifest, selectTargets } from '../src/targets.ts';

const checksumPattern = /^[a-f0-9]{64}$/;
const releaseDigestPattern = /^sha256:([a-f0-9]{64})$/;
const trailingSlashPattern = /\/$/;
const digest = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex');
const validate = (data: Uint8Array) =>
  parseDictionary(JSON.parse(Buffer.from(data).toString('utf8')));

interface ReleaseAsset {
  name: string;
  browserDownloadUrl: string;
  digest?: string;
}

const repositoryPattern = /^[^/\s]+\/[^/\s]+$/;

function repositoryFromEnvironment(environment: NodeJS.ProcessEnv): string {
  const repository =
    environment.DICTIONARY_REPOSITORY ?? environment.GITHUB_REPOSITORY;
  if (!repository || !repositoryPattern.test(repository))
    throw new Error(
      'DICTIONARY_REPOSITORY or GITHUB_REPOSITORY must contain owner/repository',
    );
  return repository;
}

async function latestReleaseAssets(
  repository: string,
  environment: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
): Promise<ReleaseAsset[]> {
  const apiBase = (
    environment.GITHUB_API_URL ?? 'https://api.github.com'
  ).replace(trailingSlashPattern, '');
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VankDictionaryDownloader/1.0',
  };
  const token = environment.GITHUB_TOKEN ?? environment.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetcher(
    `${apiBase}/repos/${repository}/releases/latest`,
    { headers, signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok)
    throw new Error(
      `Latest dictionary release lookup failed: ${response.status} ${response.statusText}`,
    );
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Latest dictionary release is invalid');
  const assets = (value as { assets?: unknown }).assets;
  if (!Array.isArray(assets))
    throw new Error('Latest dictionary release has no assets');
  return assets.map((asset): ReleaseAsset => {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset))
      throw new Error('Latest dictionary release contains an invalid asset');
    const record = asset as Record<string, unknown>;
    const name = record.name;
    const browserDownloadUrl = record.browser_download_url;
    const releaseDigest = record.digest;
    if (typeof name !== 'string' || typeof browserDownloadUrl !== 'string')
      throw new Error('Latest dictionary release contains an incomplete asset');
    const match =
      typeof releaseDigest === 'string'
        ? releaseDigestPattern.exec(releaseDigest)
        : undefined;
    return {
      name,
      browserDownloadUrl,
      ...(match ? { digest: match[1] } : {}),
    };
  });
}

export async function ensureDictionary(
  output: string,
  url?: string,
  checksum?: string,
  fetcher: typeof fetch = fetch,
): Promise<'existing' | 'cached' | 'downloaded'> {
  const current = existsSync(output) ? await readFile(output) : undefined;
  if (!url) {
    if (!current)
      throw new Error(
        `A dictionary source is required because ${output} is missing`,
      );
    validate(current);
    return 'existing';
  }
  const expected = checksum?.toLowerCase();
  if (!expected || !checksumPattern.test(expected))
    throw new Error('Dictionary release has an invalid SHA-256 digest');
  if (new URL(url).protocol !== 'https:')
    throw new Error('Dictionary release asset URL must use HTTPS');
  if (current && digest(current) === expected) {
    validate(current);
    return 'cached';
  }
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Dictionary download failed: ${response.status} ${response.statusText}`,
    );
  const data = new Uint8Array(await response.arrayBuffer());
  validate(data);
  const actual = digest(data);
  if (actual !== expected)
    throw new Error(
      `Dictionary checksum mismatch: expected ${expected}, received ${actual}`,
    );
  await mkdir(dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, output);
  return 'downloaded';
}

export async function downloadDictionaries(
  manifestPath = 'builder/targets.json',
  environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
) {
  const manifest = await readTargetManifest(manifestPath);
  const targets = selectTargets(manifest);
  if (targets.every(({ output }) => existsSync(output))) {
    for (const target of targets) {
      const result = await ensureDictionary(
        target.output,
        undefined,
        undefined,
        fetcher,
      );
      console.log(
        `${result === 'downloaded' ? 'Downloaded' : result === 'cached' ? 'Using cached' : 'Using existing'} ${target.output}`,
      );
    }
    return;
  }
  const assets = await latestReleaseAssets(
    repositoryFromEnvironment(environment),
    environment,
    fetcher,
  );
  for (const target of targets) {
    const asset = assets.find(({ name }) => name === target.asset);
    if (!asset)
      throw new Error(
        `Latest dictionary release is missing asset ${target.asset}`,
      );
    if (!asset.digest)
      throw new Error(
        `Latest dictionary release has no checksum for ${target.asset}`,
      );
    const result = await ensureDictionary(
      target.output,
      asset.browserDownloadUrl,
      asset.digest,
      fetcher,
    );
    console.log(
      `${result === 'downloaded' ? 'Downloaded' : result === 'cached' ? 'Using cached' : 'Using existing'} ${target.output}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  await downloadDictionaries();
}
