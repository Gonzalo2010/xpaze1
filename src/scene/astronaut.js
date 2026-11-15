import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/* --------------------------------------------------------------------------
   El astronauta: el traje Z2 de la NASA (modelo 3D oficial, NASA 3D Resources,
   https://github.com/nasa/NASA-3D-Resources · «Z2 Spacesuit»).
   El modelo viene en metros, mira a +Z y no tiene esqueleto: trae los brazos
   extendidos hacia delante, separados a la anchura de los hombros. Para que las
   manos caigan sobre los asideros de la estación (a 7 cm del eje), cada brazo se
   gira hacia dentro desde el hombro deformando la malla, con una transición suave.
   Unidades de escena: 1 = 9,6 cm (la estación mide 2,36 de alto).
   -------------------------------------------------------------------------- */

export const M_TO_UNITS = 1 / 0.096;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// gira los brazos hacia dentro (en metros, en el espacio del modelo)
function bendArms(geometry, angle = 0.385, lift = 0.0) {
  const P = geometry.attributes.position, N = geometry.attributes.normal;
  const pivotX = 0.29, pivotZ = 0.05, pivotY = 1.38;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const side = x >= 0 ? 1 : -1;
    // peso: 0 en el torso, 1 en el antebrazo y la mano
    const w = smooth(0.08, 0.3, z) * smooth(0.17, 0.2, Math.abs(x)) * smooth(0.92, 1.0, y) * (1 - smooth(1.5, 1.6, y));
    if (w <= 0) continue;
    const a = -side * angle * w;         // hacia el centro
    const c = Math.cos(a), s = Math.sin(a);
    const dx = x - side * pivotX, dz = z - pivotZ;
    const nx = side * pivotX + dx * c + dz * s;
    const nz = pivotZ - dx * s + dz * c;
    // y un poco hacia arriba o abajo, girando sobre el eje lateral del hombro
    const b = lift * w, cb = Math.cos(b), sb = Math.sin(b);
    const dy = y - pivotY, dz2 = nz - pivotZ;
    P.setXYZ(i, nx, pivotY + dy * cb - dz2 * sb, pivotZ + dy * sb + dz2 * cb);
    if (N) {
      const vx = N.getX(i), vy = N.getY(i), vz = N.getZ(i);
      const rx = vx * c + vz * s, rz = -vx * s + vz * c;
      N.setXYZ(i, rx, vy * cb - rz * sb, vy * sb + rz * cb);
    }
  }
  // normales saneadas: una normal de longitud cero (o no numérica) da píxeles no válidos en GPU reales
  if (N) {
    let bad = 0;
    for (let i = 0; i < N.count; i++) {
      const x = N.getX(i), y = N.getY(i), z = N.getZ(i), l = Math.hypot(x, y, z);
      if (!(l > 1e-6) || !Number.isFinite(l)) { N.setXYZ(i, 0, 1, 0); bad++; } else if (Math.abs(l - 1) > 1e-3) N.setXYZ(i, x / l, y / l, z / l);
    }
    if (bad) console.info(`[astronauta] ${bad} normales corregidas`);
  } else geometry.computeVertexNormals();
  for (let i = 0; i < P.count; i++) if (!Number.isFinite(P.getX(i) + P.getY(i) + P.getZ(i))) P.setXYZ(i, 0, 1.2, 0);
  P.needsUpdate = true;
  if (N) N.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export function makeAstronaut(renderer) {
  const root = new THREE.Group();   // lo mueve la escena; mira a −Z
  const model = new THREE.Group();  // el traje, girado para mirar a −Z y a escala de la escena
  model.rotation.y = Math.PI;
  model.scale.setScalar(M_TO_UNITS);
  root.add(model);

  const loader = new GLTFLoader();

  // dónde quedan las palmas (en el espacio de «root», unidades de escena)
  const palms = { y: 1.03 * M_TO_UNITS, z: -0.5 * M_TO_UNITS, x: 0.077 * M_TO_UNITS };

  const ready = new Promise((resolve, reject) => {
    loader.load('/models/z2-spacesuit.glb', (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const meshes = [];
      gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
      for (const src of meshes) {
        // la malla se pasa a metros «de verdad» (con las transformaciones del fichero ya aplicadas)
        // y solo entonces se doblan los brazos
        const geo = src.geometry.clone();
        geo.applyMatrix4(src.matrixWorld);
        const o = new THREE.Mesh(geo, src.material);
        model.add(o);
        bendArms(o.geometry);
        // el mapa de brillos del fichero produce motas de color con luces intensas: fuera
        o.material.specularColorMap = null; o.material.specularIntensityMap = null;
        o.material.specularIntensity = 0.35; o.material.roughness = 0.72;
        // el mapa de relieve viene con intensidad 0 en el fichero: no aporta nada, y en algunas
        // tarjetas gráficas su cálculo da valores no válidos que el resplandor extiende a toda la
        // pantalla (se queda en negro al aparecer el astronauta)
        o.material.normalMap = null; o.material.bumpMap = null; o.material.aoMap = null;
        o.material.transmission = 0; o.material.sheen = 0; o.material.clearcoat = 0;
        geo.deleteAttribute('tangent');
        // visor dorado: el modelo trae todo en un solo material, así que el visor se reconoce por su
        // posición (casquete frontal del casco, en metros) y ahí el material pasa a oro pulido
        o.material.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvMP = position;');
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vMP;')
            .replace('#include <map_fragment>', `#include <map_fragment>
              vec3 vc = vMP - vec3(0.0, 1.705, 0.075);
              float vd = length(vc);
              float vis = smoothstep(0.18, 0.3, vc.z / max(vd, 0.0001)) * step(vd, 0.2) * step(0.14, vd) * step(vMP.y, 1.835);
              // los desconchones del traje tiran a azul: se dejan en gris claro
              float bl = smoothstep(0.0, 0.08, diffuseColor.b - max(diffuseColor.r, diffuseColor.g));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3333))) * 1.2, bl * step(vMP.y, 1.5));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.7, 0.26), vis);`)
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.06, vis);')
            .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 1.0, vis);')
            // red de seguridad: ningún píxel sale con un valor no válido o desorbitado
            .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (!(gl_FragColor.r >= 0.0) || !(gl_FragColor.g >= 0.0) || !(gl_FragColor.b >= 0.0)) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);\ngl_FragColor.rgb = min(gl_FragColor.rgb, vec3(40.0));');
        };
        o.material.needsUpdate = true;
        o.castShadow = true; o.receiveShadow = true;
        o.material.envMapIntensity = 1.15;
        for (const k of ['map', 'normalMap', 'metalnessMap', 'roughnessMap']) if (o.material[k]) o.material[k].anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
        // medir las manos ya dobladas: los vértices más adelantados
        const P = o.geometry.attributes.position;
        let n = 0, sx = 0, sz = 0, ymin = 9;
        for (let i = 0; i < P.count; i++) {
          const z = P.getZ(i);
          if (z < 0.44) continue;
          n++; sx += Math.abs(P.getX(i)); sz += z; ymin = Math.min(ymin, P.getY(i));
        }
        if (n) { palms.x = (sx / n) * M_TO_UNITS; palms.z = -(sz / n) * M_TO_UNITS; palms.y = ymin * M_TO_UNITS; }
      }
      resolve();
    }, undefined, reject);
  });

  return {
    root,
    ready,
    palms,
    update(t) {
      // flotación mínima del propio traje (el movimiento grande lo da la escena)
      model.position.y = 0.05 * Math.sin(t * 0.9);
    },
  };
}
