import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  downloadDictionaries,
  ensureDictionary,
} from '../builder/scripts/download-dictionary.ts';
import { deriveWord } from '../shared/armenian.ts';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

it('downloads, validates, verifies, and caches the runtime dictionary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vank-dictionary-'));
  directories.push(directory);
  const output = join(directory, 'data', 'words.json');
  const data = JSON.stringify({
    version: 1,
    schemaVersion: 1,
    generatedAt: '2026-09-09',
    words: [deriveWord('ՄԱՄԱ')],
  });
  const checksum = createHash('sha256').update(data).digest('hex');
  const fetch = vi.fn(async () => new Response(data));
  vi.stubGlobal('fetch', fetch);

  expect(
    await ensureDictionary(output, 'https://example.test/words.json', checksum),
  ).toBe('downloaded');
  expect(await readFile(output, 'utf8')).toBe(data);
  expect(
    await ensureDictionary(output, 'https://example.test/words.json', checksum),
  ).toBe('cached');
  expect(fetch).toHaveBeenCalledOnce();
});

it('resolves the latest release and downloads its target asset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vank-dictionaries-'));
  directories.push(directory);
  const output = join(directory, 'words.json');
  const manifest = join(directory, 'targets.json');
  const data = JSON.stringify({
    version: 1,
    schemaVersion: 1,
    generatedAt: '2026-09-09',
    words: [deriveWord('ՄԱՄԱ')],
  });
  const checksum = createHash('sha256').update(data).digest('hex');
  await writeFile(
    manifest,
    JSON.stringify({
      targets: {
        words: {
          required: true,
          config: 'builder/config.json',
          dataDir: directory,
          output,
          asset: 'words.json',
          enrichment: 'openrouter',
          checks: [],
        },
      },
    }),
  );
  const fetcher: typeof globalThis.fetch = vi.fn(async (input) => {
    if (
      String(input) ===
      'https://api.github.com/repos/example/vank/releases/latest'
    )
      return new Response(
        JSON.stringify({
          assets: [
            {
              name: 'words.json',
              browser_download_url: 'https://example.test/words.json',
              digest: `sha256:${checksum}`,
            },
          ],
        }),
      );
    return new Response(data);
  });

  await downloadDictionaries(
    manifest,
    { GITHUB_REPOSITORY: 'example/vank' },
    fetcher,
  );

  expect(await readFile(output, 'utf8')).toBe(data);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
