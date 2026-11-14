// Psicóloga por voz en directo.
//   1) OpenAI Realtime por WebRTC: el servidor acuña un secreto efímero (api/voz/sesion)
//      y el navegador habla directamente con OpenAI. Audio de ida y vuelta, interrupciones naturales.
//   2) Recurso si no hay OpenAI o falla: Web Speech API (escuchar) + Claude Sonnet por
//      api/psicologa (texto) + speechSynthesis en español (hablar).
// Emite: onState(estado) · onLevel(0–1) · onCaption({who, text, final}) · onEnd(motivo).
// Estados: idle · connecting · listening · user · thinking · speaking · error.

import { streamAI } from './ai.js';

export const CRISIS = /suicid|matarme|quitarme la vida|no quiero vivir|hacerme da[ñn]o|autolesi|cortarme|kill myself|end my life|hurt myself|self[- ]harm|want to die/i;

export const micAvailable = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const speechFallbackAvailable = () => !!SR && 'speechSynthesis' in window;

export class VoiceSession {
  constructor({ context, onState, onLevel, onCaption, onEnd }) {
    Object.assign(this, { context, onState, onLevel, onCaption, onEnd });
    this.state = 'idle';
    this.mode = null;          // 'realtime' | 'speech'
    this.stream = null;
    this.pc = null;
    this.dc = null;
    this.audio = null;
    this.ctx = null;
    this.raf = 0;
    this.timer = 0;
    this.muted = false;
    this.ended = false;
    this.history = [];         // solo para el modo de recurso (texto)
  }

  set(state) {
    if (this.state === state) return;
    this.state = state;
    this.onState?.(state);
  }

  async start() {
    this.set('connecting');
    if (!micAvailable()) throw new Error('Para hablar hace falta el micrófono y una conexión segura (https).');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.meter(this.stream, 'mic');
    let session = null;
    try {
      const r = await fetch(new URL('api/voz/sesion', location.href), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: this.context() }),
      });
      if (r.status === 429) throw new Error('Has usado muchas sesiones seguidas. Espera unos minutos.');
      if (r.ok) session = await r.json();
    } catch (e) {
      if (/sesiones/.test(e.message)) throw e;
    }
    if (session?.key) {
      try { await this.startRealtime(session); return; } catch (e) { console.warn('[voz] realtime:', e); this.closeRtc(); }
    }
    if (!speechFallbackAvailable()) throw new Error('La voz en directo no está disponible ahora y este navegador no tiene reconocimiento de voz. Usa el modo texto.');
    this.startSpeech();
  }

  /* -------------------------------------------------- OpenAI Realtime -- */
  async startRealtime({ key, maxSeconds }) {
    this.mode = 'realtime';
    const pc = new RTCPeerConnection();
    this.pc = pc;
    this.audio = new Audio();
    this.audio.autoplay = true;
    pc.ontrack = (e) => { this.audio.srcObject = e.streams[0]; this.meter(e.streams[0], 'ai'); };
    pc.addTrack(this.stream.getAudioTracks()[0], this.stream);
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState) && !this.ended) this.stop('Se ha cortado la conexión.');
    };
    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.onmessage = (e) => { try { this.onEvent(JSON.parse(e.data)); } catch { /* evento corrupto */ } };
    const opened = new Promise((res) => { dc.onopen = res; });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const r = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST', body: offer.sdp, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/sdp' },
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    await Promise.race([opened, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]);
    // que salude ella primero
    dc.send(JSON.stringify({ type: 'response.create' }));
    this.set('thinking');
    this.timer = setTimeout(() => this.stop('Fin de la sesión (10 minutos). Puedes empezar otra.'), (maxSeconds || 600) * 1000);
  }

  /* ---------------------------------------- interrumpir y pulsar para hablar -- */
  send(obj) { try { if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(obj)); } catch { /* canal cerrado */ } }

  // El ruido ya no corta a Paze: se la interrumpe a propósito tocando el orbe.
  interrupt() {
    if (this.mode === 'realtime') {
      this.send({ type: 'response.cancel' });
      this.send({ type: 'output_audio_buffer.clear' });
      this.set('listening');
    } else if (this.mode === 'speech') {
      speechSynthesis.cancel();
      this.set('listening');
      this.listen();
    }
  }

  // Sala con ruido: el micro solo envía audio mientras se mantiene pulsado el orbe.
  setPushToTalk(on) {
    this.ptt = on;
    const track = this.stream?.getAudioTracks()[0];
    if (this.mode === 'realtime') {
      this.send({ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: on ? null : { type: 'semantic_vad', eagerness: 'low', interrupt_response: false } } } } });
      if (track) track.enabled = !on && !this.muted;
    }
  }

  pressTalk() {
    if (!this.ptt || this.ended) return;
    if (this.state === 'speaking' || this.state === 'thinking') this.interrupt();
    const track = this.stream?.getAudioTracks()[0];
    if (this.mode === 'realtime') {
      this.send({ type: 'input_audio_buffer.clear' });
      if (track) track.enabled = true;
    } else this.listen();
    this.set('user');
  }

  releaseTalk() {
    if (!this.ptt || this.ended || this.state !== 'user') return;
    const track = this.stream?.getAudioTracks()[0];
    if (this.mode === 'realtime') {
      // un instante para que llegue el final de la frase antes de cerrar el turno
      setTimeout(() => {
        if (track) track.enabled = false;
        this.send({ type: 'input_audio_buffer.commit' });
        this.send({ type: 'response.create' });
        this.set('thinking');
      }, 250);
    }
  }

  onEvent(ev) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started': this.set('user'); break;
      case 'input_audio_buffer.speech_stopped': this.set('thinking'); break;
      case 'response.created': if (this.state !== 'speaking') this.set('thinking'); break;
      case 'output_audio_buffer.started': this.set('speaking'); break;
      case 'output_audio_buffer.stopped': case 'output_audio_buffer.cleared': this.set('listening'); break;
      case 'response.output_audio_transcript.delta': this.aiText = (this.aiText || '') + (ev.delta || ''); this.onCaption?.({ who: 'ai', text: this.aiText, final: false }); break;
      case 'response.output_audio_transcript.done': this.onCaption?.({ who: 'ai', text: ev.transcript || this.aiText || '', final: true }); this.aiText = ''; break;
      case 'conversation.item.input_audio_transcription.completed':
        if (ev.transcript?.trim()) this.onCaption?.({ who: 'me', text: ev.transcript.trim(), final: true });
        break;
      case 'response.done': if (this.state === 'thinking') this.set('listening'); break;
      case 'error': console.warn('[voz] error', ev.error); if (/expired|session/i.test(ev.error?.message || '')) this.stop('La sesión ha caducado.'); break;
      default: break;
    }
  }

  /* --------------------------------------------- recurso: Web Speech -- */
  startSpeech() {
    this.mode = 'speech';
    this.rec = new SR();
    this.rec.lang = 'es-ES';
    this.rec.interimResults = true;
    this.rec.continuous = false;
    this.rec.onstart = () => this.set('listening');
    this.rec.onspeechstart = () => this.set('user');
    this.rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      const text = r[0].transcript.trim();
      this.onCaption?.({ who: 'me', text, final: r.isFinal });
      if (r.isFinal && text) this.reply(text);
    };
    this.rec.onerror = (e) => { if (e.error === 'not-allowed') this.stop('Permiso de micrófono denegado.'); };
    this.rec.onend = () => { if (!this.ended && this.state === 'listening') this.listen(); };
    this.greet();
  }

  listen() {
    if (this.ended || this.muted) return;
    try { this.rec.start(); } catch { /* ya escuchando */ }
  }

  async greet() {
    const name = (this.context().name || '').split(' ')[0];
    await this.say(`Hola${name ? `, ${name}` : ''}. Soy Paze, la psicóloga de a bordo. ¿Cómo estás hoy?`);
  }

  async reply(text) {
    this.history.push({ role: 'user', content: text });
    this.set('thinking');
    try { this.rec.stop(); } catch { /* nada */ }
    let out = '';
    try {
      out = await streamAI('psicologa', { voice: true, messages: this.history, context: this.context() },
        (t) => this.onCaption?.({ who: 'ai', text: t, final: false }));
      this.history.push({ role: 'assistant', content: out });
    } catch (e) {
      this.history.pop();
      out = e.message === 'rate' ? 'Has hablado mucho seguido. Espera unos minutos.' : 'Ahora mismo no puedo conectar. Prueba de nuevo en un momento.';
    }
    await this.say(out);
  }

  say(text) {
    this.onCaption?.({ who: 'ai', text, final: true });
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-ES';
      const v = speechSynthesis.getVoices().find((x) => x.lang?.startsWith('es-ES')) || speechSynthesis.getVoices().find((x) => x.lang?.startsWith('es'));
      if (v) u.voice = v;
      u.rate = 1.02;
      // speechSynthesis no da audio analizable: el orbe late con un pulso suave mientras habla
      u.onstart = () => { this.set('speaking'); this.fakeLevel = true; };
      u.onend = u.onerror = () => { this.fakeLevel = false; if (!this.ended) { this.set('listening'); this.listen(); } resolve(); };
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  /* ---------------------------------------------------- volumen y fin -- */
  meter(stream, who) {
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      this.ctx.createMediaStreamSource(stream).connect(an);
      this[`an_${who}`] = an;
    } catch { /* sin Web Audio: el orbe usa solo el estado */ }
    if (!this.raf) {
      const buf = new Uint8Array(256);
      const rms = (an) => {
        if (!an) return 0;
        an.getByteTimeDomainData(buf);
        let s = 0;
        for (const b of buf) { const x = (b - 128) / 128; s += x * x; }
        return Math.sqrt(s / buf.length);
      };
      const loop = () => {
        let lvl = this.state === 'speaking' ? rms(this.an_ai) : rms(this.an_mic);
        if (this.fakeLevel) lvl = 0.12 + 0.08 * Math.sin(performance.now() / 120);
        if (this.muted && this.state !== 'speaking') lvl = 0;
        this.onLevel?.(Math.min(1, lvl * 4));
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }
  }

  setMuted(m) {
    this.muted = m;
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = !m && !this.ptt; });
    if (this.mode === 'speech') { if (m) { try { this.rec.stop(); } catch { /* nada */ } } else this.listen(); }
  }

  closeRtc() {
    try { this.dc?.close(); } catch { /* nada */ }
    try { this.pc?.close(); } catch { /* nada */ }
    this.dc = this.pc = null;
  }

  stop(reason = '') {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    this.closeRtc();
    try { this.rec?.abort(); } catch { /* nada */ }
    try { speechSynthesis.cancel(); } catch { /* nada */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.audio) { this.audio.srcObject = null; }
    this.ctx?.close().catch(() => {});
    this.set('idle');
    this.onLevel?.(0);
    this.onEnd?.(reason);
  }
}

// Controles del orbe compartidos por la app y la demo:
//   · sin sesión: tocar empieza (lo hace quien llama)
//   · hablando o pensando: tocar interrumpe
//   · modo «sala con ruido»: mantener pulsado para hablar, soltar para que conteste
export function bindOrbControls(orb, getSession) {
  orb.addEventListener('pointerdown', (e) => {
    const v = getSession();
    if (v && !v.ended && v.ptt) { e.preventDefault(); try { orb.setPointerCapture(e.pointerId); } catch { /* sin captura */ } v.pressTalk(); }
  });
  const up = () => { const v = getSession(); if (v && !v.ended && v.ptt) v.releaseTalk(); };
  orb.addEventListener('pointerup', up);
  orb.addEventListener('pointercancel', up);
}

// Texto bajo el orbe según el estado y el modo.
export function orbLabel(st, v, base) {
  if (v?.ptt && st === 'listening') return 'Mantén pulsado el orbe para hablar';
  if (v?.ptt && st === 'user') return 'Te escucho… suelta al terminar';
  if (st === 'speaking') return 'Hablando · toca el orbe para interrumpir';
  return base[st] || st;
}
