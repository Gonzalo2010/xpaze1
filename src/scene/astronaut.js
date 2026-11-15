import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/* --------------------------------------------------------------------------
   Astronauta de XPaze, construido por código (sin modelos externos).
   Unidades de escena: 1 ≈ 9,6 cm (la estación mide 2,36 de alto). Mira a −Z.
   Los brazos y las piernas se resuelven con cinemática inversa de dos huesos:
   se le dice dónde poner las manos y él coloca codos y hombros.
   -------------------------------------------------------------------------- */

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// tejido del traje: ruido fino y costuras, para que la luz no lo vea liso
function fabricTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const x = (i / 4) % 512, y = Math.floor(i / 4 / 512);
    const weave = 10 * Math.sin(x * 1.57) * Math.sin(y * 1.57);
    const n = 128 + weave + (Math.random() - 0.5) * 34;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  return t;
}

// parche con la marca, dibujado en un lienzo
function patchTexture(text, sub) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#10151c'; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#44d742'; g.lineWidth = 10; g.strokeRect(12, 12, 488, 232);
  g.fillStyle = '#ffffff'; g.font = '800 110px "Mona Sans", system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText(text, 256, 142);
  g.fillStyle = '#44d742'; g.font = '600 40px "IBM Plex Mono", monospace';
  g.fillText(sub, 256, 204);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function makeAstronaut() {
  const root = new THREE.Group();
  const bump = fabricTexture();

  const M = {
    suit: new THREE.MeshPhysicalMaterial({ color: '#eceef1', roughness: 0.82, metalness: 0, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color('#ffffff'), bumpMap: bump, bumpScale: 0.6 }),
    shell: new THREE.MeshPhysicalMaterial({ color: '#f6f7f9', roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12 }),
    visor: new THREE.MeshPhysicalMaterial({ color: '#ffb23e', roughness: 0.04, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#23262b', roughness: 0.9, metalness: 0 }),
    grey: new THREE.MeshPhysicalMaterial({ color: '#bfc3c9', roughness: 0.7, sheen: 0.6, sheenColor: new THREE.Color('#ffffff'), bumpMap: bump, bumpScale: 0.5 }),
    ring: new THREE.MeshStandardMaterial({ color: '#2ecf3f', roughness: 0.28, metalness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: '#9aa1ab', roughness: 0.3, metalness: 1 }),
    dark: new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.5, metalness: 0.4 }),
    led: new THREE.MeshStandardMaterial({ color: '#44d742', emissive: '#44d742', emissiveIntensity: 3 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#dfeaff', emissiveIntensity: 4 }),
    red: new THREE.MeshStandardMaterial({ color: '#e5484d', roughness: 0.5 }),
  };

  const add = (parent, geo, mat, pos, rot) => {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.copy(pos);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  /* ------------------------------------------------------------ torso -- */
  const body = new THREE.Group();
  root.add(body);
  const torso = add(body, new THREE.CapsuleGeometry(1.72, 2.5, 24, 48), M.suit, V(0, 0, 0));
  torso.scale.set(1.16, 1, 0.86);
  // cintura y pelvis
  add(body, new THREE.TorusGeometry(1.72, 0.2, 20, 64), M.steel, V(0, -2.15, 0), [Math.PI / 2, 0, 0]).scale.set(1.12, 0.86, 1);
  const pelvis = add(body, new THREE.SphereGeometry(1.75, 48, 32), M.suit, V(0, -3.0, 0));
  pelvis.scale.set(1.14, 0.72, 0.88);
  // arnés
  for (const x of [-0.95, 0.95]) add(body, new RoundedBoxGeometry(0.42, 3.6, 0.16, 4, 0.06), M.grey, V(x, 0.7, -1.44), [0.12, 0, x > 0 ? -0.05 : 0.05]);
  // unidad de control del pecho
  const chest = add(body, new RoundedBoxGeometry(1.9, 1.25, 0.55, 6, 0.14), M.shell, V(0, 0.25, -1.62));
  add(chest, new RoundedBoxGeometry(1.1, 0.5, 0.06, 3, 0.03), M.dark, V(-0.25, 0.2, -0.28));
  [-0.55, -0.2, 0.15].forEach((x, i) => add(chest, new THREE.CylinderGeometry(0.09, 0.09, 0.1, 20), [M.led, M.red, M.steel][i], V(x, -0.32, -0.3), [Math.PI / 2, 0, 0]));
  add(chest, new THREE.CylinderGeometry(0.16, 0.16, 0.16, 24), M.steel, V(0.62, 0.05, -0.32), [Math.PI / 2, 0, 0]);
  // parche de la marca
  const patch = add(body, new THREE.PlaneGeometry(1.25, 0.62), new THREE.MeshStandardMaterial({ map: patchTexture('XPaze', 'MISSION 01'), roughness: 0.9 }), V(-1.05, 1.55, -1.5), [-0.1, Math.PI + 0.42, 0]);
  patch.castShadow = false;
  // tubos de soporte vital
  const hose = (pts) => add(body, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.13, 12), M.rubber);
  hose([V(1.0, 0.0, -1.5), V(1.9, -0.6, -1.0), V(2.2, -0.9, 0.4), V(1.6, -0.4, 1.4)]);
  hose([V(-1.0, -0.2, -1.5), V(-2.0, -0.9, -0.9), V(-2.25, -1.0, 0.5), V(-1.6, -0.5, 1.4)]);

  /* ---------------------------------------------------------- mochila -- */
  const pack = add(body, new RoundedBoxGeometry(3.7, 4.9, 1.6, 8, 0.35), M.shell, V(0, 0.7, 1.75));
  add(pack, new RoundedBoxGeometry(2.6, 1.4, 0.2, 4, 0.08), M.grey, V(0, 1.0, 0.82));
  add(pack, new RoundedBoxGeometry(2.6, 1.6, 0.2, 4, 0.08), M.dark, V(0, -0.9, 0.82));
  add(pack, new THREE.CylinderGeometry(0.05, 0.05, 2.2, 12), M.steel, V(1.45, 3.3, 0.3));
  add(pack, new THREE.SphereGeometry(0.12, 16, 12), M.led, V(1.45, 4.45, 0.3));
  for (const x of [-1.2, 1.2]) add(pack, new THREE.CylinderGeometry(0.42, 0.42, 1.2, 32), M.steel, V(x, -2.75, 0), [0, 0, Math.PI / 2]);

  /* ------------------------------------------------------------ casco -- */
  const head = new THREE.Group();
  head.position.set(0, 4.5, -0.12);
  body.add(head);
  add(head, new THREE.SphereGeometry(1.78, 96, 64), M.shell);
  // visor dorado: un casquete algo mayor, mirando a −Z
  const visor = add(head, new THREE.SphereGeometry(1.82, 96, 64, Math.PI * 1.5 - 1.08, 2.16, 0.62, 1.42), M.visor);
  visor.castShadow = false;
  // marco del visor
  const frame = add(head, new THREE.SphereGeometry(1.8, 96, 64, Math.PI * 1.5 - 1.16, 2.32, 0.54, 1.58), M.dark);
  frame.scale.setScalar(0.998);
  // aro del cuello
  add(body, new THREE.TorusGeometry(1.32, 0.24, 24, 72), M.ring, V(0, 3.02, -0.05), [Math.PI / 2, 0, 0]);
  add(body, new THREE.CylinderGeometry(1.3, 1.5, 0.5, 64, 1, true), M.suit, V(0, 2.75, -0.02));
  // focos y cámara
  for (const x of [-1, 1]) {
    const lampBox = add(head, new RoundedBoxGeometry(0.42, 0.6, 0.7, 4, 0.1), M.dark, V(x * 1.78, 0.35, -0.35));
    add(lampBox, new THREE.CylinderGeometry(0.17, 0.17, 0.08, 24), M.lamp, V(0, 0, -0.37), [Math.PI / 2, 0, 0]);
  }
  add(head, new RoundedBoxGeometry(0.5, 0.3, 0.5, 4, 0.08), M.dark, V(0, 1.72, -0.5));

  /* ------------------------------------------- extremidades (IK) -- */
  const seg = (r1, r2, mat) => add(root, new THREE.CylinderGeometry(r1, r2, 1, 40, 1, true), mat);
  const ball = (r, mat) => add(root, new THREE.SphereGeometry(r, 40, 28), mat);
  const ringGeo = (r) => new THREE.TorusGeometry(r, 0.07, 16, 64);

  function limb(side, kind) {
    const arm = kind === 'arm';
    const L = {
      a: seg(arm ? 0.68 : 0.95, arm ? 0.6 : 0.82, M.suit),   // brazo / muslo (de la raíz a la articulación)
      b: seg(arm ? 0.58 : 0.8, arm ? 0.5 : 0.7, M.suit),     // antebrazo / pierna
      j0: ball(arm ? 0.82 : 1.02, M.suit),                   // hombro / cadera
      j1: ball(arm ? 0.66 : 0.9, M.rubber),                  // codo / rodilla
      r1: add(root, ringGeo(arm ? 0.64 : 0.88), M.ring),
      r2: add(root, ringGeo(arm ? 0.56 : 0.76), M.ring),
      stripe: add(root, new THREE.CylinderGeometry(arm ? 0.675 : 0.93, arm ? 0.665 : 0.915, 0.34, 40, 1, true), M.red),
      side,
    };
    return L;
  }
  const arms = { L: limb(-1, 'arm'), R: limb(1, 'arm') };
  const legs = { L: limb(-1, 'leg'), R: limb(1, 'leg') };

  // manos: guante con dedos que rodean el asidero (eje vertical)
  function hand(side) {
    const h = new THREE.Group();
    root.add(h);
    const g = new THREE.Group(); // todo a escala del asidero
    g.scale.setScalar(0.74);
    h.add(g);
    add(g, new RoundedBoxGeometry(0.9, 1.15, 0.46, 6, 0.2), M.grey, V(0, 0, 0.52));
    // cuatro dedos: arcos alrededor del eje vertical, con la abertura hacia la palma (+Z)
    for (let i = 0; i < 4; i++) {
      const f = add(g, new THREE.TorusGeometry(0.4, 0.135, 16, 40, Math.PI * 1.4), M.grey, V(0, -0.42 + i * 0.28, 0));
      f.rotation.set(Math.PI / 2, 0, Math.PI * 0.8);
      add(f, new THREE.SphereGeometry(0.14, 16, 12), M.rubber, V(0.4 * Math.cos(Math.PI * 1.4), 0.4 * Math.sin(Math.PI * 1.4), 0));
      add(f, new THREE.SphereGeometry(0.135, 16, 12), M.grey, V(0.4, 0, 0));
    }
    // pulgar apoyado arriba (en la derecha, sobre la ventanita del sensor)
    add(g, new THREE.CapsuleGeometry(0.15, 0.5, 8, 16), M.grey, V(0, 0.78, 0.2), [1.25, 0, 0]);
    // puño del guante
    add(g, new THREE.CylinderGeometry(0.5, 0.56, 0.42, 40), M.ring, V(0, 0, 1.0), [Math.PI / 2, 0, 0]);
    return h;
  }
  const hands = { L: hand(-1), R: hand(1) };

  // botas
  function boot() {
    const b = new THREE.Group();
    root.add(b);
    add(b, new RoundedBoxGeometry(1.5, 1.0, 2.5, 6, 0.4), M.grey, V(0, 0, -0.45));
    add(b, new RoundedBoxGeometry(1.56, 0.3, 2.6, 4, 0.12), M.rubber, V(0, -0.52, -0.45));
    add(b, new THREE.CylinderGeometry(0.78, 0.82, 0.5, 40), M.ring, V(0, 0.55, 0.15));
    return b;
  }
  const boots = { L: boot(), R: boot() };

  const SH = { L: V(-2.3, 1.85, -0.1), R: V(2.3, 1.85, -0.1) };
  const HIP = { L: V(-1.0, -3.3, 0), R: V(1.0, -3.3, 0) };
  const LEN = { arm: [3.0, 2.75], leg: [4.3, 4.1] };

  const tmp = { d: V(0, 0, 0), q: new THREE.Quaternion(), mid: V(0, 0, 0), pole: V(0, 0, 0), e: V(0, 0, 0) };
  function place(mesh, a, b) {
    tmp.d.subVectors(b, a);
    const len = tmp.d.length();
    mesh.position.copy(a).addScaledVector(tmp.d, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, tmp.d.normalize());
    mesh.scale.set(1, len, 1);
  }
  function ringAt(mesh, a, b, t) {
    tmp.d.subVectors(b, a);
    mesh.position.copy(a).addScaledVector(tmp.d, t);
    mesh.quaternion.setFromUnitVectors(V(0, 0, 1), tmp.d.normalize());
  }
  // dos huesos: de s a t con longitudes l1 y l2; el codo se abre hacia «hint»
  function solve(L, s, t, l1, l2, hint) {
    const dir = tmp.d.subVectors(t, s);
    const dist = Math.min(dir.length(), (l1 + l2) * 0.995);
    dir.normalize();
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    tmp.pole.copy(hint).addScaledVector(dir, -hint.dot(dir)).normalize();
    const e = tmp.e.copy(s).addScaledVector(dir, a).addScaledVector(tmp.pole, h).clone();
    const end = s.clone().addScaledVector(dir, dist);
    place(L.a, s, e); place(L.b, e, end);
    L.j0.position.copy(s); L.j1.position.copy(e);
    ringAt(L.r1, s, e, 0.86); ringAt(L.r2, e, end, 0.9);
    place(L.stripe, s.clone().lerp(e, 0.4), s.clone().lerp(e, 0.52));
    return end;
  }

  const rest = { L: V(-2.9, -1.6, -1.9), R: V(2.9, -1.6, -1.9) }; // manos flotando delante del cuerpo
  const local = V(0, 0, 0);
  const handPos = { L: rest.L.clone(), R: rest.R.clone() };

  return {
    root,
    materials: M,
    /**
     * @param {number} t    tiempo (s)
     * @param {object} o    { reach: 0–1, targetL, targetR (mundo), glow: 0–1 }
     */
    update(t, o = {}) {
      const reach = o.reach ?? 0;
      root.updateMatrixWorld(true);
      // respiración y flotación suave
      body.scale.setScalar(1 + 0.006 * Math.sin(t * 1.3));
      head.rotation.set(0.1 + 0.03 * Math.sin(t * 0.5) + reach * 0.16, 0.05 * Math.sin(t * 0.37) * (1 - reach), 0);

      for (const k of ['L', 'R']) {
        const side = k === 'L' ? -1 : 1;
        // mano: de la postura de reposo al asidero
        const drift = V(side * 0.12 * Math.sin(t * 0.7 + side), 0.18 * Math.sin(t * 0.9 + side * 2), 0.1 * Math.cos(t * 0.6));
        const from = rest[k].clone().add(drift);
        const target = o[k === 'L' ? 'targetL' : 'targetR'];
        if (target) { local.copy(target); root.worldToLocal(local); handPos[k].lerpVectors(from, local, reach); } else handPos[k].copy(from);
        const H = hands[k];
        H.position.copy(handPos[k]);
        H.rotation.set((1 - reach) * 0.5, side * (0.95 * reach - 0.5 * (1 - reach)), (1 - reach) * side * 0.3);
        // la muñeca queda detrás de la palma
        const wrist = V(0, -0.02, 0.95).applyEuler(H.rotation).add(H.position);
        solve(arms[k], SH[k].clone(), wrist, LEN.arm[0], LEN.arm[1], V(side * 1, -0.75, 0.35));

        // piernas: cuelgan con un vaivén lento, algo flexionadas (postura neutra en microgravedad)
        const sway = Math.sin(t * 0.45 + side * 0.8);
        const foot = V(side * 1.25 + sway * 0.12, -10.4 + 0.25 * Math.cos(t * 0.5 + side), 1.6 + sway * 0.5);
        const end = solve(legs[k], HIP[k].clone(), foot, LEN.leg[0], LEN.leg[1], V(side * 0.15, 0, -1));
        boots[k].position.copy(end).add(V(0, -0.55, 0));
        boots[k].rotation.set(0.5 + sway * 0.06, side * -0.12, 0);
      }
      M.lamp.emissiveIntensity = 3 + (o.glow ?? 0) * 3;
    },
  };
}
