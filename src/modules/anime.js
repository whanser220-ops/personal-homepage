import { animate, stagger } from "animejs";

export { animate, stagger };

export const canAnimate = typeof animate === "function";
export const canStagger = typeof stagger === "function";
export const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

document.documentElement.dataset.anime = canAnimate ? "ready" : "fallback";
document.documentElement.dataset.motion = reduceMotion ? "reduced" : "enhanced";

export function staggerDelay(step) {
  return canStagger ? stagger(step) : (_, index) => index * step;
}

export function runAnimation(target, params) {
  if (!canAnimate || reduceMotion) {
    return null;
  }

  return animate(target, params);
}

export function animateNumber(element, toValue, suffix = "") {
  if (!element) {
    return;
  }

  if (!canAnimate || reduceMotion) {
    element.textContent = `${toValue}${suffix}`;
    return;
  }

  const value = {
    amount: Number.parseInt(element.textContent, 10) || 0,
  };

  animate(value, {
    amount: { to: toValue },
    duration: 820,
    ease: "outCubic",
    onUpdate: () => {
      element.textContent = `${Math.round(value.amount)}${suffix}`;
    },
  });
}
