import { animate, stagger } from "https://cdn.jsdelivr.net/npm/animejs@4.5.0/+esm";

const canAnimate = typeof animate === "function";
const canStagger = typeof stagger === "function";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

document.documentElement.dataset.anime = canAnimate ? "ready" : "fallback";
document.documentElement.dataset.motion = reduceMotion ? "reduced" : "enhanced";

const yearElement = document.querySelector("#year");
const navLinks = [...document.querySelectorAll(".site-nav a")];
const sections = [...document.querySelectorAll("main section[id]")];
const infoCards = [...document.querySelectorAll(".info-card")];
const focusItems = [...document.querySelectorAll(".focus-item")];
const progressValue = document.querySelector("#progressValue");
const progressLabel = document.querySelector("#progressLabel");
const progressFill = document.querySelector("#progressFill");
const replayButton = document.querySelector("#playIntro");
const shuffleButton = document.querySelector("#shuffleFocus");

let focusIndex = 0;

yearElement.textContent = new Date().getFullYear();

const staggerDelay = (step) => (canStagger ? stagger(step) : (_, index) => index * step);

const runAnimation = (target, params) => {
  if (!canAnimate || reduceMotion) {
    return null;
  }

  return animate(target, params);
};

const setActiveNav = (id) => {
  const activeLink = document.querySelector(`.site-nav a[href="#${id}"]`);
  navLinks.forEach((link) => link.classList.remove("is-active"));
  activeLink?.classList.add("is-active");
};

const setupNavObserver = () => {
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
};

const playIntro = () => {
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
};

const setupRevealAnimations = () => {
  const revealTargets = [
    ...document.querySelectorAll(".section-heading"),
    ...document.querySelectorAll(".split-layout p"),
    ...document.querySelectorAll(".lab-panel"),
    ...infoCards,
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
};

const animateNumber = (element, toValue, suffix = "") => {
  if (!element) {
    return;
  }

  if (!canAnimate || reduceMotion) {
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
};

const updateProgress = (targetProgress, label) => {
  progressLabel.textContent = label;
  progressFill.parentElement?.setAttribute("aria-valuenow", targetProgress);
  animateNumber(progressValue, targetProgress, "%");

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
  const nextLabel = item.dataset.focus ?? "静态页面与部署基础";

  focusItems.forEach((button) => button.classList.remove("is-active"));
  item.classList.add("is-active");
  focusIndex = focusItems.indexOf(item);
  updateProgress(nextProgress, nextLabel);

  runAnimation(item, {
    scale: [{ to: 1.02, duration: 140 }, { to: 1, duration: 260 }],
    ease: "outCubic",
  });
};

const setupLab = () => {
  focusItems.forEach((item) => {
    item.addEventListener("click", () => setFocus(item));
  });

  shuffleButton?.addEventListener("click", () => {
    const nextIndex = (focusIndex + 1) % focusItems.length;
    setFocus(focusItems[nextIndex]);
  });

  replayButton?.addEventListener("click", () => {
    playIntro();
    runAnimation(".metric", {
      scale: [{ to: 1.04, duration: 160 }, { to: 1, duration: 260 }],
      delay: staggerDelay(80),
      ease: "outCubic",
    });
  });

  document.querySelectorAll("[data-counter]").forEach((counter) => {
    animateNumber(counter, Number.parseInt(counter.dataset.target ?? "0", 10));
  });
};

const setupInfoCardInteractions = () => {
  infoCards.forEach((card) => {
    const focusCard = () => {
      const cardProgress = Number.parseInt(card.dataset.progress ?? "42", 10);
      const cardTitle = card.querySelector("h3")?.textContent ?? "学习模块";
      updateProgress(cardProgress, `正在关注 ${cardTitle}`);
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
};

const setupHeroTilt = () => {
  const heroImage = document.querySelector(".hero-media img");

  if (!heroImage || reduceMotion) {
    return;
  }

  heroImage.addEventListener("mouseenter", () => {
    runAnimation(heroImage, {
      scale: { to: 1.025 },
      duration: 320,
      ease: "outCubic",
    });
  });

  heroImage.addEventListener("mousemove", (event) => {
    const rect = heroImage.getBoundingClientRect();
    const offsetX = (event.clientX - rect.left) / rect.width - 0.5;
    const offsetY = (event.clientY - rect.top) / rect.height - 0.5;

    runAnimation(heroImage, {
      rotateY: { to: `${offsetX * 7}deg` },
      rotateX: { to: `${offsetY * -6}deg` },
      duration: 420,
      ease: "outCubic",
    });
  });

  heroImage.addEventListener("mouseleave", () => {
    runAnimation(heroImage, {
      rotateX: { to: 0 },
      rotateY: { to: 0 },
      scale: { to: 1 },
      duration: 520,
      ease: "outCubic",
    });
  });
};

const setupButtonRipples = () => {
  document.querySelectorAll(".button").forEach((button) => {
    button.addEventListener("click", (event) => {
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
    });
  });
};

setupNavObserver();
setupRevealAnimations();
setupLab();
setupInfoCardInteractions();
setupHeroTilt();
setupButtonRipples();
playIntro();
