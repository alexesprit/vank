import { expect, it } from 'vitest';
import { deriveWord } from '../shared/armenian';
import type { LearnerState } from '../shared/types';
import { completeAttempt, progress } from '../web/src/core/session';
import {
  availableTypography,
  DEFAULT_PRESENTATION,
  DEFAULT_SETTINGS,
  formatPrompt,
  parseSettings,
  selectTypography,
  TYPOGRAPHY_MODES,
} from '../web/src/core/settings';
import { fontAlphabetSamples } from '../web/src/ui/debug-view';

const empty = (): LearnerState => ({ letters: {}, words: {}, recent: [] });

it('formats supported Armenian case modes without changing the canonical word', () => {
  const word = deriveWord('ԵՐԵՎԱՆ');
  expect(formatPrompt(word, 'caps')).toBe('ԵՐԵՎԱՆ');
  expect(formatPrompt(word, 'normal')).toBe('Երեվան');
  expect(formatPrompt(word, 'lower')).toBe('երեվան');
  expect(formatPrompt(word.word, 'lower')).toBe('երեվան');
  expect(word.word).toBe('ԵՐԵՎԱՆ');
  expect(formatPrompt('123', 'lower')).toBe('123');
});

it('formats explicit և differently from separate ե + վ in all case modes', () => {
  const ligature = deriveWord('բարև'),
    separate = deriveWord('բարեվ'),
    initialLigature = deriveWord('ևրան');

  expect(formatPrompt(ligature, 'lower')).toBe('բարև');
  expect(formatPrompt(ligature, 'normal')).toBe('Բարև');
  expect(formatPrompt(ligature, 'caps')).toBe('ԲԱՐԵՎ');
  expect(formatPrompt(separate, 'lower')).toBe('բարեվ');
  expect(formatPrompt(separate, 'normal')).toBe('Բարեվ');
  expect(formatPrompt(separate, 'caps')).toBe('ԲԱՐԵՎ');
  expect(formatPrompt(initialLigature, 'lower')).toBe('ևրան');
  expect(formatPrompt(initialLigature, 'normal')).toBe('Եվրան');
  expect(formatPrompt(initialLigature, 'caps')).toBe('ԵՎՐԱՆ');
});

it('shows ԵՎ only in the CAPS font sample and one և in lowercase', () => {
  const [caps, lowercase] = fontAlphabetSamples();

  expect(caps.endsWith('ԵՎ')).toBe(true);
  expect(caps).not.toContain('և');
  expect([...lowercase].filter((letter) => letter === 'և')).toHaveLength(1);
});

it('defaults to CAPS upright and selects or rotates enabled typography modes', () => {
  expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(parseSettings({ fonts: DEFAULT_SETTINGS.fonts }).typography).toEqual(
    DEFAULT_SETTINGS.typography,
  );
  expect(availableTypography(39).every((mode) => !mode.italic)).toBe(true);
  expect(availableTypography(40)).toEqual(TYPOGRAPHY_MODES);
  expect(selectTypography(DEFAULT_SETTINGS, 0)).toEqual(DEFAULT_PRESENTATION);
  expect(
    selectTypography(
      {
        ...DEFAULT_SETTINGS,
        typography: {
          mode: 'single',
          selected: 'normal-italic',
          enabled: TYPOGRAPHY_MODES.map((mode) => mode.id),
        },
      },
      40,
      () => 0,
    ),
  ).toMatchObject({ caseMode: 'normal', italic: true });
  expect(
    selectTypography(
      {
        ...DEFAULT_SETTINGS,
        typography: {
          mode: 'rotate',
          selected: 'caps',
          enabled: ['caps', 'lower-italic'],
        },
      },
      40,
      () => 0.99,
    ),
  ).toMatchObject({ caseMode: 'lower', italic: true });
  expect(
    selectTypography(
      {
        ...DEFAULT_SETTINGS,
        typography: {
          mode: 'single',
          selected: 'normal-italic',
          enabled: ['normal-italic'],
        },
      },
      39,
    ),
  ).toEqual(DEFAULT_PRESENTATION);
});

it('records presentation metadata and compares progress without splitting letter scores', () => {
  const word = deriveWord('ՄԱՄԱ');
  const first = completeAttempt(
    empty(),
    { word, phase: 'bootstrap' },
    'mama',
    false,
    'client',
    1,
    2,
    'caps',
  );
  const second = completeAttempt(
    first.state,
    { word, phase: 'bootstrap' },
    '',
    true,
    'client',
    3,
    4,
    'normal-italic',
    'default',
    { caseMode: 'normal', italic: true },
  );
  expect(second.attempt.payload.presentation).toEqual({
    caseMode: 'normal',
    fontId: 'default',
    italic: true,
  });
  expect(second.state.words[word.id].attempts).toBe(2);
  expect(Object.keys(second.state.letters)).toEqual(['Մ', 'Ա']);
  expect(progress(second.state).typographyStats).toEqual([
    { caseMode: 'normal', italic: true, attempts: 1, accuracy: 0 },
    { caseMode: 'caps', italic: false, attempts: 1, accuracy: 1 },
  ]);
});
