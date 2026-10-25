import test from "node:test";
import assert from "node:assert/strict";
import { COFFEE_INTRO_DURATION_MS, createCoffeeIntro } from "../src/lib/home-scene/createCoffeeIntro.js";

class TrackedEvents extends EventTarget {
  listeners = new Map();
  addEventListener(type, listener, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  listenerCount() { return [...this.listeners.values()].reduce((sum, values) => sum + values.size, 0); }
}

class DrawingContext {
  globalAlpha = 1;
  images = [];
  fills = [];
  stack = [];
  throwOnDraw = false;
  save() { this.stack.push(this.globalAlpha); }
  restore() { this.globalAlpha = this.stack.pop() ?? 1; }
  drawImage(image) {
    if (this.throwOnDraw) throw new Error("canvas draw interrupted");
    assert.ok(image.width > 0 && image.height > 0, "must not draw a released cache");
    this.images.push({ image, alpha: this.globalAlpha });
  }
  fillRect() { this.fills.push(this.fillStyle); }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createPattern(source) { return { source }; }
  ellipse(x, y, rx, ry) {
    assert.ok([x, y, rx, ry].every(Number.isFinite));
    assert.ok(rx >= 0 && ry >= 0);
  }
  beginPath() {}
  moveTo() {}
  bezierCurveTo() {}
  lineTo() {}
  closePath() {}
  fill() {}
  stroke() {}
  clip() {}
  scale() {}
  translate() {}
  rotate() {}
  setTransform() {}
  clearRect() {}
}

function setup({ width = 900, height = 620, dpr = 1, reducedMotion = false, noContext = false } = {}) {
  let now = 0, nextFrame = 1;
  let background = "rgb(250, 249, 245)";
  const callbacks = new Map();
  const canvases = [];
  const observers = [];
  const changes = [];
  const errors = [];
  const doc = new TrackedEvents();
  const view = new TrackedEvents();
  const motion = new TrackedEvents();
  const box = { width, height };
  const host = { getBoundingClientRect: () => box };
  motion.matches = reducedMotion;
  doc.hidden = false;
  doc.defaultView = view;
  doc.documentElement = {};
  doc.createElement = tag => {
    assert.equal(tag, "canvas");
    const context = new DrawingContext();
    const value = { width: 300, height: 150, getContext: () => context };
    value.context = context;
    canvases.push(value);
    return value;
  };
  view.devicePixelRatio = dpr;
  view.performance = { now: () => now };
  view.matchMedia = () => motion;
  view.getComputedStyle = () => ({ backgroundColor: background });
  view.requestAnimationFrame = callback => { const id = nextFrame++; callbacks.set(id, callback); return id; };
  view.cancelAnimationFrame = id => callbacks.delete(id);
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
    notify() { if (this.connected) this.callback(); }
  }
  view.ResizeObserver = Observer;
  view.MutationObserver = Observer;
  const canvas = doc.createElement("canvas");
  canvas.ownerDocument = doc;
  canvas.parentElement = host;
  if (noContext) canvas.getContext = () => null;
  const start = () => createCoffeeIntro(canvas, {
    onComplete: () => changes.push("complete"),
    onError: error => errors.push(error),
  });
  return {
    doc, view, motion, canvas, canvases, callbacks, observers, box, changes, errors, start,
    frameAt(time) {
      now = time;
      for (const [id, callback] of [...callbacks]) {
        if (!callbacks.delete(id)) continue;
        callback(time);
      }
    },
    hide(value) { doc.hidden = value; doc.dispatchEvent(new Event("visibilitychange")); },
    setMotion(value) { motion.matches = value; motion.dispatchEvent(new Event("change")); },
    setBackground(value) { background = value; observers[1].notify(); },
  };
}

test("completes once at 4.8 seconds and retains a cached full cup while waiting for 3D", context => {
  const intro = setup();
  const stop = intro.start();
  context.after(stop);
  assert.equal(COFFEE_INTRO_DURATION_MS, 4800);
  intro.frameAt(4799);
  assert.deepEqual(intro.changes, []);
  intro.frameAt(4800);
  assert.deepEqual(intro.changes, ["complete"]);
  const stillLayers = intro.canvas.context.images.slice(-2).map(value => value.image);
  const allocated = intro.canvases.length;
  intro.frameAt(9600);
  assert.deepEqual(intro.changes, ["complete"]);
  assert.deepEqual(intro.canvas.context.images.slice(-2).map(value => value.image), stillLayers);
  assert.ok(intro.canvas.context.images.slice(-2).every(value => value.alpha === 1), "the cup must not fade itself out");
  assert.equal(intro.canvases.length, allocated, "waiting steam reuses the static artwork");
  assert.equal(intro.callbacks.size, 1, "gentle steam continues until parent cleanup");
  assert.deepEqual(intro.errors, []);
});

test("hidden time does not advance the pour or completion deadline", context => {
  const intro = setup();
  context.after(intro.start());
  intro.frameAt(1000);
  intro.hide(true);
  assert.equal(intro.callbacks.size, 0);
  intro.frameAt(100000);
  intro.hide(false);
  intro.frameAt(103799);
  assert.deepEqual(intro.changes, []);
  intro.frameAt(103800);
  assert.deepEqual(intro.changes, ["complete"]);
});

test("reduced motion presents a static full cup and completes immediately", context => {
  const intro = setup({ reducedMotion: true });
  context.after(intro.start());
  assert.deepEqual(intro.changes, ["complete"]);
  assert.equal(intro.callbacks.size, 0);
  assert.equal(intro.canvas.context.images.at(-1).alpha, 1);
  intro.frameAt(5000);
  assert.deepEqual(intro.changes, ["complete"]);
});

test("switching to reduced motion completes once and stops scheduled motion", context => {
  const intro = setup();
  context.after(intro.start());
  intro.frameAt(1000);
  intro.setMotion(true);
  assert.deepEqual(intro.changes, ["complete"]);
  assert.equal(intro.callbacks.size, 0);
  intro.setMotion(false);
  intro.frameAt(9000);
  assert.deepEqual(intro.changes, ["complete"]);
});

test("zero-sized mounting waits safely, then resizes sharply with a DPR cap of two", context => {
  const intro = setup({ width: 0, height: 0, dpr: 3 });
  context.after(intro.start());
  assert.equal(intro.callbacks.size, 0);
  assert.equal(intro.canvases.length, 1, "no offscreen targets are allocated before a valid size");
  intro.frameAt(1000);
  intro.box.width = 390;
  intro.box.height = 844;
  intro.observers[0].notify();
  assert.equal(intro.canvas.width, 780);
  assert.equal(intro.canvas.height, 1688);
  assert.equal(intro.callbacks.size, 1);
  intro.frameAt(5799);
  assert.deepEqual(intro.changes, []);
  intro.frameAt(5800);
  assert.deepEqual(intro.changes, ["complete"]);
  intro.box.width = 320;
  intro.box.height = 720;
  intro.observers[0].notify();
  assert.equal(intro.canvas.width, 640);
  assert.equal(intro.canvas.height, 1440);
});

test("theme changes rebuild the paper background while retaining cached cup artwork", context => {
  const intro = setup();
  context.after(intro.start());
  intro.frameAt(4800);
  const previous = intro.canvas.context.images.slice(-2).map(value => value.image);
  intro.setBackground("rgb(30, 25, 22)");
  const next = intro.canvas.context.images.slice(-2).map(value => value.image);
  assert.notEqual(next[0], previous[0]);
  assert.equal(previous[0].width, 0, "the replaced background is released");
  assert.equal(next[0].context.fills[0], "rgb(30, 25, 22)");
  assert.equal(next[1], previous[1]);
  assert.deepEqual(intro.changes, ["complete"]);
});

test("cleanup releases caches, listeners and observers and ignores a late frame", () => {
  const intro = setup();
  const stop = intro.start();
  const lateFrame = [...intro.callbacks.values()][0];
  stop();
  stop();
  assert.equal(intro.callbacks.size, 0);
  assert.ok(intro.observers.every(value => !value.connected));
  assert.equal(intro.doc.listenerCount(), 0);
  assert.equal(intro.view.listenerCount(), 0);
  assert.equal(intro.motion.listenerCount(), 0);
  assert.ok(intro.canvases.every(value => value.width === 0 && value.height === 0));
  lateFrame(10000);
  intro.observers.forEach(value => value.callback());
  assert.deepEqual(intro.changes, []);
  assert.deepEqual(intro.errors, []);
});

test("an interrupted canvas draw reports once and releases its lifecycle immediately", () => {
  const intro = setup();
  const stop = intro.start();
  intro.canvas.context.throwOnDraw = true;
  intro.frameAt(100);
  assert.equal(intro.errors.length, 1);
  assert.match(intro.errors[0].message, /draw interrupted/);
  assert.equal(intro.callbacks.size, 0);
  assert.ok(intro.observers.every(value => !value.connected));
  assert.equal(intro.doc.listenerCount(), 0);
  intro.frameAt(10000);
  stop();
  assert.equal(intro.errors.length, 1);
  assert.deepEqual(intro.changes, []);
});

test("a setup-cleanup-setup cycle on the same canvas leaves only the current lifecycle", () => {
  const intro = setup();
  const stopFirst = intro.start();
  stopFirst();
  const stopSecond = intro.start();
  assert.equal(intro.callbacks.size, 1);
  assert.equal(intro.doc.listenerCount(), 1);
  assert.equal(intro.motion.listenerCount(), 1);
  intro.frameAt(4800);
  assert.deepEqual(intro.changes, ["complete"]);
  stopSecond();
  assert.equal(intro.callbacks.size, 0);
});

test("missing 2D context fails before installing any lifecycle work", () => {
  const intro = setup({ noContext: true });
  assert.throws(intro.start, /canvas is unavailable/);
  assert.equal(intro.callbacks.size, 0);
  assert.equal(intro.observers.length, 0);
  assert.equal(intro.doc.listenerCount(), 0);
});
