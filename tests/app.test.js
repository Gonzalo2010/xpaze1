import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeVitals, decodeWave, decodeCard, decodeWatch, decodeStatus,
  encodeVitals, encodeWave, encodeCard, encodeWatch, encodeStatus,
} from '../src/app/protocol.js';
import { assess, summarize, MIN_PERSONAL } from '../src/app/assess.js';
import { SimLink } from '../src/app/link.js';

const hex = (h) => new DataView(Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16)).buffer);

// Paquetes reales capturados de la Raspberry (sensors/ble_protocol.py).
// tests/sensors/test_ble_protocol.py comprueba que Python sigue generando estos mismos bytes.
test('decodifica paquetes generados por la Raspberry', () => {
  const v = decodeVitals(hex('b7040000df085e108f27'));
  assert.deepEqual(v, { seq: 0xb7, quality: 'noisy', bpm: null, spo2: null, temperature: 22.71, humidity: 41.9, pressure: 1012.7 });
  assert.deepEqual(decodeCard(hex('003034413337463143')), { uid: '04A37F1C', age: 0 });
  assert.deepEqual(decodeWatch(hex('014c280d4e001503')), { bpm: 76, skin: 33.68, battery: 78, spo2: null, spo2Measuring: false, ibi: 789 });
  const st = decodeStatus(hex('7f010000'));
  assert.equal(st.arduino && st.aht && st.bmp && st.ppg && st.rfid && st.test && st.watch, true);
  assert.equal(st.version, 1);
  assert.deepEqual(decodeWave(hex('b803850a38058f00')), { seq: 0xb8, samples: [2693, 1336, 143] });
});

test('codificar y descodificar es reversible', () => {
  const v = { quality: 'good', bpm: 72, spo2: 97, temperature: -3.25, humidity: 55.5, pressure: 1001.3 };
  assert.deepEqual(decodeVitals(encodeVitals(9, v)), { seq: 9, ...v });
  const empty = decodeVitals(encodeVitals(1, { quality: 'no-finger' }));
  assert.deepEqual([empty.bpm, empty.spo2, empty.temperature, empty.humidity, empty.pressure], [null, null, null, null, null]);
  assert.deepEqual(decodeWave(encodeWave(3, [1, -2, 32767, -40000])).samples, [1, -2, 32767, -32767]);
  assert.equal(decodeWave(encodeWave(3, Array(12).fill(5))).samples.length, 8);
  assert.equal(decodeCard(encodeCard(null)), null);
  assert.deepEqual(decodeCard(encodeCard({ uid: '04C819D4', age: 3 })), { uid: '04C819D4', age: 3 });
  assert.equal(decodeWatch(encodeWatch(null)), null);
  assert.equal(decodeWatch(encodeWatch({ bpm: 70, skin: 33.1, battery: 50, spo2: null, spo2Measuring: true, ibi: 857 })).spo2Measuring, true);
  assert.equal(decodeStatus(encodeStatus({ arduino: true, ppg: true })).ppg, true);
  for (const k of [10, 2, 1, 8, 4]) assert.ok(k <= 20); // todo cabe en el MTU mínimo
  assert.throws(() => decodeVitals(hex('0001')));
  assert.equal(decodeCard(hex('0030zz'.replace('zz', '7a'))), null); // UID no hexadecimal
});

test('resume una medición con la mediana y descarta lo no válido', () => {
  const r = summarize([{ bpm: 70, spo2: 97 }, { bpm: 72, spo2: null }, { bpm: null }, { bpm: 200, spo2: 98 }]);
  assert.equal(r.bpm, 72);
  assert.equal(r.spo2, 98);
  assert.equal(r.goodSamples, 3);
});

test('valoración: ficha, línea base personal y avisos', () => {
  const crew = { hr: 58 };
  assert.equal(assess({ bpm: 60, spo2: 98 }, { crew }).status, 'normal');
  assert.equal(assess({ bpm: 69, spo2: 98 }, { crew }).status, 'watch');
  assert.equal(assess({ bpm: 80, spo2: 98 }, { crew }).status, 'alert');
  assert.equal(assess({ bpm: 60, spo2: 91 }, { crew }).status, 'alert');
  assert.equal(assess({ bpm: 60, spo2: 94 }, { crew }).status, 'watch');
  assert.equal(assess({ bpm: null }, { crew }).status, 'unreliable');
  // sin ficha: rango de la población
  assert.equal(assess({ bpm: 75 }, {}).status, 'normal');
  assert.equal(assess({ bpm: 110 }, {}).status, 'watch');
  // con 5 chequeos propios manda la línea base personal: 66 es normal para quien vive en 66
  const history = Array.from({ length: MIN_PERSONAL }, (_, i) => ({ bpm: 65 + (i % 3) }));
  const v = assess({ bpm: 67, spo2: 98 }, { history, crew });
  assert.equal(v.baseline.source, 'personal');
  assert.equal(v.status, 'normal');
  assert.equal(assess({ bpm: 84, spo2: 98 }, { history, crew }).status, 'alert');
  // reloj y estación que no coinciden
  assert.equal(assess({ bpm: 60, watchBpm: 80, spo2: 98 }, { crew }).status, 'watch');
});

test('la estación simulada habla el mismo protocolo', async () => {
  const sim = new SimLink();
  const seen = {};
  sim.on(({ type, data }) => { (seen[type] ||= []).push(data); });
  await sim.connect();
  sim.tapCard('04A37F1C');
  sim.setFinger(true);
  await new Promise((r) => setTimeout(r, 1300));
  sim.disconnect();
  assert.equal(seen.link.at(-1).state, 'disconnected');
  assert.ok(seen.status[0].test, 'la simulada se marca como prueba');
  assert.ok(seen.wave.length >= 8);
  assert.equal(seen.card[0].uid, '04A37F1C');
  assert.ok(seen.vitals.length >= 1);
  assert.ok(['collecting', 'good'].includes(seen.vitals.at(-1).quality));
  assert.equal(seen.watch.at(-1), null, 'la simulada no usa reloj');
  assert.ok(seen.ecg.length >= 8 && seen.ecg[0].samples.length === 30, 'ECG a 250 Hz');
  assert.ok(seen.ext.at(-1).temp > 35, 'sensores ampliados');
  sim.setWatch(true); // el reloj sigue disponible si se activa
  assert.ok(seen.watch.at(-1).bpm > 0);
});
