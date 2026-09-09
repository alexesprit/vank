import { object, strings } from '../../../shared/schema.ts';
import type { RawWord } from '../types.ts';
import { normalizeArmenian } from '../../../shared/armenian.ts';
// Input is structured Wiktextract JSONL extracted from a Wikimedia dump.
// Pronunciation from the export is deliberately not imported: Eastern readings
// are derived locally; Western-only lexical entries are excluded.
export function wiktionaryRecord(value: unknown, options: { priority?: number; datasetUrl?: string; edition?: string; allowedNames?: ReadonlySet<string> } = {}): RawWord | null {
  const record = object(value);
  if (record.lang_code !== 'hy') return null;
  if (typeof record.word !== 'string' || typeof record.pos !== 'string' || !Array.isArray(record.senses)) throw new Error('Malformed Wiktionary record');
  if ([...record.word].length < 2) return null;
  if (record.pos === 'name' && !options.allowedNames?.has(normalizeArmenian(record.word))) return null;
  if (['character', 'symbol', 'punct', 'prefix', 'suffix', 'infix', 'phrase', 'proverb'].includes(record.pos)) return null;
  const senses = record.senses.map(object).filter(sense => {
    const tags = [...strings(record.tags ?? []), ...strings(sense.tags ?? [])];
    return !sense.form_of && !sense.alt_of && !tags.some(tag => ['archaic', 'obsolete', 'dated', 'Western-Armenian', 'Classical-Armenian', 'form-of', 'alt-of', 'dialectal', 'abbreviation', 'initialism', 'acronym'].includes(tag));
  });
  if (!senses.length) return null;
  const definitions = senses.flatMap(s => strings(s.glosses ?? []));
  if (!definitions.length) return null;
  const edition = options.edition ?? 'en';
  return { word: record.word, sourceId: 'wiktionary', sourcePriority: options.priority ?? 10,
    source: { type: 'wiktionary', name: `${edition} Wiktionary contributors${options.datasetUrl ? `; dump: ${options.datasetUrl}` : ''}`,
      url: `https://${edition}.wiktionary.org/wiki/${encodeURIComponent(record.word)}#Armenian`, license: 'CC-BY-SA-4.0' },
    rawPos: [record.pos], rawDefinitions: definitions,
    metadata: { meaning: { [edition]: definitions[0] } },
  };
}
