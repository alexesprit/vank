import { FONTS } from '../core/settings.ts';
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

  function render() {
    const { fonts } = trainer.settings;
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
  }

  async function apply() {
    const mode = modeInputs.find((input) => input.checked)?.value as
      | 'single'
      | 'rotate';
    const checked = [
      ...enabled.querySelectorAll<HTMLInputElement>('input:checked'),
    ].map((input) => input.value);
    try {
      await trainer.setSettings({
        fonts: {
          mode,
          selected: selected.value,
          enabled: checked.length ? checked : ['default'],
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
  ])
    control.addEventListener('change', () => void apply());
  render();
}
