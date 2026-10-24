import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

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
  let invalid = true;
  let maskUpdates = 0;
  let lastMaskTime = -Infinity;
  const projection = new THREE.Matrix4();
  const cameraWorld = new THREE.Matrix4();
  // r186 exposes its denoised mask as gtaoMap. Off skips only the output
  // copy/blend, leaving the AO and denoise passes available when invalidated.
  pass.output = GTAOPass.OUTPUT.Off;
  pass.blendIntensity = 0.55;
  const blendMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: null },
      uAO: { value: pass.gtaoMap },
      uIntensity: { value: pass.blendIntensity },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0., 1.);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D uColor, uAO;
      uniform float uIntensity;
      void main() {
        vec4 color = texture2D(uColor, vUv);
        vec4 ao = texture2D(uAO, vUv);
        gl_FragColor = vec4(color.rgb * mix(vec3(1.), ao.rgb, uIntensity), color.a * ao.a);
      }
    `,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const blendQuad = new FullScreenQuad(blendMaterial);
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
      output.setSize(size.x, size.y);
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
          pass.render(renderer, output, source);
          maskUpdates++;
          projection.copy(camera.projectionMatrix);
          cameraWorld.copy(camera.matrixWorld);
          lastMaskTime = now;
          invalid = false;
        }
        // Cache only occlusion. The current coffee, ice and water colors must
        // still reach the compositor on every presented animation frame.
        blendMaterial.uniforms.uColor.value = source.texture;
        renderer.autoClear = false;
        renderer.setRenderTarget(output);
        blendQuad.render(renderer);
        return output.texture;
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
      blendMaterial.dispose();
      blendQuad.dispose();
      output.dispose();
    },
  };
}
