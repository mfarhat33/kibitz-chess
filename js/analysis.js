// Game review maths: win chances, accuracy (same formulas as Lichess), move labels, phases.
import { Chess, playUci, pieceCount } from './chessutil.js';
import { toWhite } from './engine.js';

export const LABELS = ['best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];
export const LABEL_TEXT = {
  best: 'Best', excellent: 'Excellent', good: 'Good', book: 'Book',
  inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder',
};
export const LABEL_GLYPH = { best: '★', excellent: '!', good: '✓', book: 'B', inaccuracy: '?!', mistake: '?', blunder: '??' };

export const DEPTHS = { fast: 11, standard: 14, deep: 18 };

/** White's winning chances 0..100 from a white-perspective score. */
export function winPct(score) {
  if (!score) return 50;
  if (score.mate != null) {
    if (score.mate === 0) return score.win === 'w' ? 100 : score.win === 'b' ? 0 : 50;
    return score.mate > 0 ? 100 : 0;
  }
  const cp = Math.max(-1000, Math.min(1000, score.cp ?? 0));
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
 * Run the engine over every position. Returns the raw evaluations; classify() turns them into labels.
 * onProgress(done, total). Returns null if cancelled.
 */
export async function analyzePositions(engine, fens, { depth = DEPTHS.standard, onProgress, isCancelled } = {}) {
  const evals = [], best = [], pv = [];
  for (let i = 0; i < fens.length; i++) {
    if (isCancelled?.()) return null;
    const c = new Chess(fens[i]);
    if (c.isCheckmate()) {
      evals.push({ cp: null, mate: 0, win: c.turn() === 'w' ? 'b' : 'w' });
      best.push(null); pv.push([]);
    } else if (c.isGameOver()) {
      evals.push({ cp: 0, mate: null });
      best.push(null); pv.push([]);
    } else {
      const r = await engine.analyze(fens[i], { depth, movetime: depth >= 18 ? 6000 : 3000 });
      if (!r) return null;
      const line = r.lines[0];
      evals.push(toWhite(line, c.turn()));
      best.push(r.bestmove);
      pv.push((line?.pv || [r.bestmove]).slice(0, 10));
    }
    onProgress?.(i + 1, fens.length);
  }
  return { depth, evals, best, pv };
}

/** Turn raw evaluations into labels, accuracies and per-colour summaries. */
export function classify(raw, moves, fens, isBookPos = () => false) {
  const wins = raw.evals.map(winPct);
  const startColor = fens[0].split(' ')[1];
  const labels = [], acc = [], loss = [], phases = [];
  let inBook = true;
  for (let i = 0; i < moves.length; i++) {
    const color = fens[i].split(' ')[1];
    const before = color === 'w' ? wins[i] : 100 - wins[i];
    const after = color === 'w' ? wins[i + 1] : 100 - wins[i + 1];
    const l = Math.max(0, before - after);
    loss.push(l);
    acc.push(moveAccuracy(before, after));
    phases.push(phaseOf(fens[i], i));
    inBook = inBook && i < 30 && isBookPos(fens[i + 1]);
    if (inBook && l < 10) labels.push('book');
    else labels.push(labelFor(l, raw.best[i] === moves[i]));
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
    if (lab === 'mistake') s.mistakes++;
    if (lab === 'inaccuracy') s.inaccuracies++;
  });
  return out;
}
