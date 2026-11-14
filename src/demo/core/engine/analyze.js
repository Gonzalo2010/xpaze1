// Análisis de un chequeo: compara a la persona consigo misma.
// 1) contexto → equivalente en reposo   2) z robusto por señal (mediana + MAD)
// 3) deriva sostenida con EWMA          4) rareza conjunta con Isolation Forest
// 5) fusión en un estado                6) explicación (explain.js)

import { METRICS, VITALS, FEATURES } from './crew.js';
import { mean, sd, median, robustScale, quantile, ewmaChart, round } from './stats.js';
import { buildForest, anomalyScore, contributions } from './iforest.js';
import { expectedShift, toRestEquivalent } from './context.js';
import { cabinOut } from './signals.js';
import { createRng, hashSeed } from './rng.js';
import { explain } from './explain.js';

export const THRESHOLDS = {
  quality: 0.6,      // por debajo, la medición no se interpreta
  watch: 2.5,        // |z| robusto adverso para «a vigilar»
  anomaly: 3.5,      // |z| robusto adverso para «anomalía»
  composite: 3.0,    // varias señales moviéndose un poco a la vez
  window: 28,        // días de línea base
  lag: 7,            // la línea base termina 7 días atrás: un cambio lento no se absorbe
  lambda: 0.3,       // memoria del EWMA
  L: 3,              // anchura de los límites de control
  forestMin: 0.6,    // puntuación mínima para considerar rareza conjunta
};

function fallbackScale(astronaut, m) {
  const d = METRICS[m];
  return Math.max(d.floor, d.sdRel ? d.sdRel * astronaut.baseline[m] : d.sd);
}

// Días con los que se aprende la línea base: una ventana que termina `lag` días atrás.
export function baselineWindow(history, window = THRESHOLDS.window, lag = THRESHOLDS.lag) {
  if (history.length < lag + 10) return history.slice(-window);
  return history.slice(-(window + lag), -lag);
}

// Línea base personal de una métrica a partir de los días anteriores.
export function baselineOf(astronaut, history, m) {
  const values = baselineWindow(history).map((d) => d[m]).filter(Number.isFinite);
  if (values.length < 7) {
    const s = fallbackScale(astronaut, m);
    return { median: astronaut.baseline[m], scale: s, mean: astronaut.baseline[m], sd: s, n: values.length, values };
  }
  return {
    median: median(values), scale: robustScale(values, METRICS[m].floor),
    mean: mean(values), sd: Math.max(sd(values), 1e-6), n: values.length, values,
  };
}

// Deriva sostenida: EWMA de los últimos días frente a una referencia anterior.
export function driftOf(astronaut, history, m, todayValue, { lambda = THRESHOLDS.lambda, L = THRESHOLDS.L, tol = 1, span = THRESHOLDS.lag } = {}) {
  const ref = baselineOf(astronaut, history, m);
  const recent = history.slice(-span).map((d) => d[m]);
  const series = [...recent, todayValue];
  const chart = ewmaChart(series, { lambda, center: ref.median, sigma: ref.scale * tol, L });
  // días seguidos (desde hoy hacia atrás) desviados más de 0,8σ en la misma dirección
  let days = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (chart.dir !== 0 && (series[i] - ref.median) * chart.dir > 0.8 * ref.scale * tol) days++; else break;
  }
  return { ...chart, days, center: ref.median, sigma: ref.scale * tol, series, lambda, L };
}

// Bosque de aislamiento entrenado con los días de la línea base, en unidades z.
export function forestFor(astronaut, history, seed, baselines) {
  const win = baselineWindow(history);
  const base = baselines || Object.fromEntries(FEATURES.map((m) => [m, baselineOf(astronaut, history, m)]));
  const X = win.map((d) => FEATURES.map((m) => (d[m] - base[m].median) / base[m].scale));
  if (X.length < 8) return null;
  const forest = buildForest(X, { trees: 100, sampleSize: 32, rng: createRng(hashSeed(seed, astronaut.id, 'forest', win[win.length - 1].day)) });
  const train = X.map((x) => anomalyScore(forest, x));
  const threshold = Math.max(THRESHOLDS.forestMin, quantile(train, 0.95) + 0.03);
  return { forest, X, train, threshold };
}

/**
 * @param astronaut  { id, baseline }
 * @param history    días ANTERIORES al chequeo [{ day, hr, hrv, temp, spo2, sleepH, ... }]
 * @param today      { hr, hrv, temp, spo2, sleepH, sleepQuality }
 * @param context    resultado de classifyContext()
 * @param cabin      { tempC, humidity, pressure, co2 }
 */
export function analyze({ astronaut, history, today, context, cabin, quality = 1, seed = 1, lambda = THRESHOLDS.lambda }) {
  const ctx = context?.context || 'rest';
  const shift = expectedShift(ctx);
  const rest = toRestEquivalent(today, ctx);
  const cab = cabin ? cabinOut(cabin) : { co2: false, temp: false };
  const cabinBad = cab.co2 || cab.temp;

  if (quality < THRESHOLDS.quality) {
    const out = { status: 'unreliable', context: ctx, quality, metrics: {}, iforest: null, composite: 0, pattern: 'sensor', factors: [], cabinOut: cab };
    return { ...out, ...explain(out, { astronaut, today, cabin }) };
  }

  const metrics = {};
  const baselines = {};
  for (const m of FEATURES) {
    const def = METRICS[m];
    const b = baselineOf(astronaut, history, m);
    baselines[m] = b;
    const isVital = VITALS.includes(m);
    const tol = isVital ? shift.tol : 1;
    const adj = rest[m];
    const z = (adj - b.median) / (b.scale * tol);
    const drift = driftOf(astronaut, history, m, adj, { lambda, tol });
    metrics[m] = {
      value: today[m], adjusted: adj, median: b.median, scale: b.scale, n: b.n,
      z, zClassic: (adj - b.mean) / (b.sd * tol), adverse: z * def.adverse,
      delta: adj - b.median, pct: b.median ? ((adj - b.median) / b.median) * 100 : 0,
      pop: def.pop, popOut: today[m] < def.pop[0] ? -1 : today[m] > def.pop[1] ? 1 : 0,
      band: [b.median - THRESHOLDS.watch * b.scale, b.median + THRESHOLDS.watch * b.scale],
      drift: { out: drift.out, run: drift.run, days: drift.days, dir: drift.dir, value: drift.last, limit: drift.limit, center: drift.center, adverse: drift.out && drift.dir === def.adverse },
    };
  }

  // rareza conjunta
  let iforest = null;
  const f = forestFor(astronaut, history, seed, baselines);
  if (f) {
    const x = FEATURES.map((m) => metrics[m].z);
    const score = anomalyScore(f.forest, x);
    const contrib = contributions(f.forest, x);
    iforest = {
      score, threshold: f.threshold, anomalous: score >= f.threshold,
      typical: median(f.train),
      contributions: Object.fromEntries(FEATURES.map((m, i) => [m, contrib[i]])),
    };
  }

  // fusión
  const adv = VITALS.map((m) => metrics[m].adverse);
  const maxAdv = Math.max(...adv);
  const strong = adv.filter((v) => v >= THRESHOLDS.watch).length;
  const composite = Math.sqrt(adv.reduce((s, v) => s + Math.max(0, v) ** 2, 0));
  const benignBig = adv.some((v) => v <= -THRESHOLDS.anomaly);
  const sleepAdv = metrics.sleepH.adverse >= THRESHOLDS.watch;
  const drifting = VITALS.filter((m) => metrics[m].drift.adverse);
  const forestFlag = !!iforest?.anomalous && composite >= 2;

  let status = 'normal';
  if (maxAdv >= THRESHOLDS.anomaly || strong >= 2) status = 'anomaly';
  else if (maxAdv >= THRESHOLDS.watch || composite >= THRESHOLDS.composite || drifting.length || sleepAdv || forestFlag || benignBig || cabinBad) status = 'watch';

  // patrón: qué señales se mueven juntas (describe, no diagnostica)
  const a = Object.fromEntries(VITALS.map((m) => [m, metrics[m].adverse]));
  let pattern = 'none';
  if (status !== 'normal') {
    const top = VITALS.reduce((best, m) => (a[m] > a[best] ? m : best), 'hr');
    if (a.temp >= 2 && a.temp >= 0.75 * maxAdv) pattern = 'thermal';
    else if (sleepAdv && maxAdv < THRESHOLDS.anomaly) pattern = 'sleep';
    else if (cabinBad && maxAdv < THRESHOLDS.watch) pattern = 'cabin';
    else if (maxAdv >= 2) pattern = { hr: 'cardio', hrv: 'strain', temp: 'thermal', spo2: 'oxygen' }[top];
    else if (drifting.length) pattern = drifting.includes('hrv') ? 'strain' : drifting.includes('hr') ? 'cardio' : 'generic';
    else if (benignBig) pattern = 'unusual';
    else pattern = 'generic';
  } else if (ctx === 'exercise') pattern = 'exercise';

  // factores, de mayor a menor peso
  const factors = FEATURES
    .map((m) => ({
      metric: m, z: round(metrics[m].z, 2), adverse: metrics[m].adverse,
      value: metrics[m].value, baseline: metrics[m].median, delta: metrics[m].delta, pct: metrics[m].pct,
      popOut: metrics[m].popOut, driftDays: metrics[m].drift.adverse ? metrics[m].drift.days : 0,
      forest: iforest ? iforest.contributions[m] : 0,
    }))
    .sort((p, q) => Math.abs(q.z) - Math.abs(p.z));

  const out = { status, context: ctx, quality, metrics, iforest, composite, maxAdverse: maxAdv, drifting, pattern, factors, cabinOut: cab, sleepFlag: sleepAdv, forestFlag };
  return { ...out, ...explain(out, { astronaut, today, cabin }) };
}
