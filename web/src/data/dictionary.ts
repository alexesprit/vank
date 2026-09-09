import wordsUrl from '../../data/words.json?url';
import { parseDictionary } from '../../../shared/schema.ts';
export async function loadDictionary(fetcher: typeof fetch = fetch) {
  const response = await fetcher(wordsUrl);
  if (!response.ok) throw new Error(`Dictionary could not be loaded (HTTP ${response.status})`);
  return parseDictionary(await response.json());
}
