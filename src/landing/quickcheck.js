// «Hazte un chequeo en 10 segundos»: simulación honesta en la landing.
// Mismos umbrales que la app (NEWS2 para pulso y oxígeno; AASM para el sueño).

const CASES = {
  ok: { bpm: 64, spo2: 98, sleep: 7.4, cabin: 22.6 },
  warn: { bpm: 104, spo2: 96, sleep: 5.1, cabin: 26.4 },
};
const HOLD_MS = 2600;

const hr = (v) => (v <= 40 || v >= 131 ? 2 : v <= 50 || v >= 91 ? 1 : 0);
const ox = (v) => (v <= 91 ? 2 : v <= 95 ? 1 : 0);
const sl = (v) => (v < 4 ? 2 : v < 7 ? 1 : 0);
const cab = (v) => (v < 18 || v > 27 ? 2 : v < 20 || v > 25 ? 1 : 0);
const CLS = ['ok', 'warn', 'err'];
const fmt = (v, d = 0) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });

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
    hint.textContent = 'Mantén pulsado';
    rows.replaceChildren(); say.textContent = '';
    pad.dataset.state = 'idle';
  }

  function result() {
    const c = CASES[which];
    const list = [
      ['Pulso en reposo', `${c.bpm} lpm`, hr(c.bpm), ['dentro de 51–90', 'por encima de 90 sin esfuerzo', 'muy fuera de rango'][hr(c.bpm)]],
      ['Oxígeno', `${c.spo2} %`, ox(c.spo2), ['normal (96 % o más)', 'algo bajo', 'bajo'][ox(c.spo2)]],
      ['Sueño de anoche', `${fmt(c.sleep, 1)} h`, sl(c.sleep), ['suficiente', 'por debajo de 7 h', 'muy poco'][sl(c.sleep)]],
      ['Aire de cabina', `${fmt(c.cabin, 1)} °C`, cab(c.cabin), ['en rango de confort', 'fuera del rango de confort', 'fuera de límites'][cab(c.cabin)]],
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
    hint.textContent = ['Verde · todo en rango', 'Amarillo · a vigilar', 'Rojo · actúa ahora'][worst];
    say.textContent = worst === 0
      ? '«Todo dentro de tu rango. Cada chequeo afina tu línea base.»'
      : '«Tu pulso en reposo está alto sin haber hecho ejercicio y anoche dormiste poco más de cinco horas; con la cabina algo caliente, encaja con cansancio acumulado. Descansa diez minutos, bebe agua y repite la medida.»';
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
    hint.textContent = 'Midiendo… no sueltes';
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
    hint.textContent = 'Has soltado antes de tiempo. Mantén pulsado.';
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
