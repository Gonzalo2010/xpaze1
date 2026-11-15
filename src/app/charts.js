// Gráficas de la app: ECG en papel milimetrado y «tu normal» (línea base personal).

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Línea base robusta: mediana y banda de ±k desviaciones robustas (MAD·1,4826), como en assess.js. */
export function baselineBand(values, k = 2.5) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (v.length < 5) return null;
  const med = median(v);
  const mad = median(v.map((x) => Math.abs(x - med))) * 1.4826 || 1;
  return { med, lo: med - k * mad, hi: med + k * mad, mad, n: v.length };
}

/**
 * SVG: historial (puntos), la banda de «tu normal» y el valor de hoy resaltado.
 * labels: { normal, today } ya traducidos. fmt: número → texto.
 */
export function baselineChart(history, today, { labels, fmt = (x) => String(Math.round(x)), unit = '' } = {}) {
  const band = baselineBand(history);
  const vals = history.filter((x) => x != null);
  if (!band || today == null) return '';
  const W = 340, H = 120, padL = 8, padR = 56, padT = 12, padB = 18;
  const all = [...vals, today, band.lo, band.hi];
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const y = (v) => padT + (1 - (v - lo + span * 0.08) / (span * 1.16)) * (H - padT - padB);
  const n = vals.length + 1;
  const x = (i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const out = today < band.lo || today > band.hi;
  const pts = vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" class="bl__pt"/>`).join('');
  const line = [...vals, today].map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const tx = x(n - 1), ty = y(today);
  // etiquetas a la derecha sin pisarse: «hoy» junto a su punto y «tu normal» se aparta si hace falta
  const todayY = ty + 4;
  let medY = y(band.med) + 4;
  if (Math.abs(medY - todayY) < 13) medY = todayY + (todayY > H / 2 ? -13 : 13);
  return `<svg class="bl ${out ? 'bl--out' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${labels.normal}: ${fmt(band.lo)}–${fmt(band.hi)} ${unit}. ${labels.today}: ${fmt(today)} ${unit}">
    <rect x="${padL}" y="${y(band.hi).toFixed(1)}" width="${W - padL - padR}" height="${Math.max(2, y(band.lo) - y(band.hi)).toFixed(1)}" rx="6" class="bl__band"/>
    <line x1="${padL}" x2="${W - padR}" y1="${y(band.med).toFixed(1)}" y2="${y(band.med).toFixed(1)}" class="bl__med"/>
    <path d="${line}" class="bl__line"/>${pts}
    <circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="6.5" class="bl__today"/>
    <text x="${W - padR + 8}" y="${medY.toFixed(1)}" class="bl__lbl">${labels.normal}</text>
    <text x="${W - padR + 8}" y="${todayY.toFixed(1)}" class="bl__lbl bl__lbl--today">${fmt(today)}</text>
  </svg>`;
}

/** Pinta el ECG (mV, 250 Hz) en un lienzo con cuadrícula de papel de ECG (25 mm/s, 10 mm/mV). */
export function drawEcg(canvas, samples, { seconds = 4, rate = 250, color = '#e5484d', live = true } = {}) {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  // cuadrícula: 1 s = 5 cuadros grandes
  const big = w / (seconds * 5), small = big / 5;
  g.lineWidth = 1;
  for (let xx = 0; xx <= w; xx += small) { g.strokeStyle = Math.round(xx / small) % 5 ? 'rgba(229,72,77,0.07)' : 'rgba(229,72,77,0.18)'; g.beginPath(); g.moveTo(xx, 0); g.lineTo(xx, h); g.stroke(); }
  for (let yy = h / 2 % small; yy <= h; yy += small) { g.strokeStyle = 'rgba(229,72,77,0.07)'; g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy); g.stroke(); }
  const N = seconds * rate;
  const data = samples.slice(-N);
  if (data.length < 2) return;
  const mid = h * 0.58, mv = h * 0.36; // 1 mV ≈ 36 % de la altura
  g.strokeStyle = color; g.lineWidth = 1.8; g.lineJoin = 'round';
  g.beginPath();
  const off = N - data.length;
  data.forEach((v, i) => { const xx = ((i + off) / (N - 1)) * w; const yy = mid - v * mv; if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy); });
  g.stroke();
  if (live) { g.fillStyle = color; g.beginPath(); g.arc(w - 1, mid - data[data.length - 1] * mv, 3, 0, Math.PI * 2); g.fill(); }
}
