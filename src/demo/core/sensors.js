// Local bridge only. No network addresses or credentials are stored in the browser.
export function isLocalBridgeLocation(loc = globalThis.location) {
  return loc?.protocol === 'http:' && (loc.hostname === '127.0.0.1' || loc.hostname === 'localhost');
}

export async function getSensorSnapshot(fetcher = globalThis.fetch) {
  const response = await fetcher('/api/sensors', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Sensor bridge unavailable');
  const data = await response.json();
  // 'test' = datos de prueba del puente (--test-data); la interfaz los marca como tales
  if (!['hardware', 'test'].includes(data.source) || !data.environment) throw new Error('Invalid sensor data');
  return data;
}

export async function requestWatchSpo2(fetcher = globalThis.fetch) {
  const response = await fetcher('/api/watch/spo2', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(8000) });
  return response.ok;
}
