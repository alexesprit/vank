import {
  ACHIEVEMENT_DEFINITIONS,
  type AchievementDefinition,
  type AchievementUnlock,
} from '../core/achievements.ts';
import { t } from '../i18n/index.ts';
import type { Trainer } from '../trainer.ts';
import { createSnackbar } from './snackbar.ts';

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const definitionById = new Map(
  ACHIEVEMENT_DEFINITIONS.map((definition) => [definition.id, definition]),
);
const title = (definition: AchievementDefinition) =>
  t(`achievements.items.${definition.id}.title`);
const description = (definition: AchievementDefinition) =>
  t(`achievements.items.${definition.id}.description`);
const refreshIcons = () =>
  (
    window as typeof window & {
      lucide?: { createIcons(): void };
    }
  ).lucide?.createIcons();
const icon = (name: string) => {
  const element = document.createElement('i');
  element.dataset.lucide = name;
  element.setAttribute('aria-hidden', 'true');
  return element;
};
const formattedTime = (timestamp: number) =>
  new Intl.DateTimeFormat(document.documentElement.lang, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
export const revealHiddenAchievements = (
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>,
) => event.metaKey || event.ctrlKey;
export const orderAchievements = (unlocks: readonly AchievementUnlock[]) => {
  const byId = new Map(unlocks.map((unlock) => [unlock.id, unlock]));
  const group = (
    definition: AchievementDefinition,
    unlock?: AchievementUnlock,
  ) => (unlock ? 0 : definition.hidden ? 2 : 1);
  return ACHIEVEMENT_DEFINITIONS.map((definition, index) => ({
    definition,
    index,
    unlock: byId.get(definition.id),
  })).sort((left, right) => {
    const groupDifference =
      group(left.definition, left.unlock) -
      group(right.definition, right.unlock);
    if (groupDifference) return groupDifference;
    if (left.unlock && right.unlock)
      return (
        right.unlock.earnedAt - left.unlock.earnedAt || left.index - right.index
      );
    return left.index - right.index;
  });
};

export function mountAchievements(trainer: Trainer) {
  const dialog = element<HTMLDialogElement>('achievements-dialog');
  const summary = element<HTMLButtonElement>('achievements-open');
  const summaryCount = element('achievements-summary-count');
  const dialogCount = element('achievements-dialog-count');
  const list = element('achievements-list');
  const snackbar = createSnackbar();

  const render = () => {
    const unlocks = trainer.achievementUnlocks;
    const count = t('achievements.summaryCount', {
      unlocked: unlocks.length,
      total: ACHIEVEMENT_DEFINITIONS.length,
    });
    summaryCount.textContent = count;
    dialogCount.textContent = count;
  };
  const renderList = (revealHidden: boolean) => {
    list.replaceChildren(
      ...orderAchievements(trainer.achievementUnlocks).map(
        ({ definition, unlock }) => {
          const concealed = definition.hidden && !unlock && !revealHidden;
          const item = document.createElement('article');
          item.className = `achievement-item${unlock ? '' : ' locked'}${concealed ? ' hidden-achievement' : ''}`;
          const itemIcon = document.createElement('div');
          itemIcon.className = 'achievement-icon';
          itemIcon.append(icon(concealed ? 'circle-help' : definition.icon));
          itemIcon.addEventListener('click', (event) => {
            if (!revealHiddenAchievements(event)) return;
            show([definition], dialog);
          });
          const copy = document.createElement('div');
          copy.className = 'achievement-copy';
          const heading = document.createElement('h3');
          heading.textContent = concealed
            ? t('achievements.hiddenTitle')
            : title(definition);
          const detail = document.createElement('p');
          detail.textContent = concealed
            ? t('achievements.hiddenDescription')
            : description(definition);
          const state = document.createElement(unlock ? 'time' : 'span');
          state.className = unlock ? 'achievement-time' : 'achievement-state';
          state.textContent = unlock
            ? t('achievements.unlockedAt', {
                date: formattedTime(unlock.earnedAt),
              })
            : t('achievements.locked');
          if (unlock) {
            state.setAttribute(
              'datetime',
              new Date(unlock.earnedAt).toISOString(),
            );
          }
          copy.append(heading, detail, state);
          item.append(itemIcon, copy);
          return item;
        },
      ),
    );
    refreshIcons();
  };
  const open = (revealHidden = false) => {
    snackbar.hide();
    render();
    renderList(revealHidden);
    if (!dialog.open) dialog.showModal();
  };
  const show = (
    unlocks: readonly Pick<AchievementUnlock, 'id'>[],
    container?: HTMLElement,
  ) => {
    if (!unlocks.length) return;
    render();
    const first = definitionById.get(unlocks[0].id);
    snackbar.show({
      label:
        unlocks.length === 1
          ? t('achievements.unlocked')
          : t('achievements.unlockedMany', { count: unlocks.length }),
      title:
        unlocks.length === 1 && first
          ? title(first)
          : t('achievements.summary'),
      icon: 'trophy',
      action: { label: t('achievements.view'), onClick: open },
      container,
    });
  };

  summary.addEventListener('click', (event) => {
    open(revealHiddenAchievements(event));
  });
  element('achievements-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  render();
  queueMicrotask(() => show(trainer.backfilledAchievementUnlocks));
  return { render, show };
}
