import { initButtonRipples } from "./buttons.js";
import { initCardsAnim } from "./cards.js";
import { initHeroAnim, playIntro } from "./hero.js";
import { initHighlightsAnim } from "./highlights.js";
import { initNav } from "./nav.js";
import { initRevealAnim } from "./reveal.js";
import { initScoreAnim } from "./score.js";

initNav();
initHeroAnim();
initRevealAnim();
initButtonRipples();

const { updateProgress } = initHighlightsAnim({ playIntro });
initCardsAnim({ updateProgress });
initScoreAnim();
playIntro();
