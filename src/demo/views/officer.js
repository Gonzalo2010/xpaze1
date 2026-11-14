// #/tripulacion — vista del oficial médico: toda la tripulación de un vistazo.
// De «Mente» solo se ve lo que cada astronauta ha decidido compartir.

import { h, fmt, signed, viewHead, card, icon, statusPill, sparkline, lineText, metricName, metricUnit, fmtMetric, toast } from '../core/ui.js';
import { VITALS, METRICS } from '../core/engine/crew.js';
import { instantCheck, previewCheck } from '../core/engine/mission.js';
import { cabinOut } from '../core/engine/signals.js';
import { makeReport } from '../core/engine/link.js';
import { THRESHOLDS } from '../core/engine/analyze.js';
import { psychSummary, psychReady, factorText } from '../core/psych.js';

const level = (adverse) => (adverse >= THRESHOLDS.anomaly ? 'bad' : adverse >= THRESHOLDS.watch ? 'warn' : '');

export function mount(el, ctx) {
  const { store, navigate, i18n: { t } } = ctx;

  function checkMissing() {
    let n = 0;
    store.update((st) => {
      for (const a of store.crew()) {
        if (store.todayCheck(a.id)) continue;
        const { check } = instantCheck(st, a.id, Date.now());
        st.link.queue.unshift(makeReport(check, st.link.delayMin, Date.now()));
        n++;
      }
      st.link.queue.length = Math.min(st.link.queue.length, 12);
    });
    toast(t('crew.checked', { n }));
    render();
    el.querySelector('h1')?.focus({ preventScroll: true });
  }

  function open(a, hasCheck) {
    store.update((st) => { st.astronautId = a.id; st.onboarded = true; });
    navigate(hasCheck ? '#/resultado' : '#/chequeo');
  }

  function mindRow(a) {
    if (!psychReady()) return h('div', { class: 'crew-mind' }, h('span', { class: 'chip' }, t('crew.mind.soon')));
    const sum = psychSummary(a.id);
    if (!sum) return h('div', { class: 'crew-mind' }, h('span', { class: 'chip' }, t('crew.mind.nodata')));
    if (!sum.shared) return h('div', { class: 'crew-mind' }, icon('lock', 16), h('span', null, t('crew.mind.private')));
    const factors = sum.factors.map(factorText).filter(Boolean);
    return h('div', { class: 'crew-mind' },
      h('span', { class: 'label', style: 'padding-top:6px' }, t('nav.mind')),
      statusPill(sum.status, sum.label || t(`mind.status.${sum.status}`)),
      factors.length ? h('ul', null, factors.map((f) => h('li', null, f))) : h('span', { class: 'xs muted', style: 'padding-top:6px' }, t('crew.mind.aggregate')));
  }

  function render() {
    const state = store.getState();
    const day = store.missionDay();
    const crew = store.crew();
    const today = crew.map((a) => store.todayCheck(a.id));
    const done = today.filter(Boolean).length;
    const counts = { normal: 0, watch: 0, anomaly: 0 };
    for (const c of today) if (c && counts[c.analysis.status] != null) counts[c.analysis.status]++;

    const cabin = previewCheck(state, crew[0].id).cabin;
    const out = cabinOut(cabin);
    const cabinBad = out.co2 || out.temp;

    // ¿varias personas con la misma señal desviada? Entonces la causa suele ser común.
    const shared = VITALS.filter((m) => today.filter((c) => c && c.analysis.metrics[m]?.adverse >= 1).length >= 3);

    const cards = crew.map((a, i) => {
      const last = store.latestCheck(a.id);
      const c = today[i];
      const hist = store.physioHistory(a.id).slice(-14).map((d) => d.hr);
      return card({ class: 'crew-card', tag: 'article' },
        h('div', { class: 'crew-top' },
          h('i', { class: 'avatar avatar--lg', style: `--hue:${a.hue}`, 'aria-hidden': 'true' }, a.initials),
          h('div', null, h('h2', { class: 'crew-name' }, a.name), h('p', { class: 'crew-role' }, a.role)),
          c ? statusPill(c.analysis.status) : h('span', { class: 'status' }, t('crew.pending'))),
        h('p', { class: 'crew-headline' }, c ? lineText(c.analysis.headline) : last ? t('crew.lastCheck', { day: last.day }) : t('crew.noCheck')),
        h('dl', { class: 'mini' }, VITALS.map((m) => {
          const x = c?.analysis.metrics[m];
          return h('div', { class: x ? `lvl-${level(x.adverse)}` : '' },
            h('dt', null, metricName(m)),
            h('dd', null, x ? fmtMetric(m, x.value) : '—'),
            h('small', null, x ? `${signed(x.delta, m === 'temp' ? 1 : METRICS[m].digits)} ${metricUnit(m)}` : metricUnit(m)));
        })),
        h('div', { class: 'crew-foot' },
          h('span', { class: 'row xs muted' }, sparkline(hist), t('crew.spark')),
          h('button', { class: 'link', type: 'button', onClick: () => open(a, !!last) }, t(last ? 'crew.open' : 'crew.openCheck'), icon('arrow', 16))),
        mindRow(a));
    });

    el.replaceChildren(
      viewHead({
        eyebrow: t('crew.eyebrow', { day }), title: t('crew.title'), lead: t('crew.lead'),
        extra: h('div', { class: 'row' },
          h('button', { class: 'btn btn--light', type: 'button', id: 'check-all', disabled: done === crew.length, onClick: checkMissing }, icon('heart', 18), t(done === crew.length ? 'crew.allDone' : 'crew.checkAll')),
          h('span', { class: 'chips' },
            h('span', { class: 'chip' }, t('crew.count.done', { n: done, total: crew.length })),
            counts.watch ? statusPill('watch', t('crew.count.watch', { n: counts.watch })) : null,
            counts.anomaly ? statusPill('anomaly', t('crew.count.anomaly', { n: counts.anomaly })) : null)),
      }),
      h('div', { class: 'stack' },
        cabinBad ? h('p', { class: 'notice', role: 'status' }, t('crew.cabin.notice')) : shared.length ? h('p', { class: 'notice', role: 'status' }, t('crew.shared.notice', { metric: shared.map((m) => t(`m.${m}.in`)).join(', ') })) : null,
        h('div', { class: 'crew-grid' }, cards),
        card(null,
          h('div', { class: 'card-head' },
            h('div', null, h('h2', { class: 'card-title' }, t('crew.cabin.title')), h('p', { class: 'card-sub' }, t('crew.cabin.sub'))),
            statusPill(cabinBad ? 'watch' : 'normal', t(cabinBad ? 'crew.cabin.out' : 'crew.cabin.ok'))),
          h('dl', { class: 'cabin-row' },
            [['temp', fmt(cabin.tempC, 1), out.temp], ['hum', fmt(cabin.humidity), false], ['press', fmt(cabin.pressure), false], ['co2', fmt(Math.round(cabin.co2 / 10) * 10), out.co2]]
              .map(([k, v, bad]) => h('div', { class: 'stat' }, h('dt', null, t(`cabin.${k}`)), h('dd', { style: bad ? 'color:var(--warn-ink)' : '' }, v, h('small', null, t(`cabin.${k}.u`))))))),
        h('p', { class: 'notice notice--info' }, t('crew.privacy'))),
      h('div', { class: 'next' },
        h('p', { class: 'next-hint' }, t('crew.next.hint')),
        h('a', { class: 'btn btn--glass glass', href: '#/tierra' }, t('nav.earth')),
        h('a', { class: 'btn btn--glass glass', href: '#/laboratorio' }, t('nav.lab'))));
  }

  render();
  return null;
}
