import { object, validateMetadata } from '../../../shared/schema.ts';
import type { RawWord } from '../types.ts';
export function curatedSource(value: unknown, priority = 100): RawWord[] {
  if (!Array.isArray(value)) throw new Error('Curated source must be an array');
  return value.map((item) => {
    const entry = object(item);
    if (typeof entry.word !== 'string')
      throw new Error('Curated word must be a string');
    validateMetadata(entry);
    const { word, ...metadata } = entry;
    return {
      word,
      sourceId: 'curated',
      sourcePriority: priority,
      metadata,
      source: { type: 'curated', name: 'Vank project vocabulary' },
    };
  });
}
