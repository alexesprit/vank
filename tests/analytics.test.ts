import { describe, expect, it } from 'vitest';
import type { AttemptEvent } from '../shared/types.ts';
import {
  analyticsMode,
  answersSince,
  doNotTrackEnabled,
  submittedAnswerCount,
  unsentMilestones,
} from '../web/src/analytics.ts';

const attempt = (status: string) =>
  ({ payload: { evaluation: { status } } }) as AttemptEvent;

describe('Do Not Track', () => {
  it('blocks the common browser signals', () => {
    expect(doNotTrackEnabled('1')).toBe(true);
    expect(doNotTrackEnabled('yes')).toBe(true);
    expect(doNotTrackEnabled('0')).toBe(false);
    expect(doNotTrackEnabled(null)).toBe(false);
  });
});

describe('analytics consent', () => {
  it('uses the console locally and Umami in production only after opt-in', () => {
    expect(analyticsMode(true, false, '0')).toBe('console');
    expect(analyticsMode(true, true, '0')).toBe('umami');
    expect(analyticsMode(false, false, '0')).toBe('off');
    expect(analyticsMode(true, false, '1')).toBe('off');
  });
});

describe('practice milestone analytics', () => {
  it('counts submitted answers but excludes skips', () => {
    expect(
      submittedAnswerCount([
        attempt('correct'),
        attempt('incorrect'),
        attempt('unknown'),
      ]),
    ).toBe(2);
  });

  it('returns each reached milestone that has not been sent', () => {
    expect(unsentMilestones(0, [])).toEqual([]);
    expect(unsentMilestones(5, [])).toEqual([1, 5]);
    expect(unsentMilestones(50, [])).toEqual([1, 5, 10, 25, 50]);
    expect(unsentMilestones(24, [10])).toEqual([1, 5]);
    expect(unsentMilestones(50, [1, 10, 25])).toEqual([5, 50]);
  });

  it('counts only answers since analytics started', () => {
    expect(answersSince(50, 50)).toBe(0);
    expect(answersSince(50, 55)).toBe(5);
  });
});
