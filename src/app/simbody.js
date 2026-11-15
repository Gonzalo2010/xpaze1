// Cuerpo simulado de la XPaze Station (estación en la nube).
// Genera, latido a latido, un ECG de una derivación (asideros), la onda de pulso del dedo
// y las lecturas de los sensores ampliados de la estación v2:
//   ECG · temperatura corporal sin contacto (IR) · respiración · HRV · QTc ·
//   tensión estimada por tiempo de tránsito del pulso (PTT) · actividad electrodérmica (EDA) ·
//   fuerza de agarre (células de carga de los asideros) · CO₂ de cabina · dosímetro.
// El prototipo físico NO tiene estos sensores; aquí se simulan con valores fisiológicos publicados.
// Las cifras derivadas (pulso, RMSSD, ritmo) no se copian del escenario: se CALCULAN a partir de
// los latidos generados con las mismas funciones que usaría el hardware (analyzeRR).

export const ECG_RATE = 250; // muestras por segundo

// Escenarios: qué le pasa al cuerpo (y a la cabina). base = valores de la persona.
export const SCENARIOS = {
  rest: (b) => ({ ...b }),
  exercise: (b) => ({ ...b, hr: 112, rr: 22, temp: b.temp + 0.4, rmssd: 14, eda: 9, sys: b.sys + 18 }),
  fever: (b) => ({ ...b, hr: b.hr + 24, temp: 38.7, rr: 22, rmssd: 18, spo2: 96, eda: 6 }),
  lowo2: (b) => ({ ...b, hr: b.hr + 8, spo2: 91, rr: 21 }),
  af: (b) => ({ ...b, hr: 104, rhythm: 'af', rmssd: 90 }),
  pvc: (b) => ({ ...b, rhythm: 'pvc' }),
  qt: (b) => ({ ...b, qtc: 505 }),
  stress: (b) => ({ ...b, hr: b.hr + 12, rmssd: Math.round(b.rmssd * 0.5), eda: 11, rr: 19, sys: b.sys + 10 }),
  // Día 58: tres noches durmiendo poco. Nada sale de los rangos generales, pero todo se aleja de SU normal.
  day58: (b) => ({ ...b, hr: b.hr + 13, rmssd: Math.round(b.rmssd * 0.55), eda: 8, temp: b.temp + 0.2, grip: Math.round(b.grip * 0.9) }),
  co2: (b) => ({ ...b, co2: 4.2, rr: 19, hr: b.hr + 4 }),
  spe: (b) => ({ ...b, dose: 420, eda: 7, hr: b.hr + 6 }),
};

export const BASE = { hr: 62, spo2: 98, temp: 36.6, rr: 14, rhythm: 'sinus', qtc: 410, rmssd: 48, eda: 3, grip: 42, sys: 118, dia: 76, co2: 2.1, dose: 18, glu: 92 };

/* --------------------------------------------------- análisis de los latidos -- */
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

/**
 * Analiza intervalos RR (en ms): pulso, RMSSD, extrasístoles y ritmo.
 * Ritmo: 'sinus' · 'ectopics' (latidos prematuros con pausa compensadora) · 'irregular'
 * (irregularidad sostenida sin patrón, compatible con fibrilación auricular) · null si faltan latidos.
 */
export function analyzeRR(rr) {
  if (!rr || rr.length < 8) return { hr: null, rmssd: null, rhythm: null, ectopics: 0 };
  const med = median(rr);
  // latido prematuro: RR < 80 % de la mediana seguido de una pausa > 115 %
  let ectopics = 0;
  const clean = [];
  for (let i = 0; i < rr.length; i++) {
    if (i < rr.length - 1 && rr[i] < med * 0.8 && rr[i + 1] > med * 1.15) { ectopics++; i++; continue; }
    clean.push(rr[i]);
  }
  const diffs = clean.slice(1).map((x, i) => x - clean[i]);
  const rmssd = diffs.length ? Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length) : null;
  // irregularidad: diferencias sucesivas grandes en relación con el RR (pRR > 12 %)
  const big = diffs.filter((d) => Math.abs(d) > med * 0.12).length / Math.max(1, diffs.length);
  const rhythm = big > 0.45 ? 'irregular' : ectopics >= 2 ? 'ectopics' : 'sinus';
  const hr = Math.round(60000 / (rr.reduce((s, x) => s + x, 0) / rr.length));
  // en un ritmo irregular no tiene sentido contar «extrasístoles»: todos los latidos son irregulares
  return { hr, rmssd: rmssd != null ? Math.round(rmssd) : null, rhythm, ectopics: rhythm === 'irregular' ? 0 : ectopics };
}

/* -------------------------------------------------------------- el cuerpo -- */
export class SimBody {
  constructor(seed = 11) {
    this.s = seed;
    this.base = { ...BASE };
    this.target = { ...BASE };
    this.cur = { ...BASE };
    this.n = 0;             // muestras de ECG generadas
    this.beats = [];        // [{ t (s), kind: 'n'|'v'|'af' }]
    this.nextBeat = 0.4;
    this.pending = null;    // pausa compensadora tras una extrasístole
    this.sinceV = 0;
    this.rr = [];           // últimos RR en ms
    this.mission = 0;       // dosis acumulada en la sesión (µSv)
  }

  rnd() { this.s = (this.s * 16807) % 2147483647; return this.s / 2147483647; }
  gauss() { return (this.rnd() + this.rnd() + this.rnd() - 1.5) * 1.15; }

  setBase(b) { this.base = { ...BASE, ...b }; this.setScenario(this.scenario || 'rest'); }
  setScenario(key) {
    this.scenario = SCENARIOS[key] ? key : 'rest';
    this.target = SCENARIOS[this.scenario](this.base);
    if (this.cur.rhythm !== this.target.rhythm) { this.rr = []; this.pending = null; } // el análisis empieza de cero con el ritmo nuevo
    this.cur.rhythm = this.target.rhythm;
  }

  /** Respiración lenta guiada: el cuerpo responde (respiración a 6 rpm, pulso y EDA bajan, HRV sube). */
  breathe(on) {
    if (on) {
      this.saved = { ...this.target };
      this.target = { ...this.target, rr: 6, hr: Math.max(this.base.hr - 2, this.target.hr - 6), rmssd: this.target.rmssd * 1.35, eda: Math.max(this.base.eda, this.target.eda * 0.6), sys: this.target.sys - 4 };
    } else if (this.saved) {
      // al terminar queda algo más tranquilo que antes; la respiración vuelve a su ritmo
      this.target = { ...this.saved, hr: (this.saved.hr + this.target.hr) / 2, eda: (this.saved.eda + this.target.eda) / 2, rmssd: (this.saved.rmssd + this.target.rmssd) / 2 };
      this.saved = null;
    }
  }

  /** Salta directamente al escenario (modo demo): sin transición y con los latidos recientes reiniciados. */
  settle() {
    this.cur = { ...this.target };
    // latidos recientes ya con el ritmo del escenario, para que el análisis no arrastre el anterior
    this.rr = []; this.pending = null;
    let t = this.nextBeat;
    for (let i = 0; i < 30; i++) { const nx = this.schedule(t); this.rr.push(Math.round((nx.at - t) * 1000)); t = nx.at; }
    this.pending = null;
  }

  /** Avanza dt segundos los valores hacia el escenario (cambios graduales, como un cuerpo). */
  step(dt) {
    const k = 1 - Math.exp(-dt / 6);
    for (const p of ['hr', 'spo2', 'temp', 'rr', 'qtc', 'rmssd', 'eda', 'grip', 'sys', 'dia', 'co2', 'dose', 'glu']) {
      this.cur[p] += (this.target[p] - this.cur[p]) * (p === 'temp' ? k * 0.4 : k);
    }
    this.mission += (this.cur.dose / 3600) * dt;
  }

  /** Programa el siguiente latido según el ritmo. */
  schedule(t) {
    const c = this.cur;
    const rr0 = 60 / c.hr;
    if (this.pending != null) { const at = this.pending; this.pending = null; return { at, kind: 'n' }; }
    if (c.rhythm === 'af') return { at: t + rr0 * (0.62 + this.rnd() * 0.76), kind: 'af' };
    if (c.rhythm === 'pvc' && ++this.sinceV >= 5 + Math.floor(this.rnd() * 4)) {
      this.sinceV = 0;
      this.pending = t + rr0 * 2; // pausa compensadora completa
      return { at: t + rr0 * 0.62, kind: 'v' };
    }
    // sinusal: arritmia respiratoria + variabilidad latido a latido (σ ≈ RMSSD/√2)
    const resp = 0.012 * Math.sin(2 * Math.PI * (c.rr / 60) * t);
    const sd = c.rmssd / 1000 / Math.SQRT2;
    return { at: t + Math.max(0.3, rr0 * (1 + resp) + (this.gauss() / 0.575) * sd * 0.92), kind: 'n' }; // gauss() tiene σ ≈ 0,575
  }

  /** Valor del ECG (mV aprox.) en el instante t. */
  ecgAt(t) {
    const c = this.cur;
    let v = 0;
    for (const b of this.beats) {
      const x = t - b.t;
      if (x < -0.3 || x > 0.7) continue;
      const g = (a, mu, w) => a * Math.exp(-((x - mu) ** 2) / (2 * w * w));
      const rrS = 60 / c.hr;
      const qt = (c.qtc / 1000) * Math.sqrt(rrS); // Bazett: QT = QTc·√RR
      if (b.kind === 'v') {
        v += g(1.25, 0, 0.032) + g(-0.55, 0.075, 0.03) + g(-0.42, qt * 0.85, 0.07);
      } else {
        if (b.kind === 'n') v += g(0.12, -0.16, 0.024);
        v += g(-0.1, -0.028, 0.009) + g(1.0, 0, 0.011) + g(-0.24, 0.03, 0.011) + g(0.3, qt - 0.13, 0.048);
      }
    }
    v += 0.05 * Math.sin(2 * Math.PI * (c.rr / 60) * t); // deriva respiratoria
    if (c.rhythm === 'af') v += 0.035 * Math.sin(2 * Math.PI * 6.3 * t + Math.sin(t * 1.7) * 2) + this.gauss() * 0.012;
    return v + this.gauss() * 0.012;
  }

  /** Genera count muestras de ECG; devuelve [] de mV. Lleva el reloj de los latidos. */
  ecg(count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = this.n / ECG_RATE;
      if (t >= this.nextBeat) {
        const last = this.beats.at(-1);
        this.beats.push({ t: this.nextBeat, kind: this.cur.rhythm === 'af' ? 'af' : (this.lastKind || 'n') });
        if (last) this.rr.push(Math.round((this.nextBeat - last.t) * 1000));
        if (this.rr.length > 40) this.rr.shift();
        if (this.beats.length > 4) this.beats.shift();
        const nx = this.schedule(this.nextBeat);
        this.nextBeat = nx.at; this.lastKind = nx.kind;
      }
      out.push(this.ecgAt(t));
      this.n += 1;
    }
    return out;
  }

  /** Manguito automático (oscilométrico): una medida con su ruido. */
  cuff() { return { sys: Math.round(this.cur.sys + this.gauss() * 3), dia: Math.round(this.cur.dia + this.gauss() * 2) }; }
  /** Glucómetro conectado (mg/dL). */
  glucose() { return Math.round((this.cur.glu ?? 92) + this.gauss() * 4); }

  /** Último latido (s) y tiempo de tránsito del pulso hasta el dedo (s), para sincronizar la onda del dedo. */
  get lastBeat() { return this.beats.at(-1)?.t ?? 0; }
  get ptt() { return (250 - (this.cur.sys - 120) * 0.9) / 1000; } // PTT baja cuando sube la tensión

  /** Lecturas derivadas (lo que la estación v2 enviaría cada segundo). */
  readings() {
    const c = this.cur;
    const a = analyzeRR(this.rr.slice(-30));
    const pttMs = Math.round(this.ptt * 1000 + this.gauss() * 3);
    return {
      ecgHr: a.hr, rmssd: a.rmssd, rhythm: a.rhythm, ectopics: a.ectopics,
      qtc: Math.round(c.qtc + this.gauss() * 4),
      temp: Math.round((c.temp + this.gauss() * 0.04) * 10) / 10,
      rr: Math.round(c.rr + this.gauss() * 0.6),
      ptt: pttMs,
      // estimación sin manguito: inversa del modelo de PTT, calibrada con la tensión de la ficha
      bpEst: { sys: Math.round(120 - (pttMs - 250) / 0.9), dia: Math.round(c.dia + this.gauss()) },
      eda: Math.round((c.eda + this.gauss() * 0.3) * 10) / 10,
      grip: Math.round(c.grip + this.gauss() * 0.8),
      co2: Math.round((c.co2 + this.gauss() * 0.04) * 100) / 100,
      dose: Math.round(c.dose + this.gauss() * 1.5),
      mission: Math.round(this.mission * 10) / 10,
    };
  }
}
