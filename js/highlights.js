import { animate, animateNumber, canAnimate, reduceMotion, runAnimation, staggerDelay } from "./anime.js";

export function initHighlightsAnim({ playIntro } = {}) {
  const focusItems = [...document.querySelectorAll(".focus-item")];
  const progressValue = document.querySelector("#progressValue");
  const progressLabel = document.querySelector("#progressLabel");
  const progressFill = document.querySelector("#progressFill");
  const replayButton = document.querySelector("#playIntro");
  const shuffleButton = document.querySelector("#shuffleFocus");
  let focusIndex = 0;

  const updateProgress = (targetProgress, label) => {
    if (progressLabel) {
      progressLabel.textContent = label;
    }

    progressFill?.parentElement?.setAttribute("aria-valuenow", targetProgress);
    animateNumber(progressValue, targetProgress, "%");

    if (!progressFill) {
      return;
    }

    if (!canAnimate || reduceMotion) {
      progressFill.style.width = `${targetProgress}%`;
      return;
    }

    animate(progressFill, {
      width: { to: `${targetProgress}%` },
      duration: 820,
      ease: "outCubic",
    });
  };

  const setFocus = (item) => {
    const nextProgress = Number.parseInt(item.dataset.progress ?? "42", 10);
    const nextLabel = item.dataset.focus ?? "正在整理个人介绍";

    focusItems.forEach((button) => button.classList.remove("is-active"));
    item.classList.add("is-active");
    focusIndex = focusItems.indexOf(item);
    updateProgress(nextProgress, nextLabel);

    runAnimation(item, {
      scale: [{ to: 1.02, duration: 140 }, { to: 1, duration: 260 }],
      ease: "outCubic",
    });
  };

  focusItems.forEach((item) => {
    item.addEventListener("click", () => setFocus(item));
  });

  shuffleButton?.addEventListener("click", () => {
    const nextIndex = (focusIndex + 1) % focusItems.length;
    setFocus(focusItems[nextIndex]);
  });

  replayButton?.addEventListener("click", () => {
    playIntro?.();
    runAnimation(".metric", {
      scale: [{ to: 1.04, duration: 160 }, { to: 1, duration: 260 }],
      delay: staggerDelay(80),
      ease: "outCubic",
    });
  });

  document.querySelectorAll("[data-counter]").forEach((counter) => {
    animateNumber(counter, Number.parseInt(counter.dataset.target ?? "0", 10));
  });

  return {
    updateProgress,
  };
}
