import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { deriveMetadata, mergeSources } from '../builder/src/pipeline';
import { curatedSource } from '../builder/src/sources/curated';
import { ALPHABET, deriveWord } from '../shared/armenian';
import { parseDictionary } from '../shared/schema';
import type { Dictionary, LearnerState } from '../shared/types';
import { PRACTICE_MODES } from '../web/src/core/modes';
import { progress } from '../web/src/core/progress';
import { completeAttempt } from '../web/src/core/session';
import { DEFAULT_SETTINGS, FONTS } from '../web/src/core/settings';
import { createWordSelector } from '../web/src/core/word-selector';
import { openRepository } from '../web/src/storage/repository';
import { createTrainer as createTrainerWithFontLoader } from '../web/src/trainer';

const recognizable = (word: string) => ({
  ...deriveWord(word),
  familiarity: { ru: 1 },
  loanwordScore: 1,
});

const createTrainer = (
  words: Parameters<typeof createTrainerWithFontLoader>[0],
  repository: Parameters<typeof createTrainerWithFontLoader>[1],
  fontLoader: Parameters<typeof createTrainerWithFontLoader>[2] = async (
    font,
  ) => font,
  options?: Parameters<typeof createTrainerWithFontLoader>[3],
) => createTrainerWithFontLoader(words, repository, fontLoader, options);

function practicedState(attempts: number, mistakes = 0): LearnerState {
  const word = recognizable('ՄԱՄԱ');
  let state: LearnerState = { letters: {}, words: {}, recent: [] };
  for (let index = 0; index < attempts; index++)
    state = completeAttempt(
      state,
      { word, phase: 'bootstrap' },
      index < mistakes ? '' : word.readingLatin,
      index < mistakes,
      'practice',
      index,
      index + 1,
      `practice-${index}`,
    ).state;
  return state;
}

function matureState(excludedLetters: string[] = []): LearnerState {
  const known = {
    score: 0.8,
    attempts: 10,
    correct: 9,
    lastSeenAt: 0,
    verified: 2,
  };
  return {
    letters: Object.fromEntries(
      ALPHABET.filter(({ upper }) => !excludedLetters.includes(upper)).map(
        ({ upper }) => [upper, known],
      ),
    ),
    words: Object.fromEntries(
      Array.from({ length: 41 }, (_, index) => [
        `done-${index}`,
        { attempts: 1, correct: 1, lastSeenAt: 0 },
      ]),
    ),
    recent: [],
  };
}

it('unlocks fonts and italic modes only after the required correct answers', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const trainer = await createTrainer(
    ['ՄԱՄԱ', 'ՆԱՆԱ'].map(recognizable),
    { ...repo, loadState: async () => practicedState(40, 1) },
    async (font) => font,
  );
  await trainer.setSettings({
    fonts: {
      mode: 'single',
      selected: 'noto-serif-armenian',
      enabled: ['noto-serif-armenian'],
    },
    typography: {
      mode: 'single',
      selected: 'normal-italic',
      enabled: ['normal-italic'],
    },
  });
  expect(trainer.font.id).toBe('noto-sans-armenian');
  expect(trainer.presentation.italic).toBe(false);
  await trainer.submit(trainer.current.word.readingLatin);
  await trainer.next();
  expect(trainer.font.id).toBe('noto-serif-armenian');
  expect(trainer.presentation).toEqual({ caseMode: 'normal', italic: true });
  repo.close();
});

it('cycles the current presentation through unlocked typography modes', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const trainer = await createTrainer(['ՄԱՄԱ', 'ՆԱՆԱ'].map(recognizable), repo);
  expect(trainer.presentation).toEqual({ caseMode: 'caps', italic: false });
  expect(trainer.cycleTypography()).toBe(true);
  expect(trainer.presentation).toEqual({ caseMode: 'normal', italic: false });
  expect(trainer.cycleTypography()).toBe(true);
  expect(trainer.presentation).toEqual({ caseMode: 'lower', italic: false });
  expect(trainer.cycleTypography()).toBe(true);
  expect(trainer.presentation).toEqual({ caseMode: 'caps', italic: false });
  expect(trainer.cycleTypography()).toBe(true);
  await trainer.submit(trainer.current.word.readingLatin);
  expect(trainer.state.recent[0].payload.presentation).toMatchObject({
    caseMode: 'normal',
    italic: false,
  });
  expect(progress(trainer.state).typographyStats[0]).toMatchObject({
    caseMode: 'normal',
    italic: false,
  });
  expect(await repo.getSetting('app')).toBeUndefined();
  repo.close();
});

it('records interruptions and stops response timing at the first submitted answer', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const trainer = await createTrainer(
    ['ՄԱՄԱ', 'ՆԱՆԱ'].map(recognizable),
    repo,
    async (font) => font,
  );
  const shownAt = Date.now();
  const now = vi.spyOn(Date, 'now').mockReturnValue(shownAt);
  trainer.startFlash();
  now.mockReturnValue(shownAt + 1000);

  trainer.markTimingInterrupted();
  await trainer.submit(trainer.current.word.readingLatin);

  expect(trainer.state.recent[0]?.payload).toMatchObject({
    shownAt,
    answeredAt: shownAt + 1000,
    timingInterrupted: true,
  });
  now.mockRestore();
  trainer.dispose();
  repo.close();
});

it('restarts response timing when the presentation changes', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const trainer = await createTrainer(
    ['ՄԱՄԱ', 'ՆԱՆԱ'].map(recognizable),
    repo,
    async (font) => font,
  );
  trainer.startFlash();
  const initialShownAt = Date.now();
  const now = vi.spyOn(Date, 'now').mockReturnValue(initialShownAt + 1000);

  trainer.markTimingInterrupted();
  trainer.restartResponseTiming();
  now.mockReturnValue(initialShownAt + 2000);
  await trainer.submit(trainer.current.word.readingLatin);

  expect(trainer.state.recent[0]?.payload).toMatchObject({
    shownAt: initialShownAt + 1000,
    answeredAt: initialShownAt + 2000,
  });
  expect(trainer.state.recent[0]?.payload.timingInterrupted).toBeUndefined();
  now.mockRestore();
  trainer.dispose();
  repo.close();
});

it('reclassifies a ligature exposed by cycling out of CAPS', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`),
    word = recognizable('բարև'),
    trainer = await createTrainer(
      [word],
      { ...repo, loadState: async () => matureState(['և']) },
      async (font) => font,
      {
        settings: {
          ...DEFAULT_SETTINGS,
          typography: {
            mode: 'single',
            selected: 'caps',
            enabled: ['caps', 'normal', 'lower'],
          },
        },
        selector: () => ({ word, phase: 'training' }),
      },
    );

  expect(trainer.current.phase).toBe('training');
  expect(trainer.cycleTypography()).toBe(true);
  expect(trainer.presentation.caseMode).toBe('normal');
  expect(trainer.current.phase).toBe('introduction');
  expect(trainer.current.introducedLetter).toBe('և');
  await trainer.submit(word.readingLatin);
  expect(trainer.state.reinforcement).toEqual({ letter: 'և', remaining: 3 });
  trainer.dispose();
  repo.close();
});

it('blocks typography cycling when CAPS would expose two unknown letters', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`),
    word = recognizable('բարև'),
    trainer = await createTrainer(
      [word],
      { ...repo, loadState: async () => matureState(['Ե', 'Վ']) },
      async (font) => font,
      {
        settings: {
          ...DEFAULT_SETTINGS,
          typography: {
            mode: 'single',
            selected: 'lower',
            enabled: ['caps', 'normal', 'lower'],
          },
        },
        selector: () => ({ word, phase: 'training' }),
      },
    );

  expect(trainer.presentation.caseMode).toBe('lower');
  expect(trainer.cycleTypography()).toBe(false);
  expect(trainer.presentation.caseMode).toBe('lower');
  trainer.dispose();
  repo.close();
});

it('keeps the active reinforcement target when cycling would hide it', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`),
    word = recognizable('բարև'),
    trainer = await createTrainer(
      [word],
      {
        ...repo,
        loadState: async () => ({
          ...matureState(['և']),
          reinforcement: { letter: 'Ե', remaining: 3 },
        }),
      },
      async (font) => font,
      {
        settings: {
          ...DEFAULT_SETTINGS,
          typography: {
            mode: 'single',
            selected: 'caps',
            enabled: ['caps', 'normal', 'lower'],
          },
        },
        selector: () => ({ word, phase: 'reinforcement' }),
      },
    );

  expect(trainer.cycleTypography()).toBe(false);
  expect(trainer.presentation.caseMode).toBe('caps');
  await trainer.submit(word.readingLatin);
  expect(trainer.state.reinforcement).toEqual({ letter: 'Ե', remaining: 2 });
  trainer.dispose();
  repo.close();
});

it('preserves reinforcement when the target stays visible during case cycling', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`),
    word = recognizable('բարև'),
    trainer = await createTrainer(
      [word],
      {
        ...repo,
        loadState: async () => ({
          ...matureState(['Ե']),
          reinforcement: { letter: 'Բ', remaining: 3 },
        }),
      },
      async (font) => font,
      {
        settings: {
          ...DEFAULT_SETTINGS,
          typography: {
            mode: 'single',
            selected: 'lower',
            enabled: ['caps', 'normal', 'lower'],
          },
        },
        selector: () => ({ word, phase: 'reinforcement' }),
      },
    );

  expect(trainer.cycleTypography()).toBe(true);
  expect(trainer.presentation.caseMode).toBe('caps');
  expect(trainer.current.phase).toBe('reinforcement');
  await trainer.submit(word.readingLatin);
  expect(trainer.state.reinforcement).toEqual({ letter: 'Բ', remaining: 2 });
  trainer.dispose();
  repo.close();
});

it('selects the next word with the presentation that will be shown', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`),
    word = recognizable('բարև'),
    selectedModes: string[] = [],
    random = vi
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.99);
  try {
    const trainer = await createTrainer([word], repo, async (font) => font, {
      settings: {
        ...DEFAULT_SETTINGS,
        typography: {
          mode: 'rotate',
          selected: 'caps',
          enabled: ['caps', 'lower'],
        },
      },
      selector: (_state, _now, _random, _request, caseMode = 'caps') => {
        selectedModes.push(caseMode);
        return {
          word,
          phase: caseMode === 'lower' ? 'introduction' : 'training',
          ...(caseMode === 'lower' ? { introducedLetter: 'և' } : {}),
        };
      },
    });

    expect(trainer.presentation.caseMode).toBe('caps');
    await trainer.submit(word.readingLatin);
    await trainer.next();

    expect(trainer.presentation.caseMode).toBe('lower');
    expect(selectedModes.at(-1)).toBe(trainer.presentation.caseMode);
    expect(trainer.current.phase).toBe('introduction');
    expect(trainer.current.introducedLetter).toBe('և');
    trainer.dispose();
  } finally {
    random.mockRestore();
    repo.close();
  }
});

it('leaves legacy word references untouched at startup', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`),
    legacy = deriveWord('ԲԱՐԵՎ'),
    ligature = deriveWord('բարև');
  const completed = completeAttempt(
    await repo.loadState(),
    { word: legacy, phase: 'training' },
    legacy.readingLatin,
    false,
    'client',
    1,
    2,
    'legacy-attempt',
  );
  await repo.saveAttempt(completed.attempt, completed.state);

  const trainer = await createTrainer([ligature], repo, async (font) => font);

  expect(trainer.state.words[legacy.id]).toEqual(
    completed.state.words[legacy.id],
  );
  expect(trainer.state.words).not.toHaveProperty(ligature.id);
  expect(trainer.state.recent[0]?.payload.wordId).toBe(legacy.id);
  trainer.dispose();
  repo.close();
});

it('leaves legacy word progress untouched when a later practice mode loads its ligature', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`),
    legacy = deriveWord('ԲԱՐԵՎ'),
    ligature = recognizable('բարև');
  const completed = completeAttempt(
    await repo.loadState(),
    { word: legacy, phase: 'training' },
    legacy.readingLatin,
    false,
    'client',
    1,
    2,
    'legacy-mode-attempt',
  );
  await repo.saveAttempt(completed.attempt, completed.state);

  const trainer = await createTrainer(
    [recognizable('ՄԱՄԱ')],
    repo,
    async (font) => font,
  );
  expect(trainer.state.words).toHaveProperty(legacy.id);
  await trainer.setSettings(
    { fonts: trainer.settings.fonts, practiceMode: 'names' },
    {
      version: 1,
      schemaVersion: 1,
      generatedAt: '2026-09-14',
      words: [ligature],
    },
  );

  expect(trainer.state.words[legacy.id]).toEqual(
    completed.state.words[legacy.id],
  );
  expect(trainer.state.words).not.toHaveProperty(ligature.id);
  expect(trainer.state.recent[0]?.payload.wordId).toBe(legacy.id);
  trainer.dispose();
  repo.close();
});

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
  expect(trainer.lastScoreUpdate).toMatchObject({
    wordId: first.id,
    phase: 'bootstrap',
    word: { before: null, after: { attempts: 1, correct: 1 } },
  });
  const clientId = trainer.state.recent[0].clientId;
  await trainer.next();
  expect(trainer.current.word.id).not.toBe(first.id);
  const reloaded = await createTrainer(words, repo);
  expect(reloaded.state.recent).toHaveLength(1);
  expect(reloaded.current.word.id).not.toBe(first.id);
  await reloaded.submit('', true);
  expect(reloaded.state.recent[0].clientId).toBe(clientId);
  repo.close();
});

it('replaces prompts for a weak letter without scoring the discarded prompt', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const words = ['ՄԱՍ', 'ՄԱՄԱ', 'ՄԱՆ', 'ԳԱԶ', 'ՖԴԾ'].map(recognizable);
  const select = createWordSelector(words);
  const requests: Parameters<typeof select>[3][] = [];
  const trainer = await createTrainer(words, repo, async (font) => font, {
    selector: (state, now, random, request) => {
      requests.push(request);
      return select(state, now, random, request);
    },
  });
  const unansweredWordId = trainer.current.word.id;

  expect(await trainer.practiceLetter('Մ')).toBe('target');
  expect(trainer.current.word.id).not.toBe(unansweredWordId);
  expect(trainer.current.word.uniqueLetters).toContain('Մ');
  expect(trainer.state).toEqual({ letters: {}, words: {}, recent: [] });
  expect(trainer.result).toBeUndefined();

  await trainer.submit(trainer.current.word.readingLatin);
  const savedAttempt = trainer.state.recent[0];
  expect(savedAttempt?.payload.wordId).toBe(trainer.current.word.id);

  expect(await trainer.practiceLetter('Ֆ')).toBe('target');
  expect(trainer.current.word.id).not.toBe(savedAttempt?.payload.wordId);
  expect(trainer.current.word.uniqueLetters).toContain('Ֆ');
  expect(trainer.state.recent).toEqual([savedAttempt]);
  expect(trainer.result).toBeUndefined();

  await trainer.submit(trainer.current.word.readingLatin);
  expect(trainer.state.recent).toHaveLength(2);
  await trainer.next();
  expect(requests.at(-1)).toBeUndefined();
  repo.close();
});

it('shows up to five available words for a letter, then resumes normal selection', async () => {
  for (const poolSize of [4, 9]) {
    const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
    const ordinary = recognizable('ՆԱՆԱ');
    const targets = ALPHABET.slice(0, poolSize).map((letter) =>
      recognizable(`Ֆ${letter.upper}`),
    );
    const words = [ordinary, ...targets];
    const select = createWordSelector(words);
    const requests: Parameters<typeof select>[3][] = [];
    const trainer = await createTrainer(words, repo, async (font) => font, {
      selector: (state, now, random, request, caseMode) => {
        requests.push(request);
        return request
          ? select(state, now, random, request, caseMode)
          : { word: ordinary, phase: 'training' };
      },
    });
    const shown = new Set<string>();
    const count = Math.min(5, poolSize);

    expect(await trainer.practiceLetter('Ֆ')).toBe('target');
    for (let index = 0; index < count; index++) {
      if (index > 0) await trainer.next();
      expect(trainer.current.word.uniqueLetters).toContain('Ֆ');
      expect(shown.has(trainer.current.word.id)).toBe(false);
      shown.add(trainer.current.word.id);
      await trainer.submit(trainer.current.word.readingLatin);
    }
    await trainer.next();

    expect(shown.size).toBe(count);
    expect(
      requests.filter((request) => request?.targetLetter === 'Ֆ'),
    ).toHaveLength(count);
    expect(requests.at(-1)).toBeUndefined();
    trainer.dispose();
    repo.close();
  }
});

it('avoids recently shown letter words and clears that history on mode change', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const first = recognizable('ՖԱՍ');
  const familiar = recognizable('ՖԱՏ');
  const unfamiliar = {
    ...recognizable('ՖԱՐ'),
    familiarity: { ru: 0.1 },
    loanwordScore: 0,
  };
  const words = [first, familiar, unfamiliar];
  const select = createWordSelector(words);
  const requests: Parameters<typeof select>[3][] = [];
  const trainer = await createTrainer(words, repo, async (font) => font, {
    selector: (state, now, random, request) => {
      requests.push(request);
      return request
        ? select(state, now, random, request)
        : { word: first, phase: 'training' };
    },
  });

  expect(await trainer.practiceLetter('Ֆ')).toBe('target');
  expect(trainer.current.word.id).toBe(familiar.id);
  expect(await trainer.practiceLetter('Ֆ')).toBe('target');
  expect(trainer.current.word.id).toBe(unfamiliar.id);
  expect(await trainer.practiceLetter('Ֆ')).toBe('unavailable');
  expect(trainer.current.word.id).toBe(unfamiliar.id);
  const letterRequests = requests.filter((request) => request !== undefined);
  expect(letterRequests).toHaveLength(2);
  expect(letterRequests[0]?.excludeWordIds).toContain(first.id);
  expect(letterRequests[1]?.excludeWordIds).toEqual([first.id, familiar.id]);

  const dictionary: Dictionary = {
    version: 1,
    schemaVersion: 1,
    generatedAt: '2026-09-09',
    words,
  };
  await trainer.setSettings(
    { fonts: trainer.settings.fonts, practiceMode: 'names' },
    dictionary,
  );
  expect(await trainer.practiceLetter('Ֆ')).toBe('target');
  repo.close();
});

it('keeps only the last ten prompts in a letter history', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const words = ['Ա', 'Բ', 'Գ', 'Դ', 'Ե', 'Զ', 'Է', 'Ը', 'Թ', 'Ժ', 'Ի'].map(
    (letter) => recognizable(`Ֆ${letter}`),
  );
  const select = createWordSelector(words);
  const requests: NonNullable<Parameters<typeof select>[3]>[] = [];
  const trainer = await createTrainer(words, repo, async (font) => font, {
    selector: (state, now, random, request) => {
      if (request) requests.push(request);
      return request
        ? select(state, now, random, request)
        : { word: words[0], phase: 'training' };
    },
  });
  const shown = new Set([trainer.current.word.id]);

  for (let count = 0; count < 10; count++) {
    expect(await trainer.practiceLetter('Ֆ')).toBe('target');
    expect(shown.has(trainer.current.word.id)).toBe(false);
    shown.add(trainer.current.word.id);
  }
  expect(shown.size).toBe(11);
  expect(
    requests.every((request) => (request.excludeWordIds?.length ?? 0) <= 10),
  ).toBe(true);
  expect(requests.at(-1)?.excludeWordIds).toHaveLength(10);

  expect(await trainer.practiceLetter('Ֆ')).toBe('target');
  expect(trainer.current.word.id).toBe(words[0].id);
  repo.close();
});

it('keeps the prompt instead of falling back when no different word has the letter', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const current = recognizable('ՄԱՄԱ');
  const ordinaryAlternative = recognizable('ՆԱՆԱ');
  const words = [current, ordinaryAlternative];
  const select = createWordSelector(words);
  const trainer = await createTrainer(words, repo, async (font) => font, {
    selector: (state, now, random, request) =>
      request
        ? select(state, now, random, request)
        : { word: current, phase: 'training' },
  });

  expect(await trainer.practiceLetter('Մ')).toBe('unavailable');
  expect(trainer.current.word.id).toBe(current.id);
  expect(trainer.state).toEqual({ letters: {}, words: {}, recent: [] });
  repo.close();
});

it('keeps the prompt when the dictionary has no word with the selected letter', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const words = ['ՄԱՄԱ', 'ՆԱՆԱ'].map(recognizable);
  const trainer = await createTrainer(words, repo, async (font) => font);
  const currentWordId = trainer.current.word.id;

  expect(await trainer.practiceLetter('Ֆ')).toBe('missing');
  expect(trainer.current.word.id).toBe(currentWordId);
  expect(trainer.state).toEqual({ letters: {}, words: {}, recent: [] });
  repo.close();
});

it('keeps the prompt when the selector cannot start letter practice', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const current = recognizable('ՆԱՆԱ');
  const target = recognizable('ՖԱՍ');
  const trainer = await createTrainer(
    [current, target],
    repo,
    async (font) => font,
    { selector: () => ({ word: current, phase: 'training' }) },
  );

  expect(await trainer.practiceLetter('Ֆ')).toBe('unavailable');
  expect(trainer.current.word.id).toBe(current.id);
  expect(trainer.state).toEqual({ letters: {}, words: {}, recent: [] });
  repo.close();
});

it('ends letter practice when the selector cannot continue it', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const ordinary = recognizable('ՆԱՆԱ');
  const targets = ['ՖԱՍ', 'ՖԱՏ'].map(recognizable);
  let targetRequests = 0;
  const trainer = await createTrainer(
    [ordinary, ...targets],
    repo,
    async (font) => font,
    {
      selector: (_state, _now, _random, request) => {
        if (!request) return { word: ordinary, phase: 'training' };
        targetRequests++;
        return {
          word: targetRequests === 1 ? targets[0] : ordinary,
          phase: 'training',
        };
      },
    },
  );

  expect(await trainer.practiceLetter('Ֆ')).toBe('target');
  await trainer.submit(trainer.current.word.readingLatin);
  await trainer.next();
  expect(trainer.current.word.id).toBe(ordinary.id);

  await trainer.submit(ordinary.readingLatin);
  await trainer.next();
  expect(targetRequests).toBe(2);
  repo.close();
});

it('does not consume a letter-practice word when prompt replacement fails', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const ordinary = recognizable('ՆԱՆԱ');
  const targets = ['ՖԱՍ', 'ՖԱՏ'].map(recognizable);
  let fontLoads = 0;
  const trainer = await createTrainer(
    [ordinary, ...targets],
    repo,
    async (font) => {
      fontLoads++;
      if (fontLoads === 2) throw new Error('font load failed');
      return font;
    },
    {
      selector: (_state, _now, _random, request) => ({
        word: request
          ? (targets.find(
              (word) =>
                word.id !== request.excludeWordId &&
                !request.excludeWordIds?.includes(word.id),
            ) ?? ordinary)
          : ordinary,
        phase: 'training',
      }),
    },
  );

  await expect(trainer.practiceLetter('Ֆ')).rejects.toThrow('font load failed');
  expect(trainer.current.word.id).toBe(ordinary.id);

  expect(await trainer.practiceLetter('Ֆ')).toBe('target');
  expect(trainer.current.word.id).toBe(targets[0].id);
  repo.close();
});

it('can practice a CAPS letter exposed by the և ligature', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const current = recognizable('ՄԱՄԱ');
  const ligature = recognizable('բարև');
  const select = createWordSelector([current, ligature]);
  const trainer = await createTrainer(
    [current, ligature],
    repo,
    async (font) => font,
    {
      selector: (state, now, random, request, caseMode) =>
        request
          ? select(state, now, random, request, caseMode)
          : { word: current, phase: 'training' },
    },
  );

  expect(await trainer.practiceLetter('Ե')).toBe('target');
  expect(trainer.current.word).toBe(ligature);
  trainer.dispose();
  repo.close();
});

it('practices the logical և token in CAPS and continues to another matching word', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const current = recognizable('ՄԱՄԱ');
  const targets = [recognizable('բարև'), recognizable('Երևան')];
  const words = [current, ...targets];
  const select = createWordSelector(words);
  const trainer = await createTrainer(words, repo, async (font) => font, {
    selector: (state, now, random, request, caseMode) =>
      request
        ? select(state, now, random, request, caseMode)
        : { word: current, phase: 'training' },
  });

  expect(await trainer.practiceLetter('և')).toBe('target');
  const first = trainer.current.word;
  expect(first.uniqueLetters).toContain('և');

  await trainer.submit(first.readingLatin);
  await trainer.next();

  expect(trainer.current.word.id).not.toBe(first.id);
  expect(trainer.current.word.uniqueLetters).toContain('և');
  trainer.dispose();
  repo.close();
});

it('reports the visible alphabet keys for a CAPS ligature score update', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`),
    word = recognizable('բարև');
  const trainer = await createTrainer([word], repo, async (font) => font);

  await trainer.submit(word.readingLatin);

  expect(Object.keys(trainer.lastScoreUpdate?.letters ?? {})).toEqual(
    expect.arrayContaining(['Ե', 'Վ']),
  );
  expect(trainer.lastScoreUpdate?.letters).not.toHaveProperty('և');
  repo.close();
});
it('uses the injected selector and records the active practice mode', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const word = recognizable('ՄԱՄԱ');
  let selections = 0;
  const trainer = await createTrainer([word], repo, async (font) => font, {
    mode: PRACTICE_MODES[0],
    selector: () => {
      selections++;
      return { word, phase: 'training' };
    },
  });

  expect(selections).toBe(1);
  await trainer.submit(word.readingLatin);
  expect(trainer.state.recent[0]?.payload.practiceMode).toBe('words');
  await trainer.next();
  expect(selections).toBe(2);
  repo.close();
});

it('switches practice mode on the existing trainer', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const packWord = recognizable('ՆԱ');
  const dictionary: Dictionary = {
    version: 1,
    schemaVersion: 1,
    generatedAt: '2026-09-09',
    words: [packWord],
  };
  const trainer = await createTrainer(
    [recognizable('ՄԱՄԱ')],
    repo,
    async (font) => font,
  );

  await trainer.submit('', true);
  await trainer.setSettings(
    { fonts: trainer.settings.fonts, practiceMode: 'names' },
    dictionary,
  );

  expect(trainer.settings.practiceMode).toBe('names');
  expect(trainer.current.word.id).toBe(packWord.id);
  expect(trainer.result).toBeUndefined();
  await trainer.submit(packWord.readingLatin);
  expect(trainer.state.recent[0]?.payload.practiceMode).toBe('names');
  repo.close();
});

it('uses one selected typography mode for a practice-mode switch and its word', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`),
    ligature = recognizable('բարև'),
    dictionary: Dictionary = {
      version: 1,
      schemaVersion: 1,
      generatedAt: '2026-09-09',
      words: [ligature],
    },
    known = {
      score: 0.8,
      attempts: 10,
      correct: 9,
      lastSeenAt: 0,
      verified: 2,
    },
    state: LearnerState = {
      letters: Object.fromEntries(
        ALPHABET.slice(0, -1).map((letter) => [letter.upper, known]),
      ),
      words: Object.fromEntries(
        Array.from({ length: 41 }, (_, index) => [
          `done-${index}`,
          { attempts: 1, correct: 1, lastSeenAt: 0 },
        ]),
      ),
      recent: [],
    };
  const trainer = await createTrainer(
    [recognizable('ՄԱՄԱ')],
    { ...repo, loadState: async () => state },
    async (font) => font,
  );
  const random = vi
    .spyOn(Math, 'random')
    .mockReturnValueOnce(0.99)
    .mockReturnValueOnce(0);
  try {
    await trainer.setSettings(
      {
        fonts: trainer.settings.fonts,
        practiceMode: 'names',
        typography: {
          mode: 'rotate',
          selected: 'caps',
          enabled: ['caps', 'lower'],
        },
      },
      dictionary,
    );

    expect(trainer.presentation.caseMode).toBe('lower');
    expect(trainer.current.phase).toBe('introduction');
    expect(trainer.current.introducedLetter).toBe('և');
  } finally {
    random.mockRestore();
    trainer.dispose();
    repo.close();
  }
});

it('queues a mode switch behind an in-flight submission', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const firstWord = recognizable('ՄԱՄԱ');
  const packWord = recognizable('ՆԱ');
  const dictionary: Dictionary = {
    version: 1,
    schemaVersion: 1,
    generatedAt: '2026-09-09',
    words: [packWord],
  };
  let releaseSave = () => {};
  let markSaveStarted = () => {};
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const saveStarted = new Promise<void>((resolve) => {
    markSaveStarted = resolve;
  });
  const delayedRepo = {
    ...repo,
    saveAttempt: async (...args: Parameters<typeof repo.saveAttempt>) => {
      markSaveStarted();
      await saveGate;
      return repo.saveAttempt(...args);
    },
  };
  const trainer = await createTrainer(
    [firstWord],
    delayedRepo,
    async (font) => font,
  );

  const submitting = trainer.submit(firstWord.readingLatin);
  await saveStarted;
  const switching = trainer.setSettings(
    { fonts: trainer.settings.fonts, practiceMode: 'names' },
    dictionary,
  );
  expect(trainer.settings.practiceMode).toBe('words');
  releaseSave();
  await submitting;
  await switching;

  expect(trainer.settings.practiceMode).toBe('names');
  expect(trainer.current.word.id).toBe(packWord.id);
  expect(trainer.result).toBeUndefined();
  repo.close();
});

it('shows the introduction once per browser profile', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const words = ['ՄԱՄԱ', 'ՆԱՆԱ'].map(recognizable);
  const trainer = await createTrainer(words, repo);
  expect(trainer.introShown).toBe(false);
  await trainer.markIntroShown();
  expect(trainer.introShown).toBe(true);
  expect((await createTrainer(words, repo)).introShown).toBe(true);
  repo.close();
});

it('backfills achievement unlocks and returns new unlocks with a completed attempt', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const word = { ...recognizable('բարև'), familiarity: { ru: 0.2 } };
  const historical = completeAttempt(
    await repo.loadState(),
    { word, phase: 'bootstrap' },
    word.readingLatin,
    false,
    'client',
    1,
    2,
    'historical',
  );
  await repo.saveAttempt(historical.attempt, historical.state);

  const backfilled = await createTrainer([word], repo);
  expect(
    backfilled.backfilledAchievementUnlocks.map((unlock) => unlock.id),
  ).toEqual(['training-wheels-off', 'barev-world']);
  expect(backfilled.achievementUnlocks).toHaveLength(2);

  const freshRepo = await openRepository(`trainer-${crypto.randomUUID()}`);
  const fresh = await createTrainer([word], freshRepo);
  await fresh.submit(word.readingLatin);
  expect(fresh.lastAchievementUnlocks.map((unlock) => unlock.id)).toEqual([
    'training-wheels-off',
    'barev-world',
  ]);
  expect(await freshRepo.getAchievementUnlocks()).toEqual(
    expect.arrayContaining(fresh.lastAchievementUnlocks),
  );
  repo.close();
  freshRepo.close();
});

it('backfills and persists historical location achievements by practice mode', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  let state = await repo.loadState();
  const saveHistorical = async (
    word: ReturnType<typeof deriveWord>,
    mode: 'toponyms' | 'countries',
    index: number,
  ) => {
    const completed = completeAttempt(
      state,
      { word, phase: 'training' },
      word.readingLatin,
      false,
      'historical',
      index,
      index + 1,
      `${mode}-${index}`,
      'default',
      { caseMode: 'caps', italic: false },
      undefined,
      undefined,
      mode,
    );
    state = completed.state;
    await repo.saveAttempt(completed.attempt, state);
  };
  const toponyms = Array.from({ length: 20 }, (_, index) => ({
    ...deriveWord('ՄԱ'),
    id: `toponym-${index}`,
  }));
  const countries = [
    'ԻՐԱՆ',
    'ԹՈՒՐՔԻԱ',
    'ՎՐԱՍՏԱՆ',
    'ԱԴՐԲԵՋԱՆ',
    ...Array.from({ length: 16 }, () => 'ՄԱ'),
  ].map((word, index) => ({ ...deriveWord(word), id: `country-${index}` }));
  for (const [index, word] of toponyms.entries())
    await saveHistorical(word, 'toponyms', index);
  for (const [index, word] of countries.entries())
    await saveHistorical(word, 'countries', index);

  const currentWord = deriveWord('ՄԱ');
  const trainer = await createTrainer(
    [currentWord],
    repo,
    async (font) => font,
    {
      mode: PRACTICE_MODES[2],
      selector: () => ({ word: currentWord, phase: 'training' }),
    },
  );
  const backfilledIds = trainer.backfilledAchievementUnlocks.map(
    (unlock) => unlock.id,
  );
  expect(backfilledIds).toEqual(
    expect.arrayContaining([
      'first-landmark',
      'local-guide',
      'passport-stamped',
      'border-reader',
      'armenia-neighbors',
    ]),
  );
  expect(await repo.getAchievementUnlocks()).toEqual(
    expect.arrayContaining(trainer.backfilledAchievementUnlocks),
  );
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
  expect(trainer.font.id).toBe('noto-sans-armenian');
  await trainer.submit('', true);
  expect(trainer.state.recent[0].payload.fontId).toBe('noto-sans-armenian');
  repo.close();
});

it('latches metadata hint visibility for the prompt being answered', async () => {
  const repo = await openRepository(`trainer-${crypto.randomUUID()}`);
  await repo.setSetting('app', {
    ...DEFAULT_SETTINGS,
    metadataHints: true,
  });
  const word = { ...recognizable('ՄԱՄԱ'), categories: ['family'] };
  const trainer = await createTrainer([word], repo, async (font) => font);
  trainer.setMetadataHintsShown(true);
  await trainer.setSettings({ ...trainer.settings, metadataHints: false });
  trainer.setMetadataHintsShown(false);
  await trainer.submit(word.readingLatin);
  expect(trainer.state.recent[0].payload.metadataHintsShown).toBe(true);
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
  expect(trainer.settings.fonts.selected).toBe('noto-sans-armenian');
  expect(trainer.font.id).toBe('noto-sans-armenian');
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
      if (font.id === 'noto-sans-armenian' && defaultLoads++ > 0)
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
    expect(Object.keys(state.letters)).toHaveLength(ALPHABET.length - 1);
    expect(state.letters).not.toHaveProperty('և');
  },
  10_000,
);
