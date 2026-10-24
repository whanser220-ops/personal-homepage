export const SCENE_FPS = 30;

export function createFrameClock(fps = SCENE_FPS) {
  const interval = 1000 / fps;
  let previous;
  return {
    reset() { previous = undefined; },
    due(time) {
      if (previous === undefined) { previous = time; return true; }
      const elapsed = time - previous;
      if (elapsed + 0.5 < interval) return false;
      // Keep the remainder so a 60Hz display does not accidentally become 20fps.
      previous += Math.max(1, Math.floor((elapsed + 0.5) / interval)) * interval;
      return true;
    },
  };
}

// Keep the original scene detail. Throttle rendering and reuse effect buffers
// instead of stretching a lower-resolution image over the entire viewport.
export function scenePixelRatio(width, deviceRatio = 1) {
  return Math.min(deviceRatio, width < 700 ? 1.4 : 1.75);
}
