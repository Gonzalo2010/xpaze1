// Estación simulada v2: el ritmo, el pulso y la HRV se CALCULAN de los latidos generados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimBody, analyzeRR } from '../src/app/simbody.js';
import { classify, co2Level } from '../src/app/clinical.js';
import { baselineBand } from '../src/app/charts.js';

function run(scenario, base = { hr: 60, rmssd: 50 }, seed = 3, seconds = 60) {
  const b = new SimBody(seed);
  b.setBase(base);
  b.setScenario(scenario);
  b.settle();
  for (let i = 0; i < seconds / 0.12; i++) { b.step(0.12); b.ecg(30); }
  return b.readings();
}

test('reposo: ritmo sinusal en muchas semillas (sin falsos positivos)', () => {
  for (let seed = 1; seed <= 25; seed++) assert.equal(run('rest', { hr: 50 + seed, rmssd: 30 + seed * 2 }, seed).rhythm, 'sinus', `semilla ${seed}`);
});

test('fibrilación auricular → irregular; extrasístoles → ectopics', () => {
  for (let seed = 1; seed <= 10; seed++) {
    assert.equal(run('af', undefined, seed).rhythm, 'irregular', `af ${seed}`);
    assert.equal(run('pvc', undefined, seed).rhythm, 'ectopics', `pvc ${seed}`);
  }
});

test('el pulso calculado del ECG sigue al escenario', () => {
  const r = run('rest', { hr: 58, rmssd: 50 });
  assert.ok(Math.abs(r.ecgHr - 58) <= 3, `${r.ecgHr}`);
  const e = run('exercise');
  assert.ok(e.ecgHr > 100, `${e.ecgHr}`);
});

test('día 58: la HRV baja respecto a la base, pero todo sigue en los rangos generales', () => {
  const base = run('rest', { hr: 58, rmssd: 60 });
  const d = run('day58', { hr: 58, rmssd: 60 });
  assert.ok(d.rmssd < base.rmssd * 0.8, `${d.rmssd} vs ${base.rmssd}`);
  assert.equal(classify('hr', d.ecgHr).level, 0);
  assert.equal(classify('temp', d.temp).level, 0);
});

test('analyzeRR necesita latidos suficientes', () => {
  assert.equal(analyzeRR([800, 810]).rhythm, null);
});

test('umbrales de los sensores ampliados', () => {
  assert.equal(classify('temp', 38.6).level, 1);
  assert.equal(classify('temp', 34.8).level, 2);
  assert.equal(classify('resp', 26).level, 2);
  assert.equal(classify('resp', 16).level, 0);
  assert.equal(classify('qtc', 470).level, 1);
  assert.equal(classify('qtc', 510).level, 2);
  assert.equal(classify('rhythm', 'irregular').level, 1);
  assert.equal(co2Level(2), 0);
  assert.equal(co2Level(2.8), 1);
  assert.equal(co2Level(4.2), 2);
});

test('banda de tu normal: mediana ± 2,5 desviaciones robustas', () => {
  assert.equal(baselineBand([60, 61]), null);
  const b = baselineBand([58, 60, 59, 61, 60, 62, 59]);
  assert.equal(b.med, 60);
  assert.ok(b.hi < 66 && b.lo > 54);
});
