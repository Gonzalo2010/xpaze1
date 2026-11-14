// Isolation Forest (Liu, Ting y Zhou, 2008), pequeño pero completo.
// Idea: un punto raro se aísla con pocos cortes al azar; uno normal necesita muchos.

const EULER = 0.5772156649;

// Longitud media de camino de una búsqueda fallida en un árbol binario de n puntos.
export function cFactor(n) {
  if (n > 2) return 2 * (Math.log(n - 1) + EULER) - (2 * (n - 1)) / n;
  return n === 2 ? 1 : 0;
}

function sampleIndices(n, k, rng) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng.next() * (n - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, k);
}

function grow(rows, depth, maxDepth, rng) {
  if (rows.length <= 1 || depth >= maxDepth) return { size: rows.length };
  const dims = rows[0].length;
  const usable = [];
  for (let q = 0; q < dims; q++) {
    let lo = Infinity, hi = -Infinity;
    for (const r of rows) { if (r[q] < lo) lo = r[q]; if (r[q] > hi) hi = r[q]; }
    if (hi > lo) usable.push([q, lo, hi]);
  }
  if (!usable.length) return { size: rows.length };
  const [feature, lo, hi] = usable[Math.floor(rng.next() * usable.length)];
  const split = lo + (hi - lo) * rng.next();
  const left = [], right = [];
  for (const r of rows) (r[feature] < split ? left : right).push(r);
  return {
    feature, split, size: rows.length,
    left: grow(left, depth + 1, maxDepth, rng),
    right: grow(right, depth + 1, maxDepth, rng),
  };
}

export function buildForest(data, { trees = 100, sampleSize = 32, rng }) {
  const psi = Math.min(sampleSize, data.length);
  const maxDepth = Math.ceil(Math.log2(Math.max(2, psi)));
  const list = [];
  for (let t = 0; t < trees; t++) {
    const rows = sampleIndices(data.length, psi, rng).map((i) => data[i]);
    list.push(grow(rows, 0, maxDepth, rng));
  }
  return { trees: list, psi, maxDepth, dims: data[0]?.length ?? 0 };
}

// Recorre un árbol con x. Devuelve la profundidad ajustada y los cortes del camino.
export function tracePath(tree, x) {
  const path = [];
  let node = tree, depth = 0;
  while (node.left) {
    const goLeft = x[node.feature] < node.split;
    path.push({ feature: node.feature, split: node.split, left: goLeft });
    node = goLeft ? node.left : node.right;
    depth++;
  }
  return { length: depth + cFactor(node.size), depth, path };
}

export function pathLengths(forest, x) {
  return forest.trees.map((tr) => tracePath(tr, x).length);
}

// Puntuación en (0, 1): ~0,5 normal; hacia 1, anómalo.
export function anomalyScore(forest, x) {
  const lens = pathLengths(forest, x);
  let s = 0;
  for (const l of lens) s += l;
  return 2 ** (-(s / lens.length) / cFactor(forest.psi));
}

// Cuánto baja la puntuación si una variable vuelve a su valor de referencia.
// Sirve para explicar qué señales hacen raro al punto.
export function contributions(forest, x, reference) {
  const base = anomalyScore(forest, x);
  return x.map((_, j) => {
    const y = x.slice();
    y[j] = reference ? reference[j] : 0;
    return base - anomalyScore(forest, y);
  });
}
