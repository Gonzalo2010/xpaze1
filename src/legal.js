// Página legal: inglés por defecto, español opcional (misma preferencia que la web y la app).
import './fonts.css';
import './legal.css';

const KEY = 'xpaze-lang';
const MAP = { notice: 'aviso', privacy: 'privacidad', cookies: 'cookies-es', terms: 'condiciones', medical: 'medico', ai: 'ia', ip: 'propiedad' };
const REV = Object.fromEntries(Object.entries(MAP).map(([a, b]) => [b, a]));

function current() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'es' || q === 'en') { localStorage.setItem(KEY, q); return q; }
    const s = localStorage.getItem(KEY);
    if (s === 'es' || s === 'en') return s;
  } catch { /* sin almacenamiento */ }
  return 'en';
}

function apply(l) {
  document.documentElement.lang = l;
  document.title = l === 'es' ? 'Legal · XPaze' : 'Legal · XPaze';
  document.querySelectorAll('[data-l]').forEach((m) => { m.hidden = m.dataset.l !== l; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  // el ancla funciona en los dos idiomas (#privacy ↔ #privacidad)
  const h = location.hash.slice(1);
  const target = l === 'es' ? (MAP[h] || h) : (REV[h] || h);
  if (target && target !== h) history.replaceState(null, '', `#${target}`);
  if (target) document.getElementById(target)?.scrollIntoView();
}

document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
  try { localStorage.setItem(KEY, b.dataset.lang); } catch { /* nada */ }
  apply(b.dataset.lang);
}));
apply(current());
