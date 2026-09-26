import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";

// Reuse the drink compositor's actual depth: cutout illustrations retain their
// silhouettes, and transparent glass never becomes an opaque AO occluder.
export function createCafeAO(renderer, scene, camera) {
  // r186's external-GBuffer path expects the internal target to exist first.
  const pass = new GTAOPass(scene, camera, 1, 1);
  const output = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
  output.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const size = new THREE.Vector2();
  pass.blendIntensity = 0.55;
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
    resize() {
      renderer.getDrawingBufferSize(size);
      const mobile = renderer.domElement.clientWidth < 700;
      const scale = mobile ? 0.5 : 0.75;
      output.setSize(size.x, size.y);
      pass.setSize(Math.max(1, Math.round(size.x * scale)), Math.max(1, Math.round(size.y * scale)));
      pass.updateGtaoMaterial({ samples: mobile ? 8 : 12 });
    },
    apply(source) {
      const previous = renderer.getRenderTarget();
      try {
        if (pass.depthTexture !== source.depthTexture) pass.setGBuffer(source.depthTexture);
        pass.render(renderer, output, source);
        return output.texture;
      } finally {
        renderer.setRenderTarget(previous);
      }
    },
    dispose() {
      pass.dispose();
      // These two materials are not released by GTAOPass.dispose() in r186.
      pass.gtaoMaterial.dispose();
      pass.blendMaterial.dispose();
      output.dispose();
    },
  };
}
