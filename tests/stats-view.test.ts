import { describe, expect, it } from 'vitest';
import { alphabetLetterText } from '../web/src/ui/stats-view';

describe('alphabet chart labels', () => {
  it('shows the lowercase ligature alone while retaining paired case for other letters', () => {
    expect(alphabetLetterText('և', 'և')).toBe('և');
    expect(alphabetLetterText('Ե', 'ե')).toBe('Եե');
  });
});
