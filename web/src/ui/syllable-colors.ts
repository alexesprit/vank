import { syllabify, syllabifyWithSchwa } from 'vankatum';
import type { SyllableColorThreshold } from '../core/settings.ts';

export function splitSyllables(word: string) {
  const displayed = [...word];
  let index = 0;
  let aligned = true;
  const syllables = syllabifyWithSchwa(
    word.toLocaleLowerCase('hy').replaceAll('եվ', 'և'),
  ).map((syllable) => {
    let part = '';
    for (const letter of syllable) {
      const current = displayed[index];
      if (current?.toLocaleLowerCase('hy') === letter) {
        part += current;
        index += 1;
      } else if (
        letter === 'և' &&
        displayed
          .slice(index, index + 2)
          .join('')
          .toLocaleLowerCase('hy') === 'եվ'
      ) {
        part += displayed.slice(index, index + 2).join('');
        index += 2;
      } else if (letter !== 'ը') aligned = false;
    }
    return part;
  });
  return aligned && index === displayed.length && syllables.every(Boolean)
    ? syllables
    : syllabify(word, { leftmin: 0, rightmin: 0 });
}

export function coloredSyllables(
  word: string,
  threshold: SyllableColorThreshold,
) {
  if (!threshold) return [];
  const syllables = splitSyllables(word);
  return syllables.length >= threshold ? syllables : [];
}

export function renderSyllables(
  element: HTMLElement,
  word: string,
  threshold: SyllableColorThreshold,
) {
  const syllables = coloredSyllables(word, threshold);
  element.classList.toggle('syllable-word', syllables.length > 0);
  if (!syllables.length) {
    element.textContent = word;
    return;
  }
  element.replaceChildren(
    ...syllables.map((syllable) => {
      const span = document.createElement('span');
      span.className = 'syllable';
      span.textContent = syllable;
      return span;
    }),
  );
}
