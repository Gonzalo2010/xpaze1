// Cliente de la IA de XPaze (server/psicologa.js), relativo a /app/:
//   api/explicar   explica un chequeo ya clasificado por reglas fijas
//   api/psicologa  conversación de apoyo
// Respuesta en streaming (text/event-stream): {"type":"text"|"done"|"error"}.

const plain = (s) => s.replace(/\*\*|__|^#+\s*/gm, '');

export async function streamAI(path, body, onText, signal) {
  const res = await fetch(new URL(`api/${path}`, location.href), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!res.ok || !res.body) throw new Error(res.status === 429 ? 'rate' : `http ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '';
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
      if (ev.type === 'text') { text += ev.text; onText(plain(text)); }
      if (ev.type === 'error') throw new Error(ev.code || 'api');
    }
  }
  if (!text) throw new Error('empty');
  return plain(text);
}
