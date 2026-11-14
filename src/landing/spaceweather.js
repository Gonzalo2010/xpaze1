// Clima espacial en directo en la landing: avisos oficiales de los últimos 7 días
// (/app/api/espacio) valorados con las mismas reglas que la app (src/app/space.js).
// Si la petición falla, el bloque no se muestra.

import { assessSpace } from '../app/space.js';

const ENV_NAME = { transit: 'Tránsito a Marte', station: 'Estación orbital', lunar: 'Base lunar', rover: 'Rover en Marte' };
const CLS = ['ok', 'warn', 'err'];

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

  const li = (t) => { const x = document.createElement('li'); x.textContent = t; return x; };
  function render() {
    const a = assessSpace(data.events, env);
    root.dataset.level = CLS[a.level];
    light.dataset.level = CLS[a.level];
    title.textContent = a.headline;
    reasons.replaceChildren(...(a.reasons.length ? a.reasons.map((r) => li(r.text)) : [li('Ningún aviso de partículas solares, fulguraciones fuertes ni tormentas relevantes para este entorno.')]));
    actions.replaceChildren(...a.actions.map(li));
    const mins = Math.round((Date.now() - Date.parse(data.fetchedAt)) / 60000);
    note.textContent = `Fuente: NASA DONKI · ${ENV_NAME[env]} · ${data.events.length} avisos en los últimos 7 días · actualizado hace ${mins < 60 ? `${Math.max(mins, 1)} min` : `${Math.round(mins / 60)} h`}. Los avisos se detectan desde la órbita terrestre${env === 'transit' ? '; en tránsito, la exposición real depende de la posición de la nave' : ''}.`;
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
