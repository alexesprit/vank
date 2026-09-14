import { describe, expect, it } from 'vitest';
import { deriveWord } from '../shared/armenian';
import type { AttemptEvent } from '../shared/types.ts';
import { evaluate } from '../web/src/core/answer-checker';
import { commonMixups } from '../web/src/ui/stats-view';
import {
  displayMappingUnits,
  formatMappingSource,
  formatMistakes,
} from '../web/src/ui/trainer-view';

const readingAttempt = (
  wordText: string,
  answer: string,
  skipped = false,
): AttemptEvent => {
  const word = deriveWord(wordText);
  const evaluation = evaluate(word, answer, skipped);
  return {
    id: `${word.id}-${answer}`,
    type: 'attempt.completed',
    clientId: 'test',
    timestamp: 0,
    schemaVersion: 1,
    payload: {
      wordId: word.id,
      answer,
      expected: evaluation.expected,
      correct: evaluation.correct,
      shownAt: 0,
      answeredAt: 0,
      evaluation,
      familiarity: 0,
      learnerLanguage: 'en',
      fontId: 'default',
    },
  };
};

describe('mapping typography', () => {
  it('formats letters using their prompt case and position', () => {
    expect(formatMappingSource('Ե', 0, 'normal')).toBe('Ե');
    expect(formatMappingSource('Ր', 1, 'normal')).toBe('ր');
    expect(formatMappingSource('Մ', 0, 'lower')).toBe('մ');
    expect(formatMappingSource('Մ', 0, 'caps')).toBe('Մ');
  });
});

describe('mistake summaries', () => {
  it('deduplicates repeated letter mappings while preserving order', () => {
    const evaluation = evaluate(deriveWord('ՋՆՋ'), 'а', true);

    expect(formatMistakes(evaluation.units)).toBe('Ջ → дж · Ն → н');
  });

  it('keeps the full mapping available when the answer is skipped', () => {
    const evaluation = evaluate(deriveWord('ՏԱՔՍԻ'), '', true);

    expect(formatMistakes(evaluation.units)).toBe(
      'Տ → t · Ա → a · Ք → k · Ս → s · Ի → i',
    );
  });

  it('uses Cyrillic for skipped mappings in the Russian locale', () => {
    const word = deriveWord('ՏԱՔՍԻ');
    const evaluation = evaluate(word, '', true);

    expect(formatMistakes(displayMappingUnits(word, evaluation, 'ru'))).toBe(
      'Տ → т · Ա → а · Ք → к · Ս → с · Ի → и',
    );
  });
});

describe('common letter mix-ups', () => {
  it('waits for three clear observations before showing a pair', () => {
    expect(
      commonMixups([readingAttempt('ԿԻ', 'ii'), readingAttempt('ԿԻ', 'ki')]),
    ).toEqual([]);
  });

  it('ranks clear single-letter substitutions and reports their rate', () => {
    const ambiguous = readingAttempt('ԿԻ', 'ii');
    ambiguous.payload.evaluation.status = 'ambiguous';

    expect(
      commonMixups([
        readingAttempt('ԿԻ', 'ii'),
        readingAttempt('ԿԻ', 'ki'),
        readingAttempt('ԿԻ', 'i'),
        readingAttempt('ԿԻ', '', true),
        ambiguous,
      ]),
    ).toEqual([
      { source: 'Կ', expected: 'k', actual: 'i', count: 1, total: 3 },
    ]);
  });
});
