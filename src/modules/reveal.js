import { runAnimation } from "./anime.js";

export function initRevealAnim() {
  const revealTargets = [
    ...document.querySelectorAll(".section-heading"),
    ...document.querySelectorAll(".split-layout p"),
    ...document.querySelectorAll(".lab-panel"),
    ...document.querySelectorAll(".info-card"),
    ...document.querySelectorAll(".timeline-item"),
  ];

  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        runAnimation(entry.target, {
          opacity: { from: 0 },
          translateY: { from: "1.4rem" },
          duration: 680,
          ease: "outCubic",
        });

        observer.unobserve(entry.target);
      });
    },
    {
      rootMargin: "0px 0px -12% 0px",
      threshold: 0.16,
    },
  );

  revealTargets.forEach((target) => revealObserver.observe(target));
}
