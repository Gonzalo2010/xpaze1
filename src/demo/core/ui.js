// Utilidades de interfaz compartidas: crear DOM, formatear números, gráficas SVG.

import { t, lang } from './i18n.js';
import { METRICS } from './engine/crew.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
}

function fill(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// h('div', { class: 'card' }, 'texto', otroNodo)
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  apply(el, attrs);
  return fill(el, kids);
}

export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  return fill(el, kids);
}

export const locale = () => (lang() === 'es' ? 'es-ES' : 'en-US');

export function fmt(v, d = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
}

export const signed = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d);

export const metricName = (m) => t(`m.${m}`);
export const metricUnit = (m) => t(METRICS[m].unitKey);
export const fmtMetric = (m, v) => fmt(v, METRICS[m].digits);

// Convierte una línea del motor { key, vars } en texto del idioma actual.
export function lineText(line) {
  if (!line) return '';
  const vars = {};
  for (const [k, v] of Object.entries(line.vars || {})) {
    if (k === 'metric') { vars.metric = t(`m.${v}.in`); vars.unit = metricUnit(v); }
    else if (v && typeof v === 'object' && 'v' in v) vars[k] = fmt(v.v, v.d || 0);
    else vars[k] = v;
  }
  return t(line.key, vars);
}

const STATUS_CLASS = { normal: 'ok', watch: 'warn', anomaly: 'bad', unreliable: 'none', ok: 'ok', alert: 'bad', nodata: 'none' };
export const statusClass = (status) => STATUS_CLASS[status] || 'none';

export function statusPill(status, label = t(`status.${status}`)) {
  return h('span', { class: `status status--${statusClass(status)}` }, h('i', { class: 'status-dot', 'aria-hidden': 'true' }), label);
}

export function icon(name, size = 20) {
  const paths = {
    arrow: 'M5 12h14M13 6l6 6-6 6',
    back: 'M19 12H5M11 6l-6 6 6 6',
    reset: 'M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    play: 'M8 5.5v13l10-6.5z',
    skip: 'M6 6l8 6-8 6zM17 6v12',
    heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
    wave: 'M3 12h4l2-6 4 12 2-6h6',
    flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3',
    plus: 'M12 5v14M5 12h14',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  };
  return s('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' },
    s('path', { d: paths[name] || '' }));
}

// Cabecera de vista: antetítulo, título (recibe el foco al navegar) y entradilla.
export function viewHead({ eyebrow, title, lead, extra }) {
  return h('header', { class: 'view-head' },
    eyebrow && h('p', { class: 'eyebrow' }, eyebrow),
    h('h1', { class: 'view-title', tabindex: '-1' }, title),
    lead && h('p', { class: 'lead' }, lead),
    extra);
}

export function card(attrs, ...kids) {
  const a = { ...(attrs || {}) };
  a.class = `card glass ${a.class || ''}`.trim();
  return h(a.tag || 'section', { ...a, tag: null }, ...kids);
}

// Redibuja `draw(width)` cuando cambia la anchura del contenedor. Devuelve cómo parar.
export function responsive(el, draw) {
  let last = -1;
  const run = () => {
    const w = Math.round(el.clientWidth);
    if (!w || w === last) return;
    last = w;
    el.replaceChildren(draw(w));
  };
  const ro = new ResizeObserver(run);
  ro.observe(el);
  run();
  return { redraw() { last = -1; run(); }, stop() { ro.disconnect(); } };
}

/* ------------------------------------------------------------ gráficas -- */

export function sparkline(values, { width = 120, height = 32, cls = '' } = {}) {
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [3 + (i / Math.max(1, values.length - 1)) * (width - 6), height - 4 - ((v - lo) / span) * (height - 8)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return s('svg', { class: `spark ${cls}`, viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' },
    s('path', { d, class: 'spark-line' }), s('circle', { cx: last[0], cy: last[1], r: 2.6, class: 'spark-dot' }));
}

// Escala lineal sencilla.
export function scale(d0, d1, r0, r1) {
  const k = (r1 - r0) / (d1 - d0 || 1);
  return (v) => r0 + (v - d0) * k;
}

export function niceTicks(lo, hi, count = 4) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const pathOf = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');

/**
 * Gráfica de líneas con bandas. Todo en unidades de datos:
 *  xs: [..]; series: [{ values, cls, dots, flags }]; bands: [{ lo:[..], hi:[..], cls }];
 *  hlines: [{ y, cls, label }]; yFmt(v); xFmt(x)
 */
export function lineChart({ width, height = 260, xs, series = [], bands = [], hlines = [], yFmt = (v) => fmt(v), xFmt = (x) => String(x), yDomain, pad = {} }) {
  const P = { l: 44, r: 14, t: 14, b: 28, ...pad };
  const all = [];
  for (const sr of series) all.push(...sr.values.filter(Number.isFinite));
  for (const b of bands) { all.push(...b.lo, ...b.hi); }
  let lo = yDomain ? yDomain[0] : Math.min(...all), hi = yDomain ? yDomain[1] : Math.max(...all);
  if (!yDomain) { const m = (hi - lo || 1) * 0.12; lo -= m; hi += m; }
  const X = scale(xs[0], xs[xs.length - 1], P.l, width - P.r);
  const Y = scale(lo, hi, height - P.b, P.t);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img' });
  for (const tk of niceTicks(lo, hi, 4)) {
    svg.append(s('line', { x1: P.l, x2: width - P.r, y1: Y(tk), y2: Y(tk), class: 'grid' }),
      s('text', { x: P.l - 8, y: Y(tk) + 4, class: 'tick', 'text-anchor': 'end' }, yFmt(tk)));
  }
  const stepX = Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor((width - P.l - P.r) / 56))));
  for (let i = xs.length - 1; i >= 0; i -= stepX) {
    svg.append(s('text', { x: X(xs[i]), y: height - 8, class: 'tick', 'text-anchor': 'middle' }, xFmt(xs[i])));
  }
  for (const b of bands) {
    const top = xs.map((x, i) => [X(x), Y(b.hi[i])]);
    const bot = xs.map((x, i) => [X(x), Y(b.lo[i])]).reverse();
    svg.append(s('path', { d: `${pathOf(top)}L${bot.map((p) => p.map((n) => n.toFixed(1)).join(',')).join('L')}Z`, class: `band ${b.cls || ''}` }));
  }
  for (const hl of hlines) {
    if (hl.y < lo || hl.y > hi) continue;
    svg.append(s('line', { x1: P.l, x2: width - P.r, y1: Y(hl.y), y2: Y(hl.y), class: `hline ${hl.cls || ''}` }));
    if (hl.label) svg.append(s('text', { x: width - P.r - 4, y: Y(hl.y) - 5, class: 'hlabel', 'text-anchor': 'end' }, hl.label));
  }
  for (const sr of series) {
    const pts = xs.map((x, i) => [X(x), Y(sr.values[i])]).filter((p) => Number.isFinite(p[1]));
    svg.append(s('path', { d: pathOf(pts), class: `line ${sr.cls || ''}` }));
    if (sr.dots) {
      xs.forEach((x, i) => {
        if (!Number.isFinite(sr.values[i])) return;
        const flag = sr.flags?.[i];
        svg.append(s('circle', { cx: X(x), cy: Y(sr.values[i]), r: flag ? 4.2 : i === xs.length - 1 ? 4.5 : 2.6, class: `dot ${sr.cls || ''} ${flag ? `flag-${flag}` : ''} ${i === xs.length - 1 ? 'is-last' : ''}` }));
      });
    }
  }
  svg.scales = { X, Y, P, lo, hi };
  return svg;
}

/* ---------------------------------------------------------------- varios -- */

export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

let toastTimer = 0;
export function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

// Canvas nítido en pantallas de alta densidad. Devuelve { ctx, w, h } en px CSS.
export function fitCanvas(canvas) {
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: hgt };
}
