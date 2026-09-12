import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { deriveWord } from '../shared/armenian';
import type { LearnerState } from '../shared/types';
import { createFlashSession } from '../web/src/core/flash-session';
import { completeAttempt, progress } from '../web/src/core/session';
import { DEFAULT_SETTINGS, flashExposureMs } from '../web/src/core/settings';
import { openRepository } from '../web/src/storage/repository';
import { createTrainer } from '../web/src/trainer';

const empty = (): LearnerState => ({ letters: {}, words: {}, recent: [] });

it('disposes flash timers and visibility listeners', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const listeners = new Set<() => void>();
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (_type: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        listeners.delete(listener),
    });
    const session = createFlashSession({
      getEnabled: () => true,
      getCorrectAnswers: () => 10,
      getBaseExposureMs: () => 1_000,
      getWordLength: () => 4,
      getHasResult: () => false,
      onChange: () => {},
    });

    session.start();
    expect(listeners).toHaveLength(1);
    session.dispose();
    expect(listeners).toHaveLength(0);
    vi.advanceTimersByTime(1_000);
    expect(session.hidden).toBe(false);
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it('adds a capped letter allowance to the configured base exposure', () => {
  expect(flashExposureMs(3_000, 4)).toBe(3_000);
  expect(flashExposureMs(3_000, 8)).toBe(4_000);
  expect(flashExposureMs(10_000, 20)).toBe(12_000);
});

it('records flash provenance and keeps unrevealed attempts out of mastery scores', () => {
  const word = deriveWord('ՄԱՄԱ');
  const flash = completeAttempt(
    empty(),
    { word, phase: 'bootstrap' },
    'mama',
    false,
    'client',
    100,
    2_000,
    'flash',
    'default',
    { caseMode: 'caps', italic: false },
    undefined,
    { exposureMs: 1_000, visibleDurationMs: 1_000, revealed: false },
  );

  expect(flash.attempt.payload).toMatchObject({
    flashMode: true,
    flashExposureMs: 1_000,
    flashVisibleDurationMs: 1_000,
    flashRevealed: false,
  });
  expect(flash.state.letters).toEqual({});
  expect(progress(flash.state).flashStats).toMatchObject({
    attempts: 1,
    unrevealed: 1,
    revealed: 0,
    accuracy: 1,
  });

  const revealed = completeAttempt(
    flash.state,
    { word, phase: 'bootstrap' },
    'mama',
    false,
    'client',
    2_100,
    3_000,
    'revealed',
    'default',
    { caseMode: 'caps', italic: false },
    undefined,
    { exposureMs: 1_000, visibleDurationMs: 1_000, revealed: true },
  );
  expect(Object.values(revealed.state.letters)[0]?.correct).toBe(1);
  expect(progress(revealed.state).flashStats.revealed).toBe(1);
});

it('excludes unrevealed flash attempts from ordinary result statistics', () => {
  const word = deriveWord('ՄԱՄԱ');
  const ordinary = completeAttempt(
    empty(),
    { word, phase: 'bootstrap' },
    word.readingLatin,
    false,
    'client',
    1,
    2,
    'ordinary',
    'noto-sans-armenian',
  );
  const withFlash = completeAttempt(
    ordinary.state,
    { word, phase: 'bootstrap' },
    '',
    true,
    'client',
    3,
    4,
    'flash-unrevealed',
    'default',
    { caseMode: 'caps', italic: false },
    undefined,
    { exposureMs: 1_000, visibleDurationMs: 1_000, revealed: false },
  );
  const stats = progress(withFlash.state);

  expect(stats.accuracy).toBe(1);
  expect(stats.rolling20).toBe(1);
  expect(stats.skips).toBe(0);
  expect(stats.fontStats[0]?.attempts).toBe(1);
  expect(stats.typographyStats[0]?.attempts).toBe(1);
});

it('keeps a revealed prompt visible until the next word', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(0);
  const repo = await openRepository(`flash-${crypto.randomUUID()}`);
  const word = deriveWord('ՄԱՄԱ');
  let state = empty();
  for (let index = 0; index < 10; index++)
    state = completeAttempt(
      state,
      { word, phase: 'bootstrap' },
      word.readingLatin,
      false,
      'seed',
      index,
      index + 1,
      `seed-${index}`,
    ).state;
  await repo.setSetting('app', {
    ...DEFAULT_SETTINGS,
    flash: { enabled: true, exposureMs: 1_000 },
  });
  const trainer = await createTrainer(
    [word],
    { ...repo, loadState: async () => state },
    async (font) => font,
  );

  trainer.startFlash();
  expect(trainer.flashHidden).toBe(false);
  vi.advanceTimersByTime(1_000);
  expect(trainer.flashHidden).toBe(true);
  trainer.revealFlash();
  expect(trainer.flashHidden).toBe(false);
  expect(trainer.flashRevealed).toBe(true);
  await trainer.setSettings({
    ...trainer.settings,
    flash: { enabled: true, exposureMs: 2_000 },
  });
  vi.advanceTimersByTime(5_000);
  expect(trainer.flashHidden).toBe(false);
  await trainer.setSettings({
    ...trainer.settings,
    flash: { enabled: true, exposureMs: 1_000 },
  });

  await trainer.submit(word.readingLatin);
  expect(trainer.state.recent[0]?.payload.flashRevealed).toBe(true);
  await trainer.next();
  trainer.startFlash();
  expect(trainer.flashHidden).toBe(false);
  vi.advanceTimersByTime(1_000);
  expect(trainer.flashHidden).toBe(true);
  repo.close();
  vi.useRealTimers();
});

it('pauses hidden timing and restarts exposure from a settings change', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(0);
  const repo = await openRepository(`flash-${crypto.randomUUID()}`);
  const word = deriveWord('ՄԱՄԱ');
  let state = empty();
  for (let index = 0; index < 10; index++)
    state = completeAttempt(
      state,
      { word, phase: 'bootstrap' },
      word.readingLatin,
      false,
      'seed',
      index,
      index + 1,
      `seed-${index}`,
    ).state;
  await repo.setSetting('app', {
    ...DEFAULT_SETTINGS,
    flash: { enabled: true, exposureMs: 1_000 },
  });
  const trainer = await createTrainer(
    [word],
    { ...repo, loadState: async () => state },
    async (font) => font,
  );

  trainer.startFlash();
  vi.advanceTimersByTime(400);
  trainer.pauseFlash();
  vi.advanceTimersByTime(5_000);
  expect(trainer.flashHidden).toBe(false);
  trainer.resumeFlash();
  vi.advanceTimersByTime(599);
  expect(trainer.flashHidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(trainer.flashHidden).toBe(true);

  trainer.startFlash();
  vi.advanceTimersByTime(400);
  await trainer.setSettings({
    ...trainer.settings,
    flash: { enabled: true, exposureMs: 2_000 },
  });
  vi.advanceTimersByTime(1_999);
  expect(trainer.flashHidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(trainer.flashHidden).toBe(true);
  await trainer.setSettings({
    ...trainer.settings,
    flash: { enabled: false, exposureMs: 1_000 },
  });
  expect(trainer.flashHidden).toBe(false);
  repo.close();
  vi.useRealTimers();
});

it('resumes the remaining exposure after tab visibility invalidates timing', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(0);
  let visibilityChange: (() => void) | undefined;
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: (_type: string, listener: () => void) => {
      visibilityChange = listener;
    },
  });
  const repo = await openRepository(`flash-${crypto.randomUUID()}`);
  const word = deriveWord('ՄԱՄԱ');
  let state = empty();
  for (let index = 0; index < 10; index++)
    state = completeAttempt(
      state,
      { word, phase: 'bootstrap' },
      word.readingLatin,
      false,
      'seed',
      index,
      index + 1,
      `seed-${index}`,
    ).state;
  await repo.setSetting('app', {
    ...DEFAULT_SETTINGS,
    flash: { enabled: true, exposureMs: 1_000 },
  });
  const trainer = await createTrainer(
    [word],
    { ...repo, loadState: async () => state },
    async (font) => font,
  );

  trainer.startFlash();
  vi.advanceTimersByTime(400);
  const page = globalThis.document as unknown as { visibilityState: string };
  page.visibilityState = 'hidden';
  visibilityChange?.();
  vi.advanceTimersByTime(5_000);
  expect(trainer.flashHidden).toBe(false);
  page.visibilityState = 'visible';
  visibilityChange?.();
  vi.advanceTimersByTime(599);
  expect(trainer.flashHidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(trainer.flashHidden).toBe(true);
  await trainer.submit(word.readingLatin);
  expect(
    trainer.state.recent[0]?.payload.flashVisibleDurationMs,
  ).toBeUndefined();
  repo.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
