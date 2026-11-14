import { createRng } from './random.js';
import { assertDay, createPsychRecord, recordDaily, recordVigilance } from './model.js';

export const PROFILES = Object.freeze([
  Object.freeze({ id: 'steady', valence: 7, energy: 7, tension: 2, sleep: 7.8, quality: 8, fatigue: 2, workload: 4, reaction: 245, hr: 57, hrv: 72 }),
  Object.freeze({ id: 'reflective', valence: 6, energy: 5.5, tension: 3, sleep: 8.2, quality: 7, fatigue: 3, workload: 4.5, reaction: 290, hr: 64, hrv: 52 }),
  Object.freeze({ id: 'active', valence: 8, energy: 8, tension: 2.5, sleep: 7.2, quality: 7.5, fatigue: 2.5, workload: 5, reaction: 225, hr: 51, hrv: 88 }),
  Object.freeze({ id: 'methodical', valence: 6.5, energy: 6, tension: 3.5, sleep: 7.5, quality: 7, fatigue: 3, workload: 5.5, reaction: 315, hr: 69, hrv: 43 }),
]);
export const SCENARIOS = Object.freeze(['poor-sleep', 'sustained-stress', 'isolation', 'crew-conflict', 'workload', 'recovery']);
const round = value => Math.round(value * 10) / 10;
const clamp = value => Math.max(0, Math.min(10, round(value)));
function selectProfile(astronautId, profile) {
  const selected = profile === undefined ? PROFILES[Math.floor(createRng(astronautId)() * PROFILES.length)]
    : typeof profile === 'number' ? PROFILES[profile] : PROFILES.find(item => item.id === profile);
  if (!selected) throw new RangeError('Unknown simulation profile');
  return selected;
}
function sampleDay(profile, seed, day) {
  const random = createRng(`${seed}:${profile.id}:${day}`);
  const noise = (value, width) => round(value + (random() - 0.5) * width);
  const daily = { day, mood: { valence: noise(profile.valence, 0.6), energy: noise(profile.energy, 0.6), tension: noise(profile.tension, 0.6) },
    sleep: { hours: noise(profile.sleep, 0.4), quality: noise(profile.quality, 0.6), fatigue: noise(profile.fatigue, 0.6) },
    workload: noise(profile.workload, 0.6), social: { answers: { teamSupport: 3, teamVoice: 3, distance: 1, connection: 1 } } };
  const vigilance = { day, trials: Array.from({ length: 10 }, () => Math.round(noise(profile.reaction, 30))) };
  const physiology = { day, hr: noise(profile.hr, 3), hrv: noise(profile.hrv, 5), temp: noise(36.6, 0.2), spo2: 98,
    sleepH: daily.sleep.hours, sleepQuality: daily.sleep.quality, activityMin: 35 + Math.floor(random() * 20), context: 'rest' };
  return { daily, vigilance, physiology };
}

export function generateHistory(astronautId, { seed = 1, days = 28, profile, scenario, scenarioDays = 5 } = {}) {
  if (!Number.isInteger(days) || days < 0 || days > 10000) throw new RangeError('Invalid history length');
  const selected = selectProfile(astronautId, profile);
  let record = { ...createPsychRecord(), simulation: { astronautId: String(astronautId), profile: selected.id, seed } };
  for (let day = 1; day <= days; day++) {
    const sample = sampleDay(selected, `${seed}:${astronautId}`, day);
    record.daily.push(sample.daily);
    record.vigilance.push(sample.vigilance);
    record.physioHistory.push(sample.physiology);
  }
  if (scenario) record = applyScenario(record, scenario, { startDay: Math.max(1, days - scenarioDays + 1), duration: scenarioDays, seed });
  return record;
}

// Appends by default; an explicit startDay replaces only the selected days.
// Existing diary, sharing choices and breathing sessions always remain private and intact.
export function applyScenario(record, name, { startDay, duration = 5, seed = record.simulation?.seed ?? 1 } = {}) {
  if (!SCENARIOS.includes(name)) throw new RangeError('Unknown psychology scenario');
  if (!Number.isInteger(duration) || duration < 1 || duration > 365) throw new RangeError('Invalid scenario duration');
  const first = startDay ?? Math.max(0, ...record.daily.map(row => row.day), ...record.vigilance.map(row => row.day), ...(record.physioHistory ?? []).map(row => row.day)) + 1;
  assertDay(first);
  const profile = selectProfile(record.simulation?.astronautId ?? 'demo', record.simulation?.profile ?? 0);
  const previous = [...record.daily].filter(row => row.day < first).sort((a, b) => a.day - b.day).at(-1);
  const previousPhysio = [...(record.physioHistory ?? [])].filter(row => row.day < first).sort((a, b) => a.day - b.day).at(-1);
  let next = { ...record };
  for (let offset = 0; offset < duration; offset++) {
    const day = first + offset;
    const sample = sampleDay(profile, `${seed}:${record.simulation?.astronautId ?? 'demo'}`, day);
    const daily = structuredClone(record.daily.find(row => row.day === day) ?? sample.daily);
    const physiology = structuredClone((record.physioHistory ?? []).find(row => row.day === day) ?? sample.physiology);
    const vigilance = structuredClone(record.vigilance.find(row => row.day === day) ?? sample.vigilance);
    // Fill missing domains in partial self-reports before applying a demo scenario.
    daily.mood ??= sample.daily.mood;
    daily.sleep ??= sample.daily.sleep;
    daily.social ??= sample.daily.social;
    daily.workload ??= sample.daily.workload;
    if (name === 'poor-sleep') {
      daily.sleep = { hours: 5.1, quality: 3, fatigue: 7.5 };
      daily.mood.energy = clamp(profile.energy - 2.5);
      vigilance.trials = sample.vigilance.trials.map((ms, i) => i < 2 ? 620 + i * 30 : ms + 85);
    }
    if (name === 'sustained-stress') {
      daily.mood.tension = 8;
      physiology.hr = profile.hr + 12;
      physiology.hrv = round(profile.hrv * 0.6);
    }
    if (name === 'isolation') {
      daily.mood.valence = 2.5;
      daily.mood.energy = 3;
      daily.social.answers = { teamSupport: 3, teamVoice: 3, distance: 4, connection: 4 };
    }
    if (name === 'crew-conflict') {
      daily.mood.tension = 7.5;
      daily.social.answers = { teamSupport: 1, teamVoice: 0, distance: 2, connection: 2 };
    }
    if (name === 'workload') {
      daily.workload = 9;
      daily.sleep.fatigue = 8;
      vigilance.trials = sample.vigilance.trials.map(ms => ms + 100);
    }
    if (name === 'recovery') {
      const remaining = Math.max(0, 1 - (offset + 1) / Math.max(1, duration - 2));
      const blend = (normal, old) => round(normal + ((old ?? normal) - normal) * remaining);
      for (const group of ['mood', 'sleep']) for (const key of Object.keys(sample.daily[group])) daily[group][key] = blend(sample.daily[group][key], previous?.[group]?.[key]);
      daily.workload = blend(sample.daily.workload, previous?.workload);
      for (const key of Object.keys(sample.daily.social.answers)) daily.social.answers[key] = Math.round(blend(sample.daily.social.answers[key], previous?.social?.answers?.[key]));
      physiology.hr = blend(sample.physiology.hr, previousPhysio?.hr);
      physiology.hrv = blend(sample.physiology.hrv, previousPhysio?.hrv);
      vigilance.trials = sample.vigilance.trials;
    }
    physiology.sleepH = daily.sleep.hours;
    physiology.sleepQuality = daily.sleep.quality;
    next = recordVigilance(recordDaily(next, daily), vigilance);
    next.physioHistory = [...(next.physioHistory ?? []).filter(row => row.day !== day), physiology].sort((a, b) => a.day - b.day);
  }
  return next;
}

export function onScenario(state, name, astronautId, options = {}) {
  const record = state.psych?.[astronautId] ?? generateHistory(astronautId, {
    days: Number.isInteger(state.missionDay) ? state.missionDay : 14, seed: options.seed ?? 1,
  });
  const currentDay = Number.isInteger(state.missionDay) ? state.missionDay
    : Math.max(1, ...record.daily.map(row => row.day), ...record.vigilance.map(row => row.day), ...(record.physioHistory ?? []).map(row => row.day));
  // Laboratory injection changes recent simulated days, so it is visible immediately.
  // applyScenario remains the lower-level API for explicitly appending future days.
  const duration = options.duration ?? 5;
  const scenarioOptions = { ...options, duration, startDay: options.startDay ?? Math.max(1, currentDay - duration + 1) };
  if (options.startDay === undefined) scenarioOptions.duration = Math.min(duration, currentDay);
  return { ...state, psych: { ...state.psych, [astronautId]: applyScenario(record, name, scenarioOptions) } };
}
