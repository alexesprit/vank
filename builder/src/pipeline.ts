import { deriveWord, normalizeArmenian } from '../../shared/armenian.ts';
import { object, parseDictionary, parseWord, strings, validateMetadata } from '../../shared/schema.ts';
import type { BuildWord, MergedWord, RawWord, Report } from './types.ts';
const technical = new Set(['id', 'word', 'letters', 'uniqueLetters', 'length', 'units', 'readingLatin', 'transliterationVersion', 'sources', 'source', 'metadataSource']);
export function mergeFields(target: Record<string, unknown>, incoming: Record<string, unknown>, provenance: Record<string, string>, source: string, prefix = ''): Record<string, unknown> {
  const output = { ...target };
  for (const [key, value] of Object.entries(incoming)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe metadata key');
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const previous = output[key];
      output[key] = mergeFields(previous && typeof previous === 'object' && !Array.isArray(previous) ? object(previous) : {}, object(value), provenance, source, path);
    } else { output[key] = value; provenance[path] = source; }
  }
  return output;
}
export function mergeSources(records: RawWord[], report: Report = () => {}) {
  const merged = new Map<string, MergedWord>(), rejected: { word: string; reason: string }[] = [];
  const ordered = [...records].sort((a, b) => a.sourcePriority - b.sourcePriority || a.sourceId.localeCompare(b.sourceId) || a.word.localeCompare(b.word));
  ordered.forEach((record, index) => {
    try {
      if (!Number.isFinite(record.sourcePriority)) throw new Error('Invalid source priority');
      const word = normalizeArmenian(record.word);
      if (word.length > 24) throw new Error('Word exceeds 24 characters');
      deriveWord(word);
      const entry = merged.get(word) ?? { word, sources: [], metadata: {}, metadataSource: {}, rawDefinitions: [], rawPos: [] };
      entry.metadata = mergeFields(entry.metadata, record.metadata ?? {}, entry.metadataSource, record.sourceId);
      entry.rawDefinitions = [...new Set([...entry.rawDefinitions, ...(record.rawDefinitions ?? [])])];
      entry.rawPos = [...new Set([...entry.rawPos, ...(record.rawPos ?? [])])];
      if (record.rawFrequency !== undefined) entry.rawFrequency = record.rawFrequency;
      if (!entry.sources.some(s => JSON.stringify(s) === JSON.stringify(record.source))) entry.sources.push(record.source);
      merged.set(word, entry);
    } catch (error) { rejected.push({ word: record.word, reason: String(error) }); }
    if (index % 100 === 0 || index === ordered.length - 1) report({ stage: 'normalize/merge', processed: index + 1, total: ordered.length, rejected: rejected.length });
  });
  return { words: [...merged.values()].sort((a, b) => a.word.localeCompare(b.word)), rejected };
}
export function deriveMetadata(records: MergedWord[], report: Report = () => {}): BuildWord[] {
  return records.map((record, index) => {
    const derived = deriveWord(record.word), metadata = Object.fromEntries(Object.entries(record.metadata).filter(([key]) => !technical.has(key)));
    const metadataSource = { ...record.metadataSource };
    for (const key of technical) metadataSource[key] = 'deterministic';
    const word = { ...metadata, ...derived,
      meaning: metadata.meaning, familiarity: metadata.familiarity,
      categories: metadata.categories ?? [], tags: metadata.tags ?? [],
      frequencyScore: record.rawFrequency === undefined ? metadata.frequencyScore : Math.max(0, Math.min(1, record.rawFrequency)),
      visualDifficulty: Math.min(1, derived.uniqueLetters.length / 16),
      readingDifficulty: Math.min(1, derived.units!.filter(u => u.latin.length > 1 || u.source.length > 1).length / derived.units!.length),
      acceptedLatin: [...new Set([...derived.acceptedLatin, ...strings(metadata.acceptedLatin ?? [])])],
      acceptedCyrillic: [...new Set([...derived.acceptedCyrillic, ...strings(metadata.acceptedCyrillic ?? [])])],
      source: record.sources.at(-1), sources: record.sources, metadataSource,
      rawDefinitions: record.rawDefinitions, rawPos: record.rawPos,
    };
    parseWord(word);
    if (index % 100 === 0 || index === records.length - 1) report({ stage: 'derive', processed: index + 1, total: records.length });
    return word as BuildWord;
  });
}
export function applyOverrides(words: BuildWord[], value: unknown): BuildWord[] {
  const overrides = object(value), ids = new Set(words.map(w => w.id));
  for (const id of Object.keys(overrides)) if (!ids.has(id)) throw new Error(`Unknown override ID: ${id}`);
  return words.map(word => {
    if (!overrides[word.id]) return word;
    const metadataSource = { ...word.metadataSource };
    const result = mergeFields(word as unknown as Record<string, unknown>, object(overrides[word.id]), metadataSource, 'manual');
    parseWord(result);
    return { ...result, metadataSource } as unknown as BuildWord;
  });
}
export function composeDataset(words: BuildWord[], limit = 1000): BuildWord[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Dataset limit must be a positive integer');
  return [...words].filter(w => !w.flags?.length).sort((a, b) =>
    Number(b.sources.some(s => s.type === 'curated')) - Number(a.sources.some(s => s.type === 'curated'))
    || (b.usefulnessScore ?? 0.5) - (a.usefulnessScore ?? 0.5) || a.length - b.length || a.id.localeCompare(b.id)
  ).slice(0, limit);
}
export function validateDataset(words: BuildWord[], generatedAt = new Date().toISOString()) {
  for (const word of words) validateMetadata(word as unknown as Record<string, unknown>);
  return parseDictionary({ version: 1, schemaVersion: 1, generatedAt, words });
}
