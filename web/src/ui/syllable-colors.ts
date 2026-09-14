import { syllabify, syllabifyWithSchwa } from 'vankatum';
import { wordTokens } from '../../../shared/armenian.ts';
import type { CaseMode, Word } from '../../../shared/types.ts';
import {
  formatPrompt,
  promptParts,
  type SyllableColorThreshold,
} from '../core/settings.ts';

export function splitSyllables(
  word: string | Word,
  caseMode: CaseMode = 'caps',
) {
  const tokenized = typeof word !== 'string',
    display = tokenized ? formatPrompt(word, caseMode) : word,
    tokens = tokenized ? wordTokens(word) : [...word],
    parts = tokenized ? promptParts(word, caseMode) : [...display],
    logical = tokens
      .map((token) => (token === 'և' ? token : token.toLocaleLowerCase('hy')))
      .join('');
  let index = 0,
    aligned = true;
  const syllables = syllabifyWithSchwa(logical).map((syllable) => {
    let part = '';
    for (const letter of syllable) {
      const current = tokens[index];
      if (current?.toLocaleLowerCase('hy') === letter) {
        part += parts[index] ?? '';
        index++;
      } else if (letter !== 'ը') aligned = false;
    }
    return part;
  });
  if (aligned && index === tokens.length && syllables.every(Boolean))
    return syllables;
  return tokenized
    ? [display]
    : syllabify(display, { leftmin: 0, rightmin: 0 });
}

export function coloredSyllables(
  word: string | Word,
  threshold: SyllableColorThreshold,
  caseMode: CaseMode = 'caps',
) {
  if (!threshold) return [];
  const syllables = splitSyllables(word, caseMode);
  return syllables.length >= threshold ? syllables : [];
}

export function renderSyllables(
  element: HTMLElement,
  word: string | Word,
  threshold: SyllableColorThreshold,
  caseMode: CaseMode = 'caps',
) {
  const syllables = coloredSyllables(word, threshold, caseMode),
    display = typeof word === 'string' ? word : formatPrompt(word, caseMode);
  element.classList.toggle('syllable-word', syllables.length > 0);
  if (!syllables.length) {
    element.textContent = display;
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
