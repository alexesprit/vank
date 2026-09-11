import { parseDictionary } from '../../../shared/schema.ts';
import type { Dictionary } from '../../../shared/types.ts';
import { PRACTICE_MODES, type PracticeModeId } from '../core/modes.ts';

export function dictionaryUrl(mode: PracticeModeId): string {
  const descriptor = PRACTICE_MODES.find((item) => item.id === mode);
  if (!descriptor) throw new Error(`Dictionary mode is not available: ${mode}`);
  return descriptor.url;
}

export async function loadDictionary(
  fetcher?: typeof fetch,
): Promise<Dictionary>;
export async function loadDictionary(
  mode: PracticeModeId,
  fetcher?: typeof fetch,
  signal?: AbortSignal,
): Promise<Dictionary>;
export async function loadDictionary(
  modeOrFetcher: PracticeModeId | typeof fetch = 'words',
  fetcher = fetch,
  signal?: AbortSignal,
) {
  const mode = typeof modeOrFetcher === 'function' ? 'words' : modeOrFetcher;
  const request = typeof modeOrFetcher === 'function' ? modeOrFetcher : fetcher;
  return loadDictionaryForMode(mode, request, signal);
}

async function loadDictionaryForMode(
  mode: PracticeModeId,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  const response = await fetcher(
    dictionaryUrl(mode),
    signal ? { signal } : undefined,
  );
  if (!response.ok)
    throw new Error(`Dictionary could not be loaded (HTTP ${response.status})`);
  return parseDictionary(await response.json());
}
