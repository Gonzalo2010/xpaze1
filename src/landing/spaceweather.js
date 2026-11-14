// Clima espacial en directo en la landing: avisos oficiales de los últimos 7 días
// (/app/api/espacio) valorados con las mismas reglas que la app (src/app/space.js).
// Si la petición falla, el bloque no se muestra.

import { assessSpace } from '../app/space.js';
import { t, lang } from './i18n.js';

const CLS = ['ok', 'warn', 'err'];

// src/app/space.js redacta en español. Si recibe el idioma (4.º argumento) y ya contesta en
// inglés, estas tablas no hacen nada; si no, traducen sus frases fijas a inglés.
const EN_FIXED = {
  'Sin avisos relevantes para la tripulación': 'No alerts relevant to the crew',
  'Vigilancia por clima espacial': 'Space weather watch',
  'Alerta de radiación: busca refugio': 'Radiation alert: take shelter',
  'Sin riesgo para la tripulación · avisos informativos': 'No risk to the crew · informational alerts',
  'Repasa dónde está el refugio de radiación y el plan para llegar a él.': 'Review where the radiation shelter is and the plan for getting there.',
  'Evita salidas extravehiculares no esenciales en las próximas 24 h.': 'Avoid non-essential EVAs for the next 24 h.',
  'Lleva el dosímetro personal y sigue los avisos.': 'Wear your personal dosimeter and follow the alerts.',
  'Ve al refugio de radiación (la zona más protegida, rodeada de agua y equipos) y quédate hasta que se levante el aviso.': 'Go to the radiation shelter (the most protected area, surrounded by water and equipment) and stay there until the alert is lifted.',
  'Suspende salidas extravehiculares y de superficie.': 'Suspend EVAs and surface excursions.',
  'Anota la dosis del dosímetro e infórmalo al cirujano de vuelo.': 'Log your dosimeter reading and report it to the flight surgeon.',
  'Evento de partículas solares en las últimas 48 h: en órbita baja el campo magnético protege, pero las salidas extravehiculares y las órbitas polares se exponen más.': 'Solar particle event in the last 48 h: in low Earth orbit the magnetic field shields most of it, but EVAs and polar orbits are more exposed.',
  'Evento de partículas solares en las últimas 48 h: fuera de la magnetosfera la radiación llega sin filtro.': 'Solar particle event in the last 48 h: outside the magnetosphere the radiation arrives unfiltered.',
  'Cinturón de radiación exterior reforzado: relevante para salidas extravehiculares largas.': 'Enhanced outer radiation belt: relevant for long EVAs.',
};
const EN_PATTERNS = [
  [/^Fulguración solar (\S+) en las últimas 24 h: pueden llegar protones energéticos en las próximas horas\.$/,
    (m) => `Solar flare ${m[1]} in the last 24 h: energetic protons may arrive in the next few hours.`],
  [/^Tormenta geomagnética fuerte \(Kp ([\d.]+)\): más radiación en los pasos por latitudes altas y posibles cortes de comunicación\.$/,
    (m) => `Strong geomagnetic storm (Kp ${m[1]}): more radiation on high-latitude passes and possible communication outages.`],
  [/^Tormenta geomagnética (fuerte|moderada) \(Kp ([\d.]+)\) en la órbita terrestre\.$/,
    (m) => `${m[1] === 'fuerte' ? 'Strong' : 'Moderate'} geomagnetic storm (Kp ${m[2]}) in Earth orbit.`],
];
function en(text) {
  if (EN_FIXED[text]) return EN_FIXED[text];
  for (const [re, fn] of EN_PATTERNS) { const m = re.exec(text); if (m) return fn(m); }
  return text;
}
const tr = (s) => (lang() === 'en' ? en(s) : s);

export async function initSpaceWeather(root, { url = '/app/api/espacio' } = {}) {
  let data;
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return;
    data = await r.json();
    if (!Array.isArray(data.events)) return;
  } catch { return; }

  const envBtns = [...root.querySelectorAll('[data-env]')];
  const light = root.querySelector('.sw__light');
  const title = root.querySelector('.sw__title');
  const reasons = root.querySelector('.sw__reasons');
  const actions = root.querySelector('.sw__actions');
  const note = root.querySelector('.sw__note');
  let env = 'transit';

  const li = (x) => { const e = document.createElement('li'); e.textContent = x; return e; };
  function render() {
    const a = assessSpace(data.events, env, Date.now(), lang());
    root.dataset.level = CLS[a.level];
    light.dataset.level = CLS[a.level];
    title.textContent = tr(a.headline);
    reasons.replaceChildren(...(a.reasons.length ? a.reasons.map((r) => li(tr(r.text))) : [li(t('sw.none'))]));
    actions.replaceChildren(...a.actions.map((x) => li(tr(x))));
    const mins = Math.round((Date.now() - Date.parse(data.fetchedAt)) / 60000);
    note.textContent = t('sw.note', {
      env: t(`sw.env.${env}`),
      count: data.events.length,
      ago: mins < 60 ? `${Math.max(mins, 1)} min` : `${Math.round(mins / 60)} h`,
      transit: env === 'transit' ? t('sw.note.transit') : '',
    });
  }
  envBtns.forEach((b) => b.addEventListener('click', () => {
    env = b.dataset.env;
    envBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  }));
  render();
  root.hidden = false;
  return true;
}
