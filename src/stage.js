// Lienzo 3D fijo detrás del contenido. La estación real (station.js) se coloca
// según un objetivo que fija el scroll; aquí solo se interpola y se dibuja.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { makeStation } from './station.js';

const FOV = 30;
const CAM_Z = 8;

export function createStage(canvas, { reduced = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_Z);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight('#ffffff', 2.0);
  key.position.set(4, 6, 6);
  const fill = new THREE.DirectionalLight('#f3efe6', 0.8);
  fill.position.set(-5, 2, 3);
  scene.add(key, fill);

  const station = makeStation(renderer);
  scene.add(station.group);
  station.setScreen({
    who: 'Día 58 · chequeo de la mañana',
    state: 'Estable',
    done: 'Chequeo completado',
    tiles: [['Pulso', '62', 'ppm'], ['Oxígeno', '98', '%'], ['Temperatura', '36,6', '°C'], ['Recuperación', 'Buena', '']],
  });

  // objetivo (lo fija el scroll) y estado actual (se interpola)
  const target = { x: 0.42, y: 0, scale: 1, rotY: -0.5, rotX: 0.18, explode: 0, xray: false, focus: [] };
  const cur = { ...target };
  let halfH = CAM_Z * Math.tan((FOV / 2) * Math.PI / 180);
  let halfW = halfH;
  let pointerX = 0, pointerY = 0;
  let visible = false;
  let raf = 0;
  let last = performance.now();
  const t0 = last;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    halfW = halfH * camera.aspect;
  }
  resize();
  window.addEventListener('resize', resize);
  if (!reduced) {
    window.addEventListener('pointermove', (e) => {
      pointerX = (e.clientX / window.innerWidth) * 2 - 1;
      pointerY = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = reduced ? 1 : 1 - Math.pow(0.0015, dt);
    for (const p of ['x', 'y', 'scale', 'rotY', 'rotX', 'explode']) cur[p] += (target[p] - cur[p]) * k;

    const g = station.group;
    g.position.set(cur.x * halfW, cur.y * halfH, 0);
    g.scale.setScalar(cur.scale);
    const idle = reduced ? 0 : Math.sin((now - t0) / 2400) * 0.06;
    g.rotation.set(cur.rotX + pointerY * 0.05, cur.rotY + idle + pointerX * 0.12, 0);
    station.setExplode(cur.explode);
    station.focus(target.focus, target.xray);
    station.update(dt, (now - t0) / 1000);

    renderer.render(scene, camera);
    if (visible) raf = requestAnimationFrame(frame);
  }

  function setVisible(v) {
    if (v === visible) return;
    visible = v;
    canvas.classList.toggle('is-on', v);
    if (v && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  return {
    ready: station.ready,
    target,
    setVisible,
    get halfW() { return halfW; },
    get aspect() { return camera.aspect; },
  };
}
