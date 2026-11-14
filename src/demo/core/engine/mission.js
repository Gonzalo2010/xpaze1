// La misión simulada: historial diario por astronauta, escenarios inyectables
// y el chequeo completo (señales → medida → análisis). Sin DOM ni reloj:
// todo depende del estado y de la semilla.

import { CREW, crewById, METRICS } from './crew.js';
import { createRng, hashSeed } from './rng.js';
import { clamp, round, mean } from './stats.js';
import { synthECG, detectRPeaks, heartMetrics, signalQuality, synthPPG, estimateSpO2, tempSensor, distanceAt, cabinEnv } from './signals.js';
import { classifyContext } from './context.js';
import { analyze, THRESHOLDS } from './analyze.js';

export const START_DAY = 42;
export const DEFAULT_SEED = 2035; // semilla elegida: días base tranquilos y escenarios bien visibles

const step = (k, arr) => arr[Math.min(Math.max(k, 0), arr.length - 1)];

// scope: a quién afecta. backdate: días hacia atrás que ya llevaba ocurriendo.
// acute: solo afecta al siguiente chequeo. duration: se agota solo.
export const SCENARIOS = {
  fever: {
    scope: 'astronaut', backdate: 0,
    effect: (k) => { const r = step(k, [0.36, 0.65, 0.85, 1]); return { temp: r, hr: 10 * r, hrvMul: 1 - 0.3 * r, sleepH: -0.4 * r, sleepQuality: -16 * r }; },
  },
  badNight: {
    scope: 'astronaut', backdate: 0, duration: 2,
    effect: (k) => (k === 0 ? { sleepH: -3, sleepQuality: -35, hrvMul: 0.85, hr: 3 } : { sleepH: -0.8, sleepQuality: -10, hrvMul: 0.95, hr: 1 }),
  },
  exercise: { scope: 'astronaut', acute: true },
  stress: {
    scope: 'astronaut', backdate: 3,
    effect: (k) => { const r = step(k, [0.4, 0.55, 0.7, 0.8, 0.95, 1.1, 1.2]); return { hrvMul: 1 - 0.26 * r, hr: 4.5 * r, sleepH: -0.8 * r, sleepQuality: -14 * r }; },
  },
  cabin: {
    scope: 'crew', backdate: 0,
    effect: () => ({ hr: 2.5, hrvMul: 0.95, spo2: -0.4, sleepH: -0.3, sleepQuality: -12 }),
  },
  sensor: { scope: 'astronaut', acute: true },
  dehydration: {
    scope: 'astronaut', backdate: 1,
    effect: (k) => { const r = step(k, [0.5, 0.8, 1.05, 1.2]); return { hr: 7.5 * r, hrvMul: 1 - 0.18 * r, temp: 0.2 * r }; },
  },
};
export const SCENARIO_NAMES = Object.keys(SCENARIOS);

// Un día normal para esa persona: su línea base más variación diaria.
export function baseDay(astronaut, day, seed, noise = 1) {
  const r = createRng(hashSeed(seed, astronaut.id, 'day', day));
  // variación diaria acotada a ±2,2 desviaciones: días normales, sin extremos fortuitos
  const g = () => clamp(r.gauss(), -2.2, 2.2) * noise;
  const b = astronaut.baseline;
  const weekly = Math.sin((2 * Math.PI * day) / 7 + astronaut.hue);
  const adapt = Math.exp(-day / 6); // primeros días: adaptación a la microgravedad
  const sleepH = b.sleepH + METRICS.sleepH.sd * g() - 0.6 * adapt;
  return {
    day,
    hr: b.hr + METRICS.hr.sd * g() + 0.4 * weekly + 3 * adapt,
    hrv: b.hrv * (1 + METRICS.hrv.sdRel * g() - 0.08 * adapt),
    temp: b.temp + METRICS.temp.sd * g(),
    spo2: b.spo2 + METRICS.spo2.sd * g(),
    sleepH,
    sleepQuality: b.sleepQuality + 6 * g() + (sleepH - b.sleepH) * 8,
    activityMin: b.activityMin + 18 * g(),
    context: 'rest',
  };
}

function tidy(e) {
  return {
    day: e.day,
    hr: round(clamp(e.hr, 30, 200), 1),
    hrv: round(clamp(e.hrv, 5, 200), 1),
    temp: round(clamp(e.temp, 34, 41), 2),
    spo2: round(clamp(e.spo2, 80, 100), 1),
    sleepH: round(clamp(e.sleepH, 0, 12), 1),
    sleepQuality: Math.round(clamp(e.sleepQuality, 5, 100)),
    activityMin: Math.round(clamp(e.activityMin, 0, 300)),
    context: e.context,
  };
}

const applies = (s, id) => s.astronautId === '*' || s.astronautId === id;

export function dayEntry(state, id, day) {
  const astronaut = crewById(id);
  const live = [];
  for (const s of state.scenarios) {
    const def = SCENARIOS[s.name];
    if (!def?.effect || !applies(s, id)) continue;
    const k = day - s.startDay;
    if (k < 0 || (def.duration && k >= def.duration)) continue;
    live.push(def.effect(k));
  }
  // Con un escenario activo se atenúa la variación diaria: así lo que se ve
  // en la demo es el escenario y no el azar del día.
  const e = baseDay(astronaut, day, state.seed, live.length ? 0.2 : 1);
  for (const fx of live) {
    e.hr += fx.hr || 0;
    e.hrv *= fx.hrvMul ?? 1;
    e.temp += fx.temp || 0;
    e.spo2 += fx.spo2 || 0;
    e.sleepH += fx.sleepH || 0;
    e.sleepQuality += fx.sleepQuality || 0;
  }
  return tidy(e);
}

function rebuild(state, ids, fromDay) {
  for (const id of ids) {
    const h = state.history[id];
    for (let d = Math.max(1, fromDay); d <= state.day; d++) h[d - 1] = dayEntry(state, id, d);
  }
}

export function createMission({ seed = DEFAULT_SEED, day = START_DAY } = {}) {
  const state = { seed, day, history: {}, scenarios: [], pending: {}, checks: {} };
  for (const a of CREW) {
    state.history[a.id] = [];
    state.checks[a.id] = [];
    state.pending[a.id] = {};
    for (let d = 1; d <= day; d++) state.history[a.id].push(dayEntry(state, a.id, d));
  }
  return state;
}

const allIds = () => CREW.map((a) => a.id);

export function injectScenario(state, name, astronautId) {
  const def = SCENARIOS[name];
  if (!def) return false;
  if (def.acute) {
    state.pending[astronautId] = { ...state.pending[astronautId], [name]: true };
    return true;
  }
  const target = def.scope === 'crew' ? '*' : astronautId;
  if (state.scenarios.some((s) => s.name === name && s.astronautId === target)) return false;
  const startDay = Math.max(1, state.day - (def.backdate || 0));
  state.scenarios.push({ name, astronautId: target, startDay });
  rebuild(state, target === '*' ? allIds() : [astronautId], startDay);
  return true;
}

export function removeScenario(state, name, astronautId) {
  const def = SCENARIOS[name];
  if (!def) return;
  if (def.acute) {
    if (state.pending[astronautId]) delete state.pending[astronautId][name];
    return;
  }
  const target = def.scope === 'crew' ? '*' : astronautId;
  const hit = state.scenarios.find((s) => s.name === name && s.astronautId === target);
  if (!hit) return;
  state.scenarios = state.scenarios.filter((s) => s !== hit);
  rebuild(state, target === '*' ? allIds() : [astronautId], hit.startDay);
}

// Quita todos los escenarios (de una persona, o de todos si no se indica).
export function clearScenarios(state, astronautId) {
  const gone = state.scenarios.filter((s) => !astronautId || applies(s, astronautId));
  state.scenarios = state.scenarios.filter((s) => !gone.includes(s));
  for (const id of astronautId ? [astronautId] : allIds()) state.pending[id] = {};
  if (gone.length) rebuild(state, allIds(), Math.min(...gone.map((s) => s.startDay)));
}

export function activeScenarios(state, astronautId) {
  const names = state.scenarios.filter((s) => applies(s, astronautId)).map((s) => s.name);
  for (const [k, v] of Object.entries(state.pending[astronautId] || {})) if (v) names.push(k);
  return names;
}

export function advanceDays(state, n = 1) {
  for (let i = 0; i < n; i++) {
    state.day += 1;
    state.scenarios = state.scenarios.filter((s) => {
      const d = SCENARIOS[s.name].duration;
      return !d || state.day - s.startDay < d;
    });
    for (const id of allIds()) {
      state.history[id][state.day - 1] = dayEntry(state, id, state.day);
      state.pending[id] = {};
    }
  }
}

export const historyBefore = (state, id, day = state.day) => state.history[id].filter((d) => d.day < day);
export const todayEntry = (state, id) => state.history[id][state.day - 1];
const cabinFault = (state) => state.scenarios.some((s) => s.name === 'cabin');

/* --------------------------------------------------------- el chequeo -- */

// Genera lo que «verían» los sensores en este chequeo.
export function simulateCheck(state, id, { attempt = 1 } = {}) {
  const astronaut = crewById(id);
  const entry = todayEntry(state, id);
  const pending = state.pending[id] || {};
  const nth = (state.checks[id] || []).length;
  const rng = createRng(hashSeed(state.seed, id, 'check', state.day, nth, attempt));

  const truth = { hr: entry.hr, hrv: entry.hrv, temp: entry.temp, spo2: entry.spo2 };
  const exercise = !!pending.exercise;
  if (exercise) {
    truth.hr += 36 + 2.5 * rng.gauss();
    truth.hrv *= 0.45 + 0.03 * rng.gauss();
    truth.temp += 0.4 + 0.04 * rng.gauss();
    truth.spo2 -= 0.8;
  }
  const watch = {
    activeMin10: exercise ? 9 : Math.round(rng.next()),
    cadence: exercise ? 24 : 0,
    lying: false,
    hour: 9,
    hrWatch: Math.round(truth.hr + rng.gauss()),
    hrRest: Math.round(mean(state.history[id].slice(-15, -1).map((d) => d.hr))),
  };
  const contact = pending.sensor && attempt === 1 ? 'poor' : 'good';
  const ecg = synthECG({ hr: truth.hr, hrv: truth.hrv, durationS: 20, fs: 250, rng, contact });
  const ppg = synthPPG({ beats: ecg.beats, rr: ecg.rr, spo2: truth.spo2, durationS: 8, fs: 50, rng });
  const cabin = cabinEnv({ rng, fault: cabinFault(state) });
  const wobble = rng.next() * 6;
  const temp = [];
  for (let i = 0; i <= 40; i++) {
    const t = i * 0.1;
    temp.push({ t, ...tempSensor({ core: truth.temp, distanceMm: distanceAt(t, wobble), ambientC: cabin.tempC, rng }) });
  }
  return { astronautId: id, day: state.day, attempt, astronaut, entry, exercise, contact, watch, ecg, ppg, temp, cabin };
}

// Mide sobre las señales con los algoritmos reales.
export function measureCheck(sim) {
  const peaks = detectRPeaks(sim.ecg.samples, sim.ecg.fs);
  const heart = heartMetrics(peaks);
  const quality = signalQuality(sim.ecg.samples, sim.ecg.fs, sim.ecg.samples.length, peaks);
  const ox = estimateSpO2(sim.ppg.ir, sim.ppg.red, sim.ppg.fs);
  const valid = sim.temp.filter((s) => s.valid).slice(-12);
  return {
    hr: heart.hr, hrv: heart.hrv, spo2: ox.spo2, perfusion: ox.perfusion,
    temp: valid.length ? mean(valid.map((s) => s.estimate)) : null,
    quality, beats: peaks.length, reliable: quality >= THRESHOLDS.quality && heart.hr != null && heart.hrv != null,
  };
}

// Analiza y guarda el chequeo. `now` (ms) lo pone quien llama.
export function finishCheck(state, sim, measured, now = 0) {
  const id = sim.astronautId;
  const context = classifyContext(sim.watch);
  const today = {
    hr: round(measured.hr, 1), hrv: round(measured.hrv, 1), temp: round(measured.temp, 2), spo2: round(measured.spo2, 1),
    sleepH: sim.entry.sleepH, sleepQuality: sim.entry.sleepQuality,
  };
  const analysis = analyze({
    astronaut: sim.astronaut, history: historyBefore(state, id), today, context,
    cabin: sim.cabin, quality: measured.quality, seed: state.seed,
  });
  const check = {
    id: `${id}-${state.day}-${(state.checks[id] || []).length + 1}`,
    astronautId: id, day: state.day, at: now, attempt: sim.attempt,
    quality: round(measured.quality, 2),
    context: { context: context.context, confidence: round(context.confidence, 2), evidence: context.evidence },
    measured: { hr: today.hr, hrv: today.hrv, temp: today.temp, spo2: today.spo2 },
    watch: { sleepH: today.sleepH, sleepQuality: today.sleepQuality, activityMin: sim.entry.activityMin },
    cabin: { tempC: round(sim.cabin.tempC, 1), humidity: Math.round(sim.cabin.humidity), pressure: Math.round(sim.cabin.pressure), co2: Math.round(sim.cabin.co2) },
    analysis,
  };
  (state.checks[id] ||= []).push(check);
  if (state.checks[id].length > 30) state.checks[id].shift();
  state.pending[id] = {}; // lo puntual (ejercicio, mal contacto) ya ha pasado
  return check;
}

// Análisis de los datos de hoy sin guardar nada (para «Por dentro»).
export function previewCheck(state, id) {
  const sim = simulateCheck(state, id, { attempt: 2 });
  const measured = measureCheck(sim);
  const context = classifyContext(sim.watch);
  const today = {
    hr: round(measured.hr, 1), hrv: round(measured.hrv, 1), temp: round(measured.temp, 2), spo2: round(measured.spo2, 1),
    sleepH: sim.entry.sleepH, sleepQuality: sim.entry.sleepQuality,
  };
  const analysis = analyze({
    astronaut: sim.astronaut, history: historyBefore(state, id), today, context,
    cabin: sim.cabin, quality: measured.quality, seed: state.seed,
  });
  return { today, context, cabin: sim.cabin, watch: sim.watch, analysis, measured };
}

// Un mal contacto se resuelve repitiendo: se descarta el intento y se reintenta.
export function failAttempt(state, id) {
  if (state.pending[id]) delete state.pending[id].sensor;
}

// Chequeo completo sin animación (oficial médico, laboratorio, tests).
export function instantCheck(state, id, now = 0) {
  let sim = simulateCheck(state, id, { attempt: 1 });
  let measured = measureCheck(sim);
  let retried = false;
  if (!measured.reliable) {
    failAttempt(state, id);
    sim = simulateCheck(state, id, { attempt: 2 });
    measured = measureCheck(sim);
    retried = true;
  }
  const check = finishCheck(state, sim, measured, now);
  return { check, retried };
}
