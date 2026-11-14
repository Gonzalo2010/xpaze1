// #/tierra — enlace con la Tierra: la respuesta tarda minutos, así que la
// primera decisión se toma a bordo. 1 minuto de misión = 1 segundo de demo.

import { h, fmt, viewHead, card, icon, statusPill, statusClass, toast } from '../core/ui.js';
import { DIST_RANGE, REVIEW_MIN, lightMinutes, reportPhase, makeReport } from '../core/engine/link.js';

export function mount(el, ctx) {
  const { store, i18n: { t } } = ctx;
  let timer = 0;
  let rows = [];

  const packets = h('div', { class: 'packets', 'aria-hidden': 'true' });
  const figs = { one: h('dd'), round: h('dd'), dist: h('dd') };
  const range = h('input', { type: 'range', min: DIST_RANGE[0], max: DIST_RANGE[1], step: 5, id: 'dist', 'aria-describedby': 'dist-note' });
  const queue = h('div', { class: 'queue' });

  const mins = (m) => {
    const total = Math.max(0, Math.round(m * 60));
    return t('earth.minsec', { m: Math.floor(total / 60), s: String(total % 60).padStart(2, '0') });
  };

  function setDistance(mkm, save = true) {
    const delay = lightMinutes(mkm);
    if (save) store.update((st) => { st.link.distanceMkm = mkm; st.link.delayMin = delay; });
    range.value = mkm;
    range.setAttribute('aria-valuetext', t('earth.dist.value', { d: fmt(mkm), m: fmt(delay, 1) }));
    figs.one.replaceChildren(mins(delay));
    figs.round.replaceChildren(mins(delay * 2));
    figs.dist.replaceChildren(fmt(mkm), h('small', null, t('earth.dist.unit')));
  }
  range.addEventListener('input', () => setDistance(Number(range.value)));

  function buildQueue() {
    const st = store.getState();
    rows = st.link.queue.map((r) => {
      const a = store.astronaut(r.astronautId);
      const phase = h('span', { class: 'q-phase' });
      const bar = h('b');
      const reply = h('p', { class: 'q-reply', hidden: true }, t(`earth.reply.${r.status}`));
      const dot = h('i', { class: `packet s-${statusClass(r.status)}` });
      const node = h('article', { class: 'q-item' },
        h('p', { class: 'q-title' }, statusPill(r.status), `${a?.name || r.astronautId} · ${t('shell.day', { day: r.day })}`),
        phase,
        h('p', { class: 'q-auto' }, h('b', null, t('earth.auto')), ' ', t(r.auto)),
        reply,
        h('div', { class: 'q-bar', 'aria-hidden': 'true' }, bar));
      return { r, phase, bar, reply, dot, last: '' };
    });
    queue.replaceChildren(...(rows.length ? rows.map((x) => x.phase.parentNode) : [h('p', { class: 'muted small' }, t('earth.queue.empty'))]));
    packets.replaceChildren(...rows.map((x) => x.dot));
    tick();
  }

  function tick() {
    const now = Date.now();
    for (const x of rows) {
      const p = reportPhase(x.r, now);
      const label = p.phase === 'answered' ? t('earth.phase.answered') : `${t(`earth.phase.${p.phase}`)} · ${t('earth.remaining', { t: mins(p.remainingMin) })}`;
      if (label !== x.last) { x.phase.textContent = label; x.last = label; }
      x.bar.style.width = `${Math.min(100, (p.elapsedMin / p.total) * 100)}%`;
      x.reply.hidden = p.phase !== 'answered';
      x.dot.hidden = p.phase === 'answered' || p.phase === 'review';
      x.dot.classList.toggle('is-back', p.phase === 'inbound');
      x.dot.style.left = `${(1 - p.progress) * 100}%`;
    }
  }

  function resend() {
    const st = store.getState();
    const id = st.astronautId || store.crew()[0].id;
    const check = store.latestCheck(id) || store.crew().map((a) => store.latestCheck(a.id)).find(Boolean);
    if (!check) { toast(t('earth.needCheck')); return; }
    store.update((s2) => {
      s2.link.queue.unshift({ ...makeReport(check, s2.link.delayMin, Date.now()), id: `${check.id}-r${Date.now()}` });
      s2.link.queue.length = Math.min(s2.link.queue.length, 12);
    });
    buildQueue();
    toast(t('earth.sent'));
  }

  const st0 = store.getState();
  el.append(
    viewHead({ eyebrow: t('earth.eyebrow'), title: t('earth.title'), lead: t('earth.lead') }),
    h('div', { class: 'stack' },
      card(null,
        h('div', { class: 'space' },
          h('span', { class: 'space-line', 'aria-hidden': 'true' }),
          h('div', { class: 'planet planet--earth' }, h('i', { 'aria-hidden': 'true' }), t('earth.earth')),
          h('div', { class: 'planet planet--ship' }, h('i', { 'aria-hidden': 'true' }), t('earth.ship')),
          packets),
        h('div', { class: 'slider' },
          h('label', { class: 'label', for: 'dist' }, t('earth.dist.label')),
          range,
          h('p', { class: 'slider-scale', 'aria-hidden': 'true' }, h('span', null, t('earth.dist.near')), h('span', null, t('earth.dist.far'))),
          h('div', { class: 'row' },
            [[DIST_RANGE[0], 'near'], [225, 'mid'], [DIST_RANGE[1], 'conj']].map(([d, k]) => h('button', { class: 'btn btn--glass glass btn--small', type: 'button', onClick: () => setDistance(d) }, t(`earth.preset.${k}`))))),
        h('dl', { class: 'bigfig', style: 'margin-top:20px' },
          h('div', { class: 'stat' }, h('dt', null, t('earth.fig.one')), figs.one),
          h('div', { class: 'stat' }, h('dt', null, t('earth.fig.round')), figs.round),
          h('div', { class: 'stat' }, h('dt', null, t('earth.fig.dist')), figs.dist)),
        h('p', { class: 'card-sub', id: 'dist-note', style: 'margin-top:14px' }, t('earth.note', { review: REVIEW_MIN }))),
      card(null,
        h('div', { class: 'card-head' },
          h('div', null, h('h2', { class: 'card-title' }, t('earth.queue.title')), h('p', { class: 'card-sub' }, t('earth.queue.sub'))),
          h('button', { class: 'btn btn--light btn--small', type: 'button', id: 'resend', onClick: resend }, icon('arrow', 16), t('earth.resend'))),
        queue)),
    h('div', { class: 'next' },
      h('p', { class: 'next-hint' }, t('earth.next.hint')),
      h('a', { class: 'btn btn--glass glass', href: '#/chequeo' }, t('nav.check')),
      h('a', { class: 'btn btn--glass glass', href: '#/laboratorio' }, t('nav.lab'))));

  setDistance(st0.link.distanceMkm, false);
  buildQueue();
  timer = setInterval(tick, 120);
  return () => clearInterval(timer);
}
