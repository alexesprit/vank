import { deriveWord, normalizeArmenian } from '../../shared/armenian.ts';
import { object } from '../../shared/schema.ts';
import { composeDataset } from './pipeline.ts';
import type { BuildWord } from './types.ts';

export interface AudiencePolicy {
  language: string;
  candidates: string;
  minFamiliarWords: number;
  minFamiliarShare: number;
  minLetterCoverage: number;
}
export function parseAudience(
  value: unknown,
  languages: string[],
  limit: number,
): AudiencePolicy {
  const p = object(value);
  if (
    typeof p.language !== 'string' ||
    !languages.includes(p.language) ||
    typeof p.candidates !== 'string' ||
    !p.candidates.trim() ||
    typeof p.minFamiliarWords !== 'number' ||
    !Number.isInteger(p.minFamiliarWords) ||
    p.minFamiliarWords < 1 ||
    p.minFamiliarWords > limit ||
    typeof p.minFamiliarShare !== 'number' ||
    !Number.isFinite(p.minFamiliarShare) ||
    p.minFamiliarShare <= 0 ||
    p.minFamiliarShare > 1 ||
    typeof p.minLetterCoverage !== 'number' ||
    !Number.isInteger(p.minLetterCoverage) ||
    p.minLetterCoverage < 1
  )
    throw new Error('Invalid audience policy');
  return p as unknown as AudiencePolicy;
}
const curated = (w: BuildWord) => w.sources.some((s) => s.type === 'curated');
export const isFamiliar = (w: BuildWord, language: string) =>
  (w.familiarity?.[language] ?? 0) >= 0.8;

export function shortlistAudience(
  words: BuildWord[],
  value: unknown,
  policy: AudiencePolicy,
) {
  if (!Array.isArray(value))
    throw new Error('Expected recognition candidate array');
  const hints = new Map<string, string>();
  const priority = new Map<string, number>();
  const purposes = new Map<string, 'familiar' | 'verification'>();
  for (const entry of value) {
    const r = object(entry);
    if (
      typeof r.word !== 'string' ||
      typeof r.recognizableAs !== 'string' ||
      !r.recognizableAs.trim()
    )
      throw new Error('Invalid recognition candidate');
    if (
      r.purpose !== undefined &&
      r.purpose !== 'familiar' &&
      r.purpose !== 'verification'
    )
      throw new Error('Invalid candidate purpose');
    const word = normalizeArmenian(r.word);
    deriveWord(word);
    if (hints.has(word))
      throw new Error(`Duplicate recognition candidate: ${word}`);
    hints.set(word, r.recognizableAs);
    priority.set(word, priority.size);
    purposes.set(
      word,
      r.purpose === 'verification' ? 'verification' : 'familiar',
    );
  }
  const available = new Set(words.map((w) => w.word));
  const missing = [...hints.keys()].filter((word) => !available.has(word));
  // Hints select attested words; they never create a lemma or certify familiarity.
  const group = (word: BuildWord) =>
    curated(word) ? 0 : hints.has(word.word) ? 1 : 2;
  const selected = words.sort(
    (a, b) =>
      group(a) - group(b) ||
      (priority.get(a.word) ?? Number.MAX_SAFE_INTEGER) -
        (priority.get(b.word) ?? Number.MAX_SAFE_INTEGER) ||
      (b.frequencyScore ?? 0) - (a.frequencyScore ?? 0) ||
      a.length - b.length ||
      a.id.localeCompare(b.id),
  );
  return {
    missing,
    words: selected.map((w) => {
      const hint = hints.get(w.word);
      return hint === undefined
        ? curated(w)
          ? w
          : { ...w, audiencePurpose: 'verification' as const }
        : {
            ...w,
            recognitionHints: { [policy.language]: hint },
            audiencePurpose: purposes.get(w.word),
          };
    }),
  };
}

export function composeAudience(
  words: BuildWord[],
  limit: number,
  policy: AudiencePolicy,
): BuildWord[] {
  const eligible = words.filter(
    (w) =>
      !w.flags?.length &&
      (curated(w) ||
        ((w.ai?.confidence ?? 0) >= 0.8 &&
          (isFamiliar(w, policy.language) || (w.usefulnessScore ?? 0) >= 0.5))),
  );
  const familiar = composeDataset(
    eligible.filter((w) => isFamiliar(w, policy.language)),
    limit,
  );
  // Verification also requires explicit selection during candidate review.
  const verification = composeDataset(
    eligible.filter(
      (w) =>
        (curated(w) || w.audiencePurpose === 'verification') &&
        (w.familiarity?.[policy.language] ?? 1) <= 0.4,
    ),
    limit,
  );
  const reserved = Math.min(
    verification.length,
    limit - Math.ceil(limit * policy.minFamiliarShare),
    limit - policy.minFamiliarWords,
  );
  const high = familiar.slice(0, limit - reserved);
  if (high.length < policy.minFamiliarWords)
    throw new Error(
      `Audience quality: only ${high.length} familiar ${policy.language} words; need ${policy.minFamiliarWords}. Review or expand recognition candidates; refusing to pad the dictionary.`,
    );
  const lowCount = Math.min(
    verification.length,
    limit - high.length,
    Math.floor(
      (high.length * (1 - policy.minFamiliarShare)) / policy.minFamiliarShare +
        1e-9,
    ),
  );
  return [...high, ...verification.slice(0, lowCount)];
}
