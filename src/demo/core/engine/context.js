// Fusión de contexto: el mismo pulso significa cosas distintas en reposo,
// tras ejercicio o durmiendo. El reloj aporta el contexto; aquí se clasifica
// y se calcula qué desviación es la esperable.

import { clamp } from './stats.js';

// w = { activeMin10, cadence, lying, hour, hrWatch, hrRest }
export function classifyContext(w = {}) {
  const active = clamp((w.activeMin10 ?? 0) / 10, 0, 1);
  const hrUp = clamp(((w.hrWatch ?? 0) - (w.hrRest ?? 0)) / 30, -1, 1);
  const cadence = clamp((w.cadence ?? 0) / 120, 0, 1);
  const night = w.hour != null && (w.hour >= 23 || w.hour < 6) ? 1 : 0;
  const lying = w.lying ? 1 : 0;

  const scores = {
    exercise: 0.55 * active + 0.3 * Math.max(0, hrUp) + 0.15 * cadence,
    sleep: (0.5 * lying + 0.3 * night + 0.2 * Math.max(0, -hrUp * 3)) * (1 - active),
    rest: 0,
  };
  scores.rest = clamp(1 - Math.max(scores.exercise, scores.sleep) * 1.6, 0, 1);

  let context = 'rest';
  if (scores.exercise >= 0.45 && scores.exercise >= scores.sleep) context = 'exercise';
  else if (scores.sleep >= 0.5) context = 'sleep';

  const sorted = Object.values(scores).sort((a, b) => b - a);
  const confidence = clamp(0.5 + (sorted[0] - sorted[1]) * 0.6, 0.5, 0.99);

  const evidence = [];
  if (context === 'exercise') {
    evidence.push({ key: 'ctx.ev.active', vars: { min: Math.round(w.activeMin10 ?? 0) } });
    if (hrUp > 0.3) evidence.push({ key: 'ctx.ev.hrUp', vars: { bpm: Math.round((w.hrWatch ?? 0) - (w.hrRest ?? 0)) } });
  } else if (context === 'sleep') {
    if (lying) evidence.push({ key: 'ctx.ev.lying' });
    if (night) evidence.push({ key: 'ctx.ev.night' });
  } else {
    evidence.push({ key: 'ctx.ev.still', vars: { min: Math.round(w.activeMin10 ?? 0) } });
  }
  return { context, confidence, scores, evidence };
}

// Desviación esperable respecto al reposo y cuánto se ensancha la tolerancia.
export function expectedShift(context) {
  if (context === 'exercise') return { hr: 36, hrvMul: 0.45, temp: 0.4, spo2: -0.8, tol: 2.2 };
  if (context === 'sleep') return { hr: -6, hrvMul: 1.2, temp: -0.25, spo2: -0.3, tol: 1.3 };
  return { hr: 0, hrvMul: 1, temp: 0, spo2: 0, tol: 1 };
}

// Lleva una lectura a su equivalente en reposo para compararla con la línea base.
export function toRestEquivalent(measured, context) {
  const s = expectedShift(context);
  return {
    ...measured,
    hr: measured.hr - s.hr,
    hrv: measured.hrv / s.hrvMul,
    temp: measured.temp - s.temp,
    spo2: measured.spo2 - s.spo2,
  };
}
