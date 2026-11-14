// Estado de la demo: un objeto plano, serializable, guardado en localStorage.
// Contrato (ver SPEC): getState, update, subscribe, currentAstronaut, missionDay,
// physioHistory, latestCheck. `state.psych[astronautId]` es del módulo de psicología.

import { CREW, crewById } from './engine/crew.js';
import { createMission, DEFAULT_SEED, START_DAY } from './engine/mission.js';
import { lightMinutes } from './engine/link.js';
import { t } from './i18n.js';

const KEY = 'xpaze-demo-v1';
const VERSION = 1;

const storage = {
  get() { try { return globalThis.localStorage?.getItem(KEY) ?? null; } catch { return null; } },
  set(v) { try { globalThis.localStorage?.setItem(KEY, v); } catch { /* sin almacenamiento */ } },
  del() { try { globalThis.localStorage?.removeItem(KEY); } catch { /* sin almacenamiento */ } },
};

function initialState() {
  return {
    v: VERSION,
    ...createMission({ seed: DEFAULT_SEED, day: START_DAY }), // seed, day, history, scenarios, pending, checks
    astronautId: null,
    onboarded: false,
    link: { distanceMkm: 225, delayMin: lightMinutes(225), queue: [] },
    psych: {},
  };
}

function load() {
  const raw = storage.get();
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (s?.v !== VERSION || !s.history || !s.checks) return null;
    s.psych ||= {};
    return s;
  } catch { return null; }
}

let state = load() || initialState();
const listeners = new Set();

function notify() {
  for (const fn of [...listeners]) {
    try { fn(state); } catch (e) { console.error(e); }
  }
}

export function getState() { return state; }

export function update(fn) {
  fn(state);
  storage.set(JSON.stringify(state));
  notify();
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Vuelve al principio (borra también lo guardado por el módulo de psicología).
export function reset() {
  storage.del();
  state = initialState();
  storage.set(JSON.stringify(state));
  notify();
  return state;
}

function describe(a) {
  return a && {
    id: a.id, name: a.name, role: t(a.roleKey), roleKey: a.roleKey,
    initials: a.initials, uid: a.uid, hue: a.hue, baseline: { ...a.baseline },
  };
}

export function crew() { return CREW.map(describe); }
export function astronaut(id) { return describe(crewById(id)); }
export function currentAstronaut() { return describe(crewById(state.astronautId)); }
export function missionDay() { return state.day; }

// [{ day, hr, hrv, temp, spo2, sleepH, sleepQuality, activityMin, context }] hasta hoy incluido.
export function physioHistory(astronautId) {
  return (state.history[astronautId] || []).map((d) => ({ ...d }));
}

export function latestCheck(astronautId) {
  const list = state.checks[astronautId] || [];
  return list.length ? list[list.length - 1] : null;
}

export function todayCheck(astronautId) {
  const c = latestCheck(astronautId);
  return c && c.day === state.day ? c : null;
}
