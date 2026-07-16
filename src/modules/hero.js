import { reduceMotion, runAnimation, staggerDelay } from "./anime.js";

export function playIntro() {
  runAnimation(".site-header", {
    opacity: { from: 0 },
    translateY: { from: "-1rem" },
    duration: 520,
    ease: "outCubic",
  });

  runAnimation(".hero-content > *", {
    opacity: { from: 0 },
    translateY: { from: "1.2rem" },
    delay: staggerDelay(90),
    duration: 720,
    ease: "outCubic",
  });

  runAnimation(".hero-media img", {
    opacity: { from: 0 },
    scale: { from: 0.96 },
    rotateY: { from: "-5deg" },
    duration: 900,
    ease: "outCubic",
  });
}

export function initHeroAnim() {
  const heroImage = document.querySelector(".hero-media img");

  if (!heroImage || reduceMotion) {
    return undefined;
  }

  const handleMouseEnter = () => {
    runAnimation(heroImage, {
      scale: { to: 1.025 },
      duration: 320,
      ease: "outCubic",
    });
  };

  const handleMouseMove = (event) => {
    const rect = heroImage.getBoundingClientRect();
    const offsetX = (event.clientX - rect.left) / rect.width - 0.5;
    const offsetY = (event.clientY - rect.top) / rect.height - 0.5;

    runAnimation(heroImage, {
      rotateY: { to: `${offsetX * 7}deg` },
      rotateX: { to: `${offsetY * -6}deg` },
      duration: 420,
      ease: "outCubic",
    });
  };

  const handleMouseLeave = () => {
    runAnimation(heroImage, {
      rotateX: { to: 0 },
      rotateY: { to: 0 },
      scale: { to: 1 },
      duration: 520,
      ease: "outCubic",
    });
  };

  heroImage.addEventListener("mouseenter", handleMouseEnter);
  heroImage.addEventListener("mousemove", handleMouseMove);
  heroImage.addEventListener("mouseleave", handleMouseLeave);

  return () => {
    heroImage.removeEventListener("mouseenter", handleMouseEnter);
    heroImage.removeEventListener("mousemove", handleMouseMove);
    heroImage.removeEventListener("mouseleave", handleMouseLeave);
  };
}
