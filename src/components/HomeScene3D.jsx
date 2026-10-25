"use client";
import { useEffect, useRef, useState } from "react";
import { DeskMusicPlayer } from "./DeskMusicPlayer.jsx";
import styles from "./SceneLanding.module.css";

export function HomeScene3D({
  className = "",
  presented = true,
  onReadyChange,
  onUnavailable,
  onPosterReady,
}) {
  const hostRef = useRef(null);
  const posterRef = useRef(null);
  const sceneRef = useRef(null);
  const callbacks = useRef({ onReadyChange, onUnavailable, onPosterReady });
  const presentedRef = useRef(presented);
  callbacks.current = { onReadyChange, onUnavailable, onPosterReady };
  presentedRef.current = presented;
  const [position, setPosition] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cleanup;
    let timeout;
    const notifyReady = (visible = true) => {
      if (disposed) return;
      setReady(visible);
      callbacks.current.onReadyChange?.(visible);
      if (visible) window.clearTimeout(timeout);
    };
    const unavailable = error => {
      if (disposed) return;
      window.clearTimeout(timeout);
      notifyReady(false);
      callbacks.current.onUnavailable?.(error);
    };
    // A failed or stalled GPU/network can fall back to the decoded scene poster.
    // This does not claim the renderer is ready; it may still recover later.
    timeout = window.setTimeout(() => {
      if (!disposed) callbacks.current.onUnavailable?.(new Error("Cafe startup timed out."));
    }, 30000);
    import("../lib/home-scene/createCafeScene.js")
      .then(({ createCafeScene }) => {
        if (!disposed && hostRef.current) {
          cleanup = createCafeScene(hostRef.current, setPosition, notifyReady, {
            onError: unavailable,
            initiallyPresented: presentedRef.current,
          });
          sceneRef.current = cleanup;
        }
      })
      .catch((error) => {
        if (!disposed) {
          unavailable(error);
          console.error("Cafe renderer unavailable.", error);
        }
      });
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      cleanup?.();
      sceneRef.current = null;
    };
  }, []);
  useEffect(() => {
    sceneRef.current?.setPresented(presented);
  }, [presented]);

  useEffect(() => {
    let disposed = false;
    const image = posterRef.current;
    const loaded = async () => {
      if (!image.naturalWidth) return;
      try { await image.decode(); } catch { return; }
      if (!disposed) callbacks.current.onPosterReady?.();
    };
    image.addEventListener("load", loaded);
    if (image.complete) loaded();
    return () => {
      disposed = true;
      image.removeEventListener("load", loaded);
    };
  }, []);
  return (
    <div className={className} data-scene-ready={ready} data-scene-presented={presented}>
      <picture className={styles.scenePoster} aria-hidden="true">
        <source
          media="(max-aspect-ratio: 1/1)"
          srcSet="/assets/home-scene/afternoon-room-mobile.webp"
          type="image/webp"
          width="780"
          height="2400"
        />
        <img
          ref={posterRef}
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
        {ready && presented && position && <DeskMusicPlayer position={position} />}
      </div>
    </div>
  );
}
