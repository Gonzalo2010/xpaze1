export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function median(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  const n = sorted.length;
  return n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null;
}
export function mad(values, center = median(values)) {
  return center === null ? null : median(values.filter(finite).map(value => Math.abs(value - center)));
}
export function ewma(values, alpha = 0.2) {
  if (!(alpha > 0 && alpha <= 1)) throw new RangeError('alpha must be in (0, 1]');
  return values.filter(finite).reduce((previous, value) => previous === null ? value : alpha * value + (1 - alpha) * previous, null);
}
export function robustZ(value, baseline) {
  return finite(value) && baseline?.scale > 0 ? (value - baseline.median) / baseline.scale : null;
}
export function baseline(values, { minSamples = 7, scaleFloor = 1, alpha = 0.2 } = {}) {
  if (!(scaleFloor > 0) || !Number.isInteger(minSamples) || minSamples < 1) throw new RangeError('Invalid baseline options');
  const clean = values.filter(finite);
  const center = median(clean);
  const deviation = mad(clean, center);
  return { ready: clean.length >= minSamples, count: clean.length, median: center, mad: deviation,
    scale: center === null ? null : Math.max(scaleFloor, 1.4826 * deviation), ewma: ewma(clean, alpha) };
}

// One observation per mission day. The last valid observation wins; never mutate input.
export function dailyPoints(points, asOf = Infinity) {
  const days = new Map();
  for (const point of points) {
    if (Number.isInteger(point.day) && point.day >= 1 && point.day <= asOf && finite(point.value)) days.set(point.day, { ...point });
  }
  return [...days.values()].sort((a, b) => a.day - b.day);
}

// Warm-up requires seven distinct days. Deviations do not train themselves into normality.
// EWMA tracks accepted observations; median/MAD use the last 28 accepted days.
export function analyzeMetric(points, { direction = 1, scaleFloor = 1, minSamples = 7,
  sustainedDays = 3, threshold = 2, alpha = 0.2, asOf } = {}) {
  if (![1, -1].includes(direction) || !Number.isInteger(sustainedDays) || sustainedDays < 2 || !(threshold > 0)) throw new RangeError('Invalid change options');
  const sorted = dailyPoints(points, asOf);
  const day = asOf ?? sorted.at(-1)?.day ?? 0;
  let accepted = [], smooth = null, run = [], previousDay = null;
  let reference = baseline([], { minSamples, scaleFloor, alpha });
  const observations = [];
  for (const point of sorted) {
    reference = { ...baseline(accepted, { minSamples, scaleFloor, alpha }), ewma: smooth };
    const z = reference.ready ? robustZ(point.value, reference) : null;
    const adverse = z !== null && direction * z >= threshold;
    if (point.day !== previousDay + 1 || !adverse) run = [];
    if (adverse) run.push(point);
    observations.push({ ...point, z, adverse, baseline: reference });
    if (!reference.ready || Math.abs(z) < threshold) {
      accepted = [...accepted, point.value].slice(-28);
      smooth = smooth === null ? point.value : alpha * point.value + (1 - alpha) * smooth;
    }
    previousDay = point.day;
  }
  const latest = observations.at(-1) ?? null;
  if (latest?.day !== day) run = [];
  const finalBaseline = { ...baseline(accepted, { minSamples, scaleFloor, alpha }), ewma: smooth };
  const percent = run.length && reference.median !== 0
    ? Math.round(100 * (mean(run.map(p => p.value)) - reference.median) / Math.abs(reference.median)) : 0;
  return { baseline: finalBaseline, latest, observations, days: run.length,
    sustained: run.length >= sustainedDays, percent, current: latest?.day === day };
}
