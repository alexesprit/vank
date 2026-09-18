import { parseDictionary } from '../../../shared/schema.ts';
import { PRACTICE_MODES, type PracticeModeId } from '../core/modes.ts';

export function dictionaryUrl(mode: PracticeModeId): string {
  const descriptor = PRACTICE_MODES.find((item) => item.id === mode);
  if (!descriptor) throw new Error(`Dictionary mode is not available: ${mode}`);
  return descriptor.url;
}

export async function loadDictionary(
  mode: PracticeModeId = 'words',
  fetcher = fetch,
  signal?: AbortSignal,
) {
  return loadDictionaryForMode(mode, fetcher, signal);
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
