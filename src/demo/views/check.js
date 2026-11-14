// #/chequeo — chequeo guiado (~20 s). Las señales son simuladas; la detección de
// latidos, la HRV, la SpO2 y la calidad de señal se calculan en vivo sobre ellas.

import { h, fmt, viewHead, icon, fitCanvas, reducedMotion } from '../core/ui.js';
import { simulateCheck, measureCheck, finishCheck, failAttempt, activeScenarios } from '../core/engine/mission.js';
import { detectRPeaks, heartMetrics, signalQuality, estimateSpO2, cabinOut } from '../core/engine/signals.js';
import { makeReport } from '../core/engine/link.js';
import { THRESHOLDS } from '../core/engine/analyze.js';
import { mean } from '../core/engine/stats.js';

// fases en segundos de chequeo
const T = { ecg: 0, ppg: 7, temp: 11, cabin: 15, analysis: 17, end: 19.6 };
const ALGOS = ['ctx', 'z', 'ewma', 'forest'];

export function mount(el, ctx) {
  const { store, navigate, i18n: { t } } = ctx;
  const a = store.currentAstronaut();
  if (!a) { navigate('#/'); return null; }

  const reduced = reducedMotion();
  const speed = reduced ? 3 : 1;
  let raf = 0, sim = null, final = null, attempt = 1, startAt = 0, lastDetect = 0, peaks = [], stopped = true;

  const body = h('div');
  el.append(
    viewHead({ eyebrow: t('check.eyebrow', { day: store.missionDay() }), title: t('check.title', { name: a.name.split(' ')[0] }), lead: t('check.lead') }),
    body);

  /* ---------------------------------------------------------- listo -- */
  function showReady() {
    const active = activeScenarios(store.getState(), a.id);
    body.replaceChildren(h('section', { class: 'stage glass' },
      h('div', { class: 'ready' },
        h('img', { src: '/img/station-34.webp', alt: t('check.ready.alt'), width: 395, height: 440 }),
        h('div', { class: 'ready-copy' },
          h('h2', { class: 'card-title' }, t('check.ready.title')),
          h('ul', { class: 'ready-list' },
            ['ecg', 'ppg', 'temp', 'cabin'].map((k) => h('li', null, h('b', null, t(`check.ready.${k}`)), t(`check.ready.${k}.d`)))),
          active.length ? h('p', { class: 'chips' }, h('span', { class: 'chip chip--warn' }, t('check.ready.scn')), active.map((n) => h('span', { class: 'chip' }, t(`scn.${n}`)))) : null,
          h('button', { class: 'btn btn--light', type: 'button', id: 'start-check', onClick: start }, icon('play', 18), t('check.ready.start'))))));
  }

  /* -------------------------------------------------------- en curso -- */
  let ui = null;

  function tile(key, unit, extra) {
    const value = document.createTextNode('—');
    const note = h('p', { class: 'tile-note' });
    const node = h('div', { class: 'tile', dataset: { tile: key } },
      h('p', { class: 'tile-label' }, t(`check.tile.${key}`), icon('check', 16)),
      h('p', { class: 'tile-value' }, value, unit ? h('small', null, unit) : null),
      extra, note);
    return { node, set: (v) => { value.nodeValue = v; }, note: (v) => { note.textContent = v; }, state: (st) => { node.classList.toggle('is-live', st === 'live'); node.classList.toggle('is-done', st === 'done'); } };
  }

  function showRun() {
    const canvas = h('canvas', { class: 'ecg', role: 'img', 'aria-label': t('check.ecg.aria') });
    const qBars = h('span', { class: 'quality-bars', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
    const qText = h('span', null, t('check.quality.wait'));
    const quality = h('p', { class: 'quality' }, qBars, qText);
    const wrap = h('div', { class: 'ecg-wrap' }, canvas, h('div', { class: 'ecg-meta' }, h('span', { class: 'ecg-tag' }, t('check.ecg.tag')), quality));
    const ppg = h('canvas', { 'aria-hidden': 'true' });
    const dist = h('div', { class: 'dist', 'aria-hidden': 'true' }, h('b'), h('u'));
    const cabin = h('dl', { class: 'cabin-mini' });
    const tiles = {
      hr: tile('hr', t('unit.bpm')),
      hrv: tile('hrv', t('unit.ms')),
      spo2: tile('spo2', t('unit.pct'), ppg),
      temp: tile('temp', t('unit.c'), dist),
      cabin: tile('cabin', null, cabin),
    };
    tiles.cabin.node.querySelector('.tile-value').hidden = true;
    const phaseText = h('p', { class: 'phase-text', role: 'status', 'aria-live': 'polite' });
    const algos = h('div', { class: 'algos' }, ALGOS.map((k) => h('span', { class: 'algo', dataset: { algo: k } }, icon('check', 14), t(`check.algo.${k}`))));
    const bar = h('b');
    const skip = h('button', { class: 'btn btn--glass glass btn--small', type: 'button', id: 'skip-check', onClick: () => finish(true) }, icon('skip', 16), t('check.skip'));
    body.replaceChildren(h('section', { class: 'stage glass' },
      wrap,
      h('div', { class: 'tiles' }, Object.values(tiles).map((x) => x.node)),
      h('div', { class: 'phase' }, phaseText, skip, h('div', { class: 'phase-bar', 'aria-hidden': 'true' }, bar)),
      algos));
    ui = { canvas, wrap, qBars, qText, quality, ppg, dist, cabin, tiles, phaseText, algos, bar, skip, phase: '' };
  }

  function start() {
    cancelAnimationFrame(raf);
    sim = simulateCheck(store.getState(), a.id, { attempt });
    final = measureCheck(sim);
    peaks = [];
    showRun();
    stopped = false;
    startAt = performance.now();
    lastDetect = 0;
    raf = requestAnimationFrame(frame);
    ui.skip.focus({ preventScroll: true });
  }

  function setPhase(name) {
    if (ui.phase === name) return;
    ui.phase = name;
    ui.phaseText.textContent = t(`check.phase.${name}`);
    const order = ['ecg', 'ppg', 'temp', 'cabin', 'analysis'];
    const at = order.indexOf(name);
    ui.tiles.hr.state(at >= 4 ? 'done' : 'live');
    ui.tiles.hrv.state(at >= 4 ? 'done' : 'live');
    ui.tiles.spo2.state(at === 1 ? 'live' : at > 1 ? 'done' : '');
    ui.tiles.temp.state(at === 2 ? 'live' : at > 2 ? 'done' : '');
    ui.tiles.cabin.state(at === 3 ? 'live' : at > 3 ? 'done' : '');
  }

  function drawECG(tS) {
    const { ctx: c, w, h: hgt } = fitCanvas(ui.canvas);
    const { samples, fs } = sim.ecg;
    const win = w < 560 ? 3 : 5;
    const span = win * fs;
    let n = Math.min(samples.length, Math.floor(tS * fs));
    let from = Math.max(0, n - Math.round(span * 0.94));
    if (reduced) { from = 0; n = Math.min(n, Math.round(span * 0.94)); }
    c.clearRect(0, 0, w, hgt);
    // retícula
    c.strokeStyle = 'rgba(29,29,31,0.06)'; c.lineWidth = 1; c.beginPath();
    const x0 = -(((from / fs) % 1) / win) * w;
    for (let x = x0; x < w; x += w / win) { c.moveTo(x, 0); c.lineTo(x, hgt); }
    for (let y = hgt * 0.25; y < hgt; y += hgt * 0.25) { c.moveTo(0, y); c.lineTo(w, y); }
    c.stroke();
    if (n - from < 2) return;
    const mid = hgt * 0.66, amp = hgt * 0.4;
    const X = (i) => ((i - from) / span) * w;
    const Y = (v) => Math.max(4, Math.min(hgt - 4, mid - v * amp));
    c.strokeStyle = '#ff2d55'; c.lineWidth = 2; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath();
    for (let i = from; i < n; i++) { if (i === from) c.moveTo(X(i), Y(samples[i])); else c.lineTo(X(i), Y(samples[i])); }
    c.stroke();
    // latidos detectados
    c.fillStyle = 'rgba(29,29,31,0.5)';
    for (const p of peaks) {
      const i = p * fs;
      if (i < from || i > n) continue;
      c.beginPath(); c.arc(X(i), 34, 2.5, 0, Math.PI * 2); c.fill();
    }
    // cabeza del trazo
    const hx = X(n - 1), hy = Y(samples[n - 1]);
    c.fillStyle = 'rgba(255,45,85,0.18)'; c.beginPath(); c.arc(hx, hy, 9, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ff2d55'; c.beginPath(); c.arc(hx, hy, 3.5, 0, Math.PI * 2); c.fill();
  }

  function drawPPG(p) {
    const { ctx: c, w, h: hgt } = fitCanvas(ui.ppg);
    c.clearRect(0, 0, w, hgt);
    const { ir, red } = sim.ppg;
    const n = Math.floor(ir.length * p);
    if (n < 3) return;
    const draw = (x, color, dc, k) => {
      c.strokeStyle = color; c.lineWidth = 1.6; c.beginPath();
      for (let i = 0; i < n; i++) {
        const px = (i / ir.length) * w, py = hgt - 3 - ((x[i] / dc - 1) / k) * (hgt - 6);
        if (i) c.lineTo(px, Math.max(1, Math.min(hgt - 1, py))); else c.moveTo(px, py);
      }
      c.stroke();
    };
    draw(ir, 'rgba(29,29,31,0.55)', 1.0, 0.024);
    draw(red, '#ff2d55', 0.8, 0.024);
  }

  function setQuality(q) {
    const on = q >= 0.9 ? 4 : q >= 0.75 ? 3 : q >= 0.5 ? 2 : q >= 0.25 ? 1 : 0;
    [...ui.qBars.children].forEach((b, i) => b.classList.toggle('on', i < Math.max(1, on)));
    ui.quality.classList.toggle('is-bad', q < THRESHOLDS.quality);
    ui.qText.textContent = t('check.quality', { pct: fmt(q * 100) });
  }

  function liveMeasure(tS) {
    const { samples, fs } = sim.ecg;
    const n = Math.min(samples.length, Math.floor(tS * fs));
    peaks = detectRPeaks(samples, fs, n);
    const m = heartMetrics(peaks);
    if (m.hr && peaks.length >= 3) ui.tiles.hr.set(fmt(m.hr));
    if (m.hrv && peaks.length >= 6) ui.tiles.hrv.set(fmt(m.hrv));
    ui.tiles.hr.note(t('check.note.beats', { n: peaks.length }));
    ui.tiles.hrv.note(peaks.length >= 6 ? 'RMSSD' : t('check.note.wait'));
    if (tS > 1.6) {
      const q = signalQuality(samples, fs, n, peaks);
      setQuality(q);
      if (tS >= 4.5 && q < THRESHOLDS.quality) return bad(q);
    }
    if (tS >= T.ppg) {
      const p = Math.min(1, (tS - T.ppg) / (T.temp - T.ppg));
      if (p > 0.55) {
        const o = estimateSpO2(sim.ppg.ir, sim.ppg.red, sim.ppg.fs, Math.floor(sim.ppg.ir.length * p));
        if (o.spo2) { ui.tiles.spo2.set(fmt(p >= 1 ? final.spo2 : o.spo2)); ui.tiles.spo2.note(t('check.note.ratio', { r: fmt(o.ratio, 2) })); }
      } else ui.tiles.spo2.note(t('check.note.finger'));
    }
    if (tS >= T.temp) {
      const idx = Math.min(sim.temp.length - 1, Math.floor(((tS - T.temp) / (T.cabin - T.temp)) * (sim.temp.length - 1)));
      const sample = sim.temp[idx];
      ui.dist.querySelector('u').style.left = `${Math.min(100, (sample.distanceMm / 160) * 100)}%`;
      ui.dist.classList.toggle('is-ok', sample.valid);
      const valid = sim.temp.slice(0, idx + 1).filter((x) => x.valid);
      ui.tiles.temp.note(t(sample.valid ? 'check.note.distOk' : 'check.note.distFar', { cm: fmt(sample.distanceMm / 10, 1) }));
      if (tS >= T.cabin) ui.tiles.temp.set(fmt(final.temp, 1));
      else if (valid.length >= 8) ui.tiles.temp.set(fmt(mean(valid.slice(-12).map((x) => x.estimate)), 1));
    }
    if (tS >= T.cabin + 0.4 && !ui.cabin.childNodes.length) fillCabin();
    if (tS >= T.analysis) {
      const k = Math.floor((tS - T.analysis) / 0.6);
      [...ui.algos.children].forEach((node, i) => node.classList.toggle('is-done', i < k));
    }
    return true;
  }

  function fillCabin() {
    const c = sim.cabin, out = cabinOut(c);
    const row = (key, v, bad) => h('div', { class: bad ? 'is-out' : '' }, h('dt', { class: 'sr-only' }, t(`cabin.${key}`)), h('dd', null, h('b', null, v), ' ', t(`cabin.${key}.u`)));
    ui.cabin.replaceChildren(row('temp', fmt(c.tempC, 1), out.temp), row('hum', fmt(c.humidity), false), row('press', fmt(c.pressure), false), row('co2', fmt(Math.round(c.co2 / 10) * 10), out.co2));
    ui.tiles.cabin.note(t(out.temp || out.co2 ? 'check.note.cabinOut' : 'check.note.cabinOk'));
  }

  function frame(now) {
    if (stopped) return;
    const tS = ((now - startAt) / 1000) * speed;
    setPhase(tS < T.ppg ? 'ecg' : tS < T.temp ? 'ppg' : tS < T.cabin ? 'temp' : tS < T.analysis ? 'cabin' : 'analysis');
    drawECG(tS);
    if (tS >= T.ppg && tS < T.temp + 0.3) drawPPG(Math.min(1, (tS - T.ppg) / (T.temp - T.ppg)));
    ui.bar.style.width = `${Math.min(100, (tS / T.end) * 100)}%`;
    if (now - lastDetect > 220) {
      lastDetect = now;
      if (liveMeasure(tS) !== true) return;
    }
    if (tS >= T.end) { finish(false); return; }
    raf = requestAnimationFrame(frame);
  }

  function bad(q) {
    stopped = true;
    cancelAnimationFrame(raf);
    setQuality(q);
    ui.phaseText.textContent = t('check.bad.phase');
    ui.skip.hidden = true;
    const retry = h('button', { class: 'btn btn--light btn--small', type: 'button', id: 'retry-check', onClick: () => {
      store.update((st) => failAttempt(st, a.id));
      attempt += 1;
      start();
    } }, icon('reset', 16), t('check.bad.retry'));
    ui.wrap.append(h('div', { class: 'ecg-alert', role: 'alert' }, h('strong', null, t('check.bad.title')), h('p', null, t('check.bad.text')), retry));
    retry.focus({ preventScroll: true });
    return false;
  }

  function finish(skipped) {
    if (stopped) return;
    if (!final.reliable) { bad(final.quality); return; }
    stopped = true;
    cancelAnimationFrame(raf);
    if (skipped) {
      ui.tiles.hr.set(fmt(final.hr)); ui.tiles.hrv.set(fmt(final.hrv)); ui.tiles.spo2.set(fmt(final.spo2)); ui.tiles.temp.set(fmt(final.temp, 1));
    }
    store.update((st) => {
      const check = finishCheck(st, sim, final, Date.now());
      st.link.queue.unshift(makeReport(check, st.link.delayMin, Date.now()));
      st.link.queue.length = Math.min(st.link.queue.length, 12);
    });
    navigate('#/resultado');
  }

  showReady();
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
