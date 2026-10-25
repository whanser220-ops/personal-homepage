import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import * as THREE from "three";
import { createFrameClock, scenePixelRatio } from "../src/lib/home-scene/renderBudget.js";

// Execute the real lifecycle with real scene/camera/material objects. Replace
// only browser/GPU boundaries, so controlled loader and frame failures are
// reproducible without WebGL or a source-text assertion standing in for a test.
const source = (await readFile(new URL("../src/lib/home-scene/createCafeScene.js", import.meta.url), "utf8"))
  .replace(/^import .*;\r?\n/gm, "")
  .replace(/^export /gm, "");

function setup(options = {}, configuration = {}) {
  let now = 0, nextFrame = 1, resolveModel, rejectModel;
  const frames = new Map(), events = [], ready = [], errors = [];
  const state = { ...configuration, rendererDisposals: 0, environmentCreates: 0, environmentDisposals: 0, draws: 0 };
  const model = new Promise((resolve, reject) => { resolveModel = resolve; rejectModel = reject; });
  const host = {
    dataset: {}, clientWidth: configuration.width ?? 1440, clientHeight: configuration.height ?? 900, children: [],
    appendChild(child) { this.children.push(child); child.remove = () => { this.children = this.children.filter(item => item !== child); }; },
  };
  class Renderer {
    constructor(settings) {
      if (state.creationError) throw state.creationError;
      state.renderer = this;
      state.rendererSettings = settings;
      this.domElement = new EventTarget();
      this.domElement.setAttribute = () => {};
      this.domElement.remove = () => {};
      this.shadowMap = {};
      this.debug = {};
    }
    setPixelRatio(value) { state.pixelRatio = value; }
    getPixelRatio() { return state.pixelRatio; }
    setSize(width, height) { state.dimensions = [width, height]; }
    getContext() { return { isContextLost: () => Boolean(state.contextLost) }; }
    dispose() { state.rendererDisposals++; }
  }
  class EnvironmentGenerator {
    fromScene() {
      if (state.environmentError) throw state.environmentError;
      state.environmentCreates++;
      const target = new THREE.WebGLRenderTarget(1, 1);
      target.addEventListener("dispose", () => state.environmentDisposals++);
      return target;
    }
    dispose() {}
  }
  class Loader {
    constructor(manager) { state.manager = manager; }
    loadAsync() { return model; }
  }
  class Observer {
    constructor(callback) { this.callback = callback; state.observers ??= []; state.observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const motion = new EventTarget(); motion.matches = Boolean(configuration.reduced);
  const document = new EventTarget(); document.hidden = false; document.querySelector = () => null;
  const api = runInNewContext(`${source}\n({ createCafeScene });`, {
    THREE: { ...THREE, WebGLRenderer: Renderer, PMREMGenerator: EnvironmentGenerator },
    GLTFLoader: Loader,
    RoomEnvironment: class { dispose() {} },
    createCafeAO: () => ({ maskUpdates: 0, resize() {}, invalidate() {}, apply() { events.push("ao"); }, dispose() {} }),
    createInsetWater: () => ({ attach() {}, resize() {}, update() {}, capture() { events.push("capture"); }, dispose() {} }),
    createIcedCoffee: renderer => ({
      attach() {}, resize() {}, update() {}, dispose() {},
      render(camera, applyAO) {
        events.push("coffee"); state.draws++;
        if (state.shaderError) renderer.debug.onShaderError();
        if (state.drawError) throw state.drawError;
        if (state.contextDuringDraw) state.contextLost = true;
        applyAO();
      },
    }),
    createFrameClock, scenePixelRatio,
    observeNavigationActivity(nav, callback) { state.navigation = callback; return () => { state.navigationStopped = true; }; },
    ResizeObserver: Observer, IntersectionObserver: Observer,
    document, window: { innerWidth: host.clientWidth, devicePixelRatio: 2, matchMedia: () => motion },
    performance: { now: () => now }, queueMicrotask,
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    console: { error() {} },
  });
  const cleanup = api.createCafeScene(host, () => {}, value => { events.push(`ready:${value}`); ready.push(value); }, {
    onError: error => errors.push(error), ...options,
  });
  return {
    state, host, cleanup, frames, events, ready, errors, document,
    async load(root = new THREE.Scene()) { resolveModel({ scene: root }); await this.settle(); return root; },
    async reject(error = new Error("model unavailable")) { rejectModel(error); await this.settle(); },
    async settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); },
    async frame(time = 1000) {
      now = time;
      const [id, callback] = frames.entries().next().value ?? [];
      assert.ok(callback, "a scene frame is scheduled");
      frames.delete(id); callback(time); await this.settle();
    },
    lose() { state.contextLost = true; state.renderer.domElement.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); },
    restore() { state.contextLost = false; state.renderer.domElement.dispatchEvent(new Event("webglcontextrestored")); },
  };
}

function disposableModel() {
  let disposals = 0;
  const root = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  geometry.addEventListener("dispose", () => disposals++);
  const material = new THREE.MeshBasicMaterial(); material.name = "Warm plaster";
  root.add(new THREE.Mesh(geometry, material));
  return { root, get disposals() { return disposals; } };
}

test("background preparation reports only the complete first frame and then yields to the intro", async context => {
  const scene = setup({ initiallyPresented: false }); context.after(scene.cleanup);
  await scene.load();
  assert.deepEqual(scene.ready, []);
  await scene.frame();
  assert.deepEqual(scene.events.slice(-4), ["capture", "coffee", "ao", "ready:true"]);
  assert.deepEqual(scene.ready, [true]);
  assert.equal(scene.frames.size, 0);
  assert.equal(scene.host.dataset.scenePresentationPaused, "true");
  assert.equal(scene.state.pixelRatio, 1.75);
  assert.equal(scene.state.rendererSettings.antialias, true);
  scene.cleanup.setPresented(true);
  await scene.frame(1100);
  assert.equal(scene.frames.size, 1);
  assert.equal(scene.host.dataset.scenePresentationPaused, "false");
  scene.cleanup.setPresented(false);
  assert.equal(scene.frames.size, 0);
  scene.state.observers[0].callback(); // Resize repaints once even behind the intro.
  await scene.frame(1200);
  assert.equal(scene.frames.size, 0);
  assert.equal(scene.state.draws, 3);
});

test("navigation pause and presentation pause compose without accidentally restarting hidden animation", async context => {
  const scene = setup({}, { width: 390, height: 844 }); context.after(scene.cleanup);
  await scene.load(); await scene.frame();
  assert.equal(scene.state.pixelRatio, 1.4);
  scene.state.navigation(true);
  assert.equal(scene.frames.size, 0);
  scene.cleanup.setPresented(false);
  scene.state.navigation(false);
  assert.equal(scene.frames.size, 0);
  scene.cleanup.setPresented(true);
  assert.equal(scene.frames.size, 1);
});

test("model rejection emits one final error, releases resources and cannot later report ready", async () => {
  const scene = setup({ initiallyPresented: false });
  await scene.reject();
  scene.state.manager.itemError("duplicate failure");
  await scene.settle();
  assert.equal(scene.errors.length, 1);
  assert.deepEqual(scene.ready, [false]);
  assert.equal(scene.host.dataset.sceneState, "error");
  assert.equal(scene.state.rendererDisposals, 1);
  assert.equal(scene.host.children.length, 0);
  scene.cleanup.setPresented(true);
  assert.equal(scene.frames.size, 0);
});

test("a tolerated texture failure stays fatal when GLTFLoader subsequently resolves", async () => {
  const scene = setup({ initiallyPresented: false });
  scene.state.manager.itemError("blob:failed-image");
  const model = disposableModel();
  await scene.load(model.root);
  assert.equal(scene.errors.length, 1);
  assert.deepEqual(scene.ready, [false]);
  assert.equal(model.disposals, 1);
  assert.equal(scene.frames.size, 0);
});

for (const failure of ["drawError", "shaderError"]) {
  test(`${failure} cannot turn an incomplete first frame into ready`, async () => {
    const scene = setup({ initiallyPresented: false }, { [failure]: new Error("first frame failed") });
    await scene.load(); await scene.frame();
    assert.deepEqual(scene.ready, [false]);
    assert.equal(scene.errors.length, 1);
    assert.equal(scene.frames.size, 0);
    assert.equal(scene.state.rendererDisposals, 1);
  });
}

test("ordinary context loss is recoverable and rebuilds a complete background frame", async context => {
  const scene = setup({ initiallyPresented: false }); context.after(scene.cleanup);
  await scene.load(); await scene.frame();
  scene.lose();
  assert.deepEqual(scene.ready, [true, false]);
  assert.equal(scene.errors.length, 0);
  scene.restore(); await scene.frame(1300);
  assert.deepEqual(scene.ready, [true, false, true]);
  assert.equal(scene.state.environmentCreates, 2);
  assert.equal(scene.state.environmentDisposals, 1);
  assert.equal(scene.frames.size, 0);
});

test("context disappearing during a draw is not mistaken for either ready or a permanent failure", async context => {
  const scene = setup({ initiallyPresented: false }, { contextDuringDraw: true }); context.after(scene.cleanup);
  await scene.load(); await scene.frame();
  assert.deepEqual(scene.ready, [false]);
  assert.equal(scene.errors.length, 0);
  scene.state.contextDuringDraw = false;
  scene.restore(); await scene.frame(1300);
  assert.deepEqual(scene.ready, [false, true]);
});

test("environment restoration failure emits one final error and releases the renderer", async () => {
  const scene = setup({ initiallyPresented: false });
  await scene.load(); await scene.frame(); scene.lose();
  scene.state.environmentError = new Error("restoration failed");
  scene.restore(); await scene.settle();
  assert.equal(scene.errors.length, 1);
  assert.equal(scene.frames.size, 0);
  assert.equal(scene.state.rendererDisposals, 1);
  assert.ok(!scene.ready.slice(1).includes(true));
});

test("partially initialized scenes are cleaned and late models are disposed after setup fails", async () => {
  const scene = setup({}, { environmentError: new Error("environment failed") });
  const model = disposableModel(); await scene.load(model.root);
  assert.equal(scene.errors.length, 1);
  assert.equal(scene.state.rendererDisposals, 1);
  assert.equal(scene.host.children.length, 0);
  assert.equal(model.disposals, 1);
  assert.equal(typeof scene.cleanup.setPresented, "function");
});

test("unavailable WebGL still returns a safe cleanup and a final error signal", async () => {
  const scene = setup({}, { creationError: new Error("WebGL unavailable") });
  await scene.settle();
  assert.equal(scene.errors.length, 1);
  assert.deepEqual(scene.ready, [false]);
  assert.equal(scene.host.children.length, 0);
  assert.doesNotThrow(() => { scene.cleanup.setPresented(true); scene.cleanup(); });
});

test("reduced motion draws a complete static frame while teardown suppresses all later callbacks", async () => {
  const scene = setup({}, { reduced: true });
  await scene.load(); await scene.frame();
  assert.deepEqual(scene.ready, [true]);
  assert.equal(scene.frames.size, 0);
  scene.cleanup(); scene.cleanup();
  scene.restore(); scene.cleanup.setPresented(true);
  assert.equal(scene.state.rendererDisposals, 1);
  assert.equal(scene.state.navigationStopped, true);
  assert.ok(scene.state.observers.every(observer => observer.disconnected));
  assert.equal(scene.host.dataset.scenePresentationPaused, undefined);
  assert.deepEqual(scene.ready, [true]);
});

test("unmount before the model resolves disposes it without readiness or error callbacks", async () => {
  const scene = setup(); const model = disposableModel();
  scene.cleanup(); await scene.load(model.root);
  assert.equal(model.disposals, 1);
  assert.deepEqual(scene.ready, []);
  assert.deepEqual(scene.errors, []);
  assert.equal(scene.frames.size, 0);
});
