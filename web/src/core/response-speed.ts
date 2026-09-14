import { ALPHABET, promptLetters } from '../../../shared/armenian.ts';
import type { AttemptEvent, CaseMode } from '../../../shared/types.ts';

const MAX_RESPONSE_MS = 120_000;
const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
const SUMMARY_ATTEMPT_WINDOW = 50;
const MIN_SLOW_LETTER_SAMPLES = 5;
const MIN_FINDING_SAMPLES = 8;
const MIN_SLOWDOWN_RATIO = 1.2;
const MIN_TREND_SAMPLES = 5;
const knownLetters = new Set(ALPHABET.map(({ upper }) => upper));
const letterIdCode = /^[\da-f]+$/iu;

export interface SlowLetterResponseSpeed {
  letter: string;
  medianMsPerLetter: number;
}

export interface ResponseSpeedFinding {
  key: string;
  dimension:
    | 'familiarity'
    | 'wordLength'
    | 'font'
    | 'typography'
    | 'practiceMode'
    | 'promptMode';
  changePercent: number;
}

export interface ResponseSpeedStats {
  medianResponseMs: number | null;
  medianMsPerLetter: number | null;
  changePercent: number | null;
  slowLetters: SlowLetterResponseSpeed[];
  findings: ResponseSpeedFinding[];
}

export function responseDuration(attempt: AttemptEvent): number | null {
  const { shownAt, answeredAt, timingInterrupted } = attempt.payload;
  if (
    timingInterrupted ||
    !Number.isFinite(shownAt) ||
    !Number.isFinite(answeredAt)
  )
    return null;
  const duration = answeredAt - shownAt;
  return duration >= 0 && duration <= MAX_RESPONSE_MS ? duration : null;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return sorted.length % 2
    ? (upper ?? null)
    : lower === undefined || upper === undefined
      ? null
      : (lower + upper) / 2;
}

function lettersFromWordId(id: string): string[] {
  if (!id.startsWith('hy-')) return [];
  const codes = id.slice(3).split('-');
  if (codes.some((code) => !letterIdCode.test(code))) return [];
  const codePoints = codes.map((code) => Number.parseInt(code, 16));
  if (codePoints.some((code) => code > 0xffff)) return [];
  const letters = codePoints.map((code) => String.fromCharCode(code));
  return letters.every((letter) => knownLetters.has(letter)) ? letters : [];
}

function breakdown(values: Map<string, number[]>) {
  return [...values]
    .map(([key, samples]) => ({
      key,
      medianMsPerLetter: median(samples) ?? 0,
      samples: samples.length,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function slowerGroups(
  groups: Map<string, number[]>,
  dimension: ResponseSpeedFinding['dimension'],
): ResponseSpeedFinding[] {
  return [...groups]
    .flatMap(([key, samples]) => {
      const comparison = [...groups]
        .filter(([otherKey]) => otherKey !== key)
        .flatMap(([, otherSamples]) => otherSamples);
      const groupMedian = median(samples);
      const comparisonMedian = median(comparison);
      if (
        samples.length < MIN_FINDING_SAMPLES ||
        comparison.length < MIN_FINDING_SAMPLES ||
        groupMedian === null ||
        comparisonMedian === null ||
        comparisonMedian <= 0 ||
        groupMedian / comparisonMedian < MIN_SLOWDOWN_RATIO
      )
        return [];
      return [
        {
          dimension,
          key,
          changePercent: Math.round(
            ((groupMedian - comparisonMedian) / comparisonMedian) * 100,
          ),
        },
      ];
    })
    .sort((a, b) => b.changePercent - a.changePercent);
}

export function responseSpeed(
  attempts: readonly AttemptEvent[],
  now = Date.now(),
): ResponseSpeedStats {
  const currentStart = now - PERIOD_MS;
  const previousStart = currentStart - PERIOD_MS;
  const summaryAttempts = new Set(attempts.slice(0, SUMMARY_ATTEMPT_WINDOW));
  const relevantAttempts = attempts.filter(
    (attempt, index) =>
      index < SUMMARY_ATTEMPT_WINDOW ||
      (attempt.payload.answeredAt >= previousStart &&
        attempt.payload.answeredAt <= now),
  );
  const timedCorrect = relevantAttempts.flatMap((attempt) => {
    const duration = responseDuration(attempt);
    if (duration === null || !attempt.payload.correct) return [];
    return [{ attempt, duration }];
  });
  const summaryTimedCorrect = timedCorrect.filter(({ attempt }) =>
    summaryAttempts.has(attempt),
  );
  const correct = timedCorrect.flatMap((timed) => {
    const { attempt, duration } = timed;
    const letters = lettersFromWordId(attempt.payload.wordId);
    return letters.length
      ? [
          {
            attempt,
            duration,
            letters,
            perLetter: duration / letters.length,
          },
        ]
      : [];
  });
  const summaryCorrect = correct.filter(({ attempt }) =>
    summaryAttempts.has(attempt),
  );
  const byFamiliarity = new Map<string, number[]>();
  const byWordLength = new Map<string, number[]>();
  const byFont = new Map<string, number[]>();
  const byTypography = new Map<string, number[]>();
  const byPracticeMode = new Map<string, number[]>();
  const byPromptMode = new Map<string, number[]>();
  const byLetter = new Map<string, number[]>();
  const record = (
    groups: Map<string, number[]>,
    key: string,
    value: number,
  ) => {
    const samples = groups.get(key) ?? [];
    samples.push(value);
    groups.set(key, samples);
  };

  for (const { attempt, perLetter, letters } of summaryCorrect) {
    const { payload } = attempt;
    const presentation = payload.presentation ?? {
      caseMode: 'caps' as CaseMode,
      italic: false,
    };
    const lengthGroup =
      letters.length <= 3 ? 'short' : letters.length <= 5 ? 'medium' : 'long';
    const familiarity = payload.familiarity;
    const visibleLetters = promptLetters(
      [...new Set(letters)],
      presentation.caseMode,
    );
    for (const letter of visibleLetters) record(byLetter, letter, perLetter);
    record(byWordLength, lengthGroup, perLetter);
    record(byFont, payload.fontId ?? 'default', perLetter);
    record(
      byTypography,
      `${presentation.caseMode}:${presentation.italic}`,
      perLetter,
    );
    record(byPracticeMode, payload.practiceMode ?? 'words', perLetter);
    record(
      byPromptMode,
      payload.flashMode
        ? payload.flashRevealed
          ? 'flash-revealed'
          : 'flash-unrevealed'
        : 'standard',
      perLetter,
    );
    if (Number.isFinite(familiarity))
      record(
        byFamiliarity,
        familiarity < 0.34
          ? 'unfamiliar'
          : familiarity < 0.67
            ? 'somewhat-familiar'
            : 'familiar',
        perLetter,
      );
  }

  const recent = correct.filter(
    ({ attempt }) =>
      attempt.payload.answeredAt >= currentStart &&
      attempt.payload.answeredAt <= now,
  );
  const previous = correct.filter(
    ({ attempt }) =>
      attempt.payload.answeredAt >= previousStart &&
      attempt.payload.answeredAt < currentStart,
  );
  const recentMedian = median(recent.map(({ perLetter }) => perLetter));
  const previousMedian = median(previous.map(({ perLetter }) => perLetter));
  const changePercent =
    recent.length >= MIN_TREND_SAMPLES &&
    previous.length >= MIN_TREND_SAMPLES &&
    previousMedian !== null &&
    previousMedian > 0 &&
    recentMedian !== null
      ? Math.round(((recentMedian - previousMedian) / previousMedian) * 100)
      : null;
  const allMedianPerLetter = median(
    summaryCorrect.map(({ perLetter }) => perLetter),
  );
  const slowLetters = breakdown(byLetter)
    .filter(
      ({ medianMsPerLetter, samples }) =>
        samples >= MIN_SLOW_LETTER_SAMPLES &&
        allMedianPerLetter !== null &&
        medianMsPerLetter >= allMedianPerLetter * MIN_SLOWDOWN_RATIO,
    )
    .map(({ key, medianMsPerLetter }) => ({ letter: key, medianMsPerLetter }))
    .sort((a, b) => b.medianMsPerLetter - a.medianMsPerLetter)
    .slice(0, 3);
  const findings = [
    ...slowerGroups(byFamiliarity, 'familiarity'),
    ...slowerGroups(byWordLength, 'wordLength'),
    ...slowerGroups(byFont, 'font'),
    ...slowerGroups(byTypography, 'typography'),
    ...slowerGroups(byPracticeMode, 'practiceMode'),
    ...slowerGroups(byPromptMode, 'promptMode'),
  ].sort((a, b) => b.changePercent - a.changePercent);

  return {
    medianResponseMs: median(
      summaryTimedCorrect.map(({ duration }) => duration),
    ),
    medianMsPerLetter: allMedianPerLetter,
    changePercent,
    slowLetters,
    findings,
  };
}
