// Dos maneras de hablar con una XPaze Station, con la misma interfaz:
//   BleLink  → la estación física por Web Bluetooth
//   SimLink  → una estación simulada que genera los MISMOS paquetes binarios
// Ambas emiten eventos { type: 'vitals'|'wave'|'card'|'watch'|'status'|'link', data }.

import {
  UUID, CMD, decodeVitals, decodeWave, decodeCard, decodeWatch, decodeStatus,
  encodeVitals, encodeWave, encodeCard, encodeWatch, encodeStatus,
} from './protocol.js';
import { SimBody, ECG_RATE } from './simbody.js';

const DECODERS = {
  vitals: decodeVitals, wave: decodeWave, card: decodeCard, watch: decodeWatch, status: decodeStatus,
};

class Emitter {
  constructor() { this.handlers = new Set(); }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  emit(type, data) { for (const fn of this.handlers) fn({ type, data }); }
  packet(type, dataView) {
    try { this.emit(type, DECODERS[type](dataView)); } catch { /* paquete corrupto: se ignora */ }
  }
}

export const bluetoothAvailable = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

/* ----------------------------------------------------------- Bluetooth -- */

export class BleLink extends Emitter {
  constructor() {
    super();
    this.kind = 'ble';
    this.device = null;
    this.chars = {};
    this.wanted = false;     // el usuario quiere estar conectado (para reconectar solo)
    this.retry = 0;
    this.timer = 0;
  }

  get name() { return this.device?.name || 'XPaze Station'; }

  // Tiene que llamarse desde un gesto del usuario (requisito de Web Bluetooth).
  async choose() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [UUID.service] }, { namePrefix: 'XPaze' }],
      optionalServices: [UUID.service],
    });
    this.device.addEventListener('gattserverdisconnected', () => this.onDrop());
    return this.connect();
  }

  // Reutiliza un dispositivo ya autorizado (Chrome recuerda el permiso).
  async remembered() {
    if (!navigator.bluetooth?.getDevices) return null;
    try {
      const list = await navigator.bluetooth.getDevices();
      return list.find((d) => (d.name || '').startsWith('XPaze')) || null;
    } catch { return null; }
  }

  async resume(device) {
    this.device = device;
    this.device.addEventListener('gattserverdisconnected', () => this.onDrop());
    return this.connect();
  }

  async connect() {
    this.wanted = true;
    clearTimeout(this.timer);
    this.emit('link', { state: 'connecting', attempt: this.retry });
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(UUID.service);
    this.chars = {};
    for (const key of ['vitals', 'wave', 'card', 'watch', 'status', 'control']) {
      this.chars[key] = await service.getCharacteristic(UUID[key]);
    }
    for (const key of ['vitals', 'wave', 'card', 'watch', 'status']) {
      const ch = this.chars[key];
      ch.addEventListener('characteristicvaluechanged', (e) => this.packet(key, e.target.value));
      await ch.startNotifications();
    }
    // valores iniciales sin esperar a la primera notificación
    for (const key of ['status', 'vitals', 'card', 'watch']) {
      try { this.packet(key, await this.chars[key].readValue()); } catch { /* opcional */ }
    }
    this.retry = 0;
    this.emit('link', { state: 'connected', name: this.name });
  }

  onDrop() {
    this.chars = {};
    if (!this.wanted) { this.emit('link', { state: 'disconnected' }); return; }
    // se cortó solo: reintentos con espera creciente, sin volver a pedir permiso
    const wait = Math.min(15000, 1000 * 2 ** this.retry);
    this.retry += 1;
    this.emit('link', { state: 'reconnecting', inMs: wait, attempt: this.retry });
    this.timer = setTimeout(() => this.connect().catch(() => this.onDrop()), wait);
  }

  async send(cmd) {
    const ch = this.chars.control;
    if (!ch) return false;
    const data = new Uint8Array([cmd]);
    try {
      if (ch.writeValueWithResponse) await ch.writeValueWithResponse(data);
      else await ch.writeValue(data);
      return true;
    } catch { return false; }
  }

  disconnect() {
    this.wanted = false;
    clearTimeout(this.timer);
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    else this.emit('link', { state: 'disconnected' });
  }
}

/* ------------------------------------------------------- simulada -- */

const RATE = 25; // muestras por segundo, como el MAX3010x del firmware

export class SimLink extends Emitter {
  constructor({ seed = 7 } = {}) {
    super();
    this.kind = 'sim';
    this.name = 'Estación simulada';
    this.s = seed;
    this.finger = false;
    this.fingerSince = 0;
    this.card = null;
    this.watchOn = false; // la estación simulada no usa reloj
    this.bpm = 64;
    this.targetBpm = 64;
    this.spo2 = 98;
    this.phase = 0;
    this.n = 0;
    this.hp = null;
    this.seq = 0;
    this.waveSeq = 0;
    this.watchSpo2At = null;
    this.timers = [];
    this.body = new SimBody(seed + 4);
    this.t = 0; // segundos de simulación
  }

  rnd() { this.s = (this.s * 16807) % 2147483647; return this.s / 2147483647; }
  gauss() { return (this.rnd() + this.rnd() + this.rnd() - 1.5) * 1.15; }

  // controles del panel de simulación
  setFinger(on) { if (on !== this.finger) { this.finger = on; this.fingerSince = performance.now(); } }
  tapCard(uid) { this.card = { uid, at: performance.now() }; this.emitCard(true); }
  setProfile({ bpm, spo2 }) { if (bpm) this.targetBpm = bpm; if (spo2) this.spo2 = spo2; }
  /** Fisiología de la persona (pulso, HRV, tensión…) y escenario de la simulación ampliada. */
  setBody(base) { this.body.setBase(base); this.body.settle(); this.bpm = this.body.cur.hr; this.targetBpm = this.body.target.hr; this.spo2 = this.body.target.spo2; }
  setScenario(key, { instant = false } = {}) { this.body.setScenario(key); if (instant) { this.body.settle(); this.bpm = this.body.cur.hr; } this.targetBpm = this.body.target.hr; this.spo2 = this.body.target.spo2; this.slow(); }
  get scenario() { return this.body.scenario || 'rest'; }
  setWatch(on) { this.watchOn = on; this.slow(); }

  async connect() {
    this.emit('link', { state: 'connecting', attempt: 0 });
    await new Promise((r) => setTimeout(r, 650)); // como un enlace de verdad, no instantáneo
    this.timers.push(setInterval(() => this.fast(), 120));
    this.timers.push(setInterval(() => this.slow(), 1000));
    this.packet('status', encodeStatus({ arduino: true, aht: true, bmp: true, ppg: true, rfid: true, test: true, watch: this.watchOn }));
    this.emit('ext-status', { ecg: true, ir: true, eda: true, grip: true, co2: true, dosimeter: true });
    this.slow();
    this.emit('link', { state: 'connected', name: this.name });
  }

  fast() {
    // 120 ms: 30 muestras de ECG (250 Hz) y 3 de la onda del dedo (25 Hz), del mismo latido
    const b = this.body;
    b.step(0.12);
    const ecg = b.ecg(Math.round(ECG_RATE * 0.12));
    this.bpm = b.cur.hr;
    const out = [];
    for (let i = 0; i < 3; i++) {
      const t = (b.n - 30 + i * 10) / ECG_RATE;
      let ir;
      if (this.finger) {
        let beat = 0;
        for (const bt of b.beats) { const x = t - bt.t - b.ptt; if (x > -0.1 && x < 0.8) beat += Math.exp(-((x - 0.09) ** 2) / 0.004) + 0.35 * Math.exp(-((x - 0.33) ** 2) / 0.006); }
        const drift = 300 * Math.sin((2 * Math.PI * 0.22 * this.n) / RATE);
        ir = 102000 + drift - 850 * beat + this.gauss() * 35;
      } else {
        ir = 900 + this.gauss() * 20;
      }
      this.n += 1;
      this.hp = this.hp == null || Math.abs(ir - this.hp) > 50000 ? ir : this.hp + (ir - this.hp) / 12;
      out.push(-(ir - this.hp) * 4);
    }
    this.waveSeq = (this.waveSeq + 1) & 0xff;
    this.packet('wave', encodeWave(this.waveSeq, out));
    // los asideros miden el ECG cuando se agarran (con el dedo puesto) — en la simulación, siempre
    this.emit('ecg', { samples: ecg, rate: ECG_RATE, contact: true });
  }

  slow() {
    const t = performance.now() / 1000;
    const on = this.finger ? (performance.now() - this.fingerSince) / 1000 : 0;
    const quality = !this.finger ? 'no-finger' : on < 4 ? 'collecting' : 'good';
    this.seq = (this.seq + 1) & 0xff;
    this.packet('vitals', encodeVitals(this.seq, {
      quality,
      bpm: quality === 'good' ? Math.round(this.bpm + this.gauss()) : null,
      spo2: quality === 'good' && on > 6 ? Math.round(this.body.cur.spo2 + this.gauss() * 0.4) : null,
      temperature: 22.4 + 0.3 * Math.sin(t / 120) + this.gauss() * 0.03,
      humidity: 41 + Math.sin(t / 90),
      pressure: 1012.6 + 0.2 * Math.sin(t / 300),
    }));
    let w = null;
    if (this.watchOn) {
      const measuring = this.watchSpo2At != null && performance.now() - this.watchSpo2At < 30000;
      w = {
        bpm: Math.round(this.bpm + this.gauss() * 1.2), skin: 33.6 + (this.body.cur.temp - 36.6) * 0.6 + this.gauss() * 0.05, battery: 78,
        spo2: this.watchSpo2At != null && !measuring ? 97 : null, spo2Measuring: measuring,
        ibi: Math.round(60000 / this.bpm),
      };
    }
    this.packet('watch', encodeWatch(w));
    this.emit('ext', this.body.readings());
    this.emitCard(false);
  }

  emitCard(fresh) {
    if (!this.card) return;
    const age = Math.round((performance.now() - this.card.at) / 1000);
    if (age > 30) { this.card = null; this.packet('card', encodeCard(null)); return; }
    if (fresh) this.packet('card', encodeCard({ uid: this.card.uid, age }));
  }

  async send(cmd) {
    if (cmd === CMD.watchSpo2 && this.watchOn) { this.watchSpo2At = performance.now(); this.slow(); return true; }
    if (cmd === CMD.resend) { this.slow(); return true; }
    return false;
  }

  disconnect() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.emit('link', { state: 'disconnected' });
  }
}

/* ------------------------------------------------------------- WiFi -- */
// La Raspberry sirve la app y emite las lecturas por Server-Sent Events en
// /api/stream (sensors/bridge.py --lan). Ya llegan descodificadas, con la misma
// forma que dan los descodificadores del protocolo Bluetooth.

export const wifiAvailable = () => typeof location !== 'undefined'
  && (location.port === '8765' || new URLSearchParams(location.search).has('wifi'));

export class WifiLink extends Emitter {
  constructor(base = '/api/') {
    super();
    this.kind = 'wifi';
    this.name = 'XPaze Station (WiFi)';
    this.base = base;
    this.es = null;
  }

  connect() {
    this.emit('link', { state: 'connecting', attempt: 0 });
    return new Promise((resolve, reject) => {
      let opened = false;
      this.es = new EventSource(`${this.base}stream`);
      const timer = setTimeout(() => { if (!opened) { this.es.close(); reject(new Error('La estación no responde por WiFi.')); } }, 8000);
      this.es.onopen = () => {
        if (!opened) { opened = true; clearTimeout(timer); resolve(); }
        this.emit('link', { state: 'connected', name: this.name });
      };
      this.es.onmessage = (e) => {
        try { const ev = JSON.parse(e.data); if (ev.type in DECODERS) this.emit(ev.type, ev.data); } catch { /* línea corrupta */ }
      };
      this.es.onerror = () => { if (opened) this.emit('link', { state: 'reconnecting', attempt: 1 }); };
    });
  }

  async send(cmd) {
    try {
      const r = await fetch(`${this.base}cmd`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd }) });
      return r.ok;
    } catch { return false; }
  }

  disconnect() {
    this.es?.close();
    this.es = null;
    this.emit('link', { state: 'disconnected' });
  }
}
