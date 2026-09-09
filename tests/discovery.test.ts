import { expect, it } from 'vitest';
import { parseDiscovery } from '../builder/src/discovery';
it('accepts only source-attested IDs with explicit recognition hypotheses', () => {
  expect(parseDiscovery({ items: [{ id: 'a', recognizableAs: 'банк', purpose: 'familiar' }] }, ['a', 'b'])).toHaveLength(1);
  for (const items of [
    [{ id: 'invented', recognizableAs: 'банк', purpose: 'familiar' }],
    [{ id: 'a', recognizableAs: '', purpose: 'familiar' }],
    [{ id: 'a', recognizableAs: 'банк', purpose: 'other' }],
    [{ id: 'a', recognizableAs: 'банк', purpose: 'familiar' }, { id: 'a', recognizableAs: 'банк', purpose: 'familiar' }],
  ]) expect(() => parseDiscovery({ items }, ['a'])).toThrow();
});
