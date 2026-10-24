import test from "node:test";
import assert from "node:assert/strict";
import {
  createFrameClock,
  scenePixelRatio,
  SCENE_FPS,
} from "../src/lib/home-scene/renderBudget.js";

test("scene clock stays near 30 fps on 60, 120, and 144 Hz displays", () => {
  assert.equal(SCENE_FPS, 30);
  for (const displayHz of [59.94, 60, 120, 144]) {
    const clock = createFrameClock();
    let rendered = 0;
    for (let frame = 0; frame < displayHz * 10; frame++) {
      if (clock.due(frame * 1000 / displayHz)) rendered++;
    }
    assert.ok(rendered >= 299 && rendered <= 301, `${displayHz} Hz rendered ${rendered} frames`);
  }
});

test("scene clock presents startup, recovery, and resized views immediately after reset", () => {
  const clock = createFrameClock();
  assert.equal(clock.due(1000), true);
  assert.equal(clock.due(1001), false);
  clock.reset(); // Visibility recovery does not wait for the old cadence.
  assert.equal(clock.due(9000), true);
  assert.equal(clock.due(9001), false);
  clock.reset(); // The resized canvas is repainted in the current frame.
  assert.equal(clock.due(9002), true);
  assert.equal(clock.due(9003), false);
});

test("scene clock skips early callbacks without losing the cadence remainder", () => {
  const clock = createFrameClock();
  assert.equal(clock.due(0), true);
  assert.equal(clock.due(16.667), false);
  assert.equal(clock.due(33.333), true);
  assert.equal(clock.due(50), false);
  assert.equal(clock.due(66.667), true);
  assert.equal(clock.due(1000), true); // A missed interval causes one render, no burst.
  assert.equal(clock.due(1001), false);
});

test("scene preserves device clarity within the original desktop and mobile caps", () => {
  for (const [width, deviceRatio, expected] of [
    [1440, 1.5, 1.5],
    [1440, 2, 1.75],
    [390, 3, 1.4],
    [1440, 1, 1],
    [320, 1, 1],
    [1440, 0.8, 0.8],
    [390, 0.8, 0.8],
    [699, 2, 1.4],
    [700, 2, 1.75],
  ]) {
    assert.equal(scenePixelRatio(width, deviceRatio), expected, `${width}px at device DPR ${deviceRatio}`);
  }
  assert.equal(scenePixelRatio(1440), 1, "missing device DPR uses 1");
});

test("large desktop views retain the same sharpness instead of shrinking to a pixel budget", () => {
  for (const width of [1440, 1920, 2560, 3840, 7680]) {
    assert.equal(scenePixelRatio(width, 1.5), 1.5, `${width}px keeps device DPR 1.5`);
    assert.equal(scenePixelRatio(width, 2), 1.75, `${width}px keeps the desktop cap`);
  }
});
