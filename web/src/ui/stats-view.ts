import { ALPHABET } from '../../../shared/armenian.ts';
import type { AttemptEvent, LearnerState } from '../../../shared/types.ts';
import { progress } from '../core/session.ts';
import { FONTS } from '../core/settings.ts';
import { fontName, t, typographyName } from '../i18n/index.ts';
import { applyArmenianFontFamily } from './armenian-font.ts';

const fontFamilyById = new Map(FONTS.map(({ id, family }) => [id, family]));
const alphabetByUpper = new Map(
  ALPHABET.map((letter) => [letter.upper, letter]),
);

const percentage = (value: number | null) =>
  value === null ? '—' : `${Math.round(value * 100)}%`;
const readingCharacter = /^[\p{Script=Latin}\p{Script=Cyrillic}]$/u;
const minimumMixupObservations = 3;

export function commonMixups(attempts: readonly AttemptEvent[]) {
  const totals = new Map<string, number>();
  const pairs = new Map<
    string,
    { source: string; expected: string; actual: string; count: number }
  >();
  for (const attempt of attempts) {
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
export function renderStats(
  state: LearnerState,
  sessionStart: number,
  fontFamily: string,
) {
  const stats = progress(state);
  const emptyStats = () => {
    const row = document.createElement('p');
    row.className = 'font-stat';
    row.textContent = t('progress.empty');
    return row;
  };
  element('strong-help').dataset.tooltip = t('progress.strongHint');
  element('verified-help').dataset.tooltip = t('progress.verifiedHint');
  for (const [id, value] of Object.entries({
    introduced: stats.introduced,
    strong: stats.strong,
    accuracy: percentage(stats.accuracy),
    verified: percentage(stats.verifiedAccuracy),
  }))
    element(id).textContent = String(value);
  element('rolling').textContent = t('progress.recent', {
    accuracy: percentage(stats.rolling20),
    skips: stats.skips,
  });
  element('session-progress').textContent = t('progress.sessionWords', {
    count: state.recent.length - sessionStart,
  });
  element('alphabet-summary-count').textContent =
    `${stats.introduced} / ${stats.alphabetStats.length}`;
  element('alphabet-summary-text').textContent = ` ${t(
    'progress.alphabetSummary',
    { score: percentage(stats.averageScore) },
  )}`;
  const alphabetInfo = element('alphabet-info');
  alphabetInfo.dataset.tooltip = t('progress.alphabetInfo');
  alphabetInfo.setAttribute('aria-label', t('progress.alphabetInfo'));
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
        ? `${stat.letter}${alphabetLetter.lower}`
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
      glyph.textContent = `${letter}${letter.toLocaleLowerCase('hy')}`;
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
        source.textContent = `${mixup.source}${mixup.source.toLocaleLowerCase('hy')}`;
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
      row.className = stat.weakLetters.length
        ? 'font-stat weak-font'
        : 'font-stat';
      const summary = `${fontName(stat.fontId)}: ${percentage(stat.accuracy)}`;
      if (stat.weakLetters.length) {
        const weakLetters = document.createElement('span');
        weakLetters.lang = 'hy';
        weakLetters.textContent = stat.weakLetters.join(' ');
        applyArmenianFontFamily(
          weakLetters,
          fontFamilyById.get(stat.fontId) ?? fontFamily,
        );
        row.append(
          document.createTextNode(
            t('progress.weaker', { letters: '', summary }),
          ),
          weakLetters,
        );
      } else row.textContent = summary;
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

export function mountStatsDialog(openDebug: () => Promise<void>) {
  const dialog = element('progress-dialog') as HTMLDialogElement;
  element('progress-open').addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey) void openDebug();
    else dialog.showModal();
  });
  element('progress-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
