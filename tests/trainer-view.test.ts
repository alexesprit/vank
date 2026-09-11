import { describe, expect, it } from 'vitest';
import { deriveWord } from '../shared/armenian';
import { evaluate } from '../web/src/core/answer-checker';
import {
  displayMappingUnits,
  formatMistakes,
} from '../web/src/ui/trainer-view';

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
