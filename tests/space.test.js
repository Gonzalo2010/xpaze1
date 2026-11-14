import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSpace, flareClass } from '../src/app/space.js';

const NOW = Date.parse('2026-11-14T20:00:00Z');
const ago = (h) => new Date(NOW - h * 3600_000).toISOString();

test('sin avisos: verde en cualquier entorno', () => {
  for (const env of ['transit', 'station', 'lunar', 'rover']) assert.equal(assessSpace([], env, NOW).level, 0);
});

test('partículas solares: rojo fuera de la magnetosfera, amarillo en órbita baja', () => {
  const ev = [{ type: 'SEP', time: ago(10) }];
  assert.equal(assessSpace(ev, 'transit', NOW).level, 2);
  assert.equal(assessSpace(ev, 'lunar', NOW).level, 2);
  assert.equal(assessSpace(ev, 'station', NOW).level, 1);
  assert.match(assessSpace(ev, 'transit', NOW).actions[0], /refugio/);
  assert.equal(assessSpace([{ type: 'SEP', time: ago(60) }], 'transit', NOW).level, 0); // caducado
});

test('fulguraciones: M5 o más avisa fuera de la magnetosfera', () => {
  assert.ok(flareClass('X1.2') > flareClass('M9.9'));
  assert.equal(assessSpace([{ type: 'FLR', time: ago(3), flare: 'M5.0' }], 'transit', NOW).level, 1);
  assert.equal(assessSpace([{ type: 'FLR', time: ago(3), flare: 'M2.1' }], 'transit', NOW).level, 0);
  assert.equal(assessSpace([{ type: 'FLR', time: ago(3), flare: 'X1.0' }], 'station', NOW).level, 0);
});

test('tormenta geomagnética fuerte: vigilancia solo en órbita terrestre', () => {
  const strong = [{ type: 'GST', time: ago(5), kp: 7.33 }];
  assert.equal(assessSpace(strong, 'station', NOW).level, 1);
  assert.equal(assessSpace(strong, 'transit', NOW).level, 0);
  const moderate = assessSpace([{ type: 'GST', time: ago(5), kp: 5.67 }], 'station', NOW);
  assert.equal(moderate.level, 0);
  assert.match(moderate.reasons[0].text, /Kp 5\.7/);
});

test('cinturón de radiación: informativo en la estación, ignorado en tránsito', () => {
  assert.equal(assessSpace([{ type: 'RBE', time: ago(5) }], 'station', NOW).reasons.length, 1);
  assert.equal(assessSpace([{ type: 'RBE', time: ago(5) }], 'transit', NOW).reasons.length, 0);
});
