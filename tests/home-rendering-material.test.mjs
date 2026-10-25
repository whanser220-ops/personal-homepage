import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { illustratedMaterial } from "../src/lib/home-scene/createCafeScene.js";

function material(name, color = 0xffffff, character = false) {
  const source = new THREE.MeshStandardMaterial({ color });
  source.name = name;
  const result = illustratedMaterial(source, character);
  source.dispose();
  return result;
}

function shaders(value) {
  const shader = {
    vertexShader: "#include <worldpos_vertex>",
    fragmentShader: "#include <shadowmap_pars_fragment>\n#include <opaque_fragment>",
  };
  value.onBeforeCompile(shader);
  return shader;
}

test("differently named room materials share a program when their shaders match", () => {
  const first = material("Ivory pottery", 0xeee0b0);
  const second = material("Ivy stems", 0x365341);
  try {
    assert.deepEqual(shaders(first), shaders(second));
    assert.equal(first.customProgramCacheKey(), second.customProgramCacheKey());
    assert.notEqual(first.color.getHex(), second.color.getHex());
  } finally {
    first.dispose();
    second.dispose();
  }
});

test("character, pigment surfaces, and woven grille retain distinct shader programs", () => {
  const variants = [
    material("Ivory pottery"),
    material("Music woven grille"),
    material("Whitewashed wood"),
    material("Paper drawings"),
    material("Painted brick"),
    material("Character illustration", 0xffffff, true),
  ];
  try {
    assert.equal(new Set(variants.map(value => value.customProgramCacheKey())).size, variants.length);
    assert.equal(new Set(variants.map(value => JSON.stringify(shaders(value)))).size, variants.length);
    assert.match(shaders(variants[1]).fragmentShader, /float weave=/);
    assert.equal(variants[5].alphaTest, 0.04);
    assert.ok(variants.every(value => value.side === THREE.DoubleSide));
  } finally {
    variants.forEach(value => value.dispose());
  }
});

test("character materials cannot reuse a program with different pigment branches", () => {
  const variants = ["Character illustration", "Whitewashed wood", "Painted brick"]
    .map(name => material(name, 0xffffff, true));
  try {
    assert.equal(new Set(variants.map(value => value.customProgramCacheKey())).size, 3);
    assert.equal(new Set(variants.map(value => JSON.stringify(shaders(value)))).size, 3);
  } finally {
    variants.forEach(value => value.dispose());
  }
});
