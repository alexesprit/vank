import { CATEGORIES, object, score, strings } from '../../shared/schema.ts';
import { FAMILIARITY_THRESHOLD, VERIFICATION_THRESHOLD } from './audience.ts';
import type { BuildWord } from './types.ts';

export type FamiliarityClass = 'familiar' | 'verification' | 'middle';

export interface EnrichmentReference {
  word: string;
  meaning: Record<string, string[]>;
  familiarity: Record<string, Exclude<FamiliarityClass, 'middle'>>;
  flagged?: boolean;
  categories?: string[];
  usefulnessMin?: number;
}

export interface BinaryMetrics {
  precision: number;
  recall: number;
  f1: number;
}

export interface EnrichmentItemEvaluation {
  id: string;
  word: string;
  meaning: {
    expected: string[];
    actual: string | null;
    match: boolean;
  };
  familiarity: {
    expected: Exclude<FamiliarityClass, 'middle'>;
    actual: FamiliarityClass;
    score: number | null;
    match: boolean;
  };
  flagged: {
    expected: boolean;
    actual: boolean;
    match: boolean;
  };
  categories: {
    expected: string[];
    actual: string[];
    missing: string[];
    match: boolean;
  };
  usefulness: {
    minimum: number | null;
    actual: number | null;
    match: boolean;
  };
}

export interface EnrichmentEvaluation {
  total: number;
  meaningAccuracy: number;
  familiarityAccuracy: number;
  familiar: BinaryMetrics;
  verification: BinaryMetrics;
  flagAccuracy: number;
  categoryRecall: number;
  usefulnessAccuracy: number;
  items: EnrichmentItemEvaluation[];
}

const normalize = (value: string) => value.trim().toLocaleLowerCase();
const referenceFields = new Set([
  'word',
  'meaning',
  'familiarity',
  'flagged',
  'categories',
  'usefulnessMin',
]);

export function parseEnrichmentReferences(
  value: unknown,
  language?: string,
): EnrichmentReference[] {
  if (!Array.isArray(value))
    throw new Error('Evaluation reference must be an array');
  return value.map((entry) => {
    const reference = object(entry);
    if (Object.keys(reference).some((key) => !referenceFields.has(key)))
      throw new Error('Unknown evaluation reference field');
    if (typeof reference.word !== 'string' || !reference.word.trim())
      throw new Error('Evaluation reference is missing a word');
    const meaning = object(reference.meaning);
    for (const values of Object.values(meaning)) strings(values);
    const familiarity = object(reference.familiarity);
    for (const value of Object.values(familiarity))
      if (value !== 'familiar' && value !== 'verification')
        throw new Error('Invalid evaluation familiarity class');
    if (
      reference.flagged !== undefined &&
      typeof reference.flagged !== 'boolean'
    )
      throw new Error('Invalid evaluation flagged value');
    if (reference.categories !== undefined) {
      const categories = strings(reference.categories);
      if (categories.some((category) => !CATEGORIES.includes(category)))
        throw new Error('Invalid evaluation category');
    }
    if (reference.usefulnessMin !== undefined) score(reference.usefulnessMin);
    if (language !== undefined) {
      if (meaning[language] === undefined)
        throw new Error(`Evaluation reference is missing ${language} meaning`);
      if (familiarity[language] === undefined)
        throw new Error(
          `Evaluation reference is missing ${language} familiarity`,
        );
    }
    return reference as unknown as EnrichmentReference;
  });
}

export function familiarityClass(value: number): FamiliarityClass {
  if (value >= FAMILIARITY_THRESHOLD) return 'familiar';
  if (value <= VERIFICATION_THRESHOLD) return 'verification';
  return 'middle';
}

function binaryMetrics(expected: boolean[], actual: boolean[]): BinaryMetrics {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const [index, value] of actual.entries()) {
    const target = expected[index];
    if (value && target) truePositive++;
    else if (value) falsePositive++;
    else if (target) falseNegative++;
  }
  const precision =
    truePositive + falsePositive === 0
      ? 0
      : truePositive / (truePositive + falsePositive);
  const recall =
    truePositive + falseNegative === 0
      ? 0
      : truePositive / (truePositive + falseNegative);
  return {
    precision,
    recall,
    f1:
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall),
  };
}

export function evaluateEnrichment(
  words: BuildWord[],
  references: EnrichmentReference[],
  language: string,
): EnrichmentEvaluation {
  const byWord = validateEnrichmentReferences(words, references);
  const expectedFamiliar: boolean[] = [];
  const actualFamiliar: boolean[] = [];
  const expectedVerification: boolean[] = [];
  const actualVerification: boolean[] = [];
  let meaningMatches = 0;
  let familiarityMatches = 0;
  let flagMatches = 0;
  let expectedCategoryCount = 0;
  let matchedCategoryCount = 0;
  let usefulnessMatches = 0;
  const items: EnrichmentItemEvaluation[] = [];
  for (const reference of references) {
    const word = byWord.get(reference.word);
    if (!word) throw new Error(`Missing evaluation output: ${reference.word}`);
    const expectedMeaning = reference.meaning[language] ?? [];
    const actualMeaning = word.meaning?.[language];
    const meaningMatch =
      typeof actualMeaning === 'string' &&
      expectedMeaning.some(
        (value) => normalize(value) === normalize(actualMeaning),
      );
    if (meaningMatch) meaningMatches++;
    const expectedClass = reference.familiarity[language];
    const actualScore = word.familiarity?.[language];
    const actualClass = familiarityClass(actualScore ?? 0);
    const familiarityMatch = actualClass === expectedClass;
    if (familiarityMatch) familiarityMatches++;
    expectedFamiliar.push(expectedClass === 'familiar');
    actualFamiliar.push(actualClass === 'familiar');
    expectedVerification.push(expectedClass === 'verification');
    actualVerification.push(actualClass === 'verification');
    const expectedFlagged = Boolean(reference.flagged);
    const actualFlagged = Boolean(word.flags?.length);
    const flagMatch = actualFlagged === expectedFlagged;
    if (flagMatch) flagMatches++;
    const categories = reference.categories ?? [];
    expectedCategoryCount += categories.length;
    const missingCategories = categories.filter(
      (category) => !word.categories.includes(category),
    );
    matchedCategoryCount += categories.length - missingCategories.length;
    const categoryMatch = missingCategories.length === 0;
    const usefulnessMatch =
      reference.usefulnessMin === undefined ||
      (word.usefulnessScore ?? 0) >= reference.usefulnessMin;
    if (usefulnessMatch) usefulnessMatches++;
    items.push({
      id: word.id,
      word: word.word,
      meaning: {
        expected: expectedMeaning,
        actual: actualMeaning ?? null,
        match: meaningMatch,
      },
      familiarity: {
        expected: expectedClass,
        actual: actualClass,
        score: actualScore ?? null,
        match: familiarityMatch,
      },
      flagged: {
        expected: expectedFlagged,
        actual: actualFlagged,
        match: flagMatch,
      },
      categories: {
        expected: categories,
        actual: word.categories,
        missing: missingCategories,
        match: categoryMatch,
      },
      usefulness: {
        minimum: reference.usefulnessMin ?? null,
        actual: word.usefulnessScore ?? null,
        match: usefulnessMatch,
      },
    });
  }
  const total = references.length;
  return {
    total,
    meaningAccuracy: meaningMatches / total,
    familiarityAccuracy: familiarityMatches / total,
    familiar: binaryMetrics(expectedFamiliar, actualFamiliar),
    verification: binaryMetrics(expectedVerification, actualVerification),
    flagAccuracy: flagMatches / total,
    categoryRecall:
      expectedCategoryCount === 0
        ? 1
        : matchedCategoryCount / expectedCategoryCount,
    usefulnessAccuracy: usefulnessMatches / total,
    items,
  };
}

export function validateEnrichmentReferences(
  words: BuildWord[],
  references: EnrichmentReference[],
): Map<string, BuildWord> {
  const byWord = new Map(words.map((word) => [word.word, word]));
  if (byWord.size !== words.length)
    throw new Error('Evaluation output contains duplicate words');
  const referenceWords = new Set(references.map((reference) => reference.word));
  if (referenceWords.size !== references.length)
    throw new Error('Evaluation references contain duplicate words');
  if (!references.length || references.length !== words.length)
    throw new Error('Evaluation references must cover every output word');
  for (const reference of references) {
    if (!byWord.has(reference.word))
      throw new Error(`Missing evaluation output: ${reference.word}`);
  }
  return byWord;
}
