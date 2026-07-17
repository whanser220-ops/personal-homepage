"use client";

import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";
import { ArrowRight } from "lucide-react";
import { AnimatedCat } from "./AnimatedCat.jsx";

const navCards = [
  {
    href: "/about",
    title: "关于我",
    label: "About",
    copy: "个人介绍、能力方向和联系方式。",
    tone: "blue",
  },
  {
    href: "/articles",
    title: "文章",
    label: "Articles",
    copy: "记录想法、技术笔记和阶段总结。",
    tone: "pink",
  },
  {
    href: "/projects",
    title: "项目",
    label: "Projects",
    copy: "个人主页、构建报告和后续作品入口。",
    tone: "mint",
  },
];

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LandingNavigation() {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!rootRef.current || prefersReducedMotion()) {
      return;
    }

    const cards = [...rootRef.current.querySelectorAll(".portal-card")];
    const cats = [...rootRef.current.querySelectorAll(".portal-cat")];
    const currents = [...rootRef.current.querySelectorAll(".liquid-current")];

    animate(".portal-title > *", {
      opacity: { from: 0 },
      translateY: { from: "1rem" },
      delay: stagger(80),
      duration: 760,
      ease: "outCubic",
    });

    animate(cards, {
      opacity: { from: 0 },
      translateY: { from: "2.4rem" },
      scale: { from: 0.94 },
      delay: stagger(130),
      duration: 900,
      ease: "outBack",
    });

    const catAnimation = animate(cats, {
      translateY: ["-0.5rem", "0.5rem"],
      rotate: ["-1.8deg", "2deg"],
      alternate: true,
      loop: true,
      delay: stagger(140),
      duration: 1800,
      ease: "inOutSine",
    });

    const currentAnimation = animate(currents, {
      translateX: ["-1.2rem", "1.2rem"],
      scaleX: [0.92, 1.08],
      alternate: true,
      loop: true,
      delay: stagger(120),
      duration: 2100,
      ease: "inOutSine",
    });

    return () => {
      catAnimation?.pause?.();
      currentAnimation?.pause?.();
    };
  }, []);

  function burst(event) {
    if (prefersReducedMotion()) {
      return;
    }

    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const originX = event.clientX - rect.left;
    const originY = event.clientY - rect.top;
    const drops = Array.from({ length: 10 }, (_, index) => {
      const drop = document.createElement("span");
      drop.className = "water-drop";
      drop.innerHTML = "<span></span>";
      drop.style.left = `${originX}px`;
      drop.style.top = `${originY}px`;
      drop.style.setProperty("--angle", `${index * 36}deg`);
      card.appendChild(drop);
      return drop;
    });

    animate(drops, {
      opacity: [0.9, 0],
      scale: [0.35, 1],
      translateX: (_, index) => Math.cos((index * Math.PI) / 5) * (48 + index * 3),
      translateY: (_, index) => Math.sin((index * Math.PI) / 5) * (32 + index * 2),
      duration: 620,
      ease: "outExpo",
      onComplete: () => drops.forEach((drop) => drop.remove()),
    });
  }

  return (
    <main className="portal-page" ref={rootRef}>
      <div className="portal-flow portal-flow-left" aria-hidden="true">
        <span className="liquid-current liquid-current-blue" />
        <span className="liquid-current liquid-current-pink" />
        <span className="liquid-current liquid-current-mint" />
      </div>
      <div className="portal-flow portal-flow-right" aria-hidden="true">
        <span className="liquid-current liquid-current-coral" />
        <span className="liquid-current liquid-current-violet" />
        <span className="liquid-current liquid-current-lime" />
      </div>
      <section className="portal-title" aria-labelledby="portal-heading">
        <AnimatedCat className="portal-mark" tone="blue" variant="drop" />
        <p>Warm Hanser</p>
        <h1 id="portal-heading">
          <span>选择一只小猫</span>
          <span>进入页面</span>
        </h1>
      </section>
      <nav className="portal-grid" aria-label="主页导航">
        {navCards.map((card) => (
          <a
            className={`portal-card portal-card-${card.tone}`}
            href={card.href}
            key={card.href}
            onPointerEnter={burst}
            onClick={burst}
          >
            <span className="portal-burst" aria-hidden="true" />
            <span className="portal-card-label">{card.label}</span>
            <span className="portal-cat-wrap">
              <AnimatedCat className="portal-cat" tone={card.tone} />
            </span>
            <span className="portal-card-body">
              <strong>{card.title}</strong>
              <span>{card.copy}</span>
            </span>
            <span className="portal-link">
              进入
              <ArrowRight aria-hidden="true" size={18} />
            </span>
          </a>
        ))}
      </nav>
    </main>
  );
}
