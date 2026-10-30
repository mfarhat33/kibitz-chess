// Small helpers around chess.js shared by every view.
import { Chess } from './lib/chess.js';

export { Chess };
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function dests(chess) {
  const map = new Map();
  if (chess.isGameOver()) return map;
  for (const m of chess.moves({ verbose: true })) {
    if (!map.has(m.from)) map.set(m.from, []);
    const arr = map.get(m.from);
    if (!arr.includes(m.to)) arr.push(m.to);
  }
  return map;
}

export function colorName(c) { return c === 'w' ? 'white' : 'black'; }
export function other(c) { return c === 'w' ? 'b' : 'w'; }

export function uciToMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}
export function moveToUci(m) { return m.from + m.to + (m.promotion || ''); }

/** Play a UCI move on a chess.js instance; returns the verbose move or null. */
export function playUci(chess, uci) {
  try { return chess.move(uciToMove(uci)); } catch { return null; }
}

/** Convert a UCI line to SAN starting at fen; stops at the first illegal move. */
export function uciLineToSan(fen, ucis, max = 99) {
  const c = new Chess(fen);
  const out = [];
  for (const u of ucis.slice(0, max)) {
    const m = playUci(c, u);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

/** "12. Nf3 Nc6 13. Bb5" style text for a SAN line starting at fen. */
export function formatLine(fen, sans) {
  const parts = fen.split(' ');
  let num = +parts[5] || 1;
  let white = parts[1] === 'w';
  const out = [];
  sans.forEach((s, i) => {
    if (white) out.push(`${num}.`);
    else if (i === 0) out.push(`${num}...`);
    out.push(s);
    if (!white) num++;
    white = !white;
  });
  return out.join(' ');
}

export function checkSquare(chess) {
  if (!chess.inCheck()) return null;
  const turn = chess.turn();
  for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === turn) return p.square;
  return null;
}

/** Material in pawns for each colour, and the captured pieces relative to the start. */
export function material(chess) {
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of chess.board()) for (const p of row) if (p && p.type !== 'k') count[p.color][p.type]++;
  const score = (c) => Object.entries(count[c]).reduce((s, [t, n]) => s + VALUES[t] * n, 0);
  return { count, w: score('w'), b: score('b') };
}

export function materialFromFen(fen) {
  let w = 0, b = 0;
  for (const ch of fen.split(' ')[0]) {
    const t = ch.toLowerCase();
    if (!(t in VALUES)) continue;
    if (ch === t) b += VALUES[t]; else w += VALUES[t];
  }
  return { w, b };
}

/** Non-pawn, non-king piece count: used to split games into phases. */
export function pieceCount(fen) {
  let n = 0;
  for (const ch of fen.split(' ')[0]) if ('nbrqNBRQ'.includes(ch)) n++;
  return n;
}

export function gameOverInfo(chess) {
  if (chess.isCheckmate()) return { result: chess.turn() === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
  if (chess.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'insufficient material' };
  if (chess.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'threefold repetition' };
  if (chess.isDrawByFiftyMoves()) return { result: '1/2-1/2', reason: 'the 50-move rule' };
  return null;
}

/** Whether a side has mating material at all (used when a clock flags). */
export function canMate(chess, color) {
  const { count } = material(chess);
  const c = count[color];
  if (c.p || c.r || c.q) return true;
  return c.n + c.b >= 2 || (c.b >= 1 && c.n >= 1);
}

export function fenAfterUcis(fen, ucis) {
  const c = new Chess(fen);
  for (const u of ucis) if (!playUci(c, u)) break;
  return c.fen();
}
