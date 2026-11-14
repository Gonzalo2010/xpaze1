// Generador de explicaciones. Devuelve claves de texto + variables (sin idioma),
// para que la interfaz las muestre en español o en inglés.
// Los números van como { v, d } = valor y decimales.

import { METRICS, VITALS } from './crew.js';
import { CABIN_LIMITS } from './signals.js';

const n = (v, d = 0) => ({ v, d });

export function explain(r, { today, cabin }) {
  const lines = [];
  const actions = [];
  const push = (key, vars) => lines.push({ key, vars });

  if (r.status === 'unreliable') {
    return {
      headline: { key: 'head.unreliable' },
      lines: [{ key: 'line.unreliable', vars: { quality: n(Math.round(r.quality * 100)) } }],
      actions: [{ key: 'act.retry' }],
      auto: { key: 'auto.unreliable' },
    };
  }

  const headline = { key: r.status === 'normal' ? (r.context === 'exercise' ? 'head.normal.exercise' : 'head.normal') : `head.${r.status}.${r.pattern}` };

  // contexto
  if (r.context === 'exercise') push('line.ctx.exercise', { hr: n(today.hr) });

  // señales que más se apartan
  const moved = r.factors.filter((f) => Math.abs(f.z) >= 1.5).slice(0, 3);
  for (const f of moved) {
    const d = METRICS[f.metric].digits;
    push(f.delta >= 0 ? 'line.above' : 'line.below', {
      metric: f.metric, value: n(f.value, d), baseline: n(f.baseline, d),
      delta: n(Math.abs(f.delta), Math.max(d, f.metric === 'temp' ? 1 : d)), z: n(Math.abs(f.z), 1),
    });
  }
  if (!moved.length) push('line.allWithin', {});

  // lo que un umbral general habría dicho
  if (r.status !== 'normal') {
    const hidden = moved.find((f) => VITALS.includes(f.metric) && f.adverse >= 2.5 && f.popOut === 0);
    if (hidden) {
      const def = METRICS[hidden.metric];
      push('line.popMiss', { metric: hidden.metric, value: n(hidden.value, def.digits), lo: n(def.pop[0], def.digits), hi: n(def.pop[1], def.digits) });
    }
  } else if (r.context !== 'exercise') {
    const odd = r.factors.find((f) => VITALS.includes(f.metric) && f.popOut !== 0 && Math.abs(f.z) < 2);
    if (odd) {
      const def = METRICS[odd.metric];
      push(odd.popOut < 0 ? 'line.popFalseLow' : 'line.popFalseHigh', { metric: odd.metric, value: n(odd.value, def.digits), lo: n(def.pop[0], def.digits), hi: n(def.pop[1], def.digits) });
    }
  }

  // deriva sostenida
  for (const m of r.drifting || []) push('line.drift', { metric: m, days: n(Math.max(1, r.metrics[m].drift.days)) });

  // rareza conjunta
  if (r.iforest && r.forestFlag) push('line.forest', { score: n(r.iforest.score, 2), typical: n(r.iforest.typical, 2) });

  // cabina
  if (cabin && (r.cabinOut.co2 || r.cabinOut.temp)) {
    if (r.cabinOut.co2) push('line.cabin.co2', { co2: n(Math.round(cabin.co2 / 10) * 10), limit: n(CABIN_LIMITS.co2) });
    if (r.cabinOut.temp) push('line.cabin.temp', { temp: n(cabin.tempC, 1), limit: n(CABIN_LIMITS.tempHi) });
    push('line.cabin.shared', {});
  }

  // lectura del patrón
  if (r.status !== 'normal') push(`pattern.${r.pattern}`, {});

  // qué hacer
  const add = (key) => actions.push({ key });
  if (r.status === 'normal') add(r.context === 'exercise' ? 'act.repeatRest' : 'act.none');
  else {
    if (r.pattern === 'thermal') { add('act.repeat'); add('act.hydrate'); }
    if (r.pattern === 'sleep') { add('act.rest'); add('act.repeatTomorrow'); }
    if (r.pattern === 'strain') { add('act.reduceLoad'); add('act.breathe'); }
    if (r.pattern === 'cardio') { add('act.hydrate'); add('act.repeat'); }
    if (r.pattern === 'oxygen') { add('act.repeat'); add('act.checkCabin'); }
    if (r.pattern === 'generic' || r.pattern === 'unusual') add('act.repeat');
    if (r.cabinOut.co2 || r.cabinOut.temp) { if (!actions.some((x) => x.key === 'act.checkCabin')) add('act.checkCabin'); }
    if (r.status === 'anomaly') add('act.notifyMed');
  }

  return { headline, lines, actions, auto: { key: `auto.${r.status}` } };
}
