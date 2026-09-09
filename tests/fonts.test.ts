import { expect, it } from 'vitest';
import { deriveWord } from '../shared/armenian';
import type { LearnerState } from '../shared/types';
import { completeAttempt, progress } from '../web/src/core/session';
import {
  availableFonts,
  DEFAULT_SETTINGS,
  parseSettings,
  selectFont,
} from '../web/src/core/settings';

const empty = (): LearnerState => ({ letters: {}, words: {}, recent: [] });

it('validates persisted settings and progressively unlocks configured fonts', () => {
  expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(
    parseSettings({ fonts: { mode: 'single', selected: 'missing' } }),
  ).toEqual(DEFAULT_SETTINGS);
  expect(availableFonts(0).map((font) => font.id)).toEqual(['default']);
  expect(availableFonts(20).map((font) => font.id)).toEqual([
    'default',
    'noto-sans-armenian',
    'google-sans',
  ]);
  expect(availableFonts(50).map((font) => font.id)).toEqual([
    'default',
    'noto-sans-armenian',
    'google-sans',
    'noto-serif-armenian',
  ]);
  expect(availableFonts(80).map((font) => font.id)).toEqual([
    'default',
    'noto-sans-armenian',
    'google-sans',
    'noto-serif-armenian',
    'iosevka-charon',
    'handjet',
  ]);
});

it('rotates only through enabled and unlocked fonts', () => {
  const settings = {
    fonts: {
      mode: 'rotate' as const,
      selected: 'default',
      enabled: ['default', 'noto-sans-armenian', 'noto-serif-armenian'],
    },
  };
  expect(selectFont(settings, 20, () => 0.99).id).toBe('noto-sans-armenian');
  expect(selectFont(settings, 50, () => 0.99).id).toBe('noto-serif-armenian');
  expect(
    selectFont(
      {
        ...settings,
        fonts: { ...settings.fonts, mode: 'single', selected: 'handjet' },
      },
      50,
    ).id,
  ).toBe('default');
  expect(
    selectFont(
      {
        ...settings,
        fonts: { ...settings.fonts, mode: 'single', selected: 'handjet' },
      },
      80,
    ).id,
  ).toBe('handjet');
});

it('records the displayed font and reports font-specific weak letters', () => {
  const word = deriveWord('ՄԱՄԱ');
  let state = empty();
  for (let index = 0; index < 8; index++)
    state = completeAttempt(
      state,
      { word, phase: 'bootstrap' },
      'mama',
      false,
      'client',
      index,
      index + 1,
      `default-${index}`,
      'default',
    ).state;
  const serif = completeAttempt(
    state,
    { word, phase: 'bootstrap' },
    '',
    true,
    'client',
    10,
    11,
    'serif',
    'noto-serif-armenian',
  );
  expect(serif.attempt.payload.fontId).toBe('noto-serif-armenian');
  expect(progress(serif.state).fontStats).toContainEqual(
    expect.objectContaining({
      fontId: 'noto-serif-armenian',
      attempts: 1,
      weakLetters: ['Մ', 'Ա'],
    }),
  );
});
