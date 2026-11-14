// Generador pseudoaleatorio determinista (mulberry32) con utilidades.
// Toda la simulación sale de aquí: misma semilla, mismos datos.

export function hashSeed(...parts) {
  const s = parts.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // mezcla final (avalancha) para que semillas vecinas no se parezcan
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function createRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const gauss = () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0;
    while (u < 1e-12) u = next();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * next();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
  return {
    next,
    gauss,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
  };
}
