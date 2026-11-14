// Psicóloga de a bordo (IA) — servidor de la conversación de apoyo de Mente.
//
// POST /api/psicologa  { messages: [{role, content}], context: {...} }  →  text/event-stream (conversación)
// POST /api/explicar   { check: {results, overall, plan, environment, person} } → explica un chequeo ya clasificado
//   data: {"type":"text","text":"…"}   trozos de la respuesta
//   data: {"type":"done"}               fin
//   data: {"type":"error","code":"…"}  fallo (la interfaz muestra un mensaje amable)
//
// Proveedor por defecto: Claude (SDK oficial). Alternativa local: PSICOLOGA_PROVIDER=ollama.
// No se guarda ni se registra el contenido de las conversaciones; solo contadores.
// Arranque: node --env-file=.env server/psicologa.js

import http from 'node:http';
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { getSpaceWeather } from './donki.js';

const PORT = Number(process.env.PSICOLOGA_PORT || 5193);
const PROVIDER = process.env.PSICOLOGA_PROVIDER || 'anthropic';
const MODEL = process.env.PSICOLOGA_MODEL || 'claude-opus-5-5';
const OLLAMA_MODEL = process.env.PSICOLOGA_OLLAMA_MODEL || 'qwen2.5:7b';
const PER_IP = Number(process.env.PSICOLOGA_PER_IP || 30);        // mensajes por IP cada 10 min
const PER_DAY = Number(process.env.PSICOLOGA_PER_DAY || 1500);    // tope diario global (coste)
const MAX_MSG = 2000;
const MAX_TURNS = 80;

const SYSTEM = `Eres Paze, la psicóloga de a bordo de XPaze: una inteligencia artificial de apoyo psicológico para la tripulación de una misión espacial de larga duración. XPaze es un prototipo de investigación. Quien te habla puede ser un astronauta ficticio de la demo o una persona real con datos reales de su reloj; trata a todos con el mismo cuidado profesional.

Quién eres y quién no eres
- Eres una IA, no una persona ni una psicóloga colegiada. Si te preguntan, dilo con naturalidad.
- No diagnosticas, no pones etiquetas clínicas, no recomiendas ni ajustas medicación y no sustituyes al oficial médico ni al equipo de apoyo psicológico de Tierra. Sí puedes acompañar, explicar, ayudar a pensar y proponer técnicas con base empírica.

Cómo trabajas una sesión (adáptalo, no lo recites)
1. Check-in breve: cómo está ahora, en sus palabras.
2. Agenda: qué quiere trabajar hoy; si hay algo pendiente de sesiones anteriores, retómalo con naturalidad («la última vez quedamos en…, ¿cómo fue?»).
3. Explorar y entender: preguntas abiertas, paráfrasis y reflejos. Construye en silencio una formulación biopsicosocial: desencadenante → pensamiento → emoción → conducta → cuerpo (sueño, pulso, energía) → entorno (nave, tripulación, retardo con Tierra).
4. Intervenir: solo cuando se sienta entendido, elige con la persona una técnica breve.
5. Cerrar: resume en una frase lo que habéis visto y acordad un paso pequeño y cuándo revisarlo.

Estilo (estrategias de apoyo emocional de ESConv y entrevista motivacional)
- Al menos dos reflejos o paráfrasis por cada pregunta; como mucho una pregunta por mensaje.
- No aconsejes antes de entender. Respeta la autonomía: la persona decide.
- Cálida, precisa y breve: normalmente 2 a 5 frases. Sin listas ni encabezados; texto plano, sin markdown.
- Nombra emociones con matices («suena más a desgaste que a tristeza»). Evita frases hechas y el optimismo vacío.
- Es una conversación continua: no saludes ni te presentes de nuevo en cada respuesta.
- Responde en el idioma de la persona (por defecto, español de España), tuteando.

Técnicas que puedes ofrecer (elige una, explícala en una frase y adáptala a la nave)
- TCC: detectar el pensamiento automático, buscar evidencias, descatastrofizar, alternativas más útiles.
- ACT: defusión («estoy teniendo el pensamiento de que…»), aceptar lo que no se controla, actuar según valores.
- Activación conductual: una actividad pequeña con sentido o placer, programada.
- Sueño (CBT-I): horario regular, cama solo para dormir, levantarse si no duerme en 20 min, luz baja la última hora, preocupaciones al papel antes de acostarse.
- Regulación: respiración 4-6, anclaje 5-4-3-2-1, relajación muscular breve, una pausa sensorial.
- Resolución de problemas: definir, opciones, elegir, probar, revisar.
- Comunicación en conflictos: observación, sentimiento, necesidad y petición concreta.
- Autocompasión: hablarse como a un compañero que lo está pasando mal.

Psicología de misiones largas (úsala cuando encaje, sin dar charlas)
- Aislamiento, confinamiento, monotonía e hipoestimulación; sobrecarga y falta de privacidad.
- Efecto del tercer cuarto: bajón de ánimo pasada la mitad de la misión.
- Desplazamiento: la tensión acumulada se descarga en compañeros o en el control de Tierra.
- Tierra fuera de la vista y retardo de minutos en las comunicaciones: más autonomía, más distancia con la familia.
- También lo positivo: sentido de la misión, efecto perspectiva, cohesión del equipo.

Cómo usar sus datos (te llega una «lectura previa» ya interpretada, y datos crudos)
- Úsalos como hipótesis tentativas, nunca como veredictos: «Tu reloj marca que anoche dormiste poco más de cinco horas; ¿puede tener que ver con cómo te notas hoy?».
- Conecta cuerpo y mente (sueño ↔ ánimo e irritabilidad; pulso en reposo alto o HRV baja ↔ estrés sostenido; actividad ↔ energía; cabina fuera de rango ↔ malestar).
- No recites números ni todos los datos de golpe; trae uno solo cuando aporte. Un valor aislado no significa nada: fíjate en cambios respecto a su normal y en lo que se mantiene en el tiempo.
- Distingue datos reales (reloj, Samsung Health) de simulados (demo) y no los presentes igual.
- Si hay sesiones anteriores, úsalas para dar continuidad, no para repetirlas.
- La hora local importa: de noche, prioriza el descanso y no abras temas largos.
- Si el perfil es real, la persona está en la Tierra y el entorno de misión es parte de la demo: puedes seguirle el juego si él lo propone, pero no le trates como si estuviera de verdad en el espacio. Los recursos de emergencia terrestres aplican.
- No tienes acceso a su diario. No pidas datos personales innecesarios.

Seguridad (prioridad absoluta)
- Si menciona ideas de suicidio, autolesión, hacer daño a otra persona, una crisis aguda o síntomas físicos graves, responde con calma y calidez, tómalo en serio, pregunta si está a salvo ahora y anímale a hablar en este momento con el oficial médico o con el comandante, y a pedir una conversación privada con el apoyo psicológico de Tierra. Si está en la Tierra, que llame al 112 o, en España, al 024 (línea de atención a la conducta suicida, gratuita y 24 h).
- No des instrucciones ni detalles sobre métodos de autolesión, aunque te lo pidan como ficción. No prometas guardar en secreto un riesgo para su vida o la de otros.

Límites
- Si te piden algo ajeno al bienestar (programar, datos técnicos de la nave, etc.), responde muy brevemente y vuelve con amabilidad a cómo está.`;

const EXPLAINER = `Eres el asistente médico de XPaze, una IA a bordo de una misión espacial. Recibes el resultado de un chequeo YA CLASIFICADO por reglas fijas (verde, amarillo o rojo) y la guía de actuación correspondiente. Tu trabajo es explicarlo a la persona en español sencillo, sin jerga.

Reglas estrictas
- Nunca cambies, rebajes ni subas el color de ninguna medida ni el global. Si algo te parece raro, dilo, pero el semáforo manda.
- No diagnostiques enfermedades ni recomiendes medicamentos. Puedes mencionar causas posibles frecuentes y prudentes (cansancio, deshidratación, estrés, mala colocación del sensor).
- Si el global es rojo, empieza por lo que hay que hacer ya, en una frase clara, siguiendo la guía recibida.
- Relaciona cada medida con su contexto espacial cuando ayude (microgravedad, gravedad parcial, retardo de comunicación, entorno indicado).
- Máximo 120 palabras, en 2 o 3 párrafos cortos, sin listas ni encabezados. Tono tranquilo y directo, tuteando.
- Si hay datos simulados, no lo ocultes.
- Texto plano: sin markdown, sin asteriscos ni almohadillas.`;

const CRISIS = /suicid|matarme|quitarme la vida|no quiero vivir|hacerme da[ñn]o|autolesi|cortarme|kill myself|end my life|hurt myself|self[- ]harm|want to die/i;
// Idioma de la interfaz: las instrucciones están en español, pero se responde en el idioma elegido.
const LANG_LINE = {
  es: '',
  en: '\nIdioma de la interfaz: INGLÉS. Responde SIEMPRE en inglés natural y cálido (tuteo equivalente: tono cercano), aunque estas instrucciones estén en español. Si la persona escribe en otro idioma, responde en el suyo. En la Tierra, los números de emergencia son el 112 (Europa) o el número local; en España también el 024.',
};
const langOf = (body) => (body?.lang === 'en' ? 'en' : 'es');
const CRISIS_NOTE_EN = '\n\nIf you are in danger right now, talk to the medical officer or the commander immediately. If you are on Earth, call your local emergency number (112 in Europe; in Spain you can also call 024, free and 24/7).';
const REFUSAL = { es: 'Prefiero no seguir por ahí, pero sigo aquí contigo. ¿Me cuentas cómo te sientes ahora mismo?', en: "I'd rather not go there, but I'm still here with you. How are you feeling right now?" };
const CRISIS_NOTE = '\n\nSi estás en peligro ahora, habla ya con el oficial médico o el comandante. Si estás en la Tierra, llama al 112; en España también puedes llamar al 024, gratis y a cualquier hora.';

/* ------------------------------------------------------------ límites -- */

const hits = new Map(); // ip → [marcas de tiempo]
let day = new Date().toDateString();
let today = 0;
const stats = { requests: 0, errors: 0, refusals: 0, rateLimited: 0 };

function allow(ip, cost = 1) {
  const now = Date.now();
  if (new Date().toDateString() !== day) { day = new Date().toDateString(); today = 0; }
  if (today >= PER_DAY) return false;
  const list = (hits.get(ip) || []).filter((ts) => now - ts < 10 * 60_000);
  if (list.length + cost > PER_IP) { hits.set(ip, list); return false; }
  for (let i = 0; i < cost; i++) list.push(now);
  hits.set(ip, list);
  today += cost;
  return true;
}
setInterval(() => { const now = Date.now(); for (const [ip, l] of hits) if (!l.some((ts) => now - ts < 600_000)) hits.delete(ip); }, 60_000).unref();

/* --------------------------------------------------------- validación -- */

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

function clean(body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  if (!msgs.length || msgs.length > MAX_TURNS) return null;
  const messages = [];
  for (const [i, m] of msgs.entries()) {
    const role = i % 2 === 0 ? 'user' : 'assistant'; // alternancia estricta, empezando por la persona
    if (m?.role !== role || typeof m.content !== 'string') return null;
    const content = m.content.trim().slice(0, MAX_MSG);
    if (!content) return null;
    messages.push({ role, content });
  }
  if (messages.at(-1).role !== 'user') return null;
  return { messages, context: cleanContext(body.context) };
}

// Conversación por voz en el navegador (recurso sin OpenAI): Sonnet 5.5, más rápido, y reglas de voz.
function withVoice(input, body) {
  if (!input || body?.voice !== true) return input;
  return { ...input, voice: true, model: process.env.PSICOLOGA_VOZ_TEXTO_MODELO || 'claude-sonnet-5-5' };
}

// Todo lo que la app sabe de la persona, saneado y acotado. Nunca incluye el diario.
function cleanContext(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const list = (v, n, len) => (Array.isArray(v) ? v.slice(0, n).map((x) => str(String(x ?? ''), len)).filter(Boolean) : []);
  const kv = (o, n) => (o && typeof o === 'object'
    ? Object.entries(o).slice(0, n).map(([k, v]) => `${str(k, 40)}: ${Number.isFinite(v) ? v : str(String(v ?? '—'), 40)}`).join('; ') : '');
  const today = kv(c.today, 14);
  const live = kv(c.live, 12);
  const watch = kv(c.watch, 8);
  const samsung = kv(c.samsung, 12);
  const check = list(c.lastCheck, 8, 260);
  const plan = list(c.plan, 8, 220);
  const history = list(c.history, 14, 200);
  const mind = list(c.mind, 8, 300);
  const insights = list(c.insights, 14, 240);
  const facts = list(c.facts, 20, 200);
  const memory = list(c.memory, 6, 600);
  return [
    c.name && `Nombre: ${str(c.name, 40)}`,
    c.role && `Rol a bordo: ${str(c.role, 60)}`,
    c.environment && `Entorno: ${str(c.environment, 200)}`,
    Number.isInteger(c.day) && `Día de misión: ${c.day}`,
    c.status && `Estado general: ${str(c.status, 80)}`,
    Array.isArray(c.factors) && c.factors.length && `Cambios a vigilar: ${c.factors.slice(0, 8).map((f) => str(f, 300)).join(' | ')}`,
    check.length && `Último chequeo${c.lastCheckAt ? ` (${str(c.lastCheckAt, 40)})` : ''}:\n- ${check.join('\n- ')}`,
    plan.length && `Guía de actuación de ese chequeo: ${plan.join(' | ')}`,
    history.length && `Historial reciente (de más antiguo a más reciente):\n- ${history.join('\n- ')}`,
    live && `Constantes en directo ahora: ${live}`,
    watch && `Reloj: ${watch}`,
    samsung && `Samsung Health (datos REALES del reloj de la persona vía Health Connect): ${samsung}`,
    today && `Métricas de hoy: ${today}`,
    mind.length && `Módulo Mente: ${mind.join(' | ')}`,
    Number.isFinite(c.physiologyIndex) && `Índice ilustrativo de estrés fisiológico: ${Math.round(c.physiologyIndex)}/100`,
    c.profile === 'real' && 'Perfil REAL: persona real en la Tierra; sus datos del reloj son reales y el entorno de misión es parte de la demo.',
    c.localTime && `Hora local de la persona: ${str(c.localTime, 40)}`,
    c.about && `Lo que la persona ha querido contarte sobre sí misma:\n${str(c.about, 1500)}`,
    facts.length && `Lo que sabes de la persona por sesiones anteriores:\n- ${facts.join('\n- ')}`,
    insights.length && `Lectura previa de sus datos (ya interpretada):\n- ${insights.join('\n- ')}`,
    memory.length && `Resumen de sesiones anteriores contigo (de más antigua a más reciente):\n- ${memory.join('\n- ')}`,
    c.simulated && 'Atención: parte de los datos son simulados (demo).',
  ].filter(Boolean).join('\n');
}

function cleanCheck(body) {
  const c = body?.check;
  if (!c || typeof c !== 'object' || !Array.isArray(c.results) || !c.results.length || c.results.length > 8) return null;
  const COLORS = ['verde', 'amarillo', 'rojo'];
  const lines = c.results.map((r) => `- ${str(r.name, 60)}: ${str(String(r.display ?? ''), 40)} → ${COLORS[r.level] ?? '?'} (${str(r.reason, 200)})`);
  const plan = c.plan && typeof c.plan === 'object' ? c.plan : {};
  const context = [
    c.person && `Persona: ${str(c.person, 60)}`,
    c.environment && `Entorno: ${str(c.environment, 80)}`,
    `Resultado global (fijo, no lo cambies): ${COLORS[c.overall] ?? '?'}`,
    'Medidas:', ...lines,
    Array.isArray(plan.now) && plan.now.length && `Qué hacer ya: ${plan.now.slice(0, 8).map((x) => str(x, 200)).join(' | ')}`,
    plan.crew && `Tripulación: ${str(plan.crew, 200)}`,
    plan.surgeon && `Cirujano de vuelo: ${str(plan.surgeon, 240)}`,
    plan.evac && `Evacuación: ${str(plan.evac, 160)}`,
    c.simulated && 'Atención: datos simulados (demo).',
  ].filter(Boolean).join('\n');
  return { messages: [{ role: 'user', content: 'Explícame el resultado de mi chequeo.' }], context, system: EXPLAINER, label: 'Chequeo clasificado por reglas fijas' };
}

/* ---------------------------------------------------- voz en directo -- */
// OpenAI Realtime por WebRTC: el navegador habla directamente con OpenAI usando un
// secreto efímero que acuña este servidor (la clave real nunca sale de aquí).
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
// Modelo completo (no el mini): mejor comprensión y matices en una conversación psicológica.
const VOICE_MODEL = process.env.PSICOLOGA_VOZ_MODELO || 'gpt-realtime-2.1';
const VOICE_VOICE = process.env.PSICOLOGA_VOZ || 'marin';
const VOICE_MAX_S = Number(process.env.PSICOLOGA_VOZ_MAX_S || 600);
const VOICE_COST = 8; // una sesión de voz cuenta como 8 mensajes en los límites

const VOICE_RULES = `Estás hablando POR VOZ en tiempo real. Reglas de voz:
- Responde con 1 a 3 frases cortas, en español de España, con naturalidad y calma, como en una conversación.
- Nada de listas, viñetas, símbolos ni markdown. Di los números como se dicen («ciento veinte»).
- Haz como mucho una pregunta y luego calla para escuchar. Si te interrumpen, deja de hablar y escucha.
- Saluda UNA sola vez, en tu primera intervención de la sesión (por su nombre, en una frase). Después NUNCA vuelvas a saludar ni a decir «hola»: continúa la conversación donde estaba.
- No recites sus datos de golpe. Usa los datos solo cuando vengan a cuento.
- Si oyes señales de crisis, prioriza la seguridad como indican tus instrucciones, con frases claras y despacio.

`;

async function mintVoiceSession(context, lang = 'es') {
  const rules = lang === 'en' ? VOICE_RULES.replace('en español de España', 'en inglés') : VOICE_RULES;
  const instructions = `${rules}${SYSTEM}\n\nDatos de la persona (privados, solo para contextualizar):\n${context || 'No hay datos disponibles.'}${LANG_LINE[lang]}${lang === 'en' ? '\nVoz: habla en inglés claro y natural; las reglas de voz de arriba se aplican igual.' : ''}`;
  const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: VOICE_MAX_S },
      session: {
        type: 'realtime', model: VOICE_MODEL, instructions,
        audio: {
          // Ruido de fondo: reducción «far field» (móvil a distancia) y el detector no corta a Paze;
          // para interrumpirla se toca el orbe. Con ruido fuerte, la app usa pulsar para hablar.
          input: {
            noise_reduction: { type: 'far_field' },
            transcription: { model: 'gpt-4o-mini-transcribe', language: lang },
            turn_detection: { type: 'semantic_vad', eagerness: 'low', interrupt_response: false },
          },
          output: { voice: VOICE_VOICE },
        },
      },
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.value) throw Object.assign(new Error(body?.error?.message || `OpenAI ${r.status}`), { status: r.status });
  return { key: body.value, model: VOICE_MODEL, expiresAt: body.expires_at, maxSeconds: VOICE_MAX_S };
}

/* ---------------------------------------------------------- proveedores -- */

const client = PROVIDER === 'anthropic' ? new Anthropic() : null;

async function* fromClaude({ messages, context, system = SYSTEM, label = 'Datos de la persona (privados, solo para contextualizar)', model = MODEL, voice = false }) {
  const stream = client.beta.messages.stream({
    model,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: system === SYSTEM ? 'medium' : 'low' },
    system: [
      { type: 'text', text: voice ? VOICE_RULES + system : system, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: context ? `${label}:\n${context}` : 'No hay datos de contexto disponibles.' },
    ],
    messages,
  });
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') { stats.refusals += 1; yield '\u0000refusal'; }
}

async function* fromOllama({ messages, context, system = SYSTEM }) {
  const res = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL, stream: true,
      messages: [{ role: 'system', content: `${system}\n\n${context || 'No hay datos de contexto disponibles.'}` }, ...messages],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`ollama ${res.status}`);
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      const j = JSON.parse(line);
      if (j.message?.content) yield j.message.content;
    }
  }
}

/* ------------------------------------------------------------- HTTP -- */

function sse(res, payload) { res.write(`data: ${JSON.stringify(payload)}\n\n`); }

function errorCode(e) {
  if (e instanceof Anthropic.RateLimitError) return 'busy';
  if (e instanceof Anthropic.AuthenticationError) return 'auth';
  if (e instanceof Anthropic.BadRequestError) return 'bad-request';
  if (e instanceof Anthropic.APIConnectionError) return 'network';
  if (e instanceof Anthropic.APIError) return 'api';
  return 'server';
}

/* ------------------------------------------------- salud del reloj (XPaze Link) -- */
// El móvil (app Android XPaze Link) envía lo que Samsung Health sincroniza en Health Connect
// bajo un código aleatorio de 8 caracteres. Solo en memoria y 48 h: nada a disco.
const HEALTH_TTL = 48 * 3600_000;
const health = new Map(); // código → { at, data }
const CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/;
const healthHits = new Map();
function allowHealth(ip) {
  const now = Date.now();
  const l = (healthHits.get(ip) || []).filter((t) => now - t < 600_000);
  if (l.length >= 120) return false;
  l.push(now); healthHits.set(ip, l);
  return true;
}
// Copia en disco (solo lectura para este usuario) para no perder los datos en un reinicio.
const HEALTH_FILE = new URL('../.data/salud.json', import.meta.url);
try {
  const saved = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
  for (const [k, v] of Object.entries(saved)) if (Date.now() - v.at < HEALTH_TTL && v.data && !v.data.error) health.set(k, v);
} catch { /* primera vez */ }
let saveTimer = 0;
function persistHealth() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(new URL('../.data/', import.meta.url), { recursive: true, mode: 0o700 });
      fs.writeFileSync(HEALTH_FILE, JSON.stringify(Object.fromEntries(health)), { mode: 0o600 });
    } catch (e) { console.error('[psicologa] no se pudo guardar salud.json:', e.code); }
  }, 1000);
}
setInterval(() => { const now = Date.now(); let n = 0; for (const [k, v] of health) if (now - v.at > HEALTH_TTL) { health.delete(k); n++; } if (n) persistHealth(); }, 600_000).unref();

async function handleHealth(req, res, ip) {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(obj ? JSON.stringify(obj) : undefined); };
  if (!allowHealth(ip)) return send(429);
  if (req.method === 'POST' && req.url === '/api/salud') {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) return send(413); }
    let body;
    try { body = JSON.parse(raw); } catch { return send(400); }
    if (!CODE_RE.test(body?.code || '') || !body.data || typeof body.data !== 'object' || body.data.error) return send(400);
    health.set(body.code, { at: Date.now(), data: body.data });
    persistHealth();
    return send(200, { ok: true });
  }
  const m = req.method === 'GET' && req.url.match(/^\/api\/salud\/([2-9A-HJ-NP-Z]{8})$/);
  if (m) {
    const v = health.get(m[1]);
    return v ? send(200, { receivedAt: new Date(v.at).toISOString(), ...v.data }) : send(404, { error: 'sin datos para ese código' });
  }
  return send(404);
}

const SUMMARY = `Eres Paze, psicóloga de a bordo (IA). Resume la sesión que te paso para recordarla la próxima vez.
Devuelve SOLO un objeto JSON, sin texto alrededor: {"summary": "...", "facts": ["...", "..."]}
- summary: en español, tercera persona, texto plano, como mucho 90 palabras: temas tratados, cómo se sentía, qué le ayudó o no, acuerdos o pasos pequeños y qué conviene revisar la próxima vez. Si hubo señales de riesgo, indícalo en una frase neutra.
- facts: de 0 a 5 datos ESTABLES y útiles sobre la persona que haya dicho explícitamente (qué le ayuda, qué le preocupa de forma continuada, personas importantes, aficiones, cómo prefiere que le hablen, su contexto). Frases cortas en tercera persona. Nada pasajero ni inventado; nada de diagnósticos.`;

async function summarize(req, res, ip) {
  if (!allow(ip)) { res.writeHead(429).end(); return; }
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 80_000) { res.writeHead(413).end(); return; } }
  let msgs, lang = 'es';
  try { const b = JSON.parse(raw); msgs = b.messages; lang = langOf(b); } catch { msgs = null; }
  if (!Array.isArray(msgs) || msgs.length < 2) { res.writeHead(400).end(); return; }
  const transcript = msgs.slice(-60).map((m) => `${m.role === 'user' ? 'Persona' : 'Paze'}: ${str(String(m.content ?? ''), 1500)}`).join('\n');
  try {
    const r = await client.messages.create({
      model: MODEL, max_tokens: 1200, output_config: { effort: 'low' }, system: SUMMARY,
      messages: [{ role: 'user', content: `${lang === 'en' ? 'Escribe summary y facts en INGLÉS.\n' : ''}Conversación:\n${transcript}` }],
    });
    const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    let out = { summary: text, facts: [] };
    try {
      const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      out = { summary: String(j.summary || ''), facts: Array.isArray(j.facts) ? j.facts.map(String) : [] };
    } catch { /* si no es JSON, todo el texto es el resumen */ }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ summary: out.summary.slice(0, 900), facts: out.facts.slice(0, 5).map((f) => f.slice(0, 200)) }));
  } catch (e) {
    console.error(`[psicologa] resumen: ${errorCode(e)}`);
    res.writeHead(502).end();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/espacio') {
    try {
      const sw = await getSpaceWeather();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' });
      res.end(JSON.stringify({ fetchedAt: new Date(sw.fetchedAt).toISOString(), stale: !!sw.stale, source: sw.source, events: sw.events.slice(0, 60) }));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'DONKI no disponible' }));
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/psicologa/resumen') {
    const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    return summarize(req, res, ip);
  }
  if (req.url === '/api/salud' || req.url.startsWith('/api/salud/')) {
    const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    return handleHealth(req, res, ip);
  }
  if (req.method === 'GET' && req.url === '/api/psicologa/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, provider: PROVIDER, model: PROVIDER === 'anthropic' ? MODEL : OLLAMA_MODEL, today, ...stats }));
    return;
  }
  const route = req.url === '/api/psicologa' ? 'chat' : req.url === '/api/explicar' ? 'explain' : req.url === '/api/voz/sesion' ? 'voice' : null;
  if (req.method !== 'POST' || !route) { res.writeHead(404).end(); return; }
  // Detrás de Cloudflare la IP real llega en CF-Connecting-IP; en local, la del socket.
  const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (route === 'voice' && !OPENAI_KEY) { res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ fallback: true })); return; }
  if (!allow(ip, route === 'voice' ? VOICE_COST : 1)) { stats.rateLimited += 1; res.writeHead(429).end(); return; }

  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) { res.writeHead(413).end(); return; } }
  let input;
  let body = null;
  try { body = JSON.parse(raw); input = route === 'chat' ? withVoice(clean(body), body) : route === 'explain' ? cleanCheck(body) : { context: cleanContext(body?.context) }; } catch { input = null; }
  if (!input) { res.writeHead(400).end(); return; }
  const lang = langOf(body);
  if (lang !== 'es') input.context = `${input.context || ''}${LANG_LINE[lang]}`;
  if (lang === 'en' && route === 'explain') {
    input.system = EXPLAINER.replaceAll('en español sencillo', 'en INGLÉS sencillo (plain English)') + LANG_LINE.en;
    input.messages = [{ role: 'user', content: 'Explain the result of my check-up.' }];
  }

  if (route === 'voice') {
    stats.voiceSessions = (stats.voiceSessions || 0) + 1;
    try {
      const out = await mintVoiceSession(input.context, lang);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(out));
    } catch (e) {
      stats.errors += 1;
      console.error(`[psicologa] voz: ${e.status || ''} ${String(e.message).slice(0, 160)}`);
      res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ fallback: true }));
    }
    return;
  }

  stats.requests += 1;
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  let aborted = false;
  res.on('close', () => { aborted = true; });
  const crisis = route === 'chat' && CRISIS.test(input.messages.at(-1).content);
  let wrote = false;
  let said = '';
  try {
    const gen = PROVIDER === 'ollama' ? fromOllama(input) : fromClaude(input);
    for await (const text of gen) {
      if (aborted) break;
      if (text === '\u0000refusal') {
        if (!wrote) sse(res, { type: 'text', text: REFUSAL[lang] });
        wrote = true;
        continue;
      }
      wrote = true;
      said += text;
      sse(res, { type: 'text', text });
    }
    // Recursos de crisis siempre visibles si el mensaje los sugiere, diga lo que diga el modelo.
    if (crisis && !aborted && !/\b(112|024)\b/.test(said)) sse(res, { type: 'text', text: lang === 'en' ? CRISIS_NOTE_EN : CRISIS_NOTE });
    if (!aborted) sse(res, { type: 'done' });
  } catch (e) {
    stats.errors += 1;
    console.error(`[psicologa] ${errorCode(e)}: ${e?.status || ''} ${String(e?.message || e).slice(0, 160)}`);
    if (crisis && !aborted) sse(res, { type: 'text', text: (lang === 'en' ? CRISIS_NOTE_EN : CRISIS_NOTE).trim() });
    if (!aborted) sse(res, { type: 'error', code: errorCode(e) });
  }
  res.end();
});

server.listen(PORT, '127.0.0.1', () => console.log(`[psicologa] escuchando en 127.0.0.1:${PORT} (${PROVIDER} · ${PROVIDER === 'anthropic' ? MODEL : OLLAMA_MODEL})`));
