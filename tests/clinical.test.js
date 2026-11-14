import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, actionPlan, cabinLevel, MEASURES, ENVIRONMENTS } from '../src/app/clinical.js';

const lvl = (id, v) => classify(id, v).level;

test('pulso según NEWS2: 51–90 verde, 41–50 / 91–130 amarillo, ≤40 / ≥131 rojo', () => {
  assert.deepEqual([40, 41, 50, 51, 90, 91, 130, 131].map((v) => lvl('hr', v)), [2, 1, 1, 0, 0, 1, 1, 2]);
});

test('SpO2 según NEWS2 escala 1', () => {
  assert.deepEqual([91, 92, 95, 96, 100].map((v) => lvl('spo2', v)), [2, 1, 1, 0, 0]);
});

test('tensión: ACC/AHA arriba, NEWS2 abajo', () => {
  const bp = (sys, dia) => lvl('bp', { sys, dia });
  assert.equal(bp(118, 76), 0);
  assert.equal(bp(134, 76), 1);
  assert.equal(bp(122, 84), 1);
  assert.equal(bp(182, 100), 2);
  assert.equal(bp(150, 121), 2);
  assert.equal(bp(96, 60), 1);
  assert.equal(bp(88, 55), 2);
});

test('glucosa según ADA', () => {
  assert.deepEqual([53, 54, 69, 70, 180, 181, 250, 251].map((v) => lvl('glucose', v)), [2, 1, 1, 0, 0, 1, 1, 2]);
});

test('ánimo y sueño: PHQ-2 ≥ 3 y sueño < 7 h avisan; < 4 h es rojo', () => {
  assert.equal(lvl('mind', { phq2: 1, sleep: 7.5, stress: 3 }), 0);
  assert.equal(lvl('mind', { phq2: 3, sleep: 7.5, stress: 3 }), 1);
  assert.equal(lvl('mind', { phq2: 0, sleep: 6, stress: 3 }), 1);
  assert.equal(lvl('mind', { phq2: 0, sleep: 8, stress: 9 }), 1);
  assert.equal(lvl('mind', { phq2: 0, sleep: 3.5, stress: 2 }), 2);
});

test('guía de actuación según el peor resultado y el entorno', () => {
  const ok = actionPlan([classify('hr', 70)], 'station');
  assert.equal(ok.worst, 0);
  assert.equal(ok.now.length, 0);
  const red = actionPlan([classify('hr', 70), classify('glucose', 45)], 'transit');
  assert.equal(red.worst, 2);
  assert.ok(red.now.some((x) => /azúcar/.test(x)));
  assert.match(red.surgeon, /6 y 45 minutos/);
  assert.equal(red.evac, ENVIRONMENTS.transit.evac);
});

test('aire de cabina según NASA-STD-3001', () => {
  assert.equal(cabinLevel({ temperature: 22.5, humidity: 41, pressure: 1012 }), 0);
  assert.equal(cabinLevel({ temperature: 26, humidity: 41, pressure: 1012 }), 1);
  assert.equal(cabinLevel({ temperature: 22, humidity: 80, pressure: 1012 }), 2);
  assert.equal(cabinLevel({}), null);
});

test('cada medición tiene por qué, pasos, rango y fuente', () => {
  for (const [id, m] of Object.entries(MEASURES)) {
    assert.ok(m.why.length > 60, id);
    assert.ok(m.steps.length >= 3, id);
    assert.ok(m.range.green && m.range.yellow && m.range.red, id);
    assert.ok(m.ref, id);
  }
});

test('la guía solo da consejos de la dirección correcta (bajo o alto)', () => {
  const low = actionPlan([classify('glucose', 45)], 'station').now.join(' ');
  assert.match(low, /azúcar/);
  assert.doesNotMatch(low, /ejercicio intenso/);
  const high = actionPlan([classify('glucose', 300)], 'station').now.join(' ');
  assert.match(high, /Bebe agua/);
  assert.doesNotMatch(high, /azúcar/);
  const bpHigh = actionPlan([classify('bp', { sys: 140, dia: 90 })], 'station').now.join(' ');
  assert.doesNotMatch(bpHigh, /horizontal/);
  assert.equal(classify('hr', 30).dir, 'low');
  assert.equal(classify('hr', 140).dir, 'high');
});
