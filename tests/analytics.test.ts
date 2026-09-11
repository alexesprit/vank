import { describe, expect, it } from 'vitest';
import { doNotTrackEnabled } from '../web/src/analytics.ts';

describe('Do Not Track', () => {
  it('blocks the common browser signals', () => {
    expect(doNotTrackEnabled('1')).toBe(true);
    expect(doNotTrackEnabled('yes')).toBe(true);
    expect(doNotTrackEnabled('0')).toBe(false);
    expect(doNotTrackEnabled(null)).toBe(false);
  });
});
