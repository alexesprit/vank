const maxTooltipWidth = 220;
const viewportInset = 16;
const tooltipGap = 8;
let tooltipId = 0;

type TooltipTrigger = {
  element: HTMLElement;
  getText: () => string;
};

export function mountTooltips(triggers: readonly TooltipTrigger[]) {
  const tooltip = document.createElement('span');
  tooltip.id = `viewport-tooltip-${++tooltipId}`;
  tooltip.className = 'viewport-tooltip';
  tooltip.role = 'tooltip';
  tooltip.hidden = true;
  (triggers[0]?.element.closest('dialog') ?? document.body).append(tooltip);

  let activeTrigger: HTMLElement | undefined;
  const hideTooltip = () => {
    activeTrigger = undefined;
    tooltip.hidden = true;
  };
  const positionTooltip = (trigger: TooltipTrigger) => {
    const { bottom, left, top, width } =
      trigger.element.getBoundingClientRect();
    const tooltipWidth = Math.min(
      maxTooltipWidth,
      Math.max(0, window.innerWidth - viewportInset * 2),
    );
    const centeredLeft = left + width / 2 - tooltipWidth / 2;
    const clampedLeft = Math.min(
      window.innerWidth - viewportInset - tooltipWidth,
      Math.max(viewportInset, centeredLeft),
    );
    activeTrigger = trigger.element;
    tooltip.textContent = trigger.getText();
    tooltip.style.width = `${tooltipWidth}px`;
    tooltip.hidden = false;
    const tooltipHeight = tooltip.getBoundingClientRect().height;
    const belowTop = bottom + tooltipGap;
    const tooltipTop =
      belowTop + tooltipHeight <= window.innerHeight - viewportInset
        ? belowTop
        : Math.max(viewportInset, top - tooltipHeight - tooltipGap);
    tooltip.style.left = `${clampedLeft}px`;
    tooltip.style.top = `${tooltipTop}px`;
  };
  const repositionTooltip = () => {
    const trigger = triggers.find(({ element }) => element === activeTrigger);
    if (trigger) positionTooltip(trigger);
  };

  for (const trigger of triggers) {
    const { element } = trigger;
    element.dataset.viewportTooltip = '';
    element.setAttribute('aria-describedby', tooltip.id);
    element.addEventListener('mouseenter', () => positionTooltip(trigger));
    element.addEventListener('focus', () => positionTooltip(trigger));
    element.addEventListener('mouseleave', () => {
      if (document.activeElement !== element) hideTooltip();
    });
    element.addEventListener('blur', () => {
      if (!element.matches(':hover')) hideTooltip();
    });
  }
  window.addEventListener('resize', repositionTooltip);
  document.addEventListener('scroll', repositionTooltip, true);
}
