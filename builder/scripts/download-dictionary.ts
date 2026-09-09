import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDictionary } from '../../shared/schema.ts';

const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const validate = (data: Uint8Array) => parseDictionary(JSON.parse(Buffer.from(data).toString('utf8')));

export async function ensureDictionary(output: string, url?: string, checksum?: string): Promise<'existing' | 'cached' | 'downloaded'> {
  const current = existsSync(output) ? await readFile(output) : undefined;
  if (!url) {
    if (!current) throw new Error(`DICTIONARY_URL is required because ${output} is missing`);
    validate(current);
    return 'existing';
  }
  const expected = checksum?.toLowerCase();
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('DICTIONARY_SHA256 must be a 64-character SHA-256 hex digest');
  if (new URL(url).protocol !== 'https:') throw new Error('DICTIONARY_URL must use HTTPS');
  if (current && digest(current) === expected) {
    validate(current);
    return 'cached';
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Dictionary download failed: ${response.status} ${response.statusText}`);
  const data = new Uint8Array(await response.arrayBuffer());
  validate(data);
  const actual = digest(data);
  if (actual !== expected) throw new Error(`Dictionary checksum mismatch: expected ${expected}, received ${actual}`);
  await mkdir(dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, output);
  return 'downloaded';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const output = 'web/data/words.json';
  const result = await ensureDictionary(output, process.env.DICTIONARY_URL, process.env.DICTIONARY_SHA256);
  console.log(`${result === 'downloaded' ? 'Downloaded' : result === 'cached' ? 'Using cached' : 'Using existing'} ${output}`);
}
