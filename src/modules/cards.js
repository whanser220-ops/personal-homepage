import { runAnimation } from "./anime.js";

export function initCardsAnim({ updateProgress } = {}) {
  const infoCards = [...document.querySelectorAll(".info-card")];

  infoCards.forEach((card) => {
    const focusCard = () => {
      const cardProgress = Number.parseInt(card.dataset.progress ?? "42", 10);
      const cardTitle = card.querySelector("h3")?.textContent ?? "能力模块";
      updateProgress?.(cardProgress, `正在关注 ${cardTitle}`);
    };

    card.addEventListener("mouseenter", () => {
      card.classList.add("is-spotlight");
      runAnimation(card, {
        translateY: { to: "-0.45rem" },
        scale: { to: 1.015 },
        duration: 260,
        ease: "outCubic",
      });
    });

    card.addEventListener("mouseleave", () => {
      card.classList.remove("is-spotlight");
      runAnimation(card, {
        translateY: { to: 0 },
        scale: { to: 1 },
        duration: 320,
        ease: "outCubic",
      });
    });

    card.addEventListener("click", focusCard);

    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      focusCard();
    });
  });
}
