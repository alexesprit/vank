import { ALPHABET, deriveWord, wordTokens } from '../../shared/armenian.ts';
import { object } from '../../shared/schema.ts';
import type { Word } from '../../shared/types.ts';
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
const ambiguousCasePair = /Ե(?:Վ|վ)/u;
export const isFamiliar = (w: BuildWord, language: string) =>
  (w.familiarity?.[language] ?? 0) >= 0.8;

export const countLetterCoverage = (words: Pick<Word, 'uniqueLetters'>[]) =>
  ALPHABET.map(({ upper: letter }) => ({
    letter,
    words: words.filter((word) => word.uniqueLetters.includes(letter)).length,
  }));

function selectByLetterCoverage(
  words: BuildWord[],
  limit: number,
  selected: BuildWord[],
): BuildWord[] {
  if (words.length <= limit) return words;
  const result = words.filter(curated).slice(0, limit);
  const counts = new Map(
    countLetterCoverage([...selected, ...result]).map(({ letter, words }) => [
      letter,
      words,
    ]),
  );
  let total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  let squares = [...counts.values()].reduce(
    (sum, count) => sum + count * count,
    0,
  );
  const remaining = words.filter((word) => !curated(word));
  // ponytail: quadratic greedy scan is plenty for a few thousand dictionary words.
  while (result.length < limit && remaining.length) {
    let best = 0;
    let bestFairness = -1;
    for (const [index, word] of remaining.entries()) {
      const nextSquares = word.uniqueLetters.reduce(
        (sum, letter) => sum + 2 * (counts.get(letter) ?? 0) + 1,
        squares,
      );
      const nextTotal = total + word.uniqueLetters.length;
      // Alphabet size is constant, so its divisor cannot change the best Jain score.
      const fairness = (nextTotal * nextTotal) / nextSquares;
      if (fairness > bestFairness) {
        best = index;
        bestFairness = fairness;
      }
    }
    const [word] = remaining.splice(best, 1);
    if (!word) break;
    result.push(word);
    for (const letter of word.uniqueLetters) {
      const count = counts.get(letter) ?? 0;
      squares += 2 * count + 1;
      total++;
      counts.set(letter, count + 1);
    }
  }
  return result;
}

export function shortlistAudience(
  words: BuildWord[],
  value: unknown,
  policy: AudiencePolicy,
) {
  if (!Array.isArray(value))
    throw new Error('Expected recognition candidate array');
  const hints = new Map<string, string>(),
    priority = new Map<string, number>(),
    purposes = new Map<string, 'familiar' | 'verification'>(),
    byDisplay = new Map<string, BuildWord[]>();
  for (const word of words) {
    const variants = byDisplay.get(word.word) ?? [];
    variants.push(word);
    byDisplay.set(word.word, variants);
  }
  const candidates: { word: string; identity: string }[] = [];
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
    if (
      r.ligaturePositions !== undefined &&
      (!Array.isArray(r.ligaturePositions) ||
        r.ligaturePositions.some((position) => !Number.isInteger(position)))
    )
      throw new Error('Invalid recognition candidate spelling');
    const derived = deriveWord(
        r.word,
        r.ligaturePositions as number[] | undefined,
      ),
      ambiguous =
        derived.ligaturePositions === undefined &&
        ambiguousCasePair.test(r.word),
      variants = ambiguous ? byDisplay.get(derived.word) : undefined,
      identity =
        ambiguous && variants?.length === 1
          ? JSON.stringify(wordTokens(variants[0] ?? derived))
          : ambiguous && variants && variants.length > 1
            ? `ambiguous:${derived.word}`
            : JSON.stringify(derived.letters);
    if (hints.has(identity))
      throw new Error(`Duplicate recognition candidate: ${derived.word}`);
    hints.set(identity, r.recognizableAs);
    priority.set(identity, priority.size);
    purposes.set(
      identity,
      r.purpose === 'verification' ? 'verification' : 'familiar',
    );
    candidates.push({ word: derived.word, identity });
  }
  const available = new Set(
    words.map((word) => JSON.stringify(wordTokens(word))),
  );
  const missing = candidates
    .filter(({ identity }) => !available.has(identity))
    .map(({ word }) => word);
  // Hints select attested words; they never create a lemma or certify familiarity.
  const group = (word: BuildWord) =>
    curated(word) ? 0 : hints.has(JSON.stringify(wordTokens(word))) ? 1 : 2;
  const selected = words.sort(
    (a, b) =>
      group(a) - group(b) ||
      (priority.get(JSON.stringify(wordTokens(a))) ?? Number.MAX_SAFE_INTEGER) -
        (priority.get(JSON.stringify(wordTokens(b))) ??
          Number.MAX_SAFE_INTEGER) ||
      (b.frequencyScore ?? 0) - (a.frequencyScore ?? 0) ||
      a.length - b.length ||
      a.id.localeCompare(b.id),
  );
  return {
    missing,
    words: selected.map((w) => {
      const identity = JSON.stringify(wordTokens(w)),
        hint = hints.get(identity);
      return hint === undefined
        ? curated(w)
          ? w
          : { ...w, audiencePurpose: 'verification' as const }
        : {
            ...w,
            recognitionHints: { [policy.language]: hint },
            audiencePurpose: purposes.get(identity),
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
  const familiarPool = eligible.filter((w) => isFamiliar(w, policy.language));
  const familiar = composeDataset(
    familiarPool,
    Math.max(1, familiarPool.length),
  );
  // Verification also requires explicit selection during candidate review.
  const verificationPool = eligible.filter(
    (w) =>
      (curated(w) || w.audiencePurpose === 'verification') &&
      (w.familiarity?.[policy.language] ?? 1) <= 0.4,
  );
  const verification = composeDataset(
    verificationPool,
    Math.max(1, verificationPool.length),
  );
  const reserved = Math.min(
    verification.length,
    limit - Math.ceil(limit * policy.minFamiliarShare),
    limit - policy.minFamiliarWords,
  );
  const high = selectByLetterCoverage(familiar, limit - reserved, []);
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
  return [...high, ...selectByLetterCoverage(verification, lowCount, high)];
}
