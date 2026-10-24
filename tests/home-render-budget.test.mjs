import test from "node:test";
import assert from "node:assert/strict";
import {
  createFrameClock,
  createGpuTimer,
  createResolutionBudget,
  maximumPixelRatio,
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

test("pixel budget respects device DPR, viewport area, and mobile/desktop caps", () => {
  for (const [width, height, deviceRatio, cap, budget] of [
    [390, 844, 3, 1.25, 1_000_000],
    [320, 640, 1, 1.25, 1_000_000],
    [1440, 900, 2, 1.5, 2_500_000],
    [3840, 2160, 2, 1.5, 2_500_000],
    [1440, 900, 0.8, 1.5, 2_500_000],
  ]) {
    const ratio = maximumPixelRatio(width, height, deviceRatio);
    assert.ok(ratio > 0 && ratio <= cap && ratio <= deviceRatio);
    assert.ok(width * height * ratio * ratio <= budget + 0.001);
  }
});

function sampler(budget) {
  let time = 0;
  return {
    feed(duration, values = {}) {
      const frameMs = values.frameMs ?? 1000 / 30;
      const changes = [];
      const end = time + duration;
      while (time < end) {
        time += frameMs;
        const result = budget.sample({ time, frameMs, renderMs: 3, ...values });
        if (result !== null) changes.push({ time, ratio: result });
      }
      return changes;
    },
  };
}

test("resolution ignores transient overload but decreases for sustained GPU load", () => {
  const budget = createResolutionBudget(1.5);
  const sample = sampler(budget);
  assert.equal(budget.pixelRatio, 1);
  assert.deepEqual(sample.feed(1000, { gpuMs: 35 }), []);
  const changes = sample.feed(1800, { gpuMs: 35 });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].ratio, 0.85);
  assert.deepEqual(sample.feed(2000, { gpuMs: 35 }), [], "five-second cooldown prevents repeated reallocations");
});

test("resolution also reacts to CPU saturation and missed cadence without GPU timing", () => {
  for (const overload of [{ renderMs: 25 }, { frameMs: 1000 / 15 }, { frameMs: 1000 / 20 }]) {
    const budget = createResolutionBudget(1.5);
    const changes = sampler(budget).feed(3000, overload);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].ratio, 0.85);
  }
});

test("resolution recovers only after several comfortable sampling windows", () => {
  const budget = createResolutionBudget(1.5);
  const sample = sampler(budget);
  sample.feed(2600, { gpuMs: 35 });
  assert.equal(budget.pixelRatio, 0.85);
  assert.deepEqual(sample.feed(4500, { gpuMs: 7 }), [], "a short stable spell must not upscale");
  const changes = sample.feed(5500, { gpuMs: 7 });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].ratio, 1);
});

test("background-tab 1 fps callbacks do not lower resolution", () => {
  const budget = createResolutionBudget(1.5);
  const sample = sampler(budget);
  assert.deepEqual(sample.feed(20000, { frameMs: 1000, renderMs: 3, gpuMs: 7 }), []);
  assert.equal(budget.pixelRatio, 1);
  assert.deepEqual(sample.feed(1000, { gpuMs: 7 }), []);
});

test("very slow frames still lower resolution when measured work is expensive", () => {
  for (const cost of [{ gpuMs: 350 }, { renderMs: 300 }]) {
    const budget = createResolutionBudget(1.5);
    const changes = sampler(budget).feed(16000, { frameMs: 500, ...cost });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].ratio, 0.85);
  }
});

test("resolution clamps to a smaller viewport budget and never exceeds it on recovery", () => {
  const maximum = maximumPixelRatio(3840, 2160, 2);
  const budget = createResolutionBudget(1.5);
  assert.equal(budget.setMaximum(maximum), maximum);
  assert.deepEqual(sampler(budget).feed(30000, { gpuMs: 5 }), []);
  assert.equal(budget.pixelRatio, maximum);
  const lowDpr = createResolutionBudget(0.5);
  assert.equal(lowDpr.pixelRatio, 0.5);
  assert.deepEqual(sampler(lowDpr).feed(12000, { gpuMs: 50 }), []);
  assert.equal(lowDpr.pixelRatio, 0.5);
});

function fakeGpu({ supported = true } = {}) {
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const calls = { begun: [], ended: 0, deleted: [], results: 0, created: [] };
  let disjoint = false;
  const gl = {
    QUERY_RESULT_AVAILABLE: 3,
    QUERY_RESULT: 4,
    getExtension(name) { assert.equal(name, "EXT_disjoint_timer_query_webgl2"); return supported ? extension : null; },
    createQuery() { const query = { id: calls.created.length, available: false, nanoseconds: 12_000_000 }; calls.created.push(query); return query; },
    beginQuery(target, query) { assert.equal(target, extension.TIME_ELAPSED_EXT); calls.begun.push(query); },
    endQuery(target) { assert.equal(target, extension.TIME_ELAPSED_EXT); calls.ended++; },
    getParameter(key) { assert.equal(key, extension.GPU_DISJOINT_EXT); return disjoint; },
    getQueryParameter(query, key) {
      if (key === gl.QUERY_RESULT_AVAILABLE) return query.available;
      assert.equal(key, gl.QUERY_RESULT);
      assert.equal(query.available, true, "never ask for an unavailable result");
      calls.results++;
      return query.nanoseconds;
    },
    deleteQuery(query) { calls.deleted.push(query); },
    finish() { assert.fail("GPU timing must never block on finish()"); },
  };
  return { gl, calls, setDisjoint(value) { disjoint = value; } };
}

test("GPU timer tolerates unsupported timing without allocating queries", () => {
  const gpu = fakeGpu({ supported: false });
  const timer = createGpuTimer(gpu.gl);
  timer.begin(); timer.end();
  assert.equal(timer.poll(), undefined);
  timer.clear();
  assert.equal(gpu.calls.created.length, 0);
});

test("GPU timer polls asynchronously, caps pending work, and releases completed queries", () => {
  const gpu = fakeGpu();
  const timer = createGpuTimer(gpu.gl);
  for (let index = 0; index < 6; index++) { timer.begin(); timer.end(); }
  assert.equal(gpu.calls.created.length, 4, "unavailable results must not grow an unbounded query queue");
  assert.equal(timer.poll(), undefined);
  assert.equal(gpu.calls.results, 0);
  gpu.calls.created[0].available = true;
  assert.equal(timer.poll(), 12);
  assert.deepEqual(gpu.calls.deleted, [gpu.calls.created[0]]);
  timer.clear();
  assert.equal(gpu.calls.deleted.length, 4);
});

test("GPU timer discards disjoint samples and can clear an active query", () => {
  const gpu = fakeGpu();
  const timer = createGpuTimer(gpu.gl);
  timer.begin(); timer.end();
  timer.begin(); timer.end();
  gpu.setDisjoint(true);
  assert.equal(timer.poll(), undefined);
  assert.equal(gpu.calls.results, 0);
  assert.equal(gpu.calls.deleted.length, 2);
  gpu.setDisjoint(false);
  timer.begin();
  timer.begin(); // Starting twice must not overwrite the active query.
  assert.equal(gpu.calls.created.length, 3);
  timer.clear();
  assert.equal(gpu.calls.ended, 3);
  assert.equal(gpu.calls.deleted.length, 3);
  timer.clear();
  assert.equal(gpu.calls.deleted.length, 3, "clearing twice cannot delete a query twice");
});
