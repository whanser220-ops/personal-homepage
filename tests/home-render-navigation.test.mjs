import test from "node:test";
import assert from "node:assert/strict";
import { observeNavigationActivity } from "../src/lib/home-scene/navigationActivity.js";

class FakeNavigation extends EventTarget {
  dataset = { expanded: "false" };
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

  fire(type, properties = {}) {
    this.dispatchEvent(Object.assign(new Event(type), properties));
  }
}

function setup(expanded = false) {
  const nav = new FakeNavigation();
  nav.dataset.expanded = String(expanded);
  const changes = [];
  const timers = new Map();
  let now = 0;
  let nextTimer = 1;
  let observer;
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
      this.connected = true;
    }
    disconnect() { this.connected = false; }
    notify() { if (this.connected) this.callback(); }
  }
  const stop = observeNavigationActivity(nav, value => changes.push(value), {
    Observer: FakeObserver,
    setTimer(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
  });
  return {
    nav, changes, timers, observer, stop,
    expand(value) {
      nav.dataset.expanded = String(value);
      observer.notify();
    },
    tick(milliseconds) {
      const target = now + milliseconds;
      while (timers.size) {
        const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (timer.at > target) break;
        now = timer.at;
        timers.delete(id);
        timer.callback();
      }
      now = target;
    },
  };
}

test("native mouse entry pauses before React expands the dock", context => {
  const activity = setup();
  context.after(activity.stop);
  assert.deepEqual(activity.changes, []);
  activity.nav.fire("pointerenter", { pointerType: "mouse" });
  assert.equal(activity.nav.dataset.expanded, "false");
  assert.deepEqual(activity.changes, [true]);
  activity.expand(true);
  activity.nav.fire("pointerenter", { pointerType: "mouse" });
  assert.deepEqual(activity.changes, [true], "expansion does not pause twice");
});

test("keyboard focus pauses immediately and expanded state keeps the scene paused", context => {
  const activity = setup();
  context.after(activity.stop);
  activity.nav.fire("focusin");
  assert.deepEqual(activity.changes, [true]);
  activity.expand(true);
  activity.nav.fire("focusout");
  activity.tick(1000);
  assert.deepEqual(activity.changes, [true]);
  assert.equal(activity.timers.size, 0);
});

test("expanded state pauses touch navigation without relying on mouse hover", context => {
  const activity = setup();
  context.after(activity.stop);
  activity.nav.fire("pointerenter", { pointerType: "touch" });
  assert.deepEqual(activity.changes, []);
  activity.expand(true);
  assert.deepEqual(activity.changes, [true]);
  assert.equal(activity.observer.target, activity.nav);
  assert.deepEqual(activity.observer.options, {
    attributes: true,
    attributeFilter: ["data-expanded"],
  });
});

test("an already expanded dock pauses when scene observation starts", context => {
  const activity = setup(true);
  context.after(activity.stop);
  assert.deepEqual(activity.changes, [true]);
});

test("collapse resumes only after the closing transition has finished", context => {
  const activity = setup(true);
  context.after(activity.stop);
  activity.expand(false);
  assert.equal(activity.timers.size, 1);
  activity.tick(219);
  assert.deepEqual(activity.changes, [true]);
  activity.tick(1);
  assert.deepEqual(activity.changes, [true, false]);
  activity.tick(1000);
  assert.deepEqual(activity.changes, [true, false], "resume fires once");
});

test("rapid mouse re-entry cancels a pending resume until a later collapse", context => {
  const activity = setup(true);
  context.after(activity.stop);
  activity.expand(false);
  activity.tick(100);
  activity.nav.fire("pointerenter", { pointerType: "mouse" });
  assert.equal(activity.timers.size, 0);
  activity.tick(1000);
  assert.deepEqual(activity.changes, [true]);
  activity.expand(true);
  activity.expand(false);
  activity.tick(220);
  assert.deepEqual(activity.changes, [true, false]);
});

test("leaving a dock that never expanded still releases its native hover pause", context => {
  const activity = setup();
  context.after(activity.stop);
  activity.nav.fire("pointerenter", { pointerType: "mouse" });
  activity.nav.fire("pointerleave", { pointerType: "mouse" });
  activity.tick(220);
  assert.deepEqual(activity.changes, [true, false]);
});

test("cleanup removes native listeners, observer and pending resume without late callbacks", () => {
  const activity = setup(true);
  activity.expand(false);
  assert.equal(activity.timers.size, 1);
  activity.stop();
  assert.equal(activity.timers.size, 0);
  assert.equal(activity.observer.connected, false);
  for (const listeners of activity.nav.listeners.values()) assert.equal(listeners.size, 0);
  activity.nav.fire("pointerenter", { pointerType: "mouse" });
  activity.nav.fire("pointerleave", { pointerType: "mouse" });
  activity.nav.fire("focusin");
  activity.nav.fire("focusout");
  activity.expand(true);
  activity.tick(1000);
  assert.deepEqual(activity.changes, [true]);
});

test("missing navigation is safe before hydration or during teardown", () => {
  const changes = [];
  const stop = observeNavigationActivity(null, value => changes.push(value), {
    Observer: class { constructor() { assert.fail("must not observe a missing dock"); } },
    setTimer() { assert.fail("must not schedule without a dock"); },
    clearTimer() { assert.fail("must not clear timers without a dock"); },
  });
  assert.equal(typeof stop, "function");
  assert.doesNotThrow(stop);
  assert.deepEqual(changes, []);
});
