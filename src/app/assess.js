// Interpreta un chequeo: compara a la persona consigo misma.
// Con 5 chequeos propios o más, usa su línea base (mediana + MAD, z robusto).
// Antes, la referencia de su ficha de tripulación; si no hay ficha, el rango
// de la población. No diagnostica: describe cambios y sugiere qué hacer.

import { median, robustZ } from '../demo/core/engine/stats.js';

export const MIN_PERSONAL = 5;
export const Z_WATCH = 2.5;
export const Z_ALERT = 3.5;
const CREW_SCALE = 4;     // lpm: variación típica del pulso en reposo entre días
const HR_FLOOR = 2.5;     // escala mínima con la línea base personal

// Resume las lecturas de una medición en un único valor por señal.
export function summarize(samples) {
  const pick = (k) => samples.map((s) => s[k]).filter((v) => Number.isFinite(v));
  const med = (k) => { const v = pick(k); return v.length ? median(v) : null; };
  return {
    bpm: med('bpm') != null ? Math.round(med('bpm')) : null,
    spo2: med('spo2') != null ? Math.round(med('spo2')) : null,
    watchBpm: med('watchBpm') != null ? Math.round(med('watchBpm')) : null,
    skin: med('skin'),
    temperature: med('temperature'),
    humidity: med('humidity'),
    pressure: med('pressure'),
    goodSamples: pick('bpm').length,
  };
}

export function assess(reading, { history = [], crew = null } = {}) {
  const lines = [];
  const actions = [];
  let level = 0; // 0 normal · 1 a vigilar · 2 alerta
  const raise = (l) => { level = Math.max(level, l); };

  if (reading.bpm == null) {
    return {
      status: 'unreliable', baseline: null, z: null,
      lines: ['No se ha conseguido una señal de pulso estable.'],
      actions: ['Apoya el dedo sin apretar, quédate quieto y repite el chequeo.'],
    };
  }

  // ---- referencia
  const past = history.map((h) => h.bpm).filter((v) => Number.isFinite(v));
  let baseline;
  let z = null;
  if (past.length >= MIN_PERSONAL) {
    baseline = { source: 'personal', hr: Math.round(median(past)), n: past.length };
    z = robustZ(reading.bpm, past, HR_FLOOR);
  } else if (crew) {
    baseline = { source: 'crew', hr: crew.hr, n: past.length };
    z = (reading.bpm - crew.hr) / CREW_SCALE;
  } else {
    baseline = { source: 'population', hr: null, n: past.length };
  }

  // ---- pulso
  if (z != null) {
    const diff = reading.bpm - baseline.hr;
    const pct = Math.round((Math.abs(diff) / baseline.hr) * 100);
    const ref = baseline.source === 'personal' ? 'tu normal' : 'la referencia de tu ficha';
    if (z >= Z_ALERT) {
      raise(2);
      lines.push(`Pulso en reposo de ${reading.bpm} lpm: un ${pct} % por encima de ${ref} (${baseline.hr} lpm).`);
    } else if (z >= Z_WATCH) {
      raise(1);
      lines.push(`Pulso en reposo algo alto: ${reading.bpm} lpm frente a ${baseline.hr} lpm de ${ref}.`);
    } else if (z <= -Z_ALERT) {
      raise(1);
      lines.push(`Pulso más bajo de lo habitual: ${reading.bpm} lpm frente a ${baseline.hr} lpm. Si estás bien y descansado, puede ser normal.`);
    } else {
      lines.push(`Pulso de ${reading.bpm} lpm, dentro de ${ref} (${baseline.hr} lpm).`);
    }
  } else if (reading.bpm > 100 || reading.bpm < 50) {
    raise(1);
    lines.push(`Pulso de ${reading.bpm} lpm, fuera del rango habitual en reposo (50–100 lpm).`);
  } else {
    lines.push(`Pulso de ${reading.bpm} lpm, dentro del rango habitual en reposo.`);
  }

  // ---- oxígeno (estimación sin calibrar: umbrales prudentes)
  if (reading.spo2 != null) {
    if (reading.spo2 < 92) {
      raise(2);
      lines.push(`Oxígeno estimado bajo: ${reading.spo2} %.`);
    } else if (reading.spo2 < 95) {
      raise(1);
      lines.push(`Oxígeno estimado algo bajo: ${reading.spo2} %.`);
    } else {
      lines.push(`Oxígeno estimado de ${reading.spo2} %, normal.`);
    }
  }

  // ---- reloj: segunda fuente del pulso
  if (reading.watchBpm != null && Math.abs(reading.watchBpm - reading.bpm) > 12) {
    lines.push(`El reloj marca ${reading.watchBpm} lpm y la estación ${reading.bpm}: no coinciden, conviene repetir.`);
    raise(Math.max(level, 1));
  }

  // ---- cabina: contexto, no salud
  if (reading.temperature != null && (reading.temperature > 27 || reading.temperature < 17)) {
    lines.push(`Ojo con la cabina: ${reading.temperature.toFixed(1)} °C puede influir en la medida.`);
  }

  if (level === 2) {
    actions.push('Descansa sentado cinco minutos y repite el chequeo.');
    actions.push('Si se mantiene o notas síntomas, avisa al responsable médico de a bordo.');
  } else if (level === 1) {
    actions.push('Repite el chequeo dentro de una hora, en reposo.');
  } else {
    actions.push('Nada que hacer. Cada chequeo afina tu línea base.');
  }
  if (baseline.source !== 'personal' && MIN_PERSONAL - baseline.n - 1 > 0) {
    const left = MIN_PERSONAL - baseline.n - 1; // este chequeo ya cuenta
    lines.push(`Faltan ${left} ${left === 1 ? 'chequeo' : 'chequeos'} para tener tu propia línea base.`);
  }

  return { status: ['normal', 'watch', 'alert'][level], baseline, z, lines, actions };
}
