import { createReadStream } from 'node:fs';
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { object, strings, validateMetadata } from '../../shared/schema.ts';
import { wiktionaryRecord } from './sources/wiktionary.ts';
import type { RawWord, Report } from './types.ts';
export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, path);
}
export async function downloadSource(
  url: string,
  path: string,
  report: Report,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  try {
    await access(path);
    report({
      stage: 'fetch',
      processed: 1,
      total: 1,
      cached: 1,
      detail: 'complete',
    });
    return;
  } catch (error) {
    if (
      !(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
    )
      throw error;
  }
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(300_000),
    headers: {
      'User-Agent': 'VankDictionaryBuilder/0.1 (offline vocabulary import)',
    },
  });
  if (!response.ok || !response.body)
    throw new Error(`Source download HTTP ${response.status}`);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`,
    file = await open(temp, 'w');
  let processed = 0;
  const total = response.headers.get('content-encoding')
    ? undefined
    : Number(response.headers.get('content-length')) || undefined;
  try {
    for await (const chunk of response.body) {
      await file.writeFile(chunk);
      processed += chunk.length;
      report({
        stage: 'fetch',
        processed,
        total,
        api: processed,
        detail: 'bytes downloaded',
      });
    }
    await file.close();
    await rename(temp, path);
    report({
      stage: 'fetch',
      processed,
      total: processed,
      api: processed,
      detail: 'complete',
    });
  } catch (error) {
    await file.close();
    await rm(temp, { force: true });
    throw error;
  }
}
export async function readWiktionary(
  path: string,
  options: {
    priority: number;
    datasetUrl?: string;
    edition?: string;
    allowedNames?: ReadonlySet<string>;
  },
  report: Report,
): Promise<{ words: RawWord[]; rejected: { line: number; reason: string }[] }> {
  const words: RawWord[] = [],
    rejected: { line: number; reason: string }[] = [];
  let processed = 0;
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    processed++;
    try {
      const word = wiktionaryRecord(JSON.parse(line), options);
      if (word) words.push(word);
    } catch (error) {
      rejected.push({ line: processed, reason: String(error) });
    }
    if (processed % 100 === 0)
      report({ stage: 'import', processed, rejected: rejected.length });
  }
  report({
    stage: 'import',
    processed,
    total: processed,
    rejected: rejected.length,
    detail: 'complete',
  });
  return { words, rejected };
}
export function parseRawWords(value: unknown): RawWord[] {
  if (!Array.isArray(value)) throw new Error('Raw words must be an array');
  return value.map((value) => {
    const r = object(value),
      source = object(r.source);
    if (
      typeof r.word !== 'string' ||
      typeof r.sourceId !== 'string' ||
      typeof r.sourcePriority !== 'number' ||
      !Number.isFinite(r.sourcePriority) ||
      typeof source.type !== 'string'
    )
      throw new Error('Invalid raw word');
    strings(r.rawPos ?? []);
    strings(r.rawDefinitions ?? []);
    validateMetadata(object(r.metadata ?? {}));
    return r as unknown as RawWord;
  });
}
