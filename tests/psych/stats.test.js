import test from 'node:test';
import assert from 'node:assert/strict';
import { baseline, median, mad, ewma, robustZ, analyzeMetric } from '../../src/demo/psych/engine/index.js';
const points = values => values.map((value, i) => ({ day: i + 1, value }));

test('median and MAD resist one extreme observation; EWMA uses the injected weight', () => {
  assert.equal(median([10, 9, 11, 10, 1000]), 10);
  assert.equal(mad([10, 9, 11, 10, 1000]), 1);
  assert.equal(ewma([10, 20, 30], 0.5), 22.5);
  assert.equal(median([]), null);
  assert.equal(ewma([]), null);
  assert.throws(() => ewma([1], 0), RangeError);
});

test('constant and missing baselines never produce Infinity or NaN', () => {
  const reference = baseline(Array(7).fill(100), { scaleFloor: 5 });
  assert.equal(reference.ready, true);
  assert.equal(reference.mad, 0);
  assert.equal(robustZ(110, reference), 2);
  assert.equal(baseline([null, NaN, Infinity, '1']).count, 0);
  assert.equal(robustZ(100, baseline([])), null);
  assert.throws(() => baseline([1], { scaleFloor: 0 }), RangeError);
});

test('baseline is personal and requires seven distinct days', () => {
  const a = analyzeMetric(points([...Array(7).fill(100), 120, 120, 120]), { scaleFloor: 5 });
  const b = analyzeMetric(points([...Array(7).fill(120), 120, 120, 120]), { scaleFloor: 5 });
  assert.equal(a.sustained, true);
  assert.equal(b.sustained, false);
  assert.equal(a.percent, 20);
  assert.equal(analyzeMetric(Array(10).fill({ day: 1, value: 1 })).baseline.ready, false);
});

test('an isolated spike does not trigger a sustained change or contaminate baseline', () => {
  const result = analyzeMetric(points([...Array(7).fill(100), 500, 100]), { scaleFloor: 5 });
  assert.equal(result.sustained, false);
  assert.equal(result.days, 0);
  assert.equal(result.baseline.ewma, 100);
  assert.equal(result.baseline.median, 100);
});

test('three consecutive adverse days trigger; gaps and stale observations break the run', () => {
  const initial = points([...Array(7).fill(100), 120, 120, 120]);
  assert.equal(analyzeMetric(initial, { scaleFloor: 5 }).days, 3);
  assert.equal(analyzeMetric(initial, { scaleFloor: 5, asOf: 11 }).sustained, false);
  const gap = initial.map(point => ({ ...point, day: point.day === 10 ? 11 : point.day }));
  assert.equal(analyzeMetric(gap, { scaleFloor: 5 }).days, 1);
  assert.equal(analyzeMetric(initial, { scaleFloor: 5, asOf: 9 }).days, 2);
});

test('duplicates and ordering cannot fabricate sustained days; inputs stay unchanged', () => {
  const original = [...points(Array(7).fill(100)), { day: 8, value: 120 }, { day: 8, value: 120 }, { day: 8, value: 120 }].reverse();
  const before = structuredClone(original);
  assert.equal(analyzeMetric(original, { scaleFloor: 5 }).days, 1);
  assert.deepEqual(original, before);
});

test('lower values can be adverse and sustained changes do not train themselves away', () => {
  const result = analyzeMetric(points([...Array(7).fill(8), ...Array(40).fill(5)]), { direction: -1, scaleFloor: 0.5 });
  assert.equal(result.days, 40);
  assert.equal(result.baseline.median, 8);
  assert.equal(result.baseline.ewma, 8);
});
