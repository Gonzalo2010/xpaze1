// Monitor en directo de la portada: el mismo cuerpo simulado que la estación v2 de la app
// (src/app/simbody.js) genera el ECG latido a latido; pulso, HRV y ritmo se calculan de los latidos.

import { SimBody } from '../app/simbody.js';
import { drawEcg } from '../app/charts.js';
import { t, num } from './i18n.js';

export function startHeroMonitor(root, { reduced = false } = {}) {
  if (!root) return;
  const canvas = root.querySelector('canvas');
  const out = (k) => root.querySelector(`[data-hm="${k}"]`);
  const body = new SimBody(29);
  body.setBase({ hr: 62, rmssd: 52, temp: 36.6 });
  body.setScenario('rest');
  body.settle();
  const ecg = [];
  let visible = true, raf = 0, last = performance.now(), acc = 0, slow = 0;

  function tick(now) {
    raf = 0;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= 0.04) { // 10 muestras cada 40 ms = 250 Hz
      acc -= 0.04;
      body.step(0.04);
      for (const v of body.ecg(10)) ecg.push(v);
    }
    if (ecg.length > 1250) ecg.splice(0, ecg.length - 1250);
    drawEcg(canvas, ecg, { seconds: 4 });
    slow += dt;
    if (slow > 1) {
      slow = 0;
      const r = body.readings();
      if (r.ecgHr) out('hr').textContent = r.ecgHr;
      if (r.rmssd) out('hrv').textContent = r.rmssd;
      out('temp').textContent = num(r.temp, 1);
      out('resp').textContent = r.rr;
      out('rhythm').textContent = t(r.rhythm === 'sinus' || !r.rhythm ? 'hm.sinus' : 'hm.irregular');
    }
    if (visible) raf = requestAnimationFrame(tick);
  }

  if (reduced) { // sin animación: unos segundos de ECG, pintados una vez
    for (let i = 0; i < 125; i++) { body.step(0.04); ecg.push(...body.ecg(10)); }
    requestAnimationFrame(() => drawEcg(canvas, ecg, { seconds: 4, live: false }));
    return;
  }
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }).observe(root);
}
