// XPaze App (PWA): conecta con la estación por Bluetooth o con una simulada,
// muestra las lecturas en directo y hace chequeos que se comparan contigo.

import '../fonts.css';
import './app.css';
import { BleLink, SimLink, WifiLink, bluetoothAvailable, wifiAvailable } from './link.js';
import { MEASURES, ENVIRONMENTS, PHQ2, PHQ2_ANSWERS, RED_FLAGS, SELF_HARM, isSelfHarm, classify, actionPlan, cabinLevel, co2Level } from './clinical.js';
import { baselineBand, baselineChart, drawEcg } from './charts.js';
import { seedStory, storyBody, trendInsights, resultsFromEntry, reportText, SEED_VERSION } from './story.js';
import { streamAI } from './ai.js';
import { PazeOrb, bindOrbToVoice } from './paze-orb.js';
import { assessSpace } from './space.js';
import { bindOrbControls, orbLabel } from './voice.js';
import { VoiceSession, micAvailable, CRISIS } from './voice.js';
import { analyze as psychAnalyze } from '../demo/psych/engine/index.js';
import psychStrings from '../demo/psych/strings.js';
import { CMD } from './protocol.js';
import { assess, summarize, MIN_PERSONAL } from './assess.js';
import { CREW } from '../demo/core/engine/crew.js';
import { L, t, lang, locale, setLang, langSwitch, wireLangSwitch } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const ROLE = {
  es: { 'role.commander': 'Comandante', 'role.engineer': 'Ingeniería de vuelo', 'role.medical': 'Responsable médica', 'role.scientist': 'Ciencia' },
  en: { 'role.commander': 'Commander', 'role.engineer': 'Flight engineer', 'role.medical': 'Medical officer', 'role.scientist': 'Science' },
};
const crewByUid = Object.fromEntries(CREW.map((c) => [c.uid.replace(/\s/g, ''), c]));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }));

/* ------------------------------------------------------------ memoria -- */
const KEY = 'xpaze-app-v1';
const store = {
  load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
  save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const saved = store.load();
saved.healthCodes ||= {};
saved.memory ||= {};
saved.facts ||= {};
saved.about ||= {};
saved.medical ||= {};
if (saved.healthCode) { saved.healthCodes.GONZALO ||= saved.healthCode; delete saved.healthCode; } // código de la versión anterior (era de Gonzalo)
saved.history ||= {};

/* -------------------------------------------------------------- estado -- */
const S = {
  link: null, linkState: 'idle', status: null, vitals: null, watch: null,
  person: null,        // { uid, name, role, crew }
  wave: [],            // últimas muestras de la onda
  ecg: [],             // últimas muestras del ECG (250 Hz)
  ext: null,           // sensores ampliados de la estación v2 (solo en la simulada)
  screen: 'welcome',
  check: null,         // medición en curso
  result: null,
};
const WAVE_MAX = 150;  // 6 s a 25 muestras/s
const ECG_MAX = 1250;  // 5 s a 250 muestras/s

// Perfiles reales (no son tripulación ficticia): sus datos vienen del reloj vía XPaze Link.
const REAL_PEOPLE = { GONZALO: { name: 'Gonzalo', get role() { return L('Perfil real · Galaxy Watch', 'Real profile · Galaxy Watch'); }, hue: 145 } };
const PEOPLE = [...CREW.map((c) => ({ uid: c.uid.replace(/\s/g, ''), name: c.name })), ...Object.entries(REAL_PEOPLE).map(([uid, p]) => ({ uid, name: p.name }))];

function personFromUid(uid) {
  if (REAL_PEOPLE[uid]) return { uid, name: REAL_PEOPLE[uid].name, role: REAL_PEOPLE[uid].role, hue: REAL_PEOPLE[uid].hue, crew: null, real: true };
  const c = crewByUid[uid];
  return c ? { uid, name: c.name, role: ROLE[lang()][c.roleKey] || '', crew: c.baseline, hue: c.hue }
    : { uid, name: L(`Tarjeta ${uid}`, `Card ${uid}`), role: L('Sin ficha de tripulación', 'No crew record'), crew: null, hue: 200 };
}

/* --------------------------------------------------------- navegación -- */
function go(screen) {
  if (S.screen === 'chat' && screen !== 'chat' && S.chat?.history?.length && !S.chat.remembered) {
    S.chat.remembered = true;
    rememberSession(S.chat.uid, S.chat.history.slice());
  }
  if (screen !== 'chat' && S.voice) S.voice.stop(); // al salir de la psicóloga se cuelga
  S.screen = screen;
  render();
  window.scrollTo({ top: 0 });
}

// Barra de pestañas a mano del pulgar en las pantallas principales.
const TABS = [['home', 'tab.home', 'home'], ['check', 'tab.check', 'pulse'], ['chat', 'tab.paze', 'paze'], ['history', 'tab.history', 'chart']];
function tabbar() {
  const nav = el(`<nav class="tabbar" aria-label="${L('Secciones', 'Sections')}">${TABS.map(([s, k, ic]) => `<button data-tab="${s}" class="${S.screen === s || (s === 'home' && S.screen === 'live') ? 'is-on' : ''}" aria-current="${S.screen === s}">${icon(ic)}<span>${t(k)}</span></button>`).join('')}</nav>`);
  nav.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.tab;
    if (k === S.screen) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (k === 'check') startCheck();
    else if (k === 'chat') openChat();
    else go(k);
  }));
  return nav;
}

function render() {
  const views = { welcome, choose, connecting, home, live, check, result, history, entry, chat, crew };
  if (S.pazeOrb && S.screen !== 'chat') { S.pazeOrb.destroy(); S.pazeOrb = null; }
  if (S.homeOrb && S.screen !== 'home') { S.homeOrb.destroy(); S.homeOrb = null; }
  app.replaceChildren();
  app.append(views[S.screen]());
  const withTabs = S.person && ['home', 'live', 'result', 'history', 'entry', 'chat'].includes(S.screen);
  document.body.classList.toggle('has-tabs', !!withTabs);
  if (withTabs) app.append(tabbar());
  updateLive();
}

// Cambio de idioma: se rehace la pantalla actual con los textos nuevos.
function relang() {
  if (S.person) S.person = { ...S.person, ...personFromUid(S.person.uid), crew: S.person.crew };
  if (S.chat) S.chat = null; // la conversación se reinicia en el idioma nuevo
  render();
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ------------------------------------------------------ 0 bienvenida -- */
// Lo primero es elegir quién eres. La estación simulada se conecta sola;
// la física (Bluetooth o WiFi) queda como opción secundaria.
function lastStatus(uid) {
  const h = (saved.history[uid] || []).at(-1);
  if (!h) return `<span class="pc__st">${L('Sin chequeos todavía', 'No check-ups yet')}</span>`;
  const lv = h.overall ?? ['normal', 'watch', 'alert'].indexOf(h.status);
  const when = new Date(h.at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  return `<span class="pc__st"><span class="dot dot--${LEVEL_CLS[lv] || 'off'}"></span>${L('Último chequeo', 'Last check-up')}: ${when}</span>`;
}

function welcome() {
  const node = el(`
    <section class="screen welcome">
      <header class="brandbar"><img src="/logo-mark-dark.png" alt="" width="34" height="28"/><b>XPaze</b>${langSwitch()}</header>
      <h1>${L('Hola. ¿Quién eres?', 'Hi. Who are you?')}</h1>
      <p class="lead">${L('Elige tu perfil y empieza. Nada que configurar.', 'Pick your profile and start. Nothing to set up.')}</p>
      ${saved.onboarded ? '' : `<aside class="onboard" aria-label="${L('Cómo funciona', 'How it works')}">
        <p class="onboard__t">${L('Cómo funciona', 'How it works')}</p>
        <ol>
          <li>${L('<b>Elige un perfil</b>: un tripulante de ficción o el tuyo.', '<b>Pick a profile</b>: a fictional crew member, or your own.')}</li>
          <li>${L('<b>Hazte un chequeo de 2 minutos</b> o <b>habla con Paze</b>, la psicóloga IA de a bordo.', '<b>Do a 2-minute check-up</b> or <b>talk to Paze</b>, the on-board AI psychologist.')}</li>
          <li>${L('<b>No necesitas nada más</b>: la estación se simula sola, sin hardware.', '<b>Nothing else needed</b>: the station is simulated, no hardware required.')}</li>
        </ol>
        <button type="button" class="onboard__ok" data-act="onboard-ok">${L('Entendido', 'Got it')}</button>
      </aside>`}
      <button class="demo-btn" data-act="demo"><span class="demo-btn__play"></span><span><b>${L('Ver la demo de 60 segundos', 'Watch the 60-second demo')}</b><small>${L('Se reproduce sola, con subtítulos', 'It plays by itself, with captions')}</small></span></button>
      <div class="people">${PEOPLE.map((x) => {
        const p = personFromUid(x.uid);
        return `<button class="pc ${p.real ? 'pc--real' : ''}" data-uid="${x.uid}" style="--hue:${p.hue}">
          <span class="avatar">${esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>
          <span class="pc__txt"><b>${esc(p.name)}</b><small>${esc(p.role)}</small>${lastStatus(x.uid)}</span>
          ${p.real ? `<span class="pc__tag">${L('Tus datos reales', 'Your real data')}</span>` : ''}
        </button>`;
      }).join('')}</div>
      <button class="btn btn--line btn--block crew-btn" data-act="crew">${icon('chart')} ${L('Vista del oficial médico: toda la tripulación', 'Medical officer view: the whole crew')}</button>
      <button class="linkish welcome__hw" data-act="connect">${S.link && S.link.kind !== 'sim' ? `${L('Conectado a', 'Connected to')} ${esc(S.link.name)}` : L('Tengo la XPaze Station: conectar por Bluetooth o WiFi', 'I have the XPaze Station: connect via Bluetooth or WiFi')}</button>
      <p class="fine">${L('Prototipo de investigación. No es un dispositivo médico.', 'Research prototype. Not a medical device.')} <a href="/legal/#${L('privacidad', 'privacy')}">${L('Privacidad', 'Privacy')}</a> · <a href="/legal/#${L('aviso', 'notice')}">${L('Aviso legal', 'Legal notice')}</a> · <a href="/legal/#${L('medico', 'medical')}">${L('Aviso médico', 'Medical disclaimer')}</a></p>
    </section>`);
  const onboarded = () => { if (!saved.onboarded) { saved.onboarded = true; store.save(saved); } };
  node.querySelectorAll('[data-uid]').forEach((b) => b.addEventListener('click', () => { onboarded(); enter(b.dataset.uid); }));
  node.querySelector('[data-act="connect"]').onclick = () => go('choose');
  node.querySelector('[data-act="crew"]').onclick = () => { onboarded(); go('crew'); };
  node.querySelector('[data-act="demo"]').onclick = () => { onboarded(); runDemo(); };
  const ok = node.querySelector('[data-act="onboard-ok"]');
  if (ok) ok.onclick = () => { onboarded(); ok.closest('.onboard').remove(); };
  wireLangSwitch(node, relang);
  return node;
}

async function enter(uid) {
  if (!S.link) {
    const link = new SimLink();
    attach(link);
    await link.connect();
  }
  identify(uid, { quiet: true });
  go('home');
}

/* --------------------------------------------------------- 1 inicio -- */
function home() {
  const p = S.person;
  if (!p) return welcome();
  const first = p.name.split(' ')[0];
  const last = (saved.history[p.uid] || []).at(-1);
  const lv = last ? (last.overall ?? 0) : null;
  const h = S.health && !S.health.error ? S.health : null;
  const sleep = h?.sleep?.hours ?? last?.mind?.sleep ?? null;
  const sp = spaceNow();
  const hour = new Date().getHours();
  const hi = hour < 6 ? L('Buenas noches', 'Good evening') : hour < 12 ? L('Buenos días', 'Good morning') : hour < 14 ? L('Buenos días', 'Good afternoon') : hour < 21 ? L('Buenas tardes', 'Good afternoon') : L('Buenas noches', 'Good evening');
  const node = el(`
    <section class="screen homev">
      ${topbar()}
      <div class="hello" style="--hue:${p.hue}">
        <span class="avatar">${esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>
        <div><h1>${hi}, ${esc(first)}</h1><p>${esc(p.role)} · ${esc(ENVIRONMENTS[envKey()].name)}</p></div>
      </div>

      <div class="glance">
        <div class="g"><small>${L('Último chequeo', 'Last check-up')}</small><b>${last ? `<span class="dot dot--${LEVEL_CLS[lv]}"></span>${L(['Bien', 'A vigilar', 'Actúa'], ['Good', 'Watch', 'Act'])[lv]}` : '—'}</b><em>${last ? new Date(last.at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : L('aún ninguno', 'none yet')}</em></div>
        <div class="g"><small>${L('Sueño', 'Sleep')}</small><b>${sleep != null ? `${fmt(sleep, 1)} h` : '—'}</b><em>${h?.sleep ? L('de tu reloj', 'from your watch') : last?.mind ? L('del chequeo', 'from check-up') : L('sin dato', 'no data')}</em></div>
        <div class="g"><small>${L('Clima espacial', 'Space weather')}</small><b>${sp ? `<span class="dot dot--${LEVEL_CLS[sp.level]}"></span>${L(['Tranquilo', 'Vigilancia', 'Alerta'], ['Quiet', 'Watch', 'Alert'])[sp.level]}` : '…'}</b><em>${L('en directo', 'live')}</em></div>
      </div>

      <button class="big big--check" data-act="check">
        <span class="big__ico">${icon('pulse')}</span>
        <span><b>${L('Hacerme un chequeo', 'Do a check-up')}</b><small>${L('2 minutos · te guía paso a paso', '2 minutes · step-by-step guidance')}</small></span>
      </button>
      <button class="big big--paze" data-act="psy">
        <span class="big__orb"></span>
        <span><b>${L('Hablar con Paze', 'Talk to Paze')}</b><small>${L('Tu psicóloga de a bordo · por voz o por texto', 'Your on-board psychologist · by voice or text')}</small></span>
      </button>

      ${changesCard(p.uid, 3)}
      ${S.link?.kind === 'sim' ? `<div class="scenrow"><span>${L('Simulación de hoy', 'Today’s simulation')}</span><div class="seg seg--scroll">${SIM_SCENARIOS.map(([k]) => `<button data-sim-prof="${k}" class="${S.link?.scenario === k ? 'is-on' : ''}">${SCEN_NAME(k)}</button>`).join('')}</div><p class="fine" data-live="scen">${SCEN_DESC(S.link?.scenario || 'rest')}</p></div>` : ''}
      <div class="minor">
        <button class="mini" data-act="datos">${icon('sim')}<span>${L('Mis datos en directo', 'My live data')}</span></button>
        <button class="mini" data-act="history">${icon('chart')}<span>${t('tab.history')}</span></button>
      </div>

      <div class="envsel"><span>${L('¿Dónde estás?', 'Where are you?')}</span><div class="seg seg--wrap">${Object.entries(ENVIRONMENTS).map(([k, e]) => `<button data-env="${k}" class="${k === envKey() ? 'is-on' : ''}">${e.short}</button>`).join('')}</div></div>
      <button class="linkish" data-act="crewv">${L('Ver a toda la tripulación', 'See the whole crew')}</button>
      <button class="linkish" data-act="switch">${L(`No soy ${esc(first)}: cambiar de persona`, `Not ${esc(first)}? Switch person`)}</button>
    </section>`);
  wire(node);
  node.querySelector('[data-act="datos"]').onclick = () => go('live');
  node.querySelector('[data-act="switch"]').onclick = () => go('welcome');
  node.querySelector('[data-act="crewv"]').onclick = () => go('crew');
  // Paze vive en el botón
  try {
    S.homeOrb?.destroy();
    S.homeOrb = new PazeOrb(node.querySelector('.big__orb'), { mood: 'calma', hr: S.vitals?.bpm || 64 });
    S.homeOrb.start();
  } catch { /* sin WebGL: el botón sigue funcionando */ }
  loadSpace().then(() => { if (S.screen === 'home' && spaceNow() && !sp) render(); });
  if (saved.healthCodes[p.uid] && !S.health) refreshHealth().then(() => { if (S.screen === 'home' && S.health && !S.health.error && !h) render(); });
  return node;
}

/* ---------------------------------------------------------- 1 elegir -- */
function choose() {
  const ble = bluetoothAvailable();
  const secure = window.isSecureContext;
  const node = el(`
    <section class="screen choose">
      <header class="brandbar"><img src="/logo-mark-dark.png" alt="" width="34" height="28"/><b>XPaze</b></header>
      <h1>${L('Conectar la estación', 'Connect the station')}</h1>
      <p class="lead">${L('Si tienes la XPaze Station encendida, conéctala por Bluetooth o por WiFi. Si no, usa la simulada.', 'If your XPaze Station is on, connect it via Bluetooth or WiFi. If not, use the simulated one.')}</p>
      <div class="options">
        <button class="option" data-act="ble" ${ble && secure ? '' : 'disabled'}>
          <span class="option__icon">${icon('bt')}</span>
          <span><b>${L('Estación física', 'Physical station')}</b><small>${L('Conectar por Bluetooth con la XPaze Station', 'Connect to the XPaze Station via Bluetooth')}</small></span>
        </button>
        <div class="remembered" hidden></div>
        <button class="option" data-act="wifi" ${wifiAvailable() ? '' : 'hidden'}>
          <span class="option__icon option__icon--wifi">${icon('wifi')}</span>
          <span><b>${L('Estación por WiFi', 'Station over WiFi')}</b><small>${L('Conectado a la red de la Raspberry Pi, sin Internet', 'On the Raspberry Pi network, no Internet needed')}</small></span>
        </button>
        <button class="option" data-act="sim">
          <span class="option__icon option__icon--sim">${icon('sim')}</span>
          <span><b>${L('Estación simulada', 'Simulated station')}</b><small>${L('Sin hardware. Tú controlas la tarjeta, el dedo y el reloj', 'No hardware. You control the card, the finger and the watch')}</small></span>
        </button>
      </div>
      ${!secure ? `<p class="note">${L('Bluetooth necesita una conexión segura (https). Abre la app desde su dirección https.', 'Bluetooth needs a secure connection (https). Open the app from its https address.')}</p>`
        : !ble ? `<p class="note">${L('Este navegador no tiene Web Bluetooth. Usa Chrome en Android o en un ordenador. En iPhone, solo la estación simulada.', 'This browser does not support Web Bluetooth. Use Chrome on Android or on a computer. On iPhone, only the simulated station works.')}</p>` : ''}
      <p class="fine">${L('Prototipo de investigación. No es un dispositivo médico.', 'Research prototype. Not a medical device.')} <a href="/legal/#${L('privacidad', 'privacy')}">${L('Privacidad', 'Privacy')}</a> · <a href="/legal/#${L('aviso', 'notice')}">${L('Aviso legal', 'Legal notice')}</a> · <a href="/legal/#${L('medico', 'medical')}">${L('Aviso médico', 'Medical disclaimer')}</a></p>
    </section>`);
  node.querySelector('[data-act="ble"]').onclick = () => startBle();
  node.querySelector('[data-act="sim"]').onclick = () => startSim();
  node.querySelector('[data-act="wifi"]').onclick = () => startWifi();
  if (ble && secure) {
    new BleLink().remembered().then((dev) => {
      if (!dev) return;
      const box = node.querySelector('.remembered');
      box.hidden = false;
      box.append(el(`<button class="chip-btn">${L('Reconectar con', 'Reconnect to')} ${esc(dev.name || 'XPaze Station')}</button>`));
      box.firstChild.onclick = () => startBle(dev);
    });
  }
  return node;
}

function attach(link) {
  S.link?.disconnect();
  S.link = link;
  S.status = S.vitals = S.watch = null;
  S.wave = []; S.ecg = []; S.ext = null; S.extStatus = null;
  link.on(onEvent);
  saved.lastMode = link.kind;
  store.save(saved);
}

async function startBle(remembered) {
  const link = new BleLink();
  attach(link);
  go('connecting');
  try {
    if (remembered) await link.resume(remembered);
    else await link.choose();
    go(S.person ? 'home' : 'welcome');
  } catch (e) {
    S.link = null;
    if (e?.name === 'NotFoundError') { go('choose'); return; } // el usuario cerró el selector
    S.linkError = e?.message || String(e);
    go('connecting');
  }
}

async function startWifi() {
  const link = new WifiLink();
  attach(link);
  go('connecting');
  try { await link.connect(); go(S.person ? 'home' : 'welcome'); } catch (e) { S.link = null; S.linkError = e?.message || String(e); go('connecting'); }
}

async function startSim() {
  const link = new SimLink();
  attach(link);
  go('connecting');
  await link.connect();
  go(S.person ? 'home' : 'welcome');
}

/* ---------------------------------------------------- 2 conectando -- */
function connecting() {
  const err = S.linkError;
  S.linkError = null;
  const node = el(`
    <section class="screen center">
      ${err ? `<div class="big-icon err">${icon('x')}</div><h2>${L('No se pudo conectar', 'Could not connect')}</h2>
        <p class="lead">${esc(err)}</p>
        <ul class="tips">${L(['Comprueba que la Raspberry está encendida y cerca.', 'Activa el Bluetooth y la ubicación del móvil.', 'Si la estación estaba conectada a otro móvil, desconéctalo.'], ['Check that the Raspberry Pi is on and nearby.', 'Turn on Bluetooth and location on your phone.', 'If the station was connected to another phone, disconnect it.']).map((x) => `<li>${x}</li>`).join('')}</ul>
        <button class="btn btn--dark" data-act="back">${L('Volver', 'Back')}</button>`
      : `<div class="spinner"></div><h2>${L('Conectando…', 'Connecting…')}</h2><p class="lead">${S.link?.kind === 'sim' ? L('Preparando la estación simulada.', 'Preparing the simulated station.') : L('Elige «XPaze Station» en la lista de dispositivos.', 'Choose “XPaze Station” in the device list.')}</p>`}
    </section>`);
  node.querySelector('[data-act="back"]')?.addEventListener('click', () => go('welcome'));
  return node;
}

/* ------------------------------------------------------ 3 en directo -- */
function topbar() {
  return `
    <header class="topbar">
      <img src="/logo-mark-dark.png" alt="" width="28" height="23"/>
      <span class="link-chip" data-live="chip">—</span>
      <span class="test-badge" data-live="test" hidden>${L('Datos de prueba', 'Test data')}</span>
      ${langSwitch()}
      <button class="icon-btn" data-act="menu" aria-label="${S.screen === 'home' ? L('Cambiar de persona', 'Switch person') : L('Volver al inicio', 'Back to home')}">${icon(S.screen === 'home' ? 'swap' : 'home')}</button>
    </header>`;
}

function live() {
  const p = S.person;
  if (S.link?.kind === 'sim' && p) S.link.setFinger(true); // en la simulada, la estación ya está midiendo
  const node = el(`
    <section class="screen live">
      ${topbar()}
      <button class="linkish back" data-act="home">← ${L('Volver al inicio', 'Back to home')}</button>
      <h2 class="screen-t">${L('Mis datos en directo', 'My live data')}</h2>
      <div class="person ${p ? '' : 'is-empty'}" style="--hue:${p?.hue ?? 200}">
        ${p ? `<div class="avatar">${esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</div>
          <div><b>${esc(p.name)}</b><small>${esc(p.role)}</small></div>
          <button class="chip-btn" data-act="history">${t('tab.history')}</button>`
        : `<div class="avatar avatar--card">${icon('card')}</div><div><b>${L('Acerca tu tarjeta al lector', 'Tap your card on the reader')}</b><small>${L('O elige quién eres', 'Or choose who you are')}</small></div>
          <select class="who" aria-label="${L('Elegir astronauta', 'Choose astronaut')}"><option value="">${L('Elegir…', 'Choose…')}</option>${PEOPLE.map((c) => `<option value="${c.uid}">${esc(c.name)}</option>`).join('')}</select>`}
      </div>

      <div class="wavebox">
        <div class="wavebox__head"><span>${L('Onda de pulso', 'Pulse wave')}</span><span data-live="quality">—</span></div>
        <canvas class="wave" data-live="wave" aria-hidden="true"></canvas>
      </div>

      <div class="tiles">
        <div class="tile tile--hr"><small>${L('Pulso', 'Heart rate')}</small><b data-live="bpm">—</b><em>${L('lpm', 'bpm')}</em></div>
        <div class="tile"><small>${L('Oxígeno estimado', 'Estimated oxygen')}</small><b data-live="spo2">—</b><em>%</em></div>
      </div>
      ${S.link?.kind === 'sim' ? extBlock() : ''}

      <div class="envsel"><span>${L('Entorno', 'Environment')}</span><div class="seg seg--wrap">${Object.entries(ENVIRONMENTS).map(([k, e]) => `<button data-env="${k}" class="${k === envKey() ? 'is-on' : ''}">${e.short}</button>`).join('')}</div></div>
      <button class="btn btn--dark btn--block" data-act="check" ${p ? '' : 'disabled'}>${L('Empezar chequeo guiado', 'Start guided check-up')}</button>
      ${p ? `<button class="btn btn--line btn--block" data-act="psy">${L('Hablar con la psicóloga (IA)', 'Talk to the psychologist (AI)')}</button>` : ''}
      ${p ? '' : `<p class="hint">${L('Identifícate para empezar un chequeo.', 'Identify yourself to start a check-up.')}</p>`}

      <h3 class="section-t">${L('Cabina', 'Cabin')}</h3>
      <div class="tiles tiles--3">
        <div class="tile tile--sm"><small>${L('Temperatura', 'Temperature')}</small><b data-live="temp">—</b><em>°C</em></div>
        <div class="tile tile--sm"><small>${L('Humedad', 'Humidity')}</small><b data-live="hum">—</b><em>%</em></div>
        <div class="tile tile--sm"><small>${L('Presión', 'Pressure')}</small><b data-live="press">—</b><em>hPa</em></div>
      </div>
      <p class="fine" data-live="cabin">${L('Límites de cabina según el estándar NASA-STD-3001.', 'Cabin limits per the NASA-STD-3001 standard.')}</p>

      <h3 class="section-t">${L('Clima espacial', 'Space weather')} · DONKI (NASA)</h3>
      <div class="spacebox" data-live="space">${spaceBox()}</div>

      ${S.link?.kind !== 'sim' || p?.real ? `<h3 class="section-t">${L('Reloj', 'Watch')} · Samsung Health</h3>
      <div class="shealth" data-live="shealth">${healthBox()}</div>` : ''}
      ${S.link?.kind !== 'sim' ? watchLive() : ''}
      ${S.link?.kind !== 'sim' ? '<div class="sensors" data-live="sensors"></div>' : ''}
      ${S.link?.kind === 'sim' ? simPanel() : ''}
    </section>`);
  wire(node);
  node.querySelector('[data-act="home"]').onclick = () => go('home');
  return node;
}

// Reloj en directo (solo con la estación física).
function watchLive() {
  return `<h3 class="section-t">${L('Reloj · en directo', 'Watch · live')}</h3>
      <div class="watch" data-live="watchbox">
        <div class="tiles tiles--3">
          <div class="tile tile--sm"><small>${L('Pulso', 'Heart rate')}</small><b data-live="wbpm">—</b><em>${L('lpm', 'bpm')}</em></div>
          <div class="tile tile--sm"><small>${L('Piel', 'Skin')}</small><b data-live="wskin">—</b><em>°C</em></div>
          <div class="tile tile--sm"><small>SpO₂</small><b data-live="wspo2">—</b><em>%</em></div>
        </div>
        <div class="watch__foot"><span data-live="wstate">—</span><button class="chip-btn" data-act="wspo2">${L('Medir SpO₂ (30 s)', 'Measure SpO₂ (30 s)')}</button></div>
      </div>`;
}

// Estación v2 (solo en la simulada): ECG de los asideros y sensores ampliados.
function extBlock() {
  const tile = (k, n, u, extra = '') => `<div class="tile tile--sm ${extra}" data-tile="${k}"><small>${n}</small><b data-live="x-${k}">—</b><em>${u}</em></div>`;
  return `
      <div class="ecgbox">
        <div class="wavebox__head"><span>ECG · ${L('asideros (derivación I)', 'handles (lead I)')}</span><span data-live="x-rhythm">—</span></div>
        <canvas class="ecg" data-live="ecg" aria-hidden="true"></canvas>
        <div class="ecgbox__foot"><span>25 mm/s · 10 mm/mV</span><span data-live="x-ecghr"></span></div>
      </div>
      <h3 class="section-t">${L('Estación v2 · sensores ampliados', 'Station v2 · extended sensors')} <span class="pill-sim">${L('simulados', 'simulated')}</span></h3>
      <div class="tiles tiles--3 xtiles">
        ${tile('temp', L('Temperatura', 'Temperature'), '°C')}
        ${tile('resp', L('Respiración', 'Breathing'), 'rpm')}
        ${tile('hrv', 'HRV · RMSSD', 'ms')}
        ${tile('qtc', 'QTc', 'ms')}
        ${tile('bp', L('Tensión (PTT)', 'BP (PTT)'), 'mmHg')}
        ${tile('eda', L('Estrés · EDA', 'Stress · EDA'), 'µS')}
        ${tile('grip', L('Agarre', 'Grip'), 'kg')}
        ${tile('co2', 'CO₂', 'mmHg')}
        ${tile('dose', L('Radiación', 'Radiation'), 'µSv/h')}
      </div>
      <p class="fine">${L('El prototipo físico mide pulso, SpO₂ y el aire de la cabina. Estos sensores son los de la estación v2 y aquí se simulan con valores fisiológicos publicados; el pulso, la HRV y el ritmo se calculan de los latidos, no se inventan.', 'The physical prototype measures heart rate, SpO₂ and cabin air. These are the station v2 sensors, simulated here with published physiological values; heart rate, HRV and rhythm are computed from the beats, not made up.')}</p>`;
}

const RHYTHM_TXT = { sinus: ['Ritmo sinusal', 'Sinus rhythm'], ectopics: ['Extrasístoles', 'Ectopic beats'], irregular: ['Ritmo irregular', 'Irregular rhythm'] };
const rhythmText = (r) => (r && RHYTHM_TXT[r] ? L(...RHYTHM_TXT[r]) : L('Analizando…', 'Analysing…'));

function simPanel() {
  return `
    <details class="sim" open>
      <summary>${L('Controles de la estación simulada', 'Simulated station controls')}</summary>
      <div class="sim__row"><span>${L('Tarjeta', 'Card')}</span>
        <div class="seg">${PEOPLE.map((c) => `<button data-sim-card="${c.uid}">${esc(c.name.split(' ')[0])}</button>`).join('')}</div></div>
      <div class="sim__row"><span>${L('Dedo en el sensor', 'Finger on sensor')}</span><button class="switch" data-sim="finger" aria-pressed="${!!S.link?.finger}" aria-label="${L('Dedo en el sensor', 'Finger on sensor')}"><i></i></button></div>
      <div class="sim__row sim__row--col"><span>${L('Qué le pasa a esta persona', 'What is happening to this person')}</span>
        <div class="seg seg--wrap seg--left">${SIM_SCENARIOS.map(([k]) => `<button data-sim-prof="${k}" class="${S.link?.scenario === k ? 'is-on' : ''}">${SCEN_NAME(k)}</button>`).join('')}</div>
        <p class="fine" data-live="scen">${SCEN_DESC(S.link?.scenario || 'rest')}</p></div>
    </details>`;
}

// Situaciones de la estación simulada (src/app/simbody.js): [clave, nombre es, nombre en, descripción es, descripción en]
const SIM_SCENARIOS = [
  ['rest', 'Reposo', 'Resting', 'Todo normal: su línea base.', 'All normal: their baseline.'],
  ['day58', 'Día 58 (la historia)', 'Day 58 (the story)', 'Tres noches durmiendo poco: nada sale de los rangos generales, pero el pulso, la HRV y el estrés se alejan de SU normal.', 'Three nights of short sleep: nothing leaves the general ranges, but heart rate, HRV and stress drift away from THEIR normal.'],
  ['af', 'Fibrilación auricular', 'Atrial fibrillation', 'Latidos irregulares sin patrón y sin onda P: el ECG lo detecta.', 'Irregular beats with no pattern and no P wave: the ECG detects it.'],
  ['pvc', 'Extrasístoles', 'Ectopic beats', 'Latidos adelantados y anchos con pausa compensadora.', 'Early, wide beats with a compensatory pause.'],
  ['fever', 'Fiebre', 'Fever', 'Infección: temperatura, pulso y respiración suben.', 'Infection: temperature, heart rate and breathing go up.'],
  ['lowo2', 'Oxígeno bajo', 'Low oxygen', 'SpO₂ baja y respiración rápida.', 'Low SpO₂ and fast breathing.'],
  ['qt', 'QTc largo (medicación)', 'Long QTc (medication)', 'Un antiemético del botiquín alarga el QTc.', 'An anti-nausea drug from the kit lengthens the QTc.'],
  ['stress', 'Estrés agudo', 'Acute stress', 'HRV hundida y actividad electrodérmica alta.', 'HRV drops and electrodermal activity rises.'],
  ['exercise', 'Tras entrenar', 'After exercise', 'Esfuerzo reciente: no es reposo.', 'Recent effort: not a resting reading.'],
  ['co2', 'CO₂ alto en cabina', 'High cabin CO₂', 'El depurador de CO₂ falla: afecta a toda la tripulación.', 'The CO₂ scrubber is failing: it affects the whole crew.'],
  ['spe', 'Tormenta solar', 'Solar storm', 'Evento de partículas: el dosímetro se dispara.', 'Particle event: the dosimeter shoots up.'],
];
const SCEN = Object.fromEntries(SIM_SCENARIOS.map((x) => [x[0], x]));
const SCEN_NAME = (k) => L(SCEN[k][1], SCEN[k][2]);
const SCEN_DESC = (k) => L(SCEN[k][3], SCEN[k][4]);

function wire(node) {
  node.querySelector('[data-act="menu"]')?.addEventListener('click', () => go(S.screen === 'home' ? 'welcome' : 'home'));
  wireLangSwitch(node, relang);
  node.querySelector('[data-act="check"]')?.addEventListener('click', startCheck);
  node.querySelector('[data-act="history"]')?.addEventListener('click', () => go('history'));
  if (node.querySelector('[data-live="space"]')) loadSpace();
  const hb = node.querySelector('[data-live="shealth"]');
  if (hb) { wireHealth(hb); if (saved.healthCodes[S.person?.uid] && !S.health) refreshHealth(); }
  node.querySelector('[data-act="psy"]')?.addEventListener('click', () => openChat());
  node.querySelectorAll('[data-env]').forEach((b) => b.addEventListener('click', () => {
    saved.env = b.dataset.env; store.save(saved);
    node.querySelectorAll('[data-env]').forEach((x) => x.classList.toggle('is-on', x === b));
    toast(L(`Entorno: ${ENVIRONMENTS[saved.env].name}. Comunicación con Tierra: ${ENVIRONMENTS[saved.env].delay}.`, `Environment: ${ENVIRONMENTS[saved.env].name}. Communication with Earth: ${ENVIRONMENTS[saved.env].delay}.`));
    const sb = node.querySelector('[data-live="space"]'); if (sb) sb.innerHTML = spaceBox();
  }));
  node.querySelector('.who')?.addEventListener('change', (e) => { if (e.target.value) identify(e.target.value); });
  node.querySelector('[data-act="wspo2"]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const ok = await S.link?.send(CMD.watchSpo2);
    toast(ok ? L('Midiendo SpO₂ en el reloj. No muevas la muñeca 30 s.', 'Measuring SpO₂ on the watch. Keep your wrist still for 30 s.') : L('El reloj no responde.', 'The watch is not responding.'));
  });
  // simulación
  // los perfiles reales no tienen tarjeta RFID (su UID no es hexadecimal): se identifican directamente
  node.querySelectorAll('[data-sim-card]').forEach((b) => b.addEventListener('click', () => (REAL_PEOPLE[b.dataset.simCard] ? identify(b.dataset.simCard) : S.link.tapCard(b.dataset.simCard))));
  node.querySelector('[data-sim="finger"]')?.addEventListener('click', (e) => {
    const b = e.currentTarget; const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on); S.link.setFinger(on);
  });
  node.querySelector('[data-sim="watch"]')?.addEventListener('click', (e) => {
    const b = e.currentTarget; const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on); S.link.setWatch(on);
  });
  node.querySelectorAll('[data-sim-prof]').forEach((b) => b.addEventListener('click', () => {
    node.querySelectorAll('[data-sim-prof]').forEach((x) => x.classList.toggle('is-on', x === b));
    S.link.setScenario(b.dataset.simProf);
    setText('scen', SCEN_DESC(b.dataset.simProf));
  }));
}

// Ficha médica de ficción de la tripulación (la persona puede editarla). Los perfiles reales empiezan vacíos.
const CREW_MEDICAL = {
  vega: ['Migrañas ocasionales (2–3 al mes), peores con poco sueño. Melatonina 1 mg algunas noches. Alergia a la penicilina. Corredora de fondo; en la nave entrena 2 h al día.', 'Occasional migraines (2–3 a month), worse with little sleep. Melatonin 1 mg some nights. Penicillin allergy. Long-distance runner; trains 2 h a day on board.'],
  iker: ['Ansiedad leve tratada con terapia cognitivo-conductual en 2023, sin medicación. Menisco de la rodilla derecha operado en 2021. Sin alergias. Bebe mucho café.', 'Mild anxiety treated with CBT in 2023, no medication. Right knee meniscus surgery in 2021. No allergies. Drinks a lot of coffee.'],
  noa: ['Hipotiroidismo controlado con levotiroxina 50 µg al día. Sin alergias. Le cuesta dormir después de los turnos de noche.', 'Hypothyroidism controlled with levothyroxine 50 µg a day. No allergies. Struggles to sleep after night shifts.'],
  amara: ['Deportista de resistencia: bradicardia sinusal fisiológica (pulso en reposo ~49). Asma leve inducida por el ejercicio, con inhalador de rescate. Sin alergias.', 'Endurance athlete: physiological sinus bradycardia (resting heart rate ~49). Mild exercise-induced asthma, with a rescue inhaler. No allergies.'],
};
const medicalOf = (uid) => saved.medical[uid] ?? (crewByUid[uid] ? L(...CREW_MEDICAL[crewByUid[uid].id]) : '');

// Fisiología de cada persona para el cuerpo simulado (de su ficha de tripulación).
function personBody(p) {
  return storyBody(crewByUid[p?.uid]?.id || 'default');
}

function identify(uid, { quiet = false } = {}) {
  const changed = S.person?.uid !== uid;
  S.person = personFromUid(uid);
  if (changed) { S.health = null; S.chat = null; }
  seedHistory(uid);
  if (S.link?.kind === 'sim') S.link.setBody(personBody(S.person));
  if (changed) {
    vibrate(40);
    if (!quiet) toast(`${L('Hola', 'Hi')}, ${S.person.name.split(' ')[0]}.`);
    if (['live', 'home'].includes(S.screen)) render();
  }
}

/* --------------------------------------------- eventos de la estación -- */
function onEvent({ type, data }) {
  if (type === 'link') {
    S.linkState = data.state;
    if (data.state === 'disconnected' && !['choose', 'welcome'].includes(S.screen)) { S.link = null; toast(L('Estación desconectada.', 'Station disconnected.')); go(S.person ? 'home' : 'welcome'); return; }
  } else if (type === 'vitals') {
    S.vitals = data;
    if (S.check && STEPS[S.check.step] === 'hr' && !S.check.manual) S.check.samples.push({
      bpm: data.quality === 'good' ? data.bpm : null, spo2: data.quality === 'good' ? data.spo2 : null,
      quality: data.quality, temperature: data.temperature, humidity: data.humidity, pressure: data.pressure,
      watchBpm: S.watch?.bpm ?? null, skin: S.watch?.skin ?? null,
    });
  } else if (type === 'wave') {
    S.wave.push(...data.samples);
    if (S.wave.length > WAVE_MAX) S.wave.splice(0, S.wave.length - WAVE_MAX);
    return; // el lienzo se pinta en su propio bucle
  } else if (type === 'card') {
    if (data && S.screen === 'welcome') enter(data.uid);
    else if (data && ['home', 'live', 'history', 'result'].includes(S.screen)) identify(data.uid);
  } else if (type === 'ecg') {
    for (const x of data.samples) S.ecg.push(x);
    if (S.ecg.length > ECG_MAX) S.ecg.splice(0, S.ecg.length - ECG_MAX);
    return; // se pinta en el bucle de la onda
  } else if (type === 'ext') {
    S.ext = data;
    checkAlerts(data);
    if (S.check && STEPS[S.check.step] === 'hr' && !S.check.manual) S.check.ext.push(data);
  } else if (type === 'ext-status') {
    S.extStatus = data;
    return;
  } else if (type === 'watch') {
    S.watch = data;
  } else if (type === 'status') {
    S.status = data;
  }
  updateLive();
}

const QUALITY = {
  es: {
    'no-data': 'Sin señal del sensor', 'no-finger': 'Pon el dedo en el sensor', collecting: 'Midiendo… no te muevas',
    weak: 'Señal débil: apoya mejor el dedo', noisy: 'Hay movimiento: quédate quieto', good: 'Señal buena',
  },
  en: {
    'no-data': 'No signal from the sensor', 'no-finger': 'Place your finger on the sensor', collecting: 'Measuring… keep still',
    weak: 'Weak signal: rest your finger better', noisy: 'Movement detected: keep still', good: 'Good signal',
  },
};
const QUALITY_TEXT = new Proxy({}, { get: (_, k) => QUALITY[lang()][k] });

function setText(key, text) { const n = app.querySelector(`[data-live="${key}"]`); if (n && n.textContent !== text) n.textContent = text; }

function updateLive() {
  const v = S.vitals; const w = S.watch; const st = S.status;
  const chip = app.querySelector('[data-live="chip"]');
  if (chip) {
    const map = { connected: [L('Conectado', 'Connected'), 'ok'], connecting: [L('Conectando…', 'Connecting…'), 'warn'], reconnecting: [L('Reconectando…', 'Reconnecting…'), 'warn'], disconnected: [L('Desconectado', 'Disconnected'), 'err'], idle: ['—', ''] };
    const [txt, cls] = map[S.linkState] || map.idle;
    chip.textContent = `${S.link?.kind === 'sim' ? L('Simulada', 'Simulated') : S.link?.name || L('Estación', 'Station')} · ${txt}`;
    chip.className = `link-chip ${cls}`;
  }
  const test = app.querySelector('[data-live="test"]');
  if (test) test.hidden = !(st?.test && S.link?.kind === 'ble');
  setText('bpm', v?.bpm ? String(v.bpm) : '—');
  setText('spo2', v?.spo2 ? String(v.spo2) : '—');
  setText('quality', v ? QUALITY_TEXT[v.quality] || '' : L('Esperando datos…', 'Waiting for data…'));
  app.querySelector('.tile--hr')?.classList.toggle('is-good', v?.quality === 'good');
  setText('temp', fmt(v?.temperature, 1));
  setText('hum', fmt(v?.humidity, 0));
  setText('press', fmt(v?.pressure, 0));
  const cab = v ? cabinLevel(v) : null;
  const cabEl = app.querySelector('[data-live="cabin"]');
  if (cabEl && cab != null) {
    const msg = L(['Aire de cabina dentro de los límites de NASA-STD-3001.', 'Aire de cabina fuera del rango de confort (NASA-STD-3001 V2 6013).', 'Aire de cabina fuera de los límites de salud (NASA-STD-3001 V2 6012): avisa a la tripulación.'],
      ['Cabin air within NASA-STD-3001 limits.', 'Cabin air outside the comfort range (NASA-STD-3001 V2 6013).', 'Cabin air outside the health limits (NASA-STD-3001 V2 6012): alert the crew.'])[cab];
    if (cabEl.textContent !== msg) { cabEl.textContent = msg; cabEl.className = `fine cab-${['ok', 'warn', 'err'][cab]}`; }
  }
  setText('wbpm', w?.bpm ? String(w.bpm) : '—');
  setText('wskin', fmt(w?.skin, 1));
  setText('wspo2', w?.spo2 ? String(w.spo2) : '—');
  setText('wstate', !w ? L('Reloj no conectado', 'Watch not connected') : w.spo2Measuring ? L('Midiendo SpO₂… no muevas la muñeca', 'Measuring SpO₂… keep your wrist still') : `${L('Conectado', 'Connected')}${w.battery != null ? ` · ${L('batería', 'battery')} ${w.battery} %` : ''}`);
  const wbtn = app.querySelector('[data-act="wspo2"]');
  if (wbtn) wbtn.disabled = !w || w.spo2Measuring;
  app.querySelector('[data-live="watchbox"]')?.classList.toggle('is-off', !w);
  const sens = app.querySelector('[data-live="sensors"]');
  if (sens && st) {
    const items = [['Arduino', st.arduino], [L('Tarjetas', 'Cards'), st.rfid], [L('Pulso', 'Pulse'), st.ppg], [L('Temp./humedad', 'Temp./humidity'), st.aht], [L('Presión', 'Pressure'), st.bmp], [L('Reloj', 'Watch'), st.watch]];
    const html = items.map(([n, ok]) => `<span class="${ok ? 'ok' : 'off'}">${n}</span>`).join('');
    if (sens.innerHTML !== html) sens.innerHTML = html;
  }
  const x = S.ext;
  if (x && app.querySelector('.xtiles')) {
    const lvl = (k, l) => app.querySelector(`[data-tile="${k}"]`)?.setAttribute('data-lvl', l == null ? '' : ['ok', 'warn', 'err'][l]);
    setText('x-temp', fmt(x.temp, 1)); lvl('temp', classify('temp', x.temp).level);
    setText('x-resp', String(x.rr)); lvl('resp', classify('resp', x.rr).level);
    setText('x-hrv', x.rmssd != null ? String(x.rmssd) : '—');
    setText('x-qtc', String(x.qtc)); lvl('qtc', classify('qtc', x.qtc).level);
    setText('x-bp', `${x.bpEst.sys}/${x.bpEst.dia}`);
    setText('x-eda', fmt(x.eda, 1)); lvl('eda', x.eda >= 8 ? 1 : 0);
    setText('x-grip', String(x.grip));
    setText('x-co2', fmt(x.co2, 1)); lvl('co2', co2Level(x.co2));
    setText('x-dose', String(x.dose)); lvl('dose', x.dose >= 200 ? 2 : x.dose >= 60 ? 1 : 0);
    setText('x-rhythm', rhythmText(x.rhythm));
    app.querySelector('[data-live="x-rhythm"]')?.setAttribute('data-lvl', x.rhythm && x.rhythm !== 'sinus' ? 'warn' : 'ok');
    setText('x-ecghr', x.ecgHr ? `${x.ecgHr} ${L('lpm', 'bpm')}${x.ectopics ? ` · ${x.ectopics} ${L('extrasístoles', 'ectopics')}` : ''}` : '');
  }
  if (S.screen === 'check') updateCheck();
}

/* ---------------------------------------------------------- onda -- */
function drawWave() {
  const c = app.querySelector('canvas.wave');
  if (c) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const data = S.wave;
    const good = S.vitals?.quality === 'good' || S.vitals?.quality === 'collecting';
    g.strokeStyle = 'rgba(20,20,20,0.08)';
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    if (data.length > 2) {
      const peak = Math.max(200, ...data.map(Math.abs));
      g.lineWidth = 2.4; g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = good ? '#e5484d' : '#a5a29b';
      g.beginPath();
      data.forEach((v, i) => {
        const x = (i / (WAVE_MAX - 1)) * w;
        const y = h / 2 - (v / peak) * (h * 0.42);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.stroke();
      const lx = ((data.length - 1) / (WAVE_MAX - 1)) * w;
      const ly = h / 2 - (data[data.length - 1] / peak) * (h * 0.42);
      g.fillStyle = good ? '#e5484d' : '#a5a29b';
      g.beginPath(); g.arc(lx, ly, 3.5, 0, Math.PI * 2); g.fill();
    }
  }
  app.querySelectorAll('canvas.ecg').forEach((cv) => drawEcg(cv, S.ecg, { seconds: cv.dataset.sec ? +cv.dataset.sec : 4 }));
  requestAnimationFrame(drawWave);
}
requestAnimationFrame(drawWave);

/* ------------------------------------------------- 4 chequeo guiado -- */
// Cinco pasos: pulso y SpO₂ (sensor o a mano) · tensión · glucosa · ánimo y sueño · señales de alarma.
let CHECK_S = 30;
const CHECK_MAX_S = 60;
let CHECK_GOOD = 15;
const STEPS = ['hr', 'bp', 'glucose', 'mind', 'flags'];
const STEP_TITLES = {
  es: { hr: 'Pulso y oxígeno', bp: 'Tensión arterial', glucose: 'Glucosa', mind: 'Ánimo y sueño', flags: 'Señales de alarma' },
  en: { hr: 'Heart rate and oxygen', bp: 'Blood pressure', glucose: 'Glucose', mind: 'Mood and sleep', flags: 'Warning signs' },
};
const STEP_TITLE = new Proxy({}, { get: (_, k) => STEP_TITLES[lang()][k] });
const envKey = () => (ENVIRONMENTS[saved.env] ? saved.env : 'transit');

async function startCheck() {
  if (!S.person) return;
  S.check = { step: 0, samples: [], ext: [], start: performance.now(), uid: S.person.uid, values: {}, manual: false, done: false };
  try { S.check.lock = await navigator.wakeLock?.request('screen'); } catch { /* opcional */ }
  go('check');
  S.check.timer = setInterval(updateCheck, 250);
}

function stepIntro(id) {
  const m = MEASURES[id === 'hr' ? 'hr' : id];
  const i = STEPS.indexOf(id);
  return `
    <p class="kicker">${L(`Paso ${i + 1} de ${STEPS.length}`, `Step ${i + 1} of ${STEPS.length}`)} · ${esc(S.person.name)}</p>
    <div class="dots">${STEPS.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'now' : ''}"></i>`).join('')}</div>
    <h2>${STEP_TITLE[id]}</h2>
    ${m ? `<details class="why"><summary>${L('¿Por qué se mide?', 'Why measure this?')}</summary><p>${esc(m.why)}</p>
      ${id === 'hr' ? `<p>${esc(MEASURES.spo2.why)}</p>` : ''}</details>
      ${S.link?.kind === 'sim' ? '' : `<ol class="howto">${m.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`}` : ''}`;
}

function check() {
  const c = S.check;
  const id = STEPS[c.step];
  const sim = S.link?.kind === 'sim';
  const views = { hr: stepHr, bp: sim ? stepBpSim : stepBp, glucose: sim ? stepGlucoseSim : stepGlucose, mind: stepMind, flags: stepFlags };
  const node = views[id]();
  node.querySelector('[data-act="cancel"]')?.addEventListener('click', () => { if (confirm(L('¿Cancelar el chequeo? No se guardará.', 'Cancel the check-up? It will not be saved.'))) { endCheck(); go('home'); } });
  node.querySelector('[data-act="menu"]').onclick = () => {};
  return node;
}

function nextStep() {
  if (S.link?.kind === 'sim' && STEPS[S.check.step] === 'hr') S.link.setFinger(false);
  S.check.step += 1;
  if (S.check.step >= STEPS.length) finishCheck();
  else go('check');
}

const footer = (skip = true, label = L('Siguiente', 'Next')) => `
  <div class="row">
    ${skip ? `<button class="btn btn--line" data-act="skip">${L('Omitir', 'Skip')}</button>` : `<button class="btn btn--line" data-act="cancel">${L('Cancelar', 'Cancel')}</button>`}
    <button class="btn btn--dark" data-act="next">${label}</button>
  </div>
  ${skip ? `<button class="btn btn--ghost btn--block" data-act="cancel">${L('Cancelar chequeo', 'Cancel check-up')}</button>` : ''}`;

function numberField(name, label, unit, { min, max, step = 1, value = '', required = true }) {
  return `<label class="field"><span>${label}</span><span class="field__in"><input name="${name}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${value}"${required ? ' required' : ''}/><em>${unit}</em></span></label>`;
}
const readNum = (node, name, min, max) => {
  const v = parseFloat(node.querySelector(`[name="${name}"]`)?.value);
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
};

function stepHr() {
  const c = S.check;
  if (S.link?.kind === 'sim' && !c.manual) S.link.setFinger(true);
  const node = el(`
    <section class="screen check">
      ${topbar()}
      ${stepIntro('hr')}
      <div class="sensor-box" ${c.manual ? 'hidden' : ''}>
        <div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="ring__bg"/><circle cx="60" cy="60" r="52" class="ring__fg" pathLength="100"/></svg>
          <div class="ring__in"><b data-live="cbpm">—</b><small>${L('lpm', 'bpm')}</small></div></div>
        <h3 class="check__msg" data-live="cmsg">${QUALITY_TEXT['no-finger']}</h3>
        <div class="wavebox"><canvas class="wave" aria-hidden="true"></canvas></div>
        ${S.link?.kind === 'sim' ? `<div class="ecgbox ecgbox--sm"><canvas class="ecg" data-sec="3" aria-hidden="true"></canvas></div>
        <p class="fine">${L('A la vez: ECG de los asideros, temperatura sin contacto, respiración, HRV, QTc, tensión estimada, EDA y fuerza de agarre.', 'At the same time: handle ECG, contactless temperature, breathing, HRV, QTc, estimated blood pressure, EDA and grip strength.')}</p>` : ''}
        ${S.link?.kind === 'sim' ? '' : `<button class="btn btn--ghost btn--block" data-act="manual">${L('El sensor no funciona: introducir a mano', 'Sensor not working? Enter it manually')}</button>`}
      </div>
      <form class="manual" ${c.manual ? '' : 'hidden'}>
        <p class="note">${L('Medida manual: usa el pulsioxímetro de la enfermería y anota lo que marque.', 'Manual reading: use the pulse oximeter from the medical kit and enter what it shows.')}</p>
        ${numberField('hr', L('Pulso en reposo', 'Resting heart rate'), L('lpm', 'bpm'), { min: 25, max: 230 })}
        ${numberField('spo2', L('Oxígeno (SpO₂), opcional', 'Oxygen (SpO₂), optional'), '%', { min: 50, max: 100, required: false })}
        <button class="btn btn--dark btn--block" type="submit">${L('Siguiente', 'Next')}</button>
      </form>
      <button class="btn btn--line btn--block" data-act="cancel">${L('Cancelar chequeo', 'Cancel check-up')}</button>
    </section>`);
  node.querySelector('[data-act="manual"]')?.addEventListener('click', () => { c.manual = true; go('check'); });
  node.querySelector('form.manual').onsubmit = (e) => {
    e.preventDefault();
    const hr = readNum(node, 'hr', 25, 230);
    if (hr == null) { toast(L('Escribe un pulso válido.', 'Enter a valid heart rate.')); return; }
    c.values.hr = Math.round(hr);
    const sp = readNum(node, 'spo2', 50, 100);
    if (sp != null) c.values.spo2 = Math.round(sp);
    c.values.manualHr = true;
    nextStep();
  };
  return node;
}

// Medida simulada con animación: un anillo que se llena mientras «mide» y el valor al final.
function simMeasure(node, { seconds, tick, done }) {
  const fg = node.querySelector('.ring__fg');
  const t0 = performance.now();
  const timer = setInterval(() => {
    if (S.screen !== 'check') { clearInterval(timer); return; }
    const p = Math.min(1, (performance.now() - t0) / (seconds * 1000));
    if (fg) fg.style.strokeDashoffset = String(100 - p * 100);
    tick?.(p);
    if (p >= 1) { clearInterval(timer); done(); }
  }, 80);
}
const simRing = (unit) => `<div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="ring__bg"/><circle cx="60" cy="60" r="52" class="ring__fg" pathLength="100"/></svg>
          <div class="ring__in"><b data-live="mval">—</b><small>${unit}</small></div></div>`;

// Tensión con el manguito automático de la estación: se infla, desinfla y da el valor solo.
function stepBpSim() {
  const node = el(`
    <section class="screen check">
      ${topbar()}
      ${stepIntro('bp')}
      <div class="sensor-box">
        ${simRing('mmHg')}
        <h3 class="check__msg" data-live="mmsg">${L('Inflando el manguito…', 'Inflating the cuff…')}</h3>
        <p class="fine">${L('Manguito automático en el brazo izquierdo, a la altura del corazón. No hables ni te muevas.', 'Automatic cuff on the left arm, at heart level. Do not talk or move.')}</p>
      </div>
      <button class="btn btn--line btn--block" data-act="cancel">${L('Cancelar chequeo', 'Cancel check-up')}</button>
    </section>`);
  const val = node.querySelector('[data-live="mval"]'), msg = node.querySelector('[data-live="mmsg"]');
  const bp = S.link.body.cuff();
  simMeasure(node, {
    seconds: S.demo ? 3.5 : 7,
    tick: (p) => {
      const pr = p < 0.35 ? Math.round((p / 0.35) * (bp.sys + 40)) : Math.round(bp.sys + 40 - ((p - 0.35) / 0.65) * (bp.sys + 40 - bp.dia + 10));
      val.textContent = String(pr);
      msg.textContent = p < 0.35 ? L('Inflando el manguito…', 'Inflating the cuff…') : L('Midiendo mientras desinfla…', 'Measuring while it deflates…');
    },
    done: () => {
      val.textContent = `${bp.sys}/${bp.dia}`;
      msg.textContent = L('Listo', 'Done');
      S.check.values.bp = bp;
      vibrate(40);
      setTimeout(() => { if (S.screen === 'check' && STEPS[S.check?.step] === 'bp') nextStep(); }, S.demo ? 700 : 1300);
    },
  });
  return node;
}

// Glucosa con el glucómetro conectado: «gota de sangre» y unos segundos de análisis.
function stepGlucoseSim() {
  const node = el(`
    <section class="screen check">
      ${topbar()}
      ${stepIntro('glucose')}
      <div class="sensor-box">
        ${simRing('mg/dL')}
        <h3 class="check__msg" data-live="mmsg">${L('Analizando la gota…', 'Analysing the drop…')}</h3>
        <p class="fine">${L('Glucómetro conectado por Bluetooth: una gota de la yema del dedo en la tira.', 'Bluetooth glucometer: one drop from your fingertip on the strip.')}</p>
      </div>
      <button class="btn btn--line btn--block" data-act="cancel">${L('Cancelar chequeo', 'Cancel check-up')}</button>
    </section>`);
  const val = node.querySelector('[data-live="mval"]'), msg = node.querySelector('[data-live="mmsg"]');
  const g = S.link.body.glucose();
  simMeasure(node, {
    seconds: S.demo ? 2.5 : 5,
    tick: (p) => { val.textContent = String(Math.max(0, Math.ceil((S.demo ? 2.5 : 5) * (1 - p)))); },
    done: () => {
      val.textContent = String(g);
      msg.textContent = L('Listo', 'Done');
      S.check.values.glucose = g; S.check.values.fasting = false;
      vibrate(40);
      setTimeout(() => { if (S.screen === 'check' && STEPS[S.check?.step] === 'glucose') nextStep(); }, S.demo ? 700 : 1300);
    },
  });
  return node;
}

function stepBp() {
  const node = el(`
    <section class="screen check">
      ${topbar()}
      ${stepIntro('bp')}
      ${S.check.values.ext ? `<p class="note">${L(`Estimación sin manguito (tiempo de tránsito del pulso, experimental): ~${S.check.values.ext.bpEst.sys}/${S.check.values.ext.bpEst.dia} mmHg. Confírmala con el manguito: solo cuenta la medida del manguito.`, `Cuffless estimate (pulse transit time, experimental): ~${S.check.values.ext.bpEst.sys}/${S.check.values.ext.bpEst.dia} mmHg. Confirm it with the cuff: only the cuff reading counts.`)}</p>` : ''}
      <div class="fields2">
        ${numberField('sys', L('Alta (sistólica)', 'Top (systolic)'), 'mmHg', { min: 50, max: 260 })}
        ${numberField('dia', L('Baja (diastólica)', 'Bottom (diastolic)'), 'mmHg', { min: 30, max: 160 })}
      </div>
      ${footer()}
    </section>`);
  node.querySelector('[data-act="skip"]').onclick = nextStep;
  node.querySelector('[data-act="next"]').onclick = () => {
    const sys = readNum(node, 'sys', 50, 260), dia = readNum(node, 'dia', 30, 160);
    if (sys == null || dia == null || dia >= sys) { toast(L('Revisa los dos valores: la alta debe ser mayor que la baja.', 'Check both values: the top number must be higher than the bottom one.')); return; }
    S.check.values.bp = { sys: Math.round(sys), dia: Math.round(dia) };
    nextStep();
  };
  return node;
}

function stepGlucose() {
  const node = el(`
    <section class="screen check">
      ${topbar()}
      ${stepIntro('glucose')}
      ${numberField('glu', L('Glucosa', 'Glucose'), 'mg/dL', { min: 20, max: 600 })}
      <label class="check-row"><input type="checkbox" name="fasting"/> <span>${L('Estoy en ayunas (más de 8 h sin comer)', 'I am fasting (no food for over 8 h)')}</span></label>
      ${footer()}
    </section>`);
  node.querySelector('[data-act="skip"]').onclick = nextStep;
  node.querySelector('[data-act="next"]').onclick = () => {
    const g = readNum(node, 'glu', 20, 600);
    if (g == null) { toast(L('Escribe un valor de glucosa entre 20 y 600 mg/dL.', 'Enter a glucose value between 20 and 600 mg/dL.')); return; }
    S.check.values.glucose = Math.round(g);
    S.check.values.fasting = node.querySelector('[name="fasting"]').checked;
    nextStep();
  };
  return node;
}

function stepMind() {
  const sim = S.link?.kind === 'sim';
  const a = sim ? { q0: 0, q1: 0 } : { q0: null, q1: null };
  const node = el(`
    <section class="screen check">
      ${topbar()}
      ${stepIntro('mind')}
      ${PHQ2.map((q, i) => `<fieldset class="q"><legend>${L('En las últimas dos semanas', 'Over the last two weeks')}: ${esc(q.toLowerCase())}</legend>
        <div class="seg seg--wrap seg--left">${PHQ2_ANSWERS.map((t, v) => `<button type="button" data-q="${i}" data-v="${v}" class="${sim && v === 0 ? 'is-on' : ''}">${t}</button>`).join('')}</div></fieldset>`).join('')}
      ${sim ? `<p class="note">${L('Rellenado con datos de prueba: cámbialo si quieres y pulsa Siguiente.', 'Filled in with test data: change it if you like and tap Next.')}</p>` : ''}
      ${numberField('sleep', L('Horas dormidas esta noche', 'Hours slept last night'), 'h', { min: 0, max: 16, step: 0.5, value: S.health?.sleep?.hours != null ? Math.round(S.health.sleep.hours * 2) / 2 : 7 })}
      ${S.health?.sleep?.hours != null ? `<p class="fine">${L(`Según tu reloj (Samsung Health): ${fmt(S.health.sleep.hours, 1)} h. Corrígelo si no es así.`, `According to your watch (Samsung Health): ${fmt(S.health.sleep.hours, 1)} h. Correct it if that is wrong.`)}</p>` : ''}
      <label class="field"><span>${L('Estrés hoy', 'Stress today')}: <b data-live="stressv">3</b> ${L('de', 'out of')} 10</span><input name="stress" type="range" min="0" max="10" step="1" value="3"/></label>
      ${footer(false)}
    </section>`);
  node.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
    a[`q${b.dataset.q}`] = +b.dataset.v;
    node.querySelectorAll(`[data-q="${b.dataset.q}"]`).forEach((x) => x.classList.toggle('is-on', x === b));
  }));
  const range = node.querySelector('[name="stress"]');
  range.oninput = () => { node.querySelector('[data-live="stressv"]').textContent = range.value; };
  node.querySelector('[data-act="next"]').onclick = () => {
    if (a.q0 == null || a.q1 == null) { toast(L('Responde a las dos preguntas.', 'Answer both questions.')); return; }
    const sleep = readNum(node, 'sleep', 0, 16);
    if (sleep == null) { toast(L('Escribe las horas de sueño.', 'Enter your hours of sleep.')); return; }
    S.check.values.mind = { phq2: a.q0 + a.q1, sleep, stress: +range.value };
    nextStep();
  };
  return node;
}

function stepFlags() {
  const node = el(`
    <section class="screen check">
      ${topbar()}
      ${stepIntro('flags')}
      <p class="lead">${L('¿Notas ahora alguna de estas señales? Si es así, no esperes al resultado: avisa a la tripulación.', 'Do you notice any of these signs right now? If so, do not wait for the result: alert the crew.')}</p>
      <div class="flags">${RED_FLAGS.map((f, i) => `<label class="check-row check-row--flag"><input type="checkbox" value="${i}"/> <span>${esc(f)}</span></label>`).join('')}</div>
      ${footer(false, L('Ver resultado', 'See result'))}
    </section>`);
  node.querySelector('[data-act="next"]').onclick = () => {
    const picked = [...node.querySelectorAll('.flags input:checked')].map((x) => +x.value);
    S.check.values.flags = picked.map((i) => RED_FLAGS[i]);
    S.check.values.selfHarm = picked.includes(SELF_HARM);
    nextStep();
  };
  return node;
}

function updateCheck() {
  const c = S.check;
  if (!c || S.screen !== 'check' || STEPS[c.step] !== 'hr' || c.manual || c.done) return;
  const elapsed = (performance.now() - c.start) / 1000;
  const good = c.samples.filter((s) => s.bpm != null).length;
  const progress = Math.min(1, Math.min(1, good / CHECK_GOOD) * Math.min(1, elapsed / CHECK_S));
  const fg = app.querySelector('.ring__fg');
  if (fg) fg.style.strokeDashoffset = String(100 - progress * 100);
  const v = S.vitals;
  setText('cbpm', v?.bpm && v.quality === 'good' ? String(v.bpm) : '—');
  setText('cmsg', v ? (v.quality === 'good' ? `${L('Midiendo…', 'Measuring…')} ${Math.max(0, Math.ceil(CHECK_S - elapsed))} s` : QUALITY_TEXT[v.quality]) : L('Esperando a la estación…', 'Waiting for the station…'));
  if ((good >= CHECK_GOOD && elapsed >= CHECK_S) || elapsed >= CHECK_MAX_S) {
    c.done = true;
    const r = summarize(c.samples);
    if (r.bpm == null) {
      toast(L('No hubo señal estable. Introduce el pulso a mano.', 'No stable signal. Enter your heart rate manually.'));
      c.manual = true; c.done = false; go('check');
      return;
    }
    Object.assign(c.values, { hr: r.bpm, spo2: r.spo2 ?? undefined, watchBpm: r.watchBpm, skin: r.skin, cabin: { t: r.temperature, h: r.humidity, p: r.pressure } });
    if (c.ext.length >= 3) c.values.ext = summarizeExt(c.ext);
    vibrate(60);
    toast(`${L('Pulso', 'Heart rate')} ${r.bpm} ${L('lpm', 'bpm')}${r.spo2 ? ` · SpO₂ ${r.spo2} %` : ''}. ${L('Siguiente paso.', 'Next step.')}`);
    nextStep();
  }
}

// Resumen de los sensores ampliados durante el paso del sensor: medianas, y el último análisis del ritmo
// (que ya usa los últimos 30 latidos).
function summarizeExt(list) {
  const med = (k, f = (x) => x[k]) => { const v = list.map(f).filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
  const last = list.at(-1);
  return {
    temp: med('temp'), resp: med('rr'), rmssd: med('rmssd'), qtc: med('qtc'), eda: med('eda'),
    grip: Math.max(...list.map((x) => x.grip)), co2: med('co2'), dose: med('dose'),
    bpEst: { sys: med(null, (x) => x.bpEst.sys), dia: med(null, (x) => x.bpEst.dia) },
    rhythm: last.rhythm, ectopics: last.ectopics, ecgHr: last.ecgHr,
  };
}

function endCheck() {
  if (S.link?.kind === 'sim') S.link.setFinger(false);
  if (!S.check) return;
  clearInterval(S.check.timer);
  S.check.lock?.release?.().catch(() => {});
  S.check = null;
}

function finishCheck() {
  const c = S.check;
  const v = c.values;
  endCheck();
  const list = saved.history[c.uid] || [];
  const results = [];
  if (v.hr != null) {
    const r = classify('hr', v.hr);
    // la línea base personal puede subir a amarillo; el rojo solo lo dan los umbrales absolutos
    const p = assess({ bpm: v.hr, spo2: null }, { history: list.filter((h) => h.bpm), crew: S.person?.crew, lang: lang() });
    if (r.level === 0 && p.z != null && Math.abs(p.z) >= 2.5) {
      r.level = 1;
      r.reason = L(`${v.hr} lpm está en rango general, pero lejos de tu normal (${p.baseline.hr} lpm).`, `${v.hr} bpm is within the general range, but far from your normal (${p.baseline.hr} bpm).`);
    }
    results.push({ ...r, display: `${v.hr} ${L('lpm', 'bpm')}${v.manualHr ? ` (${L('manual', 'manual')})` : ''}` });
  }
  if (v.spo2 != null) results.push({ ...classify('spo2', v.spo2), display: `${v.spo2} %` });
  const x = v.ext;
  if (x) {
    if (x.rhythm) results.push({ ...classify('rhythm', x.rhythm), display: `${rhythmText(x.rhythm)}${x.ectopics ? ` · ${x.ectopics}` : ''}` });
    if (x.qtc != null) results.push({ ...classify('qtc', x.qtc), display: `${x.qtc} ms` });
    if (x.temp != null) results.push({ ...classify('temp', x.temp), display: `${fmt(x.temp, 1)} °C` });
    if (x.resp != null) results.push({ ...classify('resp', x.resp), display: `${x.resp} rpm` });
    // HRV: no hay umbral universal; solo se compara con la línea base de la persona
    const band = baselineBand(list.map((h) => h.rmssd));
    if (x.rmssd != null && band && x.rmssd < band.lo) {
      results.push({ id: 'hrv', name: L('Variabilidad cardiaca (HRV)', 'Heart rate variability (HRV)'), level: 1, dir: 'low', value: x.rmssd,
        reason: L(`RMSSD de ${x.rmssd} ms, muy por debajo de tu normal (${Math.round(band.med)} ms): señal de cansancio o estrés acumulado.`, `RMSSD of ${x.rmssd} ms, well below your normal (${Math.round(band.med)} ms): a sign of accumulated fatigue or stress.`),
        display: `${x.rmssd} ms` });
    }
  }
  if (v.bp) results.push({ ...classify('bp', v.bp), display: `${v.bp.sys}/${v.bp.dia} mmHg` });
  if (v.glucose != null) results.push({ ...classify('glucose', v.glucose), display: `${v.glucose} mg/dL${v.fasting ? L(' en ayunas', ' fasting') : ''}` });
  if (v.mind) results.push({ ...classify('mind', v.mind), display: `PHQ-2 ${v.mind.phq2}/6 · ${fmt(v.mind.sleep, 1)} h · ${L('estrés', 'stress')} ${v.mind.stress}/10` });
  const plan = actionPlan(results, envKey());
  const flags = v.flags || [];
  const overall = flags.length ? 2 : plan.worst;
  const entry = {
    at: Date.now(), env: envKey(), bpm: v.hr ?? null, spo2: v.spo2 ?? null, bp: v.bp || null, glucose: v.glucose ?? null,
    mind: v.mind || null, flags, selfHarm: !!v.selfHarm, overall, status: ['normal', 'watch', 'alert'][overall],
    ...(x ? { temp: x.temp, resp: x.resp, rmssd: x.rmssd, qtc: x.qtc, rhythm: x.rhythm, eda: x.eda, grip: x.grip } : {}),
    sim: S.link?.kind === 'sim' || !!S.status?.test,
  };
  if (results.length) { saved.history[c.uid] = [...list, entry].slice(-200); store.save(saved); }
  S.result = { results, plan, flags, selfHarm: !!v.selfHarm, overall, entry, ext: x || null, prev: list, explanation: null };
  vibrate(overall === 0 ? 60 : [80, 80, 80]);
  go('result');
}

/* ------------------------------------------------------- 5 resultado -- */
const LEVEL_TXT = new Proxy([], { get: (a, k) => (/^\d$/.test(k) ? t(`level.${k}`) : a[k]) });
const LEVEL_CLS = ['ok', 'warn', 'err'];

function result() {
  const { results, plan, flags, selfHarm, overall, entry } = S.result;
  const env = ENVIRONMENTS[entry.env];
  const node = el(`
    <section class="screen result">
      ${topbar()}
      <p class="kicker">${esc(S.person?.name || '')} · ${esc(env.name)} · ${new Date(entry.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</p>
      ${flags.length ? `<div class="emergency" role="alert"><b>${L('Señal de alarma', 'Warning sign')}</b><p>${L('Has marcado', 'You marked')}: ${esc(flags.join(', ').toLowerCase())}.</p>
        <p>${L('Avisa ahora a la tripulación y al oficial médico.', 'Alert the crew and the medical officer now.')} ${esc(env.ground)}</p>
        ${selfHarm || flags.some(isSelfHarm) ? `<p>${L('No te quedes solo. Habla con alguien de la tripulación ahora mismo. En la Tierra: 112 o 024.', 'Do not stay alone. Talk to someone in the crew right now. On Earth: call your local emergency number (112 in Europe, 911 in the US).')}</p>` : ''}</div>` : ''}
      <div class="verdict verdict--${LEVEL_CLS[overall]}"><span></span>${LEVEL_TXT[overall]}</div>
      <div class="ai-box">
        <div class="ai-box__head"><span class="ai-badge">${L('IA', 'AI')}</span><b>${L('Lo que significa', 'What it means')}</b></div>
        <p class="ai-text" data-live="ai">${L('Preparando la explicación…', 'Preparing the explanation…')}</p>
        <small>${L('El semáforo lo deciden umbrales fijos; la IA solo lo explica.', 'Fixed thresholds decide the traffic light; the AI only explains it.')}</small>
      </div>
      <h3 class="section-t">${L('Tus medidas', 'Your measurements')}</h3>
      <ul class="results">${results.map((r) => `
        <li class="lvl-${LEVEL_CLS[r.level]}"><span class="dot dot--${LEVEL_CLS[r.level]}"></span>
          <div><b>${esc(r.name)}</b><small>${esc(r.reason)}</small></div><em>${esc(r.display)}</em></li>`).join('') || `<li class="empty">${L('No se ha medido nada.', 'Nothing was measured.')}</li>`}</ul>
      ${baselineSection(S.result)}
      ${extSection(S.result.ext)}


      ${overall > 0 ? `<div class="plan">
        <h3>${L('Qué hacer ahora', 'What to do now')}</h3>
        <ul>${plan.now.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3>${L('Tripulación', 'Crew')}</h3><p>${esc(plan.crew)}</p>
        <h3>${L('Cirujano de vuelo', 'Flight surgeon')}</h3><p>${esc(plan.surgeon)}</p>
        ${plan.evac || flags.length ? `<h3>${L('Si empeora', 'If it gets worse')}</h3><p>${esc(env.evac)}</p>` : ''}
        <p class="fine">${L('Comunicación con Tierra en este entorno', 'Communication with Earth in this environment')}: ${esc(env.delay)}.</p>
      </div>` : `<p class="lead">${esc(plan.crew)} ${esc(plan.surgeon)}</p>`}

      ${(() => { const a = spaceNow(); return a && a.level > 0 ? `<div class="plan plan--space"><h3>${L('Clima espacial', 'Space weather')} (DONKI · NASA)</h3><p><b>${esc(a.headline)}.</b> ${esc(a.reasons.filter((r) => r.level > 0).map((r) => r.text).join(' '))}</p><ul>${a.actions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="fine">${L('Es un riesgo del entorno: no cambia el color de tu chequeo.', 'This is an environmental risk: it does not change the colour of your check-up.')}</p></div>` : ''; })()}
      ${entry.sim ? `<p class="note">${L('Chequeo hecho con datos simulados.', 'Check-up done with simulated data.')}</p>` : ''}
      <div class="row">
        <button class="btn btn--dark" data-act="psy">${L('Hablar con Paze', 'Talk to Paze')}</button>
        <button class="btn btn--line" data-act="history">${L('Historial', 'History')}</button>
      </div>
      <button class="btn btn--line btn--block" data-act="report">${L('Compartir informe con el cirujano de vuelo', 'Share report with the flight surgeon')}</button>
      <button class="btn btn--ghost btn--block" data-act="home">${L('Volver al inicio', 'Back to home')}</button>
      <p class="fine">${L('XPaze no diagnostica. Las cifras de referencia y sus fuentes están en la tabla médica del proyecto.', 'XPaze does not diagnose. Reference values and their sources are in the project’s medical table.')}</p>
    </section>`);
  node.querySelector('[data-act="psy"]').onclick = () => openChat();
  node.querySelector('[data-act="history"]').onclick = () => go('history');
  node.querySelector('[data-act="home"]').onclick = () => go('home');
  node.querySelector('[data-act="report"]').onclick = () => shareReport(reportText({ person: S.person, entry: S.result.entry, results: S.result.results, plan: S.result.plan, insights: trendInsights(saved.history[S.person?.uid] || []) }) + (S.result.explanation ? `\n\n${L('Explicación (IA)', 'Explanation (AI)')}:\n${S.result.explanation}` : ''));
  wire(node);
  explain(node);
  return node;
}

// «Tú contra ti»: el valor de hoy frente a la banda de tu normal (mediana ± 2,5 desviaciones robustas).
function baselineSection(R) {
  const prev = (R.prev || []).slice(-20);
  const labels = { normal: L('tu normal', 'your normal'), today: L('hoy', 'today') };
  const charts = [
    [L('Pulso en reposo', 'Resting heart rate'), prev.map((h) => h.bpm), R.entry.bpm, L('lpm', 'bpm'), 0],
    ['HRV · RMSSD', prev.map((h) => h.rmssd), R.entry.rmssd, 'ms', 0],
    [L('Temperatura', 'Temperature'), prev.map((h) => h.temp), R.entry.temp, '°C', 1],
  ].filter(([, v, today]) => today != null && baselineBand(v));
  if (!charts.length) return '';
  return `<h3 class="section-t">${L('Tú frente a tu normal', 'You versus your normal')}</h3>
    <p class="fine">${L('Los monitores habituales usan los mismos umbrales para todo el mundo. XPaze además te compara contigo: la banda es tu normal, calculada de tus chequeos anteriores.', 'Typical monitors use the same thresholds for everyone. XPaze also compares you with yourself: the band is your normal, computed from your previous check-ups.')}</p>
    <div class="blcharts">${charts.map(([t, v, today, u, d]) => {
      const b = baselineBand(v);
      const out = today < b.lo || today > b.hi;
      return `<figure class="blc ${out ? 'blc--out' : ''}"><figcaption><b>${t}</b><span>${out ? L('fuera de tu normal', 'outside your normal') : L('dentro de tu normal', 'within your normal')}</span></figcaption>
        ${baselineChart(v, today, { labels, unit: u, fmt: (n) => fmt(n, d) })}
        <small>${L('Tu normal', 'Your normal')}: ${fmt(b.lo, d)}–${fmt(b.hi, d)} ${u} · ${L('hoy', 'today')}: <b>${fmt(today, d)} ${u}</b> · ${b.n} ${L('chequeos', 'check-ups')}</small></figure>`;
    }).join('')}</div>`;
}

// Lecturas de la estación v2 que no deciden el semáforo (información y contexto).
function extSection(x) {
  if (!x) return '';
  const co2 = co2Level(x.co2);
  const rows = [
    [L('Tensión estimada sin manguito (PTT)', 'Cuffless BP estimate (PTT)'), `~${x.bpEst.sys}/${x.bpEst.dia} mmHg`, L('Experimental: no cuenta para el semáforo.', 'Experimental: not used for the traffic light.'), null],
    [L('Actividad electrodérmica (estrés)', 'Electrodermal activity (stress)'), `${fmt(x.eda, 1)} µS`, x.eda >= 8 ? L('Alta: el cuerpo está en modo alerta.', 'High: the body is in alert mode.') : L('En calma.', 'Calm.'), x.eda >= 8 ? 1 : 0],
    [L('Fuerza de agarre', 'Grip strength'), `${x.grip} kg`, L('Vigila la pérdida de músculo en microgravedad (riesgo HRP).', 'Tracks muscle loss in microgravity (HRP risk).'), null],
    [L('CO₂ de cabina', 'Cabin CO₂'), `${fmt(x.co2, 1)} mmHg`, [L('Dentro del límite de NASA-STD-3001 (≤ 3 mmHg).', 'Within the NASA-STD-3001 limit (≤ 3 mmHg).'), L('Cerca del límite: puede dar dolor de cabeza.', 'Close to the limit: it can cause headaches.'), L('Por encima del límite de NASA-STD-3001 [V2 6004]: avisa a la tripulación y revisa el depurador.', 'Above the NASA-STD-3001 limit [V2 6004]: alert the crew and check the scrubber.')][co2], co2],
    [L('Dosímetro', 'Dosimeter'), `${x.dose} µSv/h`, x.dose >= 200 ? L('Muy alto: ve al refugio de radiación.', 'Very high: go to the radiation shelter.') : x.dose >= 60 ? L('Alto: el nivel de un viaje a Marte.', 'High: the level of a trip to Mars.') : L('Normal para órbita baja.', 'Normal for low Earth orbit.'), x.dose >= 200 ? 2 : x.dose >= 60 ? 1 : 0],
  ];
  return `<h3 class="section-t">${L('Más datos de la estación v2', 'More station v2 data')} <span class="pill-sim">${L('simulados', 'simulated')}</span></h3>
    <ul class="results results--info">${rows.map(([n, val, why, l]) => `<li class="${l == null ? '' : `lvl-${LEVEL_CLS[l]}`}"><span class="dot dot--${l == null ? 'off' : LEVEL_CLS[l]}"></span><div><b>${n}</b><small>${why}</small></div><em>${val}</em></li>`).join('')}</ul>
    <p class="fine">${L('El aire y la radiación son riesgos del entorno: se muestran, pero no cambian el color de tu chequeo.', 'Air and radiation are environmental risks: they are shown, but they do not change the colour of your check-up.')}</p>`;
}

async function explain(node) {
  const R = S.result;
  const out = node.querySelector('[data-live="ai"]');
  if (R.explanation) { out.textContent = R.explanation; return; }
  const env = ENVIRONMENTS[R.entry.env];
  try {
    R.explanation = await streamAI('explicar', { check: {
      person: S.person?.name, environment: `${env.name} (${env.gravity}; ${L('retardo con Tierra', 'delay to Earth')} ${env.delay})${spaceNow()?.level ? `. Clima espacial: ${spaceNow().headline}` : ''}`,
      overall: R.overall, simulated: R.entry.sim, flags: R.flags,
      results: R.results.map((r) => ({ name: r.name, display: r.display, level: r.level, reason: r.reason })),
      station: R.ext ? { eda: R.ext.eda, grip: R.ext.grip, co2mmHg: R.ext.co2, doseUSvH: R.ext.dose, cufflessBP: R.ext.bpEst } : undefined,
      plan: { now: R.plan.now, crew: R.plan.crew, surgeon: R.plan.surgeon, evac: R.plan.evac },
    }, lang: lang() }, (t) => { out.textContent = t; });
  } catch {
    out.textContent = L('La IA no está disponible ahora mismo (sin conexión con el servidor). El semáforo y la guía de esta pantalla son válidos igualmente.', 'The AI is not available right now (no connection to the server). The traffic light and the guidance on this screen are still valid.');
    out.classList.add('is-off');
  }
}

/* ---------------------------------------------------- psicóloga (IA) -- */
// Contexto único para la psicóloga (texto y voz): todo lo que la app sabe de la persona.
// Nunca incluye el diario de Mente.
function mindSummary(uid) {
  try {
    const demo = JSON.parse(localStorage.getItem('xpaze-demo-v1') || 'null');
    const crew = crewByUid[uid];
    if (!demo?.psych || !crew || !demo.psych[crew.id]) return [];
    const r = psychAnalyze({ psych: demo.psych, missionDay: demo.day }, crew.id, { day: demo.day });
    const tr = (k, vars = {}) => (psychStrings.es[k] || k).replace(/\{(\w+)\}/g, (_, v) => (vars[v] ?? ''));
    return [`estado ${tr(r.label)}`, ...r.factors.map((f) => tr(f.key, f.vars))];
  } catch { return []; }
}

/* ------------------------------------------------ Samsung Health (XPaze Link) -- */
// La app Android XPaze Link sube lo que Samsung Health sincroniza en Health Connect
// bajo un código de 8 caracteres. Aquí se vincula ese código y se leen los datos.
S.health = null;
let healthTimer = 0;

// En un entrenamiento el reloj mide cada segundo: la media de todas las muestras se dispara.
// La mediana de las medias horarias refleja mejor el día.
function hrTypical(h) {
  const v = (h?.heartRate?.hourly || []).map((x) => x.bpm).sort((a, b) => a - b);
  if (!v.length) return h?.heartRate?.avg ?? null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}
const hhmm = (t) => (t ? new Date(t).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '');

function healthBox() {
  const code = saved.healthCodes[S.person?.uid];
  if (!code) {
    return `<p class="fine">${L('Instala XPaze Link en el móvil emparejado con el reloj y escribe aquí su código.', 'Install XPaze Link on the phone paired with the watch and enter its code here.')}</p>
      <div class="compose"><input class="code-in" maxlength="9" placeholder="${L('Código (8 caracteres)', 'Code (8 characters)')}" autocapitalize="characters" autocomplete="off" aria-label="${L('Código de XPaze Link', 'XPaze Link code')}"/><button class="btn btn--dark" data-act="hlink">${L('Vincular', 'Link')}</button></div>
      <p class="fine">${L('Al vincular aceptas que XPaze lea los datos de salud de tu reloj (se guardan 48 h como máximo, sin tu nombre) y los use con la IA.', 'By linking you agree that XPaze reads your watch health data (kept for 48 h at most, without your name) and uses it with the AI.')} <a href="/legal/#${L('privacidad', 'privacy')}">${L('Privacidad', 'Privacy')}</a></p>`;
  }
  const h = S.health;
  if (!h) return `<p class="fine">${L('Buscando datos del código', 'Looking for data from code')} ${esc(code)}…</p><button class="chip-btn" data-act="hunlink">${L('Desvincular', 'Unlink')}</button>`;
  if (h.error) return `<p class="fine">${esc(h.error)}</p><button class="chip-btn" data-act="hunlink">${L('Cambiar código', 'Change code')}</button>`;
  const ago = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? L('ahora', 'just now') : m < 60 ? L(`hace ${m} min`, `${m} min ago`) : L(`hace ${Math.round(m / 60)} h`, `${Math.round(m / 60)} h ago`); };
  const tiles = [
    [L('Pulso', 'Pulse'), h.heartRate?.last, L('lpm', 'bpm'), h.heartRate && L(`a las ${hhmm(h.heartRate.lastAt)} · típico ${hrTypical(h)}`, `at ${hhmm(h.heartRate.lastAt)} · typical ${hrTypical(h)}`)],
    [L('En reposo', 'Resting'), h.restingHeartRate?.bpm, L('lpm', 'bpm')],
    ['HRV', h.hrv?.rmssdMs != null ? Math.round(h.hrv.rmssdMs) : null, 'ms'],
    ['SpO₂', h.spo2?.pct != null ? Math.round(h.spo2.pct) : null, '%'],
    [L('Sueño', 'Sleep'), h.sleep?.hours, 'h'],
    [L('Pasos hoy', 'Steps today'), h.stepsToday, ''],
  ].filter(([, v]) => v != null);
  return `<div class="tiles tiles--3">${tiles.map(([n, v, u, sub]) => `<div class="tile tile--sm"><small>${n}</small><b>${esc(String(v))}</b><em>${u}</em>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`).join('') || `<p class="fine">${L('Aún sin datos en Health Connect.', 'No data in Health Connect yet.')}</p>`}</div>
    <p class="fine">${L('Datos reales del reloj vía Samsung Health · recibidos', 'Real watch data via Samsung Health · received')} ${ago(h.receivedAt)} · <button class="linkish" data-act="hunlink">${L('desvincular', 'unlink')}</button></p>`;
}

async function refreshHealth() {
  clearTimeout(healthTimer);
  const code = saved.healthCodes[S.person?.uid];
  if (!code) return;
  try {
    const r = await fetch(new URL(`api/salud/${code}`, location.href), { cache: 'no-store' });
    S.health = r.ok ? await r.json() : { error: r.status === 404 ? L('Todavía no hay datos con ese código. Abre XPaze Link en el móvil y pulsa «Leer y enviar ahora».', 'No data with that code yet. Open XPaze Link on the phone and tap “Read and send now”.') : L(`Error ${r.status} al leer los datos.`, `Error ${r.status} reading the data.`) };
  } catch {
    S.health = { error: L('Sin conexión con el servidor de XPaze.', 'No connection to the XPaze server.') };
  }
  const box = app.querySelector('[data-live="shealth"]');
  if (box) { box.innerHTML = healthBox(); wireHealth(box); }
  healthTimer = setTimeout(refreshHealth, 60_000);
}

function wireHealth(root) {
  root.querySelector('[data-act="hlink"]')?.addEventListener('click', () => {
    const v = root.querySelector('.code-in').value.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!/^[2-9A-HJ-NP-Z]{8}$/.test(v)) { toast(L('El código tiene 8 caracteres, como en XPaze Link.', 'The code has 8 characters, as shown in XPaze Link.')); return; }
    saved.healthCodes[S.person?.uid] = v; store.save(saved); S.health = null;
    root.innerHTML = healthBox(); wireHealth(root); refreshHealth();
  });
  root.querySelectorAll('[data-act="hunlink"]').forEach((b) => b.addEventListener('click', () => {
    delete saved.healthCodes[S.person?.uid]; store.save(saved); S.health = null; clearTimeout(healthTimer);
    root.innerHTML = healthBox(); wireHealth(root);
  }));
}

function healthContext() {
  const h = S.health;
  if (!h || h.error) return null;
  return Object.fromEntries(Object.entries({
    'Pulso último (lpm)': h.heartRate ? `${h.heartRate.last} a las ${hhmm(h.heartRate.lastAt)}` : null, 'Pulso típico del día (mediana por horas)': hrTypical(h), 'Pulso mín–máx 24 h (el máximo suele ser de ejercicio)': h.heartRate ? `${h.heartRate.min}–${h.heartRate.max}` : null,
    'Pulso en reposo': h.restingHeartRate?.bpm, 'HRV RMSSD (ms)': h.hrv?.rmssdMs != null ? Math.round(h.hrv.rmssdMs) : null,
    'SpO₂ (%)': h.spo2?.pct != null ? Math.round(h.spo2.pct) : null, 'Sueño de anoche (h)': h.sleep?.hours,
    'Respiración (rpm)': h.respiratoryRate?.rpm != null ? Math.round(h.respiratoryRate.rpm * 10) / 10 : null,
    'Temperatura (°C)': h.bodyTemperature?.c, 'Pasos hoy': h.stepsToday,
  }).filter(([, v]) => v != null));
}

/* ------------------------------------------------ clima espacial (DONKI) -- */
S.space = null;
let spaceAt = 0;
async function loadSpace() {
  if (S.space && Date.now() - spaceAt < 10 * 60_000) return;
  spaceAt = Date.now();
  try {
    const r = await fetch(new URL('api/espacio', location.href), { cache: 'no-store' });
    S.space = r.ok ? await r.json() : { error: true };
  } catch { S.space = { error: true }; }
  const box = app.querySelector('[data-live="space"]');
  if (box) box.innerHTML = spaceBox();
}
const spaceNow = () => (S.space && !S.space.error ? assessSpace(S.space.events, envKey(), Date.now(), lang()) : null);

function spaceBox() {
  if (!S.space) return `<p class="fine">${L('Consultando los avisos de clima espacial…', 'Checking space-weather alerts…')}</p>`;
  if (S.space.error) return `<p class="fine">${L('No se han podido leer los avisos de clima espacial ahora mismo.', 'Could not read the space-weather alerts right now.')}</p>`;
  const a = spaceNow();
  const ago = Math.round((Date.now() - Date.parse(S.space.fetchedAt)) / 60_000);
  return `<div class="spacecard lvl-${LEVEL_CLS[a.level]}">
    <p class="spacecard__head"><span class="dot dot--${LEVEL_CLS[a.level]}"></span><b>${esc(a.headline)}</b></p>
    ${a.reasons.slice(0, 3).map((r) => `<p class="fine">${esc(r.text)}</p>`).join('')}
    ${a.actions.length ? `<ul>${a.actions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="fine">${L('Entorno', 'Environment')}: ${esc(ENVIRONMENTS[envKey()].name)}. ${L('Avisos de los últimos 7 días, detectados desde la órbita terrestre', 'Alerts from the last 7 days, detected from Earth orbit')}${envKey() === 'transit' ? L('; en tránsito la exposición real depende de la posición de la nave', '; in transit the real exposure depends on where the ship is') : ''}. ${L('Actualizado hace', 'Updated')} ${ago < 60 ? `${Math.max(ago, 1)} min` : `${Math.round(ago / 60)} h`}${L('', ' ago')}${S.space.stale ? L(' (copia anterior)', ' (cached copy)') : ''}.</p>
  </div>`;
}

/* ------------------------------------------------ memoria de Paze (solo en este dispositivo) -- */
async function rememberSession(uid, messages) {
  messages = messages.filter((m) => m.content !== OPEN_TOKEN);
  if (messages[0]?.role === 'assistant') messages = [{ role: 'user', content: '(Paze abre la sesión)' }, ...messages];
  if (!uid || messages.filter((m) => m.role === 'user').length < 2) return;
  try {
    const r = await fetch(new URL('api/psicologa/resumen', location.href), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, lang: lang() }),
    });
    if (!r.ok) return;
    const { summary, facts = [] } = await r.json();
    if (!summary) return;
    saved.memory[uid] = [...(saved.memory[uid] || []), { at: Date.now(), summary }].slice(-6);
    const known = saved.facts[uid] || [];
    for (const f of facts) if (f && !known.some((k) => k.toLowerCase() === f.toLowerCase())) known.push(f);
    saved.facts[uid] = known.slice(-20);
    store.save(saved);
    toast(L('Paze recordará lo que habéis hablado.', 'Paze will remember what you talked about.'));
  } catch { /* sin memoria esta vez */ }
}

// Lectura previa: los datos ya interpretados en frases, para que Paze no reciba números sueltos.
function buildInsights() {
  const out = [];
  const h = S.health && !S.health.error ? S.health : null;
  const env = ENVIRONMENTS[envKey()];
  const hourNow = new Date().getHours();
  if (h?.sleep?.hours != null) {
    const sh = h.sleep.hours;
    out.push(`Sueño de anoche (reloj): ${sh} h ${sh < 6 ? '— por debajo de lo recomendado (7 h o más); puede pesar en el ánimo, la paciencia y la atención' : sh < 7 ? '— algo corto' : '— suficiente'}.`);
  }
  if (h?.heartRate) {
    const typ = hrTypical(h);
    const rest = h.restingHeartRate?.bpm;
    out.push(`Pulso del día (reloj): típico ${typ} lpm${rest ? `, en reposo ${rest} lpm` : ''}, último ${h.heartRate.last} lpm a las ${hhmm(h.heartRate.lastAt)}; máximo ${h.heartRate.max} (probablemente ejercicio).`);
    if (rest && typ - rest > 25) out.push('El pulso típico del día está bastante por encima del de reposo: día activo o tensión sostenida; conviene preguntar, no suponer.');
  }
  if (h?.hrv?.rmssdMs != null) out.push(`Variabilidad cardiaca (HRV) más reciente: ${Math.round(h.hrv.rmssdMs)} ms; una HRV baja sostenida se asocia a estrés o cansancio.`);
  if (h?.spo2?.pct != null) out.push(`Oxígeno (reloj): ${Math.round(h.spo2.pct)} %${h.spo2.pct < 95 ? ' — algo bajo, revisar con la estación' : ''}.`);
  if (h?.stepsToday != null) out.push(`Actividad: ${h.stepsToday.toLocaleString('es-ES')} pasos hoy${h.stepsToday > 12000 ? ' (día muy activo: puede haber cansancio físico)' : h.stepsToday < 3000 ? ' (día muy sedentario)' : ''}.`);
  const v = S.vitals;
  if (v) {
    const cab = cabinLevel(v);
    if (cab != null) out.push(`Aire de cabina: ${v.temperature != null ? `${v.temperature.toFixed(1)} °C` : ''}${v.humidity != null ? `, ${Math.round(v.humidity)} % de humedad` : ''} — ${['dentro de los límites de NASA-STD-3001', 'fuera del rango de confort (puede influir en el descanso y el humor)', 'fuera de los límites de salud'][cab]}.`);
  }
  out.push(`Entorno: ${env.name} (${env.gravity}); un mensaje a Tierra tarda ${env.delay}: el apoyo humano de Tierra no es inmediato.`);
  const sp = spaceNow();
  if (sp) out.push(`Clima espacial real (DONKI, NASA): ${sp.headline.toLowerCase()}${sp.level ? ` — ${sp.reasons.filter((r) => r.level > 0).map((r) => r.text).join(' ')} Una alerta de radiación puede generar tensión o sensación de encierro; es normal` : ''}.`);
  const r = S.result;
  if (r) out.push(`Último chequeo: ${LEVEL_TXT[r.overall]}${r.results.filter((x) => x.level > 0).length ? ` por ${r.results.filter((x) => x.level > 0).map((x) => x.name.toLowerCase()).join(', ')}` : ''}.`);
  const hist = (saved.history[S.person?.uid] || []).filter((x) => x.mind);
  if (hist.length >= 3) {
    const last3 = hist.slice(-3).map((x) => x.mind.sleep);
    if (last3.every((x) => x < 7)) out.push(`Tres chequeos seguidos con poco sueño (${last3.join(', ')} h): patrón sostenido, no un mal día.`);
  }
  out.push(`Ahora es ${hourNow >= 22 || hourNow < 6 ? 'de noche: prioriza el descanso y no abras temas largos' : hourNow < 12 ? 'por la mañana' : hourNow < 20 ? 'por la tarde' : 'última hora de la tarde'}.`);
  return out;
}

function buildContext() {
  const p = S.person;
  const env = ENVIRONMENTS[envKey()];
  const r = S.result;
  const hist = (saved.history[p?.uid] || []).slice(-14);
  const COLOR = ['verde', 'amarillo', 'rojo'];
  const day = (t) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const v = S.vitals, w = S.watch;
  const live = v ? Object.fromEntries(Object.entries({
    'Pulso (lpm)': v.quality === 'good' ? v.bpm : null, 'SpO₂ (%)': v.quality === 'good' ? v.spo2 : null,
    'Señal del sensor': v.quality, 'Cabina °C': v.temperature != null ? Math.round(v.temperature * 10) / 10 : null,
    'Humedad %': v.humidity != null ? Math.round(v.humidity) : null, 'Presión hPa': v.pressure != null ? Math.round(v.pressure) : null,
  }).filter(([, x]) => x != null)) : null;
  const watch = w ? Object.fromEntries(Object.entries({ 'Pulso del reloj': w.bpm, 'Piel °C': w.skin, 'SpO₂ del reloj': w.spo2, 'Batería %': w.battery }).filter(([, x]) => x != null)) : null;
  return {
    name: p?.name, role: p?.role,
    environment: `${env.name} (${env.gravity}; ${L('retardo con Tierra', 'delay to Earth')} ${env.delay})`,
    status: r ? LEVEL_TXT[r.overall] : null,
    factors: r ? r.results.filter((x) => x.level > 0).map((x) => x.reason) : [],
    lastCheck: r ? [...r.results.map((x) => `${x.name}: ${x.display} → ${COLOR[x.level]} (${x.reason})`), ...(r.flags.length ? [`Señales de alarma marcadas: ${r.flags.join(', ')}`] : [])] : [],
    lastCheckAt: r ? new Date(r.entry.at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null,
    plan: r && r.overall > 0 ? [...r.plan.now, r.plan.crew, r.plan.surgeon] : [],
    history: hist.map((h) => [
      day(h.at), h.bpm != null && `pulso ${h.bpm}`, h.bp && `tensión ${h.bp.sys}/${h.bp.dia}`, h.glucose != null && `glucosa ${h.glucose}`,
      h.mind && `sueño ${h.mind.sleep} h, PHQ-2 ${h.mind.phq2}, estrés ${h.mind.stress}`, h.rmssd != null && `HRV ${h.rmssd} ms`, h.temp != null && `temp ${h.temp} °C`, h.rhythm && h.rhythm !== 'sinus' && `ritmo ${h.rhythm}`, `→ ${COLOR[h.overall ?? 0]}`,
    ].filter(Boolean).join(', ')),
    live, watch, samsung: healthContext(),
    station: S.ext ? { 'ECG': `${S.ext.rhythm || '—'}${S.ext.ectopics ? `, ${S.ext.ectopics} extrasístoles` : ''}`, 'Pulso ECG': S.ext.ecgHr, 'HRV RMSSD (ms)': S.ext.rmssd, 'QTc (ms)': S.ext.qtc, 'Temperatura corporal': S.ext.temp, 'Respiración (rpm)': S.ext.rr, 'EDA (µS, estrés)': S.ext.eda, 'Agarre (kg)': S.ext.grip, 'CO₂ cabina (mmHg)': S.ext.co2, 'Radiación (µSv/h)': S.ext.dose, 'Situación simulada': S.link?.scenario } : null,
    insights: [...buildInsights(), ...trendInsights(saved.history[p?.uid] || []).map((i) => `Tendencia: ${i.text}`)],
    about: saved.about[p?.uid] || '',
    medical: medicalOf(p?.uid),
    facts: saved.facts[p?.uid] || [],
    memory: (saved.memory[p?.uid] || []).map((m) => `${new Date(m.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}: ${m.summary}`),
    localTime: new Date().toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' }),
    profile: p?.real ? 'real' : 'simulado',
    today: r?.entry.mind ? { 'Horas de sueño': r.entry.mind.sleep, 'Estrés (0–10)': r.entry.mind.stress, 'PHQ-2 (0–6)': r.entry.mind.phq2 } : {},
    mind: mindSummary(p?.uid),
    simulated: !p?.real && (S.link?.kind === 'sim' || !!S.status?.test || hist.some((h) => h.sim)),
  };
}

function openChat() {
  S.chat ||= { uid: S.person?.uid, history: [] };
  if (S.chat.uid !== S.person?.uid) S.chat = { uid: S.person?.uid, history: [] };
  go('chat');
}

const ORB_STATES = {
  es: { idle: 'Pulsa para hablar', connecting: 'Conectando…', listening: 'Te escucho', user: 'Te escucho…', thinking: 'Pensando…', speaking: 'Hablando', error: 'No se pudo conectar' },
  en: { idle: 'Tap to talk', connecting: 'Connecting…', listening: 'I’m listening', user: 'I’m listening…', thinking: 'Thinking…', speaking: 'Speaking', error: 'Could not connect' },
};
const ORB_STATE = new Proxy({}, { get: (_, k) => ORB_STATES[lang()][k] });

function chat() {
  const C = S.chat;
  saved.chatMode ||= 'voz';
  const voice = saved.chatMode === 'voz';
  const node = el(`
    <section class="screen chatv">
      ${topbar()}
      <div class="chat-top">
        <p class="kicker">${L('Paze · psicóloga de a bordo (IA)', 'Paze · on-board psychologist (AI)')}</p>
        <button class="chip-btn chip-btn--breath" data-act="breathe">${L('Respirar 1 min', 'Breathe 1 min')}</button>
        <div class="seg"><button data-mode="voz" class="${voice ? 'is-on' : ''}">${L('Voz', 'Voice')}</button><button data-mode="texto" class="${voice ? '' : 'is-on'}">${L('Texto', 'Text')}</button></div>
      </div>
      <p class="ai-notice">${t('ai.notice')}</p>
      <div class="crisis-box" role="alert" hidden><b>${L('Si estás en peligro, no esperes.', 'If you are in danger, do not wait.')}</b><p>${L('Habla ahora con el oficial médico o el comandante. En la Tierra: 112, o 024 en España (gratis, 24 h).', 'Talk to the medical officer or the commander now. On Earth: your local emergency number (112 in Europe; 024 in Spain, free, 24/7).')}</p></div>
      ${voice ? `
      <div class="voice">
        <button class="vorb vorb--paze" data-state="idle" aria-label="${L('Empezar a hablar con Paze, la psicóloga de a bordo', 'Start talking to Paze, the on-board psychologist')}">
          <span class="paze-host"></span>
        </button>
        <p class="vorb__label" aria-live="polite">${ORB_STATE.idle}</p>
        <label class="noisy"><input type="checkbox" data-act="noisy" ${saved.noisy ? 'checked' : ''}/> <span>${L('Sala con ruido: mantén pulsado el orbe para hablar', 'Noisy room: hold the orb to talk')}</span></label>
        <div class="captions" aria-live="polite"><p class="cap cap--me"></p><p class="cap cap--ai"></p></div>
        <div class="row voice__ctl" hidden>
          <button class="btn btn--line" data-act="mute">${L('Silenciar micro', 'Mute mic')}</button>
          <button class="btn btn--dark" data-act="hang">${L('Colgar', 'Hang up')}</button>
        </div>
        <p class="fine voice__note">${micAvailable() ? L('Conoce tus datos de XPaze (chequeos, historial, constantes y Mente) para entenderte mejor; nunca tu diario. No se guarda nada de la conversación.', 'Paze knows your XPaze data (check-ups, history, vitals and Mind) to understand you better, never your journal. The conversation is not stored.') : L('Este navegador no deja usar el micrófono aquí (hace falta https). Usa el modo texto.', 'This browser does not allow the microphone here (https is required). Use text mode.')}</p>
      </div>` : `
      <div class="chat-list" role="log" aria-live="polite">
        ${C.history.filter((m) => m.content !== OPEN_TOKEN).map((m) => `<div class="msg msg--${m.role === 'user' ? 'me' : 'ai'}"><p>${esc(m.content)}</p></div>`).join('')}
      </div>
      <div class="chips-row">${L(['Últimamente duermo fatal', 'Me siento lejos de todos', 'He discutido con un compañero'], ['I’ve been sleeping badly lately', 'I feel far from everyone', 'I had an argument with a crewmate']).map((s) => `<button class="chip-btn" data-say="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <div class="compose"><textarea rows="2" maxlength="2000" placeholder="${L('Escribe lo que quieras contar…', 'Write whatever you want to share…')}" aria-label="${L('Mensaje', 'Message')}"></textarea><button class="btn btn--dark" data-act="send">${L('Enviar', 'Send')}</button></div>
      <p class="fine">${L('Es una IA de apoyo: no diagnostica ni receta. Al salir, guarda en este dispositivo un resumen breve para recordar la sesión; nunca tu diario.', 'A support AI: it does not diagnose or prescribe. When you leave, it saves a short summary on this device to remember the session, never your journal.')}</p>`}
      ${memoryBox()}
      <button class="btn btn--ghost btn--block" data-act="home">${L('Volver', 'Back')}</button>
    </section>`);
  const crisis = node.querySelector('.crisis-box');
  const flagCrisis = (text) => { if (CRISIS.test(text)) crisis.hidden = false; };
  node.querySelector('[data-act="forget"]')?.addEventListener('click', () => {
    if (!confirm(L('¿Borrar lo que Paze recuerda de tus sesiones anteriores?', 'Delete what Paze remembers from your previous sessions?'))) return;
    delete saved.memory[S.person?.uid]; delete saved.facts[S.person?.uid]; store.save(saved); render();
  });
  node.querySelector('[data-act="medical"]')?.addEventListener('input', (e) => {
    saved.medical[S.person?.uid] = e.target.value.slice(0, 2000); store.save(saved);
  });
  node.querySelector('[data-act="about"]')?.addEventListener('input', (e) => {
    saved.about[S.person?.uid] = e.target.value.slice(0, 1500); store.save(saved);
  });
  node.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === saved.chatMode) return;
    S.voice?.stop();
    saved.chatMode = b.dataset.mode; store.save(saved); render();
  }));
  node.querySelector('[data-act="home"]').onclick = () => { S.voice?.stop(); go(S.result ? 'result' : 'home'); };
  wire(node);
  node.querySelector('[data-act="breathe"]').onclick = () => startBreathing({ onDone: voice ? null : (msg) => S.chatAsk?.(msg) });
  if (voice) wireVoice(node, flagCrisis);
  else { wireText(node, C, flagCrisis); openSession(node, C); }
  return node;
}

// Paze abre la sesión: un saludo con una pregunta concreta basada en los datos de la persona.
const OPEN_TOKEN = '__inicio__';
const staticGreeting = () => `${L('Hola', 'Hi')}${S.person ? `, ${S.person.name.split(' ')[0]}` : ''}. ${L('Soy Paze, la psicóloga de a bordo. Para empezar: ¿cómo has dormido esta noche?', 'I’m Paze, the on-board psychologist. To start: how did you sleep last night?')}`;
async function openSession(node, C) {
  if (C.history.length || C.opening) { if (S.pendingSay && !C.opening) { const m = S.pendingSay; S.pendingSay = null; setTimeout(() => S.chatAsk?.(m), 50); } return; }
  C.opening = true;
  const list = node.querySelector('.chat-list');
  const send = node.querySelector('[data-act="send"]');
  const out = el('<div class="msg msg--ai is-typing"><p></p></div>');
  list.append(out);
  if (send) send.disabled = true;
  const first = { role: 'user', content: OPEN_TOKEN };
  let reply;
  try {
    reply = await streamAI('psicologa', { messages: [first], context: buildContext(), lang: lang() }, (t) => { out.firstChild.textContent = t; });
  } catch {
    reply = staticGreeting();
    out.firstChild.textContent = reply;
  }
  if (S.chat === C && !C.history.length) C.history.push(first, { role: 'assistant', content: reply });
  out.classList.remove('is-typing');
  if (send) send.disabled = false;
  C.opening = false;
  if (S.pendingSay) { const m = S.pendingSay; S.pendingSay = null; S.chatAsk?.(m); }
}

function memoryBox() {
  const uid = S.person?.uid;
  const mem = saved.memory[uid] || [];
  const facts = saved.facts[uid] || [];
  return `<details class="memory"><summary>${L('Lo que Paze sabe de ti', 'What Paze knows about you')}${mem.length || facts.length ? L(` (${facts.length} datos · ${mem.length} sesiones)`, ` (${facts.length} facts · ${mem.length} sessions)`) : ''}</summary>
    <label class="about"><span>${L('Mi historial médico: antecedentes, medicación, alergias, operaciones, hábitos…', 'My medical history: conditions, medication, allergies, surgery, habits…')}</span>
      <textarea rows="3" maxlength="2000" data-act="medical" placeholder="${L('Ej.: asma leve con inhalador; tomo melatonina; alergia a la penicilina.', 'E.g. mild asthma with an inhaler; I take melatonin; penicillin allergy.')}">${esc(medicalOf(uid))}</textarea></label>
    <label class="about"><span>${L('Sobre mí (opcional): cómo prefieres que te hable, qué te ayuda, qué te preocupa…', 'About me (optional): how you like to be spoken to, what helps you, what worries you…')}</span>
      <textarea rows="3" maxlength="1500" data-act="about" placeholder="${L('Ej.: prefiero que vaya al grano; me ayuda salir a correr; estos días me preocupa la presentación.', 'E.g. I prefer you get to the point; running helps me; I am worried about the presentation these days.')}">${esc(saved.about[uid] || '')}</textarea></label>
    ${facts.length ? `<p class="fine"><b>${L('Lo que ha aprendido de ti', 'What it has learned about you')}</b></p><ul>${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${mem.length ? `<p class="fine"><b>${L('Sesiones anteriores', 'Previous sessions')}</b></p><ul>${mem.slice().reverse().map((m) => `<li><small>${new Date(m.at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>${esc(m.summary)}</li>`).join('')}</ul>` : ''}
    <p class="fine">${L('Todo esto se guarda solo en este dispositivo. Para que Paze te entienda, se le envía en cada conversación (no se guarda en nuestro servidor). Usa datos simulados si no quieres compartir los reales.', 'All of this is stored only on this device. So that Paze understands you, it is sent to her in each conversation (it is not stored on our server). Use simulated data if you do not want to share real data.')} <a href="/legal/#${L('privacidad', 'privacy')}">${L('Privacidad', 'Privacy')}</a></p>
    ${mem.length || facts.length ? `<button class="chip-btn" data-act="forget">${L('Olvidar todo', 'Forget everything')}</button>` : ''}</details>`;
}

function wireVoice(node, flagCrisis) {
  const orb = node.querySelector('.vorb');
  const label = node.querySelector('.vorb__label');
  const ctl = node.querySelector('.voice__ctl');
  const capMe = node.querySelector('.cap--me');
  const capAi = node.querySelector('.cap--ai');
  S.pazeOrb?.destroy();
  const paze = new PazeOrb(orb.querySelector('.paze-host'), { mood: 'calma', hr: S.vitals?.bpm || 64 });
  paze.start();
  S.pazeOrb = paze;
  const bind = bindOrbToVoice(paze);
  const setState = (st) => { orb.dataset.state = st; label.textContent = orbLabel(st, S.voice, ORB_STATE); ctl.hidden = st === 'idle' || st === 'error'; bind.state(st); };
  const transcript = [];
  bindOrbControls(orb, () => S.voice);
  node.querySelector('[data-act="noisy"]').addEventListener('change', (e) => {
    saved.noisy = e.target.checked; store.save(saved);
    S.voice?.setPushToTalk(saved.noisy);
    if (S.voice) setState(S.voice.state);
  });
  orb.onclick = async () => {
    if (S.voice && !S.voice.ended) {
      if (!S.voice.ptt && (S.voice.state === 'speaking' || S.voice.state === 'thinking')) S.voice.interrupt();
      return;
    }
    transcript.length = 0;
    capMe.textContent = ''; capAi.textContent = '';
    const v = new VoiceSession({
      context: buildContext,
      onState: setState,
      onLevel: (l) => { orb.style.setProperty('--lvl', l.toFixed(3)); bind.level(l); },
      onCaption: ({ who, text, final }) => {
        if (who === 'me') { capMe.textContent = text; flagCrisis(text); } else capAi.textContent = text;
        if (final && text) transcript.push({ role: who === 'me' ? 'user' : 'assistant', content: text });
      },
      onEnd: (reason) => { if (reason) { label.textContent = reason; } S.voice = null; rememberSession(S.person?.uid, transcript.slice()); },
    });
    S.voice = v;
    try {
      await v.start();
      label.dataset.mode = v.mode;
      if (saved.noisy) { v.setPushToTalk(true); setState(v.state); }
    } catch (e) {
      v.stop();
      setState('error');
      label.textContent = e?.name === 'NotAllowedError' ? L('Permiso de micrófono denegado. Actívalo o usa el modo texto.', 'Microphone permission denied. Allow it or use text mode.') : (e?.message || L('No se pudo conectar.', 'Could not connect.'));
    }
  };
  node.querySelector('[data-act="hang"]').onclick = () => S.voice?.stop(L('Conversación terminada.', 'Conversation ended.'));
  node.querySelector('[data-act="mute"]').onclick = (e) => {
    if (!S.voice) return;
    const m = !S.voice.muted;
    S.voice.setMuted(m);
    e.currentTarget.textContent = m ? L('Activar micro', 'Unmute mic') : L('Silenciar micro', 'Mute mic');
  };
}

function wireText(node, C, flagCrisis) {
  const list = node.querySelector('.chat-list');
  const input = node.querySelector('textarea');
  const send = node.querySelector('[data-act="send"]');
  const add = (role, text) => { const d = el(`<div class="msg msg--${role}"><p></p></div>`); d.firstChild.textContent = text; list.append(d); d.scrollIntoView({ block: 'end' }); return d; };
  async function ask(text) {
    if (!text || send.disabled) return;
    flagCrisis(text);
    C.history.push({ role: 'user', content: text });
    add('me', text);
    input.value = '';
    const out = add('ai', '');
    out.classList.add('is-typing');
    send.disabled = true;
    try {
      const reply = await streamAI('psicologa', { messages: C.history, context: buildContext(), lang: lang() }, (t) => { out.firstChild.textContent = t; });
      C.history.push({ role: 'assistant', content: reply });
    } catch (e) {
      C.history.pop();
      out.firstChild.textContent = e.message === 'rate' ? L('Has enviado muchos mensajes seguidos. Espera unos minutos.', 'You have sent many messages in a row. Please wait a few minutes.') : L('Ahora mismo no puedo conectar con la psicóloga. Habla con el oficial médico o escribe en tu diario.', 'I cannot reach Paze right now. Talk to the medical officer or write in your journal.');
      out.classList.add('is-off');
    } finally {
      out.classList.remove('is-typing');
      send.disabled = false;
    }
  }
  S.chatAsk = (t) => ask(t);
  send.onclick = () => ask(input.value.trim());
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value.trim()); } };
  node.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => ask(b.dataset.say); });
  requestAnimationFrame(() => list.lastElementChild?.scrollIntoView({ block: 'end' }));
}

/* -------------------------------------------------------- 6 historial -- */
// Todas las personas simuladas tienen 30 días de historial (src/app/story.js), cada una con su historia.
// Los chequeos que hace la persona se añaden encima; los simulados se regeneran si cambia la versión.
function seedHistory(uid) {
  if (!uid) return;
  const list = saved.history[uid] || [];
  if (list.some((e) => e.seed)) return;
  const story = crewByUid[uid]?.id || 'default';
  saved.history[uid] = [...seedStory(uid, story, Date.now(), envKey()), ...list].sort((a, b) => a.at - b.at);
  store.save(saved);
}
function seedAll() {
  if (saved.seedV !== SEED_VERSION) {
    for (const uid of Object.keys(saved.history)) saved.history[uid] = (saved.history[uid] || []).filter((e) => !e.sim);
    saved.seedV = SEED_VERSION;
  }
  PEOPLE.forEach((p) => seedHistory(p.uid));
}

// Tarjeta «Qué ha cambiado»: tendencias frente a tu normal (reglas fijas, sin IA).
function changesCard(uid, max = 5) {
  const ins = trendInsights(saved.history[uid] || []).slice(0, max);
  if (!ins.length) return '';
  return `<div class="changes"><p class="changes__t">${L('Qué ha cambiado', 'What has changed')}</p>
    <ul>${ins.map((i) => `<li class="lvl-${LEVEL_CLS[i.level]}"><span class="dot dot--${LEVEL_CLS[i.level]}"></span><span>${esc(i.text)}</span></li>`).join('')}</ul></div>`;
}

const HIST_METRICS = () => [
  [L('Pulso en reposo', 'Resting heart rate'), (h) => h.bpm, L('lpm', 'bpm'), 0],
  ['HRV · RMSSD', (h) => h.rmssd, 'ms', 0],
  [L('Sueño', 'Sleep'), (h) => h.mind?.sleep, 'h', 1],
  [L('Estrés', 'Stress'), (h) => h.mind?.stress, '/10', 0],
  [L('Temperatura', 'Temperature'), (h) => h.temp, '°C', 1],
  [L('Tensión sistólica', 'Systolic pressure'), (h) => h.bp?.sys, 'mmHg', 0],
  [L('Glucosa', 'Glucose'), (h) => h.glucose, 'mg/dL', 0],
  [L('Fuerza de agarre', 'Grip strength'), (h) => h.grip, 'kg', 0],
];

function history() {
  const p = S.person;
  seedHistory(p?.uid);
  const asc = (saved.history[p?.uid] || []).slice().sort((a, b) => a.at - b.at);
  const list = asc.slice().reverse();
  const labels = { normal: L('tu normal', 'your normal'), today: L('último', 'latest') };
  const counts = [0, 1, 2].map((l) => asc.filter((h) => (h.overall ?? 0) === l).length);
  const charts = HIST_METRICS().map(([t, get, u, d]) => {
    const v = asc.map(get);
    const last = v.at(-1);
    const svg = last != null ? baselineChart(v.slice(0, -1).slice(-29), last, { labels, unit: u, fmt: (n) => fmt(n, d) }) : '';
    return svg ? `<figure class="blc"><figcaption><b>${t}</b><span>${fmt(last, d)} ${u}</span></figcaption>${svg}</figure>` : '';
  }).join('');
  const node = el(`
    <section class="screen hist">
      ${topbar()}
      <p class="kicker">${L('Historial y tendencias', 'History and trends')}</p>
      <h2>${esc(p?.name || '')}</h2>
      <div class="glance glance--hist">
        <div class="g"><small>${L('Chequeos', 'Check-ups')}</small><b>${asc.length}</b><em>${asc.length ? L(`desde el ${new Date(asc[0].at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}`, `since ${new Date(asc[0].at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}`) : ''}</em></div>
        <div class="g"><small>${L('Verde / amarillo / rojo', 'Green / yellow / red')}</small><b><span class="c-ok">${counts[0]}</span> · <span class="c-warn">${counts[1]}</span> · <span class="c-err">${counts[2]}</span></b><em>${L('días', 'days')}</em></div>
      </div>
      ${changesCard(p?.uid)}
      <div class="seg seg--hist" role="tablist"><button class="is-on" data-htab="trends">${L('Tendencias', 'Trends')}</button><button data-htab="list">${L('Chequeos', 'Check-ups')}</button></div>
      <div class="htab" data-htab-panel="trends"><p class="fine">${L('La banda verde es tu normal (de tus chequeos anteriores). El punto grande es el último.', 'The green band is your normal (from your previous check-ups). The big dot is the latest one.')}</p><div class="blcharts">${charts}</div></div>
      <div class="htab" data-htab-panel="list" hidden>
        <ul class="hlist">${list.map((h) => `
        <li><button class="hrow" data-entry="${h.at}"><span class="dot dot--${LEVEL_CLS[h.overall ?? 0] || 'off'}"></span>
          <span><b>${h.bpm ?? '—'} ${L('lpm', 'bpm')}</b>${h.bp ? ` · ${h.bp.sys}/${h.bp.dia}` : ''}${h.mind ? ` · ${fmt(h.mind.sleep, 1)} h` : ''}${h.rmssd != null ? ` · HRV ${h.rmssd}` : ''}${h.seed ? ` · <i>${L('simulado', 'simulated')}</i>` : ''}</span>
          <small>${new Date(h.at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} ›</small></button></li>`).join('') || `<li class="empty">${L('Aún no hay chequeos.', 'No check-ups yet.')}</li>`}</ul>
      </div>
      <div class="row">
        <button class="btn btn--dark" data-act="check">${L('Hacer un chequeo', 'Do a check-up')}</button>
        <button class="btn btn--line" data-act="report">${L('Compartir informe', 'Share report')}</button>
      </div>
      ${list.length ? `<button class="btn btn--ghost btn--block" data-act="clear">${L('Reiniciar historial simulado', 'Reset simulated history')}</button>` : ''}
    </section>`);
  node.querySelectorAll('[data-htab]').forEach((b) => b.addEventListener('click', () => {
    node.querySelectorAll('[data-htab]').forEach((x) => x.classList.toggle('is-on', x === b));
    node.querySelectorAll('[data-htab-panel]').forEach((x) => { x.hidden = x.dataset.htabPanel !== b.dataset.htab; });
  }));
  node.querySelectorAll('[data-entry]').forEach((b) => b.addEventListener('click', () => { S.entryAt = +b.dataset.entry; go('entry'); }));
  node.querySelector('[data-act="report"]').onclick = () => { const e = asc.at(-1); if (e) shareReport(entryReport(e)); };
  node.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
    if (!confirm(L(`¿Borrar los ${list.length} chequeos de ${p.name} y volver a su historial simulado de 30 días?`, `Delete ${p.name}'s ${list.length} check-ups and go back to their 30-day simulated history?`))) return;
    saved.history[p.uid] = [];
    seedHistory(p.uid);
    render();
  });
  wire(node);
  return node;
}

// Detalle de un chequeo guardado: el semáforo se recalcula con las mismas reglas fijas.
function entry() {
  const p = S.person;
  const asc = (saved.history[p?.uid] || []).slice().sort((a, b) => a.at - b.at);
  const e = asc.find((x) => x.at === S.entryAt);
  if (!e) return history();
  const results = resultsFromEntry(e);
  const node = el(`
    <section class="screen result">
      ${topbar()}
      <button class="linkish back" data-act="back">← ${L('Historial', 'History')}</button>
      <p class="kicker">${esc(p?.name || '')} · ${new Date(e.at).toLocaleString(locale(), { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</p>
      <div class="verdict verdict--${LEVEL_CLS[e.overall ?? 0]}"><span></span>${LEVEL_TXT[e.overall ?? 0]}</div>
      ${e.flags?.length ? `<div class="emergency"><b>${L('Señales de alarma', 'Warning signs')}</b><p>${esc(e.flags.join(', '))}</p></div>` : ''}
      <ul class="results">${results.map((r) => `
        <li class="lvl-${LEVEL_CLS[r.level]}"><span class="dot dot--${LEVEL_CLS[r.level]}"></span>
          <div><b>${esc(r.name)}</b><small>${esc(r.reason)}</small></div><em>${esc(r.display)}</em></li>`).join('')}</ul>
      ${e.eda != null || e.grip != null ? `<p class="fine">EDA ${fmt(e.eda, 1)} µS · ${L('agarre', 'grip')} ${e.grip ?? '—'} kg${e.seed ? ` · ${L('chequeo simulado', 'simulated check-up')}` : ''}</p>` : ''}
      <div class="row">
        <button class="btn btn--dark" data-act="report">${L('Compartir informe', 'Share report')}</button>
        <button class="btn btn--line" data-act="psy">${L('Hablar con Paze', 'Talk to Paze')}</button>
      </div>
    </section>`);
  node.querySelector('[data-act="back"]').onclick = () => go('history');
  node.querySelector('[data-act="report"]').onclick = () => shareReport(entryReport(e));
  node.querySelector('[data-act="psy"]').onclick = () => openChat();
  wire(node);
  return node;
}

function entryReport(e) {
  const results = resultsFromEntry(e);
  return reportText({ person: S.person, entry: e, results, plan: actionPlan(results, e.env || envKey()), insights: trendInsights(saved.history[S.person?.uid] || []) });
}

// Comparte el informe (menú del sistema en el móvil) o lo copia; si no se puede, lo descarga.
async function shareReport(text) {
  try {
    if (navigator.share) { await navigator.share({ title: L('Informe XPaze', 'XPaze report'), text }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast(L('Informe copiado: pégalo en el mensaje al cirujano de vuelo.', 'Report copied: paste it into the message to the flight surgeon.')); return; } catch { /* sin portapapeles */ }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = `xpaze-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function spark(raw, ref) {
  const values = raw.map((v) => (v == null ? null : +v));
  const ok = values.filter((v) => v != null);
  const W = 320, H = 80, pad = 8;
  const lo = Math.min(...ok, ref ?? Infinity) - 3, hi = Math.max(...ok, ref ?? -Infinity) + 3;
  const x = (i) => pad + (i / Math.max(1, values.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const pts = values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${L('Tendencia', 'Trend')}">
    ${ref ? `<line x1="${pad}" x2="${W - pad}" y1="${y(ref)}" y2="${y(ref)}" class="spark__ref"/>` : ''}
    <path d="${d}" class="spark__line"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" class="spark__dot"/>`).join('')}</svg>`;
}


/* ------------------------------------------- vista del oficial médico -- */
// Toda la tripulación de un vistazo, ordenada por quién necesita atención primero.
function crewStatus(uid) {
  const h = (saved.history[uid] || []).slice().sort((a, b) => a.at - b.at);
  const last = h.at(-1);
  const ins = trendInsights(h);
  const top = ins.find((i) => i.level > 0) || null;
  const level = Math.max(last?.overall ?? 0, top ? top.level : 0);
  return { last, top, level, ins };
}

function crew() {
  const people = PEOPLE.filter((x) => !REAL_PEOPLE[x.uid]).map((x) => ({ ...personFromUid(x.uid), ...crewStatus(x.uid) }))
    .sort((a, b) => b.level - a.level || (b.ins.filter((i) => i.level).length - a.ins.filter((i) => i.level).length));
  const counts = [0, 1, 2].map((l) => people.filter((p) => p.level === l).length);
  const sp = spaceNow();
  const node = el(`
    <section class="screen crewv">
      <header class="brandbar"><button class="linkish" data-act="back">←</button><img src="/logo-mark-dark.png" alt="" width="34" height="28"/><b>XPaze</b>${langSwitch()}</header>
      <p class="kicker">${L('Vista del oficial médico', 'Medical officer view')} · ${esc(ENVIRONMENTS[envKey()].name)}</p>
      <h1>${L('La tripulación hoy', 'The crew today')}</h1>
      <div class="glance">
        <div class="g"><small>${L('Bien', 'Good')}</small><b><span class="dot dot--ok"></span>${counts[0]}</b></div>
        <div class="g"><small>${L('A vigilar', 'Watch')}</small><b><span class="dot dot--warn"></span>${counts[1]}</b></div>
        <div class="g"><small>${L('Actuar', 'Act')}</small><b><span class="dot dot--err"></span>${counts[2]}</b></div>
      </div>
      ${sp ? `<p class="fine crew__env"><span class="dot dot--${LEVEL_CLS[sp.level]}"></span> ${L('Clima espacial', 'Space weather')}: ${esc(sp.headline)}</p>` : ''}
      <ul class="crewlist">${people.map((p) => `
        <li class="lvl-${LEVEL_CLS[p.level]}"><button data-open="${p.uid}" style="--hue:${p.hue}">
          <span class="avatar">${esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>
          <span class="crew__txt"><b>${esc(p.name)} <span class="dot dot--${LEVEL_CLS[p.level]}"></span></b><small>${esc(p.role)}</small>
            <span class="crew__vals">${p.last ? `${p.last.bpm} ${L('lpm', 'bpm')} · HRV ${p.last.rmssd ?? '—'} · ${fmt(p.last.mind?.sleep, 1)} h ${L('sueño', 'sleep')}` : L('sin chequeos', 'no check-ups')}</span>
            <span class="crew__why">${esc(p.top ? p.top.text : (p.ins[0]?.text || L('Sin cambios.', 'No changes.')))}</span></span>
          <span class="crew__go">›</span></button></li>`).join('')}</ul>
      <div class="row">
        <button class="btn btn--dark" data-act="report">${L('Informe de la tripulación', 'Crew report')}</button>
        <button class="btn btn--line" data-act="back2">${L('Volver', 'Back')}</button>
      </div>
      <p class="fine">${L('Ordenada por prioridad: color del último chequeo y cambios frente a la normal de cada persona. Datos simulados.', 'Sorted by priority: colour of the latest check-up and changes against each person’s normal. Simulated data.')}</p>
    </section>`);
  const back = () => go(S.person ? 'home' : 'welcome');
  node.querySelector('[data-act="back"]').onclick = back;
  node.querySelector('[data-act="back2"]').onclick = back;
  node.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => enter(b.dataset.open)));
  node.querySelector('[data-act="report"]').onclick = () => shareReport([
    L('INFORME DE TRIPULACIÓN · XPaze', 'CREW REPORT · XPaze'), `${ENVIRONMENTS[envKey()].name} · ${new Date().toLocaleString(locale())}`, '',
    ...people.map((p) => `${['🟢', '🟡', '🔴'][p.level]} ${p.name} (${p.role}): ${p.last ? `${p.last.bpm} ${L('lpm', 'bpm')}, HRV ${p.last.rmssd}, ${p.last.mind?.sleep} h` : '—'}\n   ${p.ins.map((i) => i.text).join('\n   ')}`),
    '', L('Datos simulados (demo). XPaze no diagnostica.', 'Simulated data (demo). XPaze does not diagnose.'),
  ].join('\n'));
  wireLangSwitch(node, relang);
  loadSpace().then(() => { if (S.screen === 'crew' && !sp && spaceNow()) render(); });
  return node;
}

/* ------------------------------------------------- alertas en directo -- */
// Mientras la estación mide, si algo se sale de rango durante varias lecturas seguidas, avisa sin
// esperar al chequeo. Cada alerta salta una vez y se rearma cuando la señal vuelve a la normalidad.
const ALERTS = [
  { k: 'af', test: (x) => x.rhythm === 'irregular', lvl: 1, t: ['Ritmo irregular detectado', 'Irregular rhythm detected'], d: ['El ECG de los asideros muestra latidos irregulares, compatibles con fibrilación auricular. Quédate quieto y hazte un chequeo.', 'The handle ECG shows irregular beats, compatible with atrial fibrillation. Stay still and do a check-up.'], act: 'check' },
  { k: 'pvc', test: (x) => x.rhythm === 'ectopics', lvl: 1, t: ['Extrasístoles repetidas', 'Repeated ectopic beats'], d: ['El ECG detecta latidos adelantados. Suelen ser benignos; repite la medida en reposo.', 'The ECG detects early beats. Usually benign; repeat the measurement at rest.'], act: 'check' },
  { k: 'fever', test: (x) => x.temp >= 38.1, lvl: 1, t: ['Fiebre', 'Fever'], d: ['La temperatura pasa de 38 °C. Hazte un chequeo y limita el contacto cercano con la tripulación.', 'Temperature is above 38 °C. Do a check-up and limit close contact with the crew.'], act: 'check' },
  { k: 'resp', test: (x) => x.rr >= 21 && !S.breathing, lvl: 1, t: ['Respiración rápida en reposo', 'Fast breathing at rest'], d: ['Respiras más rápido de lo normal sin hacer esfuerzo.', 'You are breathing faster than normal without effort.'], act: 'check' },
  { k: 'qtc', test: (x) => x.qtc >= 460, lvl: 1, t: ['QTc alargado', 'Prolonged QTc'], d: ['El ECG muestra un QTc largo. Revisa con el oficial médico la medicación que has tomado.', 'The ECG shows a long QTc. Review the medication you have taken with the medical officer.'], act: 'check' },
  { k: 'stress', test: (x) => x.eda >= 8 && !S.breathing, lvl: 1, t: ['Estrés alto', 'High stress'], d: ['Tu actividad electrodérmica está alta. Un minuto de respiración guiada con Paze puede bajarla.', 'Your electrodermal activity is high. One minute of guided breathing with Paze can bring it down.'], act: 'breathe' },
  { k: 'co2', test: (x) => co2Level(x.co2) === 2, lvl: 2, t: ['CO₂ alto en la cabina', 'High cabin CO₂'], d: ['Por encima del límite de NASA-STD-3001: afecta a toda la tripulación. Avisa y revisa el depurador de CO₂.', 'Above the NASA-STD-3001 limit: it affects the whole crew. Alert them and check the CO₂ scrubber.'], act: 'crew' },
  { k: 'dose', test: (x) => x.dose >= 200, lvl: 2, t: ['Radiación muy alta', 'Very high radiation'], d: ['El dosímetro marca un evento de partículas solares. Ve al refugio de radiación.', 'The dosimeter shows a solar particle event. Go to the radiation shelter.'], act: 'crew' },
];
const alertState = { streak: {}, active: new Set() };
function checkAlerts(x) {
  if (!x || !S.person || S.demo || S.screen === 'check') return;
  for (const a of ALERTS) {
    const on = !!a.test(x);
    alertState.streak[a.k] = on ? (alertState.streak[a.k] || 0) + 1 : 0;
    if (!on) { alertState.active.delete(a.k); continue; }
    if (alertState.streak[a.k] >= 3 && !alertState.active.has(a.k)) { alertState.active.add(a.k); showAlert(a); }
  }
}
function showAlert(a) {
  document.querySelector('.alertb')?.remove();
  const btn = { check: L('Hacerme un chequeo', 'Do a check-up'), breathe: L('Respirar con Paze', 'Breathe with Paze'), crew: L('Ver la tripulación', 'See the crew') }[a.act];
  const box = el(`<div class="alertb alertb--${LEVEL_CLS[a.lvl]}" role="alert">
    <div class="alertb__head"><span class="dot dot--${LEVEL_CLS[a.lvl]}"></span><b>${esc(L(...a.t))}</b><button class="alertb__x" aria-label="${L('Cerrar', 'Close')}">✕</button></div>
    <p>${esc(L(...a.d))}</p><button class="btn btn--dark btn--sm" data-a="go">${btn}</button></div>`);
  box.querySelector('.alertb__x').onclick = () => box.remove();
  box.querySelector('[data-a="go"]').onclick = () => {
    box.remove();
    if (a.act === 'check') startCheck(); else if (a.act === 'breathe') startBreathing(); else go('crew');
  };
  document.body.append(box);
  vibrate([120, 80, 120]);
  setTimeout(() => box.remove(), 20000);
}

/* --------------------------------------------- respiración guiada (Paze) -- */
// 1 minuto de respiración 4-6 (4 s inspirar, 6 s espirar) con el orbe de Paze marcando el ritmo.
// En la estación simulada el cuerpo responde de verdad: se ve el antes y el después.
function startBreathing({ onDone } = {}) {
  if (document.querySelector('.breath')) return;
  const IN = 4, OUT = 6, CYCLES = 6, total = (IN + OUT) * CYCLES;
  const read = () => ({ hr: S.ext?.ecgHr ?? S.vitals?.bpm ?? null, eda: S.ext?.eda ?? null, rmssd: S.ext?.rmssd ?? null });
  const before = read();
  const box = el(`<div class="breath" role="dialog" aria-label="${L('Respiración guiada', 'Guided breathing')}">
    <p class="kicker">${L('Respira con Paze · 1 minuto', 'Breathe with Paze · 1 minute')}</p>
    <div class="breath__orb"></div>
    <h2 class="breath__cue">${L('Prepárate…', 'Get ready…')}</h2>
    <p class="breath__sub">${L('Inspira por la nariz 4 segundos y suelta el aire despacio en 6.', 'Breathe in through your nose for 4 seconds and let the air out slowly over 6.')}</p>
    <div class="breath__bar"><i></i></div>
    <p class="breath__live" data-b="live"></p>
    <div class="breath__end" hidden></div>
    <button class="btn btn--line" data-b="stop">${L('Terminar', 'Finish')}</button>
  </div>`);
  document.body.append(box);
  const t0 = performance.now() + 1500;
  let orb = null;
  try { orb = new PazeOrb(box.querySelector('.breath__orb'), { mood: 'respira', hr: before.hr || 64 }); orb.start(); } catch { /* sin WebGL */ }
  const phase = () => { const t = (performance.now() - t0) / 1000; if (t < 0) return null; const c = t % (IN + OUT); return c < IN ? { inhale: true, p: c / IN, left: Math.ceil(IN - c) } : { inhale: false, p: (c - IN) / OUT, left: Math.ceil(IN + OUT - c) }; };
  if (orb) orb.breathFn = () => { const ph = phase(); if (!ph) return 0.3; return ph.inhale ? 0.5 - 0.5 * Math.cos(Math.PI * ph.p) : 0.5 + 0.5 * Math.cos(Math.PI * ph.p); };
  S.breathing = true;
  S.link?.body?.breathe?.(true);
  const cue = box.querySelector('.breath__cue'), bar = box.querySelector('.breath__bar i'), live = box.querySelector('[data-b="live"]');
  const timer = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const ph = phase();
    if (ph) cue.textContent = `${ph.inhale ? L('Inspira', 'Breathe in') : L('Suelta el aire', 'Breathe out')} · ${ph.left}`;
    bar.style.width = `${Math.min(100, Math.max(0, (t / total) * 100))}%`;
    const r = read();
    if (r.hr) live.textContent = `${L('Pulso', 'Heart rate')} ${r.hr} ${L('lpm', 'bpm')}${r.eda != null ? ` · EDA ${fmt(r.eda, 1)} µS` : ''}`;
    if (t >= total) finish(true);
  }, 200);
  function finish(done) {
    clearInterval(timer);
    S.breathing = false;
    S.link?.body?.breathe?.(false);
    orb?.destroy();
    const after = read();
    if (!done) { box.remove(); return; }
    box.querySelector('.breath__orb').remove();
    bar.parentElement.remove(); live.remove();
    cue.textContent = L('Bien hecho.', 'Well done.');
    const diff = before.hr && after.hr ? `${L('Pulso', 'Heart rate')}: ${before.hr} → ${after.hr} ${L('lpm', 'bpm')}` : '';
    const eda = before.eda != null && after.eda != null ? ` · EDA: ${fmt(before.eda, 1)} → ${fmt(after.eda, 1)} µS` : '';
    const hrv = before.rmssd && after.rmssd ? ` · HRV: ${before.rmssd} → ${after.rmssd} ms` : '';
    const summary = `${diff}${eda}${hrv}`;
    box.querySelector('.breath__sub').textContent = summary || L('Has completado un minuto de respiración lenta.', 'You completed one minute of slow breathing.');
    const end = box.querySelector('.breath__end');
    end.hidden = false;
    end.innerHTML = `<button class="btn btn--dark" data-b="tell">${L('Contárselo a Paze', 'Tell Paze')}</button>`;
    box.querySelector('[data-b="stop"]').textContent = L('Cerrar', 'Close');
    end.querySelector('[data-b="tell"]').onclick = () => {
      box.remove();
      const msg = L(`Acabo de hacer un minuto de respiración guiada. ${summary}.`, `I have just done one minute of guided breathing. ${summary}.`);
      if (onDone) onDone(msg);
      else { S.pendingSay = msg; saved.chatMode = 'texto'; openChat(); }
    };
  }
  box.querySelector('[data-b="stop"]').onclick = () => { if (S.breathing) finish(false); else box.remove(); };
}

/* ------------------------------------------------------ modo demo (60 s) -- */
// Reproduce la historia del día 58 sin tocar nada: estación simulada → ECG y sensores → chequeo
// acelerado → «tú frente a tu normal» → explicación de la IA → Paze. Sirve también de plan B en el pitch.
let demoRun = 0;
const demoWait = (ms, id) => new Promise((res, rej) => setTimeout(() => (id === demoRun ? res() : rej(new Error('demo-stop'))), ms));
async function demoUntil(fn, id, max = 30000) {
  const t0 = performance.now();
  while (!fn()) { await demoWait(200, id); if (performance.now() - t0 > max) throw new Error('demo-timeout'); }
}
function demoCaption(text, n, total = 7) {
  let box = document.querySelector('.demo-cap');
  if (!box) {
    box = el(`<div class="demo-cap" role="status" aria-live="polite"><div class="demo-cap__bar"><i></i></div><p></p><button class="demo-cap__x" type="button">${L('Salir de la demo', 'Exit demo')}</button></div>`);
    box.querySelector('.demo-cap__x').onclick = stopDemo;
    document.body.append(box);
  }
  box.querySelector('p').textContent = text;
  box.querySelector('.demo-cap__bar i').style.width = `${Math.round((n / total) * 100)}%`;
}
function stopDemo() {
  demoRun += 1;
  document.querySelector('.demo-cap')?.remove();
  S.demo = false; CHECK_S = 30; CHECK_GOOD = 15;
  if (S.check) endCheck();
  S.link?.setScenario?.('rest');
  go(S.person ? 'home' : 'welcome');
}
const demoScroll = (sel) => app.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

async function runDemo() {
  const id = ++demoRun;
  S.demo = true; CHECK_S = 7; CHECK_GOOD = 5;
  const vega = PEOPLE[0].uid;
  try {
    if (!S.link || S.link.kind !== 'sim') { const link = new SimLink(); attach(link); await link.connect(); }
    delete saved.history[vega]; store.save(saved); // historia limpia: 12 días de historial de ejemplo
    S.person = null;
    identify(vega, { quiet: true });
    S.link.setScenario('day58', { instant: true });
    demoCaption(L('Día 58 rumbo a Marte. Vega, la comandante, pasa su tarjeta por la XPaze Station.', 'Day 58 on the way to Mars. Vega, the commander, taps her card on the XPaze Station.'), 1);
    go('live');
    await demoWait(5500, id);
    demoScroll('.xtiles');
    demoCaption(L('Al agarrar los asideros, todo a la vez: ECG, temperatura, respiración, HRV, QTc, estrés y fuerza.', 'Holding the handles measures everything at once: ECG, temperature, breathing, HRV, QTc, stress and grip.'), 2);
    await demoWait(5500, id);
    demoCaption(L('Chequeo guiado. En la vida real son 2 minutos; aquí va acelerado.', 'Guided check-up. In real life it takes 2 minutes; here it is sped up.'), 3);
    startCheck();
    await demoWait(1500, id); demoScroll('.ring');
    await demoUntil(() => !S.check || S.check.step >= 1, id);
    const fill = async (values) => { Object.assign(S.check.values, values); await demoWait(1300, id); nextStep(); };
    await demoUntil(() => !S.check || S.check.step >= 3, id, 20000); // tensión y glucosa se miden solas
    await fill({ mind: { phq2: 2, sleep: 5, stress: 7 } });
    await demoWait(900, id); S.check.values.flags = []; nextStep();
    await demoWait(800, id);
    demoCaption(L('Su pulso está dentro del rango general de cualquier monitor… pero muy lejos de SU normal. XPaze lo ve.', 'Her heart rate is within the general range any monitor uses… but far from HER normal. XPaze sees it.'), 4);
    demoScroll('.blcharts');
    await demoWait(7000, id);
    demoCaption(L('La IA explica el resultado en lenguaje llano. El color lo deciden reglas fijas; la IA no puede cambiarlo.', 'The AI explains the result in plain language. Fixed rules decide the colour; the AI cannot change it.'), 5);
    demoScroll('.ai-box');
    await demoWait(8000, id);
    demoCaption(L('Paze, la psicóloga de a bordo, ya conoce estos datos y abre ella la sesión con una pregunta.', 'Paze, the on-board psychologist, already knows this data and opens the session with a question.'), 6);
    saved.chatMode = 'texto';
    S.chat = null;
    openChat();
    await demoUntil(() => { const s = app.querySelector('[data-act="send"]'); return s && !s.disabled && app.querySelector('.msg--ai:not(.is-typing)'); }, id, 30000).catch(() => {});
    await demoWait(2500, id);
    const ta = app.querySelector('.compose textarea');
    if (ta) {
      ta.value = L('Llevo unos días durmiendo fatal y estoy irritable con la tripulación.', 'I have been sleeping terribly for a few days and I am irritable with the crew.');
      app.querySelector('[data-act="send"]')?.click();
    }
    await demoUntil(() => { const m = [...app.querySelectorAll('.msg--ai')]; return m.length >= 2 && !m.at(-1).classList.contains('is-typing') && m.at(-1).textContent.length > 20; }, id, 40000).catch(() => {});
    await demoWait(3500, id);
    demoCaption(L('XPaze: te compara contigo, aunque la Tierra esté a 11 minutos.', 'XPaze: it compares you with yourself, even when Earth is 11 minutes away.'), 7);
    await demoWait(6000, id);
    document.querySelector('.demo-cap')?.remove();
  } catch (e) {
    if (e.message !== 'demo-stop') { console.warn('[demo]', e); document.querySelector('.demo-cap')?.remove(); }
  } finally {
    if (id === demoRun) { S.demo = false; CHECK_S = 30; CHECK_GOOD = 15; }
  }
}

/* ------------------------------------------------------------ varios -- */
let toastTimer = 0;
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = el('<div class="toast" role="status" aria-live="polite"></div>'); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 2800);
}
function vibrate(p) { try { navigator.vibrate?.(p); } catch { /* sin vibración */ } }

function icon(name) {
  const p = {
    bt: '<path d="M7 7l10 10-5 5V2l5 5L7 17"/>',
    sim: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M7 10h2l1.5-3 3 6L15 10h2"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/>',
    swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    paze: '<circle cx="12" cy="12" r="5"/><path d="M4.5 9.5a8 8 0 0 1 15 0M4.5 14.5a8 8 0 0 0 15 0"/>',
    chart: '<path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
  }[name];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
}

seedAll();
render();
