import type { LearnerState } from '../../../shared/types.ts';
import { progress } from '../core/session.ts';
const percentage = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;
export function renderStats(state: LearnerState, sessionStart: number) {
  const stats = progress(state);
  for (const [id, value] of Object.entries({ introduced: stats.introduced, strong: stats.strong, accuracy: percentage(stats.accuracy), verified: percentage(stats.verifiedAccuracy) })) document.getElementById(id)!.textContent = String(value);
  document.getElementById('rolling')!.textContent = `Последние 20: ${percentage(stats.rolling20)} · Пропущено: ${stats.skips}`;
  document.getElementById('session-progress')!.textContent = `Слов за сессию: ${state.recent.length - sessionStart}`;
  const weak = document.getElementById('weak')!;
  weak.replaceChildren(...stats.weakLetters.map(letter => {
    const chip = document.createElement('span'); chip.className = 'letter-chip'; chip.lang = 'hy'; chip.textContent = letter; return chip;
  }));
  if (!stats.weakLetters.length) weak.textContent = stats.introduced ? 'Так держать!' : 'Начните с первого слова';
}
