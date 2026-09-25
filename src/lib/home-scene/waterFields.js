import * as THREE from "three";

// Numeric simulation fields, generated locally. No borrowed artwork or textures.
// Compact directional wave packets are accumulated into a tileable height grid;
// its derivatives drive the per-pixel normals at several spatial resolutions.
export function createWaterFields(size = 192) {
  let seed = 713;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const particles = Array.from({ length: 34 }, () => {
    const angle = random() * Math.PI * 2;
    return {
      x: random(),
      y: random(),
      dx: Math.cos(angle),
      dy: Math.sin(angle),
      radius: 0.14 + random() * 0.18,
      wavelength: 0.09 + random() * 0.08,
      phase: random() * Math.PI * 2,
      amplitude: 0.3 + random() * 0.4,
    };
  });
  const heights = new Float32Array(size * size);
  let maxHeight = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let height = 0;
      for (const p of particles) {
        let dx = x / size - p.x,
          dy = y / size - p.y;
        dx -= Math.round(dx);
        dy -= Math.round(dy);
        const distance = Math.hypot(dx, dy);
        if (distance > p.radius) continue;
        const envelope = (1 + Math.cos((Math.PI * distance) / p.radius)) * 0.5;
        height +=
          p.amplitude *
          envelope *
          envelope *
          Math.cos(
            ((dx * p.dx + dy * p.dy) * Math.PI * 2) / p.wavelength + p.phase,
          );
      }
      heights[y * size + x] = height;
      maxHeight = Math.max(maxHeight, Math.abs(height));
    }
  const bytes = new Uint8Array(size * size * 4);
  const sample = (x, y) =>
    heights[((y + size) % size) * size + ((x + size) % size)] / maxHeight;
  const encode = (v) =>
    Math.round(THREE.MathUtils.clamp(v * 0.5 + 0.5, 0, 1) * 255);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      bytes[i] = encode(sample(x, y));
      bytes[i + 1] = encode(
        ((sample(x + 1, y) - sample(x - 1, y)) * size) / 2 / 12,
      );
      bytes[i + 2] = encode(
        ((sample(x, y + 1) - sample(x, y - 1)) * size) / 2 / 12,
      );
      bytes[i + 3] = 255;
    }
  const waves = new THREE.DataTexture(bytes, size, size);
  waves.wrapS = waves.wrapT = THREE.RepeatWrapping;
  waves.minFilter = waves.magFilter = THREE.LinearFilter;
  waves.needsUpdate = true;
  const flowSize = 64,
    flowBytes = new Uint8Array(flowSize * flowSize * 4);
  for (let y = 0; y < flowSize; y++)
    for (let x = 0; x < flowSize; x++) {
      const u = (x + 0.5) / flowSize,
        v = (y + 0.5) / flowSize,
        i = (y * flowSize + x) * 4;
      // A divergence-free recirculation field tangent to the rectangular boundary.
      flowBytes[i] = encode(Math.sin(Math.PI * u) * Math.cos(Math.PI * v));
      flowBytes[i + 1] = encode(-Math.cos(Math.PI * u) * Math.sin(Math.PI * v));
      flowBytes[i + 2] = Math.round(
        (Math.sin(u * 7 + v * 9) * 0.5 + 0.5) * 255,
      );
      flowBytes[i + 3] = 255;
    }
  const flow = new THREE.DataTexture(flowBytes, flowSize, flowSize);
  flow.minFilter = flow.magFilter = THREE.LinearFilter;
  flow.needsUpdate = true;
  const lutBytes = new Uint8Array(128 * 4);
  for (let i = 0; i < 128; i++) {
    const depth = (i / 127) * 6;
    [0.48, 0.15, 0.095].forEach(
      (absorption, c) =>
        (lutBytes[i * 4 + c] = Math.round(Math.exp(-depth * absorption) * 255)),
    );
    lutBytes[i * 4 + 3] = 255;
  }
  const absorption = new THREE.DataTexture(lutBytes, 128, 1);
  absorption.minFilter = absorption.magFilter = THREE.LinearFilter;
  absorption.needsUpdate = true;
  return {
    waves,
    flow,
    absorption,
    dispose() {
      waves.dispose();
      flow.dispose();
      absorption.dispose();
    },
  };
}
