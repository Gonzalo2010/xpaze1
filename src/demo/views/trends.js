// #/tendencias — historial por días de misión y por métrica, con la banda de la
// línea base personal, la media EWMA y los días que se salieron.

import { h, s, fmt, viewHead, card, lineChart, responsive, metricName, metricUnit, fmtMetric } from '../core/ui.js';
import { METRICS, FEATURES, crewById } from '../core/engine/crew.js';
import { baselineOf, THRESHOLDS } from '../core/engine/analyze.js';
import { ewma } from '../core/engine/stats.js';

export function mount(el, ctx) {
  const { store, navigate, i18n: { t } } = ctx;
  const a = store.currentAstronaut();
  if (!a) { navigate('#/'); return null; }
  const astro = crewById(a.id);
  const history = store.physioHistory(a.id);
  let metric = 'hr', span = 30, cursor = -1, chart = null;

  const box = h('div', { class: 'chart-box', tabindex: '0', role: 'group' });
  const readout = h('p', { class: 'readout', role: 'status', 'aria-live': 'polite' });
  const stats = h('dl', { class: 'stats' });
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': t('trends.metric') });
  const spans = h('div', { class: 'tabs', role: 'group', 'aria-label': t('trends.span') });

  // línea base y z de cada día, calculados solo con los días anteriores
  function compute() {
    const days = history.slice(-Math.min(span, history.length));
    const first = history.length - days.length;
    const def = METRICS[metric];
    const rows = days.map((d, i) => {
      const before = history.slice(0, first + i);
      const b = baselineOf(astro, before, metric);
      const z = (d[metric] - b.median) / b.scale;
      return { day: d.day, value: d[metric], lo: b.median - THRESHOLDS.watch * b.scale, hi: b.median + THRESHOLDS.watch * b.scale, median: b.median, scale: b.scale, z, adverse: z * def.adverse };
    });
    const e = ewma(rows.map((x) => x.value), THRESHOLDS.lambda, rows[0].median);
    return { rows, e, def };
  }

  let data = compute();

  function say(i) {
    const x = data.rows[i];
    if (!x) { readout.textContent = t('trends.readout.hint'); return; }
    readout.replaceChildren(
      h('b', null, t('trends.readout.day', { day: x.day })), ' · ',
      `${fmtMetric(metric, x.value)} ${metricUnit(metric)} · `,
      t('trends.readout.base', { lo: fmtMetric(metric, x.lo), hi: fmtMetric(metric, x.hi) }), ' · ',
      t('trends.readout.z', { z: fmt(x.z, 1) }));
  }

  function draw(width) {
    const { rows, e, def } = data;
    const svg = lineChart({
      width, height: width < 520 ? 240 : 320,
      xs: rows.map((x) => x.day),
      bands: [{ lo: rows.map((x) => x.lo), hi: rows.map((x) => x.hi) }],
      hlines: [{ y: def.pop[0], label: t('trends.pop.lo') }, { y: def.pop[1], label: t('trends.pop.hi') }],
      series: [
        { values: rows.map((x) => x.value), cls: 'l-faint', dots: true, flags: rows.map((x) => (Math.abs(x.z) >= THRESHOLDS.anomaly ? 'bad' : Math.abs(x.z) >= THRESHOLDS.watch ? 'warn' : '')) },
        { values: e, cls: 'l-ewma' },
      ],
      yFmt: (v) => fmt(v, def.digits),
      xFmt: (d) => `D${d}`,
    });
    svg.setAttribute('aria-label', t('trends.chart.aria', { metric: metricName(metric), days: rows.length }));
    const { X, Y, P } = svg.scales;
    const line = s('line', { class: 'cursor', y1: P.t, y2: Number(svg.getAttribute('height')) - P.b, x1: -10, x2: -10 });
    svg.append(line);
    const move = (i) => {
      cursor = Math.max(0, Math.min(rows.length - 1, i));
      const x = X(rows[cursor].day);
      line.setAttribute('x1', x); line.setAttribute('x2', x);
      say(cursor);
    };
    svg.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * width;
      let best = 0, bd = Infinity;
      rows.forEach((x, i) => { const d = Math.abs(X(x.day) - px); if (d < bd) { bd = d; best = i; } });
      move(best);
    });
    chart = { move, Y };
    if (cursor >= 0) move(cursor);
    return svg;
  }

  const resp = responsive(box, draw);

  box.addEventListener('keydown', (ev) => {
    if (!chart) return;
    const n = data.rows.length;
    if (ev.key === 'ArrowLeft') { chart.move((cursor < 0 ? n : cursor) - 1); ev.preventDefault(); }
    if (ev.key === 'ArrowRight') { chart.move((cursor < 0 ? n - 2 : cursor) + 1); ev.preventDefault(); }
  });

  function refresh() {
    data = compute();
    cursor = -1;
    [...tabs.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === metric)));
    [...spans.children].forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === span)));
    box.setAttribute('aria-label', t('trends.chart.keys'));
    const last = data.rows[data.rows.length - 1];
    const def = data.def;
    const out = data.rows.filter((x) => Math.abs(x.z) >= THRESHOLDS.watch).length;
    const stat = (label, value, unit, note) => h('div', { class: 'stat' }, h('dt', null, label), h('dd', null, value, unit ? h('small', null, unit) : null), note ? h('p', null, note) : null);
    stats.replaceChildren(
      stat(t('trends.stat.today'), fmtMetric(metric, last.value), metricUnit(metric), t('trends.stat.today.note', { z: fmt(last.z, 1) })),
      stat(t('trends.stat.base'), fmtMetric(metric, last.median), metricUnit(metric), t('trends.stat.base.note')),
      stat(t('trends.stat.var'), `±${fmt(last.scale, Math.max(1, def.digits))}`, metricUnit(metric), t('trends.stat.var.note')),
      stat(t('trends.stat.out'), fmt(out), null, t('trends.stat.out.note', { days: data.rows.length })));
    say(-1);
    resp.redraw();
  }

  FEATURES.forEach((m) => tabs.append(h('button', { class: 'tab', type: 'button', dataset: { m }, onClick: () => { metric = m; refresh(); } }, metricName(m))));
  [14, 30, 999].forEach((n) => spans.append(h('button', { class: 'tab', type: 'button', dataset: { n }, onClick: () => { span = n; refresh(); } }, n === 999 ? t('trends.span.all') : t('trends.span.days', { n }))));

  el.append(
    viewHead({ eyebrow: t('trends.eyebrow', { name: a.name }), title: t('trends.title'), lead: t('trends.lead') }),
    card({ class: 'stack' },
      h('div', { class: 'row' }, tabs, h('span', { class: 'spacer' }), spans),
      box, readout,
      h('p', { class: 'legend' },
        h('span', null, h('i', { class: 'l-raw' }), t('trends.legend.raw')),
        h('span', null, h('i', { class: 'l-ewma' }), t('trends.legend.ewma')),
        h('span', null, h('i', { class: 'l-mine' }), t('trends.legend.band')),
        h('span', null, h('i', { class: 'l-flag' }), t('trends.legend.flag'))),
      stats),
    h('div', { class: 'next' },
      h('p', { class: 'next-hint' }, t('trends.next.hint')),
      h('a', { class: 'btn btn--light', href: '#/laboratorio' }, t('trends.next.lab')),
      h('a', { class: 'btn btn--glass glass', href: '#/resultado' }, t('nav.result'))));

  refresh();
  return () => resp.stop();
}
