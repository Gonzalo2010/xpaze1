// Simulador de señales de la XPaze Station y los algoritmos que las miden.
// Lo simulado: la forma de onda. Lo real: la detección de latidos, la HRV,
// la estimación de SpO2 y la calidad de señal se calculan sobre esas muestras.

import { clamp, mean, median } from './stats.js';

/* ---------------------------------------------------------------- ECG -- */

// Intervalos RR (s) con arritmia sinusal respiratoria y variación latido a latido.
// Se escalan para que la RMSSD de la serie sea la HRV pedida.
export function makeRR({ hr, hrv, durationS, rng }) {
  const mu = 60 / hr;
  const n = Math.ceil(durationS / mu) + 4;
  const phase = rng.next() * Math.PI * 2;
  let raw = [];
  for (let i = 0; i < n; i++) raw.push(Math.sin(2 * Math.PI * 0.25 * i * mu + phase) + 0.6 * rng.gauss());
  // se normaliza sobre los latidos que caben en la ventana de medida
  const m = Math.max(4, Math.min(n, Math.floor((durationS - 0.6) / mu)));
  const mIn = mean(raw.slice(0, m));
  raw = raw.map((v) => v - mIn);
  let s = 0;
  for (let i = 1; i < m; i++) s += (raw[i] - raw[i - 1]) ** 2;
  const rmssd = Math.sqrt(s / (m - 1)) || 1;
  const k = hrv / 1000 / rmssd;
  return raw.map((v) => clamp(mu + v * k, 0.3, 2));
}

// Ondas P-Q-R-S-T como suma de gaussianas: [retardo (s), amplitud (mV), anchura (s)]
const WAVES = (s) => [
  [-0.17, 0.11, 0.022],
  [-0.028, -0.1, 0.009],
  [0, 1.0, 0.0095],
  [0.03, -0.2, 0.011],
  [0.27 * s, 0.28, 0.05 * s],
];

// contact: 'good' | 'poor' (manos mal apoyadas en los asideros de cobre)
export function synthECG({ hr, hrv, durationS = 20, fs = 250, rng, contact = 'good' }) {
  const rr = makeRR({ hr, hrv, durationS, rng });
  const n = Math.round(durationS * fs);
  const x = new Float32Array(n);
  const beats = [];
  let t0 = 0.3 + rng.next() * 0.3;
  const poor = contact === 'poor';
  for (let i = 0; i < rr.length && t0 < durationS + 0.5; i++) {
    beats.push(t0);
    const s = Math.sqrt(clamp(rr[i], 0.4, 1.4));
    const gain = (poor ? 0.32 : 1) * (1 + 0.04 * rng.gauss());
    for (const [dt, a, w] of WAVES(s)) {
      const c = t0 + dt;
      const from = Math.max(0, Math.floor((c - 4 * w) * fs));
      const to = Math.min(n - 1, Math.ceil((c + 4 * w) * fs));
      for (let j = from; j <= to; j++) x[j] += gain * a * Math.exp(-0.5 * ((j / fs - c) / w) ** 2);
    }
    t0 += rr[i];
  }
  const p1 = rng.next() * 6, p2 = rng.next() * 6;
  let burst = 0;
  for (let j = 0; j < n; j++) {
    const t = j / fs;
    let v = 0.05 * Math.sin(2 * Math.PI * 0.22 * t + p1) + 0.02 * Math.sin(2 * Math.PI * 0.07 * t + p2);
    v += 0.008 * Math.sin(2 * Math.PI * 50 * t);
    v += 0.012 * rng.gauss();
    if (poor) {
      v += 0.45 * Math.sin(2 * Math.PI * 0.6 * t + p2) + 0.2 * rng.gauss();
      if (burst > 0) { v += 0.9 * rng.gauss(); burst--; } else if (rng.next() < 0.0016) burst = Math.round(fs * 0.25);
    }
    x[j] += v;
  }
  return { fs, samples: x, beats, rr };
}

function movingAverage(x, n, win) {
  const out = new Float32Array(n);
  const half = Math.max(1, Math.floor(win / 2));
  let s = 0, count = 0, lo = 0, hi = -1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n - 1, i + half);
    while (hi < b) { hi++; s += x[hi]; count++; }
    while (lo < a) { s -= x[lo]; lo++; count--; }
    out[i] = s / count;
  }
  return out;
}

// Detector de picos R al estilo Pan-Tompkins: quitar la deriva, derivar,
// elevar al cuadrado, integrar en ventana y umbral adaptativo con periodo refractario.
// Devuelve los instantes (s) con interpolación parabólica entre muestras.
export function detectRPeaks(x, fs, n = x.length) {
  if (n < fs * 0.6) return [];
  const base = movingAverage(x, n, Math.round(fs * 0.12));
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = x[i] - base[i];
  const sq = new Float32Array(n);
  for (let i = 1; i < n - 1; i++) { const d = y[i + 1] - y[i - 1]; sq[i] = d * d; }
  const integ = movingAverage(sq, n, Math.round(fs * 0.1));

  // umbral: fracción de la mediana de los máximos por tramos de 1,5 s
  const seg = Math.round(fs * 1.5);
  const maxima = [];
  for (let a = 0; a < n; a += seg) {
    let m = 0;
    for (let i = a; i < Math.min(n, a + seg); i++) if (integ[i] > m) m = integ[i];
    if (Math.min(n, a + seg) - a > seg * 0.5 || !maxima.length) maxima.push(m);
  }
  const thr = 0.3 * median(maxima);
  if (!(thr > 0)) return [];

  const refractory = Math.round(fs * 0.25);
  const look = Math.round(fs * 0.05);
  const peaks = [];
  let i = 0;
  while (i < n) {
    if (integ[i] > thr) {
      let j = i;
      while (j < n && integ[j] > thr) j++;
      let best = -1, bv = -Infinity;
      for (let k = Math.max(1, i - look); k < Math.min(n - 1, j + look); k++) if (y[k] > bv) { bv = y[k]; best = k; }
      if (best > 0) {
        const last = peaks[peaks.length - 1];
        if (last && best - last.i < refractory) {
          if (bv > last.v) peaks[peaks.length - 1] = { i: best, v: bv };
        } else peaks.push({ i: best, v: bv });
      }
      i = j;
    } else i++;
  }
  return peaks.map(({ i: k }) => {
    const a = y[k - 1], b = y[k], c = y[k + 1];
    const den = a - 2 * b + c;
    const off = den !== 0 ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0;
    return (k + off) / fs;
  });
}

// Pulso (lpm) y HRV (RMSSD, ms) a partir de los instantes de los latidos.
export function heartMetrics(peaks) {
  const rr = [];
  for (let i = 1; i < peaks.length; i++) rr.push(peaks[i] - peaks[i - 1]);
  if (rr.length < 2) return { hr: null, hrv: null, rr, plausible: 0 };
  const med = median(rr);
  const ok = rr.filter((v) => v > 0.3 && v < 2 && Math.abs(v - med) < 0.3 * med);
  const plausible = ok.length / rr.length;
  if (ok.length < 2) return { hr: null, hrv: null, rr, plausible };
  let s = 0, c = 0;
  for (let i = 1; i < rr.length; i++) {
    const a = rr[i - 1], b = rr[i];
    if (Math.abs(a - med) < 0.3 * med && Math.abs(b - med) < 0.3 * med) { s += (b - a) ** 2; c++; }
  }
  return { hr: 60 / mean(ok), hrv: c ? Math.sqrt(s / c) * 1000 : null, rr, plausible };
}

// Calidad de señal en [0, 1]: relación entre la altura del pico R y el ruido
// de alta frecuencia, por la fracción de latidos con ritmo plausible.
export function signalQuality(x, fs, n = x.length, peaks = detectRPeaks(x, fs, n)) {
  if (n < fs || peaks.length < 3) return 0.1;
  const hf = [];
  for (let i = 1; i < n - 1; i += 2) hf.push(Math.abs(x[i] - (x[i - 1] + x[i + 1]) / 2));
  const noise = (1.4826 * median(hf)) / Math.sqrt(1.5) || 1e-6;
  const amps = peaks.map((t) => {
    const k = clamp(Math.round(t * fs), 3, n - 4);
    let lo = Infinity;
    const a = Math.max(0, k - Math.round(fs * 0.06)), b = Math.min(n - 1, k + Math.round(fs * 0.06));
    for (let i = a; i <= b; i++) if (x[i] < lo) lo = x[i];
    return x[k] - lo;
  });
  const snr = median(amps) / noise;
  const qNoise = clamp((Math.log10(snr) - 0.6) / 0.9, 0, 1);
  const { plausible } = heartMetrics(peaks);
  return clamp(qNoise * plausible, 0, 1);
}

/* ---------------------------------------------------------------- PPG -- */

// Pulso óptico (MAX30102): canales rojo e infrarrojo. La relación de
// absorciones R = (ACr/DCr)/(ACir/DCir) depende de la saturación de oxígeno.
export function synthPPG({ beats, rr, spo2, durationS = 8, fs = 50, rng }) {
  const n = Math.round(durationS * fs);
  const ir = new Float32Array(n), red = new Float32Array(n);
  const ratio = (110 - spo2) / 25;
  const acIr = 0.02, acRed = ratio * acIr;
  const shape = (p) => Math.exp(-(((p - 0.18) / 0.09) ** 2)) + 0.42 * Math.exp(-(((p - 0.46) / 0.15) ** 2));
  const ph = rng.next() * 6;
  for (let j = 0; j < n; j++) {
    const t = j / fs;
    let pulse = 0;
    for (let b = 0; b < beats.length; b++) {
      const start = beats[b] + 0.18; // tiempo de tránsito del pulso hasta el dedo
      if (t >= start - 0.1 && t < start + 1.6) pulse += shape((t - start) / (rr[b] || 1));
    }
    const wander = 0.003 * Math.sin(2 * Math.PI * 0.2 * t + ph);
    ir[j] = 1.0 * (1 + acIr * pulse + wander) + 0.0002 * rng.gauss();
    red[j] = 0.8 * (1 + acRed * pulse + wander) + 0.0002 * rng.gauss();
  }
  return { fs, ir, red };
}

function acDc(x, fs, n) {
  const base = movingAverage(x, n, Math.round(fs * 1.2));
  let dc = 0, s = 0, c = 0;
  const pad = Math.round(fs * 0.6);
  for (let i = pad; i < n - pad; i++) { dc += x[i]; s += (x[i] - base[i]) ** 2; c++; }
  return { dc: dc / c, ac: Math.sqrt(s / c) };
}

// SpO2 por el método clásico de «ratio of ratios» con calibración lineal 110 − 25·R.
export function estimateSpO2(ir, red, fs, n = ir.length) {
  if (n < fs * 2.5) return { spo2: null, ratio: null, perfusion: null };
  const a = acDc(ir, fs, n), b = acDc(red, fs, n);
  const ratio = (b.ac / b.dc) / (a.ac / a.dc);
  return { spo2: clamp(110 - 25 * ratio, 70, 100), ratio, perfusion: (a.ac / a.dc) * 100 * 2.8 };
}

/* -------------------------------------------------------- Temperatura -- */

export const TEMP_WINDOW = [30, 60]; // mm: distancia válida para el MLX90614

// Acercamiento de la frente al sensor (lo mide el VL53L0X).
export function distanceAt(tS, wobble = 0) {
  return 45 + 110 * Math.exp(-tS / 0.7) + 3 * Math.sin(tS * 4 + wobble);
}

// Lectura sin contacto: cae con la distancia; se compensa con la distancia medida
// y la temperatura ambiente para estimar la temperatura corporal.
export function tempSensor({ core, distanceMm, ambientC = 22.5, rng }) {
  const skin = core - 2.6 + 0.08 * (ambientC - 22.5);
  const far = Math.max(0, distanceMm - 40);
  const object = skin - 0.018 * far + 0.04 * rng.gauss();
  const estimate = object + 0.018 * far + 2.6 - 0.08 * (ambientC - 22.5);
  return { object, estimate, distanceMm, valid: distanceMm >= TEMP_WINDOW[0] && distanceMm <= TEMP_WINDOW[1] };
}

/* ----------------------------------------------------------- Ambiente -- */

// AHT20 (temperatura y humedad) + BMP280 (presión). El CO2 llega de la
// telemetría del hábitat: la Station no lleva sensor de CO2.
export const CABIN_LIMITS = { co2: 4000, tempHi: 27, tempLo: 18 };

export function cabinEnv({ rng, fault = false }) {
  return {
    tempC: (fault ? 28.6 : 22.5) + 0.3 * rng.gauss(),
    humidity: (fault ? 58 : 45) + 2 * rng.gauss(),
    pressure: 1013 + 1.5 * rng.gauss(),
    co2: (fault ? 6200 : 2400) + 120 * rng.gauss(),
  };
}

export function cabinOut(c) {
  return {
    co2: c.co2 > CABIN_LIMITS.co2,
    temp: c.tempC > CABIN_LIMITS.tempHi || c.tempC < CABIN_LIMITS.tempLo,
  };
}
