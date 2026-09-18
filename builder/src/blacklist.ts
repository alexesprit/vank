import { normalizeArmenian } from '../../shared/armenian.ts';
import type { BuildWord } from './types.ts';

const armenianWordPattern = /^[Ա-ՖԵՎ]+$/u;

export function parseWordBlacklist(value: unknown): Set<string> {
  if (!Array.isArray(value)) throw new Error('Word blacklist must be an array');
  const entries = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim())
      throw new Error('Word blacklist entries must be non-empty strings');
    let normalized: string;
    try {
      normalized = normalizeArmenian(entry);
    } catch {
      throw new Error('Word blacklist entries must be Armenian words');
    }
    if (!armenianWordPattern.test(normalized))
      throw new Error('Word blacklist entries must be Armenian words');
    entries.add(normalized);
  }
  return entries;
}

export function applyWordBlacklist(
  words: BuildWord[],
  blacklist: Set<string>,
): { words: BuildWord[]; blocked: BuildWord[] } {
  const kept: BuildWord[] = [];
  const blocked: BuildWord[] = [];
  for (const word of words) {
    (blacklist.has(normalizeArmenian(word.word)) ? blocked : kept).push(word);
  }
  return { words: kept, blocked };
}
