import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { downloadSource } from '../builder/src/io';
import { mergeSources } from '../builder/src/pipeline';
import { createReporter, formatProgress } from '../builder/src/progress';
import { curatedSource } from '../builder/src/sources/curated';

const exec = promisify(execFile);
it('reports rejected records separately from execution failures', () => {
  const reports: import('../builder/src/types').StageProgress[] = [];
  mergeSources(curatedSource([{ word: 'hello' }, { word: 'ԲԱՆԿ' }]), (p) =>
    reports.push(p),
  );
  expect(reports.at(-1)).toMatchObject({ rejected: 1 });
  expect(reports.at(-1)?.failures ?? 0).toBe(0);
  const line = formatProgress(
    { stage: 'build', processed: 242, total: 242, rejected: 526 },
    1000,
  );
  expect(line).toContain('rejected 526');
  expect(line).toContain('failed 0');
});
it('estimates remaining time from new work rather than instantaneous cache hits', () => {
  const line = formatProgress(
    { stage: 'enrich', processed: 369, total: 1500, cached: 269, api: 100 },
    25000,
  );
  expect(line).toContain('ETA 04:42');
  expect(
    formatProgress(
      { stage: 'enrich', processed: 269, total: 1500, cached: 269 },
      1000,
    ),
  ).toContain('ETA —');
});
it('reports counts, percentage, batches, cache/API work, failures, retries, elapsed and ETA', () => {
  const message = formatProgress(
    {
      stage: 'enrich',
      processed: 50,
      total: 100,
      batch: 1,
      batches: 2,
      cached: 20,
      api: 30,
      failures: 1,
      retries: 1,
    },
    10000,
  );
  for (const text of [
    '50/100',
    '50.0%',
    'batch 1/2',
    'cached 20',
    'API 30',
    'failed 1',
    'retries 1',
    'elapsed 00:10',
    'ETA 00:16',
  ])
    expect(message).toContain(text);
});
it('downloads once, reuses a completed source and does not promote failed downloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vank-fetch-'));
  try {
    const path = join(dir, 'source.jsonl');
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return new Response('fixture\n');
    };
    await downloadSource('https://example.org/source', path, () => {}, fetcher);
    await downloadSource('https://example.org/source', path, () => {}, fetcher);
    expect(calls).toBe(1);
    expect(await readFile(path, 'utf8')).toBe('fixture\n');
    await expect(
      downloadSource(
        'https://example.org/source',
        join(dir, 'failed'),
        () => {},
        async () => new Response('', { status: 503 }),
      ),
    ).rejects.toThrow('503');
    await expect(readFile(join(dir, 'failed'))).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('builds a fixture without network, retains intermediate stages, supports quiet/verbose and rejects invalid output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vank-cli-'));
  try {
    const config = join(dir, 'config.json'),
      output = join(dir, 'web', 'words.json');
    await writeFile(
      config,
      JSON.stringify({
        learnerLanguages: ['ru'],
        maxWords: 1000,
        sources: [
          {
            type: 'curated',
            path: resolve('builder/data/curated.json'),
            priority: 100,
          },
          {
            type: 'wiktionary',
            path: resolve('tests/fixtures/wiktionary.jsonl'),
            priority: 10,
            edition: 'en',
          },
        ],
      }),
    );
    const args = [
      'builder/src/cli.ts',
      'build',
      '--config',
      config,
      '--data-dir',
      dir,
      '--output',
      output,
      '--no-ai',
    ];
    const { stdout } = await exec(process.execPath, [...args, '--quiet']);
    expect(stdout).toBe('');
    const outputText = await readFile(output, 'utf8');
    const dictionary = JSON.parse(outputText);
    expect(outputText).toBe(JSON.stringify(dictionary));
    expect(dictionary.words[0]).not.toHaveProperty('source');
    expect(dictionary.words[0]).not.toHaveProperty('sources');
    expect(dictionary.words[0]).not.toHaveProperty('metadataSource');
    expect(dictionary.words[0]).not.toHaveProperty('rawDefinitions');
    expect(dictionary.words[0]).not.toHaveProperty('rawPos');
    expect(dictionary.words[0]).not.toHaveProperty('transliterationVersion');
    expect(dictionary.words[0]).not.toHaveProperty('letters');
    expect(dictionary.words[0]).not.toHaveProperty('uniqueLetters');
    expect(dictionary.words[0]).not.toHaveProperty('length');
    expect(dictionary.words.length).toBeGreaterThanOrEqual(77);
    for (const stage of [
      'raw',
      'normalized',
      'deterministic',
      'enriched',
      'words',
      'rejected',
    ])
      expect(await readFile(join(dir, `${stage}.json`), 'utf8')).toBeTruthy();
    expect(
      JSON.parse(await readFile(join(dir, 'words.json'), 'utf8')).words[0],
    ).toHaveProperty('metadataSource');
    expect(
      await readFile(join(dir, 'web', 'ATTRIBUTION.txt'), 'utf8'),
    ).toContain('CC-BY-SA-4.0');
    const tooSmallConfig = join(dir, 'too-small-config.json');
    await writeFile(
      tooSmallConfig,
      JSON.stringify({ learnerLanguages: ['ru'], maxWords: 1, sources: [] }),
    );
    await expect(
      exec(process.execPath, [
        'builder/src/cli.ts',
        'validate',
        '--config',
        tooSmallConfig,
        '--data-dir',
        dir,
        '--output',
        output,
        '--quiet',
      ]),
    ).rejects.toThrow('Achievement prerequisites unavailable');
    const missingConfig = join(dir, 'missing-config.json');
    await writeFile(
      missingConfig,
      JSON.stringify({
        learnerLanguages: ['ru'],
        sources: [
          { type: 'curated', path: join(dir, 'absent.json'), priority: 100 },
        ],
      }),
    );
    await exec(process.execPath, [
      'builder/src/cli.ts',
      'normalize',
      '--config',
      missingConfig,
      '--data-dir',
      dir,
      '--quiet',
    ]);
    const verbose = await exec(process.execPath, [...args, '--verbose']);
    expect(verbose.stdout).toContain('complete');
    expect(verbose.stdout).toContain('achievement prerequisites verified');
    const flagged = JSON.parse(
      await readFile(join(dir, 'enriched.json'), 'utf8'),
    );
    flagged[0].flags = ['fixture-review'];
    await writeFile(join(dir, 'enriched.json'), JSON.stringify(flagged));
    const validateArgs = [
      'builder/src/cli.ts',
      'validate',
      '--config',
      config,
      '--data-dir',
      dir,
      '--output',
      output,
      '--quiet',
    ];
    await exec(process.execPath, validateArgs);
    const once = await readFile(join(dir, 'rejected.json'), 'utf8');
    await exec(process.execPath, validateArgs);
    expect(await readFile(join(dir, 'rejected.json'), 'utf8')).toBe(once);
    const final = JSON.parse(
      await readFile(join(dir, 'enriched.json'), 'utf8'),
    );
    final[0].acceptedLatin = ['Հայ'];
    await writeFile(join(dir, 'enriched.json'), JSON.stringify(final));
    await expect(
      exec(process.execPath, [
        'builder/src/cli.ts',
        'validate',
        '--config',
        config,
        '--data-dir',
        dir,
        '--output',
        output,
        '--quiet',
      ]),
    ).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('does not compare decoded download bytes against compressed Content-Length', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vank-compressed-'));
  try {
    const reports: { total?: number; detail?: string }[] = [];
    await downloadSource(
      'https://example.org/gzip',
      join(dir, 'source'),
      (p) => reports.push(p),
      async () =>
        new Response('long decoded response', {
          headers: { 'Content-Encoding': 'gzip', 'Content-Length': '3' },
        }),
    );
    expect(
      reports
        .filter((p) => p.detail !== 'complete')
        .every((p) => p.total === undefined),
    ).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('applies audience selection before enrichment and preserves the runtime file when the quality gate fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vank-audience-cli-'));
  try {
    const config = join(dir, 'config.json'),
      output = join(dir, 'words-runtime.json');
    await writeFile(
      config,
      JSON.stringify({
        learnerLanguages: ['ru'],
        maxWords: 1000,
        audience: {
          language: 'ru',
          candidates: resolve('builder/data/recognizable-ru.json'),
          minFamiliarWords: 150,
          minFamiliarShare: 0.7,
          minLetterCoverage: 2,
        },
        sources: [
          {
            type: 'curated',
            path: resolve('builder/data/curated.json'),
            priority: 100,
          },
        ],
      }),
    );
    await writeFile(output, 'previous dictionary');
    const args = [
      'builder/src/cli.ts',
      'build',
      '--config',
      config,
      '--data-dir',
      dir,
      '--output',
      output,
      '--no-ai',
      '--quiet',
    ];
    await expect(exec(process.execPath, args)).rejects.toThrow('familiar');
    expect(await readFile(output, 'utf8')).toBe('previous dictionary');
    const rejected = JSON.parse(
      await readFile(join(dir, 'rejected.json'), 'utf8'),
    );
    expect(
      rejected.some((r: { reason: unknown }) =>
        String(r.reason).includes('Audience quality'),
      ),
    ).toBe(false);
    const candidates = JSON.parse(
      await readFile(join(dir, 'candidates.json'), 'utf8'),
    );
    expect(
      candidates.words.some((w: { word: string }) => w.word === 'ԿՈՄԲՈ'),
    ).toBe(true);
    expect(candidates.missing).toContain('ՌՈԲՈՏ');
    // An explicit seed build remains available without pretending to pass the audience gate.
    await exec(process.execPath, [...args, '--curated-only']);
    expect(JSON.parse(await readFile(output, 'utf8')).words.length).toBe(79);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('shows a newly active AI batch immediately, even inside the normal log throttle window', () => {
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    const report = createReporter(false, false);
    report({ stage: 'enrich', processed: 0, total: 100, batch: 0, batches: 2 });
    report({ stage: 'enrich', processed: 0, total: 100, batch: 1, batches: 2 });
    expect(output.mock.calls.map((call) => String(call[0])).join('')).toContain(
      'batch 1/2',
    );
  } finally {
    now.mockRestore();
    output.mockRestore();
  }
});
