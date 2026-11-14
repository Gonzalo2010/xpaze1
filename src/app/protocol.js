// Protocolo Bluetooth LE de la XPaze Station, versión 1.
// Misma definición que sensors/ble_protocol.py: cambiar los dos a la vez.
// Todo little-endian y cada paquete cabe en 20 bytes.

const BASE = '-5a1e-4c3b-9d2f-6a8e7c1d0e01';
export const UUID = {
  service: `b5e70001${BASE}`,
  vitals: `b5e70002${BASE}`,
  wave: `b5e70003${BASE}`,
  card: `b5e70004${BASE}`,
  watch: `b5e70005${BASE}`,
  status: `b5e70006${BASE}`,
  control: `b5e70007${BASE}`,
};
export const VERSION = 1;
export const QUALITY = ['no-data', 'no-finger', 'collecting', 'weak', 'noisy', 'good'];
export const CMD = { watchSpo2: 0x01, resend: 0x02 };
const I16_NONE = -32768;
const U16_NONE = 0xffff;

const view = (buf) => (buf instanceof DataView ? buf : new DataView(buf.buffer ?? buf, buf.byteOffset ?? 0, buf.byteLength));
const orNull = (v, none, k) => (v === none ? null : v / k);

export function decodeVitals(buf) {
  const d = view(buf);
  if (d.byteLength < 10) throw new RangeError('vitals');
  return {
    seq: d.getUint8(0),
    quality: QUALITY[d.getUint8(1)] ?? 'no-data',
    bpm: d.getUint8(2) || null,
    spo2: d.getUint8(3) || null,
    temperature: orNull(d.getInt16(4, true), I16_NONE, 100),
    humidity: orNull(d.getUint16(6, true), U16_NONE, 100),
    pressure: orNull(d.getUint16(8, true), U16_NONE, 10),
  };
}

export function decodeWave(buf) {
  const d = view(buf);
  if (d.byteLength < 2) throw new RangeError('wave');
  const n = Math.min(d.getUint8(1), (d.byteLength - 2) >> 1);
  const samples = [];
  for (let i = 0; i < n; i++) samples.push(d.getInt16(2 + i * 2, true));
  return { seq: d.getUint8(0), samples };
}

export function decodeCard(buf) {
  const d = view(buf);
  if (d.byteLength < 1) throw new RangeError('card');
  const age = d.getUint8(0);
  if (age === 255) return null;
  let uid = '';
  for (let i = 1; i < d.byteLength; i++) uid += String.fromCharCode(d.getUint8(i));
  return /^[0-9A-F]+$/.test(uid) ? { uid, age } : null;
}

export function decodeWatch(buf) {
  const d = view(buf);
  if (d.byteLength < 8) throw new RangeError('watch');
  const flags = d.getUint8(0);
  if (!(flags & 1)) return null;
  const battery = d.getUint8(4);
  return {
    bpm: d.getUint8(1) || null,
    skin: orNull(d.getInt16(2, true), I16_NONE, 100),
    battery: battery === 255 ? null : battery,
    spo2: d.getUint8(5) || null,
    spo2Measuring: !!(flags & 2),
    ibi: d.getUint16(6, true) || null,
  };
}

export function decodeStatus(buf) {
  const d = view(buf);
  if (d.byteLength < 2) throw new RangeError('status');
  const f = d.getUint8(0);
  return {
    arduino: !!(f & 1), aht: !!(f & 2), bmp: !!(f & 4), ppg: !!(f & 8),
    rfid: !!(f & 16), test: !!(f & 32), watch: !!(f & 64), version: d.getUint8(1),
  };
}

/* ---- codificación: la usa la estación simulada para hablar igual que la real ---- */

const i16 = (v, k) => (v == null ? I16_NONE : Math.max(-32767, Math.min(32767, Math.round(v * k))));
const u16 = (v, k) => (v == null ? U16_NONE : Math.max(0, Math.min(0xfffe, Math.round(v * k))));
const u8 = (v) => (v ? Math.max(0, Math.min(255, Math.round(v))) : 0);

export function encodeVitals(seq, v) {
  const d = new DataView(new ArrayBuffer(10));
  d.setUint8(0, seq & 0xff);
  d.setUint8(1, Math.max(0, QUALITY.indexOf(v.quality)));
  d.setUint8(2, u8(v.bpm));
  d.setUint8(3, u8(v.spo2));
  d.setInt16(4, i16(v.temperature, 100), true);
  d.setUint16(6, u16(v.humidity, 100), true);
  d.setUint16(8, u16(v.pressure, 10), true);
  return d;
}

export function encodeWave(seq, samples) {
  const s = samples.slice(0, 8);
  const d = new DataView(new ArrayBuffer(2 + s.length * 2));
  d.setUint8(0, seq & 0xff);
  d.setUint8(1, s.length);
  s.forEach((v, i) => d.setInt16(2 + i * 2, Math.max(-32767, Math.min(32767, Math.round(v))), true));
  return d;
}

export function encodeCard(card) {
  if (!card) return new DataView(new Uint8Array([255]).buffer);
  const bytes = new Uint8Array(1 + card.uid.length);
  bytes[0] = Math.min(254, card.age | 0);
  for (let i = 0; i < card.uid.length; i++) bytes[1 + i] = card.uid.charCodeAt(i);
  return new DataView(bytes.buffer);
}

export function encodeWatch(w) {
  const d = new DataView(new ArrayBuffer(8));
  if (!w) { d.setInt16(2, I16_NONE, true); d.setUint8(4, 255); return d; }
  d.setUint8(0, 1 | (w.spo2Measuring ? 2 : 0));
  d.setUint8(1, u8(w.bpm));
  d.setInt16(2, i16(w.skin, 100), true);
  d.setUint8(4, w.battery == null ? 255 : w.battery);
  d.setUint8(5, u8(w.spo2));
  d.setUint16(6, Math.min(0xffff, w.ibi | 0), true);
  return d;
}

export function encodeStatus(s) {
  const d = new DataView(new ArrayBuffer(4));
  const f = (s.arduino ? 1 : 0) | (s.aht ? 2 : 0) | (s.bmp ? 4 : 0) | (s.ppg ? 8 : 0)
    | (s.rfid ? 16 : 0) | (s.test ? 32 : 0) | (s.watch ? 64 : 0);
  d.setUint8(0, f);
  d.setUint8(1, VERSION);
  return d;
}
