import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { deriveMetadata, mergeSources } from '../builder/src/pipeline';
import { curatedSource } from '../builder/src/sources/curated';
import { ALPHABET, deriveWord } from '../shared/armenian';
import { parseDictionary } from '../shared/schema';
import type { LearnerState } from '../shared/types';
import { completeAttempt } from '../web/src/core/session';
import { FONTS } from '../web/src/core/settings';
import { openRepository } from '../web/src/storage/repository';
import { createTrainer } from '../web/src/trainer';

const recognizable = (word: string) => ({
  ...deriveWord(word),
  familiarity: { ru: 1 },
  loanwordScore: 1,
});

function practicedState(attempts: number): LearnerState {
  const word = recognizable('ՄԱՄԱ');
  let state: LearnerState = { letters: {}, words: {}, recent: [] };
  for (let index = 0; index < attempts; index++)
    state = completeAttempt(
      state,
      { word, phase: 'bootstrap' },
      word.readingLatin,
      false,
      'practice',
      index,
      index + 1,
      `practice-${index}`,
    ).state;
  return state;
}

it('validates the runtime dictionary and covers every written Armenian letter repeatedly', () => {
  const dictionary = parseDictionary(
    JSON.parse(readFileSync('web/data/words.json', 'utf8')),
  );
  expect(dictionary.words.length).toBeGreaterThanOrEqual(50);
  for (const letter of ALPHABET)
    expect(
      dictionary.words.filter((w) => w.uniqueLetters.includes(letter.upper))
        .length,
      letter.upper,
    ).toBeGreaterThanOrEqual(2);
});
it('submits once, saves before advancing, restores progress and retains stable client ID', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const words = ['ՄԱՄԱ', 'ՆԱՆԱ', 'ՍԱ', 'ՄԱՍ'].map(recognizable);
  const trainer = await createTrainer(words, repo);
  const first = trainer.current.word;
  await Promise.all([
    trainer.submit(first.readingLatin),
    trainer.submit(first.readingLatin),
  ]);
  expect(trainer.result?.correct).toBe(true);
  expect(trainer.state.recent).toHaveLength(1);
  const clientId = trainer.state.recent[0].clientId;
  await trainer.next();
  expect(trainer.current.word.id).not.toBe(first.id);
  const reloaded = await createTrainer(words, repo);
  expect(reloaded.state.recent).toHaveLength(1);
  await reloaded.submit('', true);
  expect(reloaded.state.recent[0].clientId).toBe(clientId);
  repo.close();
});
it('keeps the same prompt and unsaved result retryable after a storage failure', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  let fail = true;
  const trainer = await createTrainer(['ՄԱՄԱ', 'ՆԱՆԱ'].map(recognizable), {
    ...repo,
    saveAttempt: async (...args) => {
      if (fail) throw new Error('disk full');
      await repo.saveAttempt(...args);
    },
  });
  const id = trainer.current.word.id;
  await expect(trainer.submit('mama')).rejects.toThrow('disk full');
  expect(trainer.result).toBeUndefined();
  expect(trainer.state.recent).toHaveLength(0);
  await trainer.next();
  expect(trainer.current.word.id).toBe(id);
  fail = false;
  await trainer.submit('mama');
  expect(trainer.state.recent).toHaveLength(1);
  repo.close();
});

it('applies font settings immediately and records the font that loaded', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const loaded: string[] = [];
  const trainer = await createTrainer(
    ['ՄԱՄԱ', 'ՆԱՆԱ'].map(recognizable),
    { ...repo, loadState: async () => practicedState(40) },
    async (font) => {
      loaded.push(font.id);
      return font.id === 'noto-sans-armenian' ? font : FONTS[0];
    },
  );
  await trainer.setSettings({
    fonts: {
      mode: 'single',
      selected: 'noto-sans-armenian',
      enabled: FONTS.map((font) => font.id),
    },
    typography: {
      mode: 'single',
      selected: 'normal-italic',
      enabled: ['normal-italic'],
    },
  });
  expect(trainer.font.id).toBe('noto-sans-armenian');
  expect(trainer.presentation).toEqual({ caseMode: 'normal', italic: true });
  expect(loaded).toContain('noto-sans-armenian');
  await trainer.submit('', true);
  expect(trainer.state.recent[0].payload.fontId).toBe('noto-sans-armenian');
  expect(trainer.state.recent[0].payload.presentation).toEqual({
    caseMode: 'normal',
    fontId: 'noto-sans-armenian',
    italic: true,
  });
  expect(await repo.getSetting('app')).toEqual(trainer.settings);
  await trainer.next();
  await trainer.setSettings({
    ...trainer.settings,
    fonts: { ...trainer.settings.fonts, selected: 'noto-serif-armenian' },
  });
  expect(trainer.font.id).toBe('default');
  await trainer.submit('', true);
  expect(trainer.state.recent[0].payload.fontId).toBe('default');
  repo.close();
});

it('keeps runtime settings unchanged when persistence fails', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const trainer = await createTrainer(['ՄԱՄԱ', 'ՆԱՆԱ'].map(recognizable), {
    ...repo,
    setSetting: async (key, value) => {
      if (key === 'app') throw new Error('disk full');
      await repo.setSetting(key, value);
    },
  });
  await expect(
    trainer.setSettings({
      fonts: {
        mode: 'single',
        selected: 'noto-sans-armenian',
        enabled: FONTS.map((font) => font.id),
      },
    }),
  ).rejects.toThrow('disk full');
  expect(trainer.settings.fonts.selected).toBe('default');
  expect(trainer.font.id).toBe('default');
  repo.close();
});

it('does not let a pending next prompt overwrite newer font settings', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  let laterDefault: (font: (typeof FONTS)[number]) => void = () => {};
  let laterSerif: (font: (typeof FONTS)[number]) => void = () => {};
  let defaultLoads = 0;
  const trainer = await createTrainer(
    ['ՄԱՄԱ', 'ՆԱՆԱ'].map(recognizable),
    {
      ...repo,
      loadState: async () => practicedState(50),
      setSetting: async () => {},
    },
    (font) => {
      if (font.id === 'default' && defaultLoads++ > 0)
        return new Promise((resolve) => {
          laterDefault = resolve;
        });
      if (font.id === 'noto-serif-armenian')
        return new Promise((resolve) => {
          laterSerif = resolve;
        });
      return Promise.resolve(font);
    },
  );
  await trainer.submit('', true);
  const advancing = trainer.next();
  await Promise.resolve();
  const changing = trainer.setSettings({
    fonts: {
      mode: 'single',
      selected: 'noto-serif-armenian',
      enabled: FONTS.map((font) => font.id),
    },
  });
  await Promise.resolve();
  laterSerif(
    FONTS.find(
      (font) => font.id === 'noto-serif-armenian',
    ) as (typeof FONTS)[number],
  );
  await changing;
  laterDefault(FONTS[0]);
  await advancing;
  expect(trainer.font.id).toBe('noto-serif-armenian');
  repo.close();
});

it.each([
  ['seed', 500],
  ['runtime', 1000],
] as const)(
  'traverses the %s alphabet within %i attempts without repeat or introduction-limit violations',
  async (dataset, attempts) => {
    const { selectWord, unknownLetters } = await import(
      '../web/src/core/word-selector'
    );
    const { completeAttempt } = await import('../web/src/core/session');
    const words =
      dataset === 'seed'
        ? deriveMetadata(
            mergeSources(
              curatedSource(
                JSON.parse(readFileSync('builder/data/curated.json', 'utf8')),
              ),
            ).words,
          )
        : parseDictionary(
            JSON.parse(readFileSync('web/data/words.json', 'utf8')),
          ).words;
    let state: import('../shared/types').LearnerState = {
      letters: {},
      words: {},
      recent: [],
    };
    let previous = '';
    for (let i = 0; i < attempts; i++) {
      const choice = selectWord(words, state, i * 10000);
      expect(choice.word.id).not.toBe(previous);
      if (choice.phase !== 'bootstrap')
        expect(unknownLetters(choice.word, state).length).toBeLessThanOrEqual(
          1,
        );
      previous = choice.word.id;
      state = completeAttempt(
        state,
        choice,
        choice.word.readingLatin,
        false,
        'simulation',
        i * 10000,
        i * 10000 + 2000,
        String(i),
      ).state;
    }
    expect(Object.keys(state.letters)).toHaveLength(ALPHABET.length);
  },
);
