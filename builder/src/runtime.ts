import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Dictionary, Word } from '../../shared/types.ts';

type RuntimeDictionary = Omit<Dictionary, 'words'> & {
  words: Omit<Word, 'letters' | 'uniqueLetters' | 'length'>[];
};

export function runtimeDictionary(dictionary: Dictionary): RuntimeDictionary {
  return {
    version: dictionary.version,
    schemaVersion: dictionary.schemaVersion,
    generatedAt: dictionary.generatedAt,
    words: dictionary.words.map((word) => ({
      id: word.id,
      word: word.word,
      readingLatin: word.readingLatin,
      acceptedLatin: word.acceptedLatin,
      acceptedCyrillic: word.acceptedCyrillic,
      units: word.units,
      meaning: word.meaning,
      familiarity: word.familiarity,
      frequencyScore: word.frequencyScore,
      loanwordScore: word.loanwordScore,
      visualDifficulty: word.visualDifficulty,
      readingDifficulty: word.readingDifficulty,
      usefulnessScore: word.usefulnessScore,
      categories: word.categories,
      tags: word.tags,
    })),
  };
}

export async function writeRuntimeDictionary(
  path: string,
  dictionary: Dictionary,
) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(runtimeDictionary(dictionary)));
  await rename(temp, path);
}
