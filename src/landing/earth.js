// La Tierra procedural de la web anterior (xpaze/src/scene.js: makeEarth), en el cierre de la landing.
// Lienzo propio (no comparte el de src/stage.js), carga diferida, se para fuera de pantalla
// y respeta prefers-reduced-motion. Asoma como un horizonte en la parte baja del cierre.

import * as THREE from 'three';

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){float f=0.0;float a=0.5;for(int i=0;i<5;i++){f+=a*snoise(p);p*=2.02;a*=0.5;}return f;}
float fbm3(vec3 p){float f=0.0;float a=0.5;for(int i=0;i<3;i++){f+=a*snoise(p);p*=2.02;a*=0.5;}return f;}
`;

const SUN = new THREE.Vector3(0.3, 0.75, 0.6).normalize();
function makeEarth() {
  const R = 9;
  const group = new THREE.Group();

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(R, 160, 120),
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSun: { value: SUN } },
      vertexShader: /* glsl */ `
        varying vec3 vObj; varying vec3 vN; varying vec3 vWorld;
        void main(){
          vObj = normalize(position);
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position,1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE}
        uniform float uTime; uniform vec3 uSun;
        varying vec3 vObj; varying vec3 vN; varying vec3 vWorld;
        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vWorld);
          float cont = fbm(vObj * 2.1 + vec3(1.7, 0.0, 3.1));
          float land = smoothstep(0.02, 0.09, cont);
          float detail = fbm3(vObj * 9.0);
          vec3 ocean = mix(vec3(0.04, 0.22, 0.52), vec3(0.12, 0.44, 0.80), smoothstep(-0.4, 0.1, cont));
          vec3 ground = mix(vec3(0.30, 0.46, 0.24), vec3(0.66, 0.58, 0.40), smoothstep(-0.2, 0.5, detail));
          vec3 base = mix(ocean, ground, land);
          float clouds = smoothstep(0.08, 0.6, fbm(vObj * 3.6 + vec3(uTime * 0.004, 0.0, uTime * 0.002)));
          float diff = dot(N, uSun);
          float day = smoothstep(-0.25, 0.45, diff);
          vec3 col = base * (0.55 + 0.45 * day);
          col = mix(col, vec3(0.97) * (0.75 + 0.25 * day), clouds * 0.8);
          vec3 H = normalize(uSun + V);
          col += vec3(1.0, 0.97, 0.9) * pow(max(dot(N, H), 0.0), 60.0) * (1.0 - land) * (1.0 - clouds) * 0.5;
          // bruma atmosférica hacia el borde, se funde con el cielo claro
          float rim = pow(1.0 - max(dot(N, V), 0.0), 2.2);
          col = mix(col, vec3(0.80, 0.90, 1.0), rim * 0.85);
          col = pow(clamp(col, 0.0, 1.0), vec3(2.2));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    })
  );
  group.add(surface);

  const atmos = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.055, 128, 96),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uSun: { value: SUN } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vWorld;
        void main(){
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; varying vec3 vN; varying vec3 vWorld;
        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vWorld);
          float f = max(dot(N, V), 0.0);
          float glow = pow(1.0 - f, 3.0) * smoothstep(0.0, 0.3, f);
          vec3 col = pow(vec3(0.62, 0.80, 1.0), vec3(2.2));
          gl_FragColor = vec4(col, clamp(glow * 1.6, 0.0, 0.85));
          #include <colorspace_fragment>
        }`,
    })
  );
  atmos.renderOrder = 1;
  group.add(atmos);
  group.userData.surface = surface;
  return group;
}

export function createEarth(canvas, { reduced = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 960 ? 1.5 : 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  camera.position.set(0, 0, 10);
  const earth = makeEarth();
  earth.rotation.set(0.35, 0, 0.18);
  scene.add(earth);

  const target = { rise: 0 }; // 0 = escondida, 1 = asomada del todo (lo fija el scroll)
  let rise = 0, t = 0, raf = 0, running = false, last = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    // en móvil la esfera se ve más estrecha: se acerca un poco para que el horizonte llene el ancho
    camera.position.z = camera.aspect < 1 ? 7.4 : 10;
    camera.updateProjectionMatrix();
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (!reduced) t += dt;
    rise += (target.rise - rise) * (reduced ? 1 : 1 - Math.pow(0.002, dt));
    // al final asoma ~una cuarta parte del lienzo; en vertical la cámara está más cerca y hay que subirla más
    const top = camera.aspect < 1 ? -10.6 : -11.0;
    earth.position.set(0, top - 2 + rise * 2, -3);
    earth.rotation.y = t * 0.012;
    earth.userData.surface.material.uniforms.uTime.value = t;
    renderer.render(scene, camera);
    if (running) raf = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  return {
    target,
    start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    renderOnce() { last = performance.now(); frame(last); },
  };
}
