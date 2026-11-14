// «Hazte un chequeo en 10 segundos»: simulación honesta en la landing.
// Mismos umbrales que la app (NEWS2 para pulso y oxígeno; AASM para el sueño).

const CASES = {
  ok: { bpm: 64, spo2: 98, sleep: 7.4, cabin: 22.6 },
  warn: { bpm: 104, spo2: 96, sleep: 5.1, cabin: 26.4 },
};
import { t, num } from './i18n.js';

const HOLD_MS = 2600;

const hr = (v) => (v <= 40 || v >= 131 ? 2 : v <= 50 || v >= 91 ? 1 : 0);
const ox = (v) => (v <= 91 ? 2 : v <= 95 ? 1 : 0);
const sl = (v) => (v < 4 ? 2 : v < 7 ? 1 : 0);
const cab = (v) => (v < 18 || v > 27 ? 2 : v < 20 || v > 25 ? 1 : 0);
const CLS = ['ok', 'warn', 'err'];

export function initQuickCheck(root, { reduced = false } = {}) {
  const pad = root.querySelector('.qc__pad');
  const fg = root.querySelector('.qc__fg');
  const bpmEl = root.querySelector('[data-qc="bpm"]');
  const hint = root.querySelector('.qc__hint');
  const rows = root.querySelector('.qc__rows');
  const say = root.querySelector('.qc__say');
  const cases = [...root.querySelectorAll('[data-case]')];
  let which = 'ok';
  let raf = 0, t0 = 0, done = false, tick = 0;

  cases.forEach((b) => b.addEventListener('click', () => {
    which = b.dataset.case;
    cases.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    reset();
  }));

  function reset() {
    cancelAnimationFrame(raf); clearInterval(tick);
    done = false;
    fg.style.strokeDashoffset = '100';
    bpmEl.textContent = '—';
    hint.textContent = t('qc.hold');
    rows.replaceChildren(); say.textContent = '';
    pad.dataset.state = 'idle';
  }

  function result() {
    const c = CASES[which];
    const list = [
      [t('qc.hr'), `${c.bpm} ${t('unit.bpm')}`, hr(c.bpm), t(`qc.hr.${hr(c.bpm)}`)],
      [t('qc.ox'), `${c.spo2} %`, ox(c.spo2), t(`qc.ox.${ox(c.spo2)}`)],
      [t('qc.sleep'), `${num(c.sleep, 1)} h`, sl(c.sleep), t(`qc.sleep.${sl(c.sleep)}`)],
      [t('qc.cabin'), `${num(c.cabin, 1)} °C`, cab(c.cabin), t(`qc.cabin.${cab(c.cabin)}`)],
    ];
    const worst = Math.max(...list.map((r) => r[2]));
    rows.replaceChildren(...list.map(([n, v, l, why], i) => {
      const li = document.createElement('li');
      li.className = `lvl-${CLS[l]}`;
      li.style.setProperty('--i', i);
      li.innerHTML = `<span class="dot dot--${CLS[l]}"></span><span><b></b><small></small></span><em></em>`;
      li.querySelector('b').textContent = n;
      li.querySelector('small').textContent = why;
      li.querySelector('em').textContent = v;
      return li;
    }));
    pad.dataset.state = CLS[worst];
    hint.textContent = t(`qc.verdict.${worst}`);
    say.textContent = worst === 0
      ? t('qc.say.ok')
      : t('qc.say.warn');
  }

  function frame(now) {
    const p = Math.min(1, (now - t0) / HOLD_MS);
    fg.style.strokeDashoffset = String(100 - p * 100);
    if (p >= 1) { finish(); return; }
    raf = requestAnimationFrame(frame);
  }

  function start(e) {
    e.preventDefault();
    if (done) reset();
    pad.dataset.state = 'measuring';
    hint.textContent = t('qc.measuring');
    const target = CASES[which].bpm;
    tick = setInterval(() => { bpmEl.textContent = String(target + Math.round((Math.random() - 0.5) * 6)); }, 220);
    if (reduced) { finish(); return; }
    t0 = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (done || pad.dataset.state !== 'measuring') return;
    cancelAnimationFrame(raf); clearInterval(tick);
    pad.dataset.state = 'idle';
    hint.textContent = t('qc.early');
    fg.style.strokeDashoffset = '100';
    bpmEl.textContent = '—';
  }

  function finish() {
    clearInterval(tick);
    done = true;
    bpmEl.textContent = String(CASES[which].bpm);
    fg.style.strokeDashoffset = '0';
    result();
  }

  pad.addEventListener('pointerdown', start);
  pad.addEventListener('pointerup', stop);
  pad.addEventListener('pointerleave', stop);
  pad.addEventListener('pointercancel', stop);
  pad.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) start(e); });
  pad.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stop(); });
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
}
