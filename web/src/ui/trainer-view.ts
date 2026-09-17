import { ALPHABET } from '../../../shared/armenian.ts';
import type {
  CaseMode,
  Dictionary,
  Evaluation,
  Word,
} from '../../../shared/types.ts';
import { doNotTrackEnabled } from '../analytics.ts';
import { TRAINER_CONFIG } from '../core/config.ts';
import { metadataHintLabels } from '../core/metadata-hints.ts';
import { countCorrectAnswers } from '../core/progress.ts';
import { availableTypography } from '../core/settings.ts';
import { t, typographyName } from '../i18n/index.ts';
import type { Trainer } from '../trainer.ts';
import { mountAchievements } from './achievements-view.ts';
import { applyArmenianFontFamily } from './armenian-font.ts';
import { mountDebugDialog } from './debug-view.ts';
import { mountSettings } from './settings-view.ts';
import { createSnackbar } from './snackbar.ts';
import { mountStatsDialog, renderStats } from './stats-view.ts';
import { renderSyllables } from './syllable-colors.ts';

const cyrillicPattern = /\p{Script=Cyrillic}/u;
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
function mistakeMappings(
  units: Evaluation['units'],
  caseMode: CaseMode = 'caps',
) {
  const seen = new Set<string>();
  return units.flatMap((unit) => {
    if (unit.observation !== 0) return [];
    const mappings =
      unit.source === 'և' && caseMode === 'caps'
        ? (['Ե', 'Վ'] as const).map((source) => ({
            source,
            expected: visibleLetterReading(
              source,
              unit.position,
              unit.expected,
            ),
            position: unit.position,
          }))
        : [
            {
              source: formatMappingSource(unit.source, unit.position, caseMode),
              expected: unit.expected,
              position: unit.position,
            },
          ];
    return mappings.filter(({ source, expected }) => {
      const key = `${source}\u0000${expected}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}
function visibleLetterReading(
  letter: string,
  position: number,
  reading: string,
) {
  const alphabetLetter = ALPHABET.find(({ upper }) => upper === letter),
    cyrillic = cyrillicPattern.test(reading);
  return cyrillic
    ? (alphabetLetter?.readingCyrillic[0] ?? reading)
    : letter === 'Ե' && position === 0
      ? 'ye'
      : (alphabetLetter?.readingLatin[0] ?? reading);
}
export function formatMappingSource(
  source: string,
  position: number,
  caseMode: CaseMode,
) {
  if (source === 'և')
    return caseMode === 'caps'
      ? 'ԵՎ'
      : caseMode === 'normal' && position === 0
        ? 'Եվ'
        : 'և';
  return caseMode === 'caps' || (caseMode === 'normal' && position === 0)
    ? source
    : source.toLocaleLowerCase('hy');
}
export function displayMappingUnits(
  word: Pick<Word, 'units'>,
  result: Evaluation,
  locale: string,
) {
  if (
    result.status !== 'unknown' ||
    result.normalizedAnswer ||
    locale !== 'ru' ||
    !word.units
  )
    return result.units;
  return result.units.map((unit, index) => ({
    ...unit,
    expected: word.units?.[index]?.cyrillic ?? unit.expected,
  }));
}
export function formatMistakes(
  units: Evaluation['units'],
  caseMode: CaseMode = 'caps',
) {
  return mistakeMappings(units, caseMode)
    .map((mapping) => `${mapping.source} → ${mapping.expected}`)
    .join(' · ');
}
function renderMistakeMappings(
  container: HTMLElement,
  units: Evaluation['units'],
  labelKey: 'trainer.mapping' | 'trainer.mistakes',
  fontFamily: string,
  presentation: Trainer['presentation'],
) {
  const mappings = mistakeMappings(units, presentation.caseMode);
  if (!mappings.length) {
    container.textContent = '';
    return false;
  }
  const label = document.createElement('span');
  label.className = 'mapping-label';
  label.textContent = t(labelKey, { mapping: '', mistakes: '' }).trim();
  const list = document.createElement('span');
  list.className = 'mapping-list';
  list.append(
    ...mappings.map(({ source, expected }) => {
      const chip = document.createElement('span');
      chip.className = 'mapping-chip';
      const sourceElement = document.createElement('span');
      sourceElement.className = 'mapping-source';
      sourceElement.lang = 'hy';
      sourceElement.textContent = source;
      applyArmenianFontFamily(sourceElement, fontFamily);
      sourceElement.style.fontStyle = presentation.italic ? 'italic' : 'normal';
      const arrow = document.createElement('span');
      arrow.className = 'mapping-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      const reading = document.createElement('span');
      reading.className = 'mapping-reading';
      reading.textContent = expected;
      chip.append(sourceElement, arrow, reading);
      return chip;
    }),
  );
  container.replaceChildren(label, list);
  return true;
}
export function showError(error: unknown) {
  const message = element('error');
  message.hidden = false;
  message.textContent =
    error instanceof Error ? error.message : t('status.genericError');
}
export function mountIntro(
  trainer: Trainer,
  renderTrainer: () => void,
  startFlash: () => void,
  startAnalytics: () => void,
) {
  const dialog = element<HTMLDialogElement>('intro-dialog');
  const quickSettings = element('intro-quick-settings');
  const introAnalytics = element('intro-analytics');
  const quickMetadataHints = element<HTMLInputElement>(
    'intro-metadata-hints-setting',
  );
  const quickAnalytics = element<HTMLInputElement>('intro-analytics-setting');
  const quickAnalyticsDnt = element('intro-analytics-dnt');
  const firstRun = !trainer.introShown;
  let promptStarted = !firstRun;
  const afterClose = () => {
    quickSettings.hidden = true;
    renderTrainer();
    if (!promptStarted) {
      promptStarted = true;
      startFlash();
    } else {
      trainer.resumeFlash();
      trainer.restartResponseTiming();
    }
  };
  const close = () => dialog.close();
  dialog.addEventListener('close', afterClose);
  element('help-open').addEventListener('click', (event) => {
    trainer.markTimingInterrupted();
    trainer.pauseFlash();
    quickSettings.hidden = !(event.metaKey || event.ctrlKey);
    introAnalytics.hidden = true;
    dialog.showModal();
  });
  element('intro-close').addEventListener('click', close);
  element('intro-start').addEventListener('click', () => {
    if (!firstRun || introAnalytics.hidden) {
      close();
      return;
    }
    void (async () => {
      try {
        await trainer.setSettings({
          ...trainer.settings,
          analytics: quickAnalytics.checked,
        });
        close();
        startAnalytics();
      } catch (error) {
        showError(error);
      }
    })();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  if (firstRun) {
    quickSettings.hidden = false;
    introAnalytics.hidden = false;
    quickMetadataHints.checked = trainer.settings.metadataHints;
    const dnt = doNotTrackEnabled();
    quickAnalytics.checked = !dnt;
    quickAnalytics.disabled = dnt;
    quickAnalyticsDnt.hidden = !dnt;
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
export function mountTrainer(
  trainer: Trainer,
  dictionary: Dictionary,
  startAnalytics: () => void,
) {
  let activeDictionary = dictionary;
  const letterSnackbar = createSnackbar();
  const input = element<HTMLInputElement>('answer'),
    form = element<HTMLFormElement>('answer-form');
  const check = element<HTMLButtonElement>('check'),
    skip = element<HTMLButtonElement>('skip'),
    next = element<HTMLButtonElement>('next');
  const wordWrap = element('word-wrap');
  const prompt = element('word');
  const flashReveal = element<HTMLButtonElement>('flash-reveal');
  const presentationTitle = element('presentation-title');
  const presentationSubtitle = element('presentation-subtitle');
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
    renderSyllables(
      prompt,
      word,
      trainer.settings.syllableColors,
      trainer.presentation.caseMode,
    );
    const canReveal = trainer.flashHidden && !result;
    wordWrap.classList.toggle('flash-is-hidden', canReveal);
    flashReveal.ariaHidden = String(!canReveal);
    flashReveal.tabIndex = canReveal ? 0 : -1;
    prompt.style.fontFamily = trainer.font.family;
    prompt.style.fontStyle = trainer.presentation.italic ? 'italic' : 'normal';
    fitPrompt();
    const practiceMode = trainer.practiceMode;
    const hintRow = element('metadata-hint-row');
    const labels = trainer.metadataHintsEnabled
      ? metadataHintLabels(
          word,
          (key, fallback) => t(key, { defaultValue: fallback }),
          practiceMode.strategy === 'finite-pack',
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
    const typography = typographyName(
      trainer.presentation.caseMode,
      trainer.presentation.italic,
    );
    const presentationMode =
      practiceMode.strategy === 'adaptive'
        ? t('trainer.adaptive')
        : t(practiceMode.labelKey);
    presentationTitle.textContent = presentationMode;
    presentationSubtitle.textContent = typography;
    presentationLabel.ariaLabel = t('trainer.changeTypography', {
      label: `${presentationMode} · ${typography}`,
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
      const mistakes = element('mistakes');
      if (
        !renderMistakeMappings(
          mistakes,
          displayMappingUnits(word, result, document.documentElement.lang),
          result.status === 'unknown' ? 'trainer.mapping' : 'trainer.mistakes',
          trainer.font.family,
          trainer.presentation,
        ) &&
        result.status === 'ambiguous'
      )
        mistakes.textContent = t('trainer.compareReading');
      next.focus();
    } else {
      if (resetInput) {
        input.value = '';
        input.focus();
      }
    }
    renderStats(trainer.state, sessionStart, trainer.font.family);
  }
  async function submit(skipped = false) {
    check.disabled = skip.disabled = true;
    element('error').hidden = true;
    try {
      await trainer.submit(input.value, skipped);
      startAnalytics();
      render();
      achievements.show(trainer.lastAchievementUnlocks);
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
  async function practiceLetter(letter: string) {
    letterSnackbar.hide();
    try {
      const selection = await trainer.practiceLetter(letter);
      if (selection === 'target') letterSnackbar.hide();
      else
        letterSnackbar.show({
          label: t('progress.needsPractice'),
          title:
            selection === 'missing'
              ? t('progress.letterMissing', { letter })
              : t('progress.letterUnavailable', { letter }),
        });
      if (selection !== 'target') return;
      render();
      trainer.startFlash();
    } catch (error) {
      showError(error);
    }
  }
  element('weak').addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const letter = event.target.closest<HTMLButtonElement>(
      'button[data-letter]',
    )?.dataset.letter;
    if (letter) void practiceLetter(letter);
  });
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
      trainer.restartResponseTiming();
      element('presentation-label').focus();
    }
  });
  flashReveal.addEventListener('click', () => {
    trainer.revealFlash();
    render(false);
    input.focus();
  });
  trainer.onFlashChange(() => render(false));
  const markTimingInterrupted = () => trainer.markTimingInterrupted();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') markTimingInterrupted();
  });
  document.addEventListener('freeze', markTimingInterrupted);
  window.addEventListener('blur', markTimingInterrupted);
  window.addEventListener('pagehide', markTimingInterrupted);
  element('trainer').hidden = false;
  element('loading').hidden = true;
  mountIntro(trainer, render, () => trainer.startFlash(), startAnalytics);
  mountStatsDialog(
    mountDebugDialog(trainer, () => activeDictionary),
    trainer,
  );
  const achievements = mountAchievements(trainer);
  mountSettings(trainer, render, startAnalytics, (nextDictionary) => {
    activeDictionary = nextDictionary;
  });
  render();
  if (trainer.introShown) trainer.startFlash();
}
