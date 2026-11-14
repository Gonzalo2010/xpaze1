import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreVigilance, planStimuli, createRng } from '../../src/demo/psych/engine/index.js';

test('scores valid reaction times, including the exact 355 ms lapse boundary (PVT-B)', () => {
  const score = scoreVigilance([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  assert.equal(scoreVigilance([355, 356]).lapses, 1);
  assert.equal(score.meanMs, 550);
  assert.equal(score.medianMs, 550);
  assert.equal(score.slowest10Ms, 1000);
  assert.equal(score.lapses, 7);
  assert.equal(score.validResponses, 10);
});

test('anticipations, false starts, invalid data and timeouts never inflate reaction averages', () => {
  const score = scoreVigilance([-20, 0, 99, { falseStart: true, reactionMs: 200 }, { timeout: true }, { reactionMs: 250 }, null, NaN, Infinity]);
  assert.equal(score.falseStarts, 4);
  assert.equal(score.lapses, 1);
  assert.equal(score.omissions, 1);
  assert.equal(score.meanMs, 250);
  assert.equal(score.invalid, 3);
  assert.equal(score.trials, 9);
});

test('empty tests have no timing score and the slowest tenth rounds up', () => {
  assert.equal(scoreVigilance([]).meanMs, null);
  assert.equal(scoreVigilance([{ timeout: true }]).medianMs, null);
  assert.equal(scoreVigilance(Array.from({ length: 11 }, (_, i) => 100 + i * 10)).slowest10Ms, 195);
});

test('stimulus schedules are reproducible, bounded, and differ across seeds', () => {
  const options = { seed: 'eva', count: 100, minIntervalMs: 2000, maxIntervalMs: 5000 };
  const plan = planStimuli(options);
  assert.deepEqual(plan, planStimuli(options));
  assert.notDeepEqual(plan, planStimuli({ ...options, seed: 'leo' }));
  assert.ok(plan.every((item, i) => item.index === i && item.delayMs >= 2000 && item.delayMs <= 5000));
  assert.throws(() => planStimuli({ minIntervalMs: 500, maxIntervalMs: 100 }), RangeError);
  const a = createRng(0), b = createRng(0);
  for (let i = 0; i < 100; i++) { const value = a(); assert.equal(value, b()); assert.ok(value >= 0 && value < 1); }
});
