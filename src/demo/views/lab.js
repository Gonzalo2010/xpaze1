// #/laboratorio — inyectar escenarios, avanzar días y «Por dentro»: ver el z-score
// robusto, el EWMA y el Isolation Forest calculando con los datos de hoy.

import { h, s, fmt, signed, viewHead, card, icon, statusPill, lineText, lineChart, responsive, scale, metricName, metricUnit, fmtMetric, toast, reducedMotion } from '../core/ui.js';
import { METRICS, FEATURES, VITALS, crewById } from '../core/engine/crew.js';
import { SCENARIO_NAMES, SCENARIOS, injectScenario, removeScenario, clearScenarios, activeScenarios, advanceDays, instantCheck, previewCheck, historyBefore } from '../core/engine/mission.js';
import { THRESHOLDS, baselineOf, driftOf, forestFor } from '../core/engine/analyze.js';
import { tracePath, pathLengths, cFactor } from '../core/engine/iforest.js';
import { expectedShift } from '../core/engine/context.js';
import { mean, mad } from '../core/engine/stats.js';
import { makeReport } from '../core/engine/link.js';
import { psychReady, psychScenario } from '../core/psych.js';

const PSYCH_MAP = { badNight: 'poor-sleep', stress: 'sustained-stress' };
const PSYCH_ONLY = ['isolation', 'crew-conflict', 'workload'];
const level = (adverse) => (adverse >= THRESHOLDS.anomaly ? 'bad' : adverse >= THRESHOLDS.watch ? 'warn' : '');

export function mount(el, ctx) {
  const { store, i18n: { t } } = ctx;
  let metric = 'hr', lambda = THRESHOLDS.lambda, tree = 0, timer = 0, charts = [];
  let lastInstant = null;

  const currentId = () => store.getState().astronautId || store.crew()[0].id;

  function stopCharts() {
    for (const c of charts) c.stop();
    charts = [];
    clearInterval(timer);
  }

  function act(fn, message) {
    store.update(fn);
    if (message) toast(message);
    render();
  }

  /* -------------------------------------------------------- escenarios -- */
  function scenarioCard(state, id, a, pv) {
    const active = activeScenarios(state, id);
    const who = h('div', { class: 'who-tabs', role: 'group', 'aria-label': t('lab.who') },
      store.crew().map((c) => h('button', { class: 'who-tab', type: 'button', 'aria-pressed': String(c.id === id), onClick: () => act((st) => { st.astronautId = c.id; st.onboarded = true; }) },
        h('i', { class: 'avatar', style: `--hue:${c.hue}`, 'aria-hidden': 'true' }, c.initials), c.name)));

    const buttons = SCENARIO_NAMES.map((name) => {
      const on = active.includes(name);
      return h('button', { class: 'scn', type: 'button', 'aria-pressed': String(on), dataset: { scn: name }, onClick: () => {
        if (on) act((st) => removeScenario(st, name, id), t('lab.toast.off', { name: t(`scn.${name}`) }));
        else {
          act((st) => { st.astronautId = id; injectScenario(st, name, id); }, t('lab.toast.on', { name: t(`scn.${name}`) }));
          if (PSYCH_MAP[name]) psychScenario(PSYCH_MAP[name], id);
        }
      } },
        h('span', { class: 'scn-name' }, t(`scn.${name}`), h('span', { class: 'scn-state' }, on ? t('lab.scn.on') : SCENARIOS[name].scope === 'crew' ? t('lab.scn.crew') : SCENARIOS[name].acute ? t('lab.scn.next') : '')),
        h('span', { class: 'scn-desc' }, t(`scn.${name}.d`)));
    });

    const mind = psychReady() ? PSYCH_ONLY.map((name) => h('button', { class: 'scn scn--mind', type: 'button', dataset: { scn: name }, onClick: () => {
      toast(psychScenario(name, id) ? t('lab.toast.on', { name: t(`scn.mind.${name}`) }) : t('lab.toast.mindOff'));
    } }, h('span', { class: 'scn-name' }, t(`scn.mind.${name}`), h('span', { class: 'scn-state' }, t('nav.mind'))), h('span', { class: 'scn-desc' }, t(`scn.mind.${name}.d`)))) : [];

    const r = pv.analysis;
    const result = h('div', { class: 'lab-result', role: 'status', 'aria-live': 'polite' },
      statusPill(r.status),
      h('p', null, h('b', null, t('lab.preview', { name: a.name.split(' ')[0], day: state.day })), ' ', lineText(r.headline)),
      h('button', { class: 'btn btn--light btn--small', type: 'button', id: 'instant-check', onClick: () => {
        let done = null;
        store.update((st) => {
          st.astronautId = id; st.onboarded = true;
          done = instantCheck(st, id, Date.now());
          st.link.queue.unshift(makeReport(done.check, st.link.delayMin, Date.now()));
          st.link.queue.length = Math.min(st.link.queue.length, 12);
        });
        lastInstant = done.check.id;
        toast(t(done.retried ? 'lab.toast.checkedRetry' : 'lab.toast.checked'));
        render();
      } }, icon('heart', 16), t('lab.instant')),
      lastInstant && store.latestCheck(id)?.id === lastInstant ? h('a', { class: 'link', href: '#/resultado' }, t('lab.seeResult'), icon('arrow', 16)) : h('a', { class: 'link', href: '#/chequeo', onClick: () => store.update((st) => { st.astronautId = id; st.onboarded = true; }) }, t('lab.guided'), icon('arrow', 16)));

    return card({ class: 'stack' },
      h('div', { class: 'card-head', style: 'margin-bottom:0' },
        h('div', null, h('h2', { class: 'card-title' }, t('lab.scn.title')), h('p', { class: 'card-sub' }, t('lab.scn.sub'))),
        h('span', { class: 'chip chip--blue' }, t('shell.day', { day: state.day }))),
      who,
      h('div', { class: 'scn-grid' }, buttons, mind),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn--glass glass btn--small', type: 'button', id: 'adv-1', onClick: () => act((st) => advanceDays(st, 1), t('lab.toast.day', { day: state.day + 1 })) }, icon('plus', 16), t('lab.adv1')),
        h('button', { class: 'btn btn--glass glass btn--small', type: 'button', id: 'adv-3', onClick: () => act((st) => advanceDays(st, 3), t('lab.toast.day', { day: state.day + 3 })) }, icon('plus', 16), t('lab.adv3')),
        h('button', { class: 'btn btn--glass glass btn--small', type: 'button', id: 'clear-scn', disabled: !state.scenarios.length && !active.length, onClick: () => {
          act((st) => clearScenarios(st), t('lab.toast.clear'));
          for (const c of store.crew()) psychScenario('recovery', c.id);
        } }, icon('reset', 16), t('lab.clear'))),
      result);
  }

  /* --------------------------------------------------------- z robusto -- */
  function zCard(astro, hist, pv) {
    const box = h('div', { class: 'chart-box' });
    const formula = h('div', { class: 'formula', tabindex: '0' });
    const note = h('p', { class: 'verdict-line' });

    const draw = (width) => {
      const x = pv.analysis.metrics[metric];
      const b = baselineOf(astro, hist, metric);
      const height = 150, P = { l: 14, r: 14 };
      const lo = Math.min(x.band[0] - b.scale, ...b.values, x.adjusted) - b.scale * 0.6;
      const hi = Math.max(x.band[1] + b.scale, ...b.values, x.adjusted) + b.scale * 0.6;
      const X = scale(lo, hi, P.l, width - P.r);
      const svg = s('svg', { class: 'chart scatter', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': t('lab.z.aria', { metric: metricName(metric) }) });
      const y0 = 30, y1 = 108;
      svg.append(
        s('rect', { x: X(b.median - THRESHOLDS.anomaly * b.scale), y: y0, width: X(b.median + THRESHOLDS.anomaly * b.scale) - X(b.median - THRESHOLDS.anomaly * b.scale), height: y1 - y0, rx: 10, fill: 'var(--warn)', opacity: 0.1 }),
        s('rect', { x: X(x.band[0]), y: y0, width: X(x.band[1]) - X(x.band[0]), height: y1 - y0, rx: 10, fill: 'var(--ok)', opacity: 0.2 }),
        s('line', { x1: X(b.median), x2: X(b.median), y1: y0 - 6, y2: y1 + 6, stroke: 'var(--ok-ink)', 'stroke-width': 2 }),
        s('text', { x: X(b.median), y: y0 - 12, class: 'axl', 'text-anchor': 'middle' }, t('lab.z.median')),
        s('line', { x1: P.l, x2: width - P.r, y1: y1 + 14, y2: y1 + 14, class: 'axis' }));
      b.values.forEach((v, i) => svg.append(s('circle', { cx: X(v), cy: y0 + 12 + ((i * 37) % 55), r: 3.4, class: 'pt' })));
      for (const k of [-THRESHOLDS.anomaly, -THRESHOLDS.watch, THRESHOLDS.watch, THRESHOLDS.anomaly]) {
        svg.append(s('text', { x: X(b.median + k * b.scale), y: y1 + 30, class: 'axl', 'text-anchor': 'middle' }, `${signed(k, 1)}σ`));
      }
      const lv = level(x.adverse);
      svg.append(
        s('line', { x1: X(x.adjusted), x2: X(x.adjusted), y1: y0 - 2, y2: y1 + 2, stroke: lv === 'bad' ? 'var(--pulse)' : lv === 'warn' ? 'var(--warn)' : 'var(--ink)', 'stroke-width': 2 }),
        s('circle', { cx: X(x.adjusted), cy: (y0 + y1) / 2, r: 7, class: 'today', style: lv === 'bad' ? '' : lv === 'warn' ? 'fill:var(--warn)' : 'fill:var(--ink)' }),
        s('text', { x: Math.max(30, Math.min(width - 30, X(x.adjusted))), y: y1 + 44, class: 'axl', 'text-anchor': 'middle', style: 'font-weight:700;fill:var(--ink)' }, t('lab.z.today')));
      return svg;
    };

    const text = () => {
      const x = pv.analysis.metrics[metric];
      const b = baselineOf(astro, hist, metric);
      const d = Math.max(1, METRICS[metric].digits);
      const rawMad = mad(b.values);
      const lv = level(x.adverse);
      formula.replaceChildren(
        h('div', null, `${t('lab.z.f.median')} = ${fmt(b.median, d)} · MAD = ${fmt(rawMad, d + 1)} · ${t('lab.z.f.scale')} = ${fmt(1.4826, 4)} × MAD = ${fmt(b.scale, d + 1)}`),
        h('div', null, `z = (x − ${t('lab.z.f.median')}) / ${t('lab.z.f.scale')} = (${fmt(x.adjusted, d)} − ${fmt(b.median, d)}) / ${fmt(b.scale, d + 1)} = `, h('b', { class: lv ? `hi-${lv}` : 'hi-ok' }, signed(x.z, 2))),
        h('div', null, `${t('lab.z.f.classic')} = ${signed(x.zClassic, 2)}`));
      note.replaceChildren(
        h('b', null, t(lv === 'bad' ? 'lab.z.v.bad' : lv === 'warn' ? 'lab.z.v.warn' : Math.abs(x.z) >= THRESHOLDS.watch ? 'lab.z.v.benign' : 'lab.z.v.ok')), ' ',
        t('lab.z.note', { n: b.n }), pv.analysis.context !== 'rest' && VITALS.includes(metric) ? ` ${t('lab.z.ctx')}` : '');
    };

    const resp = responsive(box, draw);
    charts.push(resp);
    text();
    return {
      node: card(null, h('div', null, h('p', { class: 'label' }, '01'), h('h3', { class: 'card-title' }, t('lab.z.title')), h('p', { class: 'card-sub' }, t('lab.z.sub'))), box, formula, note),
      update: () => { resp.redraw(); text(); },
    };
  }

  /* -------------------------------------------------------------- EWMA -- */
  function ewmaCard(astro, hist, pv) {
    const box = h('div', { class: 'chart-box' });
    const formula = h('div', { class: 'formula', tabindex: '0' });
    const note = h('p', { class: 'verdict-line' });
    const out = h('output', { class: 'num', for: 'lambda' }, fmt(lambda, 2));
    const slider = h('input', { type: 'range', id: 'lambda', min: 0.05, max: 0.9, step: 0.05, value: lambda });

    const calc = () => {
      const x = pv.analysis.metrics[metric];
      const tol = VITALS.includes(metric) ? expectedShift(pv.analysis.context).tol : 1;
      return driftOf(astro, hist, metric, x.adjusted, { lambda, tol });
    };

    const draw = (width) => {
      const d = calc();
      const today = store.missionDay();
      const xs = d.series.map((_, i) => today - (d.series.length - 1 - i));
      const svg = lineChart({
        width, height: 220, xs,
        bands: [{ lo: d.points.map((p) => p.lower), hi: d.points.map((p) => p.upper) }],
        hlines: [{ y: d.center, cls: 'h-center', label: t('lab.ewma.center') }],
        series: [{ values: d.series, cls: 'l-faint', dots: true }, { values: d.points.map((p) => p.value), cls: 'l-ewma', dots: true, flags: d.points.map((p) => (p.out ? 'bad' : '')) }],
        yFmt: (v) => fmt(v, METRICS[metric].digits), xFmt: (x) => `D${x}`,
      });
      svg.setAttribute('aria-label', t('lab.ewma.aria', { metric: metricName(metric) }));
      return svg;
    };

    const text = () => {
      const d = calc();
      const dg = Math.max(1, METRICS[metric].digits);
      const prev = d.points.length > 1 ? d.points[d.points.length - 2].value : d.center;
      const xt = d.series[d.series.length - 1];
      formula.replaceChildren(
        h('div', null, 'eₜ = λ·xₜ + (1 − λ)·eₜ₋₁'),
        h('div', null, `${fmt(lambda, 2)} × ${fmt(xt, dg)} + ${fmt(1 - lambda, 2)} × ${fmt(prev, dg + 1)} = `, h('b', { class: d.out ? 'hi-bad' : 'hi-ok' }, fmt(d.last, dg + 1))),
        h('div', null, `${t('lab.ewma.limits')} = ${fmt(d.center, dg)} ± ${fmt(d.L, 0)}·σ·√(λ/(2−λ)) = ${fmt(d.center - d.limit, dg + 1)} … ${fmt(d.center + d.limit, dg + 1)}`));
      note.replaceChildren(h('b', null, t(d.out ? 'lab.ewma.v.out' : 'lab.ewma.v.in')), ' ', t(d.out ? 'lab.ewma.note.out' : 'lab.ewma.note.in', { days: Math.max(1, d.days) }));
    };

    const resp = responsive(box, draw);
    charts.push(resp);
    slider.addEventListener('input', () => { lambda = Number(slider.value); out.textContent = fmt(lambda, 2); resp.redraw(); text(); });
    text();
    return {
      node: card(null, h('div', null, h('p', { class: 'label' }, '02'), h('h3', { class: 'card-title' }, t('lab.ewma.title')), h('p', { class: 'card-sub' }, t('lab.ewma.sub'))),
        box,
        h('div', { class: 'lambda' }, h('label', { for: 'lambda' }, t('lab.ewma.lambda')), slider, out),
        h('p', { class: 'legend' }, h('span', null, h('i', { class: 'l-raw' }), t('lab.ewma.l.raw')), h('span', null, h('i', { class: 'l-ewma' }), 'EWMA'), h('span', null, h('i', { class: 'l-mine' }), t('lab.ewma.l.band'))),
        formula, note),
      update: () => { resp.redraw(); text(); },
    };
  }

  /* -------------------------------------------------- Isolation Forest -- */
  function forestCard(astro, hist, pv) {
    const f = forestFor(astro, hist, store.getState().seed);
    const node = card(null, h('div', null, h('p', { class: 'label' }, '03'), h('h3', { class: 'card-title' }, t('lab.if.title')), h('p', { class: 'card-sub' }, t('lab.if.sub'))));
    if (!f || !pv.analysis.iforest) { node.append(h('p', { class: 'muted' }, t('lab.if.none'))); return { node, update() {} }; }
    const x = FEATURES.map((m) => pv.analysis.metrics[m].z);
    const order = FEATURES.map((m, i) => i).sort((p, q) => Math.abs(x[q]) - Math.abs(x[p]));
    const fa = order[0], fb = order[1];
    const lens = pathLengths(f.forest, x);
    const avg = mean(lens);
    const c = cFactor(f.forest.psi);
    const info = pv.analysis.iforest;

    const box = h('div', { class: 'chart-box' });
    const cuts = h('p', { class: 'cuts' });
    const caption = h('p', { class: 'verdict-line', role: 'status' });
    const maxLen = Math.max(...lens);
    const depths = h('div', { class: 'depths', role: 'img', 'aria-label': t('lab.if.depths.aria') }, lens.map((l) => h('i', { style: `height:${(l / maxLen) * 100}%` })));

    const dom = (j) => {
      const vals = f.X.map((r) => r[j]).concat(x[j]);
      return [Math.min(-3.4, ...vals) - 0.5, Math.max(3.4, ...vals) + 0.5];
    };
    const [ax0, ax1] = dom(fa), [by0, by1] = dom(fb);

    const draw = (width) => {
      const height = 260, P = { l: 34, r: 12, t: 10, b: 30 };
      const X = scale(ax0, ax1, P.l, width - P.r), Y = scale(by0, by1, height - P.b, P.t);
      const svg = s('svg', { class: 'chart scatter', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': t('lab.if.aria') });
      svg.append(
        s('rect', { x: P.l, y: P.t, width: width - P.l - P.r, height: height - P.t - P.b, fill: 'rgba(255,255,255,0.5)', stroke: 'var(--line)', rx: 10 }),
        s('text', { x: (P.l + width - P.r) / 2, y: height - 8, class: 'axl', 'text-anchor': 'middle' }, `${metricName(FEATURES[fa])} (σ)`),
        s('text', { x: 12, y: (P.t + height - P.b) / 2, class: 'axl', 'text-anchor': 'middle', transform: `rotate(-90 12 ${(P.t + height - P.b) / 2})` }, `${metricName(FEATURES[fb])} (σ)`));
      // cortes del árbol actual: cada uno estrecha la región donde queda el punto de hoy
      const region = { x0: ax0, x1: ax1, y0: by0, y1: by1 };
      const { path } = tracePath(f.forest.trees[tree], x);
      const lines = [];
      for (const step of path) {
        if (step.feature === fa) {
          lines.push(s('line', { class: 'cut', x1: X(step.split), x2: X(step.split), y1: Y(region.y0), y2: Y(region.y1) }));
          if (step.left) region.x1 = Math.min(region.x1, step.split); else region.x0 = Math.max(region.x0, step.split);
        } else if (step.feature === fb) {
          lines.push(s('line', { class: 'cut', y1: Y(step.split), y2: Y(step.split), x1: X(region.x0), x2: X(region.x1) }));
          if (step.left) region.y1 = Math.min(region.y1, step.split); else region.y0 = Math.max(region.y0, step.split);
        }
      }
      svg.append(s('rect', { class: 'region', x: X(region.x0), y: Y(region.y1), width: Math.max(0, X(region.x1) - X(region.x0)), height: Math.max(0, Y(region.y0) - Y(region.y1)) }));
      for (const r of f.X) svg.append(s('circle', { class: 'pt', cx: X(r[fa]), cy: Y(r[fb]), r: 3.4 }));
      svg.append(...lines, s('circle', { class: 'today', cx: X(x[fa]), cy: Y(x[fb]), r: 7 }));
      return svg;
    };

    const text = () => {
      const { path, depth } = tracePath(f.forest.trees[tree], x);
      cuts.replaceChildren(...path.map((st) => h('span', { class: `chip ${st.feature === fa || st.feature === fb ? 'chip--blue' : ''}` }, `${metricName(FEATURES[st.feature])} ${st.left ? '<' : '≥'} ${signed(st.split, 1)}σ`)));
      caption.replaceChildren(h('b', null, t('lab.if.tree', { i: tree + 1, n: f.forest.trees.length })), ' ', t('lab.if.depth', { d: depth }));
      [...depths.children].forEach((b, i) => b.classList.toggle('is-now', i === tree));
    };

    const resp = responsive(box, draw);
    charts.push(resp);
    const step = () => { tree = (tree + 1) % f.forest.trees.length; resp.redraw(); text(); };
    if (!reducedMotion()) timer = setInterval(step, 1300);
    text();

    node.append(box, caption, cuts,
      h('div', null, h('p', { class: 'xs muted', style: 'margin-bottom:6px' }, t('lab.if.depths', { avg: fmt(avg, 1) })), depths),
      h('div', { class: 'formula', tabindex: '0' },
        h('div', null, `s = 2^(−E[h] / c(ψ)) = 2^(−${fmt(avg, 2)} / ${fmt(c, 2)}) = `, h('b', { class: info.anomalous ? 'hi-bad' : 'hi-ok' }, fmt(info.score, 2))),
        h('div', null, `${t('lab.if.typical')} = ${fmt(info.typical, 2)} · ${t('lab.if.threshold')} = ${fmt(info.threshold, 2)} · ψ = ${f.forest.psi} · ${f.forest.trees.length} ${t('lab.if.trees')}`)),
      h('p', { class: 'verdict-line' }, h('b', null, t(info.anomalous ? 'lab.if.v.odd' : 'lab.if.v.ok')), ' ', t('lab.if.note')),
      h('div', { class: 'row' }, h('button', { class: 'btn btn--glass glass btn--small', type: 'button', onClick: () => { clearInterval(timer); step(); } }, t('lab.if.next'))));
    return { node, update() {} };
  }

  /* ------------------------------------------------ contexto y fusión -- */
  function fusionCard(pv) {
    const r = pv.analysis;
    const sh = expectedShift(r.context);
    const adv = VITALS.map((m) => r.metrics[m].adverse);
    const maxAdv = Math.max(...adv);
    const strong = adv.filter((v) => v >= THRESHOLDS.watch).length;
    const out = r.cabinOut.co2 || r.cabinOut.temp;
    const rules = [
      ['r1', maxAdv >= THRESHOLDS.anomaly, 'bad', { v: fmt(maxAdv, 1) }],
      ['r2', strong >= 2, 'bad', { n: strong }],
      ['r3', maxAdv >= THRESHOLDS.watch && maxAdv < THRESHOLDS.anomaly, '', { v: fmt(maxAdv, 1) }],
      ['r4', r.composite >= THRESHOLDS.composite, '', { v: fmt(r.composite, 1) }],
      ['r5', r.drifting.length > 0, '', { m: r.drifting.map((m) => metricName(m)).join(', ') || '—' }],
      ['r6', r.sleepFlag, '', { v: fmt(r.metrics.sleepH.z, 1) }],
      ['r7', r.forestFlag, '', { v: fmt(r.iforest?.score ?? 0, 2) }],
      ['r8', out, '', {}],
    ];
    return card(null,
      h('div', null, h('p', { class: 'label' }, '04'), h('h3', { class: 'card-title' }, t('lab.fu.title')), h('p', { class: 'card-sub' }, t('lab.fu.sub'))),
      h('p', { class: 'chips' },
        h('span', { class: 'chip chip--blue' }, t('result.ctx', { ctx: t(`ctx.${r.context}`) })),
        h('span', { class: 'chip' }, t('lab.fu.conf', { pct: fmt(pv.context.confidence * 100) })),
        pv.context.evidence.map((e) => h('span', { class: 'chip' }, t(e.key, e.vars)))),
      h('div', { style: 'overflow-x:auto' }, h('table', { class: 'ctx-table' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('lab.fu.col.signal')), h('th', { scope: 'col' }, t('lab.fu.col.today')), h('th', { scope: 'col' }, t('lab.fu.col.rest')), h('th', { scope: 'col' }, 'z'))),
        h('tbody', null, FEATURES.map((m) => {
          const x = r.metrics[m];
          return h('tr', null, h('th', { scope: 'row' }, metricName(m)), h('td', null, `${fmtMetric(m, x.value)} ${metricUnit(m)}`), h('td', null, fmtMetric(m, x.adjusted)), h('td', { class: `lvl-${level(x.adverse)}` }, signed(x.z, 1)));
        })))),
      r.context !== 'rest' ? h('p', { class: 'xs muted' }, t('lab.fu.shift', { hr: signed(sh.hr), hrv: fmt(sh.hrvMul * 100), temp: signed(sh.temp, 1), tol: fmt(sh.tol, 1) })) : null,
      h('ul', { class: 'rules' }, rules.map(([k, on, lv, vars]) => h('li', { class: `${on ? 'is-on' : ''} ${on && lv ? `lvl-${lv}` : ''}` }, h('i', { 'aria-hidden': 'true' }), t(`lab.fu.${k}`, vars)))),
      h('p', { class: 'row' }, h('span', { class: 'label' }, t('lab.fu.result')), statusPill(r.status)));
  }

  /* ------------------------------------------------------------ pintar -- */
  function render() {
    stopCharts();
    const keep = document.activeElement?.id || document.activeElement?.dataset?.scn;
    const state = store.getState();
    const id = currentId();
    const a = store.astronaut(id);
    const astro = crewById(id);
    const hist = historyBefore(state, id);
    const pv = previewCheck(state, id);

    const z = zCard(astro, hist, pv);
    const e = ewmaCard(astro, hist, pv);
    const fo = forestCard(astro, hist, pv);
    const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': t('trends.metric') },
      FEATURES.map((m) => h('button', { class: 'tab', type: 'button', 'aria-pressed': String(m === metric), dataset: { m }, onClick: (ev) => {
        metric = m;
        [...ev.currentTarget.parentNode.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
        z.update(); e.update();
      } }, metricName(m))));

    el.replaceChildren(
      viewHead({ eyebrow: t('lab.eyebrow'), title: t('lab.title'), lead: t('lab.lead') }),
      h('div', { class: 'stack' },
        scenarioCard(state, id, a, pv),
        h('div', { class: 'view-head', style: 'margin:clamp(20px,4vw,40px) 0 0' },
          h('p', { class: 'eyebrow' }, t('lab.inside.eyebrow')),
          h('h2', { class: 'view-title', style: 'font-size:clamp(1.75rem,1.2rem + 2.6vw,3rem)' }, t('lab.inside.title')),
          h('p', { class: 'lead' }, t('lab.inside.lead', { name: a.name.split(' ')[0] })),
          h('div', { class: 'row' }, h('span', { class: 'label' }, t('lab.inside.signal')), tabs)),
        h('div', { class: 'inside' }, z.node, e.node, fo.node, fusionCard(pv))),
      h('div', { class: 'next' },
        h('p', { class: 'next-hint' }, t('lab.next.hint')),
        h('a', { class: 'btn btn--light', href: '#/chequeo', onClick: () => store.update((st) => { st.astronautId = id; st.onboarded = true; }) }, icon('play', 18), t('lab.next.check')),
        h('a', { class: 'btn btn--glass glass', href: '#/tendencias', onClick: () => store.update((st) => { st.astronautId = id; }) }, t('nav.trends')),
        h('a', { class: 'btn btn--glass glass', href: '#/tripulacion' }, t('nav.crew'))));

    if (keep) (document.getElementById(keep) || el.querySelector(`[data-scn="${keep}"]`))?.focus({ preventScroll: true });
  }

  render();
  return stopCharts;
}
