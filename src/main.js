// XPaze v2 — scroll suave, animaciones ligadas al scroll e interacciones.

import './style.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { marsLight } from './mars.js';

gsap.registerPlugin(ScrollTrigger);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DESKTOP = '(min-width: 861px)';
const clamp01 = (v) => Math.min(1, Math.max(0, v));

document.documentElement.classList.add('js');

/* ------------------------------------------------------- scroll suave -- */
let lenis = null;
if (!reduced) {
  lenis = new Lenis({ duration: 1.1, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
// los enlaces internos pasan por Lenis para que el salto sea suave
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const id = a.getAttribute('href');
  const el = id === '#top' ? document.body : $(id);
  if (!el) return;
  e.preventDefault();
  if (lenis) lenis.scrollTo(id === '#top' ? 0 : el, { offset: id === '#top' ? 0 : -8 });
  else (id === '#top' ? window.scrollTo({ top: 0 }) : el.scrollIntoView());
  history.replaceState(null, '', id);
});

/* -------------------------------------------------------------- hero -- */
if (!reduced) {
  gsap.from('.hero__title .line > span', { yPercent: 110, duration: 1.2, ease: 'expo.out', stagger: 0.08, delay: 0.15 });
  gsap.from(['.hero .kicker', '.hero__sub', '.hero__cta', '.hero__readout'], { opacity: 0, y: 20, duration: 1, ease: 'power3.out', stagger: 0.08, delay: 0.55 });
  gsap.to('.hero__copy', {
    yPercent: -12, opacity: 0.2, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
  });
}
// pulso que respira en la lectura de ejemplo
const pulseEl = $('.hero__readout [data-count]');
if (pulseEl && !reduced) {
  const seq = [62, 62, 63, 62, 61, 62, 63, 63, 62];
  let i = 0;
  setInterval(() => { pulseEl.textContent = seq[i++ % seq.length]; }, 1100);
}

/* ------------------------------------------------- aparición genérica -- */
if (!reduced) {
  $$('.reveal').forEach((el) => {
    gsap.to(el, {
      opacity: 1, y: 0, duration: 1, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });
}

/* --------------------------------------------- 01 las señales se juntan -- */
{
  const stage = $('.scatter__stage');
  const sigs = $$('.sig', stage);
  const core = $('.scatter__core');
  const pos = (el, axis) => {
    const v = parseFloat(getComputedStyle(el).getPropertyValue(axis === 'x' ? '--x' : '--y'));
    const size = axis === 'x' ? stage.clientWidth : stage.clientHeight;
    const room = size / 2 - (axis === 'x' ? el.offsetWidth : el.offsetHeight) / 2 - 12;
    return Math.max(-room, Math.min(room, (v / 100) * size));
  };
  sigs.forEach((s) => gsap.set(s, { xPercent: -50, yPercent: -50, x: pos(s, 'x'), y: pos(s, 'y') }));

  if (reduced) {
    gsap.set(core, { opacity: 1, scale: 1, xPercent: -50, yPercent: -50 });
    gsap.set(sigs, { opacity: 0 });
  } else {
    gsap.set(core, { xPercent: -50, yPercent: -50, scale: 0.6, opacity: 0 });
    const tl = gsap.timeline({
      scrollTrigger: { trigger: stage, start: 'center center', end: '+=90%', scrub: 0.6, pin: true, invalidateOnRefresh: true },
    });
    tl.fromTo(sigs, { x: (i, el) => pos(el, 'x'), y: (i, el) => pos(el, 'y') * 1.1, opacity: 1 },
      { x: (i, el) => pos(el, 'x'), y: (i, el) => pos(el, 'y'), duration: 0.25, ease: 'none' })
      .to(sigs, { x: 0, y: 0, scale: 0.5, opacity: 0, duration: 0.5, ease: 'power2.in', stagger: 0.02 })
      .to(core, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.6)' }, '-=0.2');
  }
}

/* ------------------------------------------------------- 02 contexto -- */
{
  const STATES = {
    exercise: {
      state: 'Normal',
      why: 'Acaba de entrenar. Un pulso alto ahora es lo esperable, y bajará en unos minutos.',
      f: { act: 1, base: 0.35, other: 0.05, time: 0.15 },
    },
    rest: {
      state: 'A vigilar',
      why: 'En reposo, 108 ppm es un 74 % más que su normal. XPaze lo anota y pide repetir el chequeo.',
      f: { act: 0.05, base: 0.85, other: 0.15, time: 0.4 },
    },
    ill: {
      state: 'Alerta',
      why: 'Pulso alto en reposo, algo de fiebre y mala noche, y lleva así un rato. Varias señales a la vez: avisa y explica.',
      f: { act: 0.05, base: 0.9, other: 0.85, time: 0.9 },
    },
  };
  const box = $('.ctx');
  const tabs = $$('.ctx__tabs button', box);
  const color = (v) => (v > 0.7 ? 'var(--red)' : v > 0.45 ? 'var(--amber)' : 'var(--ink)');
  function set(name, focus = false) {
    const s = STATES[name];
    box.dataset.ctx = name;
    tabs.forEach((b) => { const on = b.dataset.set === name; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    $('.ctx__state', box).textContent = s.state;
    $('.ctx__why', box).textContent = s.why;
    for (const [k, v] of Object.entries(s.f)) {
      const b = $(`[data-f="${k}"]`, box);
      b.style.width = `${Math.round(v * 100)}%`;
      b.style.background = name === 'exercise' && k === 'act' ? 'var(--green)' : color(v);
    }
  }
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => set(b.dataset.set));
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) set(tabs[(i + d + tabs.length) % tabs.length].dataset.set, true);
    });
  });
  set('exercise');
}

/* ----------------------------------------- 03 tres piezas en horizontal -- */
if (!reduced) {
  gsap.matchMedia().add(DESKTOP, () => {
    const wrap = $('.hscroll');
    const track = $('.hscroll__track');
    const dist = () => Math.max(0, track.scrollWidth - window.innerWidth);
    gsap.to(track, {
      x: () => -dist(), ease: 'none',
      scrollTrigger: { trigger: wrap, start: 'center center', end: () => `+=${dist()}`, scrub: 0.6, pin: true, invalidateOnRefresh: true },
    });
  });
}

/* ------------------------------------------------- 04 gráfica línea base -- */
{
  const fig = $('.chart');
  const svg = $('.chart__svg', fig);
  const dayEl = $('.chart__day b', fig);
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000, H = 420, L = 56, R = 960, T = 20, B = 380;
  const DAYS = 58;
  const x = (d) => L + ((d - 1) / (DAYS - 1)) * (R - L);
  const y = (v) => B - ((v - 40) / (110 - 40)) * (B - T);
  // datos: alrededor de 62 ppm, con el pico del día 58
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const data = Array.from({ length: DAYS }, (_, i) => {
    const d = i + 1;
    if (d === DAYS) return 84;
    if (d === DAYS - 1) return 66;
    return 62 + Math.sin(d / 4.3) * 1.6 + (rnd() - 0.5) * 4.2;
  });
  const el = (tag, attrs, parent = svg) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); parent.appendChild(n); return n; };
  el('rect', { class: 'band-pop', x: L, y: y(100), width: R - L, height: y(60) - y(100), rx: 6 });
  el('rect', { class: 'band-mine', x: L, y: y(68), width: R - L, height: y(56) - y(68), rx: 6 });
  el('line', { class: 'mid', x1: L, x2: R, y1: y(62), y2: y(62) });
  for (const v of [50, 60, 70, 80, 90, 100]) {
    el('line', { class: 'grid', x1: L - 6, x2: L, y1: y(v), y2: y(v) });
    const t = el('text', { class: 'axis', x: L - 12, y: y(v) + 4, 'text-anchor': 'end' }); t.textContent = v;
  }
  for (const d of [1, 10, 20, 30, 40, 50, 58]) {
    const t = el('text', { class: 'axis', x: x(d), y: H - 6, 'text-anchor': 'middle' }); t.textContent = d;
  }
  const dPath = data.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const line = el('path', { class: 'line', d: dPath });
  const ring = el('circle', { class: 'spike-ring', cx: x(DAYS), cy: y(84), r: 16 });
  const dot = el('circle', { class: 'spike', cx: x(DAYS), cy: y(84), r: 7 });
  const label = el('text', { class: 'spike-label', x: x(DAYS) - 24, y: y(84) - 8, 'text-anchor': 'end' });
  label.textContent = '84 ppm';
  const len = line.getTotalLength();
  line.style.strokeDasharray = len;

  const lengths = [];
  { // longitud acumulada por día, para saber qué día va dibujado
    const tmp = document.createElementNS(NS, 'path');
    for (let i = 1; i <= DAYS; i++) {
      tmp.setAttribute('d', data.slice(0, i).map((v, j) => `${j ? 'L' : 'M'}${x(j + 1)} ${y(v)}`).join(' ') + (i === 1 ? ` L${x(1) + 0.01} ${y(data[0])}` : ''));
      lengths.push(tmp.getTotalLength());
    }
  }
  function draw(p) {
    const shown = len * p;
    line.style.strokeDashoffset = len - shown;
    let day = 1;
    while (day < DAYS && lengths[day] <= shown + 0.5) day++;
    dayEl.textContent = day;
    const done = p > 0.985;
    fig.classList.toggle('is-done', done);
    gsap.to([dot, label], { opacity: done ? 1 : 0, duration: 0.3, overwrite: true });
    gsap.to(ring, { opacity: done ? 1 : 0, attr: { r: done ? 22 : 10 }, duration: 0.6, ease: 'back.out(2)', overwrite: true });
  }
  gsap.set([dot, label, ring], { opacity: 0 });
  if (reduced) draw(1);
  else {
    draw(0);
    gsap.matchMedia()
      .add(DESKTOP, () => ScrollTrigger.create({ trigger: fig, start: 'center center', end: '+=110%', scrub: 0.5, pin: true, onUpdate: (st) => draw(clamp01(st.progress * 1.08)) }))
      .add('(max-width: 860px)', () => ScrollTrigger.create({ trigger: fig, start: 'top 75%', end: 'bottom 35%', scrub: 0.5, onUpdate: (st) => draw(clamp01(st.progress * 1.08)) }));
  }
}

// la alerta se va completando
if (!reduced) {
  const items = ['.phone__badge', '.phone__title', ...$$('.phone__factors li'), '.phone__quote'];
  gsap.from(items, {
    opacity: 0, y: 14, stagger: 0.12, ease: 'power2.out',
    scrollTrigger: { trigger: '.phone', start: 'top 75%', end: 'center 45%', scrub: 0.6 },
  });
  gsap.from('.phone', { y: 80, rotate: 3, ease: 'none', scrollTrigger: { trigger: '.alert-split', start: 'top bottom', end: 'center center', scrub: true } });
}

/* -------------------------------------------- 05 test de reacción (PVT) -- */
{
  const box = $('.pvt');
  const pad = $('.pvt__pad', box);
  const msg = $('.pvt__msg', box);
  const out = $('.pvt__out', box);
  const N = 5;
  let times = [], timer = 0, shownAt = 0;
  const setState = (s, m) => { box.dataset.state = s; msg.textContent = m; };
  function next() {
    setState('wait', `Espera… ${times.length + 1} de ${N}`);
    timer = setTimeout(() => { shownAt = performance.now(); setState('go', '¡Ya!'); }, 1400 + Math.random() * 2400);
  }
  function finish() {
    const mean = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    const best = Math.round(Math.min(...times));
    const lapses = times.filter((t) => t > 355).length; // umbral de la PVT-B
    out.textContent = `Media ${mean} ms · mejor ${best} ms · ${lapses} ${lapses === 1 ? 'lapso' : 'lapsos'} (más de 355 ms)`;
    setState('idle', 'Repetir');
  }
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const st = box.dataset.state;
    if (st === 'idle') { times = []; out.textContent = ''; next(); }
    else if (st === 'wait') {
      clearTimeout(timer);
      setState('early', 'Demasiado pronto. Otra vez…');
      timer = setTimeout(next, 900);
    } else if (st === 'go') {
      const rt = performance.now() - shownAt;
      times.push(rt);
      out.textContent = `${Math.round(rt)} ms`;
      if (times.length >= N) finish();
      else { setState('idle-wait', `${Math.round(rt)} ms`); timer = setTimeout(next, 700); }
    }
  });
  pad.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pad.dispatchEvent(new PointerEvent('pointerdown')); } });
}

/* --------------------------------------------- 05 respiración guiada -- */
{
  const box = $('.breath');
  const pad = $('.breath__pad', box);
  const ring = $('.breath__ring', box);
  const msg = $('.breath__msg', box);
  const out = $('.breath__out', box);
  let tl = null;
  function stop(text) {
    tl?.kill(); tl = null;
    gsap.to(ring, { scale: 0.75, duration: 0.6 });
    box.dataset.state = 'idle';
    msg.textContent = 'Empezar';
    out.textContent = text || '';
  }
  pad.addEventListener('click', () => {
    if (tl) { stop('Pausado. Puedes volver a empezar cuando quieras.'); return; }
    box.dataset.state = 'run';
    out.textContent = '';
    tl = gsap.timeline({ onComplete: () => stop('Hecho. Un minuto, seis respiraciones.') });
    for (let i = 0; i < 6; i++) {
      tl.call(() => { msg.textContent = `Inspira · ${6 - i} de 6`; })
        .to(ring, { scale: 1.6, duration: 4, ease: 'sine.inOut' })
        .call(() => { msg.textContent = `Espira · ${6 - i} de 6`; })
        .to(ring, { scale: 0.75, duration: 6, ease: 'sine.inOut' });
    }
  });
}

/* --------------------------------------------- 06 retardo real a Marte -- */
{
  const m = marsLight(new Date());
  const fmt = (sec) => { const mm = Math.floor(sec / 60), ss = Math.round(sec % 60); return `${mm} min ${String(ss).padStart(2, '0')} s`; };
  $('[data-mars="oneway"]').textContent = fmt(m.seconds);
  $('[data-mars="round"]').textContent = fmt(m.seconds * 2);
  $('[data-mars="km"]').textContent = Math.round(m.km / 1e6).toLocaleString('es-ES');
  if (!reduced) {
    gsap.fromTo('.light__photon', { left: '0%' }, {
      left: '100%', ease: 'none',
      scrollTrigger: { trigger: '.light', start: 'top 70%', end: 'bottom 30%', scrub: 0.8 },
    });
  }
}

/* --------------------------------------------- 07 cómo piensa (pasos) -- */
{
  const steps = $$('.pipe li');
  ScrollTrigger.create({
    trigger: '.pipe', start: 'top 80%', end: 'bottom 50%', scrub: true,
    onUpdate: (s) => steps.forEach((li, i) => li.classList.toggle('is-on', s.progress >= (i + 0.5) / steps.length)),
    onLeave: () => steps.forEach((li) => li.classList.add('is-on')),
  });
  if (reduced) steps.forEach((li) => li.classList.add('is-on'));
}

/* ------------------------------------------------------------ cierre -- */
if (!reduced) {
  gsap.from('.finale__title span', { yPercent: 60, opacity: 0, stagger: 0.12, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.finale', start: 'top 70%', once: true } });
  gsap.from('.finale img', { scale: 0.6, rotate: -20, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.finale', start: 'top 75%', once: true } });
}

/* ----------------------------------------- cabecera, progreso, índice -- */
const topbar = $('.topbar');
const bar = $('.progress i');
ScrollTrigger.create({
  start: 0, end: 'max',
  onUpdate: (s) => {
    bar.style.transform = `scaleX(${s.progress})`;
    topbar.classList.toggle('is-scrolled', s.scroll() > 8);
  },
});

const rail = $('.rail');
ScrollTrigger.create({
  trigger: '#problema', start: 'top 60%',
  endTrigger: '#prototipo', end: 'bottom 40%',
  onToggle: (s) => rail.classList.toggle('is-visible', s.isActive),
});
$$('[data-chapter]').forEach((sec) => {
  const id = sec.id;
  ScrollTrigger.create({
    trigger: sec, start: 'top 50%', end: 'bottom 50%',
    onToggle: (s) => {
      if (!s.isActive) return;
      $$('.rail a').forEach((a) => a.classList.toggle('is-on', a.dataset.ch === id));
      $$('.topnav a').forEach((a) => a.classList.toggle('is-on', a.getAttribute('href') === `#${id}`));
    },
  });
});
// en el carrusel horizontal el índice estorba
ScrollTrigger.create({ trigger: '.hscroll', start: 'top 80%', end: 'bottom 20%', onToggle: (s) => rail.classList.toggle('is-hidden', s.isActive) });


/* ------------------------------------- chequeo en 10 s, Paze y clima espacial -- */
import('./landing/quickcheck.js').then(({ initQuickCheck }) => initQuickCheck($('#qc'), { reduced }));

// Paze (WebGL) solo se carga cuando su capítulo se acerca a la pantalla.
{
  const el = $('#paze');
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    import('./landing/paze.js').then(({ initPaze }) => initPaze(el, { reduced }));
  }, { rootMargin: '600px 0px' });
  io.observe(el);
}

import('./landing/spaceweather.js')
  .then(({ initSpaceWeather }) => initSpaceWeather($('#sw')))
  .then((shown) => { if (shown) ScrollTrigger.refresh(); });

// La Tierra del cierre: se carga al acercarse y asoma con el scroll.
{
  const fin = $('#finale');
  const cv = $('#earth');
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    import('./landing/earth.js').then(({ createEarth }) => {
      const earth = createEarth(cv, { reduced });
      if (!earth) { fin.classList.add('no-earth'); return; }
      if (reduced) { earth.target.rise = 1; earth.renderOnce(); return; }
      // el scroll decide cuánto asoma; la animación solo corre mientras el lienzo está en pantalla
      ScrollTrigger.create({
        trigger: fin, start: 'top bottom', end: 'bottom bottom', scrub: true,
        onUpdate: (st) => { earth.target.rise = st.progress; },
      });
      new IntersectionObserver(([v]) => (v.isIntersecting ? earth.start() : earth.stop())).observe(cv);
      ScrollTrigger.refresh();
    });
  }, { rootMargin: '800px 0px' });
  io.observe(fin);
}

if (!reduced) gsap.from('.hero__chips li', { opacity: 0, y: 12, stagger: 0.06, duration: 0.8, ease: 'power3.out', delay: 0.9 });

/* --------------------------------------------- 3D: hero y desmontaje -- */
const steps8 = $$('.steps li');
const countEl = $('.teardown__count b');
let lastStep = -1;
function showStep(i) {
  if (i === lastStep) return;
  lastStep = i;
  steps8.forEach((li, k) => li.classList.toggle('is-on', k === i));
  countEl.textContent = i;
}

function noWebGL() { document.documentElement.classList.add('no-webgl'); ScrollTrigger.refresh(); }

import('./stage.js').then(({ createStage }) => {
  const stage = createStage($('#station'), { reduced });
  if (!stage) { noWebGL(); return; }
  stage.ready.catch(noWebGL);
  const T = stage.target;
  const narrow = () => stage.aspect < 0.9;
  let inHero = true, inTear = false;
  const sync = () => stage.setVisible((inHero && !narrow()) || inTear);
  window.addEventListener('resize', sync);

  function heroPose(p) {
    Object.assign(T, { x: 0.5, y: -0.04 + p * 0.5, scale: 1.02 - p * 0.12, rotY: -0.55 + p * 1.4, rotX: 0.16 + p * 0.1, explode: 0, xray: false });
  }
  function tearPose(p) {
    const e = clamp01(p * 1.12 - 0.04);
    const step = Math.round(e * 8);
    showStep(step);
    const xray = step >= 1 && step <= 4;
    if (narrow()) Object.assign(T, { x: 0, y: 0.3, scale: 0.6, rotY: -0.7 + e * 0.5, rotX: 0.42, explode: e, xray });
    else Object.assign(T, { x: 0.3, y: -0.02, scale: 1.18, rotY: -0.75 + e * 0.6, rotX: 0.38, explode: e, xray });
  }

  heroPose(0);
  sync();
  ScrollTrigger.create({
    trigger: '.hero', start: 'top top', end: 'bottom 35%', scrub: true,
    onUpdate: (s) => { if (!inTear) heroPose(s.progress); },
    onToggle: (s) => { inHero = s.isActive; sync(); },
  });
  ScrollTrigger.create({
    trigger: '.teardown', start: 'top top', end: 'bottom bottom',
    onUpdate: (s) => tearPose(s.progress),
    onToggle: (s) => { inTear = s.isActive; if (inTear) tearPose(s.progress); sync(); },
  });
  ScrollTrigger.refresh();
}).catch(noWebGL);

window.addEventListener('load', () => ScrollTrigger.refresh());
