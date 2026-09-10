import { beforeAll, expect, it } from 'vitest';
import { deriveWord } from '../shared/armenian';
import type { LearnerState } from '../shared/types';
import {
  hasMetadataHints,
  metadataHintLabels,
  metadataHints,
} from '../web/src/core/metadata-hints';
import { completeAttempt } from '../web/src/core/session';
import { DEFAULT_SETTINGS, parseSettings } from '../web/src/core/settings';
import { initializeI18n } from '../web/src/i18n';

const empty = (): LearnerState => ({ letters: {}, words: {}, recent: [] });

beforeAll(() => initializeI18n('en', []));

it('normalizes and deduplicates category and tag hints in source order', () => {
  const word = {
    categories: ['food', 'restaurant'],
    tags: ['food', 'proper_name', '  '],
  };
  expect(metadataHints(word)).toEqual([
    { key: 'metadata.categories.food', fallback: 'Food' },
    { key: 'metadata.categories.restaurant', fallback: 'Restaurant' },
    { key: 'metadata.tags.proper-name', fallback: 'Proper Name' },
  ]);
  expect(
    metadataHints({ categories: [], tags: ['loanword', 'noun', 'Europe'] }),
  ).toEqual([{ key: 'metadata.tags.loanword', fallback: 'Loanword' }]);
  expect(
    metadataHintLabels(
      { categories: ['medical'], tags: ['medicine', 'sport'] },
      (key, fallback) =>
        key.endsWith('.medical') || key.endsWith('.medicine')
          ? 'Медицина'
          : fallback,
    ),
  ).toEqual(['Медицина', 'Sport']);
  expect(
    metadataHintLabels(word, (key, fallback) =>
      key === 'metadata.tags.proper-name' ? 'Proper name' : fallback,
    ),
  ).toEqual(['Food', 'Restaurant', 'Proper name']);
  expect(hasMetadataHints(word)).toBe(true);
  expect(hasMetadataHints({ categories: [], tags: [] })).toBe(false);
});

it('persists the opt-in setting and records rendered visibility only when supplied', () => {
  expect(
    parseSettings({ ...DEFAULT_SETTINGS, metadataHints: true }).metadataHints,
  ).toBe(true);
  const word = deriveWord('ՄԱՄԱ');
  const shown = completeAttempt(
    empty(),
    { word, phase: 'bootstrap' },
    'mama',
    false,
    'client',
    1,
    2,
    'shown',
    'default',
    { caseMode: 'caps', italic: false },
    true,
  ).attempt;
  const legacy = completeAttempt(
    empty(),
    { word, phase: 'bootstrap' },
    'mama',
    false,
    'client',
    1,
    2,
    'legacy',
  ).attempt;
  expect(shown.payload.metadataHintsShown).toBe(true);
  expect(legacy.payload).not.toHaveProperty('metadataHintsShown');
});
