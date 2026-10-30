// Game review maths: win chances, accuracy (same formulas as Lichess), move labels, phases.
import { Chess, playUci, pieceCount, VALUES } from './chessutil.js';
import { toWhite } from './engine.js';

export const LABELS = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'miss', 'mistake', 'blunder'];
export const BAD_LABELS = ['inaccuracy', 'miss', 'mistake', 'blunder'];
export const LABEL_TEXT = {
  brilliant: 'Brilliant', great: 'Great move', best: 'Best', excellent: 'Excellent', good: 'Good', book: 'Book',
  inaccuracy: 'Inaccuracy', miss: 'Miss', mistake: 'Mistake', blunder: 'Blunder',
};
export const LABEL_GLYPH = {
  brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '○', book: 'B',
  inaccuracy: '?!', miss: '✗', mistake: '?', blunder: '??',
};

export const DEPTHS = { fast: 11, standard: 14, deep: 18 };

/**
 * White's winning chances 0..100 from a white-perspective score. Like Lichess, mate counts as
 * +/-1000 centipawns, so a forced mate and a huge material lead are worth almost the same.
 */
export function winPct(score) {
  if (!score) return 50;
  let cp = score.cp ?? 0;
  if (score.mate != null) {
    if (score.mate === 0) cp = score.win === 'w' ? 1000 : score.win === 'b' ? -1000 : 0;
    else cp = score.mate > 0 ? 1000 : -1000;
  }
  cp = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Accuracy of one move from the mover's win% before and after. */
export function moveAccuracy(before, after) {
  if (after >= before) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411 + 1;
  return Math.max(0, Math.min(100, raw));
}

/** Label from the mover's lost winning chances (percentage points). */
export function labelFor(loss, isBest) {
  if (isBest) return 'best';
  if (loss < 2) return 'excellent';
  if (loss < 5) return 'good';
  if (loss < 10) return 'inaccuracy';
  if (loss < 20) return 'mistake';
  return 'blunder';
}

function stdDev(xs) {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

/**
 * Game accuracy per colour, following Lichess: a volatility-weighted mean of move accuracies,
 * averaged with their harmonic mean. `wins` are white win% for positions 0..n.
 */
export function gameAccuracy(wins, startColor = 'w') {
  const n = wins.length - 1;
  if (n < 1) return { w: null, b: null };
  const size = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const windows = [];
  for (let i = 0; i < Math.min(size, wins.length) - 2; i++) windows.push(wins.slice(0, size));
  for (let i = 0; i + size <= wins.length; i++) windows.push(wins.slice(i, i + size));
  const weights = windows.map(w => Math.max(0.5, Math.min(12, stdDev(w))));
  const per = { w: [], b: [] };
  for (let i = 0; i < n; i++) {
    const color = (i % 2 === 0) === (startColor === 'w') ? 'w' : 'b';
    const before = color === 'w' ? wins[i] : 100 - wins[i];
    const after = color === 'w' ? wins[i + 1] : 100 - wins[i + 1];
    per[color].push({ acc: moveAccuracy(before, after), weight: weights[i] ?? 1 });
  }
  const out = {};
  for (const c of ['w', 'b']) {
    const xs = per[c];
    if (!xs.length) { out[c] = null; continue; }
    const wsum = xs.reduce((s, x) => s + x.weight, 0);
    const weighted = xs.reduce((s, x) => s + x.acc * x.weight, 0) / wsum;
    const harmonic = xs.length / xs.reduce((s, x) => s + 1 / Math.max(1, x.acc), 0);
    out[c] = (weighted + harmonic) / 2;
  }
  return out;
}

export function phaseOf(fen, ply) {
  const pc = pieceCount(fen);
  if (pc <= 6) return 'endgame';
  if (ply < 24 && pc >= 11) return 'opening';
  return 'middlegame';
}

/** Positions (FEN) before each move and after the last one. */
export function positions(moves, startFen) {
  const c = new Chess(startFen);
  const fens = [c.fen()];
  for (const u of moves) {
    if (!playUci(c, u)) break;
    fens.push(c.fen());
  }
  return fens;
}

/**
 * Run the engine over every position (two best lines each, so "only move" can be judged).
 * Returns the raw evaluations; classify() turns them into labels. onProgress(done, total). Null if cancelled.
 */
export async function analyzePositions(engine, fens, { depth = DEPTHS.standard, moves = null, onProgress, isCancelled } = {}) {
  const evals = [], best = [], pv = [], second = [];
  // replay the game on one board so repetitions and the 50-move rule are known
  const game = new Chess(fens[0]);
  for (let i = 0; i < fens.length; i++) {
    if (isCancelled?.()) return null;
    if (i > 0 && moves) playUci(game, moves[i - 1]);
    const c = moves ? game : new Chess(fens[i]);
    if (c.isCheckmate()) {
      evals.push({ cp: null, mate: 0, win: c.turn() === 'w' ? 'b' : 'w' });
      best.push(null); pv.push([]); second.push(null);
    } else if (c.isGameOver()) {
      evals.push({ cp: 0, mate: null });
      best.push(null); pv.push([]); second.push(null);
    } else {
      const nLegal = c.moves().length;
      const r = await engine.analyze(fens[i], {
        depth, multipv: Math.min(2, nLegal), movetime: depth >= 18 ? 8000 : 4000,
        startFen: moves ? fens[0] : undefined, moves: moves ? moves.slice(0, i) : undefined,
      });
      if (!r) return null;
      const line = r.lines[0];
      const turn = fens[i].split(' ')[1];
      evals.push(toWhite(line, turn));
      best.push(line?.pv?.[0] || r.bestmove);
      pv.push((line?.pv || [r.bestmove]).slice(0, 10));
      const l2 = r.lines[1];
      second.push(l2 ? { ...toWhite(l2, turn), move: l2.pv[0] } : null);
    }
    onProgress?.(i + 1, fens.length);
  }
  return { depth, evals, best, pv, second };
}

/** True if the move leaves a minor or major piece where it can be taken at a loss: a sacrifice. */
export function isSacrifice(fen, uci) {
  const c = new Chess(fen);
  const mover = c.turn();
  const m = playUci(c, uci);
  if (!m) return false;
  const piece = m.promotion || m.piece;
  const val = VALUES[piece];
  if (piece === 'k' || val < 3) return false;
  const gained = m.captured ? VALUES[m.captured] : 0;
  if (gained >= val) return false;
  const opp = c.turn();
  const attackers = c.attackers(m.to, opp);
  if (!attackers.length) return false;
  const defenders = c.attackers(m.to, mover);
  if (!defenders.length) return true;
  const cheapest = Math.min(...attackers.map(sq => (c.get(sq).type === 'k' ? 100 : VALUES[c.get(sq).type])));
  return cheapest + gained < val;
}

function isRecapture(moves, fens, i) {
  if (i === 0) return false;
  const prev = new Chess(fens[i - 1]);
  const pm = playUci(prev, moves[i - 1]);
  if (!pm?.captured) return false;
  return moves[i].slice(2, 4) === pm.to;
}

/** Turn raw evaluations into labels, accuracies and per-colour summaries. */
export function classify(raw, moves, fens, isBookPos = () => false) {
  const wins = raw.evals.map(winPct);
  const second = raw.second || [];
  const startColor = fens[0].split(' ')[1];
  const labels = [], acc = [], loss = [], phases = [];
  const pov = (w, color) => (color === 'w' ? w : 100 - w);
  let inBook = true;
  for (let i = 0; i < moves.length; i++) {
    const color = fens[i].split(' ')[1];
    const before = pov(wins[i], color);
    const after = pov(wins[i + 1], color);
    const l = Math.max(0, before - after);
    loss.push(l);
    acc.push(moveAccuracy(before, after));
    phases.push(phaseOf(fens[i], i));
    inBook = inBook && i < 30 && isBookPos(fens[i + 1]);
    if (inBook && l < 10) { labels.push('book'); continue; }
    let label = labelFor(l, raw.best[i] === moves[i]);
    // great: the only move that keeps the position; every alternative is much worse
    if (label === 'best' && second[i] && before > 15 && before < 90 && !isRecapture(moves, fens, i)) {
      if (before - pov(winPct(second[i]), color) >= 15) label = 'great';
    }
    // brilliant: a sound sacrifice that is also (one of) the best moves, in a position that is not already won
    if (['best', 'great', 'excellent'].includes(label) && l < 2 && after >= 45 && before < 95 && isSacrifice(fens[i], moves[i])) {
      label = 'brilliant';
    }
    // miss: the opponent just erred and this move hands the advantage back
    if (i > 0 && BAD_LABELS.includes(label) && loss[i - 1] >= 10 && l >= 10) {
      const beforeTheirError = pov(wins[i - 1], color);
      if (after <= beforeTheirError + 5) label = 'miss';
    }
    labels.push(label);
  }
  const accuracy = gameAccuracy(wins, startColor);
  const counts = { w: {}, b: {} };
  for (const c of ['w', 'b']) for (const k of LABELS) counts[c][k] = 0;
  labels.forEach((lab, i) => { counts[fens[i].split(' ')[1]][lab]++; });
  return { labels, acc, loss, wins, phases, accuracy, counts };
}

/** Stats per phase for one colour: accuracy and mistakes. */
export function phaseStats(review, fens, color) {
  const out = {};
  for (const ph of ['opening', 'middlegame', 'endgame']) out[ph] = { moves: 0, accSum: 0, blunders: 0, mistakes: 0, inaccuracies: 0 };
  review.labels.forEach((lab, i) => {
    if (fens[i].split(' ')[1] !== color) return;
    const s = out[review.phases[i]];
    s.moves++;
    s.accSum += review.acc[i];
    if (lab === 'blunder') s.blunders++;
    if (lab === 'mistake' || lab === 'miss') s.mistakes++;
    if (lab === 'inaccuracy') s.inaccuracies++;
  });
  return out;
}
