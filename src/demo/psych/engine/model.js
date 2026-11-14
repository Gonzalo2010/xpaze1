import { finite, mean } from './stats.js';

export const SOCIAL_ITEMS = Object.freeze([
  Object.freeze({ id: 'teamSupport', key: 'psych.question.teamSupport', dimension: 'cohesion' }),
  Object.freeze({ id: 'teamVoice', key: 'psych.question.teamVoice', dimension: 'cohesion' }),
  Object.freeze({ id: 'distance', key: 'psych.question.distance', dimension: 'isolation' }),
  Object.freeze({ id: 'connection', key: 'psych.question.connection', dimension: 'isolation' }),
]);
export const DEFAULT_SHARING = Object.freeze({ aggregate: true, factors: false, mood: false,
  vigilance: false, sleep: false, workload: false, social: false, physiology: false, breathing: false });
export function createPsychRecord() {
  return { version: 1, daily: [], vigilance: [], journal: [], breathing: [], physioHistory: [], sharing: { ...DEFAULT_SHARING } };
}
export function scoreSocial(answers = {}) {
  const scores = {};
  for (const dimension of ['cohesion', 'isolation']) {
    const values = SOCIAL_ITEMS.filter(item => item.dimension === dimension).map(item => answers[item.id]);
    scores[dimension] = values.every(value => Number.isInteger(value) && value >= 0 && value <= 4) ? mean(values) : null;
  }
  return scores;
}
const range = (value, min, max, name) => {
  if (!finite(value) || value < min || value > max) throw new RangeError(`Invalid ${name}`);
};
export function assertDay(day) {
  if (!Number.isInteger(day) || day < 1) throw new RangeError('day must be a positive mission day');
}
export function recordDaily(record, entry) {
  assertDay(entry.day);
  if (entry.mood) for (const key of ['valence', 'energy', 'tension']) range(entry.mood[key], 0, 10, key);
  if (entry.sleep) {
    range(entry.sleep.hours, 0, 24, 'hours');
    range(entry.sleep.quality, 0, 10, 'quality');
    range(entry.sleep.fatigue, 0, 10, 'fatigue');
  }
  if (entry.workload !== undefined) range(entry.workload, 0, 10, 'workload');
  if (entry.social && Object.values(scoreSocial(entry.social.answers)).some(value => value === null)) throw new RangeError('Incomplete social answers');
  const previous = record.daily.find(row => row.day === entry.day) ?? {};
  const next = { ...previous, day: entry.day };
  for (const key of ['mood', 'sleep', 'workload', 'social']) if (entry[key] !== undefined) next[key] = structuredClone(entry[key]);
  return { ...record, daily: [...record.daily.filter(row => row.day !== entry.day), next].sort((a, b) => a.day - b.day) };
}
export function recordVigilance(record, { day, trials }) {
  assertDay(day);
  if (!Array.isArray(trials)) throw new TypeError('trials must be an array');
  return { ...record, vigilance: [...record.vigilance.filter(row => row.day !== day), { day, trials: structuredClone(trials) }].sort((a, b) => a.day - b.day) };
}
export function setSharing(record, changes) {
  const sharing = { ...DEFAULT_SHARING, ...record.sharing };
  for (const key of Object.keys(DEFAULT_SHARING)) if (typeof changes[key] === 'boolean') sharing[key] = changes[key];
  return { ...record, sharing };
}
export function writeJournal(record, { id, day, text }) {
  assertDay(day);
  if (typeof id !== 'string' || !id || typeof text !== 'string') throw new TypeError('Journal needs an explicit id and text');
  return { ...record, journal: [...record.journal.filter(row => row.id !== id), { id, day, text }] };
}
export function removeJournal(record, id) {
  return { ...record, journal: record.journal.filter(row => row.id !== id) };
}
export function recordBreathing(record, { id, day, durationSec, completed, inhaleSec = 4, exhaleSec = 6 }) {
  assertDay(day);
  if (typeof id !== 'string' || !id || typeof completed !== 'boolean') throw new TypeError('Invalid breathing session');
  range(durationSec, 0, 3600, 'durationSec');
  range(inhaleSec, 1, 30, 'inhaleSec');
  range(exhaleSec, 1, 30, 'exhaleSec');
  return { ...record, breathing: [...record.breathing.filter(row => row.id !== id), { id, day, durationSec, completed, inhaleSec, exhaleSec }] };
}
