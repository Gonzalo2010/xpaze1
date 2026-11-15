// Historias de 30 días para cada persona simulada, tendencias frente a «tu normal»
// y el informe para el cirujano de vuelo. Funciones puras (se prueban en tests/story.test.js).

import { classify, ENVIRONMENTS } from './clinical.js';
import { baselineBand } from './charts.js';
import { L, locale } from './i18n.js';

export const SEED_VERSION = 6;
const DAY = 86400000;

// Lo que le pasa a cada persona en las últimas semanas (coherente con su ficha médica de ficción).
const STORIES = {
  vega: { hr: 58, rmssd: 62, temp: 36.5, grip: 41, sys: 114, dia: 73, glu: 90 },   // estable; las 3 últimas noches, poco sueño (día 58)
  iker: { hr: 66, rmssd: 45, temp: 36.7, grip: 46, sys: 117, dia: 74, glu: 95 },   // estrés antes de cada EVA (cada 7 días); mejora la última semana
  noa: { hr: 72, rmssd: 38, temp: 36.3, grip: 33, sys: 112, dia: 72, glu: 88 },    // turnos de noche: cada 4 días duerme poco
  amara: { hr: 49, rmssd: 85, temp: 36.2, grip: 44, sys: 108, dia: 68, glu: 86 },  // atleta: pulso bajo normal en ella; pierde fuerza de agarre
  default: { hr: 64, rmssd: 48, temp: 36.6, grip: 40, sys: 116, dia: 73, glu: 92 },
};

/** Fisiología de «hoy» para el cuerpo simulado, coherente con la historia de la persona. */
export function storyBody(storyKey) {
  const b = STORIES[storyKey] || STORIES.default;
  return { hr: b.hr, rmssd: b.rmssd, temp: b.temp, grip: storyKey === 'amara' ? Math.round(b.grip * 0.93) : b.grip, sys: b.sys, dia: b.dia, glu: b.glu, spo2: 98 };
}

function rng(seed) {
  let s = seed % 2147483647 || 7;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** 30 chequeos diarios simulados (uno por mañana) para una persona. */
export function seedStory(uid, storyKey, now = Date.now(), env = 'transit') {
  const b = STORIES[storyKey] || STORIES.default;
  const rnd = rng(uid.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const n = (sd) => (rnd() + rnd() + rnd() - 1.5) * sd * 1.7;
  const today = new Date(now); today.setHours(7, 30, 0, 0);
  const out = [];
  for (let i = 30; i >= 1; i--) {
    const k = 30 - i; // 0 … 29, de más antiguo a más reciente
    let hr = b.hr + n(1.6), rmssd = b.rmssd * 0.9 * (1 + n(0.1)), sleep = 7.5 + n(0.3), stress = 3 + n(0.8), eda = 3 + n(0.4), temp = b.temp + n(0.08), grip = b.grip + n(0.7), phq2 = rnd() < 0.15 ? 1 : 0;
    if (storyKey === 'vega' && i <= 3) { sleep = 5.4 + n(0.2); hr += 6 + (3 - i); rmssd *= 0.82; stress = 6; eda = 4.6; phq2 = 2; }
    if (storyKey === 'iker') {
      const eve = k % 7 === 5; // la víspera de cada EVA
      const better = i <= 7;
      if (eve) { stress = better ? 5 : 7.5; hr += better ? 4 : 9; rmssd *= better ? 0.85 : 0.65; eda = better ? 5 : 8.5; sleep = better ? 6.3 : 5.2; phq2 = better ? 1 : 2; }
      else if (!better) { stress += 1; }
    }
    if (storyKey === 'noa' && k % 4 === 3) { sleep = 4.6 + n(0.3); hr += 5; rmssd *= 0.8; stress = 5; }
    if (storyKey === 'amara') grip = b.grip * (1 - 0.0025 * k) + n(0.5); // −7 % en un mes
    const sys = Math.round(b.sys + n(4)), dia = Math.round(b.dia + n(3));
    const e = {
      at: today.getTime() - i * DAY + Math.round(n(0.3) * 3600000), env,
      bpm: Math.round(hr), spo2: Math.round(97.6 + n(0.5)), bp: { sys, dia }, glucose: Math.round(b.glu + n(5)),
      mind: { phq2, sleep: Math.round(Math.max(3.5, sleep) * 2) / 2, stress: Math.max(0, Math.min(10, Math.round(stress))) },
      temp: Math.round(temp * 10) / 10, resp: Math.round(14 + n(0.8)), rmssd: Math.round(rmssd), qtc: Math.round(410 + n(6)),
      rhythm: 'sinus', eda: Math.round(eda * 10) / 10, grip: Math.round(grip), flags: [], sim: true, seed: true,
    };
    const levels = resultsFromEntry(e).map((r) => r.level);
    e.overall = Math.max(0, ...levels);
    e.status = ['normal', 'watch', 'alert'][e.overall];
    out.push(e);
  }
  return out;
}

/** Recalcula el semáforo de un chequeo guardado (mismas reglas fijas que el chequeo). */
export function resultsFromEntry(e) {
  const r = [];
  const add = (id, v, display) => { if (v != null) r.push({ ...classify(id, v), display }); };
  add('hr', e.bpm, `${e.bpm} ${L('lpm', 'bpm')}`);
  add('spo2', e.spo2, `${e.spo2} %`);
  if (e.rhythm) r.push({ ...classify('rhythm', e.rhythm), display: { sinus: L('sinusal', 'sinus'), ectopics: L('extrasístoles', 'ectopics'), irregular: L('irregular', 'irregular') }[e.rhythm] || e.rhythm });
  add('qtc', e.qtc, `${e.qtc} ms`);
  add('temp', e.temp, `${e.temp?.toLocaleString(locale(), { minimumFractionDigits: 1 })} °C`);
  add('resp', e.resp, `${e.resp} rpm`);
  if (e.bp) r.push({ ...classify('bp', e.bp), display: `${e.bp.sys}/${e.bp.dia} mmHg` });
  add('glucose', e.glucose, `${e.glucose} mg/dL`);
  if (e.mind) r.push({ ...classify('mind', e.mind), display: `PHQ-2 ${e.mind.phq2}/6 · ${e.mind.sleep} h · ${L('estrés', 'stress')} ${e.mind.stress}/10` });
  return r;
}

/* ------------------------------------------------- qué ha cambiado -- */
const METRICS = [
  { k: 'bpm', get: (e) => e.bpm, es: 'pulso en reposo', en: 'resting heart rate', u: 'bpm', d: 0 },
  { k: 'rmssd', get: (e) => e.rmssd, es: 'HRV', en: 'HRV', u: 'ms', d: 0, lowBad: true },
  { k: 'sleep', get: (e) => e.mind?.sleep, es: 'sueño', en: 'sleep', u: 'h', d: 1, lowBad: true },
  { k: 'stress', get: (e) => e.mind?.stress, es: 'estrés', en: 'stress', u: '/10', d: 0 },
  { k: 'temp', get: (e) => e.temp, es: 'temperatura', en: 'temperature', u: '°C', d: 1 },
  { k: 'sys', get: (e) => e.bp?.sys, es: 'tensión sistólica', en: 'systolic pressure', u: 'mmHg', d: 0 },
  { k: 'eda', get: (e) => e.eda, es: 'actividad electrodérmica (estrés)', en: 'electrodermal activity (stress)', u: 'µS', d: 1 },
];
const f = (v, d) => v.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Cambios que importan: los últimos 3 chequeos frente a la banda de los anteriores (mediana ± 2,5 MAD),
 * patrones repetidos y tendencias lentas. Devuelve [{ level: 0|1|2, text }], lo más importante primero.
 */
export function trendInsights(history) {
  const h = (history || []).filter((e) => e && e.at).sort((a, b) => a.at - b.at);
  if (h.length < 8) return [];
  const recent = h.slice(-3), past = h.slice(0, -3);
  const out = [];
  for (const m of METRICS) {
    const u = m.u === 'bpm' ? L('lpm', 'bpm') : m.u;
    const sp = u.startsWith('/') ? '' : ' ';
    const band = baselineBand(past.map(m.get));
    const vals = recent.map(m.get).filter((v) => v != null);
    if (!band || vals.length < 2) continue;
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const high = avg > band.hi, low = avg < band.lo;
    if (!high && !low) continue;
    const bad = m.lowBad ? low : high;
    out.push({
      level: bad ? 1 : 0,
      text: L(`Tu ${m.es} de los últimos días (${f(avg, m.d)}${sp}${u}) está ${high ? 'por encima' : 'por debajo'} de tu normal (${f(band.lo, m.d)}–${f(band.hi, m.d)}${sp}${u}).`,
        `Your ${m.en} over the last few days (${f(avg, m.d)}${sp}${u}) is ${high ? 'above' : 'below'} your normal (${f(band.lo, m.d)}–${f(band.hi, m.d)}${sp}${u}).`),
    });
  }
  // pérdida lenta de fuerza: primera semana frente a la última
  const g = h.map((e) => e.grip).filter((v) => v != null);
  if (g.length >= 14) {
    const a = g.slice(0, 7).reduce((s, v) => s + v, 0) / 7, z = g.slice(-7).reduce((s, v) => s + v, 0) / 7;
    const pct = Math.round(((z - a) / a) * 100);
    if (pct <= -5) out.push({ level: 1, text: L(`Tu fuerza de agarre ha bajado un ${-pct} % en un mes: en microgravedad se pierde músculo. Revisa con el oficial médico tu plan de ejercicio de resistencia.`, `Your grip strength has dropped ${-pct}% in a month: muscle is lost in microgravity. Review your resistance training plan with the medical officer.`) });
  }
  // patrón repetido de días malos de sueño
  const shortSleep = h.slice(-14).filter((e) => e.mind?.sleep != null && e.mind.sleep < 6).length;
  if (shortSleep >= 3) out.push({ level: 1, text: L(`${shortSleep} de tus últimas 14 noches has dormido menos de 6 h.`, `You slept less than 6 h on ${shortSleep} of your last 14 nights.`) });
  // picos de estrés que se repiten (p. ej. antes de cada salida extravehicular)
  const peaks = h.slice(-30).filter((e) => (e.mind?.stress ?? 0) >= 7);
  if (peaks.length >= 3) {
    const days = peaks.map((e) => new Date(e.at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })).join(', ');
    out.push({ level: 1, text: L(`Tu estrés ha llegado a 7 o más ${peaks.length} veces este mes (${days}). ¿Coincide con algo que se repite? Paze puede ayudarte a prepararlo.`, `Your stress reached 7 or more ${peaks.length} times this month (${days}). Does it match something that repeats? Paze can help you prepare for it.`) });
  }
  // umbrales generales frente a tu normal (p. ej. una atleta con pulso bajo)
  const last = h.at(-1);
  const hrBand = baselineBand(past.map((e) => e.bpm));
  if (last?.bpm != null && hrBand && classify('hr', last.bpm).level > 0 && last.bpm >= hrBand.lo && last.bpm <= hrBand.hi) {
    out.push({ level: 0, text: L(`Tu pulso de ${last.bpm} lpm sale amarillo con los umbrales generales, pero es tu normal desde hace semanas.`, `Your heart rate of ${last.bpm} bpm is yellow by the general thresholds, but it has been your normal for weeks.`) });
  }
  // ritmo
  if (recent.some((e) => e.rhythm && e.rhythm !== 'sinus')) out.push({ level: 1, text: L('El ECG ha mostrado un ritmo distinto del sinusal en los últimos chequeos: que lo revise el oficial médico.', 'The ECG has shown a non-sinus rhythm in recent check-ups: have the medical officer review it.') });
  if (!out.length) out.push({ level: 0, text: L('Todo dentro de tu normal en los últimos días.', 'Everything within your normal over the last few days.') });
  return out.sort((a, b) => b.level - a.level);
}

/* ------------------------------------------------ informe para Tierra -- */
const COLOR = () => L(['VERDE', 'AMARILLO', 'ROJO'], ['GREEN', 'YELLOW', 'RED']);

export function reportText({ person, entry, results, plan, insights = [] }) {
  const env = ENVIRONMENTS[entry.env] || ENVIRONMENTS.transit;
  const when = new Date(entry.at).toLocaleString(locale(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const lines = [
    L('INFORME XPAZE · para el cirujano de vuelo', 'XPAZE REPORT · for the flight surgeon'),
    `${person?.name || '—'}${person?.role ? ` (${person.role})` : ''} · ${env.name} · ${when}`,
    `${L('Resultado global', 'Overall result')}: ${COLOR()[entry.overall ?? 0]}`,
    '',
    L('Medidas (umbrales fijos):', 'Measurements (fixed thresholds):'),
    ...results.map((r) => `- ${r.name}: ${r.display} → ${COLOR()[r.level]} · ${r.reason}`),
  ];
  if (entry.flags?.length) lines.push('', `${L('Señales de alarma', 'Warning signs')}: ${entry.flags.join(', ')}`);
  if (insights.length) lines.push('', L('Tendencias frente a su normal:', 'Trends versus their normal:'), ...insights.map((i) => `- ${i.text}`));
  if (plan?.now?.length) lines.push('', L('Guía aplicada:', 'Guidance applied:'), ...plan.now.map((x) => `- ${x}`));
  lines.push('', entry.sim ? L('Datos simulados (demo). XPaze no diagnostica.', 'Simulated data (demo). XPaze does not diagnose.') : L('XPaze no diagnostica.', 'XPaze does not diagnose.'));
  return lines.join('\n');
}
