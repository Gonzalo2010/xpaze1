// #/resultado — el estado en una mirada, por qué, qué ha pesado y comparación
// con la línea base personal y con el rango poblacional.

import { h, s, fmt, signed, viewHead, card, icon, lineText, metricName, metricUnit, fmtMetric, statusClass } from '../core/ui.js';
import { METRICS, FEATURES } from '../core/engine/crew.js';
import { THRESHOLDS } from '../core/engine/analyze.js';
import { REVIEW_MIN } from '../core/engine/link.js';
import { psychContribute, psychSummary, psychReady } from '../core/psych.js';

const level = (adverse) => (adverse >= THRESHOLDS.anomaly ? 'bad' : adverse >= THRESHOLDS.watch ? 'warn' : '');

function orbIcon(cls) {
  const d = { ok: 'M5 12.5l4.5 4.5L19 7.5', warn: 'M12 5v9M12 18.5v.5', bad: 'M12 5v9M12 18.5v.5', none: 'M3 12h4l2-6 4 12 2-6h6' }[cls];
  return s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, s('path', { d }));
}

export function mount(el, ctx) {
  const { store, navigate, i18n: { t } } = ctx;
  const a = store.currentAstronaut();
  if (!a) { navigate('#/'); return null; }
  const check = store.latestCheck(a.id);
  const day = store.missionDay();

  if (!check) {
    el.append(
      viewHead({ eyebrow: t('result.eyebrow', { name: a.name, day }), title: t('result.empty.title') }),
      card({ class: 'empty' }, h('p', null, t('result.empty.text')), h('a', { class: 'btn btn--light', href: '#/chequeo' }, icon('play', 18), t('result.empty.cta'))));
    return null;
  }

  const r = check.analysis;
  const cls = statusClass(r.status);
  const stale = check.day !== day;

  /* ------------------------------------------------------- veredicto -- */
  const verdict = h('section', { class: 'verdict glass', 'aria-live': 'polite' },
    h('div', { class: `orb orb--${cls}`, 'aria-hidden': 'true' }, orbIcon(cls)),
    h('div', { class: 'verdict-copy' },
      h('p', { class: 'eyebrow' }, t('result.eyebrow', { name: a.name, day: check.day })),
      h('h1', { class: `verdict-title t-${cls}`, tabindex: '-1' }, t(`status.${r.status}`)),
      h('p', { class: 'verdict-head' }, lineText(r.headline)),
      h('p', { class: 'chips' },
        h('span', { class: 'chip chip--blue' }, t('result.ctx', { ctx: t(`ctx.${r.context}`) })),
        h('span', { class: 'chip' }, t('result.quality', { pct: fmt(check.quality * 100) })),
        check.attempt > 1 ? h('span', { class: 'chip' }, t('result.retried')) : null),
      stale ? h('p', { class: 'stale' }, t('result.stale', { day: check.day, today: day })) : null));

  /* ---------------------------------------------------------- por qué -- */
  const why = card(null,
    h('div', { class: 'card-head' }, h('div', null, h('h2', { class: 'card-title' }, t('result.why.title')), h('p', { class: 'card-sub' }, t('result.why.sub')))),
    h('ul', { class: 'why' }, r.lines.map((line) => h('li', { class: line.key.startsWith('pattern.') ? 'is-pattern' : '' }, lineText(line)))),
    h('p', { class: 'nodx' }, t('line.noDx')));

  /* -------------------------------------------------------- qué pesa -- */
  const mind = psychContribute(a.id);
  const mindSummary = psychSummary(a.id);
  const factors = card(null,
    h('div', { class: 'card-head' }, h('div', null, h('h2', { class: 'card-title' }, t('result.factors.title')), h('p', { class: 'card-sub' }, t('result.factors.sub')))),
    h('div', { class: 'factors' },
      FEATURES.map((m) => {
        const x = r.metrics[m];
        const z = Math.max(-6, Math.min(6, x.z));
        const w = (Math.abs(z) / 6) * 50;
        return h('div', { class: 'factor' },
          h('span', { class: 'factor-name' }, metricName(m)),
          h('span', { class: 'factor-bar', 'aria-hidden': 'true' }, h('b', { class: `lvl-${level(x.adverse)}`, style: `left:${z < 0 ? 50 - w : 50}%;width:${w}%` })),
          h('span', { class: 'factor-z' }, `${signed(x.z, 1)} σ`));
      })),
    h('p', { class: 'factor-axis', 'aria-hidden': 'true' }, h('span', null, t('result.factors.less')), h('span', null, t('result.factors.normal')), h('span', null, t('result.factors.more'))),
    r.iforest ? h('p', { class: 'card-sub', style: 'margin-top:16px' }, t(r.iforest.anomalous ? 'result.forest.odd' : 'result.forest.ok', { score: fmt(r.iforest.score, 2), typical: fmt(r.iforest.typical, 2) })) : null,
    (mind.length || mindSummary) ? h('div', { class: 'extra-factors' },
      h('p', { class: 'label' }, t('result.mind.title')),
      mind.length ? h('ul', null, mind.map((txt) => h('li', null, txt))) : h('p', { class: 'small muted' }, mindSummary?.label || t('result.mind.none'))) : (!psychReady() ? null : null));

  /* ------------------------------------------------------ comparación -- */
  const ranges = h('div', { class: 'ranges' }, FEATURES.map((m) => {
    const x = r.metrics[m], def = METRICS[m];
    const lo0 = Math.min(def.pop[0], x.band[0], x.value), hi0 = Math.max(def.pop[1], x.band[1], x.value);
    const pad = (hi0 - lo0) * 0.08;
    const lo = lo0 - pad, hi = hi0 + pad;
    const P = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
    const W = (v0, v1) => `${((v1 - v0) / (hi - lo)) * 100}%`;
    const where = x.popOut === 0 ? t('result.range.popIn') : t(x.popOut < 0 ? 'result.range.popLow' : 'result.range.popHigh');
    return h('div', { class: 'range' },
      h('div', { class: 'range-head' },
        h('span', { class: 'range-name' }, metricName(m)),
        h('span', { class: 'range-value' }, fmtMetric(m, x.value), h('small', null, metricUnit(m))),
        h('span', { class: 'range-delta' }, t('result.range.delta', { delta: signed(x.delta, def.digits || (m === 'hrv' ? 0 : 1)), base: fmtMetric(m, x.median), where }))),
      h('div', { class: 'range-track', role: 'img', 'aria-label': t('result.range.aria', { metric: metricName(m), value: fmtMetric(m, x.value), lo: fmtMetric(m, x.band[0]), hi: fmtMetric(m, x.band[1]), plo: fmtMetric(m, def.pop[0]), phi: fmtMetric(m, def.pop[1]) }) },
        h('span', { class: 'base' }),
        h('span', { class: 'pop', style: `left:${P(def.pop[0])};width:${W(def.pop[0], def.pop[1])}` }),
        h('span', { class: 'mine', style: `left:${P(x.band[0])};width:${W(x.band[0], x.band[1])}` }),
        h('span', { class: 'med', style: `left:${P(x.median)}` }),
        h('span', { class: `now lvl-${level(x.adverse)}`, style: `left:${P(x.value)}` })),
      h('div', { class: 'range-scale', 'aria-hidden': 'true' }, h('span', null, fmtMetric(m, lo)), h('span', null, fmtMetric(m, hi))));
  }));
  const compare = card(null,
    h('div', { class: 'card-head' },
      h('div', null, h('h2', { class: 'card-title' }, t('result.compare.title')), h('p', { class: 'card-sub' }, t('result.compare.sub'))),
      h('p', { class: 'legend' },
        h('span', null, h('i', { class: 'l-mine' }), t('result.legend.mine')),
        h('span', null, h('i', { class: 'l-pop' }), t('result.legend.pop')),
        h('span', null, h('i', { class: 'l-now' }), t('result.legend.now')))),
    ranges,
    r.context === 'exercise' ? h('p', { class: 'card-sub', style: 'margin-top:18px' }, t('result.compare.exercise')) : null);

  /* ----------------------------------------------------------- acción -- */
  const eta = Math.round(store.getState().link.delayMin * 2 + REVIEW_MIN);
  const act = card(null,
    h('div', { class: 'card-head' }, h('div', null, h('h2', { class: 'card-title' }, t('result.act.title')), h('p', { class: 'card-sub' }, t('result.act.sub', { min: eta })))),
    h('p', { class: 'auto' }, h('span', { class: 'label' }, t('result.act.auto')), t(r.auto.key)),
    h('ul', { class: 'actions' }, r.actions.map((x) => h('li', null, icon('check', 18), h('span', null, t(x.key))))),
    h('p', { style: 'margin-top:16px' }, h('a', { class: 'link', href: '#/tierra' }, t('result.act.earth'), icon('arrow', 16))));

  el.append(verdict, h('div', { class: 'stack', style: 'margin-top:clamp(16px,2vw,24px)' },
    h('div', { class: 'grid-2' }, why, factors), compare, act),
  h('div', { class: 'next' },
    h('p', { class: 'next-hint' }, t('result.next.hint')),
    h('a', { class: 'btn btn--light', href: '#/laboratorio' }, icon('flask', 18), t('result.next.lab')),
    h('a', { class: 'btn btn--glass glass', href: '#/tendencias' }, t('result.next.trends')),
    h('a', { class: 'btn btn--glass glass', href: '#/chequeo' }, t('result.next.again'))));
  return null;
}
