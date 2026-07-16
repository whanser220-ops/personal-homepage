import { useEffect } from "react";
import { initButtonRipples } from "../modules/buttons.js";
import { initCardsAnim } from "../modules/cards.js";
import { initHeroAnim, playIntro } from "../modules/hero.js";
import { initHighlightsAnim } from "../modules/highlights.js";
import { initNav } from "../modules/nav.js";
import { initRevealAnim } from "../modules/reveal.js";

function runCleanup(cleanup) {
  if (typeof cleanup === "function") {
    cleanup();
  }
}

export function useHomepageInteractions() {
  useEffect(() => {
    const navCleanup = initNav();
    const heroCleanup = initHeroAnim();
    const revealCleanup = initRevealAnim();
    const rippleCleanup = initButtonRipples();
    const highlights = initHighlightsAnim({ playIntro });
    const cardsCleanup = initCardsAnim({ updateProgress: highlights.updateProgress });

    playIntro();

    return () => {
      runCleanup(navCleanup);
      runCleanup(heroCleanup);
      runCleanup(revealCleanup);
      runCleanup(rippleCleanup);
      runCleanup(highlights.cleanup);
      runCleanup(cardsCleanup);
    };
  }, []);
}
