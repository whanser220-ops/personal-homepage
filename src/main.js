import "./styles.css";
import { initButtonRipples } from "./modules/buttons.js";
import { initCardsAnim } from "./modules/cards.js";
import { initHeroAnim, playIntro } from "./modules/hero.js";
import { initHighlightsAnim } from "./modules/highlights.js";
import { initNav } from "./modules/nav.js";
import { initRevealAnim } from "./modules/reveal.js";
import { initScoreAnim } from "./modules/score.js";

initNav();
initHeroAnim();
initRevealAnim();
initButtonRipples();

const { updateProgress } = initHighlightsAnim({ playIntro });
initCardsAnim({ updateProgress });
initScoreAnim();
playIntro();
