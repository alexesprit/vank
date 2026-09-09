import type { Trainer } from '../trainer.ts';
import { TRAINER_CONFIG } from '../core/config.ts';
import { renderStats } from './stats-view.ts';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export function showError(error: unknown) {
  const message = element('error'); message.hidden = false;
  message.textContent = error instanceof Error ? error.message : 'Не удалось продолжить. Попробуйте ещё раз.';
}
export function mountTrainer(trainer: Trainer) {
  const input = element<HTMLInputElement>('answer'), form = element<HTMLFormElement>('answer-form');
  const check = element<HTMLButtonElement>('check'), skip = element<HTMLButtonElement>('skip'), next = element<HTMLButtonElement>('next');
  const sessionStart = trainer.state.recent.length;
  function render() {
    const { word } = trainer.current, result = trainer.result;
    element('word').textContent = word.word;
    element('result').hidden = !result;
    input.readOnly = Boolean(result); check.hidden = Boolean(result); skip.hidden = Boolean(result); next.hidden = !result;
    if (result) {
      element('result').className = `result ${result.correct ? 'success' : result.status === 'unknown' ? 'neutral' : 'error'}`;
      element('result-title').textContent = { correct: 'Верно', partial: 'Почти верно', incorrect: 'Пока неверно', unknown: 'Запомним это слово', ambiguous: 'Неоднозначный ответ' }[result.status];
      element('reading').textContent = `${word.acceptedCyrillic[0]} · ${word.readingLatin}`;
      element('meaning').textContent = word.meaning?.[TRAINER_CONFIG.learnerLanguage] ?? '';
      const mistakes = result.units.filter(u => u.observation === 0);
      element('mistakes').textContent = result.status === 'unknown' ? '' : mistakes.length ? `Обратите внимание: ${mistakes.map(u => `${u.source} → ${u.expected}`).join(' · ')}` : result.status === 'ambiguous' ? 'Сравните ответ с чтением выше.' : '';
      next.focus();
    } else { input.value = ''; input.focus(); }
    renderStats(trainer.state, sessionStart);
  }
  async function submit(skipped = false) {
    check.disabled = skip.disabled = true; element('error').hidden = true;
    try { await trainer.submit(input.value, skipped); render(); }
    catch (error) { showError(error); input.focus(); }
    finally { check.disabled = skip.disabled = false; }
  }
  function advance() { try { trainer.next(); render(); } catch (error) { showError(error); } }
  form.addEventListener('submit', event => { event.preventDefault(); if (trainer.result) advance(); else void submit(); });
  skip.addEventListener('click', () => void submit(true)); next.addEventListener('click', advance);
  element('trainer').hidden = false; element('loading').hidden = true; render();
}
