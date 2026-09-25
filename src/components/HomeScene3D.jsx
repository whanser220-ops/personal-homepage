"use client";
import { useEffect, useRef, useState } from "react";
import { DeskMusicPlayer } from "./DeskMusicPlayer.jsx";

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
          cleanup = createCafeScene(hostRef.current, setPosition, () => setReady(true));
      })
      .catch((error) =>
        console.error("Cafe renderer unavailable.", error),
      );
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  return <div ref={hostRef} className={className}>{ready && position && <DeskMusicPlayer position={position}/>}</div>;
}
