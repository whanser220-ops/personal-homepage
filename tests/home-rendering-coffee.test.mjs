import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createIcedCoffee } from "../src/lib/home-scene/createIcedCoffee.js";

function setup() {
  const previousTarget = {};
  let renderTarget = previousTarget;
  const clearColor = new THREE.Color(0.25, 0.5, 0.75);
  let clearAlpha = 0.8;
  const draws = [];
  const renderer = {
    autoClear: true,
    capabilities: { maxSamples: 8 },
    getDrawingBufferSize: size => size.set(1280, 720),
    getRenderTarget: () => renderTarget,
    setRenderTarget: target => { renderTarget = target; },
    getClearColor: target => target.copy(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor(color, alpha = clearAlpha) { clearColor.set(color); clearAlpha = alpha; },
    render(scene) {
      const materials = [];
      scene.traverse(object => { if (object.material) materials.push(object.material); });
      draws.push({ scene, materials, target: renderTarget });
    },
  };
  const world = new THREE.Scene();
  const root = new THREE.Group();
  for (const name of ["IcedCoffee_liquid", "IcedCoffee_ice_01", "IcedCoffee_glass"]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5), new THREE.MeshBasicMaterial());
    mesh.name = name;
    mesh.position.set(5.55, 5.1, 3.25);
    root.add(mesh);
  }
  world.add(root);
  const camera = new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 70);
  camera.position.set(0, 6, 24);
  camera.lookAt(0, 6, 0);
  camera.updateMatrixWorld();
  const coffee = createIcedCoffee(renderer, world);
  coffee.attach(root);
  coffee.resize();
  return { coffee, renderer, camera, draws, previousTarget, root };
}

test("binds one cached AO mask to existing presentation and glass passes without a color-copy pass", () => {
  const { coffee, renderer, camera, draws, previousTarget } = setup();
  const mask = { texture: new THREE.Texture(), intensity: 0.55 };
  let aoSource;
  try {
    coffee.render(camera, source => { aoSource = source; return mask; });
    assert.equal(draws.length, 6);
    const [background, liquid, ice, merge, present, glass] = draws;
    assert.equal(background.target.samples, 4);
    assert.equal(liquid.target.samples, 2);
    assert.equal(ice.target.samples, 2);
    assert.equal(aoSource, merge.target);
    assert.ok(aoSource.depthTexture.isDepthTexture);
    assert.equal(present.target, previousTarget);
    assert.equal(glass.target, previousTarget);
    for (const output of [present, glass]) {
      const uniforms = output.materials[0].uniforms;
      assert.equal(uniforms.uColor.value, aoSource.texture);
      assert.equal(uniforms.uDepth.value, aoSource.depthTexture);
      assert.equal(uniforms.uAO.value, mask.texture);
      assert.equal(uniforms.uAOIntensity.value, 0.55);
    }
    assert.equal(present.materials[0].uniforms.uAO, glass.materials[0].uniforms.uAO);
    assert.equal(renderer.getRenderTarget(), previousTarget);
    assert.equal(renderer.autoClear, true);
  } finally {
    coffee.dispose();
  }
});

test("uses a complete white AO sampler without a processor and clears a previous mask binding", () => {
  const { coffee, camera, draws } = setup();
  try {
    coffee.render(camera, () => ({ texture: new THREE.Texture(), intensity: 0.55 }));
    coffee.render(camera);
    assert.equal(draws.length, 12);
    const present = draws.at(-2).materials[0].uniforms;
    const glass = draws.at(-1).materials[0].uniforms;
    assert.ok(present.uAO.value.isDataTexture);
    assert.deepEqual([...present.uAO.value.image.data], [255, 255, 255, 255]);
    assert.equal(present.uAOIntensity.value, 0);
    assert.equal(glass.uAO.value, present.uAO.value);
    assert.equal(glass.uAOIntensity.value, 0);
  } finally {
    coffee.dispose();
  }
});

test("restores world visibility, target and clear state if AO update fails", () => {
  const { coffee, renderer, camera, previousTarget, root } = setup();
  try {
    assert.throws(() => coffee.render(camera, () => { throw new Error("interrupted mask"); }), /interrupted mask/);
    assert.equal(renderer.getRenderTarget(), previousTarget);
    assert.equal(renderer.autoClear, true);
    assert.equal(renderer.getClearAlpha(), 0.8);
    assert.deepEqual(renderer.getClearColor(new THREE.Color()).toArray(), [0.25, 0.5, 0.75]);
    assert.ok(root.children.every(object => object.visible));
  } finally {
    coffee.dispose();
  }
});

test("disposes all compositor targets, the white fallback and its materials", () => {
  const { coffee, camera, draws } = setup();
  coffee.render(camera);
  const targets = new Set(draws.map(draw => draw.target).filter(target => target.isWebGLRenderTarget));
  const materials = new Set(draws.slice(1).flatMap(draw => draw.materials));
  const whiteAO = draws.at(-1).materials[0].uniforms.uAO.value;
  let targetDisposals = 0, materialDisposals = 0, whiteDisposals = 0;
  for (const target of targets) target.addEventListener("dispose", () => targetDisposals++);
  for (const material of materials) material.addEventListener("dispose", () => materialDisposals++);
  whiteAO.addEventListener("dispose", () => whiteDisposals++);
  coffee.dispose();
  assert.equal(targetDisposals, 4);
  assert.equal(materialDisposals, 5);
  assert.equal(whiteDisposals, 1);
});
