import { analyzeMetric, finite } from './stats.js';
import { createPsychRecord, DEFAULT_SHARING, scoreSocial } from './model.js';
import { scoreVigilance } from './vigilance.js';

// Prototype thresholds, not clinical cutoffs. Scale floors prevent division by zero
// and avoid treating tiny changes in a nearly constant personal history as large signals.
export const METRICS = Object.freeze({
  valence: { direction: -1, scaleFloor: 0.75, domain: 'mood' },
  energy: { direction: -1, scaleFloor: 0.75, domain: 'mood' },
  tension: { direction: 1, scaleFloor: 0.75, domain: 'mood' },
  sleepHours: { direction: -1, scaleFloor: 0.5, domain: 'sleep' },
  sleepQuality: { direction: -1, scaleFloor: 0.75, domain: 'sleep' },
  fatigue: { direction: 1, scaleFloor: 0.75, domain: 'sleep' },
  workload: { direction: 1, scaleFloor: 0.75, domain: 'workload' },
  cohesion: { direction: -1, scaleFloor: 0.4, domain: 'social' },
  isolation: { direction: 1, scaleFloor: 0.4, domain: 'social' },
  reaction: { direction: 1, scaleFloor: 20, domain: 'vigilance' },
  lapses: { direction: 1, scaleFloor: 1, domain: 'vigilance' },
  falseStarts: { direction: 1, scaleFloor: 1, domain: 'vigilance' },
});

function rest(row) {
  const context = typeof row.context === 'string' ? row.context : row.context?.type ?? row.context?.activity;
  return ['rest', 'resting', 'reposo'].includes(context);
}
export function physiologicalStress(history = [], { day } = {}) {
  const asOf = day ?? Math.max(0, ...history.map(row => Number.isInteger(row.day) ? row.day : 0));
  // Both measurements must be usable, from the same explicit resting observation.
  const resting = history.filter(row => rest(row) && finite(row.hr) && row.hr > 0 && finite(row.hrv) && row.hrv > 0);
  const hr = analyzeMetric(resting.map(row => ({ day: row.day, value: row.hr })), { direction: 1, scaleFloor: 3, asOf });
  const hrv = analyzeMetric(resting.map(row => ({ day: row.day, value: row.hrv })), { direction: -1, scaleFloor: 5, asOf });
  const ready = hr.current && hrv.current && hr.latest?.z !== null && hrv.latest?.z !== null;
  const value = ready ? Math.round(Math.min(100, (Math.max(0, hr.latest.z) + Math.max(0, -hrv.latest.z)) / 12 * 100)) : null;
  return { value, ready, hr, hrv, days: Math.min(hr.days, hrv.days), sustained: hr.sustained && hrv.sustained,
    explanation: { key: 'psych.physiology.method', vars: {} } };
}

function dayFor(state, record, history, override) {
  if (Number.isInteger(override)) return override;
  if (Number.isInteger(state.missionDay)) return state.missionDay;
  return Math.max(0, ...[...record.daily, ...record.vigilance, ...history].map(row => Number.isInteger(row.day) ? row.day : 0));
}

export function suggestCountermeasures(factors = []) {
  const domains = new Set(factors.map(factor => factor.domain));
  const ids = new Set();
  if (domains.has('mood') || domains.has('physiology')) ids.add('breathe');
  if (domains.has('vigilance') || domains.has('workload')) ids.add('pause');
  if (domains.has('sleep') || domains.has('vigilance')) ids.add('sleep');
  if (domains.has('social')) ids.add('connect');
  if (domains.has('workload')) ids.add('rebalance');
  if (factors.length) { ids.add('medical'); ids.add('earth'); }
  if (!ids.size) ids.add('routine');
  return [...ids].map(id => ({ id, titleKey: `psych.countermeasure.${id}.title`, key: `psych.countermeasure.${id}.body`, vars: {} }));
}

// Private analysis. Never send this result to the crew dashboard or communications queue.
// The core adapter supplies physioHistory(id) here; the engine imports no core modules.
export function analyze(state, astronautId, { physioHistory, day } = {}) {
  const record = state.psych?.[astronautId] ?? createPsychRecord();
  const history = physioHistory ?? record.physioHistory ?? [];
  const asOf = dayFor(state, record, history, day);
  const points = Object.fromEntries(Object.keys(METRICS).map(key => [key, []]));
  const push = (key, day, value) => points[key].push({ day, value });
  // Watch sleep is fallback only; a self-report for the same day takes precedence.
  for (const row of history) if (finite(row.sleepH) && row.sleepH >= 0 && row.sleepH <= 24) push('sleepHours', row.day, row.sleepH);
  for (const row of record.daily) {
    for (const key of ['valence', 'energy', 'tension']) push(key, row.day, row.mood?.[key]);
    push('sleepHours', row.day, row.sleep?.hours);
    push('sleepQuality', row.day, row.sleep?.quality);
    push('fatigue', row.day, row.sleep?.fatigue);
    push('workload', row.day, row.workload);
    const social = scoreSocial(row.social?.answers);
    for (const key of ['cohesion', 'isolation']) push(key, row.day, social[key]);
  }
  for (const row of record.vigilance) {
    const score = scoreVigilance(row.trials);
    // Empty/invalid sessions do not provide evidence of normal attention.
    if (score.validResponses + score.omissions + score.falseStarts === 0) continue;
    push('reaction', row.day, score.meanMs);
    push('lapses', row.day, score.lapses);
    push('falseStarts', row.day, score.falseStarts);
  }
  const metrics = Object.fromEntries(Object.entries(METRICS).map(([key, options]) => [key, analyzeMetric(points[key], { ...options, asOf })]));
  const factors = [];
  for (const [id, metric] of Object.entries(metrics)) {
    if (!metric.sustained) continue;
    factors.push({ id, domain: METRICS[id].domain, key: `psych.factor.${id}`,
      vars: { days: metric.days, percent: Math.abs(metric.percent), value: Math.round(metric.latest.value * 10) / 10,
        baseline: Math.round(metric.latest.baseline.median * 10) / 10 },
      days: metric.days, strength: Math.abs(metric.latest.z) });
  }
  const physiology = physiologicalStress(history, { day: asOf });
  if (physiology.sustained) factors.push({ id: 'physiology', domain: 'physiology', key: 'psych.factor.physiology',
    vars: { days: physiology.days, value: physiology.value }, days: physiology.days,
    strength: Math.min(physiology.hr.latest.z, -physiology.hrv.latest.z) });
  const sleep = metrics.sleepHours;
  let shortNights = 0;
  for (let i = sleep.observations.length - 1, expected = asOf; i >= 0; i--, expected--) {
    const row = sleep.observations[i];
    if (row.day !== expected || row.value >= 6) break;
    shortNights++;
  }
  // Add concrete sleep context to a sustained reaction change; never a standalone population alarm.
  if (metrics.reaction.sustained && shortNights >= 3) {
    const factor = factors.find(item => item.id === 'reaction');
    factor.key = 'psych.factor.reactionSleep';
    factor.vars.nights = shortNights;
  }
  const available = Object.values(metrics).some(metric => metric.current && metric.latest?.z != null) || physiology.ready;
  const domains = new Set(factors.map(factor => factor.domain));
  const alert = (domains.size >= 2 && factors.some(factor => factor.days >= 4))
    || factors.some(factor => factor.days >= 5 && factor.strength >= 3);
  const status = !available ? 'nodata' : alert ? 'alert' : factors.length ? 'watch' : 'ok';
  return { status, label: `psych.status.${status}`, day: asOf, factors, metrics, physiology,
    suggestions: status === 'nodata' ? [] : suggestCountermeasures(factors),
    notices: ['psych.notice.simulated', 'psych.notice.notDiagnostic', 'psych.notice.rules'] };
}

// Privacy boundary for officer and Earth views. No free text or raw records can pass.
export function summary(state, astronautId, options = {}) {
  const record = state.psych?.[astronautId];
  const sharing = { ...DEFAULT_SHARING, ...record?.sharing };
  if (!sharing.aggregate) return { status: 'nodata', label: 'psych.status.private', factors: [], shared: false };
  const result = analyze(state, astronautId, options);
  const output = { status: result.status, label: result.label, factors: sharing.factors ? result.factors : [], shared: true };
  const sharedMetrics = {};
  for (const [id, metric] of Object.entries(result.metrics)) {
    if (sharing[METRICS[id].domain] && metric.current) sharedMetrics[id] = { value: metric.latest.value,
      baseline: metric.latest.baseline.median, days: metric.days, sustained: metric.sustained };
  }
  if (sharing.physiology) sharedMetrics.physiology = { value: result.physiology.value, days: result.physiology.days };
  if (sharing.breathing) sharedMetrics.breathing = { completedSessions: (record?.breathing ?? []).filter(row => row.completed && row.day <= result.day).length };
  if (Object.keys(sharedMetrics).length) output.metrics = sharedMetrics;
  return output;
}
export function contribute(state, astronautId, options = {}) {
  return summary(state, astronautId, options).factors;
}
