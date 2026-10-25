"use client";

import { useCallback, useEffect, useReducer } from "react";
import { HomeScene3D } from "./HomeScene3D.jsx";
import { HomeCoffeeIntro } from "./HomeCoffeeIntro.jsx";
import { homeOpeningReducer, initialHomeOpening } from "../lib/home-scene/homeOpening.js";
import styles from "./SceneLanding.module.css";

export function LandingNavigation() {
  const [opening, dispatch] = useReducer(homeOpeningReducer, initialHomeOpening);
  const presented = opening.phase === "revealing" || opening.phase === "shown";
  const completeAnimation = useCallback(() => dispatch({ type: "animation-complete" }), []);
  const onIntroError = useCallback(() => dispatch({ type: "intro-failed" }), []);
  const onReadyChange = useCallback(ready => dispatch({ type: "scene-ready", ready }), []);
  const onUnavailable = useCallback(() => dispatch({ type: "scene-unavailable" }), []);
  const onPosterReady = useCallback(() => dispatch({ type: "poster-ready" }), []);
  const completeTransition = useCallback(() => dispatch({ type: "transition-complete" }), []);

  useEffect(() => {
    if (opening.phase !== "revealing") return;
    // transitionend does not fire when reduced motion removes the transition.
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 720;
    const timer = window.setTimeout(completeTransition, delay);
    return () => window.clearTimeout(timer);
  }, [opening.phase, completeTransition]);

  return (
    <main className={styles.landing} data-home-opening={opening.phase} aria-busy={!presented}>
      <div className={styles.world}>
        <HomeScene3D
          className={styles.scene}
          presented={presented}
          onReadyChange={onReadyChange}
          onUnavailable={onUnavailable}
          onPosterReady={onPosterReady}
        />
      </div>
      <div className={styles.edgeShade} aria-hidden="true" />
      {opening.phase !== "shown" && (
        <div
          className={styles.opening}
          data-revealing={presented}
          aria-hidden="true"
          onTransitionEnd={event => {
            if (event.target === event.currentTarget && event.propertyName === "opacity") completeTransition();
          }}
        >
          <HomeCoffeeIntro onComplete={completeAnimation} onError={onIntroError} />
        </div>
      )}
      <section className={styles.caption} aria-label="欢迎来到我的个人空间">
        <p className={styles.eyebrow}>一些日常，一些灵感</p>
        <h1>一杯咖啡的时间。</h1>
        <p className={styles.description}>让想法，在这里慢慢生长。</p>
      </section>
    </main>
  );
}
