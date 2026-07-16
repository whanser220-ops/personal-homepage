import { useEffect } from "react";
import { animate, stagger } from "animejs";

const canAnimate = typeof animate === "function";
const canStagger = typeof stagger === "function";

function staggerDelay(step) {
  return canStagger ? stagger(step) : (_, index) => index * step;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function runAnimation(target, params) {
  if (!canAnimate || prefersReducedMotion()) {
    return null;
  }

  return animate(target, params);
}

function animateNumber(element, toValue, suffix = "") {
  if (!element) {
    return;
  }

  if (!canAnimate || prefersReducedMotion()) {
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

function playIntro() {
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

function runCleanup(cleanup) {
  if (typeof cleanup === "function") {
    cleanup();
  }
}

function initNav() {
  const yearElement = document.querySelector("#year");
  const navLinks = [...document.querySelectorAll(".site-nav a")];
  const sections = [...document.querySelectorAll("main section[id]")];

  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  const setActiveNav = (id) => {
    const activeLink = document.querySelector(`.site-nav a[href="#${id}"]`);
    navLinks.forEach((link) => link.classList.remove("is-active"));
    activeLink?.classList.add("is-active");
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveNav(entry.target.id);
        }
      });
    },
    {
      rootMargin: "-40% 0px -45% 0px",
      threshold: 0,
    },
  );

  sections.forEach((section) => observer.observe(section));

  return () => observer.disconnect();
}

function initRevealAnim() {
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

  return () => revealObserver.disconnect();
}

function initHeroAnim() {
  const heroImage = document.querySelector(".hero-media img");

  if (!heroImage || prefersReducedMotion()) {
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

function initButtonRipples() {
  const subscriptions = [...document.querySelectorAll(".button")].map((button) => {
    const handleClick = (event) => {
      if (!canAnimate || prefersReducedMotion()) {
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

function initHighlightsAnim() {
  const focusItems = [...document.querySelectorAll(".focus-item")];
  const progressValue = document.querySelector("#progressValue");
  const progressLabel = document.querySelector("#progressLabel");
  const progressFill = document.querySelector("#progressFill");
  const replayButton = document.querySelector("#playIntro");
  const shuffleButton = document.querySelector("#shuffleFocus");
  let focusIndex = 0;
  const subscriptions = [];

  const updateProgress = (targetProgress, label) => {
    if (progressLabel) {
      progressLabel.textContent = label;
    }

    progressFill?.parentElement?.setAttribute("aria-valuenow", targetProgress);
    animateNumber(progressValue, targetProgress, "%");

    if (!progressFill) {
      return;
    }

    if (!canAnimate || prefersReducedMotion()) {
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
    const handleClick = () => setFocus(item);
    item.addEventListener("click", handleClick);
    subscriptions.push(() => item.removeEventListener("click", handleClick));
  });

  const handleShuffleClick = () => {
    const nextIndex = (focusIndex + 1) % focusItems.length;
    setFocus(focusItems[nextIndex]);
  };

  const handleReplayClick = () => {
    playIntro();
    runAnimation(".metric", {
      scale: [{ to: 1.04, duration: 160 }, { to: 1, duration: 260 }],
      delay: staggerDelay(80),
      ease: "outCubic",
    });
  };

  shuffleButton?.addEventListener("click", handleShuffleClick);
  replayButton?.addEventListener("click", handleReplayClick);

  if (shuffleButton) {
    subscriptions.push(() => shuffleButton.removeEventListener("click", handleShuffleClick));
  }

  if (replayButton) {
    subscriptions.push(() => replayButton.removeEventListener("click", handleReplayClick));
  }

  document.querySelectorAll("[data-counter]").forEach((counter) => {
    animateNumber(counter, Number.parseInt(counter.dataset.target ?? "0", 10));
  });

  return {
    cleanup: () => subscriptions.forEach((cleanup) => cleanup()),
    updateProgress,
  };
}

function initCardsAnim({ updateProgress } = {}) {
  const infoCards = [...document.querySelectorAll(".info-card")];
  const subscriptions = [];

  infoCards.forEach((card) => {
    const focusCard = () => {
      const cardProgress = Number.parseInt(card.dataset.progress ?? "42", 10);
      const cardTitle = card.querySelector("h3")?.textContent ?? "能力模块";
      updateProgress?.(cardProgress, `正在关注 ${cardTitle}`);
    };

    const handleMouseEnter = () => {
      card.classList.add("is-spotlight");
      runAnimation(card, {
        translateY: { to: "-0.45rem" },
        scale: { to: 1.015 },
        duration: 260,
        ease: "outCubic",
      });
    };

    const handleMouseLeave = () => {
      card.classList.remove("is-spotlight");
      runAnimation(card, {
        translateY: { to: 0 },
        scale: { to: 1 },
        duration: 320,
        ease: "outCubic",
      });
    };

    const handleKeyDown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      focusCard();
    };

    card.addEventListener("mouseenter", handleMouseEnter);
    card.addEventListener("mouseleave", handleMouseLeave);
    card.addEventListener("click", focusCard);
    card.addEventListener("keydown", handleKeyDown);

    subscriptions.push(() => {
      card.removeEventListener("mouseenter", handleMouseEnter);
      card.removeEventListener("mouseleave", handleMouseLeave);
      card.removeEventListener("click", focusCard);
      card.removeEventListener("keydown", handleKeyDown);
    });
  });

  return () => subscriptions.forEach((cleanup) => cleanup());
}

export function useHomepageInteractions() {
  useEffect(() => {
    document.documentElement.dataset.anime = canAnimate ? "ready" : "fallback";
    document.documentElement.dataset.motion = prefersReducedMotion() ? "reduced" : "enhanced";

    const navCleanup = initNav();
    const heroCleanup = initHeroAnim();
    const revealCleanup = initRevealAnim();
    const rippleCleanup = initButtonRipples();
    const highlights = initHighlightsAnim();
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
