// Idioma y textos. Contrato (ver SPEC): lang, t, register, onLangChange.
// Comparte la preferencia con la landing (misma clave de localStorage).

const KEY = 'xpaze-lang';
const dicts = { es: {}, en: {} };
const listeners = new Set();

function initial() {
  try {
    const saved = globalThis.localStorage?.getItem(KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch { /* sin almacenamiento */ }
  const nav = globalThis.navigator?.language || 'es';
  return nav.toLowerCase().startsWith('es') ? 'es' : 'en';
}

let current = initial();

export function lang() { return current; }

export function setLang(next) {
  if ((next !== 'es' && next !== 'en') || next === current) return;
  current = next;
  try { globalThis.localStorage?.setItem(KEY, next); } catch { /* sin almacenamiento */ }
  if (globalThis.document) globalThis.document.documentElement.lang = next;
  for (const fn of [...listeners]) {
    try { fn(next); } catch (e) { console.error(e); }
  }
}

// dict = { es: { clave: texto }, en: { clave: texto } }
export function register(dict) {
  Object.assign(dicts.es, dict?.es);
  Object.assign(dicts.en, dict?.en);
}

export function has(key) { return key in dicts[current] || key in dicts.es; }

// Busca la clave en el idioma actual (y si falta, en español). Sustituye {variables}.
// Si no existe, devuelve la propia clave.
export function t(key, vars) {
  let s = dicts[current][key] ?? dicts.es[key] ?? dicts.en[key];
  if (s == null) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
