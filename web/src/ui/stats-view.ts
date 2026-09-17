import { ALPHABET } from '../../../shared/armenian.ts';
import type {
  AttemptEvent,
  CaseMode,
  LearnerState,
} from '../../../shared/types.ts';
import { progress } from '../core/progress.ts';
import {
  type ResponseSpeedFinding,
  responseSpeed,
} from '../core/response-speed.ts';
import { FONTS } from '../core/settings.ts';
import { fontName, t, typographyName } from '../i18n/index.ts';
import type { Trainer } from '../trainer.ts';
import { applyArmenianFontFamily } from './armenian-font.ts';
import { mountTooltips } from './tooltip.ts';

const fontFamilyById = new Map(FONTS.map(({ id, family }) => [id, family]));
const alphabetByUpper = new Map(
  ALPHABET.map((letter) => [letter.upper, letter]),
);

const percentage = (value: number | null) =>
  value === null ? '—' : `${Math.round(value * 100)}%`;
const fluencyDuration = (milliseconds: number) => {
  const locale = document.documentElement.lang || undefined;
  return milliseconds >= 1000
    ? t('progress.fluencySeconds', {
        value: new Intl.NumberFormat(locale, {
          maximumFractionDigits: 1,
        }).format(milliseconds / 1000),
      })
    : t('progress.fluencyMilliseconds', {
        value: Math.round(milliseconds),
      });
};
const fluencyFindingLabel = (finding: ResponseSpeedFinding) => {
  switch (finding.dimension) {
    case 'familiarity':
      return t(`progress.familiarity.${finding.key}`);
    case 'wordLength':
      return t(`progress.wordLength.${finding.key}`);
    case 'font':
      return fontName(finding.key);
    case 'typography': {
      const [caseMode, italic] = finding.key.split(':');
      return typographyName(
        (caseMode ?? 'caps') as CaseMode,
        italic === 'true',
      );
    }
    case 'practiceMode':
      return t('progress.fluencyPracticeMode', {
        mode: t(`modes.${finding.key}`),
      });
    case 'promptMode':
      return t(`progress.promptMode.${finding.key}`);
  }
};
export const alphabetLetterText = (upper: string, lower: string) =>
  upper === 'և' ? lower : `${upper}${lower}`;
const readingCharacter = /^[\p{Script=Latin}\p{Script=Cyrillic}]$/u;
const minimumMixupObservations = 3;
const mixupAttemptWindow = 50;

export function commonMixups(attempts: readonly AttemptEvent[]) {
  const totals = new Map<string, number>();
  const pairs = new Map<
    string,
    { source: string; expected: string; actual: string; count: number }
  >();
  for (const attempt of attempts.slice(0, mixupAttemptWindow)) {
    const { evaluation } = attempt.payload;
    if (evaluation.status === 'unknown' || evaluation.status === 'ambiguous')
      continue;
    for (const unit of evaluation.units) {
      const expected = [...unit.expected];
      if (
        unit.observation === null ||
        !alphabetByUpper.has(unit.source) ||
        [...unit.source].length !== 1 ||
        expected.length !== 1 ||
        !readingCharacter.test(expected[0])
      )
        continue;
      const key = `${unit.source}\0${expected[0]}`;
      totals.set(key, (totals.get(key) ?? 0) + 1);
      const actual = [...unit.actual];
      if (
        unit.observation !== 0 ||
        actual.length !== 1 ||
        actual[0] === expected[0] ||
        !readingCharacter.test(actual[0])
      )
        continue;
      const pairKey = `${key}\0${actual[0]}`;
      const pair = pairs.get(pairKey);
      if (pair) pair.count++;
      else
        pairs.set(pairKey, {
          source: unit.source,
          expected: expected[0],
          actual: actual[0],
          count: 1,
        });
    }
  }
  return [...pairs.values()]
    .map((pair) => ({
      ...pair,
      total: totals.get(`${pair.source}\0${pair.expected}`) ?? pair.count,
    }))
    .filter((pair) => pair.total >= minimumMixupObservations)
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.count / b.total - a.count / a.total ||
        a.source.localeCompare(b.source),
    )
    .slice(0, 5);
}

const element = (id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found;
};
export function recentProgress(state: LearnerState) {
  const ordinary = state.recent.filter(
    (attempt) => !(attempt.payload.flashMode && !attempt.payload.flashRevealed),
  );
  return progress({ ...state, recent: ordinary.slice(0, 50) });
}
export function renderStats(
  state: LearnerState,
  sessionStart: number,
  fontFamily: string,
) {
  const stats = progress(state);
  const recentStats = recentProgress(state);
  const emptyStats = () => {
    const row = document.createElement('p');
    row.className = 'font-stat';
    row.textContent = t('progress.empty');
    return row;
  };
  element('strong-help').dataset.tooltip = t('progress.strongHint');
  element('accuracy-help').dataset.tooltip = t('progress.accuracyHint');
  element('verified-help').dataset.tooltip = t('progress.verifiedHint');
  const needsPracticeHelp = element('needs-practice-help');
  needsPracticeHelp.hidden = stats.weakLetters.length === 0;
  needsPracticeHelp.dataset.tooltip = t('progress.needsPracticeHint');
  for (const [id, value] of Object.entries({
    introduced: stats.introduced,
    strong: stats.strong,
    accuracy: percentage(recentStats.accuracy),
    verified: percentage(recentStats.verifiedAccuracy),
  }))
    element(id).textContent = String(value);
  const fluency = responseSpeed(state.recent);
  element('fluency-word-median').textContent =
    fluency.medianResponseMs === null
      ? '—'
      : fluencyDuration(fluency.medianResponseMs);
  element('fluency-letter-median').textContent =
    fluency.medianMsPerLetter === null
      ? '—'
      : fluencyDuration(fluency.medianMsPerLetter);
  element('fluency-trend-row').hidden = fluency.changePercent === null;
  element('fluency-trend').textContent =
    fluency.changePercent === null
      ? '—'
      : fluency.changePercent > 0
        ? t('progress.fluencySlower', {
            change: `+${fluency.changePercent}%`,
          })
        : fluency.changePercent < 0
          ? t('progress.fluencyFaster', {
              change: `−${Math.abs(fluency.changePercent)}%`,
            })
          : t('progress.fluencyUnchanged');
  const slowLetterSection = element('fluency-letter-section');
  slowLetterSection.hidden = fluency.slowLetters.length === 0;
  element('fluency-slow-letters').replaceChildren(
    ...fluency.slowLetters.map((stat) => {
      const row = document.createElement('p');
      row.className = 'fluency-finding';
      const letter = document.createElement('span');
      letter.lang = 'hy';
      letter.textContent = stat.letter;
      applyArmenianFontFamily(letter, fontFamily);
      const value = document.createElement('span');
      value.className = 'fluency-finding-value';
      value.textContent = fluencyDuration(stat.medianMsPerLetter);
      row.append(letter, value);
      return row;
    }),
  );
  const findings = fluency.findings.slice(0, 3);
  const findingsSection = element('fluency-other-section');
  findingsSection.hidden = findings.length === 0;
  element('fluency-findings').replaceChildren(
    ...findings.map((finding) => {
      const row = document.createElement('p');
      row.className = 'fluency-finding';
      const label = document.createElement('span');
      label.textContent = fluencyFindingLabel(finding);
      const value = document.createElement('span');
      value.className = 'fluency-finding-value';
      value.textContent = `+${finding.changePercent}%`;
      row.append(label, value);
      return row;
    }),
  );
  element('session-progress').textContent = t('progress.sessionWords', {
    count: state.recent.length - sessionStart,
  });
  element('alphabet-summary-count').textContent =
    `${stats.introduced} / ${stats.alphabetStats.length}`;
  element('alphabet-summary-text').textContent = ` ${t(
    'progress.alphabetSummary',
    { score: percentage(stats.averageScore) },
  )}`;
  const alphabetGrid = element('alphabet-grid');
  alphabetGrid.setAttribute('aria-label', t('progress.alphabetGridLabel'));
  alphabetGrid.replaceChildren(
    ...stats.alphabetStats.map((stat) => {
      const cell = document.createElement('div');
      const alphabetLetter = alphabetByUpper.get(stat.letter);
      if (!alphabetLetter)
        throw new Error(`Unknown alphabet letter: ${stat.letter}`);
      const mapping = `${stat.letter} → ${alphabetLetter.readingLatin[0]} · ${alphabetLetter.readingCyrillic[0]}`;
      cell.className = `alphabet-cell ${stat.introduced ? stat.state : 'placeholder'}`;
      cell.setAttribute('role', 'group');
      cell.tabIndex = 0;
      if (stat.introduced) cell.dataset.tooltip = mapping;
      cell.setAttribute(
        'aria-label',
        `${
          stat.introduced
            ? t('progress.alphabetScore', {
                letter: stat.letter,
                score: percentage(stat.score),
              })
            : t('progress.alphabetNotIntroduced', { letter: stat.letter })
        }${stat.introduced ? `. ${mapping}` : ''}`,
      );
      if (stat.introduced)
        cell.style.setProperty('--score', percentage(stat.score));
      const letter = document.createElement('span');
      letter.className = stat.introduced
        ? 'alphabet-letter'
        : 'alphabet-placeholder';
      letter.lang = 'hy';
      letter.textContent = stat.introduced
        ? alphabetLetterText(stat.letter, alphabetLetter.lower)
        : '·';
      applyArmenianFontFamily(letter, fontFamily);
      cell.append(letter);
      if (stat.introduced) {
        const score = document.createElement('span');
        score.className = 'alphabet-score';
        score.textContent = percentage(stat.score);
        cell.append(score);
      }
      return cell;
    }),
  );
  const legend = element('alphabet-legend');
  legend.replaceChildren(
    ...(['weak', 'learning', 'strong'] as const).map((state) => {
      const item = document.createElement('span');
      const dot = document.createElement('i');
      dot.className = `legend-dot ${state}`;
      item.append(
        dot,
        document.createTextNode(t(`progress.alphabet.${state}`)),
      );
      return item;
    }),
  );
  const weak = element('weak');
  weak.replaceChildren(
    ...stats.weakLetters.map((letter) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'letter-chip';
      chip.dataset.letter = letter;
      chip.setAttribute('aria-label', t('progress.practiceLetter', { letter }));
      chip.lang = document.documentElement.lang;
      const glyph = document.createElement('span');
      glyph.lang = 'hy';
      glyph.textContent = alphabetLetterText(
        letter,
        letter.toLocaleLowerCase('hy'),
      );
      chip.append(glyph);
      applyArmenianFontFamily(chip, fontFamily);
      return chip;
    }),
  );
  if (!stats.weakLetters.length)
    weak.textContent = stats.introduced
      ? t('progress.keepGoing')
      : t('progress.start');
  const mixups = element('confusion-stats');
  const commonMixupsList = commonMixups(state.recent);
  if (commonMixupsList.length) {
    const list = document.createElement('ol');
    list.className = 'confusion-list';
    list.replaceChildren(
      ...commonMixupsList.map((mixup) => {
        const rate = Math.round((mixup.count / mixup.total) * 100);
        const row = document.createElement('li');
        row.className = 'confusion-item';
        const source = document.createElement('span');
        source.className = 'letter-chip confusion-letter';
        source.lang = 'hy';
        source.textContent = alphabetLetterText(
          mixup.source,
          mixup.source.toLocaleLowerCase('hy'),
        );
        applyArmenianFontFamily(source, fontFamily);
        const details = document.createElement('div');
        details.className = 'confusion-details';
        const label = document.createElement('span');
        label.className = 'confusion-label';
        label.textContent = t('progress.mixupLabel', {
          expected: mixup.expected,
          actual: mixup.actual,
        });
        const meta = document.createElement('div');
        meta.className = 'confusion-meta';
        const bar = document.createElement('progress');
        bar.className = 'confusion-bar';
        bar.max = 100;
        bar.value = rate;
        bar.setAttribute(
          'aria-label',
          t('progress.mixupAria', {
            letter: mixup.source,
            expected: mixup.expected,
            actual: mixup.actual,
            count: mixup.count,
            total: mixup.total,
            rate,
          }),
        );
        const count = document.createElement('span');
        count.className = 'confusion-count';
        count.textContent = t('progress.mixupCount', {
          count: mixup.count,
          total: mixup.total,
          rate,
        });
        meta.append(count, bar);
        details.append(label, meta);
        row.append(source, details);
        return row;
      }),
    );
    mixups.replaceChildren(list);
  } else {
    const emptyMixups = document.createElement('p');
    emptyMixups.className = 'font-stat';
    emptyMixups.textContent = t('progress.noMixups');
    mixups.replaceChildren(emptyMixups);
  }
  const fontStats = element('font-stats');
  fontStats.replaceChildren(
    ...stats.fontStats.map((stat) => {
      const row = document.createElement('p');
      row.className = 'font-stat';
      const name = document.createElement('strong');
      name.textContent = fontName(stat.fontId);
      const summary = document.createElement('span');
      summary.textContent = t('progress.fontAccuracy', {
        accuracy: percentage(stat.accuracy),
        count: stat.attempts,
      });
      row.append(name, document.createElement('br'), summary);
      if (stat.lowerAccuracyLetters.length) {
        const problemLabel = document.createElement('span');
        problemLabel.className = 'font-stat-warning';
        problemLabel.textContent = t('progress.fontProblemLetters');
        const problemLetters = document.createElement('span');
        problemLetters.className = 'font-stat-warning';
        problemLetters.lang = 'hy';
        problemLetters.textContent = stat.lowerAccuracyLetters.join(' ');
        applyArmenianFontFamily(
          problemLetters,
          fontFamilyById.get(stat.fontId) ?? fontFamily,
        );
        row.append(
          document.createElement('br'),
          problemLabel,
          document.createTextNode(' '),
          problemLetters,
        );
      }
      return row;
    }),
  );
  if (!stats.fontStats.length) fontStats.replaceChildren(emptyStats());
  const typographyStats = element('typography-stats');
  typographyStats.replaceChildren(
    ...stats.typographyStats.map((stat) => {
      const row = document.createElement('p');
      row.className = 'font-stat';
      row.textContent = `${typographyName(stat.caseMode, stat.italic)}: ${percentage(stat.accuracy)}`;
      return row;
    }),
  );
  if (!stats.typographyStats.length)
    typographyStats.replaceChildren(emptyStats());
  const flashStats = element('flash-stats');
  flashStats.replaceChildren(
    ...[
      t('progress.flashUnrevealed', {
        count: stats.flashStats.unrevealed,
        accuracy: percentage(stats.flashStats.unrevealedAccuracy),
      }),
      t('progress.flashRevealed', {
        count: stats.flashStats.revealed,
        accuracy: percentage(stats.flashRevealedStats.accuracy),
      }),
    ].map((text) => {
      const row = document.createElement('p');
      row.className = 'font-stat';
      row.textContent = text;
      return row;
    }),
  );
  if (!stats.flashStats.attempts && !stats.flashRevealedStats.attempts)
    flashStats.replaceChildren(emptyStats());
}

export function mountStatsDialog(
  openDebug: () => Promise<void>,
  trainer: Trainer,
) {
  mountTooltips(
    [
      'strong-help',
      'accuracy-help',
      'verified-help',
      'needs-practice-help',
    ].map((id) => ({
      element: element(id),
      getText: () => element(id).dataset.tooltip ?? '',
    })),
  );
  const dialog = element('progress-dialog') as HTMLDialogElement;
  element('progress-open').addEventListener('click', (event) => {
    trainer.markTimingInterrupted();
    if (event.metaKey || event.ctrlKey) void openDebug();
    else dialog.showModal();
  });
  element('progress-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => trainer.restartResponseTiming());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
