import * as THREE from "three";
import { createWaterFields } from "./waterFields.js";

export const WATER_LEVEL = 4.43;

// Flow map + two offset phases + multi-resolution wave-particle grids, adapted
// to a small contained basin from the Uncharted water techniques in the references.
const flowWaves = `
  uniform float uTime;
  uniform sampler2D uWaves, uFlow;
  vec3 packetLayer(vec2 uv, vec2 flow, float frequency, float phase, float blendWeight) {
    vec2 a=uv*frequency-flow*phase*.24;
    vec2 b=uv*frequency-flow*fract(phase+.5)*.24;
    vec3 p=mix(texture2D(uWaves,a).rgb,texture2D(uWaves,b).rgb,blendWeight)*2.-1.;
    return vec3(p.r,p.gb*12.*frequency);
  }
  vec3 waveField(vec2 uv) {
    vec3 map=texture2D(uFlow,uv).rgb;
    vec2 flow=(map.rg*2.-1.);
    float phase=fract(uTime*.065+map.b*.13);
    float weight=abs(phase*2.-1.);
    vec3 waves=packetLayer(uv,flow,1.1,phase,weight)*.036;
    waves+=packetLayer(uv+.31,flow,2.7,phase,weight)*.013;
    waves+=packetLayer(uv-.17,flow,6.8,phase,weight)*.003;
    float border=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y));
    return waves*smoothstep(0.,.035,border);
  }
`;

const caustics = `
  float caustic(vec2 uv,float time){
    vec2 p=uv;
    p+=vec2(sin(p.y*2.7+time*.4),cos(p.x*3.1-time*.3))*.15;
    float a=sin(p.x*9.+sin(p.y*7.+time*.5));
    float b=cos(p.y*8.-sin(p.x*6.-time*.4));
    return pow(max(0.,1.-abs(a+b)*.72),12.);
  }
`;

const vertex = `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec4 vMirror;
  uniform mat4 uMirrorMatrix;
  ${flowWaves}
  void main(){
    vUv=uv;
    vec3 p=position;
    p.y+=waveField(uv).x;
    vec4 world=modelMatrix*vec4(p,1.);
    vWorld=world.xyz;
    vMirror=uMirrorMatrix*world;
    gl_Position=projectionMatrix*viewMatrix*world;
  }
`;

function surfaceMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: `
      uniform sampler2D uRefraction,uReflection,uDepth,uAbsorption;
      uniform vec2 uResolution;
      uniform float uNear,uFar;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec4 vMirror;
      ${flowWaves}
      void main(){
        vec3 field=waveField(vUv);
        vec3 normal=normalize(vec3(-field.y/4.9,1.,field.z/3.58));
        vec3 view=normalize(cameraPosition-vWorld);
        vec2 uv=gl_FragCoord.xy/uResolution;
        float surfaceDepth=-(viewMatrix*vec4(vWorld,1.)).z;
        float depth=mix(uNear,uFar,texture2D(uDepth,uv).r);
        float thickness=max(0.,depth-surfaceDepth);
        vec2 refractedUv=clamp(uv+normal.xz*.013*min(thickness,1.5),vec2(.001),vec2(.999));
        // Prevent foreground countertop pixels from bleeding into the refracted water.
        float distortedDepth=mix(uNear,uFar,texture2D(uDepth,refractedUv).r);
        if(distortedDepth<surfaceDepth){refractedUv=uv;distortedDepth=depth;}
        thickness=clamp(distortedDepth-surfaceDepth,0.,6.);
        vec3 transmittance=texture2D(uAbsorption,vec2(thickness/6.,.5)).rgb;
        vec3 under=texture2D(uRefraction,refractedUv).rgb;
        vec3 scatter=vec3(.035,.19,.145);
        vec3 refracted=under*transmittance+scatter*(1.-transmittance);
        vec2 reflectionUv=clamp(vMirror.xy/vMirror.w+normal.xz*.015,vec2(.002),vec2(.998));
        vec3 reflected=texture2D(uReflection,reflectionUv).rgb;
        float fresnel=.02037+.97963*pow(1.-max(dot(normal,view),0.),5.);
        vec3 color=mix(refracted,reflected,clamp(fresnel,.02,.92));
        vec3 light=normalize(vec3(-.08,.4,-1.));
        vec3 halfDirection=normalize(light+view);
        float glint=pow(max(dot(normal,halfDirection),0.),180.);
        color+=vec3(1.,.95,.80)*glint*.26;
        // A narrow, noise-broken meniscus at the porcelain wall; no ocean whitecaps.
        float border=min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y));
        float foam=(1.-smoothstep(.002,.013,border))*smoothstep(.25,.68,texture2D(uWaves,vUv*5.+uTime*.004).r);
        color=mix(color,vec3(.75,.86,.78),foam*.22);
        gl_FragColor=vec4(color,1.);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
  });
}

function windowMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec2 vUv;varying vec3 vWorld;void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: `
      uniform sampler2D uRefraction,uDepth,uAbsorption;
      uniform vec2 uResolution;
      uniform float uNear,uFar,uTime;
      varying vec2 vUv;varying vec3 vWorld;
      void main(){
        vec2 uv=gl_FragCoord.xy/uResolution;
        vec2 offset=vec2(sin(vUv.y*17.+uTime*.35),cos(vUv.x*14.-uTime*.4))*.00065;
        float here=-(viewMatrix*vec4(vWorld,1.)).z;
        float depth=mix(uNear,uFar,texture2D(uDepth,uv+offset).r);
        float thickness=clamp(depth-here,0.,4.);
        vec3 transmittance=texture2D(uAbsorption,vec2(thickness/6.,.5)).rgb;
        vec3 color=texture2D(uRefraction,uv+offset).rgb*transmittance+vec3(.025,.18,.145)*(1.-transmittance);
        float edge=pow(1.-min(vUv.x,1.-vUv.x)*2.,90.);
        float streak=exp(-pow((vUv.x-.07-vUv.y*.022)*160.,2.));
        color+=vec3(.60,.79,.73)*(edge*.13+streak*.055);
        gl_FragColor=vec4(color,1.);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

function basinMaterial(source, sharedTime) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedTime, uColor: { value: source.color.clone() } },
    vertexShader: `varying vec3 vWorld;varying vec3 vNormal;void main(){vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: `uniform float uTime;uniform vec3 uColor;varying vec3 vWorld,vNormal;${caustics}
      void main(){
        float deep=clamp((4.43-vWorld.y)/2.1,0.,1.);
        float light=.57+.24*max(dot(normalize(vNormal),normalize(vec3(-.3,1.,.6))),0.);
        vec3 color=uColor*light*mix(vec3(.84,1.,.96),vec3(.36,.74,.70),deep);
        vec2 p=vWorld.xz*.8+vWorld.y*.13;
        float causticLight=caustic(p,uTime)*caustic(p*.77+.7,-uTime*.8);
        color+=vec3(.15,.34,.25)*causticLight*.9;
        gl_FragColor=vec4(color,1.);
        #include <colorspace_fragment>
      }
    `,
  });
}

export function createInsetWater(renderer, scene) {
  const fields = createWaterFields();
  const refraction = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  refraction.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const reflection = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  refraction.texture.colorSpace = reflection.texture.colorSpace =
    THREE.LinearSRGBColorSpace;
  const resolution = new THREE.Vector2();
  const mirrorMatrix = new THREE.Matrix4();
  const time = { value: 0 };
  const uniforms = {
    uTime: time,
    uWaves: { value: fields.waves },
    uFlow: { value: fields.flow },
    uAbsorption: { value: fields.absorption },
    uRefraction: { value: refraction.texture },
    uReflection: { value: reflection.texture },
    uDepth: { value: refraction.depthTexture },
    uResolution: { value: resolution },
    uMirrorMatrix: { value: mirrorMatrix },
    uNear: { value: 0.1 },
    uFar: { value: 70 },
  };
  const refractors = [],
    interior = [];
  const mirrorCamera = new THREE.OrthographicCamera();
  const plane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    -WATER_LEVEL + 0.025,
  );
  const direction = new THREE.Vector3(),
    lookAt = new THREE.Vector3();
  const bias = new THREE.Matrix4().set(
    0.5,
    0,
    0,
    0.5,
    0,
    0.5,
    0,
    0.5,
    0,
    0,
    0.5,
    0.5,
    0,
    0,
    0,
    1,
  );
  let ready = false;
  function attach(root) {
    const old = new Set();
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.name.startsWith("Tank")) return;
      old.add(obj.material);
      if (obj.name.includes("water_surface")) {
        obj.material = surfaceMaterial(uniforms);
        obj.renderOrder = 3;
        refractors.push(obj);
      } else if (obj.name.includes("front_glass")) {
        obj.material = windowMaterial(uniforms);
        obj.renderOrder = 4;
        refractors.push(obj);
      } else {
        obj.material = basinMaterial(obj.material, time);
        interior.push(obj);
      }
      obj.castShadow = false;
      obj.receiveShadow = false;
    });
    old.forEach((m) => m.dispose());
    ready = true;
  }
  function resize() {
    renderer.getDrawingBufferSize(resolution);
    const scale = window.innerWidth < 700 ? 0.65 : 0.8;
    const w = Math.max(1, Math.round(resolution.x * scale)),
      h = Math.max(1, Math.round(resolution.y * scale));
    refraction.setSize(w, h);
    reflection.setSize(w, h);
  }
  function capture(camera) {
    if (!ready) return;
    uniforms.uNear.value = camera.near;
    uniforms.uFar.value = camera.far;
    camera.updateMatrixWorld();
    const previousTarget = renderer.getRenderTarget(),
      previousClips = renderer.clippingPlanes;
    try {
      refractors.forEach((o) => (o.visible = false));
      renderer.setRenderTarget(refraction);
      renderer.render(scene, camera);
      camera.getWorldDirection(direction);
      lookAt.copy(camera.position).add(direction);
      lookAt.y = 2 * WATER_LEVEL - lookAt.y;
      mirrorCamera.copy(camera, false);
      mirrorCamera.position.y = 2 * WATER_LEVEL - camera.position.y;
      mirrorCamera.up.copy(camera.up);
      mirrorCamera.up.y *= -1;
      mirrorCamera.lookAt(lookAt);
      mirrorCamera.updateMatrixWorld();
      mirrorMatrix
        .copy(bias)
        .multiply(mirrorCamera.projectionMatrix)
        .multiply(mirrorCamera.matrixWorldInverse);
      interior.forEach((o) => (o.visible = false));
      renderer.clippingPlanes = [plane];
      renderer.setRenderTarget(reflection);
      renderer.render(scene, mirrorCamera);
    } finally {
      renderer.clippingPlanes = previousClips;
      renderer.setRenderTarget(previousTarget);
      interior.forEach((o) => (o.visible = true));
      refractors.forEach((o) => (o.visible = true));
    }
  }
  return {
    attach,
    resize,
    capture,
    update(seconds) {
      time.value = seconds;
    },
    dispose() {
      refraction.dispose();
      reflection.dispose();
      fields.dispose();
    },
  };
}
