import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/* --------------------------------------------------------------------------
   XPaze Station: el modelo real del prototipo (milímetros, Y arriba, la
   pantalla del móvil mira a +Z). Aquí se carga, se ilumina por piezas, se
   vuelve translúcida (rayos X) y se desmonta siguiendo los 8 pasos reales.
   -------------------------------------------------------------------------- */

export const STATION_H = 226; // alto del modelo en mm
const SHELL = ['base', 'tapa']; // carcasa que se vuelve translúcida en rayos X
const HIGHLIGHT = new THREE.Color('#0a84ff');

// pasos del desmontaje, en mm con Z arriba (como en el visor del equipo)
const ELECTRONICA = ['raspberry', 'arduino', 'ad8232', 'protoboard', 'rc522', 'cable_usb', 'cable_bat', 'cables_rc522', 'cables_ecg', 'cables_i2c'];
export const PASOS = [
  { m: { movil: [-170, 0, 140] } },
  { m: { tapon_izq: [0, 0, 55], tapon_der: [0, 0, 55], max30102: [0, 0, 55] } },
  { m: { asidero_izq: [-130, 0, 30], tapon_izq: [-130, 0, 30], asidero_der: [130, 0, 30], tapon_der: [130, 0, 30], max30102: [130, 0, 30] } },
  { m: {}, tornillos: true },
  { m: { tapa: [0, 0, 200], mlx90614: [0, 0, 200], vl53l0x: [0, 0, 200], ambiental: [0, 0, 200] } },
  { m: Object.assign({ bandeja: [0, 0, 115] }, ...ELECTRONICA.map((g) => ({ [g]: [0, 0, 115] }))) },
  {
    m: { raspberry: [0, 0, 42], cable_usb: [0, 0, 42], cable_bat: [0, 0, 42], arduino: [0, 0, 42], ad8232: [0, 0, 32], protoboard: [0, 0, 32], rc522: [0, 0, 52], cables_rc522: [0, 0, 47], cables_ecg: [0, 0, 37], cables_i2c: [0, 0, 37] },
    retraso: { rc522: 0, cables_rc522: 0, raspberry: 0.18, cable_usb: 0.18, cable_bat: 0.18, arduino: 0.3, cables_i2c: 0.3, cables_ecg: 0.3, ad8232: 0.42, protoboard: 0.42 },
  },
  { m: { bateria: [0, 0, 80] } },
];
const suave = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* Pantalla del móvil: la app de XPaze dibujada en un lienzo */
function drawScreen(canvas, t) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const F = '"Mona Sans", system-ui, sans-serif';
  const ink = '#f2f5f8', dim = '#8d9aa8', ok = '#44d742', tile = '#18222d';
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  g.fillStyle = '#0b131b'; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 0, 0, W / 2, 0, W);
  glow.addColorStop(0, 'rgba(10,132,255,0.28)'); glow.addColorStop(1, 'rgba(10,132,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H * 0.5);
  g.fillStyle = ink; g.font = `700 30px ${F}`; g.fillText('09:41', 48, 72);
  g.font = `800 84px ${F}`; g.fillText('XPaze', 46, 196);
  g.fillStyle = dim; g.font = `400 30px ${F}`; g.fillText(t.who, 50, 246);
  const cx = W / 2, cy = 560, r = 210;
  g.lineWidth = 34; g.lineCap = 'round';
  g.strokeStyle = tile; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = ok; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.93); g.stroke();
  g.textAlign = 'center'; g.fillStyle = ink; g.font = `800 180px ${F}`; g.fillText('93', cx, cy + 58);
  g.fillStyle = ok; g.font = `700 42px ${F}`; g.fillText(t.state, cx, cy + 120); g.textAlign = 'left';
  t.tiles.forEach((v, i) => {
    const x = 48 + (i % 2) * 318, y = 850 + Math.floor(i / 2) * 190;
    g.fillStyle = tile; rr(x, y, 296, 168, 28); g.fill();
    g.fillStyle = dim; g.font = `400 28px ${F}`; g.fillText(v[0], x + 28, y + 50);
    g.fillStyle = ink; g.font = `700 64px ${F}`; g.fillText(v[1], x + 28, y + 128);
    if (v[2]) { const w = g.measureText(v[1]).width; g.fillStyle = dim; g.font = `400 30px ${F}`; g.fillText(v[2], x + 40 + w, y + 126); }
  });
  g.strokeStyle = '#ff2d55'; g.lineWidth = 5; g.lineJoin = 'round'; g.beginPath();
  for (let k = 0; k < 624; k++) {
    const p = (k % 156) / 156; let y = 0;
    if (p > 0.3 && p < 0.34) y = -14 * Math.sin(((p - 0.3) / 0.04) * Math.PI);
    else if (p > 0.4 && p < 0.42) y = 12;
    else if (p > 0.42 && p < 0.45) y = -78 * (1 - Math.abs((p - 0.435) / 0.015));
    else if (p > 0.45 && p < 0.47) y = 18;
    else if (p > 0.58 && p < 0.68) y = -22 * Math.sin(((p - 0.58) / 0.1) * Math.PI);
    if (k) g.lineTo(48 + k, 1300 + y); else g.moveTo(48 + k, 1300 + y);
  }
  g.stroke();
  g.font = `700 32px ${F}`;
  const w = g.measureText(t.done).width;
  g.fillStyle = 'rgba(68,215,66,0.16)'; rr(cx - w / 2 - 36, 1380, w + 72, 66, 33); g.fill();
  g.fillStyle = ok; g.fillText(t.done, cx - w / 2, 1424);
}

export function makeStation(renderer) {
  const group = new THREE.Group(); // lo mueve la escena (posición, giro, escala)
  const holder = new THREE.Group(); // centra el modelo; se ajusta al desmontar
  group.add(holder);
  const parts = {}; // pieza -> { meshes: [], h: brillo actual, ht: brillo objetivo }
  const state = { ready: false, xray: 0, xrayT: 0, explode: 0, focusPulse: 0 };
  const k = 2.36 / STATION_H; // la misma escala de escena que tenía el dispositivo anterior

  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 720; screenCanvas.height = 1500;
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.flipY = false;
  screenTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let screenTexts = null;

  const root = new THREE.Group();
  root.scale.setScalar(k);
  root.position.y = -(STATION_H / 2) * k;
  holder.add(root);

  // sombra de contacto: posa la estación y la separa del fondo claro
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 256;
  const sg = shadowCanvas.getContext('2d');
  const grad = sg.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(20,32,64,0.55)');
  grad.addColorStop(0.45, 'rgba(20,32,64,0.22)');
  grad.addColorStop(1, 'rgba(20,32,64,0)');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(340, 260),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false, toneMapped: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1;
  shadow.renderOrder = -1;
  shadow.visible = false;
  root.add(shadow);

  // encuadre del conjunto mientras se desmonta
  const fit = { s: 1, c: new THREE.Vector3() };
  const fitBox = new THREE.Box3(), tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3(), tmpCenter = new THREE.Vector3(), zeroV = new THREE.Vector3();

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const ready = new Promise((resolve, reject) => {
    loader.load('/models/xpaze-station.glb', (gltf) => {
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const name = o.name.split('__')[0];
        // con la compresión, cada pieza trae su propia posición: el desmontaje se suma a ella
        o.userData.basePos = o.position.clone();
        if (o.name.endsWith('__tex')) {
          o.material = new THREE.MeshStandardMaterial({ map: screenTex, emissiveMap: screenTex, emissive: 0xffffff, emissiveIntensity: 0.95, roughness: 0.14, metalness: 0 });
          o.userData.screen = true;
        } else {
          o.material = o.material.clone();
          o.material.envMapIntensity = o.name.includes('__pla') ? 0.7 : 1;
          if (o.name.includes('__pla')) o.material.roughness = 0.6;
          o.userData.baseEmissive = o.material.emissive.clone();
        }
        o.castShadow = true; o.receiveShadow = true;
        (parts[name] = parts[name] || { meshes: [], h: 0, ht: 0 }).meshes.push(o);
      });
      root.add(gltf.scene);
      // tornillos: salen hacia fuera de cada esquina
      for (const g in parts) if (g.startsWith('tornillo')) {
        const p = g.split('_'), x = +p[1], y = +p[2];
        PASOS[3].m[g] = [Math.sign(x - 100) * 46, Math.sign(y - 75) * 46, 38];
      }
      if (screenTexts) { drawScreen(screenCanvas, screenTexts); screenTex.needsUpdate = true; }
      state.ready = true;
      resolve();
    }, undefined, reject);
  });

  function applyExplode(t) {
    const v = new THREE.Vector3();
    for (const g in parts) {
      const o = new THREE.Vector3();
      PASOS.forEach((paso, i) => {
        const mv = paso.m[g];
        if (!mv) return;
        let p = clamp01(t - i);
        if (paso.retraso && paso.retraso[g] !== undefined) p = clamp01((p - paso.retraso[g]) / (1 - 0.42));
        o.add(v.set(mv[0], mv[2], -mv[1]).multiplyScalar(suave(p)));
      });
      parts[g].meshes.forEach((m) => m.position.copy(m.userData.basePos).add(o));
    }
  }

  return {
    group,
    ready,
    state,
    // piezas a iluminar (con nombres del modelo) y si se ve el interior
    focus(names = [], xray = false) {
      for (const g in parts) parts[g].ht = names.some((n) => g === n || g.startsWith(n)) ? 1 : 0;
      state.xrayT = xray ? 1 : 0;
    },
    // 0 = montada, 1 = los 8 pasos hechos
    setExplode(p) { state.explode = clamp01(p); },
    // caja de una pieza en coordenadas del mundo (para que el astronauta agarre los asideros)
    partBox(name) {
      const box = new THREE.Box3();
      group.updateMatrixWorld(true);
      for (const g in parts) if (g === name || g.startsWith(name)) parts[g].meshes.forEach((m) => box.expandByObject(m));
      return box;
    },
    setScreen(texts) {
      screenTexts = texts;
      if (state.ready) { drawScreen(screenCanvas, texts); screenTex.needsUpdate = true; }
    },
    update(dt, t, extraGlow = 0) {
      if (!state.ready) return;
      const kk = 1 - Math.pow(0.002, dt);
      state.xray += (state.xrayT - state.xray) * kk;
      const pulse = 0.55 + 0.45 * Math.sin(t * 4);
      for (const g in parts) {
        const P = parts[g];
        P.h += (P.ht - P.h) * kk;
        const glow = Math.max(P.h * pulse, extraGlow * (g.startsWith('asidero') || g === 'tapon_der' || g === 'max30102' || g === 'mlx90614' ? 1 : 0));
        const shell = SHELL.includes(g);
        P.meshes.forEach((m) => {
          if (m.userData.screen) return;
          m.material.emissive.copy(m.userData.baseEmissive).lerp(HIGHLIGHT, glow * 0.55);
          if (shell) {
            const op = 1 - state.xray * 0.84;
            m.material.transparent = op < 0.999;
            m.material.opacity = op;
            m.material.depthWrite = op > 0.6;
          }
        });
      }
      // desmontaje: las piezas se separan y el conjunto se reencuadra para caber
      // siempre en el mismo hueco que ocupa la estación montada
      applyExplode(state.explode * PASOS.length);
      if (state.explode > 0.001 || fit.s !== 1) {
        root.updateMatrix();
        fitBox.makeEmpty();
        for (const g in parts) for (const m of parts[g].meshes) {
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          m.updateMatrix();
          tmpBox.copy(m.geometry.boundingBox).applyMatrix4(m.matrix).applyMatrix4(root.matrix);
          fitBox.union(tmpBox);
        }
        fitBox.getSize(tmpSize);
        fitBox.getCenter(tmpCenter);
        // montada: 2,09 de ancho, 1,57 de fondo y 2,36 de alto (unidades de escena)
        const target = Math.min(1, 2.36 / tmpSize.y, 2.2 / tmpSize.x, 1.8 / tmpSize.z);
        const kk2 = 1 - Math.pow(0.0005, dt);
        fit.s += (target - fit.s) * kk2;
        fit.c.lerp(state.explode > 0.001 ? tmpCenter : zeroV, kk2);
        holder.scale.setScalar(fit.s);
        holder.position.copy(fit.c).multiplyScalar(-fit.s);
      }
    },
  };
}
