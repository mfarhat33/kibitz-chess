// Opening names and book moves from the Lichess chess-openings dataset (CC0), indexed by position.
import { Chess, playUci, START_FEN } from './chessutil.js';
import { posKey } from './poskey.js';

let promise = null;
let data = null;

export function loadOpenings() {
  if (!promise) {
    promise = fetch(new URL('../data/openings.json', import.meta.url))
      .then(r => { if (!r.ok) throw new Error('openings ' + r.status); return r.json(); })
      .then(d => { data = d; return d; })
      .catch(err => { promise = null; throw err; });
  }
  return promise;
}

export function openingsReady() { return !!data; }

function lineInfo(idx) {
  const l = data.lines[idx];
  return l ? { idx, eco: l[0], name: l[1], moves: l[2] ? l[2].split(' ') : [] } : null;
}

/** Exact name for a position, or null. */
export function nameAt(fen) {
  if (!data) return null;
  const e = data.pos[posKey(fen)];
  return e && e[0] >= 0 ? lineInfo(e[0]) : null;
}

export function isBook(fen) {
  return !!data && !!data.pos[posKey(fen)];
}

/** Deepest named position reached by a sequence of moves. */
export function openingOf(moves, startFen = START_FEN) {
  if (!data) return null;
  const c = new Chess(startFen);
  let found = null;
  let ply = 0;
  for (const u of moves) {
    if (!playUci(c, u)) break;
    ply++;
    const n = nameAt(c.fen());
    if (n) found = { ...n, ply };
    else if (!isBook(c.fen()) && ply > 4) break;
  }
  return found;
}

/** Book continuations from a position: [{ uci, san, name, eco, named }] */
export function continuations(fen) {
  if (!data) return [];
  const e = data.pos[posKey(fen)];
  if (!e || !e[1]) return [];
  const out = [];
  for (const u of e[1]) {
    const c = new Chess(fen);
    const m = playUci(c, u);
    if (!m) continue;
    const next = data.pos[posKey(c.fen())];
    const info = next ? lineInfo(next[0] >= 0 ? next[0] : next[2]) : null;
    out.push({ uci: u, san: m.san, name: info?.name || '', eco: info?.eco || '', named: !!next && next[0] >= 0, lines: next?.[1]?.length || 0, depth: next ? theorySize(c.fen()) : 0 });
  }
  // main moves first: the ones with the most opening theory after them
  return out.sort((a, b) => (b.depth - a.depth) || (b.named - a.named) || (b.lines - a.lines) || a.san.localeCompare(b.san));
}

// how many known positions follow a position (memoised; transpositions are fine, cycles are cut)
const sizeMemo = new Map();
function theorySize(fen) {
  const key = posKey(fen);
  if (sizeMemo.has(key)) return sizeMemo.get(key);
  sizeMemo.set(key, 0);
  const e = data.pos[key];
  let n = 1;
  for (const u of e?.[1] || []) {
    const c = new Chess(fen);
    if (!playUci(c, u)) continue;
    if (data.pos[posKey(c.fen())]) n += theorySize(c.fen());
  }
  sizeMemo.set(key, n);
  return n;
}

export function bookMoves(fen) {
  if (!data) return [];
  const e = data.pos[posKey(fen)];
  return e?.[1] || [];
}

/** Search opening lines by name (all words must match). */
export function searchLines(query, limit = 40) {
  if (!data) return [];
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (let i = 0; i < data.lines.length && out.length < limit; i++) {
    const l = data.lines[i];
    const hay = (l[0] + ' ' + l[1]).toLowerCase();
    if (words.every(w => hay.includes(w))) out.push(lineInfo(i));
  }
  return out;
}

export function lineByIndex(i) { return data ? lineInfo(i) : null; }

/** Short family name, e.g. "Sicilian Defense" from "Sicilian Defense: Najdorf Variation". */
export function family(name) {
  return (name || 'Unknown').split(':')[0].trim();
}
