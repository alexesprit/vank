import type { Dictionary } from '../../../shared/types.ts';
import { TRAINER_CONFIG } from '../core/config.ts';
import { formatPrompt } from '../core/settings.ts';
import type { Trainer } from '../trainer.ts';
import { mountDebugDialog } from './debug-view.ts';
import { mountSettings } from './settings-view.ts';
import { mountStatsDialog, renderStats } from './stats-view.ts';

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export function showError(error: unknown) {
  const message = element('error');
  message.hidden = false;
  message.textContent =
    error instanceof Error
      ? error.message
      : 'Не удалось продолжить. Попробуйте ещё раз.';
}
function mountIntro(trainer: Trainer) {
  const dialog = element<HTMLDialogElement>('intro-dialog');
  const close = () => dialog.close();
  element('help-open').addEventListener('click', () => dialog.showModal());
  element('intro-close').addEventListener('click', close);
  element('intro-start').addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  if (!trainer.introShown) {
    dialog.showModal();
    void trainer.markIntroShown().catch(showError);
  }
}
export function mountTrainer(trainer: Trainer, dictionary: Dictionary) {
  const input = element<HTMLInputElement>('answer'),
    form = element<HTMLFormElement>('answer-form');
  const check = element<HTMLButtonElement>('check'),
    skip = element<HTMLButtonElement>('skip'),
    next = element<HTMLButtonElement>('next');
  const sessionStart = trainer.state.recent.length;
  function render() {
    const { word } = trainer.current,
      result = trainer.result;
    const prompt = element('word');
    prompt.textContent = formatPrompt(word.word, trainer.presentation.caseMode);
    prompt.style.fontFamily = trainer.font.family;
    prompt.style.fontStyle = trainer.presentation.italic ? 'italic' : 'normal';
    element('presentation-label').textContent =
      `Адаптивная практика · ${{ caps: 'CAPS', normal: 'Обычный регистр', lower: 'Строчные' }[trainer.presentation.caseMode]}${trainer.presentation.italic ? ' · курсив' : ''}`;
    element('result').hidden = !result;
    input.readOnly = Boolean(result);
    check.hidden = Boolean(result);
    skip.hidden = Boolean(result);
    next.hidden = !result;
    if (result) {
      element('result').className =
        `result ${result.correct ? 'success' : result.status === 'unknown' ? 'neutral' : 'error'}`;
      element('result-title').textContent = {
        correct: 'Верно',
        partial: 'Почти верно',
        incorrect: 'Пока неверно',
        unknown: 'Запомним это слово',
        ambiguous: 'Неоднозначный ответ',
      }[result.status];
      element('reading').textContent =
        `${word.acceptedCyrillic[0]} · ${word.readingLatin}`;
      element('meaning').textContent =
        word.meaning?.[TRAINER_CONFIG.learnerLanguage] ?? '';
      const mistakes = result.units.filter((u) => u.observation === 0);
      element('mistakes').textContent =
        result.status === 'unknown'
          ? ''
          : mistakes.length
            ? `Обратите внимание: ${mistakes.map((u) => `${u.source} → ${u.expected}`).join(' · ')}`
            : result.status === 'ambiguous'
              ? 'Сравните ответ с чтением выше.'
              : '';
      next.focus();
    } else {
      input.value = '';
      input.focus();
    }
    renderStats(trainer.state, sessionStart);
  }
  async function submit(skipped = false) {
    check.disabled = skip.disabled = true;
    element('error').hidden = true;
    try {
      await trainer.submit(input.value, skipped);
      render();
    } catch (error) {
      showError(error);
      input.focus();
    } finally {
      check.disabled = skip.disabled = false;
    }
  }
  async function advance() {
    try {
      await trainer.next();
      render();
    } catch (error) {
      showError(error);
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (trainer.result) void advance();
    else void submit();
  });
  skip.addEventListener('click', () => void submit(true));
  next.addEventListener('click', () => void advance());
  element('trainer').hidden = false;
  element('loading').hidden = true;
  mountIntro(trainer);
  mountStatsDialog(mountDebugDialog(trainer, dictionary));
  mountSettings(trainer, render);
  render();
}
