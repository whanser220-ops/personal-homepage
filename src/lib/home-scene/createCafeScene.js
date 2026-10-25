import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createInsetWater } from "./createInsetWater.js";
import { createIcedCoffee } from "./createIcedCoffee.js";
import { createCafeAO } from "./createCafeAO.js";
import { createFrameClock, scenePixelRatio } from "./renderBudget.js";
import { observeNavigationActivity } from "./navigationActivity.js";

// A restrained illustrated palette: world-space light creates the same diagonal
// afternoon sun across every surface, with real shadow maps for local occlusion.
export function illustratedMaterial(source, character) {
  const surface = source.name.includes("Whitewashed")
    ? "cabinet"
    : source.name.includes("Paper drawings")
      ? "paper"
      : source.name.includes("Painted brick")
        ? "wall"
        : "other";
  const woven = source.name.includes("Music woven grille");
  const material = new THREE.MeshStandardMaterial({
    map: source.map,
    color: source.color,
    side: THREE.DoubleSide,
    alphaTest: character ? 0.04 : 0,
    transparent: false,
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: 0.35,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "varying vec3 vCafePosition;\nvarying vec3 vCafeNormal;\n" +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
      vCafePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vCafeNormal = normalize(mat3(modelMatrix) * objectNormal);`,
    );
    shader.fragmentShader =
      "varying vec3 vCafePosition;\nvarying vec3 vCafeNormal;\n" +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <shadowmap_pars_fragment>",
      "#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
      float daylight = smoothstep(-0.12, 0.22, vCafePosition.x - 1.18 * vCafePosition.y + 9.8);
      float contact = mix(0.62, 1.0, getShadowMask());
      float form = 0.85 + 0.15 * max(dot(normalize(vCafeNormal), normalize(vec3(4.0,6.0,9.0))), 0.0);
      vec3 shade = ${character ? "vec3(0.62, 0.69, 0.79)" : surface === "paper" ? "vec3(.24)" : "vec3(0.12, 0.17, 0.23)"};
      vec3 light = ${character ? "vec3(1.04, 1.04, 1.01)" : surface === "paper" ? "vec3(1.03)" : "vec3(1.02, 1.04, 1.07)"};
      shade = mix(vec3(0.55, 0.67, 0.73), shade, smoothstep(3.45, 3.7, vCafePosition.y));
            vec3 pigment = diffuseColor.rgb;
      ${surface === "cabinet" ? "float luminance = dot(pigment,vec3(.2126,.7152,.0722)); pigment=mix(vec3(luminance)*vec3(.43,.62,.60),pigment*vec3(.55,.78,.88),.3);" : ""}
      ${surface === "wall" ? "pigment *= vec3(.86,.95,1.11);" : ""}
      ${woven ? "float weave=step(.48,fract(vCafePosition.x*95.))*step(.48,fract(vCafePosition.y*95.)); pigment*=.78+.22*weave;" : ""}
      // Keep the painted palette, with a restrained contribution from actual
      // hemisphere light and the room's prefiltered environment illumination.
      vec3 bounce = clamp(reflectedLight.indirectDiffuse / max(diffuseColor.rgb, vec3(.01)), vec3(0.), vec3(2.));
      outgoingLight = pigment * mix(shade, light, daylight) * contact * form * (.94 + .06 * bounce);
      // Very fine pigment variation prevents perfectly digital flat surfaces.
      float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);
      outgoingLight *= 0.985 + grain * 0.03;
      #include <opaque_fragment>`,
    );
  };
  // Material colors and maps are uniforms; unrelated object names must not
  // recompile identical shaders. Three still keys its own map/light defines.
  material.customProgramCacheKey = () =>
    `cafe-v8-${character ? "character" : "room"}-${surface}-${woven ? "woven" : "plain"}`;
  return material;
}

function disposeTree(root) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const mat of [object.material].flat().filter(Boolean)) {
      materials.add(mat);
      Object.values(mat).forEach((value) => {
        if (value?.isTexture) textures.add(value);
      });
    }
  });
  textures.forEach((texture) => {
    texture.source?.data?.close?.();
    texture.dispose();
  });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

function createRoomEnvironment(renderer) {
  const room = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  try {
    return generator.fromScene(room, 0.04);
  } finally {
    room.dispose();
    generator.dispose();
  }
}

export function createCafeScene(host, onPlayerPosition, onReady, options = {}) {
  const startedAt = performance.now();
  host.dataset.sceneState = "initializing";
  let disposed = false,
    failed = false,
    frame = 0,
    loaded = false,
    visible = true,
    contextLost = false,
    navigationActive = false,
    presented = options.initiallyPresented ?? true,
    needsRender = true;
  let renderer, scene, environment, ao, tank, coffee, sun, root;
  let modelManager, sizeObserver, intersection, stopObservingNavigation;
  let detachListeners = () => {};
  function cleanup() {
    if (disposed) return;
    disposed = true;
    stopObservingNavigation?.();
    cancelAnimationFrame(frame);
    frame = 0;
    modelManager?.abort?.();
    sizeObserver?.disconnect();
    intersection?.disconnect();
    detachListeners();
    for (const key of ["ready", "sceneFrames", "sceneCaptures", "sceneAOUpdates", "scenePixelRatio", "sceneNavigationPaused", "scenePresentationPaused", "sceneState", "sceneModelMs", "sceneFirstFrameMs"]) delete host.dataset[key];
    tank?.dispose();
    coffee?.dispose();
    ao?.dispose();
    if (scene) {
      scene.environment = null;
      disposeTree(scene);
    }
    if (root && root.parent !== scene) disposeTree(root);
    environment?.dispose();
    sun?.shadow.dispose();
    renderer?.dispose();
    renderer?.domElement.remove();
    if (failed) host.dataset.sceneState = "error";
  }
  cleanup.setPresented = () => {};
  function fail(error) {
    if (disposed || failed) return;
    failed = true;
    loaded = false;
    cancelAnimationFrame(frame);
    frame = 0;
    delete host.dataset.ready;
    host.dataset.sceneState = "error";
    const reason = error instanceof Error ? error : new Error(String(error));
    // Release after the current render/loader stack unwinds, so its finally
    // blocks can still restore renderer state before resources are disposed.
    queueMicrotask(cleanup);
    onReady?.(false);
    options.onError?.(reason);
    console.error("Cafe scene unavailable.", reason);
  }
  try {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.debug.onShaderError = () => {
    throw new Error("Cafe scene shader compilation failed.");
  };
  // Start I/O before the synchronous environment/effect setup. The homepage
  // also preloads this URL so a cold visit overlaps it with the renderer chunk.
  modelManager = new THREE.LoadingManager();
  // GLTFLoader tolerates failed image decoding by returning a null texture.
  // The manager still reports that failure, so an incomplete room is not ready.
  modelManager.onError = url => fail(new Error(`Cafe scene resource could not be loaded: ${url}`));
  new GLTFLoader(modelManager)
    .loadAsync("/assets/home-scene/afternoon-room.glb")
    .then(onModelLoaded)
    .catch(fail);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#d5bba0");
  environment = createRoomEnvironment(renderer);
  scene.environment = environment.texture;
  const camera = new THREE.OrthographicCamera(-10, 10, 12.71, 0, 0.1, 70);
  const target = new THREE.Vector3(0, 6.355, 0);
  sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(7, 14, 12);
  sun.target.position.set(0, 6, 0);
  sun.castShadow = true;
  const mapSize = window.innerWidth < 700 ? 1024 : 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  Object.assign(sun.shadow.camera, {
    left: -16,
    right: 16,
    top: 12,
    bottom: -12,
    near: 0.5,
    far: 45,
  });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  // Three r186 folds the old PCFSoftShadowMap into PCFShadowMap; radius controls softness.
  sun.shadow.radius = 2.5;
  const sky = new THREE.HemisphereLight(0xe0efff, 0xb7a18b, 0.85);
  scene.add(sun, sun.target, sky);
  ao = createCafeAO(renderer, scene, camera);
  tank = createInsetWater(renderer, scene);
  coffee = createIcedCoffee(renderer, scene);
  const clock = createFrameClock();
  let lastDraw, lastCapture = -Infinity, animationSeconds = 0;
  let frames = 0, captures = 0, lastDiagnostics = -Infinity;
  const dustGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(45 * 3);
  let seed = 91;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 45; i++) {
    positions[i * 3] = random() * 18 - 7;
    positions[i * 3 + 1] = random() * 12;
    positions[i * 3 + 2] = random() * 3 + 1;
  }
  dustGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `varying float vLight; void main(){ vec4 world = modelMatrix * vec4(position,1.); vLight = smoothstep(0.,1.,world.x-1.18*world.y+9.8); gl_Position=projectionMatrix*viewMatrix*world; gl_PointSize=2.; }`,
      fragmentShader: `varying float vLight; void main(){float a=(1.-smoothstep(.1,.5,length(gl_PointCoord-.5)));gl_FragColor=vec4(1.,.89,.65,a*.22*vLight);}`,
    }),
  );
  scene.add(dust);
  function updateDiagnostics() {
    host.dataset.sceneFrames = String(frames);
    host.dataset.sceneCaptures = String(captures);
    host.dataset.sceneAOUpdates = String(ao.maskUpdates);
    host.dataset.scenePixelRatio = renderer.getPixelRatio().toFixed(2);
    host.dataset.sceneNavigationPaused = String(navigationActive);
    host.dataset.scenePresentationPaused = String(!presented);
  }
  function draw(time = 0) {
    frame = 0;
    if (disposed || failed || contextLost || !loaded || !visible || document.hidden) return;
    if ((!presented || navigationActive) && !needsRender) return;
    if (!clock.due(time)) { schedule(); return; }
    try {
    if (renderer.getContext().isContextLost()) { onContextLost(); return; }
    const frameMs = lastDraw === undefined ? 0 : time - lastDraw;
    lastDraw = time;
    if (!reduced.matches) animationSeconds += Math.min(frameMs, 50) / 1000;
    dust.position.y = reduced.matches ? 0 : Math.sin(animationSeconds * 0.08) * 0.22;
    tank.update(reduced.matches ? 0 : animationSeconds);
    coffee.update(animationSeconds, !reduced.matches);
    // Camera and room are fixed. Reuse both water captures between updates;
    // the surface shader and coffee motion still animate at the scene rate.
    const captureInterval = 1000 / (host.clientWidth < 700 ? 6 : 8);
    if (time - lastCapture >= captureInterval) {
      tank.capture(camera);
      lastCapture = time;
      captures++;
    }
    coffee.render(camera, ao.apply);
    if (failed) return;
    if (renderer.getContext().isContextLost()) { onContextLost(); return; }
    needsRender = false;
    frames++;
    // Local diagnostic counters make the render budget observable without
    // adding UI, timers, network telemetry, or per-frame React updates.
    if (time - lastDiagnostics >= 1000) {
      updateDiagnostics();
      lastDiagnostics = time;
    }
    if (host.dataset.ready !== "true") {
      host.dataset.ready = "true";
      host.dataset.sceneState = "ready";
      host.dataset.sceneFirstFrameMs ??= String(Math.round(performance.now() - startedAt));
      onReady?.(true);
    }
    if (!reduced.matches) schedule();
    } catch (error) {
      if (renderer.getContext().isContextLost()) onContextLost();
      else fail(error);
    }
  }
  function schedule() {
    if (!frame && loaded && !disposed && !failed && !contextLost && visible && !document.hidden && ((!navigationActive && presented) || needsRender)) frame = requestAnimationFrame(draw);
  }
  function refresh() {
    needsRender = true;
    clock.reset();
    lastDraw = undefined;
    lastCapture = -Infinity;
    ao.invalidate();
    schedule();
  }
  function setResolution(pixelRatio) {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), false);
    tank.resize();
    coffee.resize();
    ao.resize();
    refresh();
  }
  function resize() {
    const w = Math.max(1, host.clientWidth),
      h = Math.max(1, host.clientHeight),
      aspect = w / h;
    const height = Math.max(aspect > 2.2 ? 28 / aspect : 12.71, aspect < 1 ? 9.5 / aspect : 0);
    camera.left = (-height * aspect) / 2;
    camera.right = (height * aspect) / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    target.x = aspect < 1 ? 1.55 : 0;
    target.y = aspect < 1 ? 5.65 : 6.355;
    camera.position.set(target.x, target.y + 6.5, 24);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // Match the accessible controls to the Blender radio's front face.
    const player = new THREE.Vector3(3.85, 5.10, 3.325).project(camera);
    onPlayerPosition?.({ x: (player.x + 1) * w / 2, y: (1 - player.y) * h / 2, width: 1.9 * h / height });
    setResolution(scenePixelRatio(w, window.devicePixelRatio || 1));
  }
  function onMotion() {
    refresh();
  }
  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else refresh();
  }
  function onContextLost(event) {
    event?.preventDefault?.();
    if (disposed || failed || contextLost) return;
    contextLost = true;
    delete host.dataset.ready;
    host.dataset.sceneState = "context-lost";
    onReady?.(false);
    cancelAnimationFrame(frame);
    frame = 0;
  }
  function onContextRestored() {
    if (disposed || failed) return;
    try {
      // Render-target pixels have no CPU source to re-upload after context loss.
      // Rebuild the environment before replacing the static preview with 3D.
      const restored = createRoomEnvironment(renderer);
      environment.dispose();
      environment = restored;
      scene.environment = environment.texture;
      contextLost = false;
      renderer.shadowMap.needsUpdate = true;
      refresh();
    } catch (error) {
      fail(error);
    }
  }
  sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(host);
  intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) refresh();
    else {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  });
  intersection.observe(host);
  document.addEventListener("visibilitychange", onVisibility);
  reduced.addEventListener("change", onMotion);
  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);
  detachListeners = () => {
    document.removeEventListener("visibilitychange", onVisibility);
    reduced.removeEventListener("change", onMotion);
    renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
    renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
  };
  stopObservingNavigation = observeNavigationActivity(
    document.querySelector('nav[data-collapsible="true"]'),
    active => {
      navigationActive = active;
      updateDiagnostics();
      if (active && !needsRender) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!active) {
        clock.reset();
        lastDraw = undefined;
        schedule();
      }
    },
  );
  cleanup.setPresented = value => {
    if (disposed || failed) return;
    const next = Boolean(value);
    if (presented === next) return;
    presented = next;
    updateDiagnostics();
    if (!next && !needsRender) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else if (next) {
      clock.reset();
      lastDraw = undefined;
      schedule();
    }
  };
  resize();
  host.dataset.sceneState = "loading-model";
  function onModelLoaded(gltf) {
      if (disposed || failed) {
        disposeTree(gltf.scene);
        return;
      }
      root = gltf.scene;
      const replacements = new Map();
      root.traverse((object) => {
        if (!object.isMesh || object.name.startsWith("Tank") || object.name.startsWith("IcedCoffee")) return;
        const character = object.name.includes("Character");
        object.material = [object.material].flat().map((source) => {
          if (!replacements.has(source))
            replacements.set(source, illustratedMaterial(source, character));
          return replacements.get(source);
        });
        if (object.material.length === 1) object.material = object.material[0];
        object.receiveShadow = !character;
        object.castShadow =
          !character &&
          !object.name.includes("wall") &&
          !object.name.includes("counter front");
      });
      replacements.forEach((_, source) => source.dispose());
      tank.attach(root);
      coffee.attach(root);
      scene.add(root);
      renderer.shadowMap.needsUpdate = true;
      loaded = true;
      host.dataset.sceneState = "rendering";
      host.dataset.sceneModelMs = String(Math.round(performance.now() - startedAt));
      schedule();
  }
  return cleanup;
  } catch (error) {
    fail(error);
    cleanup();
    return cleanup;
  }
}
