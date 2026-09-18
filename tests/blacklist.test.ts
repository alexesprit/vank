import { describe, expect, it } from 'vitest';
import {
  applyWordBlacklist,
  parseWordBlacklist,
} from '../builder/src/blacklist';
import { deriveMetadata, mergeSources } from '../builder/src/pipeline';
import { curatedSource } from '../builder/src/sources/curated';

describe('word blacklist', () => {
  it('normalizes Armenian entries and blocks only exact words', () => {
    const blacklist = parseWordBlacklist(['բլյատ', 'ՍԵՔՍ']);
    const words = deriveMetadata(
      mergeSources(curatedSource([{ word: 'բլյատ' }, { word: 'բարև' }])).words,
    );
    const result = applyWordBlacklist(words, blacklist);
    expect(result.blocked.map((word) => word.word)).toEqual(['բլյատ']);
    expect(result.words.map((word) => word.word)).toEqual(['բարև']);
    expect(() => parseWordBlacklist(['bad-word'])).toThrow(
      'must be Armenian words',
    );
  });
});
