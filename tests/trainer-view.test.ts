import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveWord } from '../shared/armenian';
import type { AttemptEvent } from '../shared/types.ts';
import { evaluate } from '../web/src/core/answer-checker';
import type { Trainer } from '../web/src/trainer.ts';
import { commonMixups } from '../web/src/ui/stats-view';
import {
  displayMappingUnits,
  formatMappingSource,
  formatMistakes,
  mountIntro,
} from '../web/src/ui/trainer-view';

function fakeElement() {
  const listeners = new Map<string, EventListener>();
  return {
    hidden: true,
    checked: false,
    disabled: false,
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, listener);
    },
    click() {
      listeners.get('click')?.(new Event('click'));
    },
    close: vi.fn(),
    showModal: vi.fn(),
  };
}

function setupIntro() {
  const elements = Object.fromEntries(
    [
      'intro-dialog',
      'intro-quick-settings',
      'intro-analytics',
      'intro-metadata-hints-setting',
      'intro-analytics-setting',
      'intro-analytics-dnt',
      'help-open',
      'intro-close',
      'intro-start',
    ].map((id) => [id, fakeElement()]),
  ) as Record<string, ReturnType<typeof fakeElement>>;
  vi.stubGlobal('document', {
    getElementById: (id: string) => elements[id],
  });
  vi.stubGlobal('navigator', { doNotTrack: undefined });

  const trainer = {
    introShown: false,
    settings: { analytics: false, metadataHints: false },
    setSettings: vi.fn(async (_settings: Trainer['settings']) => {}),
    markIntroShown: vi.fn(async () => {}),
    pauseFlash: vi.fn(),
    resumeFlash: vi.fn(),
  } as unknown as Trainer;
  const startAnalytics = vi.fn();
  mountIntro(trainer, vi.fn(), vi.fn(), startAnalytics);
  return { elements, trainer, startAnalytics };
}

afterEach(() => vi.unstubAllGlobals());

describe('intro analytics consent', () => {
  it('starts checked even when saved analytics are off', () => {
    const { elements, trainer } = setupIntro();

    expect(trainer.settings.analytics).toBe(false);
    expect(elements['intro-analytics-setting']?.checked).toBe(true);
  });

  it('saves the checked value only when starting practice', async () => {
    const { elements, trainer, startAnalytics } = setupIntro();

    elements['intro-start']?.click();
    await Promise.resolve();

    expect(trainer.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ analytics: true }),
    );
    expect(startAnalytics).toHaveBeenCalledOnce();
  });

  it('keeps analytics off when the intro is dismissed', () => {
    const { elements, trainer } = setupIntro();

    elements['intro-close']?.click();

    expect(trainer.setSettings).not.toHaveBeenCalled();
    expect(trainer.settings.analytics).toBe(false);
  });

  it('saves an unchecked choice when starting practice', async () => {
    const { elements, trainer } = setupIntro();
    const checkbox = elements['intro-analytics-setting'];
    if (checkbox) checkbox.checked = false;

    elements['intro-start']?.click();
    await Promise.resolve();

    expect(trainer.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ analytics: false }),
    );
  });
});

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

  it('ignores mix-ups outside the latest 50 attempts', () => {
    const recent = Array.from({ length: 50 }, () => readingAttempt('ԿԻ', 'ki'));
    const older = Array.from({ length: 3 }, () => readingAttempt('ԿԻ', 'ii'));

    expect(commonMixups([...recent, ...older])).toEqual([]);
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
