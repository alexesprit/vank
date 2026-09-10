import { FONTS, TYPOGRAPHY_MODES } from '../core/settings.ts';
import type { Trainer } from '../trainer.ts';

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

export function mountSettings(trainer: Trainer, renderTrainer: () => void) {
  const dialog = element<HTMLDialogElement>('settings-dialog');
  const modeInputs = [
    ...document.querySelectorAll<HTMLInputElement>('[name="font-mode"]'),
  ];
  const selected = element<HTMLSelectElement>('font-selected');
  const enabled = element('font-enabled');
  const typographyModeInputs = [
    ...document.getElementsByName('typography-mode'),
  ] as HTMLInputElement[];
  const typographySelected = element<HTMLSelectElement>('typography-selected');
  const typographyEnabled = element('typography-enabled');

  selected.replaceChildren(
    ...FONTS.map((font) => new Option(font.name, font.id)),
  );
  enabled.replaceChildren(
    ...FONTS.map((font) => {
      const label = document.createElement('label');
      label.className = 'font-choice';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = font.id;
      const text = document.createElement('span');
      text.textContent = font.name;
      label.append(input, text);
      return label;
    }),
  );
  typographySelected.replaceChildren(
    ...TYPOGRAPHY_MODES.map((mode) => new Option(mode.name, mode.id)),
  );
  typographyEnabled.replaceChildren(
    ...TYPOGRAPHY_MODES.map((mode) => {
      const label = document.createElement('label');
      label.className = 'font-choice';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = mode.id;
      label.append(input, document.createTextNode(mode.name));
      return label;
    }),
  );

  function render() {
    const { fonts } = trainer.settings;
    const { typography } = trainer.settings;
    for (const input of modeInputs) input.checked = input.value === fonts.mode;
    for (const option of selected.options)
      option.disabled =
        trainer.state.recent.length <
        (FONTS.find((font) => font.id === option.value)?.unlockAfterAttempts ??
          0);
    selected.value = fonts.selected;
    selected.disabled = fonts.mode !== 'single';
    for (const input of enabled.querySelectorAll<HTMLInputElement>('input')) {
      const font = FONTS.find((font) => font.id === input.value);
      if (!font) continue;
      const locked = trainer.state.recent.length < font.unlockAfterAttempts;
      input.checked = fonts.enabled.includes(input.value);
      input.disabled = fonts.mode !== 'rotate' || locked;
      if (input.nextElementSibling)
        input.nextElementSibling.textContent = `${font.name}${locked ? ` · после ${font.unlockAfterAttempts} слов` : ''}`;
    }
    for (const input of typographyModeInputs)
      input.checked = input.value === typography.mode;
    for (const option of typographySelected.options)
      option.disabled =
        trainer.state.recent.length <
        (TYPOGRAPHY_MODES.find((mode) => mode.id === option.value)
          ?.unlockAfterAttempts ?? 0);
    typographySelected.value = typography.selected;
    typographySelected.disabled = typography.mode !== 'single';
    for (const input of typographyEnabled.querySelectorAll<HTMLInputElement>(
      'input',
    )) {
      const mode = TYPOGRAPHY_MODES.find((mode) => mode.id === input.value);
      if (!mode) continue;
      const locked = trainer.state.recent.length < mode.unlockAfterAttempts;
      input.checked = typography.enabled.includes(input.value);
      input.disabled = typography.mode !== 'rotate' || locked;
      const text = input.parentElement?.lastChild;
      if (text)
        text.textContent = `${mode.name}${locked ? ` · после ${mode.unlockAfterAttempts} слов` : ''}`;
    }
  }

  async function apply() {
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
      render();
      renderTrainer();
    } catch (error) {
      const message = document.getElementById('error');
      if (message) {
        message.hidden = false;
        message.textContent =
          error instanceof Error
            ? error.message
            : 'Не удалось сохранить настройки.';
      }
    }
  }

  element('settings-open').addEventListener('click', () => {
    render();
    dialog.showModal();
  });
  element('settings-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  for (const control of [
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
