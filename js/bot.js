// Bot levels and move choice. Below 2400 the bot runs a shallow multi-line search and then picks
// among the candidates with a temperature that shrinks as the level rises, plus an occasional
// outright blunder, which plays more like a human of that rating than Stockfish's own skill limit.
import { Chess, moveToUci } from './chessutil.js';

export const LEVELS = [
  { elo: 400, name: 'Sprout', blurb: 'Brand new to chess. Leaves pieces hanging often.' },
  { elo: 600, name: 'Pebble', blurb: 'Knows the rules, misses simple threats.' },
  { elo: 800, name: 'Maple', blurb: 'Spots one-move threats, still blunders.' },
  { elo: 1000, name: 'Juniper', blurb: 'Casual player who punishes free pieces.' },
  { elo: 1100, name: 'Hazel', blurb: 'Improving club newcomer. A good sparring partner.' },
  { elo: 1200, name: 'Cedar', blurb: 'Solid basics, finds short tactics.' },
  { elo: 1400, name: 'Ember', blurb: 'Club player with a feel for tactics.' },
  { elo: 1600, name: 'Quartz', blurb: 'Strong club player. Few outright blunders.' },
  { elo: 1800, name: 'Falcon', blurb: 'Tournament player. Calculates well.' },
  { elo: 2000, name: 'Orion', blurb: 'Expert. Converts advantages cleanly.' },
  { elo: 2200, name: 'Titan', blurb: 'Master level. Very hard to beat.' },
  { elo: 2500, name: 'Nova', blurb: 'Grandmaster strength (Stockfish limited to 2500).' },
  { elo: 0, name: 'Stockfish', blurb: 'Full strength. No limits at all.', max: true },
];
export const DEFAULT_LEVEL = 4; // 1100

export function levelLabel(level) {
  return level.max ? 'Full strength' : `${level.elo}`;
}

// elo, search depth, temperature (centipawns), blunder probability
const ANCHORS = [
  [400, 1, 320, 0.2],
  [700, 2, 200, 0.12],
  [1000, 4, 120, 0.065],
  [1300, 6, 75, 0.035],
  [1600, 8, 45, 0.016],
  [1900, 10, 25, 0.006],
  [2200, 13, 12, 0.0015],
];

export function botParams(elo) {
  const a = ANCHORS;
  if (elo <= a[0][0]) return { depth: a[0][1], temp: a[0][2], blunder: a[0][3] };
  for (let i = 1; i < a.length; i++) {
    if (elo <= a[i][0]) {
      const t = (elo - a[i - 1][0]) / (a[i][0] - a[i - 1][0]);
      const lerp = (k) => a[i - 1][k] + (a[i][k] - a[i - 1][k]) * t;
      return { depth: Math.round(lerp(1)), temp: lerp(2), blunder: lerp(3) };
    }
  }
  const l = a[a.length - 1];
  return { depth: l[1], temp: l[2], blunder: l[3] };
}

function scoreOf(line) {
  if (line.mate != null) return line.mate > 0 ? 20000 - line.mate * 10 : -20000 - line.mate * 10;
  return line.cp ?? 0;
}

/** Pure selection step so it can be tested: candidates [{uci, score}] -> uci. */
export function pickCandidate(cands, temp, rand = Math.random) {
  const best = Math.max(...cands.map(c => c.score));
  const weights = cands.map(c => Math.exp(-Math.min(best - c.score, 1200) / temp));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < cands.length; i++) {
    r -= weights[i];
    if (r <= 0) return cands[i].uci;
  }
  return cands[0].uci;
}

/** Returns the bot's move in UCI. `timeLeft` (ms) shortens thinking under a clock. */
export async function chooseBotMove(engine, fen, level, { timeLeft = null, rand = Math.random } = {}) {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  if (!legal.length) return null;
  if (legal.length === 1) return moveToUci(legal[0]);
  const cap = timeLeft == null ? null : Math.max(80, Math.min(2500, timeLeft / 25));
  if (level.max) {
    const r = await engine.analyze(fen, { depth: 22, movetime: cap ? Math.min(cap, 2500) : 2500 });
    return r?.bestmove || moveToUci(legal[0]);
  }
  if (level.elo >= 2400) {
    const r = await engine.analyze(fen, { elo: level.elo, movetime: cap ? Math.min(cap, 1200) : 1200 });
    return r?.bestmove || moveToUci(legal[0]);
  }
  const p = botParams(level.elo);
  if (rand() < p.blunder) {
    return moveToUci(legal[Math.floor(rand() * legal.length)]);
  }
  const r = await engine.analyze(fen, { depth: p.depth, multipv: Math.min(6, legal.length), movetime: cap ? Math.min(cap, 1500) : 1500 });
  if (!r || !r.lines.length) return r?.bestmove || moveToUci(legal[0]);
  const cands = r.lines.filter(l => l.pv?.length).map(l => ({ uci: l.pv[0], score: scoreOf(l) }));
  return pickCandidate(cands, p.temp, rand);
}
