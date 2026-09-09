import { expect, it } from 'vitest';
import { shortlistAudience, composeAudience, parseAudience } from '../builder/src/audience';
import { curatedSource } from '../builder/src/sources/curated';
import { deriveMetadata, mergeSources } from '../builder/src/pipeline';

const policy = { language: 'ru', candidates: 'fixture.json', minFamiliarWords: 2, minFamiliarShare: 0.7 };
const words = () => deriveMetadata(mergeSources(curatedSource([
  { word: 'ՏԱՔՍԻ', familiarity: { ru: 1 } }, { word: 'ՄԵՏՐՈ', familiarity: { ru: 1 } },
  { word: 'ԲԱՆԿ', familiarity: { ru: 1 } }, { word: 'ՋՈՒՐ', familiarity: { ru: 0.05 } },
  { word: 'ՌՈԲՈՏ' }, { word: 'ԾԱՌ' },
])).words).map(w => ['ՌՈԲՈՏ', 'ԾԱՌ'].includes(w.word) ? { ...w, sources: [{ type: 'wiktionary' }], rawDefinitions: ['fixture'] } : w);

it('shortlists attested recognition candidates and curated verification words before AI, without inventing missing words', () => {
  const result = shortlistAudience(words(), [{ word: 'ռոբոտ', recognizableAs: 'робот' }, { word: 'ԿՈՄԲՈ', recognizableAs: 'комбо' }], policy, 1000);
  expect(result.words.map(w => w.word)).toContain('ՌՈԲՈՏ');
  expect(result.words.map(w => w.word)).toContain('ՋՈՒՐ');
  expect(result.words.map(w => w.word)).not.toContain('ԾԱՌ');
  expect(result.words.map(w => w.word)).not.toContain('ԿՈՄԲՈ');
  expect(result.missing).toEqual(['ԿՈՄԲՈ']);
  expect(result.words.find(w => w.word === 'ՌՈԲՈՏ')?.recognitionHints).toEqual({ ru: 'робот' });
  expect(() => shortlistAudience(words(), [{ word: 'hello', recognizableAs: 'x' }], policy, 1000)).toThrow();
  expect(() => shortlistAudience(words(), [{ word: 'ՌՈԲՈՏ', recognizableAs: '' }], policy, 1000)).toThrow();
});

it('enforces a familiar majority and a ceiling, excludes unconfirmed imports, and keeps curated verification vocabulary', () => {
  const result = composeAudience(words(), 1000, policy);
  expect(result).toHaveLength(4);
  expect(result.some(w => w.word === 'ՋՈՒՐ')).toBe(true);
  expect(composeAudience(words(), 3, policy)).toHaveLength(3);
  expect(composeAudience(words(), 3, { ...policy, minFamiliarWords: 3 })).toHaveLength(3);
  expect(() => composeAudience(words().map(w => ({ ...w, familiarity: { ru: 0.1 } })), 1000, policy)).toThrow(/familiar/i);
  const uncertain = words().map(w => w.word === 'ՌՈԲՈՏ' ? { ...w, familiarity: { ru: 1 }, usefulnessScore: 1, ai: { model: 'x', promptVersion: 2, schemaVersion: 1, confidence: 0.2 } } : w);
  expect(composeAudience(uncertain, 1000, policy).some(w => w.word === 'ՌՈԲՈՏ')).toBe(false);
  const confirmed = uncertain.map(w => w.ai ? { ...w, ai: { ...w.ai, confidence: 0.9 } } : w);
  expect(composeAudience(confirmed, 1000, policy).some(w => w.word === 'ՌՈԲՈՏ')).toBe(true);
  const recognizable = confirmed.map(w => w.word === 'ՌՈԲՈՏ' ? { ...w, usefulnessScore: 0.3 } : w);
  expect(composeAudience(recognizable, 1000, policy).some(w => w.word === 'ՌՈԲՈՏ')).toBe(true);
  expect(composeAudience(words().map(w => w.word === 'ՏԱՔՍԻ' ? { ...w, flags: ['suspect'] } : w), 1000, policy).some(w => w.word === 'ՏԱՔՍԻ')).toBe(false);
});

it('validates the audience policy rather than silently accepting impossible quotas', () => {
  expect(parseAudience(policy, ['ru'], 1000)).toEqual(policy);
  for (const change of [{ language: 'en' }, { minFamiliarWords: 1001 }, { minFamiliarShare: 0 }, { minFamiliarShare: 1.1 }, { candidates: '' }]) {
    expect(() => parseAudience({ ...policy, ...change }, ['ru'], 1000)).toThrow();
  }
});

it('admits explicitly proposed verification words only after enrichment and reports an output shortfall', () => {
  const input = words();
  const shortlist = shortlistAudience(input, [{ word: 'ԾԱՌ', recognizableAs: 'дерево', purpose: 'verification' }], policy, 1000);
  const enriched = shortlist.words.map(w => w.word === 'ԾԱՌ' ? { ...w, familiarity: { ru: 0.05 }, usefulnessScore: 0.9,
    ai: { model: 'fixture', promptVersion: 2, schemaVersion: 1, confidence: 0.9 } } : w);
  expect(composeAudience(enriched, 1000, { ...policy, minFamiliarShare: 0.5 }).some(w => w.word === 'ԾԱՌ')).toBe(true);
  const guessable = enriched.map(w => w.word === 'ԾԱՌ' ? { ...w, familiarity: { ru: 0.6 } } : w);
  expect(composeAudience(guessable, 1000, { ...policy, minFamiliarShare: 0.5 }).some(w => w.word === 'ԾԱՌ')).toBe(false);
  expect(() => composeAudience(enriched, 1000, { ...policy, minWords: 950 })).toThrow(/shortfall/i);
  expect(() => parseAudience({ ...policy, minWords: 1001 }, ['ru'], 1000)).toThrow();
  expect(() => parseAudience({ ...policy, candidateLimit: 0 }, ['ru'], 1000)).toThrow();
  expect(shortlistAudience(words(), [], { ...policy, candidateLimit: 2 }, 1000).words).toHaveLength(2);
});
