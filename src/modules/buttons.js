import { animate, canAnimate, reduceMotion } from "./anime.js";

export function initButtonRipples() {
  const subscriptions = [...document.querySelectorAll(".button")].map((button) => {
    const handleClick = (event) => {
      if (!canAnimate || reduceMotion) {
        return;
      }

      const rect = button.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "button-ripple";
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      button.append(ripple);

      animate(ripple, {
        opacity: { from: 0.28, to: 0 },
        scale: { to: 18 },
        duration: 620,
        ease: "outCubic",
        onComplete: () => ripple.remove(),
      });
    };

    button.addEventListener("click", handleClick);
    return () => button.removeEventListener("click", handleClick);
  });

  return () => subscriptions.forEach((cleanup) => cleanup());
}
