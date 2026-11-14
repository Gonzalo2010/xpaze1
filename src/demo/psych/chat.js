// Psicóloga de a bordo (IA) dentro de Mente. Dos modos:
//   Voz   → el orbe (mismo módulo que la app: src/app/voice.js), OpenAI Realtime o, si falla,
//           Web Speech + Claude Sonnet. Endpoints relativos a /demo/: api/voz/sesion, api/psicologa.
//   Texto → conversación escrita por api/psicologa (streaming).
// La conversación vive solo en esta pestaña: no se guarda ni se comparte.

import { t } from '../core/i18n.js';
import { h, card } from '../core/ui.js';
import { VoiceSession, CRISIS, micAvailable, speechFallbackAvailable, bindOrbControls, orbLabel } from '../../app/voice.js';

const noisyGet = () => { try { return localStorage.getItem('xpaze-noisy') === '1'; } catch { return false; } };
const noisySet = (on) => { try { localStorage.setItem('xpaze-noisy', on ? '1' : '0'); } catch { /* sin almacenamiento */ } };
import { PazeOrb, bindOrbToVoice } from '../../app/paze-orb.js';

const MAX_TURNS = 40;
const ORB_STATE = {
  idle: 'Pulsa el orbe para hablar', connecting: 'Conectando…', listening: 'Te escucho', user: 'Te escucho…',
  thinking: 'Pensando…', speaking: 'Hablando', error: 'No se pudo conectar',
};
let mode = 'voz';

export function mountChat({ astronaut, context }) {
  let voice = null;
  let controller = null;
  let paze = null;
  const root = card({ class: 'psy-chat' });
  const crisis = h('div', { class: 'crisis-box', role: 'alert', hidden: true },
    h('b', null, 'No estás solo.'),
    h('span', null, 'Habla ahora con el oficial médico o el comandante. En la Tierra: 112, o 024 en España (gratis, 24 h).'));
  const flag = (text) => { if (CRISIS.test(text)) crisis.hidden = false; };

  function render() {
    voice?.stop(); voice = null; controller?.abort(); paze?.destroy(); paze = null;
    const tabs = h('div', { class: 'tabs' }, ['voz', 'texto'].map((m) => h('button', {
      class: 'tab', type: 'button', 'aria-pressed': String(mode === m), onClick: () => { if (mode !== m) { mode = m; render(); } },
    }, m === 'voz' ? 'Voz' : 'Texto')));
    root.replaceChildren(
      h('div', { class: 'card-head' },
        h('div', null, h('h2', { class: 'card-title' }, t('psych.chat.title')), h('p', { class: 'card-sub' }, t('psych.chat.lead'))),
        tabs),
      h('p', { class: 'small', style: { fontWeight: 650 } }, 'Estás hablando con una IA.'),
      crisis,
      mode === 'voz' ? voiceView() : textView(),
      h('p', { class: 'small muted' }, t('psych.chat.disclaimer')));
  }

  function voiceView() {
    const can = micAvailable() || speechFallbackAvailable();
    const host = h('span', { class: 'paze-host' });
    const orb = h('button', { class: 'vorb vorb--paze', type: 'button', dataset: { state: 'idle' }, 'aria-label': 'Empezar a hablar con Paze, la psicóloga de a bordo' }, host);
    paze = new PazeOrb(host, { mood: 'calma' });
    paze.start();
    const bind = bindOrbToVoice(paze);
    const label = h('p', { class: 'vorb__label', 'aria-live': 'polite' },
      can ? ORB_STATE.idle : 'El micrófono necesita https y Chrome. Usa el modo Texto.');
    const capMe = h('p', { class: 'cap cap--me' });
    const capAi = h('p', { class: 'cap cap--ai' });
    const mute = h('button', { class: 'btn btn--glass glass btn--small', type: 'button' }, 'Silenciar micro');
    const hang = h('button', { class: 'btn btn--light btn--small', type: 'button' }, 'Colgar');
    const ctl = h('div', { class: 'row voice__ctl', hidden: true }, mute, hang);
    const setState = (st) => { orb.dataset.state = st; label.textContent = orbLabel(st, voice, ORB_STATE); ctl.hidden = st === 'idle' || st === 'error'; bind.state(st); };
    bindOrbControls(orb, () => voice);
    const noisy = h('input', { type: 'checkbox', checked: noisyGet(), onChange: (e) => { noisySet(e.target.checked); voice?.setPushToTalk(e.target.checked); if (voice) setState(voice.state); } });
    const noisyRow = h('label', { class: 'noisy' }, noisy, ' ', h('span', null, 'Sala con ruido: mantén pulsado el orbe para hablar'));

    orb.addEventListener('click', async () => {
      if (voice && !voice.ended) {
        if (!voice.ptt && (voice.state === 'speaking' || voice.state === 'thinking')) voice.interrupt();
        return;
      }
      if (!can) return;
      capMe.textContent = ''; capAi.textContent = '';
      const v = new VoiceSession({
        context,
        onState: setState,
        onLevel: (l) => { orb.style.setProperty('--lvl', l.toFixed(3)); bind.level(l); },
        onCaption: ({ who, text }) => { if (who === 'me') { capMe.textContent = text; flag(text); } else capAi.textContent = text; },
        onEnd: (reason) => { if (reason) label.textContent = reason; voice = null; },
      });
      voice = v;
      try { await v.start(); if (noisyGet()) { v.setPushToTalk(true); setState(v.state); } } catch (e) {
        v.stop(); setState('error');
        label.textContent = e?.name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Actívalo o usa el modo Texto.' : (e?.message || 'No se pudo conectar.');
      }
    });
    hang.addEventListener('click', () => voice?.stop('Conversación terminada.'));
    mute.addEventListener('click', () => {
      if (!voice) return;
      voice.setMuted(!voice.muted);
      mute.textContent = voice.muted ? 'Activar micro' : 'Silenciar micro';
    });
    return h('div', { class: 'voice' }, orb, label, noisyRow, h('div', { class: 'captions', 'aria-live': 'polite' }, capMe, capAi), ctl);
  }

  function textView() {
    const history = [];
    const list = h('div', { class: 'psy-chat__list', role: 'log', 'aria-live': 'polite' });
    const input = h('textarea', { class: 'psy-text psy-chat__input', rows: 2, maxlength: 2000, placeholder: t('psych.chat.placeholder'), 'aria-label': t('psych.chat.placeholder') });
    const send = h('button', { class: 'btn btn--light', type: 'button' }, t('psych.chat.send'));
    const status = h('p', { class: 'small muted', role: 'status' }, '');
    const bubble = (role, text) => {
      const b = h('div', { class: `psy-msg psy-msg--${role}` }, h('p', null, text));
      list.append(b); list.scrollTop = list.scrollHeight;
      return b.firstChild;
    };
    bubble('assistant', t('psych.chat.hello', { name: astronaut.name.split(' ')[0] }));

    async function ask(text) {
      if (!text || controller) return;
      if (history.length >= MAX_TURNS * 2) { status.textContent = t('psych.chat.limit'); return; }
      flag(text);
      history.push({ role: 'user', content: text });
      bubble('user', text);
      input.value = '';
      const out = bubble('assistant', '');
      out.parentNode.classList.add('is-typing');
      send.disabled = true;
      controller = new AbortController();
      let reply = '';
      try {
        const res = await fetch(new URL('api/psicologa', location.href), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, context: context() }), signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(res.status === 429 ? 'rate' : 'http');
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
            buf = buf.slice(i + 2);
            if (!line) continue;
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'text') { reply += ev.text; out.textContent = reply.replace(/\*\*/g, ''); list.scrollTop = list.scrollHeight; }
            else if (ev.type === 'error') throw new Error(ev.code || 'api');
          }
        }
        if (!reply) throw new Error('empty');
        history.push({ role: 'assistant', content: reply });
      } catch (e) {
        history.pop();
        out.textContent = reply || t(e.message === 'rate' ? 'psych.chat.rate' : e.name === 'AbortError' ? 'psych.chat.stopped' : 'psych.chat.offline');
        out.parentNode.classList.add('is-error');
      } finally {
        out.parentNode.classList.remove('is-typing');
        controller = null; send.disabled = false; input.focus();
      }
    }
    send.addEventListener('click', () => ask(input.value.trim()));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value.trim()); } });
    const starters = ['psych.chat.s1', 'psych.chat.s2', 'psych.chat.s3'].map((k) => h('button', { class: 'chip', type: 'button', onClick: () => ask(t(k)) }, t(k)));
    return h('div', null, list, h('div', { class: 'chips psy-chat__starters' }, starters), h('div', { class: 'psy-chat__compose' }, input, send), status);
  }

  render();
  return { node: root, cleanup: () => { voice?.stop(); controller?.abort(); paze?.destroy(); } };
}
