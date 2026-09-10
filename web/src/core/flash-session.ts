import { flashAvailable, flashExposureMs } from './settings.ts';

export interface FlashAttempt {
  exposureMs: number;
  visibleDurationMs?: number;
  revealed: boolean;
}

interface FlashSessionOptions {
  getEnabled: () => boolean;
  getCorrectAnswers: () => number;
  getBaseExposureMs: () => number;
  getWordLength: () => number;
  getHasResult: () => boolean;
  onChange: () => void;
}

export interface FlashSession {
  readonly hidden: boolean;
  readonly revealed: boolean;
  readonly started: boolean;
  readonly paused: boolean;
  start(): void;
  pause(): void;
  resume(): void;
  reveal(): void;
  show(): void;
  capture(): FlashAttempt | undefined;
  reset(): void;
  dispose(): void;
}

export function createFlashSession(options: FlashSessionOptions): FlashSession {
  let hidden = false;
  let revealed = false;
  let started = false;
  let paused = false;
  let visibilityPaused = false;
  let timingInvalid = false;
  let visibleSince: number | undefined;
  let elapsedMs = 0;
  let plannedExposureMs = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const recordVisibleTime = () => {
    if (visibleSince === undefined) return;
    elapsedMs += Math.max(0, Date.now() - visibleSince);
    visibleSince = undefined;
  };
  const hide = () => {
    if (!started || paused || options.getHasResult()) return;
    recordVisibleTime();
    clearTimer();
    hidden = true;
    options.onChange();
  };
  const armTimer = () => {
    if (
      options.getHasResult() ||
      !started ||
      paused ||
      hidden ||
      revealed ||
      !options.getEnabled() ||
      !flashAvailable(options.getCorrectAnswers())
    )
      return;
    const remaining = Math.max(0, plannedExposureMs - elapsedMs);
    if (!remaining) {
      hide();
      return;
    }
    visibleSince = Date.now();
    timer = setTimeout(hide, remaining);
  };
  const onVisibilityChange = () => {
    if (options.getHasResult()) return;
    if (document.visibilityState === 'hidden') {
      if (!started || hidden || revealed) return;
      const alreadyPaused = paused;
      recordVisibleTime();
      clearTimer();
      paused = true;
      visibilityPaused = !alreadyPaused;
      timingInvalid = true;
    } else if (document.visibilityState === 'visible' && visibilityPaused) {
      visibilityPaused = false;
      if (paused && !hidden && !revealed) {
        paused = false;
        armTimer();
      }
    }
  };

  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    get hidden() {
      return hidden;
    },
    get revealed() {
      return revealed;
    },
    get started() {
      return started;
    },
    get paused() {
      return paused;
    },
    start() {
      clearTimer();
      hidden = false;
      revealed = false;
      timingInvalid = false;
      started = true;
      paused = false;
      visibilityPaused = false;
      elapsedMs = 0;
      plannedExposureMs = flashExposureMs(
        options.getBaseExposureMs(),
        options.getWordLength(),
      );
      armTimer();
    },
    pause() {
      if (!started || paused || hidden || revealed || options.getHasResult())
        return;
      recordVisibleTime();
      clearTimer();
      paused = true;
    },
    resume() {
      if (!started || !paused || hidden || revealed || options.getHasResult())
        return;
      paused = false;
      armTimer();
    },
    reveal() {
      if (!hidden || options.getHasResult()) return;
      revealed = true;
      hidden = false;
      clearTimer();
      options.onChange();
    },
    show() {
      if (!hidden) return;
      hidden = false;
      options.onChange();
    },
    capture() {
      recordVisibleTime();
      clearTimer();
      if (
        !started ||
        !options.getEnabled() ||
        !flashAvailable(options.getCorrectAnswers())
      )
        return undefined;
      return {
        exposureMs: plannedExposureMs,
        ...(timingInvalid ? {} : { visibleDurationMs: elapsedMs }),
        revealed,
      };
    },
    reset() {
      clearTimer();
      hidden = false;
      revealed = false;
      started = false;
      paused = false;
      visibilityPaused = false;
      timingInvalid = false;
      visibleSince = undefined;
      elapsedMs = 0;
      plannedExposureMs = 0;
    },
    dispose() {
      clearTimer();
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
