"use client";

import { useEffect, useRef } from "react";
import { createCoffeeIntro } from "../lib/home-scene/createCoffeeIntro.js";
import styles from "./HomeCoffeeIntro.module.css";

export function HomeCoffeeIntro({ onComplete, onError }) {
  const canvasRef = useRef(null);
  const callbacks = useRef({ onComplete, onError });
  const completed = useRef(false);
  const failed = useRef(false);

  useEffect(() => {
    callbacks.current = { onComplete, onError };
  }, [onComplete, onError]);

  useEffect(() => {
    let active = true;
    let cleanup;
    function handleError(error) {
      if (active && !failed.current) {
        failed.current = true;
        callbacks.current.onError?.(error);
      }
    }
    try {
      cleanup = createCoffeeIntro(canvasRef.current, {
        onComplete() {
          if (active && !completed.current) {
            completed.current = true;
            callbacks.current.onComplete?.();
          }
        },
        onError: handleError,
      });
    } catch (error) {
      handleError(error);
    }
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  return (
    <div className={styles.intro} aria-hidden="true">
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
    </div>
  );
}
