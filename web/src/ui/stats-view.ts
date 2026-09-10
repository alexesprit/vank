import type { LearnerState } from '../../../shared/types.ts';
import { progress } from '../core/session.ts';
import { FONTS } from '../core/settings.ts';

const percentage = (value: number | null) =>
  value === null ? '—' : `${Math.round(value * 100)}%`;
const element = (id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found;
};
export function renderStats(state: LearnerState, sessionStart: number) {
  const stats = progress(state);
  for (const [id, value] of Object.entries({
    introduced: stats.introduced,
    strong: stats.strong,
    accuracy: percentage(stats.accuracy),
    verified: percentage(stats.verifiedAccuracy),
  }))
    element(id).textContent = String(value);
  element('rolling').textContent =
    `Последние 20: ${percentage(stats.rolling20)} · Пропущено: ${stats.skips}`;
  element('session-progress').textContent =
    `Слов за сессию: ${state.recent.length - sessionStart}`;
  const weak = element('weak');
  weak.replaceChildren(
    ...stats.weakLetters.map((letter) => {
      const chip = document.createElement('span');
      chip.className = 'letter-chip armenian-font';
      chip.lang = 'hy';
      chip.textContent = letter;
      return chip;
    }),
  );
  if (!stats.weakLetters.length)
    weak.textContent = stats.introduced
      ? 'Так держать!'
      : 'Начните с первого слова';
  const fontStats = element('font-stats');
  fontStats.replaceChildren(
    ...stats.fontStats.map((stat) => {
      const row = document.createElement('p');
      row.className = stat.weakLetters.length
        ? 'font-stat weak-font'
        : 'font-stat';
      row.textContent = `${FONTS.find((font) => font.id === stat.fontId)?.name ?? stat.fontId}: ${percentage(stat.accuracy)}${stat.weakLetters.length ? ` · слабее: ${stat.weakLetters.join(' ')}` : ''}`;
      return row;
    }),
  );
  if (!stats.fontStats.length)
    fontStats.textContent = 'Появится после первой попытки';
  const typographyStats = element('typography-stats');
  typographyStats.replaceChildren(
    ...stats.typographyStats.map((stat) => {
      const row = document.createElement('p');
      row.className = 'font-stat';
      row.textContent = `${{ caps: 'ПРОПИСНЫЕ', normal: 'Обычный регистр', lower: 'Строчные' }[stat.caseMode]}${stat.italic ? ' · курсив' : ''}: ${percentage(stat.accuracy)}`;
      return row;
    }),
  );
  if (!stats.typographyStats.length)
    typographyStats.textContent = 'Появится после первой попытки';
}

export function mountStatsDialog() {
  const dialog = element('progress-dialog') as HTMLDialogElement;
  element('progress-open').addEventListener('click', () => dialog.showModal());
  element('progress-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
