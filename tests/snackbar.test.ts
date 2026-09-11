import { expect, it, vi } from 'vitest';
import { createSnackbar } from '../web/src/ui/snackbar';

class FakeElement {
  hidden = false;
  className = '';
  textContent = '';
  type = '';
  onclick: (() => void) | null = null;
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};

  append(...children: FakeElement[]) {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = children;
  }

  setAttribute() {}
}

it('shows the latest content, runs its action, and dismisses itself', () => {
  vi.useFakeTimers();
  const body = new FakeElement();
  vi.stubGlobal('document', {
    body,
    createElement: () => new FakeElement(),
  });
  try {
    const onClick = vi.fn();
    const snackbar = createSnackbar();
    snackbar.show({
      label: 'Unlocked',
      title: 'First step',
      icon: 'trophy',
      action: { label: 'View', onClick },
    });

    const [element] = body.children;
    const [icon, copy, action] = element.children;
    expect(copy.children.map((child) => child.textContent)).toEqual([
      'Unlocked',
      'First step',
    ]);
    expect(icon.hidden).toBe(false);
    action.onclick?.();
    expect(onClick).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(6_000);
    expect(element.hidden).toBe(true);
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
