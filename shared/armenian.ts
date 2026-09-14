import type { CaseMode, PronunciationUnit, Word } from './types.ts';

export const TRANSLITERATION_VERSION = 1;
// Modern Eastern Armenian, reformed orthography. ASCII learner readings merge
// aspiration distinctions; they do not substitute Western consonant values.
const sounds = [
  ['Ա', 'a', 'а'],
  ['Բ', 'b', 'б'],
  ['Գ', 'g', 'г'],
  ['Դ', 'd', 'д'],
  ['Ե', 'e', 'е'],
  ['Զ', 'z', 'з'],
  ['Է', 'e', 'э'],
  ['Ը', 'y', 'ы'],
  ['Թ', 't', 'т'],
  ['Ժ', 'zh', 'ж'],
  ['Ի', 'i', 'и'],
  ['Լ', 'l', 'л'],
  ['Խ', 'kh', 'х'],
  ['Ծ', 'ts', 'ц'],
  ['Կ', 'k', 'к'],
  ['Հ', 'h', 'х'],
  ['Ձ', 'dz', 'дз'],
  ['Ղ', 'gh', 'г'],
  ['Ճ', 'ch', 'ч'],
  ['Մ', 'm', 'м'],
  ['Յ', 'y', 'й'],
  ['Ն', 'n', 'н'],
  ['Շ', 'sh', 'ш'],
  ['Ո', 'o', 'о'],
  ['Չ', 'ch', 'ч'],
  ['Պ', 'p', 'п'],
  ['Ջ', 'j', 'дж'],
  ['Ռ', 'r', 'р'],
  ['Ս', 's', 'с'],
  ['Վ', 'v', 'в'],
  ['Տ', 't', 'т'],
  ['Ր', 'r', 'р'],
  ['Ց', 'ts', 'ц'],
  ['Ւ', 'v', 'в'],
  ['Փ', 'p', 'п'],
  ['Ք', 'k', 'к'],
  ['Օ', 'o', 'о'],
  ['Ֆ', 'f', 'ф'],
];
export const ALPHABET = [
  ...sounds.map(([upper, latin, cyrillic]) => ({
    upper,
    lower: upper.toLowerCase(),
    readingLatin: [latin],
    readingCyrillic: [cyrillic],
  })),
  { upper: 'և', lower: 'և', readingLatin: ['ev'], readingCyrillic: ['ев'] },
];
const alphabet = new Map(ALPHABET.map((letter) => [letter.upper, letter]));
const armenianPattern = /^[Ա-Ֆ]+$/u;
const ambiguousCasePair = /Ե(?:Վ|վ)/u;
const lowercaseArmenianPattern = /[ա-ֆ]/u;

export function normalizeArmenian(input: string): string {
  return input
    .normalize('NFC')
    .trim()
    .replaceAll('և', 'եվ')
    .toUpperCase()
    .replaceAll('ԵՒ', 'ԵՎ');
}

export function sourceLigaturePositions(input: string): number[] | undefined {
  const letters = [...input.normalize('NFC').trim()];
  if (!letters.includes('և')) return undefined;
  return letters.flatMap((letter, index) => (letter === 'և' ? [index] : []));
}

function fromCaps(word: string, positions: number[]): string[] {
  if (
    !Array.isArray(positions) ||
    positions.some((position) => !Number.isInteger(position) || position < 0) ||
    new Set(positions).size !== positions.length
  )
    throw new Error('Invalid ligature positions');
  const marked = new Set(positions),
    characters = [...word],
    tokens: string[] = [];
  let index = 0;
  while (index < characters.length) {
    if (marked.has(tokens.length)) {
      if (characters[index] !== 'Ե' || characters[index + 1] !== 'Վ')
        throw new Error('Ligature position does not display ԵՎ');
      tokens.push('և');
      index += 2;
    } else {
      tokens.push(characters[index] ?? '');
      index++;
    }
  }
  if (marked.size !== tokens.filter((token) => token === 'և').length)
    throw new Error('Ligature position is outside the word');
  return tokens;
}

function spelling(input: string, positions?: number[]) {
  const source = input.normalize('NFC').trim(),
    word = normalizeArmenian(source);
  if (!armenianPattern.test(word))
    throw new Error(`Invalid Armenian word: ${input}`);
  if (positions !== undefined) {
    const letters = fromCaps(word, positions);
    return { word, letters, ligaturePositions: [...positions] };
  }
  if (source.includes('և')) {
    const letters = [...source].map((letter) =>
      letter === 'և' ? 'և' : letter.toUpperCase(),
    );
    if (displayCaps(letters) !== word)
      throw new Error(`Invalid Armenian word: ${input}`);
    return {
      word,
      letters,
      ligaturePositions: letters.flatMap((letter, index) =>
        letter === 'և' ? [index] : [],
      ),
    };
  }
  const letters = [...word],
    explicitLowercase =
      lowercaseArmenianPattern.test(source) && !ambiguousCasePair.test(source);
  return {
    word,
    letters,
    ...(explicitLowercase ? { ligaturePositions: [] } : {}),
  };
}

export function wordTokens(
  word: Pick<Word, 'word' | 'ligaturePositions'>,
): string[] {
  return word.ligaturePositions === undefined
    ? [...word.word]
    : fromCaps(word.word, word.ligaturePositions);
}

export function displayCaps(tokens: readonly string[]): string {
  return tokens.map((token) => (token === 'և' ? 'ԵՎ' : token)).join('');
}

export function promptLetters(
  letters: readonly string[],
  caseMode: CaseMode,
): string[] {
  return [
    ...new Set(
      letters.flatMap((letter) =>
        letter === 'և' && caseMode === 'caps' ? ['Ե', 'Վ'] : [letter],
      ),
    ),
  ];
}

function pronunciationUnitsForLetters(letters: string[]): PronunciationUnit[] {
  const units: PronunciationUnit[] = [];
  for (let i = 0; i < letters.length; i++) {
    if (letters[i] === 'Ո' && letters[i + 1] === 'Ւ') {
      units.push({ source: 'ՈՒ', latin: 'u', cyrillic: 'у' });
      i++;
      continue;
    }
    const token = letters[i] ?? '',
      letter = alphabet.get(token);
    if (!letter) throw new Error(`Unsupported letter: ${token}`);
    let latin = letter.readingLatin[0],
      cyrillic = letter.readingCyrillic[0];
    if (i === 0 && token === 'Ե') {
      latin = 'ye';
      cyrillic = 'е';
    }
    if (i === 0 && token === 'և') {
      latin = 'yev';
      cyrillic = 'ев';
    }
    if (i === 0 && token === 'Ո' && letters[1] !== 'Վ') {
      latin = 'vo';
      cyrillic = 'во';
    }
    units.push({ source: token, latin, cyrillic });
  }
  return units;
}

export function pronunciationUnits(
  input: string,
  ligaturePositions?: number[],
): PronunciationUnit[] {
  return pronunciationUnitsForLetters(
    spelling(input, ligaturePositions).letters,
  );
}

export function deriveWord(input: string, ligaturePositions?: number[]): Word {
  const {
      word,
      letters,
      ligaturePositions: positions,
    } = spelling(input, ligaturePositions),
    units = pronunciationUnitsForLetters(letters),
    readingLatin = units.map((unit) => unit.latin).join('');
  return {
    id: `hy-${letters.map((letter) => letter.charCodeAt(0).toString(16)).join('-')}`,
    word,
    ...(positions === undefined ? {} : { ligaturePositions: positions }),
    readingLatin,
    acceptedLatin: [readingLatin],
    acceptedCyrillic: [units.map((unit) => unit.cyrillic).join('')],
    letters,
    uniqueLetters: [...new Set(letters)],
    length: letters.length,
    units,
    categories: [],
    tags: [],
    transliterationVersion: TRANSLITERATION_VERSION,
  };
}
