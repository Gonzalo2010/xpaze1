// Lógica pura del núcleo de la demo: estadística, bosque de aislamiento, señales y contexto.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRng, hashSeed } from '../src/demo/core/engine/rng.js';
import { mean, median, mad, robustZ, robustScale, ewma, ewmaChart, quantile } from '../src/demo/core/engine/stats.js';
import { buildForest, anomalyScore, tracePath, cFactor, contributions } from '../src/demo/core/engine/iforest.js';
import { synthECG, detectRPeaks, heartMetrics, signalQuality, synthPPG, estimateSpO2, tempSensor, distanceAt, cabinEnv, cabinOut } from '../src/demo/core/engine/signals.js';
import { classifyContext, expectedShift, toRestEquivalent } from '../src/demo/core/engine/context.js';
import { lightMinutes, reportPhase, REVIEW_MIN } from '../src/demo/core/engine/link.js';

test('rng: misma semilla, misma secuencia; semillas distintas, secuencias distintas', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const sa = Array.from({ length: 20 }, () => a.next());
  assert.deepEqual(sa, Array.from({ length: 20 }, () => b.next()));
  assert.notDeepEqual(sa, Array.from({ length: 20 }, () => c.next()));
  assert.ok(sa.every((v) => v >= 0 && v < 1));
  assert.notEqual(hashSeed(1, 'vega', 3), hashSeed(1, 'vega', 4));
  const g = createRng(7);
  const xs = Array.from({ length: 5000 }, () => g.gauss());
  assert.ok(Math.abs(mean(xs)) < 0.06);
});

test('mediana, MAD y z robusto aguantan valores atípicos', () => {
  const base = [60, 61, 59, 60, 62, 58, 60, 61, 59, 60];
  assert.equal(median(base), 60);
  assert.equal(mad(base), 1);
  assert.ok(Math.abs(robustScale(base) - 1.4826) < 1e-9);
  assert.ok(Math.abs(robustZ(63, base) - 3 / 1.4826) < 1e-9);
  const dirty = [...base, 140, 150];
  assert.ok(Math.abs(median(dirty) - 60) <= 0.5);
  assert.ok(robustScale(dirty) < 3, 'la MAD apenas cambia');
  assert.ok(robustZ(70, dirty) > 4, 'un valor de 70 sigue viéndose raro');
  assert.equal(robustZ(5, [5, 5, 5], 0), 0);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
});

test('EWMA: recursión correcta y deriva sostenida frente a pico aislado', () => {
  assert.deepEqual(ewma([10, 20], 0.5, 10), [10, 15]);
  const flat = Array(10).fill(60);
  const spike = [...flat.slice(0, 9), 66]; // un día a +3σ
  const drift = [60, 60, 60, 60, 62.5, 62.5, 63, 63, 63.5, 63.5];
  const opts = { lambda: 0.3, center: 60, sigma: 2, L: 3 };
  assert.equal(ewmaChart(flat, opts).out, false);
  assert.equal(ewmaChart(spike, opts).out, false, 'un pico aislado no dispara');
  const d = ewmaChart(drift, opts);
  assert.equal(d.out, true, 'varios días seguidos sí');
  assert.equal(d.dir, 1);
  assert.ok(d.run >= 1);
});

test('Isolation Forest: aísla antes lo raro y es determinista', () => {
  const rng = createRng(5);
  const data = Array.from({ length: 60 }, () => [rng.gauss(), rng.gauss(), rng.gauss()]);
  const forest = buildForest(data, { trees: 100, sampleSize: 32, rng: createRng(9) });
  const again = buildForest(data, { trees: 100, sampleSize: 32, rng: createRng(9) });
  const inlier = [0.1, -0.2, 0.05], outlier = [5, -5, 6];
  const si = anomalyScore(forest, inlier), so = anomalyScore(forest, outlier);
  assert.equal(si, anomalyScore(again, inlier));
  assert.ok(so > 0.65 && si < 0.55 && so > si + 0.15, `inlier ${si}, outlier ${so}`);
  assert.ok(tracePath(forest.trees[0], outlier).depth <= forest.maxDepth);
  assert.ok(Math.abs(cFactor(256) - 10.24) < 0.02);
  const c = contributions(forest, [5, 0, 0]);
  assert.ok(c[0] > c[1] && c[0] > c[2], 'la variable desviada es la que más contribuye');
});

test('ECG sintético: el detector recupera pulso y HRV', () => {
  for (const [hr, hrv] of [[49, 85], [58, 62], [72, 38], [108, 22]]) {
    const ecg = synthECG({ hr, hrv, durationS: 20, rng: createRng(hr * 13) });
    const peaks = detectRPeaks(ecg.samples, ecg.fs);
    const m = heartMetrics(peaks);
    assert.ok(Math.abs(m.hr - hr) < 1.5, `pulso ${m.hr} vs ${hr}`);
    assert.ok(Math.abs(m.hrv - hrv) < Math.max(5, hrv * 0.12), `HRV ${m.hrv} vs ${hrv}`);
    assert.ok(Math.abs(peaks.length - ecg.beats.filter((b) => b < 20).length) <= 1);
    assert.ok(signalQuality(ecg.samples, ecg.fs, ecg.samples.length, peaks) > 0.85);
  }
});

test('ECG con mal contacto: calidad baja', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const ecg = synthECG({ hr: 62, hrv: 50, rng: createRng(seed), contact: 'poor' });
    assert.ok(signalQuality(ecg.samples, ecg.fs) < 0.6);
  }
  assert.deepEqual(detectRPeaks(new Float32Array(10), 250), []);
});

test('PPG: la relación rojo/infrarrojo devuelve la SpO2', () => {
  for (const spo2 of [99, 97, 94, 90]) {
    const rng = createRng(spo2);
    const ecg = synthECG({ hr: 64, hrv: 45, durationS: 10, rng });
    const ppg = synthPPG({ beats: ecg.beats, rr: ecg.rr, spo2, rng });
    const o = estimateSpO2(ppg.ir, ppg.red, ppg.fs);
    assert.ok(Math.abs(o.spo2 - spo2) < 0.5, `${o.spo2} vs ${spo2}`);
  }
  assert.equal(estimateSpO2(new Float32Array(20), new Float32Array(20), 50).spo2, null);
});

test('temperatura sin contacto: solo vale dentro de la ventana de distancia y se compensa', () => {
  const rng = createRng(3);
  const far = tempSensor({ core: 36.8, distanceMm: 120, rng });
  const near = tempSensor({ core: 36.8, distanceMm: 45, rng });
  assert.equal(far.valid, false);
  assert.equal(near.valid, true);
  assert.ok(far.object < near.object, 'de lejos lee menos');
  assert.ok(Math.abs(near.estimate - 36.8) < 0.2);
  assert.ok(distanceAt(0) > 100 && distanceAt(3.5) < 60);
});

test('cabina: valores nominales en rango y fallo fuera de rango', () => {
  const ok = cabinOut(cabinEnv({ rng: createRng(1) }));
  const bad = cabinOut(cabinEnv({ rng: createRng(1), fault: true }));
  assert.deepEqual(ok, { co2: false, temp: false });
  assert.deepEqual(bad, { co2: true, temp: true });
});

test('contexto: reposo, ejercicio y sueño', () => {
  assert.equal(classifyContext({ activeMin10: 0, cadence: 0, hrWatch: 60, hrRest: 59, hour: 9 }).context, 'rest');
  const ex = classifyContext({ activeMin10: 9, cadence: 20, hrWatch: 98, hrRest: 58, hour: 9 });
  assert.equal(ex.context, 'exercise');
  assert.ok(ex.confidence > 0.6 && ex.evidence.length > 0);
  assert.equal(classifyContext({ activeMin10: 0, lying: true, hour: 3, hrWatch: 50, hrRest: 58 }).context, 'sleep');
  const s = expectedShift('exercise');
  const eq = toRestEquivalent({ hr: 58 + s.hr, hrv: 60 * s.hrvMul, temp: 36.5 + s.temp, spo2: 98 + s.spo2 }, 'exercise');
  assert.ok(Math.abs(eq.hr - 58) < 1e-9 && Math.abs(eq.hrv - 60) < 1e-9 && Math.abs(eq.temp - 36.5) < 1e-9);
  assert.deepEqual(expectedShift('rest'), { hr: 0, hrvMul: 1, temp: 0, spo2: 0, tol: 1 });
});

test('enlace: minutos luz y fases de un informe', () => {
  assert.ok(Math.abs(lightMinutes(55) - 3.06) < 0.02);
  assert.ok(Math.abs(lightMinutes(400) - 22.24) < 0.02);
  const r = { delayMin: 10, sentAt: 0 };
  assert.equal(reportPhase(r, 5000).phase, 'outbound');
  assert.ok(Math.abs(reportPhase(r, 5000).progress - 0.5) < 1e-9);
  assert.equal(reportPhase(r, 12000).phase, 'review');
  assert.equal(reportPhase(r, (10 + REVIEW_MIN + 5) * 1000).phase, 'inbound');
  assert.equal(reportPhase(r, (20 + REVIEW_MIN + 1) * 1000).phase, 'answered');
});
