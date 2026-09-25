import * as THREE from "three";

const geometryVertex = `
  varying vec3 vWorld, vNormal, vViewNormal;
  void main(){
    vec4 w=modelMatrix*vec4(position,1.);
    vWorld=w.xyz;
    vNormal=normalize(mat3(modelMatrix)*normal);
    vViewNormal=normalize(normalMatrix*normal);
    gl_Position=projectionMatrix*viewMatrix*w;
  }
`;
const quadVertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const liquidMotion = `
  uniform float uTime,uMotion;
  float surfaceOffset(vec2 p){
    float tiltX=.095*sin(uTime*1.65)+.025*sin(uTime*2.7);
    float tiltZ=.065*cos(uTime*1.37);
    float ripple=.026*sin(length(p)*9.-uTime*2.3)*(1.-smoothstep(.35,.58,length(p)));
    return uMotion*(p.x*tiltX+p.y*tiltZ+ripple);
  }
`;
const liquidVertex = `
  varying vec3 vWorld,vNormal,vViewNormal;
  ${liquidMotion}
  void main(){
    vec4 w=modelMatrix*vec4(position,1.);
    vec2 p=w.xz-vec2(5.55,3.25);
    float weight=smoothstep(.15,1.37,w.y-4.56);
    w.y+=surfaceOffset(p)*weight;
    vec2 slope=vec2(surfaceOffset(p+vec2(.003,0.))-surfaceOffset(p-vec2(.003,0.)),surfaceOffset(p+vec2(0.,.003))-surfaceOffset(p-vec2(0.,.003)))/.006;
    vec3 n=normalize(mat3(modelMatrix)*normal);
    n=normalize(vec3(n.x-slope.x*n.y,n.y,n.z-slope.y*n.y));
    vWorld=w.xyz;vNormal=n;vViewNormal=normalize(mat3(viewMatrix)*n);
    gl_Position=projectionMatrix*viewMatrix*w;
  }
`;

function target(depth = true) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: depth });
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  if (depth) rt.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  return rt;
}

// Background, liquid and ice keep independent depths until the final composite.
// Only the cup's projected rectangle is rasterized for the two material layers.
export function createIcedCoffee(renderer, world) {
  const background = target(), liquidBuffer = target(), iceBuffer = target(), composite = target();
  // Preserve the renderer's antialiasing when the room moves offscreen.
  background.samples = Math.min(4, renderer.capabilities.maxSamples);
  liquidBuffer.samples = iceBuffer.samples = Math.min(2, renderer.capabilities.maxSamples);
  const liquidScene = new THREE.Scene(), iceScene = new THREE.Scene(), glassScene = new THREE.Scene();
  const passScene = new THREE.Scene(), passCamera = new THREE.Camera();
  const layerCamera = new THREE.OrthographicCamera();
  const size = new THREE.Vector2(), rect = new THREE.Vector4();
  const originals = [], clones = [], materials = new Set();
  const bounds = new THREE.Box3(), point = new THREE.Vector3();
  const motionUniforms = { uTime: { value: 0 }, uMotion: { value: 1 } };
  const floatingIce = [];
  const rotation = new THREE.Quaternion(), euler = new THREE.Euler(), position = new THREE.Vector3();
  let previousSeconds;
  let ready = false;

  const liquidMaterial = new THREE.ShaderMaterial({
    uniforms: motionUniforms,
    vertexShader: liquidVertex,
    fragmentShader: `
      varying vec3 vWorld,vNormal,vViewNormal;
      ${liquidMotion}
      void main(){
        float h=vWorld.y-4.56;
        vec2 p=vWorld.xz-vec2(5.55,3.25);
        float boundary=.70+.027*sin(p.x*13.)+.017*cos(p.y*17.);
        boundary+=surfaceOffset(p)*.65+uMotion*.045*sin(p.x*7.+p.y*4.-uTime*1.5);
        float coffee=smoothstep(boundary-.08,boundary+.10,h);
        vec3 milk=vec3(.94,.94,.88);
        vec3 amber=mix(vec3(.57,.29,.07),vec3(.82,.51,.14),smoothstep(.75,1.42,h));
        vec3 color=mix(milk,amber,coffee);
        vec3 normal=normalize(vNormal);
        float light=.78+.22*max(dot(normal,normalize(vec3(-.4,1.,.8))),0.);
        float top=smoothstep(.60,.95,normal.y);
        color*=light;
        color=mix(color,vec3(.77,.47,.17),top*.45);
        vec3 view=normalize(cameraPosition-vWorld);
        float shimmer=pow(max(dot(normal,normalize(view+normalize(vec3(-.4,1.,.8)))),0.),48.);
        color+=vec3(.28,.24,.13)*shimmer*top;
        float cream=exp(-pow((h-boundary)/.045,2.));
        color+=vec3(.07,.055,.028)*cream;
        gl_FragColor=vec4(color,mix(.96,.68,coffee));
      }
    `,
    blending: THREE.NoBlending,
  });
  const iceMaterial = new THREE.ShaderMaterial({
    vertexShader: geometryVertex,
    fragmentShader: `
      varying vec3 vWorld,vNormal,vViewNormal;
      void main(){
        vec3 n=normalize(vNormal),v=normalize(cameraPosition-vWorld);
        float rim=pow(1.-abs(dot(n,v)),3.);
        float shine=pow(max(dot(reflect(-normalize(vec3(-.5,1.,1.)),n),v),0.),24.);
        float facet=clamp(.55+.22*max(n.y,0.)+.24*rim,.55,.96);
        // Two normal channels, highlight, opacity: no lossy integer bit-packing.
        gl_FragColor=vec4(normalize(vViewNormal).xy*.5+.5,clamp(shine*.85+rim*.24,0.,1.),facet);
      }
    `,
    blending: THREE.NoBlending,
  });

  const uniforms = {
    uBackground: { value: background.texture }, uBackgroundDepth: { value: background.depthTexture },
    uLiquid: { value: liquidBuffer.texture }, uLiquidDepth: { value: liquidBuffer.depthTexture },
    uIce: { value: iceBuffer.texture }, uIceDepth: { value: iceBuffer.depthTexture },
    uRect: { value: rect }, uDepthRange: { value: 69.9 },
  };
  const mergeMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: quadVertex,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D uBackground,uBackgroundDepth,uLiquid,uLiquidDepth,uIce,uIceDepth;
      uniform vec4 uRect;
      uniform float uDepthRange;
      void farFirst(inout vec4 a,inout float za,inout vec4 b,inout float zb){
        if(za<zb){vec4 c=a;a=b;b=c;float z=za;za=zb;zb=z;}
      }
      void main(){
        vec4 bg=texture2D(uBackground,vUv);bg.a=1.;
        float zb=texture2D(uBackgroundDepth,vUv).r;
        vec2 uv=(vUv-uRect.xy)/uRect.zw;
        if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))){
          gl_FragColor=bg;gl_FragDepth=zb;return;
        }
        float zl=texture2D(uLiquidDepth,uv).r,zi=texture2D(uIceDepth,uv).r;
        vec4 liquid=texture2D(uLiquid,uv),ice=texture2D(uIce,uv);
        if(zl>=.99999)liquid.a=0.;
        if(zi>=.99999)ice.a=0.;
        vec2 offset=(ice.rg*2.-1.)*.032*step(zi,.99999);
        vec2 bentUv=clamp(vUv+offset*uRect.zw,vec2(.001),vec2(.999));
        // Distort color only. Original depths remain authoritative for sorting.
        if(zb>zi && texture2D(uBackgroundDepth,bentUv).r>zi)bg.rgb=texture2D(uBackground,bentUv).rgb;
        if(zl>zi && texture2D(uLiquidDepth,clamp(uv+offset,0.,1.)).r<.99999)
          liquid.rgb=texture2D(uLiquid,clamp(uv+offset,0.,1.)).rgb;
        float contact=1.-smoothstep(.008,.055,abs(zi-zl)*uDepthRange);
        liquid.rgb+=vec3(.24,.20,.11)*contact*step(zi,.99999);
        ice.rgb=vec3(.64,.85,.89)+ice.b*vec3(.6,.58,.50);
        float nearest=min(zb,min(zl,zi));
        farFirst(bg,zb,liquid,zl);farFirst(liquid,zl,ice,zi);farFirst(bg,zb,liquid,zl);
        vec3 color=mix(vec3(0.),bg.rgb,bg.a);
        color=mix(color,liquid.rgb,liquid.a);color=mix(color,ice.rgb,ice.a);
        gl_FragColor=vec4(color,1.);gl_FragDepth=nearest;
      }
    `,
    depthFunc: THREE.AlwaysDepth,
  });
  const presentMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: composite.texture }, uDepth: { value: composite.depthTexture } },
    vertexShader: quadVertex,
    fragmentShader: `
      varying vec2 vUv;uniform sampler2D uColor,uDepth;
      void main(){
        gl_FragColor=texture2D(uColor,vUv);gl_FragDepth=texture2D(uDepth,vUv).r;
        #include <colorspace_fragment>
      }
    `,
    depthFunc: THREE.AlwaysDepth,
  });
  const glassMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: composite.texture }, uDepth: { value: composite.depthTexture }, uResolution: { value: size } },
    vertexShader: geometryVertex,
    fragmentShader: `
      varying vec3 vWorld,vNormal,vViewNormal;
      uniform sampler2D uColor,uDepth;uniform vec2 uResolution;
      void main(){
        vec3 n=normalize(vNormal),v=normalize(cameraPosition-vWorld);
        float fresnel=.025+.975*pow(1.-abs(dot(n,v)),4.);
        vec2 uv=gl_FragCoord.xy/uResolution;
        vec2 bent=clamp(uv+normalize(vViewNormal).xy*.0026,vec2(.001),vec2(.999));
        if(texture2D(uDepth,bent).r<gl_FragCoord.z)bent=uv;
        vec3 color=texture2D(uColor,bent).rgb;
        color=mix(color,vec3(.62,.78,.80),.13+fresnel*.48);
        float h=vWorld.y-4.56;
        float lip=smoothstep(1.62,1.685,h);
        float base=1.-smoothstep(.03,.14,h);
        float strip=pow(max(dot(n,normalize(vec3(-.65,.08,.75))),0.),50.);
        float secondStrip=pow(max(dot(n,normalize(vec3(.72,.04,.70))),0.),75.);
        color+=vec3(.74,.83,.80)*(strip*.62+secondStrip*.24+lip*.29+base*.16);
        gl_FragColor=vec4(color,1.);
        #include <colorspace_fragment>
      }
    `,
  });
  [liquidMaterial, iceMaterial, mergeMaterial, presentMaterial, glassMaterial].forEach(m => materials.add(m));
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mergeMaterial);
  quad.frustumCulled = false;
  passScene.add(quad);

  function attach(root) {
    root.updateMatrixWorld(true);
    const old = new Set();
    root.traverse(obj => {
      if (!obj.isMesh || !obj.name.startsWith("IcedCoffee")) return;
      originals.push(obj);old.add(obj.material);
      const clone = new THREE.Mesh(obj.geometry, obj.name.includes("liquid") ? liquidMaterial : obj.name.includes("ice_") ? iceMaterial : glassMaterial);
      clone.matrix.copy(obj.matrixWorld);clone.matrixAutoUpdate = false;
      if(obj.name.includes("ice_")){
        const origin=new THREE.Vector3(), orientation=new THREE.Quaternion(), scale=new THREE.Vector3();
        clone.matrix.decompose(origin,orientation,scale);
        floatingIce.push({clone,proxy:obj,origin,orientation,scale});
      }
      (obj.name.includes("liquid") ? liquidScene : obj.name.includes("ice_") ? iceScene : glassScene).add(clone);
      clones.push(clone);bounds.expandByObject(obj);
      // Lightweight proxies keep the drink present in the basin's reflection.
      const proxy = new THREE.MeshBasicMaterial({ color: obj.name.includes("liquid") ? 0xc28a42 : 0xcfe5e3, transparent: true, opacity: obj.name.includes("liquid") ? .75 : obj.name.includes("ice_") ? .58 : .28, depthWrite: false });
      obj.material = proxy;obj.castShadow = obj.name.includes("liquid");
    });
    old.forEach(m => m.dispose());
    bounds.expandByScalar(.12);
    ready = originals.length > 0;
  }
  function resize() {
    renderer.getDrawingBufferSize(size);
    background.setSize(size.x,size.y);composite.setSize(size.x,size.y);
  }
  function frameLayers(camera) {
    camera.updateMatrixWorld();
    let left=1,right=-1,bottom=1,top=-1;
    for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++){
      point.set(x?bounds.max.x:bounds.min.x,y?bounds.max.y:bounds.min.y,z?bounds.max.z:bounds.min.z).project(camera);
      left=Math.min(left,point.x);right=Math.max(right,point.x);bottom=Math.min(bottom,point.y);top=Math.max(top,point.y);
    }
    const x0=Math.max(0,Math.floor((left*.5+.5)*size.x)-4), y0=Math.max(0,Math.floor((bottom*.5+.5)*size.y)-4);
    const x1=Math.min(size.x,Math.ceil((right*.5+.5)*size.x)+4),y1=Math.min(size.y,Math.ceil((top*.5+.5)*size.y)+4);
    const w=Math.max(1,x1-x0),h=Math.max(1,y1-y0);
    rect.set(x0/size.x,y0/size.y,w/size.x,h/size.y);
    layerCamera.copy(camera,false);layerCamera.setViewOffset(size.x,size.y,x0,size.y-y1,w,h);layerCamera.updateMatrixWorld();
    liquidBuffer.setSize(Math.min(512,w),Math.min(512,h));iceBuffer.setSize(Math.min(512,w),Math.min(512,h));
    uniforms.uDepthRange.value=camera.far-camera.near;
  }
  function render(camera) {
    if(!ready){renderer.render(world,camera);return;}
    const previous=renderer.getRenderTarget(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),auto=renderer.autoClear;
    try {
      frameLayers(camera);
      originals.forEach(o=>o.visible=false);
      renderer.setRenderTarget(background);renderer.render(world,camera);
      renderer.setClearColor(0x000000,0);
      renderer.setRenderTarget(liquidBuffer);renderer.render(liquidScene,layerCamera);
      renderer.setRenderTarget(iceBuffer);renderer.render(iceScene,layerCamera);
      quad.material=mergeMaterial;renderer.setRenderTarget(composite);renderer.render(passScene,passCamera);
      quad.material=presentMaterial;renderer.setRenderTarget(previous);renderer.render(passScene,passCamera);
      renderer.autoClear=false;renderer.render(glassScene,camera);
    } finally {
      originals.forEach(o=>o.visible=true);renderer.autoClear=auto;renderer.setClearColor(clear,alpha);renderer.setRenderTarget(previous);
    }
  }
  function update(seconds, animated=true){
    const delta=previousSeconds===undefined?0:Math.max(0,Math.min(.05,seconds-previousSeconds));
    previousSeconds=seconds;
    motionUniforms.uMotion.value=animated?1:0;
    if(animated)motionUniforms.uTime.value+=delta;
    const time=animated?motionUniforms.uTime.value:0;
    floatingIce.forEach((item,index)=>{
      const phase=index*1.7, amplitude=animated?1:0;
      position.copy(item.origin);
      position.y+=amplitude*(.035*Math.sin(time*1.65+phase)+.018*Math.sin(time*2.2));
      position.x+=amplitude*.008*Math.sin(time*1.3+phase);
      euler.set(amplitude*.035*Math.sin(time*1.6+phase),amplitude*.025*Math.sin(time*1.2+phase),amplitude*.04*Math.sin(time*1.45+phase));
      rotation.setFromEuler(euler).premultiply(item.orientation);
      item.clone.matrix.compose(position,rotation,item.scale);
      item.clone.matrixWorldNeedsUpdate=true;
      // The root has an identity transform; keep reflection proxies in sync.
      item.proxy.position.copy(position);item.proxy.quaternion.copy(rotation);item.proxy.scale.copy(item.scale);
    });
  }
  return {attach,resize,render,update,dispose(){
    [background,liquidBuffer,iceBuffer,composite].forEach(t=>t.dispose());
    materials.forEach(m=>m.dispose());quad.geometry.dispose();clones.forEach(o=>o.removeFromParent());
  }};
}
