import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createCafeAO } from "../src/lib/home-scene/createCafeAO.js";

function setup(context) {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const previousTarget = {};
  let renderTarget = previousTarget;
  const clearColor = new THREE.Color(0.25, 0.5, 0.75);
  let clearAlpha = 0.8;
  const draws = [];
  const renderer = {
    autoClear: true,
    domElement: { clientWidth: 1280 },
    getDrawingBufferSize: size => size.set(1280, 720),
    getRenderTarget: () => renderTarget,
    setRenderTarget: target => { renderTarget = target; },
    getClearColor: target => target.copy(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor(color, alpha = clearAlpha) { clearColor.set(color); clearAlpha = alpha; },
    setClearAlpha(alpha) { clearAlpha = alpha; },
    clear() {},
    render(mesh) {
      draws.push({
        material: mesh.material,
        depth: mesh.material.uniforms.tDepth?.value,
        target: renderTarget,
      });
    },
  };
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 70);
  const ao = createCafeAO(renderer, new THREE.Scene(), camera);
  const source = { texture: new THREE.Texture(), depthTexture: new THREE.DepthTexture(1280, 720) };
  ao.resize();
  return { ao, renderer, camera, source, draws, previousTarget, setTime: time => { now = time; } };
}

test("returns a cached mask without per-frame color copies or a full-size output target", context => {
  const { ao, renderer, source, draws, previousTarget } = setup(context);
  try {
    const mask = ao.apply(source);
    // Only the real GTAOPass AO and denoise draws remain.
    assert.equal(draws.length, 2);
    assert.equal(draws.at(-1).target.texture, mask.texture);
    assert.equal(mask.intensity, 0.55);
    assert.deepEqual(draws.map(draw => [draw.target.width, draw.target.height]), [[960, 540], [960, 540]]);

    const nextColor = new THREE.Texture();
    assert.equal(ao.apply({ ...source, texture: nextColor }), mask);
    assert.equal(draws.length, 2);
    assert.equal(renderer.getRenderTarget(), previousTarget);
    assert.equal(renderer.autoClear, true);
  } finally {
    ao.dispose();
  }
});

test("refreshes the mask after explicit invalidation, resize, depth replacement and camera changes", context => {
  const { ao, camera, source, draws } = setup(context);
  try {
    ao.apply(source);
    assert.equal(draws.length, 2);
    ao.invalidate();
    ao.apply(source);
    assert.equal(draws.length, 4);
    ao.resize();
    ao.apply(source);
    assert.equal(draws.length, 6);
    source.depthTexture = new THREE.DepthTexture(1280, 720);
    ao.apply(source);
    assert.equal(draws.length, 8);
    assert.equal(draws.at(-2).depth, source.depthTexture);
    assert.equal(draws.at(-1).depth, source.depthTexture);
    camera.fov = 50;
    camera.updateProjectionMatrix();
    ao.apply(source);
    assert.equal(draws.length, 10);
    camera.position.x = 1;
    camera.updateMatrixWorld();
    ao.apply(source);
    assert.equal(draws.length, 12);
    ao.apply(source);
    assert.equal(draws.length, 12);
    assert.equal(ao.maskUpdates, 6);
  } finally {
    ao.dispose();
  }
});

test("refreshes moving depth at 4 Hz without scheduling extra animation frames", context => {
  const { ao, source, draws, setTime } = setup(context);
  try {
    ao.apply(source);
    assert.equal(draws.length, 2);
    setTime(249);
    ao.apply(source);
    assert.equal(draws.length, 2);
    setTime(250);
    ao.apply(source);
    assert.equal(draws.length, 4);
    setTime(499);
    ao.apply(source);
    assert.equal(draws.length, 4);
    setTime(500);
    ao.apply(source);
    assert.equal(draws.length, 6);
  } finally {
    ao.dispose();
  }
});

test("restores the caller render state and retries an interrupted mask render", context => {
  const { ao, renderer, source, draws, previousTarget } = setup(context);
  const originalRender = renderer.render;
  renderer.autoClear = false;
  renderer.render = () => { throw new Error("interrupted draw"); };
  try {
    assert.throws(() => ao.apply(source), /interrupted draw/);
    assert.equal(renderer.getRenderTarget(), previousTarget);
    assert.equal(renderer.autoClear, false);
    assert.equal(renderer.getClearAlpha(), 0.8);
    assert.deepEqual(renderer.getClearColor(new THREE.Color()).toArray(), [0.25, 0.5, 0.75]);
    assert.equal(ao.maskUpdates, 0);
    renderer.render = originalRender;
    ao.apply(source);
    assert.equal(draws.length, 2);
    assert.equal(ao.maskUpdates, 1);
  } finally {
    ao.dispose();
  }
});

test("releases cached mask targets and materials without owning the source depth", context => {
  const { ao, source, draws } = setup(context);
  ao.apply(source);
  const targets = new Set(draws.map(draw => draw.target));
  const materials = new Set(draws.map(draw => draw.material));
  let targetDisposals = 0, materialDisposals = 0, depthDisposals = 0;
  for (const target of targets) target.addEventListener("dispose", () => targetDisposals++);
  for (const material of materials) material.addEventListener("dispose", () => materialDisposals++);
  source.depthTexture.addEventListener("dispose", () => depthDisposals++);
  ao.dispose();
  assert.equal(targetDisposals, 2);
  assert.equal(materialDisposals, 2);
  assert.equal(depthDisposals, 0);
});
