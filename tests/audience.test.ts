import { expect, it } from 'vitest';
import {
  composeAudience,
  isFamiliar,
  parseAudience,
  shortlistAudience,
} from '../builder/src/audience';
import {
  composeDataset,
  deriveMetadata,
  mergeSources,
} from '../builder/src/pipeline';
import { curatedSource } from '../builder/src/sources/curated';
import { deriveWord } from '../shared/armenian';

const policy = {
  language: 'ru',
  candidates: 'fixture.json',
  minFamiliarWords: 2,
  minFamiliarShare: 0.7,
  minLetterCoverage: 2,
};
const words = () =>
  deriveMetadata(
    mergeSources(
      curatedSource([
        { word: 'տաքսի', familiarity: { ru: 1 } },
        { word: 'մետրո', familiarity: { ru: 1 } },
        { word: 'բանկ', familiarity: { ru: 1 } },
        { word: 'ջուր', familiarity: { ru: 0.05 } },
        { word: 'ռոբոտ' },
        { word: 'ծառ' },
      ]),
    ).words,
  ).map((w) =>
    ['ռոբոտ', 'ծառ'].includes(w.word)
      ? { ...w, sources: [{ type: 'wiktionary' }], rawDefinitions: ['fixture'] }
      : w,
  );

it('plans curated, reviewed, then unreviewed attested words without inventing missing words', () => {
  const result = shortlistAudience(
    words(),
    [
      { word: 'ռոբոտ', recognizableAs: 'робот' },
      { word: 'կոմբո', recognizableAs: 'комбо' },
    ],
    policy,
  );
  expect(result.words.map((w) => w.word)).toContain('ռոբոտ');
  expect(result.words.map((w) => w.word)).toContain('ջուր');
  expect(result.words.map((w) => w.word)).toContain('ծառ');
  expect(result.words.map((w) => w.word)).not.toContain('կոմբո');
  expect(result.missing).toEqual(['կոմբո']);
  expect(
    result.words.find((w) => w.word === 'ռոբոտ')?.recognitionHints,
  ).toEqual({ ru: 'робот' });
  expect(result.words.find((w) => w.word === 'ծառ')?.audiencePurpose).toBe(
    'verification',
  );
  expect(() =>
    shortlistAudience(
      words(),
      [{ word: 'hello', recognizableAs: 'x' }],
      policy,
    ),
  ).toThrow();
  expect(() =>
    shortlistAudience(words(), [{ word: 'ռոբոտ', recognizableAs: '' }], policy),
  ).toThrow();
});

it('matches recognition candidates by spelling provenance, not CAPS display alone', () => {
  const candidates = deriveMetadata(
    mergeSources(curatedSource([{ word: 'բարև' }, { word: 'բարեվ' }])).words,
  );
  const ligature = deriveWord('բարև'),
    separate = deriveWord('բարեվ');
  const matched = shortlistAudience(
    candidates,
    [{ word: 'բարև', recognizableAs: 'приветствие' }],
    policy,
  );

  expect(matched.missing).toEqual([]);
  expect(
    matched.words.find((word) => word.id === ligature.id)?.recognitionHints,
  ).toEqual({ ru: 'приветствие' });
  expect(
    matched.words.find((word) => word.id === separate.id)?.recognitionHints,
  ).toBeUndefined();

  const ambiguous = shortlistAudience(
    candidates,
    [{ word: 'բարեվ', recognizableAs: 'ambiguous' }],
    policy,
  );
  expect(ambiguous.missing).toEqual([]);
  expect(
    ambiguous.words.find((word) => word.id === separate.id)?.recognitionHints,
  ).toEqual({ ru: 'ambiguous' });

  const displayOnly = shortlistAudience(
    candidates.slice(0, 1),
    [{ word: 'ԲԱՐԵՎ', recognizableAs: 'display spelling' }],
    policy,
  );
  expect(displayOnly.missing).toEqual([]);
  expect(displayOnly.words[0]?.recognitionHints).toEqual({
    ru: 'display spelling',
  });

  const explicitSeparate = shortlistAudience(
    candidates.filter((word) => word.id === ligature.id),
    [{ word: 'բարեվ', recognizableAs: 'separate spelling' }],
    policy,
  );
  expect(explicitSeparate.missing).toEqual(['բարեվ']);
});

it('enforces a familiar majority and a ceiling, excludes unconfirmed imports, and keeps curated verification vocabulary', () => {
  const result = composeAudience(words(), 1000, policy);
  expect(result).toHaveLength(4);
  expect(result.some((w) => w.word === 'ջուր')).toBe(true);
  expect(composeAudience(words(), 3, policy)).toHaveLength(3);
  expect(
    composeAudience(words(), 3, { ...policy, minFamiliarWords: 3 }),
  ).toHaveLength(3);
  expect(() =>
    composeAudience(
      words().map((w) => ({ ...w, familiarity: { ru: 0.1 } })),
      1000,
      policy,
    ),
  ).toThrow('familiar');
  const uncertain = words().map((w) =>
    w.word === 'ռոբոտ'
      ? {
          ...w,
          familiarity: { ru: 1 },
          usefulnessScore: 1,
          ai: {
            model: 'x',
            promptVersion: 2,
            schemaVersion: 1,
            confidence: 0.2,
          },
        }
      : w,
  );
  expect(
    composeAudience(uncertain, 1000, policy).some((w) => w.word === 'ռոբոտ'),
  ).toBe(false);
  const confirmed = uncertain.map((w) =>
    w.ai ? { ...w, ai: { ...w.ai, confidence: 0.9 } } : w,
  );
  expect(
    composeAudience(confirmed, 1000, policy).some((w) => w.word === 'ռոբոտ'),
  ).toBe(true);
  const recognizable = confirmed.map((w) =>
    w.word === 'ռոբոտ' ? { ...w, usefulnessScore: 0.3 } : w,
  );
  expect(
    composeAudience(recognizable, 1000, policy).some((w) => w.word === 'ռոբոտ'),
  ).toBe(true);
  expect(
    composeAudience(
      words().map((w) =>
        w.word === 'տաքսի' ? { ...w, flags: ['suspect'] } : w,
      ),
      1000,
      policy,
    ).some((w) => w.word === 'տաքսի'),
  ).toBe(false);
});

it('validates the audience policy rather than silently accepting impossible quotas', () => {
  expect(parseAudience(policy, ['ru'], 1000)).toEqual(policy);
  for (const change of [
    { language: 'en' },
    { minFamiliarWords: 1001 },
    { minFamiliarShare: 0 },
    { minFamiliarShare: 1.1 },
    { minLetterCoverage: 0 },
    { candidates: '' },
  ]) {
    expect(() =>
      parseAudience({ ...policy, ...change }, ['ru'], 1000),
    ).toThrow();
  }
});

it('admits explicitly proposed verification words only after enrichment', () => {
  const input = words();
  const shortlist = shortlistAudience(
    input,
    [{ word: 'ծառ', recognizableAs: 'дерево', purpose: 'verification' }],
    policy,
  );
  const enriched = shortlist.words.map((w) =>
    w.word === 'ծառ'
      ? {
          ...w,
          familiarity: { ru: 0.05 },
          usefulnessScore: 0.9,
          ai: {
            model: 'fixture',
            promptVersion: 2,
            schemaVersion: 1,
            confidence: 0.9,
          },
        }
      : w,
  );
  expect(
    composeAudience(enriched, 1000, { ...policy, minFamiliarShare: 0.5 }).some(
      (w) => w.word === 'ծառ',
    ),
  ).toBe(true);
  const guessable = enriched.map((w) =>
    w.word === 'ծառ' ? { ...w, familiarity: { ru: 0.6 } } : w,
  );
  expect(
    composeAudience(guessable, 1000, { ...policy, minFamiliarShare: 0.5 }).some(
      (w) => w.word === 'ծառ',
    ),
  ).toBe(false);
});

it('uses verification slots to improve letter distribution', () => {
  const enriched = words().map((word) =>
    ['ծառ', 'ռոբոտ'].includes(word.word)
      ? {
          ...word,
          audiencePurpose: 'verification' as const,
          familiarity: { ru: 0.05 },
          usefulnessScore: word.word === 'ռոբոտ' ? 0.9 : 0.5,
          ai: {
            model: 'fixture',
            promptVersion: 2,
            schemaVersion: 1,
            confidence: 0.9,
          },
        }
      : word,
  );
  const selected = composeAudience(enriched, 4, {
    ...policy,
    minFamiliarShare: 0.5,
  });

  expect(selected.map((word) => word.word)).toContain('ծառ');
  expect(selected.map((word) => word.word)).not.toContain('ռոբոտ');
});

it('balances familiar words when their pool exceeds its available slots', () => {
  const enriched = words().map((word) => {
    if (word.word === 'մետրո') return { ...word, flags: ['fixture'] };
    if (word.word === 'ջուր') return { ...word, familiarity: { ru: 1 } };
    return word.word === 'ռոբոտ'
      ? {
          ...word,
          familiarity: { ru: 1 },
          usefulnessScore: 0.9,
          ai: {
            model: 'fixture',
            promptVersion: 2,
            schemaVersion: 1,
            confidence: 0.9,
          },
        }
      : word;
  });
  const [giraffe] = deriveMetadata(
    mergeSources(curatedSource([{ word: 'ընձուղտ' }])).words,
  );
  if (!giraffe) throw new Error('Missing fixture word');
  enriched.push({
    ...giraffe,
    sources: [{ type: 'wiktionary' }],
    familiarity: { ru: 1 },
    usefulnessScore: 0.5,
    ai: {
      model: 'fixture',
      promptVersion: 2,
      schemaVersion: 1,
      confidence: 0.9,
    },
  });
  const selected = composeAudience(enriched, 4, {
    ...policy,
    minFamiliarShare: 1,
  });

  expect(selected.map((word) => word.word)).toContain('ընձուղտ');
  expect(selected.map((word) => word.word)).not.toContain('ռոբոտ');
});

it('keeps existing ranking when every familiar word fits', () => {
  const familiar = words().filter((word) => isFamiliar(word, policy.language));

  expect(
    composeAudience(familiar, 1000, {
      ...policy,
      minFamiliarShare: 1,
    }),
  ).toEqual(composeDataset(familiar, 1000));
});

it('keeps curated words first and otherwise preserves reviewed candidate order', () => {
  const result = shortlistAudience(
    words(),
    [
      { word: 'ծառ', recognizableAs: 'дерево' },
      { word: 'ռոբոտ', recognizableAs: 'робот' },
    ],
    policy,
  );
  expect(
    result.words
      .filter(
        (word) => !word.sources.some((source) => source.type === 'curated'),
      )
      .map((word) => word.word),
  ).toEqual(['ծառ', 'ռոբոտ']);
});
