import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createInsetWater } from "./createInsetWater.js";
import { createIcedCoffee } from "./createIcedCoffee.js";

// A restrained illustrated palette: world-space light creates the same diagonal
// afternoon sun across every surface, with real shadow maps for local occlusion.
function illustratedMaterial(source, character) {
  const surface = source.name.includes("Whitewashed")
    ? "cabinet"
    : source.name.includes("Paper drawings")
      ? "paper"
      : source.name.includes("Painted brick")
        ? "wall"
        : "other";
  const material = new THREE.MeshLambertMaterial({
    map: source.map,
    color: source.color,
    side: THREE.DoubleSide,
    alphaTest: character ? 0.04 : 0,
    transparent: false,
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
      ${source.name.includes("Music woven grille") ? "float weave=step(.48,fract(vCafePosition.x*95.))*step(.48,fract(vCafePosition.y*95.)); pigment*=.78+.22*weave;" : ""}
      outgoingLight = pigment * mix(shade, light, daylight) * contact * form;
      // Very fine pigment variation prevents perfectly digital flat surfaces.
      float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);
      outgoingLight *= 0.985 + grain * 0.03;
      #include <opaque_fragment>`,
    );
  };
  material.customProgramCacheKey = () =>
    character ? "cafe-character-v6" : "cafe-environment-v6-" + surface + source.name;
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

export function createCafeScene(host, onPlayerPosition, onReady) {
  let disposed = false,
    frame = 0,
    loaded = false,
    visible = true;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#d5bba0");
  const camera = new THREE.OrthographicCamera(-10, 10, 12.71, 0, 0.1, 70);
  const target = new THREE.Vector3(0, 6.355, 0);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
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
  scene.add(sun, sun.target, new THREE.AmbientLight(0xffffff, 1));
  const tank = createInsetWater(renderer, scene);
  const coffee = createIcedCoffee(renderer, scene);
  let root;
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
  function draw(time = 0) {
    frame = 0;
    if (disposed || !loaded || !visible || document.hidden) return;
    if (!reduced.matches) dust.position.y = Math.sin(time * 0.00008) * 0.22;
    tank.update(reduced.matches ? 0 : time * 0.001);
    coffee.update(time * .001, !reduced.matches);
    tank.capture(camera);
    coffee.render(camera);
    if (host.dataset.ready !== "true") { host.dataset.ready = "true"; onReady?.(); }
    if (!reduced.matches) frame = requestAnimationFrame(draw);
  }
  function schedule() {
    if (!frame && loaded && !disposed) frame = requestAnimationFrame(draw);
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
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, w < 700 ? 1.4 : 1.75),
    );
    renderer.setSize(w, h, false);
    tank.resize();
    coffee.resize();
    schedule();
  }
  function onMotion() {
    dust.position.y = 0;
    schedule();
  }
  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else schedule();
  }
  function onContextLost(event) {
    event.preventDefault();
    delete host.dataset.ready;
    cancelAnimationFrame(frame);
    frame = 0;
  }
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(host);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) schedule();
    else {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  });
  intersection.observe(host);
  document.addEventListener("visibilitychange", onVisibility);
  reduced.addEventListener("change", onMotion);
  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  resize();
  new GLTFLoader()
    .loadAsync("/assets/home-scene/afternoon-room.glb")
    .then((gltf) => {
      if (disposed) {
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
      schedule();
    })
    .catch((error) => {
      if (!disposed)
        console.error("Cafe scene unavailable.", error);
    });
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    delete host.dataset.ready;
    sizeObserver.disconnect();
    intersection.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    reduced.removeEventListener("change", onMotion);
    renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
    tank.dispose();
    coffee.dispose();
    disposeTree(scene);
    sun.shadow.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
