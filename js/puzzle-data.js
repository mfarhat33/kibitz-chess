// Loads rating buckets of Lichess puzzles (built by tools/build_puzzles.py) on demand.
const base = new URL('../data/puzzles/', import.meta.url);
let indexPromise = null;
const buckets = new Map();

export function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(new URL('index.json', base))
      .then(r => { if (!r.ok) throw new Error('Puzzle data is not available yet.'); return r.json(); })
      .catch(err => { indexPromise = null; throw err; });
  }
  return indexPromise;
}

export function bucketOf(rating) {
  return Math.max(400, Math.min(3000, Math.floor(rating / 100) * 100));
}

export function loadBucket(b) {
  if (!buckets.has(b)) {
    const name = `r${String(b).padStart(4, '0')}.json`;
    buckets.set(b, fetch(new URL(name, base))
      .then(r => { if (!r.ok) throw new Error('bucket ' + b); return r.json(); })
      .then(rows => rows.map(([id, fen, moves, rating, themes]) => ({ id, fen, moves: moves.split(' '), rating, themes: themes ? themes.split(' ') : [] })))
      .catch(err => { buckets.delete(b); throw err; }));
  }
  return buckets.get(b);
}

/**
 * Picks an unseen puzzle close to `target`. Looks in the target bucket first, then neighbours.
 * opts: { exclude: Set of ids, maxMoves, spread (rating window), filter(puzzle) => bool, rand }
 */
export async function pickPuzzle(target, { exclude = new Set(), maxMoves = 99, spread = 75, filter = null, rand = Math.random } = {}) {
  const index = await loadIndex();
  const have = Object.keys(index.buckets).map(Number);
  const order = [...have].sort((a, b) => Math.abs(a + 50 - target) - Math.abs(b + 50 - target));
  for (let widen = 0; widen < 4; widen++) {
    const window = spread * (1 + widen);
    for (const b of order.slice(0, 2 + widen * 2)) {
      const list = await loadBucket(b);
      const cands = list.filter(p => !exclude.has(p.id) && p.moves.length <= maxMoves && Math.abs(p.rating - target) <= window && (!filter || filter(p)));
      if (cands.length) return cands[Math.floor(rand() * cands.length)];
    }
  }
  // everything nearby has been seen: allow repeats rather than fail
  const list = (await loadBucket(order[0])).filter(p => !filter || filter(p));
  const pool = list.length ? list : await loadBucket(order[0]);
  return pool[Math.floor(rand() * pool.length)];
}

export function prefetch(rating) {
  loadIndex().then(() => loadBucket(bucketOf(rating))).catch(() => {});
}
