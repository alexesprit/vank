import { expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  formatPrompt,
  parseSettings,
} from '../web/src/core/settings';
import {
  coloredSyllables,
  splitSyllables,
} from '../web/src/ui/syllable-colors';

it('splits Armenian words into letter-preserving syllables', () => {
  expect(splitSyllables('ԱՇԱԿԵՐՏ')).toEqual(['Ա', 'ՇԱ', 'ԿԵՐՏ']);
  expect(splitSyllables('ԿԱՆԳՆԵԼ')).toEqual(['ԿԱՆԳ', 'ՆԵԼ']);
  expect(splitSyllables('ԲՈՒՐԺՈՒԱԿԱՆ')).toEqual(['ԲՈՒՐ', 'ԺՈՒ', 'Ա', 'ԿԱՆ']);
});

it('counts hidden schwa syllables without changing the displayed spelling', () => {
  expect(splitSyllables('ԳՐԵԼ')).toEqual(['Գ', 'ՐԵԼ']);
  expect(splitSyllables('ՍԿՍԵԼ')).toEqual(['ՍԿ', 'ՍԵԼ']);
  expect(splitSyllables('ԸՄԲՌՆԵԼ')).toEqual(['ԸՄ', 'ԲՌ', 'ՆԵԼ']);
});

it('keeps syllable boundaries consistent across typography cases', () => {
  expect(splitSyllables(formatPrompt('ԵՐԵՎԱՆ', 'caps'))).toEqual([
    'Ե',
    'ՐԵՎ',
    'ԱՆ',
  ]);
  expect(splitSyllables(formatPrompt('ԵՐԵՎԱՆ', 'normal'))).toEqual([
    'Ե',
    'րև',
    'ան',
  ]);
  expect(splitSyllables(formatPrompt('ԵՐԵՎԱՆ', 'lower'))).toEqual([
    'ե',
    'րև',
    'ան',
  ]);
});

it('colors only words meeting the selected syllable threshold', () => {
  expect(coloredSyllables('ՄԱՄԱ', 0)).toEqual([]);
  expect(coloredSyllables('ՄԱՄԱ', 2)).toEqual(['ՄԱ', 'ՄԱ']);
  expect(coloredSyllables('ՄԱՄԱ', 3)).toEqual([]);
  expect(coloredSyllables('ԲՈՒՐԺՈՒԱԿԱՆ', 4)).toEqual([
    'ԲՈՒՐ',
    'ԺՈՒ',
    'Ա',
    'ԿԱՆ',
  ]);
});

it('defaults the threshold off and migrates the old checkbox setting', () => {
  expect(DEFAULT_SETTINGS.syllableColors).toBe(0);
  expect(parseSettings(DEFAULT_SETTINGS).syllableColors).toBe(0);
  expect(
    parseSettings({ ...DEFAULT_SETTINGS, syllableColors: true }).syllableColors,
  ).toBe(2);
  expect(
    parseSettings({ ...DEFAULT_SETTINGS, syllableColors: 3 }).syllableColors,
  ).toBe(3);
  expect(
    parseSettings({ ...DEFAULT_SETTINGS, syllableColors: 1 }).syllableColors,
  ).toBe(0);
});
