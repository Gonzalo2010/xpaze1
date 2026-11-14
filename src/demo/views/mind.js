// #/mente — monta el módulo de psicología (de Codex) si existe; si no, una alternativa digna.

import { h, viewHead, card } from '../core/ui.js';
import { loadPsych } from '../core/psych.js';

export function mount(el, ctx) {
  const { i18n: { t } } = ctx;
  let off = null;
  let alive = true;

  function fallback() {
    const items = ['mood', 'pvt', 'sleep', 'stress', 'crew', 'journal', 'breath', 'privacy'];
    el.replaceChildren(
      viewHead({ eyebrow: t('mind.eyebrow'), title: t('mind.title'), lead: t('mind.lead') }),
      card({ class: 'soon' },
        h('div', null,
          h('span', { class: 'chip chip--blue' }, t('mind.soon.tag')),
          h('h2', { class: 'card-title', style: 'margin-top:12px' }, t('mind.soon.title')),
          h('p', { class: 'card-sub' }, t('mind.soon.text'))),
        h('ul', { class: 'soon-list' }, items.map((k) => h('li', null, h('b', null, t(`mind.soon.${k}`)), t(`mind.soon.${k}.d`)))),
        h('p', { class: 'nodx' }, t('mind.soon.note'))),
      h('div', { class: 'next' },
        h('a', { class: 'btn btn--light', href: '#/resultado' }, t('nav.result')),
        h('a', { class: 'btn btn--glass glass', href: '#/laboratorio' }, t('nav.lab'))));
  }

  loadPsych().then((mod) => {
    if (!alive) return;
    if (typeof mod?.mount !== 'function') { fallback(); return; }
    try {
      const r = mod.mount(el, ctx);
      off = typeof r === 'function' ? r : null;
    } catch (e) {
      console.warn('[xpaze] psych.mount:', e);
      fallback();
    }
  });

  return () => {
    alive = false;
    if (off) { try { off(); } catch (e) { console.warn(e); } }
  };
}
