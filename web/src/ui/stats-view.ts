import type { LearnerState } from '../../../shared/types.ts';
import { progress } from '../core/session.ts';
import { fontName, t, typographyName } from '../i18n/index.ts';

const percentage = (value: number | null) =>
  value === null ? '—' : `${Math.round(value * 100)}%`;
const element = (id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found;
};
export function renderStats(state: LearnerState, sessionStart: number) {
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
      cell.className = `alphabet-cell ${stat.introduced ? stat.state : 'placeholder'}`;
      cell.setAttribute(
        'aria-label',
        stat.introduced
          ? t('progress.alphabetScore', {
              letter: stat.letter,
              score: percentage(stat.score),
            })
          : t('progress.alphabetNotIntroduced', { letter: stat.letter }),
      );
      if (stat.introduced)
        cell.style.setProperty('--score', percentage(stat.score));
      const letter = document.createElement('span');
      letter.className = stat.introduced
        ? 'alphabet-letter'
        : 'alphabet-placeholder';
      letter.lang = 'hy';
      letter.textContent = stat.introduced ? stat.letter : '·';
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
      const chip = document.createElement('span');
      chip.className = 'letter-chip';
      chip.lang = 'hy';
      chip.textContent = letter;
      return chip;
    }),
  );
  if (!stats.weakLetters.length)
    weak.textContent = stats.introduced
      ? t('progress.keepGoing')
      : t('progress.start');
  const fontStats = element('font-stats');
  fontStats.replaceChildren(
    ...stats.fontStats.map((stat) => {
      const row = document.createElement('p');
      row.className = stat.weakLetters.length
        ? 'font-stat weak-font'
        : 'font-stat';
      const summary = `${fontName(stat.fontId)}: ${percentage(stat.accuracy)}`;
      row.textContent = stat.weakLetters.length
        ? t('progress.weaker', {
            letters: stat.weakLetters.join(' '),
            summary,
          })
        : summary;
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
