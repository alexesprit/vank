import { metadataHintLabels } from '../core/metadata-hints.ts';
import { FONTS, TYPOGRAPHY_MODES } from '../core/settings.ts';
import { fontName, t, typographyName } from '../i18n/index.ts';
import type { LanguagePreference } from '../i18n/types.ts';
import type { Trainer } from '../trainer.ts';

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

export function mountSettings(trainer: Trainer, renderTrainer: () => void) {
  const dialog = element<HTMLDialogElement>('settings-dialog');
  const progressChannel = new BroadcastChannel('vank-progress');
  progressChannel.addEventListener('message', () => window.location.reload());
  const modeInputs = [
    ...document.querySelectorAll<HTMLInputElement>('[name="font-mode"]'),
  ];
  const language = element<HTMLSelectElement>('language');
  const metadataHints = element<HTMLInputElement>('metadata-hints-setting');
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
  const resetOpen = element<HTMLButtonElement>('reset-open');
  const resetConfirmation = element('reset-confirmation');
  const resetCancel = element<HTMLButtonElement>('reset-cancel');
  const resetConfirm = element<HTMLButtonElement>('reset-confirm');
  const resetError = element('reset-error');

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

  function render() {
    const { fonts } = trainer.settings;
    const { typography } = trainer.settings;
    language.value = trainer.settings.language;
    metadataHints.checked = trainer.settings.metadataHints;
    const correctAnswers = trainer.state.recent.filter(
      (attempt) => attempt.payload.correct,
    ).length;
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
    const languageChanged = language.value !== trainer.settings.language;
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
      await trainer.setSettings({
        language: language.value as LanguagePreference,
        metadataHints: metadataHints.checked,
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
      });
      if (languageChanged) {
        window.location.reload();
        return;
      }
      render();
      renderTrainer();
    } catch (error) {
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
    render();
    dialog.showModal();
  });
  element('settings-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
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
  for (const control of [
    language,
    metadataHints,
    ...modeInputs,
    selected,
    ...enabled.querySelectorAll('input'),
    ...typographyModeInputs,
    typographySelected,
    ...typographyEnabled.querySelectorAll('input'),
  ])
    control.addEventListener('change', () => void apply());
  render();
}
