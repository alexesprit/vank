type SnackbarOptions = {
  label: string;
  title: string;
  icon?: string;
  action?: { label: string; onClick: () => void };
  container?: HTMLElement;
};

const refreshIcons = () =>
  (
    globalThis as typeof globalThis & {
      lucide?: { createIcons(): void };
    }
  ).lucide?.createIcons();

export function createSnackbar(duration = 6_000) {
  const snackbar = document.createElement('div');
  const icon = document.createElement('span');
  const copy = document.createElement('span');
  const label = document.createElement('span');
  const title = document.createElement('strong');
  const action = document.createElement('button');
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;

  snackbar.className = 'snackbar';
  snackbar.setAttribute('role', 'status');
  snackbar.setAttribute('aria-live', 'polite');
  snackbar.hidden = true;
  icon.className = 'snackbar-icon';
  copy.className = 'snackbar-copy';
  action.className = 'snackbar-action';
  action.type = 'button';
  copy.append(label, title);
  snackbar.append(icon, copy, action);

  const hide = () => {
    snackbar.hidden = true;
    if (dismissTimer !== undefined) clearTimeout(dismissTimer);
  };
  const show = (options: SnackbarOptions) => {
    label.textContent = options.label;
    title.textContent = options.title;
    icon.replaceChildren();
    if (options.icon) {
      const glyph = document.createElement('i');
      glyph.dataset.lucide = options.icon;
      glyph.setAttribute('aria-hidden', 'true');
      icon.append(glyph);
    }
    icon.hidden = !options.icon;
    action.textContent = options.action?.label ?? '';
    action.onclick = options.action?.onClick ?? null;
    action.hidden = !options.action;
    (options.container ?? document.body).append(snackbar);
    snackbar.hidden = false;
    if (dismissTimer !== undefined) clearTimeout(dismissTimer);
    dismissTimer = setTimeout(hide, duration);
    refreshIcons();
  };

  return { hide, show };
}
