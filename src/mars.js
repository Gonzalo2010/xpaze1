// Distancia Tierra–Marte y tiempo de la luz para una fecha, con los elementos
// orbitales medios (JPL, aproximación válida 1800–2050). Se ignora la pequeña
// inclinación de Marte (1,85°): el error es de un par de segundos de luz.

const AU_KM = 149597870.7;
const C_KM_S = 299792.458;
const RAD = Math.PI / 180;

const PLANETS = {
  earth: { a: 1.00000261, e: 0.01671123, L: [100.46457166, 35999.37244981], w: [102.93768193, 0.32327364] },
  mars: { a: 1.52371034, e: 0.0933941, L: [-4.55343205, 19140.30268499], w: [-23.94362959, 0.44441088] },
};

function position(p, T) {
  const L = p.L[0] + p.L[1] * T;
  const w = p.w[0] + p.w[1] * T;
  const M = (((L - w) % 360) + 360) % 360 * RAD;
  let E = M;
  for (let i = 0; i < 8; i++) E -= (E - p.e * Math.sin(E) - M) / (1 - p.e * Math.cos(E));
  const x = p.a * (Math.cos(E) - p.e);
  const y = p.a * Math.sqrt(1 - p.e * p.e) * Math.sin(E);
  const c = Math.cos(w * RAD), s = Math.sin(w * RAD);
  return [x * c - y * s, x * s + y * c];
}

export function marsLight(date = new Date()) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const [ex, ey] = position(PLANETS.earth, T);
  const [mx, my] = position(PLANETS.mars, T);
  const au = Math.hypot(mx - ex, my - ey);
  const km = au * AU_KM;
  return { au, km, seconds: km / C_KM_S };
}
