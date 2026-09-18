import type { CaseMode, PronunciationUnit, Word } from './types.ts';

export const TRANSLITERATION_VERSION = 1;
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
] as const;
export const ALPHABET = [
  ...sounds.map(([upper, latin, cyrillic]) => ({
    upper,
    lower: upper.toLocaleLowerCase('hy'),
    readingLatin: [latin],
    readingCyrillic: [cyrillic],
  })),
  { upper: 'և', lower: 'և', readingLatin: ['ev'], readingCyrillic: ['ев'] },
];
const alphabet = new Map(ALPHABET.map((letter) => [letter.lower, letter]));
const armenianPattern = /^[ա-ֆև]+$/u;

export function normalizeArmenian(input: string): string {
  const word = input.normalize('NFC').trim().toLocaleLowerCase('hy');
  if (!armenianPattern.test(word))
    throw new Error(`Invalid Armenian word: ${input}`);
  return word;
}

export function wordTokens(word: Pick<Word, 'word'>): string[] {
  return [...word.word];
}

export function promptLetters(
  letters: readonly string[],
  caseMode: CaseMode,
): string[] {
  return [
    ...new Set(
      letters.flatMap((letter) =>
        letter === 'և'
          ? caseMode === 'caps'
            ? ['Ե', 'Վ']
            : ['և']
          : [
              caseMode === 'lower'
                ? letter.toLocaleLowerCase('hy')
                : letter.toLocaleUpperCase('hy'),
            ],
      ),
    ),
  ];
}

function pronunciationUnitsForLetters(letters: string[]): PronunciationUnit[] {
  const units: PronunciationUnit[] = [];
  for (let i = 0; i < letters.length; i++) {
    if (letters[i] === 'ո' && letters[i + 1] === 'ւ') {
      units.push({ source: 'ՈՒ', latin: 'u', cyrillic: 'у' });
      i++;
      continue;
    }
    const token = letters[i] ?? '',
      letter = alphabet.get(token);
    if (!letter) throw new Error(`Unsupported letter: ${token}`);
    let latin = letter.readingLatin[0],
      cyrillic = letter.readingCyrillic[0];
    if (i === 0 && token === 'ե') {
      latin = 'ye';
      cyrillic = 'е';
    }
    if (i === 0 && token === 'և') {
      latin = 'yev';
      cyrillic = 'ев';
    }
    if (i === 0 && token === 'ո' && letters[1] !== 'վ') {
      latin = 'vo';
      cyrillic = 'во';
    }
    units.push({
      source: token === 'և' ? 'և' : token.toLocaleUpperCase('hy'),
      latin,
      cyrillic,
    });
  }
  return units;
}

export function pronunciationUnits(input: string): PronunciationUnit[] {
  return pronunciationUnitsForLetters([...normalizeArmenian(input)]);
}

export function deriveWord(input: string): Word {
  const word = normalizeArmenian(input),
    letters = [...word],
    units = pronunciationUnitsForLetters(letters);
  const readingLatin = units.map((unit) => unit.latin).join('');
  const idLetters = letters.map((letter) =>
    letter === 'և' ? letter : letter.toLocaleUpperCase('hy'),
  );
  return {
    id: `hy-${idLetters.map((letter) => letter.charCodeAt(0).toString(16)).join('-')}`,
    word,
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
