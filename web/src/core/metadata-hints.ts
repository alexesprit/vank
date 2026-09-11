import type { Word } from '../../../shared/types.ts';

export interface MetadataHint {
  key: string;
  fallback: string;
}

// ponytail: explicit whitelist keeps prompts readable; add reviewed tags with
// translations here as metadata grows.
export const DISPLAYABLE_TAGS = new Set([
  'beginner',
  'common',
  'basic',
  'loanword',
  'native',
  'internationalism',
  'loan-from-russian',
  'geography',
  'country',
  'dish',
  'fruit',
  'place-name',
  'given-name',
  'person-name',
  'proper-name',
  'armenian-name',
  'russian-name',
  'city',
  'district',
  'street',
  'metro',
  'lake',
  'mountain',
  'mountain-range',
  'river',
  'capital',
  'yerevan',
  'armenia',
  'urban',
  'vegetable',
  'armenian',
  'russian',
  'female',
  'male',
  'diminutive',
  'slang',
  'formal',
  'informal',
  'traditional',
  'science',
  'medicine',
  'health',
  'finance',
  'sports',
  'sport',
  'technology',
  'travel',
  'culinary',
  'animals',
]);

const normalize = (value: string) =>
  value
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_]+/gu, '-')
    .replace(/-+/gu, '-');

const titleCase = (value: string) =>
  value
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]?.toLocaleUpperCase() + part.slice(1))
    .join(' ');

export function metadataHints(word: Pick<Word, 'categories' | 'tags'>) {
  const hints: MetadataHint[] = [];
  const seen = new Set<string>();
  const add = (namespace: 'categories' | 'tags', value: string) => {
    const normalized = normalize(value);
    if (
      !normalized ||
      seen.has(normalized) ||
      (namespace === 'tags' && !DISPLAYABLE_TAGS.has(normalized))
    )
      return;
    seen.add(normalized);
    hints.push({
      key: `metadata.${namespace}.${normalized}`,
      fallback: titleCase(normalized),
    });
  };
  for (const category of word.categories) add('categories', category);
  for (const tag of word.tags) add('tags', tag);
  return hints;
}

export function metadataHintLabels(
  word: Pick<Word, 'categories' | 'tags'>,
  translate: (key: string, fallback: string) => string = (_key, fallback) =>
    fallback,
) {
  const seen = new Set<string>();
  return metadataHints(word).flatMap(({ key, fallback }) => {
    const label = translate(key, fallback);
    const normalized = label.normalize('NFC').trim().toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [label];
  });
}

export const hasMetadataHints = (word: Pick<Word, 'categories' | 'tags'>) =>
  metadataHints(word).length > 0;
