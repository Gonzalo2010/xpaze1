// XPaze · «El chequeo»: la estación se abre pieza a pieza, se vuelve a montar y un astronauta
// se hace un chequeo con ella. Las constantes salen del mismo cuerpo simulado que usa la app.

import '../fonts.css';
import './scene.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makeStation } from './station.js';
import { makeAstronaut } from './astronaut.js';
import { SimBody } from '../app/simbody.js';
import { drawEcg } from '../app/charts.js';

/* ----------------------------------------------------------------- idioma -- */
const params = new URLSearchParams(location.search);
let lang = 'en';
try { const q = params.get('lang'); const s = localStorage.getItem('xpaze-lang'); lang = q === 'es' || q === 'en' ? q : (s === 'es' ? 'es' : 'en'); } catch { /* nada */ }
document.documentElement.lang = lang;
const L = (es, en) => (lang === 'es' ? es : en);
const $ = (s) => document.querySelector(s);

const STEPS = [
  L('La XPaze Station', 'The XPaze Station'),
  L('El móvil solo se apoya: habla con la estación sin cables', 'The phone just rests on it: it talks to the station wirelessly'),
  L('En el asidero derecho, el sensor de pulso y oxígeno', 'In the right handle, the heart rate and oxygen sensor'),
  L('Los asideros de cobre son los electrodos del ECG', 'The copper handles are the ECG electrodes'),
  L('Cuatro tornillos', 'Four screws'),
  L('Bajo la tapa: temperatura sin contacto, distancia y aire de cabina', 'Under the lid: contactless temperature, distance and cabin air'),
  L('Toda la electrónica sale en una bandeja', 'All the electronics come out on one tray'),
  L('Raspberry Pi, Arduino, ECG y lector de tarjetas', 'Raspberry Pi, Arduino, ECG and card reader'),
  L('Y una batería que la aísla de la red', 'And a battery that isolates it from mains power'),
];

/* ------------------------------------------------------------- renderer -- */
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3)); // nitidez máxima razonable
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#03050a');
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 4000);

// entorno para los reflejos (el visor dorado): paneles de luz en una sala oscura
{
  const env = new THREE.Scene();
  env.background = new THREE.Color('#05070c');
  const panel = (color, intensity, w, h, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  panel('#ffffff', 14, 30, 16, [30, 36, -34]);   // sol
  panel('#6f9bff', 1.6, 90, 40, [0, -46, 10]);   // resplandor de la Tierra
  panel('#9fd4ff', 3, 16, 30, [-44, 6, 14]);     // relleno frío
  panel('#ffd9a8', 2.2, 12, 12, [20, 4, 44]);    // cálida trasera
  panel('#44d742', 3, 5, 9, [-6, 2, -30]);       // el verde de la pantalla
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.02).texture;
  scene.environmentIntensity = 0.5;
}

// luces
const sun = new THREE.DirectionalLight('#fff4e6', 2.1);
sun.position.set(14, 18, -12);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -16; sun.shadow.camera.right = 16; sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun);
const earthGlow = new THREE.DirectionalLight('#7fa8ff', 0.35);
earthGlow.position.set(-4, -14, 6);
scene.add(earthGlow);
scene.add(new THREE.HemisphereLight('#eef2ff', '#262a36', 0.75));
// luz frontal para el desmontaje (la cámara mira la cara que el sol no ilumina)
const front = new THREE.DirectionalLight('#ffffff', 2.2);
front.position.set(4, 6, 12);
scene.add(front);
const screenLight = new THREE.PointLight('#9fe8b0', 0, 14, 2);
screenLight.position.set(0, 0.6, 1.4);
scene.add(screenLight);

// estrellas
{
  const n = 5200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = 1500, q = Math.sqrt(1 - u * u);
    pos.set([r * q * Math.cos(a), r * u, r * q * Math.sin(a)], i * 3);
    const b = 0.5 + rnd() * 0.5, warm = rnd();
    col.set([b * (0.85 + warm * 0.15), b * 0.92, b * (1 - warm * 0.12)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9 })));
}

// la Tierra: un limbo enorme bajo la escena, con nubes procedurales y atmósfera
const earth = new THREE.Group();
{
  const R = 900;
  const surf = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 120), new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sun.position.clone().normalize() }, uT: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      varying vec3 vN; varying vec3 vP; uniform vec3 uSun; uniform float uT;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float n(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i = 0; i < 6; i++){ s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
      void main(){
        vec3 p = normalize(vP);
        float land = smoothstep(0.52, 0.6, fbm(p * 3.2 + 4.0));
        vec3 ocean = mix(vec3(0.01, 0.07, 0.22), vec3(0.03, 0.2, 0.42), fbm(p * 9.0));
        vec3 ground = mix(vec3(0.07, 0.22, 0.08), vec3(0.42, 0.34, 0.2), fbm(p * 14.0 + 9.0));
        vec3 c = mix(ocean, ground, land);
        float cl = smoothstep(0.5, 0.78, fbm(p * 5.5 + vec3(uT * 0.004, 0.0, uT * 0.002)) + 0.12 * fbm(p * 22.0));
        c = mix(c, vec3(1.0), cl * 0.92);
        float d = clamp(dot(normalize(vN), uSun) * 1.25 + 0.3, 0.0, 1.0);
        c *= 0.02 + d * 0.62;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.022, 160, 120), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    uniforms: { uSun: { value: sun.position.clone().normalize() } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vV; uniform vec3 uSun; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 0.0) ; float rim = pow(clamp(dot(-vN, vV), 0.0, 1.0), 3.2); float d = clamp(dot(-vN, uSun) * 0.9 + 0.55, 0.0, 1.0); gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * rim * d * 1.0 * f, 1.0); }',
  }));
  earth.add(surf, atmo);
  earth.userData.surf = surf;
  earth.position.set(-120, -960, -260);
  earth.rotation.set(0.4, 0, 0.25);
  scene.add(earth);
}

/* ------------------------------------------------- estación y astronauta -- */
const station = makeStation(renderer);
scene.add(station.group);
const astro = makeAstronaut(renderer);
scene.add(astro.root);
astro.root.visible = false;

const screenTexts = (phase, v = {}) => ({
  who: L('Vega Mar · día 58', 'Vega Mar · day 58'),
  state: phase === 'done' ? L('Estable', 'Stable') : phase === 'measuring' ? L('Midiendo…', 'Measuring…') : L('Lista', 'Ready'),
  done: phase === 'done' ? L('Chequeo completado', 'Check complete') : phase === 'measuring' ? L('No te muevas', 'Keep still') : L('Pasa tu tarjeta', 'Tap your card'),
  tiles: [[L('Pulso', 'Pulse'), v.hr ?? '—', L('lpm', 'bpm')], [L('Oxígeno', 'Oxygen'), v.spo2 ?? '—', '%'], [L('Temperatura', 'Temperature'), v.temp ?? '—', '°C'], ['HRV', v.hrv ?? '—', 'ms']],
});
station.setScreen(screenTexts('idle'));

// dónde están los asideros (se mide del modelo real cuando carga)
const grip = { L: new THREE.Vector3(-0.73, 0.2, 0.37), R: new THREE.Vector3(0.73, 0.2, 0.37), top: 0.74 };
station.ready.then(() => {
  const c = new THREE.Vector3();
  // se mide con la estación recta (en el primer acto está girada)
  const keep = station.group.rotation.clone();
  station.group.rotation.set(0, 0, 0);
  for (const [k, name] of [['L', 'asidero_izq'], ['R', 'asidero_der']]) {
    const b = station.partBox(name);
    if (!b.isEmpty()) { b.getCenter(c); grip[k].set(c.x, c.y, c.z); grip.top = b.max.y; }
  }
  station.group.rotation.copy(keep);
  return astro.ready;
}).then(() => {
  // el astronauta se coloca de modo que sus palmas descansen sobre los asideros
  ASTRO_TO.set(0, grip.top - 0.22 - astro.palms.y, grip.R.z - astro.palms.z - 0.15);
  document.body.classList.add('is-ready');
}).catch(() => document.body.classList.add('no-webgl'));

/* --------------------------------------------------------- posprocesado -- */
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.5, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let aspect = 1;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  aspect = w / h;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

/* ------------------------------------------------- constantes (simulado) -- */
const body = new SimBody(41);
body.setBase({ hr: 61, rmssd: 55, temp: 36.6 });
body.setScenario('rest');
body.settle();
const ecg = [];
const ecgCanvas = $('#ecg');

/* ------------------------------------------------------------ guion -- */
const T = { open: 1.6, opened: 10.2, hold: 11.4, closed: 14.4, enter: 14.2, grab: 19.2, measure: 20.2, done: 32.5, end: 37 };
const freeze = params.has('t') ? Number(params.get('t')) : null;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const span = (t, a, b) => clamp01((t - a) / (b - a));
const mix = (a, b, k) => a + (b - a) * k;

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const A1 = new THREE.Vector3(), A2 = new THREE.Vector3();
const ASTRO_FROM = new THREE.Vector3(10, -6, 26), ASTRO_TO = new THREE.Vector3(0, -9.9, 5.8);

let t0 = performance.now(), last = t0, lastStep = -1, lastPhase = '', slow = 0, shown = 0;
const cap = $('#caption'), stepN = $('#step'), hud = $('#hud'), verdict = $('#verdict'), fin = $('#fin');
const tiles = [...document.querySelectorAll('[data-tile]')];
const hudTitle = $('.hud__head b');
const setTile = (k, v) => { const el = document.querySelector(`[data-v="${k}"]`); if (el && el.textContent !== String(v)) el.textContent = v; };

function setCaption(text, n) {
  if (cap.dataset.t === text) return;
  cap.dataset.t = text;
  cap.classList.remove('is-in');
  // eslint-disable-next-line no-unused-expressions
  cap.offsetWidth;
  cap.textContent = text;
  cap.classList.add('is-in');
  stepN.textContent = n || '';
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = freeze ?? (now - t0) / 1000;
  const wall = now / 1000;

  /* --- acto 1: la estación se abre y se cierra --- */
  const opening = ease(span(t, T.open, T.opened));
  const closing = ease(span(t, T.hold, T.closed));
  const explode = t < T.hold ? opening : 1 - closing;
  station.setExplode(explode);
  const step = Math.round(explode * 8);
  const xray = step >= 1 && step <= 4 && t < T.hold;
  const focus = [[], ['movil'], ['tapon_der', 'max30102'], ['asidero'], ['tornillo'], ['mlx90614', 'vl53l0x', 'ambiental'], ['bandeja'], ['raspberry', 'arduino', 'ad8232', 'rc522'], ['bateria']][step] || [];
  station.focus(t < T.hold ? focus : [], xray);

  /* --- acto 2: llega el astronauta --- */
  const enter = ease(span(t, T.enter, T.grab - 1.2));
  const reach = ease(span(t, T.grab - 2.6, T.grab));
  astro.root.visible = t > T.enter - 0.05;
  astro.root.position.lerpVectors(ASTRO_FROM, ASTRO_TO, enter);
  astro.root.rotation.set(mix(0.35, 0, enter), mix(-1.0, 0, enter), mix(0.3, 0, enter));
  const measuring = t >= T.measure;
  const progress = span(t, T.measure, T.done);
  astro.update(wall * (1 - enter) );

  // la estación brilla en los sensores mientras mide, y gira muy poco
  const glow = measuring && t < T.done ? 0.5 + 0.5 * Math.sin(wall * 5) : 0;
  station.group.rotation.y = t < T.closed ? mix(-0.55, 0.25, span(t, 0, T.closed)) * (1 - ease(span(t, T.closed - 1.2, T.closed + 0.6))) : 0;
  station.group.rotation.x = t < T.closed ? 0.14 * (1 - ease(span(t, T.closed - 1.2, T.closed + 0.6))) : 0;
  station.update(dt, wall, glow);
  screenLight.intensity = t > T.closed ? 5 + (measuring ? 3 : 0) : 0;

  /* --- cámara --- */
  const far = Math.max(1, 1.05 / aspect); // en vertical, la cámara se aleja para que quepa
  const tall = aspect < 0.9 ? 1 : 0;      // y el sujeto sube a la mitad de arriba (abajo va el panel)
  A1.set(Math.sin(wall * 0.12) * 1.0, 0.45, 6.0).multiplyScalar(1 + (far - 1) * 0.9);
  const orbit = span(t, T.grab, T.end);
  A2.set(mix(18, 22, ease(orbit)), mix(2.4, 5.2, ease(orbit)), mix(-9, 0.5, ease(orbit))).multiplyScalar(far);
  const move = ease(span(t, T.closed - 0.6, T.grab - 0.6));
  camPos.lerpVectors(A1, A2, move);
  front.intensity = mix(2.2, 0.25, move);
  camLook.set(0, mix(-0.5 * tall, 3.6 - 4.0 * tall, move), mix(0, 3.4, move));
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  earth.userData.surf.material.uniforms.uT.value = wall;
  earth.rotation.y = wall * 0.004;

  /* --- textos --- */
  if (t < T.hold) { if (step !== lastStep) { lastStep = step; setCaption(STEPS[step], step ? `${step} / 8` : ''); } }
  else if (t < T.enter + 0.6) setCaption(L('Se cierra en segundos. Lista para medir.', 'It closes in seconds. Ready to measure.'), '');
  else if (t < T.grab) setCaption(L('Día 58 rumbo a Marte. Vega se acerca a la estación.', 'Day 58 on the way to Mars. Vega reaches the station.'), '');
  else if (t < T.done) setCaption(L('Agarra los asideros: un solo gesto lo mide todo.', 'She grips the handles: one gesture measures everything.'), '');
  else setCaption(L('Todo dentro de su normal. Sin esperar a la Tierra.', 'Everything within her normal. No waiting for Earth.'), '');

  /* --- constantes: ECG y valores que van apareciendo --- */
  hud.classList.toggle('is-on', t >= T.measure - 0.4);
  if (t >= T.measure - 0.4) {
    body.step(dt);
    for (const v of body.ecg(Math.round(250 * dt))) ecg.push(v);
    if (ecg.length > 1250) ecg.splice(0, ecg.length - 1250);
    drawEcg(ecgCanvas, ecg, { seconds: 4, color: '#ff4d5e' });
    slow += Math.min(1, (now - (frame.prev || now)) / 1000); frame.prev = now; // tiempo real, aunque vaya a pocos fotogramas
    const n = Math.floor(progress * 6.99);
    if (n !== shown) { shown = n; tiles.forEach((el, i) => el.classList.toggle('is-on', i < n)); }
    if (slow > 0.5) {
      slow = 0;
      const r = body.readings();
      setTile('hr', r.ecgHr ?? 61); setTile('spo2', 98); setTile('temp', r.temp.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { minimumFractionDigits: 1 }));
      setTile('hrv', r.rmssd ?? 55); setTile('rhythm', L('Sinusal', 'Sinus')); setTile('bp', `${r.bpEst.sys}/${r.bpEst.dia}`);
      $('#ring').style.strokeDashoffset = String(100 - progress * 100);
      $('#pct').textContent = `${Math.round(progress * 100)} %`;
      const phase = t >= T.done ? 'done' : 'measuring';
      if (phase !== lastPhase || phase === 'measuring') {
        lastPhase = phase;
        station.setScreen(screenTexts(phase, { hr: n >= 1 ? (r.ecgHr ?? 61) : '—', spo2: n >= 2 ? 98 : '—', temp: n >= 4 ? r.temp.toFixed(1) : '—', hrv: n >= 5 ? (r.rmssd ?? 55) : '—' }));
      }
    }
  }
  verdict.classList.toggle('is-on', t >= T.done);
  hud.classList.toggle('is-done', t >= T.done);
  const title = t >= T.done ? L('Chequeo completado', 'Check-up complete') : L('Chequeo en curso', 'Check-up in progress');
  if (hudTitle.textContent !== title) hudTitle.textContent = title;
  fin.classList.toggle('is-on', t >= T.done + 2.2);

  composer.render();
  requestAnimationFrame(frame);
}

$('#replay').addEventListener('click', () => {
  t0 = performance.now(); lastStep = -1; lastPhase = ''; shown = 0; ecg.length = 0;
  tiles.forEach((el) => el.classList.remove('is-on'));
  station.setScreen(screenTexts('idle'));
});
document.querySelectorAll('[data-i]').forEach((el) => { const [es, en] = el.dataset.i.split('|'); el.textContent = L(es, en); });
requestAnimationFrame(frame);
