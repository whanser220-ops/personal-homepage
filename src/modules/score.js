import { animate, scrambleText } from "animejs";

export function initScoreAnim() {
  var btn = document.querySelector(".primary-button");
  var scoreEl = document.querySelector("[data-score]");
  if (!btn || !scoreEl) return;

  var handleClick = function () {
    animate(scoreEl, {
      innerHTML: scrambleText({ chars: "0-9" }),
      duration: 1500,
    });
  };

  btn.addEventListener("click", handleClick);

  return function () {
    btn.removeEventListener("click", handleClick);
  };
}
