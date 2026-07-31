"use client";

import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { NavigationDock } from "./NavigationDock.jsx";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LandingNavigation() {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!rootRef.current || prefersReducedMotion()) {
      return;
    }

    const panels = [...rootRef.current.querySelectorAll(".dashboard-animate")];

    const entranceAnimation = animate(panels, {
      opacity: { from: 0 },
      translateY: { from: "1.3rem" },
      scale: { from: 0.98 },
      delay: 120,
      duration: 760,
      ease: "outCubic",
    });

    return () => entranceAnimation?.pause?.();
  }, []);

  return (
    <main className="dashboard-page" ref={rootRef}>
      <section className="dashboard-hero-stage" aria-label="个人主页首屏">
        <img
          className="dashboard-hero-image"
          src="/assets/warm-cafe-hero.png"
          alt=""
          width="1672"
          height="941"
          aria-hidden="true"
        />
        <NavigationDock className="dashboard-dock dashboard-animate" />
      </section>
    </main>
  );
}
