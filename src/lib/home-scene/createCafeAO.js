import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";

// Reuse the drink compositor's actual depth: cutout illustrations retain their
// silhouettes, and transparent glass never becomes an opaque AO occluder.
export function createCafeAO(renderer, scene, camera) {
  // r186's external-GBuffer path expects the internal target to exist first.
  const pass = new GTAOPass(scene, camera, 1, 1);
  const size = new THREE.Vector2();
  let invalid = true;
  let maskUpdates = 0;
  let lastMaskTime = -Infinity;
  const projection = new THREE.Matrix4();
  const cameraWorld = new THREE.Matrix4();
  // r186 exposes its denoised mask as gtaoMap. Off skips only the output
  // copy/blend, leaving the AO and denoise passes available when invalidated.
  pass.output = GTAOPass.OUTPUT.Off;
  pass.blendIntensity = 0.55;
  // The existing presentation and glass shaders apply this cached mask. Keep
  // scene color in the compositor instead of copying it to another full-size RT.
  const mask = { texture: pass.gtaoMap, intensity: pass.blendIntensity };
  pass.updateGtaoMaterial({
    radius: 0.32,
    thickness: 0.18,
    distanceExponent: 1,
    distanceFallOff: 1,
    scale: 1,
    screenSpaceRadius: false,
  });
  pass.updatePdMaterial({ radius: 4, samples: 8, depthPhi: 2, normalPhi: 3 });

  return {
    get maskUpdates() { return maskUpdates; },
    resize() {
      renderer.getDrawingBufferSize(size);
      const mobile = renderer.domElement.clientWidth < 700;
      const scale = mobile ? 0.5 : 0.75;
      pass.setSize(Math.max(1, Math.round(size.x * scale)), Math.max(1, Math.round(size.y * scale)));
      pass.updateGtaoMaterial({ samples: mobile ? 8 : 12 });
      invalid = true;
    },
    invalidate() {
      invalid = true;
    },
    apply(source) {
      const now = performance.now();
      const previous = renderer.getRenderTarget();
      const previousAutoClear = renderer.autoClear;
      try {
        if (pass.depthTexture !== source.depthTexture) {
          pass.setGBuffer(source.depthTexture);
          invalid = true;
        }
        // The room and camera are static, but the composited depth also contains
        // gently moving ice/liquid. Refresh at 4 Hz to avoid stale cup contours.
        if (now - lastMaskTime >= 250 || !projection.equals(camera.projectionMatrix) || !cameraWorld.equals(camera.matrixWorld)) invalid = true;
        if (invalid) {
          const clearColor = renderer.getClearColor(new THREE.Color());
          const clearAlpha = renderer.getClearAlpha();
          try {
            pass.render(renderer, null, source);
          } finally {
            renderer.setClearColor(clearColor, clearAlpha);
          }
          maskUpdates++;
          projection.copy(camera.projectionMatrix);
          cameraWorld.copy(camera.matrixWorld);
          lastMaskTime = now;
          invalid = false;
        }
        return mask;
      } finally {
        renderer.autoClear = previousAutoClear;
        renderer.setRenderTarget(previous);
      }
    },
    dispose() {
      pass.dispose();
      // These two materials are not released by GTAOPass.dispose() in r186.
      pass.gtaoMaterial.dispose();
      pass.blendMaterial.dispose();
    },
  };
}
