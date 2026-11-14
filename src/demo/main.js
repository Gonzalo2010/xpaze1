// XPaze Demo — arranque, enrutado por hash y marco común (cabecera, navegación, idioma).

import './demo.css';
import * as store from './core/store.js';
import * as i18n from './core/i18n.js';
import strings from './core/strings.js';
import { h, icon, toast } from './core/ui.js';
import { loadPsych } from './core/psych.js';

import * as home from './views/home.js';
import * as check from './views/check.js';
import * as result from './views/result.js';
import * as trends from './views/trends.js';
import * as mind from './views/mind.js';
import * as officer from './views/officer.js';
import * as earth from './views/earth.js';
import * as lab from './views/lab.js';

i18n.register(strings);
const { t } = i18n;

const ROUTES = [
  { path: '/', key: 'nav.home', view: home },
  { path: '/chequeo', key: 'nav.check', view: check, needsAstronaut: true },
  { path: '/resultado', key: 'nav.result', view: result, needsAstronaut: true },
  { path: '/tendencias', key: 'nav.trends', view: trends, needsAstronaut: true },
  { path: '/mente', key: 'nav.mind', view: mind, needsAstronaut: true },
  { path: '/tripulacion', key: 'nav.crew', view: officer },
  { path: '/tierra', key: 'nav.earth', view: earth },
  { path: '/laboratorio', key: 'nav.lab', view: lab },
];

const app = document.getElementById('app');
let unmount = null;
let outlet = null;
let chrome = null; // referencias del marco para refrescarlo

const pathNow = () => {
  const p = (location.hash || '#/').replace(/^#/, '').replace(/\/+$/, '') || '/';
  return p.split('?')[0];
};

function navigate(hash) {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (location.hash === target) render();
  else location.hash = target;
}

const ctx = { navigate, store, i18n };

/* ------------------------------------------------------------- marco -- */

function buildShell() {
  const links = ROUTES.map((r) => h('li', null, h('a', { href: `#${r.path}`, dataset: { path: r.path } }, t(r.key))));

  const menuBtn = h('button', { class: 'nav-menu', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'menu', 'aria-label': t('nav.openMenu') }, h('span'), h('span'));
  const langGroup = h('div', { class: 'lang', role: 'group', 'aria-label': t('nav.lang') },
    ...['es', 'en'].map((l) => h('button', { type: 'button', 'aria-pressed': String(i18n.lang() === l), onClick: () => i18n.setLang(l) }, l.toUpperCase())));

  const resetBtn = (cls) => {
    let armed = 0;
    const label = h('span', null, t('shell.reset'));
    const btn = h('button', { class: cls, type: 'button', onClick: () => {
      if (!armed) {
        label.textContent = t('shell.resetConfirm');
        btn.classList.add('is-armed');
        armed = setTimeout(() => { armed = 0; label.textContent = t('shell.reset'); btn.classList.remove('is-armed'); }, 4000);
        return;
      }
      clearTimeout(armed);
      store.reset();
      toast(t('shell.resetDone'));
      navigate('#/');
    } }, icon('reset', 16), label);
    return btn;
  };

  const menu = h('ul', { class: 'nav-links', id: 'menu' }, links,
    h('li', { class: 'nav-extra' }, h('a', { href: '/' }, icon('back', 16), t('shell.back'))),
    h('li', { class: 'nav-extra' }, resetBtn('nav-reset')));

  const setMenu = (open) => {
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', t(open ? 'nav.closeMenu' : 'nav.openMenu'));
    nav.classList.toggle('is-open', open);
  };
  menuBtn.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });

  const nav = h('nav', { class: 'nav glass', 'aria-label': t('nav.label') },
    h('a', { class: 'wordmark', href: '#/', 'aria-label': t('nav.homeLabel') },
      h('img', { src: '/logo-mark-dark.png', alt: '', width: 30, height: 25 }), 'XPaze', h('span', { class: 'wordmark-tag' }, 'Demo')),
    menu, langGroup, menuBtn);

  const who = h('a', { class: 'pill glass sub-who', href: '#/' });
  const subbar = h('div', { class: 'subbar' },
    h('a', { class: 'pill glass sub-back', href: '/' }, icon('back', 15), t('shell.back')),
    h('p', { class: 'pill glass sub-sim' }, h('i', { class: 'status-dot status-dot--warn', 'aria-hidden': 'true' }), t('shell.simulated')),
    who,
    resetBtn('pill glass sub-reset'));

  outlet = h('main', { id: 'contenido', class: 'view' });

  const footer = h('footer', { class: 'foot' },
    h('p', { class: 'foot-note' }, t('shell.disclaimer')),
    h('div', { class: 'foot-links' },
      h('a', { href: '/' }, icon('back', 15), t('shell.back')),
      resetBtn('foot-reset')));

  app.replaceChildren(
    h('a', { class: 'skip', href: '#contenido' }, t('shell.skip')),
    h('header', { class: 'nav-wrap' }, nav),
    subbar, outlet, footer);

  chrome = { nav, menu, who, setMenu };
  refreshChrome();
}

function refreshChrome() {
  if (!chrome) return;
  const path = pathNow();
  for (const a of chrome.menu.querySelectorAll('a[data-path]')) {
    const on = a.dataset.path === path;
    a.classList.toggle('is-current', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const a = store.currentAstronaut();
  chrome.who.replaceChildren(
    h('span', { class: 'sub-day' }, t('shell.day', { day: store.missionDay() })),
    a ? h('span', { class: 'sub-name' }, h('i', { class: 'avatar', style: `--hue:${a.hue}`, 'aria-hidden': 'true' }, a.initials), a.name) : h('span', { class: 'sub-name is-empty' }, t('shell.noAstronaut')));
  chrome.who.setAttribute('aria-label', t('shell.whoLabel'));
}

/* ------------------------------------------------------------ router -- */

function render() {
  const path = pathNow();
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];
  if (route.needsAstronaut && !store.currentAstronaut()) {
    if (path !== '/') { location.replace('#/'); return; }
  }
  if (unmount) { try { unmount(); } catch (e) { console.error(e); } unmount = null; }
  chrome.setMenu(false);
  outlet.replaceChildren();
  outlet.className = `view view--${route.path === '/' ? 'home' : route.path.slice(1)}`;
  refreshChrome();
  document.title = `${t(route.key)} · XPaze Demo`;
  try {
    const off = route.view.mount(outlet, ctx);
    unmount = typeof off === 'function' ? off : null;
  } catch (e) {
    console.error(e);
    outlet.replaceChildren(h('p', { class: 'lead' }, t('shell.error')));
  }
  return route;
}

function onRoute({ focus = true } = {}) {
  render();
  window.scrollTo(0, 0);
  if (focus) outlet.querySelector('h1')?.focus({ preventScroll: true });
}

/* ----------------------------------------------------------- arranque -- */

document.documentElement.lang = i18n.lang();

// brillo del cristal que sigue al puntero (igual que en la landing)
document.addEventListener('pointermove', (e) => {
  const g = e.target.closest?.('.glass');
  if (!g) return;
  const r = g.getBoundingClientRect();
  g.style.setProperty('--gx', `${((e.clientX - r.left) / r.width) * 100}%`);
  g.style.setProperty('--gy', `${((e.clientY - r.top) / r.height) * 100}%`);
}, { passive: true });

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') chrome?.setMenu(false); });

async function start() {
  await loadPsych(); // si existe, las vistas pueden pedirle su resumen desde el primer pintado
  buildShell();
  onRoute({ focus: false });
  window.addEventListener('hashchange', () => onRoute());
  i18n.onLangChange(() => { buildShell(); render(); });
  store.subscribe(refreshChrome);
}

start();
