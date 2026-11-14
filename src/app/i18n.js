// Idioma de la app: inglés por defecto, español opcional.
// Clave compartida con la landing: localStorage 'xpaze-lang' ('en' | 'es'). ?lang=es la fuerza.
// L(es, en) elige el texto en línea; t(key, vars) usa el diccionario para lo compartido.

const KEY = 'xpaze-lang';
const listeners = new Set();

function detect() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('lang');
    if (q === 'es' || q === 'en') { globalThis.localStorage?.setItem(KEY, q); return q; }
    const s = globalThis.localStorage?.getItem(KEY);
    if (s === 'es' || s === 'en') return s;
  } catch { /* sin almacenamiento */ }
  return 'en';
}

let current = detect();
if (globalThis.document) document.documentElement.lang = current;

export const lang = () => current;
export const locale = () => (current === 'es' ? 'es-ES' : 'en-GB');
export const L = (es, en) => (current === 'es' ? es : en);

export function setLang(l) {
  if (l !== 'en' && l !== 'es') return;
  current = l;
  try { globalThis.localStorage?.setItem(KEY, l); } catch { /* sin almacenamiento */ }
  if (globalThis.document) document.documentElement.lang = l;
  for (const fn of listeners) fn(l);
}

export const onLang = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const DICT = {
  en: {
    'tab.home': 'Home', 'tab.check': 'Check-up', 'tab.paze': 'Paze', 'tab.history': 'History',
    'level.0': 'Green · all in range', 'level.1': 'Yellow · keep an eye on it', 'level.2': 'Red · act now',
    'ai.notice': 'You are talking to an AI. It is not a person and does not replace a professional.',
  },
  es: {
    'tab.home': 'Inicio', 'tab.check': 'Chequeo', 'tab.paze': 'Paze', 'tab.history': 'Historial',
    'level.0': 'Verde · todo en rango', 'level.1': 'Amarillo · a vigilar', 'level.2': 'Rojo · actúa ahora',
    'ai.notice': 'Estás hablando con una IA. No es una persona ni sustituye a un profesional.',
  },
};

export function t(key, vars = {}) {
  const s = DICT[current][key] ?? DICT.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

// Selector EN/ES reutilizable (HTML); quien lo pinta conecta los botones con wireLangSwitch.
export const langSwitch = () => `<div class="lang-switch" role="group" aria-label="${L('Idioma', 'Language')}">${['en', 'es'].map((l) => `<button type="button" data-lang="${l}" aria-pressed="${current === l}">${l.toUpperCase()}</button>`).join('')}</div>`;
export function wireLangSwitch(root, onChange) {
  root.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.lang === current) return;
    setLang(b.dataset.lang);
    onChange?.();
  }));
}
