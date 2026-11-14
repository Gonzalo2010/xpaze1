// La misión simulada de principio a fin: historial, escenarios, chequeo, análisis y explicación.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CREW, FEATURES, VITALS } from '../src/demo/core/engine/crew.js';
import * as M from '../src/demo/core/engine/mission.js';
import { analyze, baselineOf, THRESHOLDS } from '../src/demo/core/engine/analyze.js';
import { classifyContext } from '../src/demo/core/engine/context.js';
import { makeReport } from '../src/demo/core/engine/link.js';

const fresh = () => M.createMission({});
const run = (s, id) => M.instantCheck(s, id, 0).check;

test('misión: historial determinista, completo y con la forma del contrato', () => {
  const a = fresh(), b = fresh();
  assert.deepEqual(a.history, b.history);
  assert.equal(a.day, M.START_DAY);
  for (const p of CREW) {
    const h = a.history[p.id];
    assert.equal(h.length, M.START_DAY);
    assert.deepEqual(Object.keys(h[0]), ['day', 'hr', 'hrv', 'temp', 'spo2', 'sleepH', 'sleepQuality', 'activityMin', 'context']);
    assert.deepEqual(h.map((d) => d.day), Array.from({ length: M.START_DAY }, (_, i) => i + 1));
    const base = baselineOf(p, M.historyBefore(a, p.id), 'hr');
    assert.ok(Math.abs(base.median - p.baseline.hr) < 2, 'la línea base aprendida se parece a la de la persona');
  }
  assert.notDeepEqual(M.createMission({ seed: 5 }).history.vega, a.history.vega);
});

test('sin escenarios: los cuatro salen normales hoy y los días siguientes', () => {
  const s = fresh();
  for (let d = 0; d < 6; d++) {
    for (const p of CREW) {
      const c = run(s, p.id);
      assert.equal(c.analysis.status, 'normal', `${p.id} día ${s.day}`);
      assert.equal(c.context.context, 'rest');
      assert.ok(c.quality > 0.85);
    }
    M.advanceDays(s, 1);
  }
});

test('línea base personal: un pulso de 49 es normal para Amara aunque esté fuera del rango poblacional', () => {
  const c = run(fresh(), 'amara');
  assert.equal(c.analysis.status, 'normal');
  assert.equal(c.analysis.metrics.hr.popOut, -1);
  assert.ok(c.analysis.lines.some((l) => l.key === 'line.popFalseLow'));
});

test('fiebre incipiente: se detecta el primer día y crece al avanzar', () => {
  for (const p of CREW) {
    const s = fresh();
    M.injectScenario(s, 'fever', p.id);
    const d0 = run(s, p.id);
    assert.notEqual(d0.analysis.status, 'normal', `${p.id} día 0`);
    assert.equal(d0.analysis.pattern, 'thermal');
    assert.ok(d0.analysis.metrics.temp.adverse >= 2);
    M.advanceDays(s, 2);
    const d2 = run(s, p.id);
    assert.equal(d2.analysis.status, 'anomaly', `${p.id} día 2`);
    assert.ok(d2.analysis.metrics.temp.z > d0.analysis.metrics.temp.z);
    assert.ok(d2.analysis.actions.some((x) => x.key === 'act.notifyMed'));
    assert.equal(d2.analysis.auto.key, 'auto.anomaly');
  }
  // el caso estrella de la demo: primero «a vigilar», luego «anomalía»
  const s = fresh();
  M.injectScenario(s, 'fever', 'vega');
  const first = run(s, 'vega');
  assert.equal(first.analysis.status, 'watch');
  assert.ok(first.analysis.lines.some((l) => l.key === 'line.popMiss'), 'un umbral poblacional no lo habría visto');
});

test('mala noche: a vigilar, explicado por el sueño, y se recupera sola', () => {
  for (const p of CREW) {
    const s = fresh();
    M.injectScenario(s, 'badNight', p.id);
    const c = run(s, p.id);
    assert.equal(c.analysis.status, 'watch', p.id);
    assert.equal(c.analysis.pattern, 'sleep');
    assert.ok(c.analysis.sleepFlag);
    M.advanceDays(s, 3);
    assert.equal(s.scenarios.length, 0, 'el escenario caduca');
    assert.equal(run(s, p.id).analysis.status, 'normal');
  }
});

test('ejercicio: pulso muy alto, pero el contexto lo explica', () => {
  for (const p of CREW) {
    const s = fresh();
    M.injectScenario(s, 'exercise', p.id);
    const c = run(s, p.id);
    assert.equal(c.context.context, 'exercise');
    assert.ok(c.measured.hr > p.baseline.hr + 25);
    assert.equal(c.analysis.status, 'normal', p.id);
    assert.equal(c.analysis.headline.key, 'head.normal.exercise');
    assert.deepEqual(s.pending[p.id], {}, 'lo puntual se consume con el chequeo');
    // la misma lectura, interpretada como reposo, sería una anomalía
    const asRest = analyze({
      astronaut: p, history: M.historyBefore(s, p.id), today: { ...c.measured, ...c.watch },
      context: classifyContext({ activeMin10: 0, hrWatch: 60, hrRest: 60 }), cabin: c.cabin, seed: s.seed,
    });
    assert.equal(asRest.status, 'anomaly');
  }
});

test('estrés sostenido: deriva de la HRV detectada por EWMA', () => {
  for (const p of CREW) {
    const s = fresh();
    M.injectScenario(s, 'stress', p.id);
    const c = run(s, p.id);
    assert.notEqual(c.analysis.status, 'normal', p.id);
    assert.ok(c.analysis.drifting.includes('hrv'), `${p.id}: deriva ${c.analysis.drifting}`);
    assert.ok(['strain', 'cardio'].includes(c.analysis.pattern));
    assert.ok(c.analysis.lines.some((l) => l.key === 'line.drift'));
    assert.ok(s.history[p.id][s.day - 3].hrv < p.baseline.hrv, 'el historial reciente también lo refleja');
  }
});

test('cabina: afecta a toda la tripulación y se atribuye al ambiente', () => {
  const s = fresh();
  M.injectScenario(s, 'cabin', 'vega');
  for (const p of CREW) {
    const c = run(s, p.id);
    assert.equal(c.analysis.status, 'watch', p.id);
    assert.equal(c.analysis.pattern, 'cabin');
    assert.ok(c.cabin.co2 > 4000 && c.cabin.tempC > 27);
    assert.ok(c.analysis.lines.some((l) => l.key === 'line.cabin.shared'));
    assert.ok(c.analysis.actions.some((x) => x.key === 'act.checkCabin'));
  }
  M.removeScenario(s, 'cabin', 'iker');
  assert.equal(run(s, 'noa').analysis.status, 'normal');
});

test('fallo de sensor: no se interpreta una señal mala; al repetir, sale bien', () => {
  const s = fresh();
  M.injectScenario(s, 'sensor', 'iker');
  const sim = M.simulateCheck(s, 'iker', { attempt: 1 });
  const m = M.measureCheck(sim);
  assert.equal(m.reliable, false);
  assert.ok(m.quality < THRESHOLDS.quality);
  const bad = analyze({ astronaut: sim.astronaut, history: M.historyBefore(s, 'iker'), today: { hr: 60, hrv: 40, temp: 36.7, spo2: 97, sleepH: 6.6 }, quality: m.quality });
  assert.equal(bad.status, 'unreliable');
  assert.equal(bad.actions[0].key, 'act.retry');
  const { check, retried } = M.instantCheck(s, 'iker', 0);
  assert.equal(retried, true);
  assert.equal(check.attempt, 2);
  assert.equal(check.analysis.status, 'normal');
});

test('deshidratación: pulso en reposo alto sin contexto que lo explique', () => {
  for (const p of CREW) {
    const s = fresh();
    M.injectScenario(s, 'dehydration', p.id);
    const c = run(s, p.id);
    assert.notEqual(c.analysis.status, 'normal', p.id);
    assert.ok(c.analysis.metrics.hr.adverse >= 1.5);
    M.advanceDays(s, 2);
    assert.equal(run(s, p.id).analysis.status, 'anomaly', p.id);
  }
});

test('escenarios: no se duplican, se quitan y el historial vuelve a su sitio', () => {
  const s = fresh();
  const before = JSON.stringify(s.history);
  assert.equal(M.injectScenario(s, 'stress', 'noa'), true);
  assert.equal(M.injectScenario(s, 'stress', 'noa'), false);
  assert.equal(M.injectScenario(s, 'nope', 'noa'), false);
  M.injectScenario(s, 'exercise', 'noa');
  assert.deepEqual(M.activeScenarios(s, 'noa').sort(), ['exercise', 'stress']);
  assert.deepEqual(M.activeScenarios(s, 'vega'), []);
  assert.notEqual(JSON.stringify(s.history), before);
  M.clearScenarios(s);
  assert.equal(JSON.stringify(s.history), before);
  assert.deepEqual(M.activeScenarios(s, 'noa'), []);
});

test('chequeo: forma del resultado, serializable y repetible', () => {
  const s1 = fresh(), s2 = fresh();
  const c1 = run(s1, 'vega'), c2 = run(s2, 'vega');
  assert.deepEqual(JSON.parse(JSON.stringify(c1)), JSON.parse(JSON.stringify(c2)));
  assert.equal(s1.checks.vega.length, 1);
  for (const m of VITALS) assert.ok(Number.isFinite(c1.measured[m]));
  for (const m of FEATURES) {
    const x = c1.analysis.metrics[m];
    assert.ok(Number.isFinite(x.z) && x.band[0] < x.median && x.median < x.band[1]);
  }
  assert.ok(c1.analysis.iforest.score > 0.3 && c1.analysis.iforest.score < 0.6);
  assert.ok(c1.analysis.headline.key && c1.analysis.lines.length && c1.analysis.actions.length);
  const report = makeReport(c1, 12.5, 1000);
  assert.deepEqual([report.status, report.auto, report.delayMin, report.sentAt], ['normal', 'auto.normal', 12.5, 1000]);
  const pv = M.previewCheck(s1, 'vega');
  assert.equal(pv.analysis.status, 'normal');
  assert.equal(s1.checks.vega.length, 1, 'la vista previa no guarda nada');
});

test('avanzar días: crece el historial de todos y caduca lo puntual', () => {
  const s = fresh();
  M.injectScenario(s, 'exercise', 'vega');
  M.advanceDays(s, 3);
  assert.equal(s.day, M.START_DAY + 3);
  for (const p of CREW) assert.equal(s.history[p.id].length, s.day);
  assert.deepEqual(s.pending.vega, {});
  assert.equal(M.todayEntry(s, 'vega').day, s.day);
});
