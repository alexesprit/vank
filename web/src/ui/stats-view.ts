import type { LearnerState } from '../../../shared/types.ts';
import { progress } from '../core/session.ts';

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
}
