import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalBridgeLocation, getSensorSnapshot } from '../src/demo/core/sensors.js';

test('sensor bridge is restricted to local HTTP', () => {
  assert.equal(isLocalBridgeLocation({ protocol: 'http:', hostname: '127.0.0.1' }), true);
  assert.equal(isLocalBridgeLocation({ protocol: 'http:', hostname: 'localhost' }), true);
  assert.equal(isLocalBridgeLocation({ protocol: 'https:', hostname: 'xpaze.es' }), false);
  assert.equal(isLocalBridgeLocation({ protocol: 'http:', hostname: 'example.com' }), false);
});

test('sensor data must explicitly identify hardware', async () => {
  await assert.rejects(getSensorSnapshot(async () => ({ ok: true, json: async () => ({ source: 'simulated', environment: {} }) })));
  const data = { source: 'hardware', environment: { temperature_c: 22 }, errors: [] };
  assert.deepEqual(await getSensorSnapshot(async () => ({ ok: true, json: async () => data })), data);
  const test = { source: 'test', environment: {}, errors: [] };
  assert.deepEqual(await getSensorSnapshot(async () => ({ ok: true, json: async () => test })), test);
});
