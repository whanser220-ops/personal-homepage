"use client";
import { useEffect, useRef, useState } from "react";
import { DeskMusicPlayer } from "./DeskMusicPlayer.jsx";
import styles from "./SceneLanding.module.css";

export function HomeScene3D({ className = "" }) {
  const hostRef = useRef(null);
  const [position, setPosition] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cleanup;
    import("../lib/home-scene/createCafeScene.js")
      .then(({ createCafeScene }) => {
        if (!disposed && hostRef.current)
          cleanup = createCafeScene(hostRef.current, setPosition, (visible = true) => {
            if (!disposed) setReady(visible);
          });
      })
      .catch((error) => {
        if (!disposed) {
          setReady(false);
          console.error("Cafe renderer unavailable.", error);
        }
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  return (
    <div className={className} data-scene-ready={ready}>
      <picture className={styles.scenePoster} aria-hidden="true">
        <source
          media="(max-aspect-ratio: 1/1)"
          srcSet="/assets/home-scene/afternoon-room-mobile.webp"
          type="image/webp"
          width="780"
          height="2400"
        />
        <img
          src="/assets/home-scene/afternoon-room-desktop.webp"
          alt=""
          width="2200"
          height="1000"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
      </picture>
      <div ref={hostRef} className={styles.sceneRenderer}>
        {ready && position && <DeskMusicPlayer position={position} />}
      </div>
    </div>
  );
}
