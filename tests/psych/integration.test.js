import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, summary, contribute, physiologicalStress, generateHistory, applyScenario, onScenario,
  PROFILES, SCENARIOS, setSharing, writeJournal } from '../../src/demo/psych/engine/index.js';
const stateOf = (record, extra = {}) => ({ psych: { eva: record }, ...extra });
const deepFreeze = value => {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(deepFreeze); }
  return value;
};

test('no data, warm-up, normal data, and stale records have explicit statuses', () => {
  assert.equal(analyze({}, 'eva').status, 'nodata');
  assert.equal(analyze(stateOf(generateHistory('eva', { days: 7 })), 'eva').status, 'nodata');
  const record = generateHistory('eva', { days: 14 });
  assert.equal(analyze(stateOf(record), 'eva').status, 'ok');
  assert.equal(analyze(stateOf(record, { missionDay: 15 }), 'eva').status, 'nodata');
});

test('a spike stays ok, three days cause watch, multiple domains lasting four days cause alert', () => {
  const initial = generateHistory('eva', { days: 14, profile: 0 });
  assert.equal(analyze(stateOf(applyScenario(initial, 'poor-sleep', { duration: 1 })), 'eva').status, 'ok');
  assert.equal(analyze(stateOf(applyScenario(initial, 'poor-sleep', { duration: 3 })), 'eva').status, 'watch');
  assert.equal(analyze(stateOf(applyScenario(initial, 'poor-sleep', { duration: 4 })), 'eva').status, 'alert');
});

test('HR and HRV use personal resting baselines and exclude exercise and unknown contexts', () => {
  const initial = generateHistory('eva', { days: 14, profile: 0 });
  const stressed = applyScenario(initial, 'sustained-stress', { duration: 4 });
  const result = physiologicalStress(stressed.physioHistory);
  assert.equal(result.sustained, true);
  assert.equal(result.days, 4);
  assert.ok(result.value > 0 && result.value <= 100);
  const exercise = stressed.physioHistory.map(row => row.day > 14 ? { ...row, context: 'exercise' } : row);
  assert.equal(physiologicalStress(exercise).value, null);
  assert.equal(physiologicalStress(exercise).sustained, false);
  assert.equal(physiologicalStress(stressed.physioHistory.map(row => ({ ...row, context: 'unknown' }))).ready, false);
  assert.equal(physiologicalStress([{ day: 1, hr: 0, hrv: 0, context: 'rest' }]).ready, false);
  assert.equal(physiologicalStress([]).value, null);
});

test('core-shaped physiology can be injected without any core dependency; self-reported sleep wins', () => {
  const generated = generateHistory('eva', { days: 14 });
  const state = stateOf({ ...generated, physioHistory: [] });
  const physiology = generated.physioHistory.map(row => ({ ...row, sleepH: 1 }));
  const result = analyze(state, 'eva', { physioHistory: physiology, day: 14 });
  assert.equal(result.physiology.ready, true);
  assert.equal(result.metrics.sleepHours.latest.value, generated.daily.at(-1).sleep.hours);
  const watchOnly = analyze({}, 'eva', { physioHistory: generated.physioHistory, day: 14 });
  assert.equal(watchOnly.metrics.sleepHours.baseline.ready, true);
});

test('four profiles and all six scenarios are deterministic and serializable', () => {
  const profiles = PROFILES.map((_, profile) => generateHistory('eva', { seed: 17, days: 28, profile }));
  assert.equal(new Set(profiles.map(record => analyze(stateOf(record), 'eva').metrics.reaction.baseline.median)).size, 4);
  for (let profile = 0; profile < 4; profile++) {
    assert.equal(analyze(stateOf(profiles[profile]), 'eva').status, 'ok');
    for (const scenario of SCENARIOS) {
      const options = { seed: 17, days: 28, profile, scenario };
      const record = generateHistory('eva', options);
      assert.deepEqual(record, generateHistory('eva', options));
      assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
      const result = analyze(stateOf(record), 'eva');
      assert.equal(result.status, scenario === 'recovery' ? 'ok' : 'alert', `${profile}: ${scenario}`);
    }
  }
  assert.notDeepEqual(generateHistory('eva', { seed: 1 }), generateHistory('eva', { seed: 2 }));
});

test('scenarios explain their distinct patterns and offer suitable actions', () => {
  const expected = {
    'poor-sleep': ['reaction', 'sleep'], 'sustained-stress': ['physiology', 'breathe'],
    isolation: ['isolation', 'connect'], 'crew-conflict': ['cohesion', 'connect'], workload: ['workload', 'rebalance'],
  };
  for (const [scenario, [factorId, action]] of Object.entries(expected)) {
    const result = analyze(stateOf(generateHistory('eva', { scenario })), 'eva');
    assert.ok(result.factors.some(factor => factor.id === factorId), scenario);
    assert.ok(result.suggestions.some(item => item.id === action), scenario);
    assert.ok(result.suggestions.some(item => item.id === 'medical'));
    assert.ok(result.suggestions.some(item => item.id === 'earth'));
  }
  const sleep = analyze(stateOf(generateHistory('eva', { scenario: 'poor-sleep', scenarioDays: 4 })), 'eva');
  const factor = sleep.factors.find(item => item.id === 'reaction');
  assert.equal(factor.key, 'psych.factor.reactionSleep');
  assert.equal(factor.vars.days, 4);
  assert.equal(factor.vars.nights, 4);
  assert.ok(factor.vars.percent > 0);
});

test('recovery clears every scenario without erasing the historical signal', () => {
  for (const scenario of SCENARIOS.filter(id => id !== 'recovery')) {
    const initial = generateHistory('eva', { scenario });
    const recovered = applyScenario(initial, 'recovery', { duration: 7 });
    assert.equal(analyze(stateOf(recovered), 'eva').status, 'ok', scenario);
    assert.equal(analyze(stateOf(recovered), 'eva', { day: 28 }).status, 'alert', scenario);
    assert.deepEqual(recovered.daily.slice(0, 28), initial.daily);
  }
});

test('privacy defaults expose only aggregate status, even when sustained changes exist', () => {
  const record = writeJournal(generateHistory('eva', { scenario: 'isolation' }), { id: 'j1', day: 28, text: 'UNIQUE PRIVATE TEXT' });
  const state = stateOf(record);
  const output = summary(state, 'eva');
  assert.deepEqual(output, { status: 'alert', label: 'psych.status.alert', factors: [], shared: true });
  assert.deepEqual(contribute(state, 'eva'), []);
  assert.ok(!JSON.stringify(output).includes('UNIQUE PRIVATE TEXT'));
});

test('opt-in details follow their allowlist; journal never leaves; master switch blocks all sharing', () => {
  const initial = writeJournal(generateHistory('eva', { scenario: 'poor-sleep' }), { id: 'j1', day: 28, text: 'UNIQUE PRIVATE TEXT' });
  const record = setSharing(initial, { factors: true, vigilance: true });
  const state = stateOf(record);
  const output = summary(state, 'eva');
  assert.ok(output.factors.length > 0);
  assert.ok(output.metrics.reaction);
  assert.equal(output.metrics.valence, undefined);
  assert.equal(output.metrics.sleepHours, undefined);
  assert.deepEqual(contribute(state, 'eva'), output.factors);
  const all = setSharing(initial, Object.fromEntries(Object.keys(initial.sharing).map(key => [key, true])));
  assert.ok(!JSON.stringify(summary(stateOf(all), 'eva')).includes('UNIQUE PRIVATE TEXT'));
  assert.equal(summary(stateOf(all), 'eva').journal, undefined);
  const hidden = stateOf(setSharing(record, { aggregate: false }));
  assert.deepEqual(summary(hidden, 'eva'), { status: 'nodata', label: 'psych.status.private', factors: [], shared: false });
  assert.deepEqual(contribute(hidden, 'eva'), []);
});

test('analysis, sharing, and scenario helpers accept frozen input without mutation', () => {
  const record = deepFreeze(generateHistory('eva', { days: 14 }));
  const state = deepFreeze(stateOf(record));
  const before = JSON.stringify(state);
  analyze(state, 'eva'); summary(state, 'eva'); contribute(state, 'eva');
  applyScenario(record, 'isolation'); onScenario(state, 'workload', 'eva');
  assert.equal(JSON.stringify(state), before);
  assert.throws(() => applyScenario(record, 'unknown'), RangeError);
});

test('laboratory injection is visible on the current mission day without changing core state', () => {
  const state = stateOf(generateHistory('eva', { days: 28 }), { missionDay: 28, unrelated: { retained: true } });
  const next = onScenario(state, 'poor-sleep', 'eva');
  assert.equal(next.missionDay, 28);
  assert.equal(next.unrelated, state.unrelated);
  assert.equal(next.psych.eva.daily.at(-1).day, 28);
  assert.equal(analyze(next, 'eva').status, 'alert');
  assert.equal(analyze(state, 'eva').status, 'ok');
  const early = onScenario({ missionDay: 2 }, 'poor-sleep', 'eva');
  assert.equal(early.psych.eva.daily.length, 2);
  assert.equal(analyze(early, 'eva').status, 'nodata');
});

test('a single strongly changed domain escalates only after five sustained days', () => {
  const initial = generateHistory('eva', { days: 14, profile: 0 });
  for (const duration of [1, 3, 5]) {
    const record = applyScenario(initial, 'sustained-stress', { duration });
    record.physioHistory = initial.physioHistory;
    const result = analyze(stateOf(record), 'eva');
    assert.equal(result.status, duration === 1 ? 'ok' : duration === 3 ? 'watch' : 'alert');
  }
});
