import type { Dictionary, Evaluation } from '../../../shared/types.ts';
import { TRAINER_CONFIG } from '../core/config.ts';
import { metadataHintLabels } from '../core/metadata-hints.ts';
import { countCorrectAnswers } from '../core/session.ts';
import { availableTypography, formatPrompt } from '../core/settings.ts';
import { t, typographyName } from '../i18n/index.ts';
import type { Trainer } from '../trainer.ts';
import { mountDebugDialog } from './debug-view.ts';
import { mountSettings } from './settings-view.ts';
import { mountStatsDialog, renderStats } from './stats-view.ts';

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export function formatMistakes(units: Evaluation['units']) {
  return [
    ...new Set(
      units
        .filter((unit) => unit.observation === 0)
        .map((unit) => `${unit.source} → ${unit.expected}`),
    ),
  ].join(' · ');
}
export function showError(error: unknown) {
  const message = element('error');
  message.hidden = false;
  message.textContent =
    error instanceof Error ? error.message : t('status.genericError');
}
function mountIntro(
  trainer: Trainer,
  renderTrainer: () => void,
  startFlash: () => void,
) {
  const dialog = element<HTMLDialogElement>('intro-dialog');
  const quickSettings = element('intro-quick-settings');
  const quickMetadataHints = element<HTMLInputElement>(
    'intro-metadata-hints-setting',
  );
  const firstRun = !trainer.introShown;
  let promptStarted = !firstRun;
  const close = () => {
    dialog.close();
    quickSettings.hidden = true;
    renderTrainer();
    if (!promptStarted) {
      promptStarted = true;
      startFlash();
    } else trainer.resumeFlash();
  };
  element('help-open').addEventListener('click', () => {
    trainer.pauseFlash();
    dialog.showModal();
  });
  element('intro-close').addEventListener('click', close);
  element('intro-start').addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  if (firstRun) {
    quickSettings.hidden = false;
    quickMetadataHints.checked = trainer.settings.metadataHints;
    quickMetadataHints.addEventListener('change', async () => {
      try {
        await trainer.setSettings({
          ...trainer.settings,
          metadataHints: quickMetadataHints.checked,
        });
        renderTrainer();
      } catch (error) {
        quickMetadataHints.checked = trainer.settings.metadataHints;
        showError(error);
      }
    });
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
  const wordWrap = element('word-wrap');
  const prompt = element('word');
  const flashReveal = element<HTMLButtonElement>('flash-reveal');
  const sessionStart = trainer.state.recent.length;
  const fitPrompt = () => {
    const availableWidth = wordWrap.clientWidth;
    if (!availableWidth) return;
    prompt.style.fontSize = '';
    const maxSize = Number.parseFloat(getComputedStyle(prompt).fontSize);
    const renderedWidth = prompt.scrollWidth;
    if (renderedWidth <= availableWidth) return;
    const estimatedSize = (maxSize * availableWidth * 0.99) / renderedWidth;
    prompt.style.fontSize = `${estimatedSize}px`;
    if (prompt.scrollWidth > availableWidth)
      prompt.style.fontSize = `${(estimatedSize * availableWidth * 0.99) / prompt.scrollWidth}px`;
  };
  new ResizeObserver(fitPrompt).observe(wordWrap);
  function render(resetInput = true) {
    const { word } = trainer.current,
      result = trainer.result;
    prompt.textContent = formatPrompt(word.word, trainer.presentation.caseMode);
    const canReveal = trainer.flashHidden && !result;
    wordWrap.classList.toggle('flash-is-hidden', canReveal);
    flashReveal.ariaHidden = String(!canReveal);
    flashReveal.tabIndex = canReveal ? 0 : -1;
    prompt.style.fontFamily = trainer.font.family;
    prompt.style.fontStyle = trainer.presentation.italic ? 'italic' : 'normal';
    fitPrompt();
    const hintRow = element('metadata-hint-row');
    const labels = trainer.metadataHintsEnabled
      ? metadataHintLabels(word, (key, fallback) =>
          t(key, { defaultValue: fallback }),
        )
      : [];
    hintRow.replaceChildren(
      ...labels.map((label) => {
        const chip = document.createElement('li');
        chip.className = 'metadata-chip';
        chip.textContent = label;
        return chip;
      }),
    );
    hintRow.hidden = labels.length === 0;
    hintRow.setAttribute('aria-label', t('metadata.label'));
    if (!element<HTMLDialogElement>('intro-dialog').open)
      trainer.setMetadataHintsShown(labels.length > 0);
    const presentationLabel = element<HTMLButtonElement>('presentation-label');
    presentationLabel.textContent = t('trainer.adaptive', {
      mode: typographyName(
        trainer.presentation.caseMode,
        trainer.presentation.italic,
      ),
    });
    presentationLabel.ariaLabel = t('trainer.changeTypography', {
      label: presentationLabel.textContent,
    });
    presentationLabel.disabled =
      trainer.flashHidden ||
      availableTypography(countCorrectAnswers(trainer.state.recent)).length < 2;
    element('result').hidden = !result;
    input.readOnly = Boolean(result);
    check.hidden = Boolean(result);
    skip.hidden = Boolean(result);
    next.hidden = !result;
    if (result) {
      element('result').className =
        `result ${result.correct ? 'success' : result.status === 'unknown' ? 'neutral' : 'error'}`;
      element('result-title').textContent = t(
        `trainer.result.${result.status}`,
      );
      element('reading').textContent =
        `${word.acceptedCyrillic[0]} · ${word.readingLatin}`;
      element('meaning').textContent =
        word.meaning?.[TRAINER_CONFIG.learnerLanguage] ?? '';
      const mistakes = formatMistakes(result.units);
      element('mistakes').textContent =
        result.status === 'unknown'
          ? ''
          : mistakes
            ? t('trainer.mistakes', { mistakes })
            : result.status === 'ambiguous'
              ? t('trainer.compareReading')
              : '';
      next.focus();
    } else {
      if (resetInput) {
        input.value = '';
        input.focus();
      }
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
      trainer.startFlash();
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
  element('presentation-label').addEventListener('click', () => {
    if (trainer.cycleTypography()) {
      render();
      element('presentation-label').focus();
    }
  });
  flashReveal.addEventListener('click', () => {
    trainer.revealFlash();
    render(false);
    input.focus();
  });
  trainer.onFlashChange(() => render(false));
  element('trainer').hidden = false;
  element('loading').hidden = true;
  mountIntro(trainer, render, () => trainer.startFlash());
  mountStatsDialog(mountDebugDialog(trainer, dictionary));
  mountSettings(trainer, render);
  render();
  if (trainer.introShown) trainer.startFlash();
}
