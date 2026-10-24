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
    setClearColor(color) { clearColor.set(color); },
    setClearAlpha(alpha) { clearAlpha = alpha; },
    clear() {},
    render(mesh) {
      draws.push({
        material: mesh.material,
        source: mesh.material.uniforms.uColor?.value,
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

test("reuses the denoised AO while composing the latest color every frame", context => {
  const { ao, renderer, source, draws, previousTarget } = setup(context);
  try {
    const output = ao.apply(source);
    // Two real GTAOPass draws (AO and denoise), then one color composition.
    assert.equal(draws.length, 3);
    assert.equal(draws.at(-1).source, source.texture);
    assert.equal(draws.at(-1).target.texture, output);

    const nextColor = new THREE.Texture();
    assert.equal(ao.apply({ ...source, texture: nextColor }), output);
    assert.equal(draws.length, 4);
    assert.equal(draws.at(-1).source, nextColor);
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
    assert.equal(draws.length, 3);
    ao.invalidate();
    ao.apply(source);
    assert.equal(draws.length, 6);
    ao.resize();
    ao.apply(source);
    assert.equal(draws.length, 9);
    source.depthTexture = new THREE.DepthTexture(1280, 720);
    ao.apply(source);
    assert.equal(draws.length, 12);
    camera.fov = 50;
    camera.updateProjectionMatrix();
    ao.apply(source);
    assert.equal(draws.length, 15);
    camera.position.x = 1;
    camera.updateMatrixWorld();
    ao.apply(source);
    assert.equal(draws.length, 18);
    ao.apply(source);
    assert.equal(draws.length, 19);
  } finally {
    ao.dispose();
  }
});

test("refreshes moving depth at 4 Hz without scheduling extra animation frames", context => {
  const { ao, source, draws, setTime } = setup(context);
  try {
    ao.apply(source);
    assert.equal(draws.length, 3);
    setTime(249);
    ao.apply(source);
    assert.equal(draws.length, 4);
    setTime(250);
    ao.apply(source);
    assert.equal(draws.length, 7);
    setTime(499);
    ao.apply(source);
    assert.equal(draws.length, 8);
    setTime(500);
    ao.apply(source);
    assert.equal(draws.length, 11);
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
    renderer.render = originalRender;
    ao.apply(source);
    assert.equal(draws.length, 3);
  } finally {
    ao.dispose();
  }
});
