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

export function assess(reading, { history = [], crew = null, lang = 'es' } = {}) {
  const L = (es, en) => (lang === 'en' ? en : es);
  const lines = [];
  const actions = [];
  let level = 0; // 0 normal · 1 a vigilar · 2 alerta
  const raise = (l) => { level = Math.max(level, l); };

  if (reading.bpm == null) {
    return {
      status: 'unreliable', baseline: null, z: null,
      lines: [L('No se ha conseguido una señal de pulso estable.', 'Could not get a stable pulse signal.')],
      actions: [L('Apoya el dedo sin apretar, quédate quieto y repite el chequeo.', 'Rest your finger without pressing, stay still and repeat the check-up.')],
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
    const ref = baseline.source === 'personal' ? L('tu normal', 'your normal') : L('la referencia de tu ficha', 'your crew-record reference');
    if (z >= Z_ALERT) {
      raise(2);
      lines.push(L(`Pulso en reposo de ${reading.bpm} lpm: un ${pct} % por encima de ${ref} (${baseline.hr} lpm).`, `Resting heart rate of ${reading.bpm} bpm: ${pct}% above ${ref} (${baseline.hr} bpm).`));
    } else if (z >= Z_WATCH) {
      raise(1);
      lines.push(L(`Pulso en reposo algo alto: ${reading.bpm} lpm frente a ${baseline.hr} lpm de ${ref}.`, `Resting heart rate slightly high: ${reading.bpm} bpm versus ${baseline.hr} bpm for ${ref}.`));
    } else if (z <= -Z_ALERT) {
      raise(1);
      lines.push(L(`Pulso más bajo de lo habitual: ${reading.bpm} lpm frente a ${baseline.hr} lpm. Si estás bien y descansado, puede ser normal.`, `Heart rate lower than usual: ${reading.bpm} bpm versus ${baseline.hr} bpm. If you feel well and rested, this can be normal.`));
    } else {
      lines.push(L(`Pulso de ${reading.bpm} lpm, dentro de ${ref} (${baseline.hr} lpm).`, `Heart rate of ${reading.bpm} bpm, within ${ref} (${baseline.hr} bpm).`));
    }
  } else if (reading.bpm > 100 || reading.bpm < 50) {
    raise(1);
    lines.push(L(`Pulso de ${reading.bpm} lpm, fuera del rango habitual en reposo (50–100 lpm).`, `Heart rate of ${reading.bpm} bpm, outside the usual resting range (50–100 bpm).`));
  } else {
    lines.push(L(`Pulso de ${reading.bpm} lpm, dentro del rango habitual en reposo.`, `Heart rate of ${reading.bpm} bpm, within the usual resting range.`));
  }

  // ---- oxígeno (estimación sin calibrar: umbrales prudentes)
  if (reading.spo2 != null) {
    if (reading.spo2 < 92) {
      raise(2);
      lines.push(L(`Oxígeno estimado bajo: ${reading.spo2} %.`, `Estimated oxygen low: ${reading.spo2}%.`));
    } else if (reading.spo2 < 95) {
      raise(1);
      lines.push(L(`Oxígeno estimado algo bajo: ${reading.spo2} %.`, `Estimated oxygen slightly low: ${reading.spo2}%.`));
    } else {
      lines.push(L(`Oxígeno estimado de ${reading.spo2} %, normal.`, `Estimated oxygen of ${reading.spo2}%, normal.`));
    }
  }

  // ---- reloj: segunda fuente del pulso
  if (reading.watchBpm != null && Math.abs(reading.watchBpm - reading.bpm) > 12) {
    lines.push(L(`El reloj marca ${reading.watchBpm} lpm y la estación ${reading.bpm}: no coinciden, conviene repetir.`, `The watch reads ${reading.watchBpm} bpm and the station ${reading.bpm}: they do not match, so repeat the measurement.`));
    raise(Math.max(level, 1));
  }

  // ---- cabina: contexto, no salud
  if (reading.temperature != null && (reading.temperature > 27 || reading.temperature < 17)) {
    lines.push(L(`Ojo con la cabina: ${reading.temperature.toFixed(1)} °C puede influir en la medida.`, `Check the cabin: ${reading.temperature.toFixed(1)} °C may affect the reading.`));
  }

  if (level === 2) {
    actions.push(L('Descansa sentado cinco minutos y repite el chequeo.', 'Rest seated for five minutes and repeat the check-up.'));
    actions.push(L('Si se mantiene o notas síntomas, avisa al responsable médico de a bordo.', 'If it persists or you notice symptoms, tell the on-board medical officer.'));
  } else if (level === 1) {
    actions.push(L('Repite el chequeo dentro de una hora, en reposo.', 'Repeat the check-up within an hour, at rest.'));
  } else {
    actions.push(L('Nada que hacer. Cada chequeo afina tu línea base.', 'Nothing to do. Each check-up refines your baseline.'));
  }
  if (baseline.source !== 'personal' && MIN_PERSONAL - baseline.n - 1 > 0) {
    const left = MIN_PERSONAL - baseline.n - 1; // este chequeo ya cuenta
    lines.push(L(`Faltan ${left} ${left === 1 ? 'chequeo' : 'chequeos'} para tener tu propia línea base.`, `${left} more ${left === 1 ? 'check-up' : 'check-ups'} until you have your own baseline.`));
  }

  return { status: ['normal', 'watch', 'alert'][level], baseline, z, lines, actions };
}
