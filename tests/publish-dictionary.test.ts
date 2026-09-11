import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import config from '../builder/config.json' with { type: 'json' };
import {
  dictionaryReleaseNotes,
  PRODUCTION_QUALITY,
  publishDictionaries,
  publishDictionary,
  validatePublishableDictionary,
} from '../builder/scripts/publish-dictionary.ts';
import { runtimeDictionary } from '../builder/src/runtime.ts';
import { deriveWord } from '../shared/armenian.ts';
import { parseDictionary } from '../shared/schema.ts';

const directories: string[] = [];
const testQuality = {
  language: 'ru',
  maxWords: 1,
  minFamiliarWords: 0,
  minFamiliarShare: 0,
  minLetterCoverage: 0,
};
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

it('uses the builder config as the production quality gate', () => {
  expect(PRODUCTION_QUALITY).toEqual({
    language: config.audience.language,
    maxWords: config.maxWords,
    minFamiliarWords: config.audience.minFamiliarWords,
    minFamiliarShare: config.audience.minFamiliarShare,
    minLetterCoverage: config.audience.minLetterCoverage,
  });
});

it('publishes the minified runtime dictionary and starts deployment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vank-publish-'));
  directories.push(directory);
  const path = join(directory, 'words.json');
  const dictionary = runtimeDictionary(
    parseDictionary({
      version: 1,
      schemaVersion: 1,
      generatedAt: '2026-09-10T00:00:00Z',
      words: [deriveWord('ՄԱՄԱ')],
    }),
  );
  const data = JSON.stringify(dictionary);
  const digest = createHash('sha256').update(data).digest('hex');
  await writeFile(path, data);
  const commands: string[][] = [];
  let inspections = 0;
  const tag = await publishDictionary(
    path,
    (args) => {
      commands.push(args);
      if (args[0] !== 'api') return { status: 0, stdout: '' };
      inspections++;
      return inspections === 1
        ? { status: 1, stdout: '' }
        : { status: 0, stdout: `false\tsha256:${digest}\n` };
    },
    testQuality,
  );

  expect(tag).toHaveLength(23);
  expect(tag.startsWith('dictionary-')).toBe(true);
  expect(commands.map((args) => args.slice(0, 2))).toEqual([
    ['api', expect.any(String)],
    ['release', 'create'],
    ['api', expect.any(String)],
    ['workflow', 'run'],
  ]);
  const notes = dictionaryReleaseNotes(parseDictionary(dictionary));
  const [countLine, , detailsLine, summaryLine] = notes.split('\n');
  expect(countLine).toBe('1 runtime words');
  expect(detailsLine).toBe('<details>');
  expect(summaryLine).toContain('Alphabet coverage');
  expect(summaryLine).toContain('words containing each letter');
  expect(notes).toContain('| Ա | 1 |');
  expect(notes).toContain('\n\n</details>');
  expect(commands.find((args) => args[1] === 'create')).toContain(notes);
});

it('repairs an incomplete draft before deployment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vank-publish-'));
  directories.push(directory);
  const path = join(directory, 'words.json');
  const data = JSON.stringify(
    runtimeDictionary(
      parseDictionary({
        version: 1,
        schemaVersion: 1,
        generatedAt: '2026-09-10T00:00:00Z',
        words: [deriveWord('ՄԱՄԱ')],
      }),
    ),
  );
  const digest = createHash('sha256').update(data).digest('hex');
  await writeFile(path, data);
  const commands: string[][] = [];
  let inspections = 0;
  await publishDictionary(
    path,
    (args) => {
      commands.push(args);
      if (args[0] !== 'api') return { status: 0, stdout: '' };
      inspections++;
      return {
        status: 0,
        stdout: inspections === 1 ? 'true\t\n' : `false\tsha256:${digest}\n`,
      };
    },
    testQuality,
  );

  expect(commands.map((args) => args.slice(0, 2))).toEqual([
    ['api', expect.any(String)],
    ['release', 'upload'],
    ['release', 'edit'],
    ['api', expect.any(String)],
    ['workflow', 'run'],
  ]);
});

it('publishes multiple dictionary assets in one release', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vank-publish-'));
  directories.push(directory);
  const dictionary = runtimeDictionary(
    parseDictionary({
      version: 1,
      schemaVersion: 1,
      generatedAt: '2026-09-10T00:00:00Z',
      words: [deriveWord('ՄԱՄԱ')],
    }),
  );
  const data = JSON.stringify(dictionary);
  const digest = createHash('sha256').update(data).digest('hex');
  const wordsPath = join(directory, 'words.json');
  const toponymsPath = join(directory, 'toponyms.json');
  await Promise.all([
    writeFile(wordsPath, data),
    writeFile(toponymsPath, data),
  ]);
  const commands: string[][] = [];
  let inspections = 0;
  await publishDictionaries(
    [
      { path: wordsPath, name: 'words.json', quality: testQuality },
      { path: toponymsPath, name: 'toponyms.json', quality: testQuality },
    ],
    (args) => {
      commands.push(args);
      if (args[0] !== 'api') return { status: 0, stdout: '' };
      inspections++;
      return inspections === 1
        ? { status: 1, stdout: '' }
        : { status: 0, stdout: `false\tsha256:${digest}\tsha256:${digest}\n` };
    },
  );

  expect(commands.map((args) => args.slice(0, 2))).toEqual([
    ['api', expect.any(String)],
    ['release', 'create'],
    ['api', expect.any(String)],
    ['workflow', 'run'],
  ]);
  expect(commands.find((args) => args[1] === 'create')).toEqual(
    expect.arrayContaining([wordsPath, toponymsPath]),
  );
});

it('does not deploy a release with a mismatched asset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vank-publish-'));
  directories.push(directory);
  const path = join(directory, 'words.json');
  const data = JSON.stringify(
    runtimeDictionary(
      parseDictionary({
        version: 1,
        schemaVersion: 1,
        generatedAt: '2026-09-10T00:00:00Z',
        words: [deriveWord('ՄԱՄԱ')],
      }),
    ),
  );
  await writeFile(path, data);
  const commands: string[][] = [];

  await expect(
    publishDictionary(
      path,
      (args) => {
        commands.push(args);
        return {
          status: 0,
          stdout: args[0] === 'api' ? `false\tsha256:${'0'.repeat(64)}\n` : '',
        };
      },
      testQuality,
    ),
  ).rejects.toThrow('different digest');
  expect(commands.some((args) => args[0] === 'workflow')).toBe(false);
});

it('enforces only the maximum size when audience quality passes', () => {
  const dictionary = parseDictionary({
    version: 1,
    schemaVersion: 1,
    generatedAt: '2026-09-10T00:00:00Z',
    words: [deriveWord('ՄԱՄԱ')],
  });
  expect(() =>
    validatePublishableDictionary(dictionary, {
      ...testQuality,
      maxWords: 3000,
    }),
  ).not.toThrow();
  expect(() =>
    validatePublishableDictionary(dictionary, {
      ...testQuality,
      maxWords: 0,
    }),
  ).toThrow('maximum');
});
