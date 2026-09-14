import { expect, it } from 'vitest';
import { deriveWord } from '../shared/armenian';
import type { AttemptEvent, LearnerState } from '../shared/types';
import { completeAttempt, progress } from '../web/src/core/session';
import {
  availableFonts,
  DEFAULT_SETTINGS,
  parseSettings,
  selectFont,
} from '../web/src/core/settings';

const empty = (): LearnerState => ({ letters: {}, words: {}, recent: [] });

const fontAttempt = (
  id: string,
  fontId: string,
  correct: boolean,
  observation: number,
): AttemptEvent => ({
  id,
  type: 'attempt.completed',
  clientId: 'test',
  timestamp: 1,
  schemaVersion: 1,
  payload: {
    wordId: 'test',
    answer: '',
    expected: '',
    correct,
    shownAt: 0,
    answeredAt: 1,
    evaluation: {
      status: correct ? 'correct' : 'incorrect',
      correct,
      expected: '',
      normalizedAnswer: '',
      distance: 0,
      alignment: [],
      units: [
        {
          source: 'Մ',
          position: 0,
          expected: 'm',
          actual: correct ? 'm' : 'x',
          observation,
        },
      ],
    },
    familiarity: 0.5,
    learnerLanguage: 'ru',
    fontId,
    presentation: { caseMode: 'caps', fontId, italic: false },
  },
});

it('validates persisted settings and progressively unlocks configured fonts', () => {
  expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(DEFAULT_SETTINGS.fonts.selected).toBe('noto-sans-armenian');
  expect(
    parseSettings({ fonts: { mode: 'single', selected: 'missing' } }),
  ).toEqual(DEFAULT_SETTINGS);
  const migrated = parseSettings({
    ...DEFAULT_SETTINGS,
    analytics: true,
    language: 'en',
    fonts: {
      mode: 'rotate',
      selected: 'handjet',
      enabled: ['default', 'google-sans', 'handjet'],
    },
  });
  expect(migrated).toMatchObject({
    analytics: true,
    language: 'en',
    fonts: {
      mode: 'rotate',
      selected: 'noto-sans-armenian',
      enabled: ['noto-sans-armenian'],
    },
  });
  expect(availableFonts(0).map((font) => font.id)).toEqual([
    'noto-sans-armenian',
  ]);
  expect(availableFonts(20).map((font) => font.id)).toEqual([
    'noto-sans-armenian',
  ]);
  expect(availableFonts(50).map((font) => font.id)).toEqual([
    'noto-sans-armenian',
    'noto-serif-armenian',
  ]);
  expect(availableFonts(79).map((font) => font.id)).toEqual([
    'noto-sans-armenian',
    'noto-serif-armenian',
    'iosevka-charon',
  ]);
  expect(availableFonts(80).map((font) => font.id)).toEqual([
    'noto-sans-armenian',
    'noto-serif-armenian',
    'iosevka-charon',
    'mandys-sketch-extended',
  ]);
});

it('rotates only through enabled and unlocked fonts', () => {
  const settings = {
    fonts: {
      mode: 'rotate' as const,
      selected: 'noto-sans-armenian',
      enabled: ['noto-sans-armenian', 'noto-serif-armenian'],
    },
  };
  expect(selectFont(settings, 20, () => 0.99).id).toBe('noto-sans-armenian');
  expect(selectFont(settings, 50, () => 0.99).id).toBe('noto-serif-armenian');
  expect(
    selectFont(
      {
        ...settings,
        fonts: {
          ...settings.fonts,
          mode: 'single',
          selected: 'retired-font',
        },
      },
      50,
    ).id,
  ).toBe('noto-sans-armenian');
  expect(
    selectFont(
      {
        ...settings,
        fonts: {
          ...settings.fonts,
          mode: 'single',
          selected: 'retired-font',
        },
      },
      80,
    ).id,
  ).toBe('noto-sans-armenian');
});

it('records the displayed font and waits for a comparison sample', () => {
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
  expect(progress(serif.state).fontStats).toEqual([
    expect.objectContaining({
      fontId: 'noto-serif-armenian',
      attempts: 1,
      accuracy: 0,
      lowerAccuracyLetters: [],
    }),
  ]);
});

it('uses the latest 50 eligible font attempts and compares recent letter evidence', () => {
  const old = fontAttempt('old', 'noto-serif-armenian', true, 1);
  const hidden = fontAttempt('unrevealed', 'noto-serif-armenian', true, 1);
  hidden.payload.flashMode = true;
  hidden.payload.flashRevealed = false;
  const state = empty();
  state.recent = [
    hidden,
    ...Array.from({ length: 50 }, (_, index) =>
      fontAttempt(
        `recent-${index}`,
        index < 25 ? 'noto-sans-armenian' : 'noto-serif-armenian',
        index >= 25,
        index >= 25 ? 1 : 0,
      ),
    ),
    old,
  ];

  expect(progress(state).fontStats).toEqual([
    {
      fontId: 'noto-sans-armenian',
      attempts: 25,
      accuracy: 0,
      lowerAccuracyLetters: ['Մ'],
    },
    {
      fontId: 'noto-serif-armenian',
      attempts: 25,
      accuracy: 1,
      lowerAccuracyLetters: [],
    },
  ]);
});

it('requires three per-font observations before flagging a problem letter', () => {
  const state = empty();
  state.recent = [
    ...Array.from({ length: 2 }, (_, index) =>
      fontAttempt(`sans-${index}`, 'noto-sans-armenian', false, 0),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      fontAttempt(`serif-${index}`, 'noto-serif-armenian', true, 1),
    ),
  ];

  expect(progress(state).fontStats[0]?.lowerAccuracyLetters).toEqual([]);
});

it('includes an exact 20-point letter accuracy gap', () => {
  const state = empty();
  state.recent = [
    ...Array.from({ length: 5 }, (_, index) =>
      fontAttempt(
        `sans-${index}`,
        'noto-sans-armenian',
        index !== 0,
        index === 0 ? 0 : 1,
      ),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      fontAttempt(`serif-${index}`, 'noto-serif-armenian', true, 1),
    ),
  ];

  expect(progress(state).fontStats[0]?.lowerAccuracyLetters).toEqual(['Մ']);
});
