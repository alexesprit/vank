import { describe, expect, it } from 'vitest';
import { deriveWord } from '../shared/armenian';
import type { LearnerState } from '../shared/types';
import { completeAttempt } from '../web/src/core/session';
import { alphabetLetterText, recentProgress } from '../web/src/ui/stats-view';

const empty = (): LearnerState => ({ letters: {}, words: {}, recent: [] });

describe('alphabet chart labels', () => {
  it('shows the lowercase ligature alone while retaining paired case for other letters', () => {
    expect(alphabetLetterText('և', 'և')).toBe('և');
    expect(alphabetLetterText('Ե', 'ե')).toBe('Եե');
  });
});

it('uses 50 ordinary attempts when unrevealed flashes are mixed into recent history', () => {
  const word = deriveWord('ԱԲ');
  let state = empty();
  for (let index = 0; index < 50; index++) {
    const correct = index >= 25;
    state = completeAttempt(
      state,
      { word, phase: 'bootstrap' },
      correct ? word.readingLatin : '',
      false,
      'test',
      index * 2,
      index * 2 + 1,
      `ordinary-${index}`,
    ).state;
  }
  state = completeAttempt(
    state,
    { word, phase: 'bootstrap' },
    '',
    true,
    'test',
    101,
    102,
    'unrevealed-flash',
    'default',
    { caseMode: 'caps', italic: false },
    undefined,
    { exposureMs: 1_000, revealed: false },
  ).state;

  expect(recentProgress(state).accuracy).toBe(0.5);
});
