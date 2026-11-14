// Puente tolerante con el módulo de psicología (src/demo/psych/index.js, de Codex).
// Si el fichero aún no existe o falla, la demo sigue funcionando sin él.

import { t } from './i18n.js';

const candidates = import.meta.glob('../psych/index.js');
let mod = null;
let pending = null;

export function loadPsych() {
  if (!pending) {
    const loader = Object.values(candidates)[0];
    pending = loader
      ? loader().then((m) => { mod = m; return m; }).catch((e) => { console.warn('[xpaze] módulo de psicología no disponible:', e); return null; })
      : Promise.resolve(null);
  }
  return pending;
}

export const psychReady = () => !!mod;

// { status:'ok'|'watch'|'alert'|'nodata', label, factors:[], shared:boolean } | null
export function psychSummary(astronautId) {
  try {
    const s = mod?.summary?.(astronautId);
    if (!s || typeof s !== 'object' || typeof s.then === 'function') return null;
    return {
      status: ['ok', 'watch', 'alert', 'nodata'].includes(s.status) ? s.status : 'nodata',
      label: text(s.label), factors: Array.isArray(s.factors) ? s.factors : [], shared: s.shared !== false,
    };
  } catch (e) { console.warn('[xpaze] psych.summary:', e); return null; }
}

export function psychContribute(astronautId) {
  try {
    const r = mod?.contribute?.(astronautId);
    const list = Array.isArray(r) ? r : Array.isArray(r?.factors) ? r.factors : [];
    return list.map(factorText).filter(Boolean);
  } catch (e) { console.warn('[xpaze] psych.contribute:', e); return []; }
}

export function psychScenario(name, astronautId) {
  try {
    if (typeof mod?.onScenario !== 'function') return false;
    mod.onScenario(name, astronautId);
    return true;
  } catch (e) { console.warn('[xpaze] psych.onScenario:', e); return false; }
}

// Un texto puede llegar ya traducido o como clave de diccionario.
function text(v) {
  return typeof v === 'string' ? t(v) : '';
}

// Un factor puede ser un texto o un objeto { text | label | key + vars }.
export function factorText(f) {
  if (!f) return '';
  if (typeof f === 'string') return t(f);
  if (typeof f.text === 'string') return f.text;
  if (typeof f.label === 'string') return t(f.label, f.vars);
  if (typeof f.key === 'string') return t(f.key, f.vars);
  return '';
}
