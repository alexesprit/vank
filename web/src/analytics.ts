import type { AttemptEvent } from '../../shared/types.ts';
import type { Repository } from './storage/repository.ts';

const doNotTrackValues = new Set(['1', 'yes']);
const milestones = [1, 10, 25, 50] as const;
type PracticeMilestone = (typeof milestones)[number];
type AnalyticsMode = 'off' | 'console' | 'umami';
type UmamiTracker = {
  track(event?: string, data?: { milestone: PracticeMilestone }): void;
};

declare global {
  interface Window {
    umami?: UmamiTracker;
  }
}

let umamiScript: Promise<void> | undefined;
let analyticsEnabled = false;
let pageviewSent = false;
let submittedCount = 0;
let hadPracticeBeforeVisit = false;
let returnedSent = false;
let sentMilestones: Set<PracticeMilestone> | undefined;
let analyticsWork = Promise.resolve();

export function doNotTrackEnabled(
  value = typeof navigator === 'undefined' ? undefined : navigator.doNotTrack,
) {
  return doNotTrackValues.has(value?.toLowerCase() ?? '');
}

export function analyticsMode(
  enabled: boolean,
  production: boolean,
  doNotTrack?: string | null,
): AnalyticsMode {
  if (!enabled || doNotTrackEnabled(doNotTrack)) return 'off';
  return production ? 'umami' : 'console';
}

const consoleTracker: UmamiTracker = {
  track(event, data) {
    console.log('analytics', event ?? 'pageview', data ?? {});
  },
};

export function submittedAnswerCount(attempts: readonly AttemptEvent[]) {
  return attempts.filter(
    (attempt) => attempt.payload.evaluation.status !== 'unknown',
  ).length;
}

export function unsentMilestones(count: number, sent: readonly number[]) {
  const sentSet = new Set(sent);
  return milestones.filter(
    (milestone) => count >= milestone && !sentSet.has(milestone),
  );
}

function loadUmami(websiteId: string) {
  if (umamiScript) return umamiScript;
  umamiScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = 'umami-analytics';
    script.src = 'https://cloud.umami.is/script.js';
    script.async = true;
    script.dataset.websiteId = websiteId;
    script.dataset.autoTrack = 'false';
    script.addEventListener(
      'load',
      () => {
        if (!window.umami) {
          script.remove();
          umamiScript = undefined;
          reject(new Error('Umami tracker did not initialize'));
          return;
        }
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => {
        script.remove();
        umamiScript = undefined;
        reject(new Error('Unable to load Umami tracker'));
      },
      { once: true },
    );
    document.head.append(script);
  });
  return umamiScript;
}

export function startAnalytics(
  enabled: boolean,
  count: number,
  hadPriorPractice: boolean,
  repository: Repository,
) {
  const mode = analyticsMode(enabled, import.meta.env.PROD);
  analyticsEnabled = mode !== 'off';
  submittedCount = count;
  hadPracticeBeforeVisit ||= hadPriorPractice;
  if (mode === 'off') return;

  const websiteId: unknown = import.meta.env.VITE_UMAMI_WEBSITE_ID;
  if (
    mode === 'umami' &&
    (typeof websiteId !== 'string' || !websiteId.trim())
  ) {
    return;
  }

  analyticsWork = analyticsWork
    .then(async () => {
      if (!analyticsEnabled) return;
      if (mode === 'umami' && typeof websiteId === 'string') {
        await loadUmami(websiteId.trim());
      }
      if (!analyticsEnabled || doNotTrackEnabled()) return;
      const tracker = mode === 'umami' ? window.umami : consoleTracker;
      if (!tracker) return;

      if (!pageviewSent) {
        tracker.track();
        pageviewSent = true;
      }

      if (hadPracticeBeforeVisit && !returnedSent) {
        tracker.track('practice_returned');
        returnedSent = true;
      }

      if (!sentMilestones) {
        const saved = await repository.getSetting('analyticsMilestones');
        sentMilestones = new Set(
          Array.isArray(saved)
            ? saved.filter((value): value is PracticeMilestone =>
                milestones.includes(value as PracticeMilestone),
              )
            : [],
        );
      }
      for (const milestone of unsentMilestones(submittedCount, [
        ...sentMilestones,
      ])) {
        if (!analyticsEnabled || doNotTrackEnabled()) return;
        tracker.track('practice_milestone', { milestone });
        sentMilestones.add(milestone);
        await repository.setSetting('analyticsMilestones', [...sentMilestones]);
      }
    })
    .catch(() => {});
}
