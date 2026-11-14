// Estadística pura: media, mediana, MAD, z-score robusto y EWMA.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, d = 0) => { const k = 10 ** d; return Math.round(v * k) / k; };

export function mean(values) {
  if (!values.length) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function sd(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) ** 2;
  return Math.sqrt(s / (values.length - 1));
}

export function quantile(values, q) {
  if (!values.length) return NaN;
  const a = [...values].sort((x, y) => x - y);
  const pos = (a.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export const median = (values) => quantile(values, 0.5);

// Desviación absoluta mediana (sin escalar).
export function mad(values, center = median(values)) {
  return median(values.map((v) => Math.abs(v - center)));
}

// 1,4826 · MAD estima la desviación típica si los datos son normales, pero
// apenas se inmuta con valores atípicos. `floor` evita escalas minúsculas.
export function robustScale(values, floor = 0) {
  return Math.max(1.4826 * mad(values), floor);
}

// z robusto = (x − mediana) / (1,4826 · MAD)  ≡  0,6745 · (x − mediana) / MAD
export function robustZ(x, values, floor = 0) {
  const s = robustScale(values, floor);
  return s > 0 ? (x - median(values)) / s : 0;
}

// Media móvil con ponderación exponencial: e_t = λ·x_t + (1 − λ)·e_{t−1}
export function ewma(values, lambda = 0.3, start = values[0]) {
  const out = [];
  let e = start;
  for (const v of values) {
    e = lambda * v + (1 - lambda) * e;
    out.push(e);
  }
  return out;
}

// Gráfico de control EWMA: límites c ± L·σ·sqrt(λ/(2−λ)·(1−(1−λ)^(2t)))
export function ewmaChart(values, { lambda = 0.3, center, sigma, L = 3 } = {}) {
  const e = ewma(values, lambda, center);
  const points = e.map((v, i) => {
    const w = sigma * L * Math.sqrt((lambda / (2 - lambda)) * (1 - (1 - lambda) ** (2 * (i + 1))));
    return { value: v, upper: center + w, lower: center - w, out: Math.abs(v - center) > w, dir: Math.sign(v - center) };
  });
  // días seguidos, contando desde el final, fuera de control en la misma dirección
  let run = 0;
  const last = points[points.length - 1];
  if (last && last.out) {
    for (let i = points.length - 1; i >= 0 && points[i].out && points[i].dir === last.dir; i--) run++;
  }
  const limit = sigma * L * Math.sqrt(lambda / (2 - lambda));
  return { points, run, out: run > 0, dir: last ? last.dir : 0, limit, last: last ? last.value : center };
}
