// DONKI (NASA CCMC): avisos de clima espacial de los últimos 7 días.
// Una sola consulta (notifications, type=all) cada 3 horas, en caché: cabe en el límite
// de la clave pública DEMO_KEY. Con NASA_API_KEY propia (api.nasa.gov) no hay que tocar nada más.
// Si la consulta falla, se sirve la última copia buena.

const KEY = process.env.NASA_API_KEY || 'DEMO_KEY';
const TTL = 3 * 3600_000;
let cache = null; // { fetchedAt, events, stale? }
let inflight = null;

const day = (d) => d.toISOString().slice(0, 10);

// Extrae de cada notificación lo que usan las reglas (src/app/space.js).
export function parseNotifications(list = []) {
  const out = [];
  for (const n of list) {
    const type = n.messageType;
    if (!['SEP', 'FLR', 'GST', 'RBE', 'CME', 'IPS', 'MPC'].includes(type)) continue;
    const body = n.messageBody || '';
    const sm = /## Summary:\s*([\s\S]*?)(?:\n##|$)/.exec(body);
    const summary = (sm ? sm[1] : body).replace(/\s+/g, ' ').trim().slice(0, 280);
    const ev = { type, time: n.messageIssueTime ? new Date(n.messageIssueTime.replace(/Z?$/, 'Z')).toISOString() : null, summary, url: n.messageURL || null };
    if (!ev.time || Number.isNaN(Date.parse(ev.time))) continue;
    if (type === 'FLR') { const m = /\b([MX]\d+(?:\.\d+)?)\b/.exec(summary); if (m) ev.flare = m[1]; }
    if (type === 'GST') { const m = /Kp index has reached level ([\d.]+)/i.exec(summary); if (m) ev.kp = parseFloat(m[1]); }
    out.push(ev);
  }
  return out.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

async function fetchNow() {
  const end = new Date();
  const start = new Date(end - 7 * 86400_000);
  const url = `https://api.nasa.gov/DONKI/notifications?startDate=${day(start)}&endDate=${day(end)}&type=all&api_key=${KEY}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`DONKI ${r.status}`);
  return parseNotifications(await r.json());
}

export async function getSpaceWeather() {
  if (cache && Date.now() - cache.fetchedAt < TTL) return cache;
  inflight ||= fetchNow()
    .then((events) => { cache = { fetchedAt: Date.now(), events, source: 'DONKI · NASA Community Coordinated Modeling Center' }; return cache; })
    .catch((e) => {
      console.error(`[espacio] ${e.message}`);
      if (cache) return { ...cache, stale: true };
      throw e;
    })
    .finally(() => { inflight = null; });
  return inflight;
}
