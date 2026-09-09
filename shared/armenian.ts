import type { PronunciationUnit, Word } from './types.ts';

export const TRANSLITERATION_VERSION = 1;
// Modern Eastern Armenian, reformed orthography. ASCII learner readings merge
// aspiration distinctions; they do not substitute Western consonant values.
const sounds = [
  ['Ա', 'a', 'а'], ['Բ', 'b', 'б'], ['Գ', 'g', 'г'], ['Դ', 'd', 'д'],
  ['Ե', 'e', 'е'], ['Զ', 'z', 'з'], ['Է', 'e', 'э'], ['Ը', 'y', 'ы'],
  ['Թ', 't', 'т'], ['Ժ', 'zh', 'ж'], ['Ի', 'i', 'и'], ['Լ', 'l', 'л'],
  ['Խ', 'kh', 'х'], ['Ծ', 'ts', 'ц'], ['Կ', 'k', 'к'], ['Հ', 'h', 'х'],
  ['Ձ', 'dz', 'дз'], ['Ղ', 'gh', 'г'], ['Ճ', 'ch', 'ч'], ['Մ', 'm', 'м'],
  ['Յ', 'y', 'й'], ['Ն', 'n', 'н'], ['Շ', 'sh', 'ш'], ['Ո', 'o', 'о'],
  ['Չ', 'ch', 'ч'], ['Պ', 'p', 'п'], ['Ջ', 'j', 'дж'], ['Ռ', 'r', 'р'],
  ['Ս', 's', 'с'], ['Վ', 'v', 'в'], ['Տ', 't', 'т'], ['Ր', 'r', 'р'],
  ['Ց', 'ts', 'ц'], ['Ւ', 'v', 'в'], ['Փ', 'p', 'п'], ['Ք', 'k', 'к'],
  ['Օ', 'o', 'о'], ['Ֆ', 'f', 'ф'],
];
export const ALPHABET = sounds.map(([upper, latin, cyrillic]) => ({
  upper, lower: upper.toLowerCase(), readingLatin: [latin], readingCyrillic: [cyrillic],
}));
const alphabet = new Map(ALPHABET.map(letter => [letter.upper, letter]));

export function normalizeArmenian(input: string): string {
  return input.normalize('NFC').trim().replaceAll('և', 'եվ').toUpperCase().replaceAll('ԵՒ', 'ԵՎ');
}
export function pronunciationUnits(input: string): PronunciationUnit[] {
  const word = normalizeArmenian(input);
  if (!/^[Ա-Ֆ]+$/u.test(word)) throw new Error(`Invalid Armenian word: ${input}`);
  const units: PronunciationUnit[] = [];
  for (let i = 0; i < word.length; i++) {
    if (word.slice(i, i + 2) === 'ՈՒ') {
      units.push({ source: 'ՈՒ', latin: 'u', cyrillic: 'у' }); i++; continue;
    }
    const letter = alphabet.get(word[i]);
    if (!letter) throw new Error(`Unsupported letter: ${word[i]}`);
    let latin = letter.readingLatin[0], cyrillic = letter.readingCyrillic[0];
    if (i === 0 && word[i] === 'Ե') { latin = 'ye'; cyrillic = 'е'; }
    if (i === 0 && word[i] === 'Ո' && word[1] !== 'Վ') { latin = 'vo'; cyrillic = 'во'; }
    units.push({ source: word[i], latin, cyrillic });
  }
  return units;
}
export function deriveWord(input: string): Word {
  const word = normalizeArmenian(input), units = pronunciationUnits(word);
  const letters = [...word];
  const readingLatin = units.map(u => u.latin).join('');
  return {
    id: `hy-${letters.map(l => l.codePointAt(0)!.toString(16)).join('-')}`,
    word, readingLatin, acceptedLatin: [readingLatin],
    acceptedCyrillic: [units.map(u => u.cyrillic).join('')],
    letters, uniqueLetters: [...new Set(letters)], length: letters.length, units,
    categories: [], tags: [], transliterationVersion: TRANSLITERATION_VERSION,
  };
}
