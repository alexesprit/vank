import type { Dictionary } from '../../../shared/types.ts';
import { doNotTrackEnabled } from '../analytics.ts';
import { metadataHintLabels } from '../core/metadata-hints.ts';
import {
  PRACTICE_MODES,
  type PracticeModeGroup,
  type PracticeModeId,
} from '../core/modes.ts';
import { countCorrectAnswers } from '../core/session.ts';
import {
  FLASH_UNLOCK_AFTER_CORRECT,
  FONTS,
  flashAvailable,
  flashExposureMs,
  SYLLABLE_COLOR_THRESHOLDS,
  TYPOGRAPHY_MODES,
} from '../core/settings.ts';
import { loadDictionary } from '../data/dictionary.ts';
import { fontName, t, typographyName } from '../i18n/index.ts';
import type { LanguagePreference } from '../i18n/types.ts';
import type { Trainer } from '../trainer.ts';
import { renderSyllables } from './syllable-colors.ts';

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

export function mountSettings(
  trainer: Trainer,
  renderTrainer: () => void,
  startAnalytics: () => void,
  onPracticeModeChanged: (dictionary: Dictionary) => void = () => {},
) {
  const dialog = element<HTMLDialogElement>('settings-dialog');
  const progressChannel = new BroadcastChannel('vank-progress');
  progressChannel.addEventListener('message', () => window.location.reload());
  const modeInputs = [
    ...document.querySelectorAll<HTMLInputElement>('[name="font-mode"]'),
  ];
  const language = element<HTMLSelectElement>('language');
  const practiceMode = element<HTMLSelectElement>('practice-mode');
  const practiceModeFieldset = practiceMode.closest('fieldset');
  const analytics = element<HTMLInputElement>('analytics-setting');
  const analyticsDnt = element('analytics-dnt');
  const metadataHints = element<HTMLInputElement>('metadata-hints-setting');
  const syllableColors = element<HTMLInputElement>('syllable-colors-setting');
  const syllableColorsValue = element('syllable-colors-value');
  const syllableColorsPreview = element('syllable-colors-preview-word');
  const introSyllableColors = element<HTMLInputElement>(
    'intro-syllable-colors-setting',
  );
  const introSyllableColorsValue = element('intro-syllable-colors-value');
  const introSyllableColorsPreview = element(
    'intro-syllable-colors-preview-word',
  );
  const metadataHintsPreview = element('metadata-hints-preview-chips');
  const introMetadataHintsPreview = element(
    'intro-metadata-hints-preview-chips',
  );
  const selected = element<HTMLSelectElement>('font-selected');
  const enabled = element('font-enabled');
  const typographyModeInputs = [
    ...document.getElementsByName('typography-mode'),
  ] as HTMLInputElement[];
  const typographySelected = element<HTMLSelectElement>('typography-selected');
  const typographyEnabled = element('typography-enabled');
  const flashEnabled = element<HTMLInputElement>('flash-enabled');
  const flashEnabledLabel = element('flash-enabled-label');
  const flashDurationHint = element('flash-duration-hint');
  const flashDuration = element<HTMLInputElement>('flash-duration');
  const flashDurationValue = element('flash-duration-value');
  const flashPreviewWord = element('flash-preview-word');
  const flashPreviewCountdown = element('flash-preview-countdown');
  const flashPreviewReveal = element<HTMLButtonElement>('flash-preview-reveal');
  let previewInterval: ReturnType<typeof setInterval> | undefined;
  let previewHideTimer: ReturnType<typeof setTimeout> | undefined;
  let previewRemaining = 0;
  let latestApply = 0;
  const resetOpen = element<HTMLButtonElement>('reset-open');
  const resetConfirmation = element('reset-confirmation');
  const resetCancel = element<HTMLButtonElement>('reset-cancel');
  const resetConfirm = element<HTMLButtonElement>('reset-confirm');
  const resetError = element('reset-error');

  function stopPreview() {
    if (previewInterval !== undefined) clearInterval(previewInterval);
    if (previewHideTimer !== undefined) clearTimeout(previewHideTimer);
    previewInterval = undefined;
    previewHideTimer = undefined;
  }

  function setPreviewHidden(hidden: boolean) {
    flashPreviewWord
      .closest('.flash-preview')
      ?.classList.toggle('is-hidden', hidden);
    flashPreviewReveal.ariaHidden = String(!hidden);
    flashPreviewReveal.tabIndex = hidden ? 0 : -1;
  }

  function startPreview() {
    stopPreview();
    const exposureMs = flashExposureMs(
      Number(flashDuration.value) * 1000,
      [...flashPreviewWord.textContent].length,
    );
    previewRemaining = Math.ceil(exposureMs / 1000);
    setPreviewHidden(false);
    flashPreviewCountdown.textContent = `${previewRemaining} s`;
    previewInterval = setInterval(() => {
      if (previewRemaining > 1) {
        previewRemaining -= 1;
        flashPreviewCountdown.textContent = `${previewRemaining} s`;
      }
    }, 1000);
    previewHideTimer = setTimeout(() => {
      if (previewInterval !== undefined) clearInterval(previewInterval);
      previewInterval = undefined;
      setPreviewHidden(true);
      flashPreviewCountdown.textContent = '';
      previewHideTimer = setTimeout(startPreview, 2000);
    }, exposureMs);
  }

  selected.replaceChildren(
    ...FONTS.map((font) => new Option(fontName(font.id), font.id)),
  );
  enabled.replaceChildren(
    ...FONTS.map((font) => {
      const label = document.createElement('label');
      label.className = 'font-choice';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = font.id;
      const text = document.createElement('span');
      text.textContent = fontName(font.id);
      label.append(input, text);
      return label;
    }),
  );
  typographySelected.replaceChildren(
    ...TYPOGRAPHY_MODES.map(
      (mode) => new Option(typographyName(mode.caseMode, mode.italic), mode.id),
    ),
  );
  typographyEnabled.replaceChildren(
    ...TYPOGRAPHY_MODES.map((mode) => {
      const label = document.createElement('label');
      label.className = 'font-choice';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = mode.id;
      label.append(
        input,
        document.createTextNode(typographyName(mode.caseMode, mode.italic)),
      );
      return label;
    }),
  );
  const modeGroups = new Map<PracticeModeGroup, HTMLOptGroupElement>();
  for (const mode of PRACTICE_MODES) {
    let group = modeGroups.get(mode.group);
    if (!group) {
      group = document.createElement('optgroup');
      group.label = t(`modes.${mode.group}`);
      modeGroups.set(mode.group, group);
    }
    group.append(new Option(t(mode.labelKey), mode.id));
  }
  practiceMode.replaceChildren(...modeGroups.values());
  const modeTooltip = element<HTMLElement>('mode-tooltip');
  for (const [id, key] of [
    ['adaptive-mode-help', 'modes.adaptiveHint'],
    ['packs-mode-help', 'modes.packsHint'],
  ] as const) {
    const help = element<HTMLElement>(id);
    const positionTooltip = () => {
      const { bottom, left, width } = help.getBoundingClientRect();
      const container = help.closest('.practice-mode-help');
      const bounds = container?.getBoundingClientRect();
      const availableWidth = bounds?.width ?? window.innerWidth;
      const tooltipWidth = Math.min(220, Math.max(0, availableWidth - 32));
      const minLeft = Math.min(16, availableWidth - tooltipWidth);
      const maxLeft = Math.max(minLeft, availableWidth - 16 - tooltipWidth);
      const centeredLeft =
        left + width / 2 - (bounds?.left ?? 0) - tooltipWidth / 2;
      modeTooltip.style.left = `${Math.min(
        maxLeft,
        Math.max(minLeft, centeredLeft),
      )}px`;
      modeTooltip.style.top = `${bottom - (bounds?.top ?? 0) + 8}px`;
      modeTooltip.style.width = `${tooltipWidth}px`;
      modeTooltip.textContent = t(key);
      modeTooltip.hidden = false;
    };
    const hideTooltip = () => {
      modeTooltip.hidden = true;
    };
    help.addEventListener('mouseenter', positionTooltip);
    help.addEventListener('focus', positionTooltip);
    help.addEventListener('mouseleave', () => {
      if (document.activeElement !== help) hideTooltip();
    });
    help.addEventListener('blur', () => {
      if (!help.matches(':hover')) hideTooltip();
    });
  }
  if (practiceModeFieldset)
    practiceModeFieldset.hidden = PRACTICE_MODES.length < 2;

  const previewLabels = metadataHintLabels(
    { categories: ['transport'], tags: ['beginner'] },
    (key, fallback) => t(key, { defaultValue: fallback }),
  );
  for (const preview of [metadataHintsPreview, introMetadataHintsPreview])
    preview.replaceChildren(
      ...previewLabels.map((label) => {
        const chip = document.createElement('span');
        chip.className = 'metadata-chip';
        chip.textContent = label;
        return chip;
      }),
    );

  const selectedSyllableThreshold = () =>
    SYLLABLE_COLOR_THRESHOLDS[Number(syllableColors.value)] ?? 0;

  function renderSyllableThreshold(threshold = selectedSyllableThreshold()) {
    const label = threshold ? `${threshold}+` : t('settings.syllableColorsOff');
    syllableColorsValue.textContent = label;
    introSyllableColorsValue.textContent = label;
    syllableColors.setAttribute('aria-valuetext', label);
    introSyllableColors.setAttribute('aria-valuetext', label);
    renderSyllables(introSyllableColorsPreview, 'ԲՈՒՐԺՈՒԱԿԱՆ', threshold);
  }

  function render() {
    const { fonts } = trainer.settings;
    const { typography } = trainer.settings;
    language.value = trainer.settings.language;
    practiceMode.value = trainer.settings.practiceMode;
    const dnt = doNotTrackEnabled();
    analytics.checked = trainer.settings.analytics && !dnt;
    analytics.disabled = dnt;
    analyticsDnt.hidden = !dnt;
    metadataHints.checked = trainer.settings.metadataHints;
    syllableColors.value = String(
      SYLLABLE_COLOR_THRESHOLDS.indexOf(trainer.settings.syllableColors),
    );
    introSyllableColors.value = syllableColors.value;
    renderSyllableThreshold(trainer.settings.syllableColors);
    renderSyllables(syllableColorsPreview, 'ԲՈՒՐԺՈՒԱԿԱՆ', 2);
    flashEnabled.checked = trainer.settings.flash.enabled;
    flashDurationHint.dataset.tooltip = t('settings.flashDurationHint');
    const correctAnswers = countCorrectAnswers(trainer.state.recent);
    const flashUnlocked = flashAvailable(correctAnswers);
    flashEnabled.disabled = !flashUnlocked;
    flashEnabledLabel.textContent = flashUnlocked
      ? t('settings.enableFlash')
      : t('settings.unlockAfter', {
          count: FLASH_UNLOCK_AFTER_CORRECT,
          name: t('settings.flash'),
        });
    flashDuration.value = String(trainer.settings.flash.exposureMs / 1000);
    flashDurationValue.textContent = `${flashDuration.value} s`;
    for (const input of modeInputs) input.checked = input.value === fonts.mode;
    for (const option of selected.options)
      option.disabled =
        correctAnswers <
        (FONTS.find((font) => font.id === option.value)?.unlockAfterCorrect ??
          0);
    selected.value = fonts.selected;
    selected.disabled = fonts.mode !== 'single';
    for (const input of enabled.querySelectorAll<HTMLInputElement>('input')) {
      const font = FONTS.find((font) => font.id === input.value);
      if (!font) continue;
      const locked = correctAnswers < font.unlockAfterCorrect;
      input.checked = fonts.enabled.includes(input.value);
      input.disabled = fonts.mode !== 'rotate' || locked;
      if (input.nextElementSibling)
        input.nextElementSibling.textContent = locked
          ? t('settings.unlockAfter', {
              count: font.unlockAfterCorrect,
              name: fontName(font.id),
            })
          : fontName(font.id);
    }
    for (const input of typographyModeInputs)
      input.checked = input.value === typography.mode;
    for (const option of typographySelected.options)
      option.disabled =
        correctAnswers <
        (TYPOGRAPHY_MODES.find((mode) => mode.id === option.value)
          ?.unlockAfterCorrect ?? 0);
    typographySelected.value = typography.selected;
    typographySelected.disabled = typography.mode !== 'single';
    for (const input of typographyEnabled.querySelectorAll<HTMLInputElement>(
      'input',
    )) {
      const mode = TYPOGRAPHY_MODES.find((mode) => mode.id === input.value);
      if (!mode) continue;
      const locked = correctAnswers < mode.unlockAfterCorrect;
      input.checked = typography.enabled.includes(input.value);
      input.disabled = typography.mode !== 'rotate' || locked;
      const text = input.parentElement?.lastChild;
      if (text)
        text.textContent = locked
          ? t('settings.unlockAfter', {
              count: mode.unlockAfterCorrect,
              name: typographyName(mode.caseMode, mode.italic),
            })
          : typographyName(mode.caseMode, mode.italic);
    }
  }

  async function apply() {
    const applyId = ++latestApply;
    const languageChanged = language.value !== trainer.settings.language;
    const practiceModeChanged =
      practiceMode.value !== trainer.settings.practiceMode;
    const requestedPracticeMode = practiceMode.value as PracticeModeId;
    const analyticsChanged = analytics.checked !== trainer.settings.analytics;
    const dnt = doNotTrackEnabled();
    const mode = modeInputs.find((input) => input.checked)?.value as
      | 'single'
      | 'rotate';
    const checked = [
      ...enabled.querySelectorAll<HTMLInputElement>('input:checked'),
    ].map((input) => input.value);
    const typographyMode = typographyModeInputs.find((input) => input.checked)
      ?.value as 'single' | 'rotate';
    const typographyChecked = [
      ...typographyEnabled.querySelectorAll<HTMLInputElement>('input:checked'),
    ].map((input) => input.value);
    try {
      const dictionary = practiceModeChanged
        ? await loadDictionary(requestedPracticeMode)
        : undefined;
      if (applyId !== latestApply) return;
      await trainer.setSettings(
        {
          analytics: dnt ? trainer.settings.analytics : analytics.checked,
          language: language.value as LanguagePreference,
          practiceMode: requestedPracticeMode,
          metadataHints: metadataHints.checked,
          syllableColors: selectedSyllableThreshold(),
          flash: {
            enabled: flashEnabled.checked,
            exposureMs: Number(flashDuration.value) * 1000,
          },
          fonts: {
            mode,
            selected: selected.value,
            enabled: checked.length ? checked : ['default'],
          },
          typography: {
            mode: typographyMode,
            selected: typographySelected.value,
            enabled: typographyChecked.length ? typographyChecked : ['caps'],
          },
        },
        dictionary,
      );
      if (dictionary) onPracticeModeChanged(dictionary);
      if (languageChanged) {
        trainer.dispose();
        window.location.reload();
        return;
      }
      if (analyticsChanged && analytics.checked) startAnalytics();
      render();
      renderTrainer();
      startPreview();
    } catch (error) {
      if (applyId !== latestApply) return;
      render();
      const message = document.getElementById('error');
      if (message) {
        message.hidden = false;
        message.textContent =
          error instanceof Error
            ? error.message
            : t('status.saveSettingsError');
      }
    }
  }

  element('settings-open').addEventListener('click', () => {
    trainer.pauseFlash();
    render();
    dialog.showModal();
    startPreview();
  });
  element('settings-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    stopPreview();
    trainer.resumeFlash();
    resetConfirmation.hidden = true;
    resetOpen.hidden = false;
    resetError.hidden = true;
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  resetOpen.addEventListener('click', () => {
    resetOpen.hidden = true;
    resetConfirmation.hidden = false;
    resetCancel.focus();
  });
  resetCancel.addEventListener('click', () => {
    resetConfirmation.hidden = true;
    resetOpen.hidden = false;
    resetError.hidden = true;
    resetOpen.focus();
  });
  resetConfirm.addEventListener('click', async () => {
    resetConfirm.disabled = resetCancel.disabled = true;
    try {
      await trainer.clearProgress();
      progressChannel.postMessage('reset');
      window.location.reload();
    } catch (error) {
      resetConfirm.disabled = resetCancel.disabled = false;
      resetError.hidden = false;
      resetError.textContent =
        error instanceof Error ? error.message : t('status.resetError');
    }
  });
  flashDuration.addEventListener('input', () => {
    flashDurationValue.textContent = `${flashDuration.value} s`;
    if (dialog.open) startPreview();
  });
  syllableColors.addEventListener('input', () => {
    introSyllableColors.value = syllableColors.value;
    renderSyllableThreshold();
  });
  introSyllableColors.addEventListener('input', () => {
    syllableColors.value = introSyllableColors.value;
    renderSyllableThreshold();
  });
  flashPreviewReveal.addEventListener('click', () => {
    startPreview();
    flashDuration.focus();
  });
  for (const control of [
    language,
    practiceMode,
    analytics,
    metadataHints,
    syllableColors,
    introSyllableColors,
    ...modeInputs,
    selected,
    ...enabled.querySelectorAll('input'),
    ...typographyModeInputs,
    typographySelected,
    ...typographyEnabled.querySelectorAll('input'),
    flashEnabled,
    flashDuration,
  ])
    control.addEventListener('change', () => void apply());
  render();
}
