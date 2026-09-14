import { describe, expect, it } from 'vitest';
import { deriveWord } from '../shared/armenian.ts';
import type { AttemptEvent, LearnerState, Word } from '../shared/types.ts';
import { responseSpeed } from '../web/src/core/response-speed.ts';
import { completeAttempt } from '../web/src/core/session.ts';

const empty: LearnerState = { letters: {}, words: {}, recent: [] };
const word = (text: string, familiarity = 0.1): Word => ({
  ...deriveWord(text),
  familiarity: { ru: familiarity },
});

function attempt(
  target: Word,
  durationMs: number,
  answeredAt = 10_000,
  correct = true,
  skipped = false,
): AttemptEvent {
  return completeAttempt(
    empty,
    { word: target, phase: 'training' },
    correct ? target.readingLatin : skipped ? '' : 'wrong',
    skipped,
    'client',
    answeredAt - durationMs,
    answeredAt,
    `${target.id}-${answeredAt}`,
  ).attempt;
}

describe('response speed', () => {
  it('uses correct, uninterrupted responses under two minutes and normalizes by Armenian word length', () => {
    const mama = word('ՄԱՄԱ');
    const interrupted = attempt(mama, 5000);
    interrupted.payload.timingInterrupted = true;
    const attempts = [
      ...Array.from({ length: 5 }, (_, index) =>
        attempt(mama, 4000, 10_000 + index),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        attempt(word('ԱԲ'), 1000, 10_000 + index),
      ),
      attempt(mama, 50, 10_000, false),
      attempt(mama, 70, 10_000, false, true),
      interrupted,
      attempt(mama, 120_001),
    ];

    const stats = responseSpeed(attempts, 10_000);

    expect(stats.medianResponseMs).toBe(2500);
    expect(stats.medianMsPerLetter).toBe(750);
    expect(Object.keys(stats)).toEqual([
      'medianResponseMs',
      'medianMsPerLetter',
      'changePercent',
      'slowLetters',
      'findings',
    ]);
    expect(
      stats.slowLetters.find(({ letter }) => letter === 'Մ'),
    ).toMatchObject({
      medianMsPerLetter: 1000,
    });
  });

  it('normalizes the 30-day trend for different word lengths', () => {
    const now = 100 * 24 * 60 * 60 * 1000;
    const attempts = [
      ...Array.from({ length: 5 }, (_, index) =>
        attempt(word('ՄԱՄԱ'), 1000, now - (index + 1) * 24 * 60 * 60 * 1000),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        attempt(word('ԱԲ'), 1000, now - (31 + index) * 24 * 60 * 60 * 1000),
      ),
    ];

    expect(responseSpeed(attempts, now).changePercent).toBe(-50);
    expect(responseSpeed(attempts.slice(1), now).changePercent).toBeNull();
  });

  it('attributes an Armenian ligature to its visible letters in capital prompts', () => {
    const attempts = [
      ...Array.from({ length: 5 }, (_, index) =>
        attempt(word('բարև'), 4000, 10_000 + index),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        attempt(word('ԱԲ'), 500, 10_000 + index),
      ),
    ];
    const stats = responseSpeed(attempts, 10_000);

    // The ligature is rendered as two glyphs in CAPS, but stays one word letter.
    expect(stats.medianMsPerLetter).toBe(625);
    expect(stats.slowLetters.map(({ letter }) => letter)).toContain('Ե');
    expect(stats.slowLetters.map(({ letter }) => letter)).toContain('Վ');
  });

  it('compares medians across the latest and previous 30-day periods only with enough samples', () => {
    const now = 100 * 24 * 60 * 60 * 1000;
    const target = word('ԱԲ');
    const attempts = [
      ...Array.from({ length: 5 }, (_, index) =>
        attempt(target, 1000, now - (index + 1) * 24 * 60 * 60 * 1000),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        attempt(target, 2000, now - (31 + index) * 24 * 60 * 60 * 1000),
      ),
    ];

    expect(responseSpeed(attempts, now).changePercent).toBe(-50);
  });

  it('uses the latest 50 attempts for the summary but keeps the 30-day trend history', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 100 * day;
    const attempts = [
      ...Array.from({ length: 50 }, (_, index) =>
        attempt(word('ԱԲ'), 1000, now - index * 1000),
      ),
      ...Array.from({ length: 50 }, (_, index) =>
        attempt(word('ՄԱՄԱ'), 4000, now - (31 + (index % 29)) * day - index),
      ),
    ];

    const stats = responseSpeed(attempts, now);

    expect(stats.medianResponseMs).toBe(1000);
    expect(stats.medianMsPerLetter).toBe(500);
    expect(stats.changePercent).toBe(-50);
    expect(stats.slowLetters.map(({ letter }) => letter)).not.toContain('Մ');
  });

  it('reports only substantial group slowdowns with enough samples on both sides', () => {
    const target = word('ԱԲ');
    const attempts = [
      ...Array.from({ length: 8 }, (_, index) => {
        const sample = attempt(target, 2000, 10_000 + index);
        sample.payload.fontId = 'noto-serif-armenian';
        return sample;
      }),
      ...Array.from({ length: 8 }, (_, index) => {
        const sample = attempt(target, 1000, 20_000 + index);
        sample.payload.fontId = 'default';
        return sample;
      }),
    ];

    expect(responseSpeed(attempts, 30_000).findings).toContainEqual({
      dimension: 'font',
      key: 'noto-serif-armenian',
      changePercent: 100,
    });
  });

  it('suppresses group slowdowns with too few samples or a small difference', () => {
    const target = word('ԱԲ');
    const makeFontSamples = (
      count: number,
      durationMs: number,
      fontId: string,
    ) =>
      Array.from({ length: count }, (_, index) => {
        const sample = attempt(target, durationMs, 10_000 + index);
        sample.payload.fontId = fontId;
        return sample;
      });
    const sparse = [
      ...makeFontSamples(7, 2000, 'noto-serif-armenian'),
      ...makeFontSamples(8, 1000, 'default'),
    ];
    const close = [
      ...makeFontSamples(8, 1100, 'noto-serif-armenian'),
      ...makeFontSamples(8, 1000, 'default'),
    ];

    expect(responseSpeed(sparse, 30_000).findings).toEqual([]);
    expect(responseSpeed(close, 30_000).findings).toEqual([]);
  });
});
