// Game review maths: win chances, accuracy (same formulas as Lichess), move labels, phases.
import { Chess, playUci, pieceCount, VALUES } from './chessutil.js';
import { toWhite } from './engine.js';

export const LABELS = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'miss', 'mistake', 'blunder'];
export const BAD_LABELS = ['inaccuracy', 'miss', 'mistake', 'blunder'];
export const LABEL_TEXT = {
  brilliant: 'Brilliant', great: 'Great move', best: 'Best', excellent: 'Excellent', good: 'Good', book: 'Book', forced: 'Forced',
  inaccuracy: 'Inaccuracy', miss: 'Miss', mistake: 'Mistake', blunder: 'Blunder',
};
export const LABEL_GLYPH = {
  brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '○', book: 'B', forced: '→',
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
  engine.newGame?.(); // a clean hash makes repeated reviews of the same game agree
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
  // consistency pass: if the engine's own best move appears to lose a lot, one of the two searches
  // missed something (usually a deep mate). Search both positions again, deeper.
  if (moves) {
    const pov = (w, c) => (c === 'w' ? w : 100 - w);
    let rechecks = 0;
    for (let i = 0; i < moves.length && rechecks < 10; i++) {
      if (best[i] !== moves[i] || evals[i + 1]?.mate === 0) continue;
      const c = fens[i].split(' ')[1];
      if (pov(winPct(evals[i]), c) - pov(winPct(evals[i + 1]), c) < 5) continue;
      rechecks++;
      for (const k of [i, i + 1]) {
        if (isCancelled?.()) return null;
        if (!best[k]) continue;
        const nLegal = new Chess(fens[k]).moves().length;
        const r = await engine.analyze(fens[k], { depth: depth + 6, multipv: Math.min(2, nLegal), movetime: 10000, startFen: fens[0], moves: moves.slice(0, k) });
        if (!r?.lines[0]) continue;
        const turn = fens[k].split(' ')[1];
        evals[k] = toWhite(r.lines[0], turn);
        best[k] = r.lines[0].pv[0] || r.bestmove;
        pv[k] = r.lines[0].pv.slice(0, 10);
        const l2 = r.lines[1];
        second[k] = l2 ? { ...toWhite(l2, turn), move: l2.pv[0] } : null;
      }
    }
  }
  return { depth, evals, best, pv, second };
}

/** Values of the pieces that can legally capture on `sq` for the side to move, cheapest first. */
function legalCapturers(c, sq) {
  return c.moves({ verbose: true }).filter(m => m.to === sq && m.captured).map(m => (m.piece === 'k' ? 100 : VALUES[m.piece])).sort((a, b) => a - b);
}

/** Can the side to move win the piece on `sq` (owned by `owner`)? Uses legal captures only. */
function enPrise(c, sq, owner) {
  const p = c.get(sq);
  if (!p || p.type === 'k') return false;
  const caps = legalCapturers(c, sq);
  if (!caps.length) return false;
  if (!c.attackers(sq, owner).length) return true;
  return caps[0] < VALUES[p.type];
}

/**
 * True if the move gives up material on purpose: the moved piece (knight or bigger) can be taken
 * at a loss, or the move leaves another of its pieces to be taken. Only legal captures count.
 */
export function isSacrifice(fen, uci) {
  const c = new Chess(fen);
  const mover = c.turn();
  const m = playUci(c, uci);
  if (!m || c.isCheckmate()) return false;
  const piece = m.promotion || m.piece;
  const val = VALUES[piece];
  if (piece !== 'k' && val >= 3) {
    const gained = m.captured ? VALUES[m.captured] : 0;
    const caps = legalCapturers(c, m.to);
    if (caps.length && gained < val) {
      const defended = c.attackers(m.to, mover).length > 0;
      if (!defended || caps[0] + gained < val) return true;
    }
  }
  for (const row of c.board()) for (const p of row) {
    if (!p || p.color !== mover || p.square === m.to || p.type === 'k' || VALUES[p.type] < 3) continue;
    if (enPrise(c, p.square, mover)) return true;
  }
  return false;
}

const SEVERITY = { inaccuracy: 1, miss: 2, mistake: 2, blunder: 3 };
const worse = (a, b) => ((SEVERITY[b] || 0) > (SEVERITY[a] || 0) ? b : a);

function moverScore(e, color) {
  const s = color === 'w' ? 1 : -1;
  if (!e) return { cp: 0, mate: null };
  if (e.mate === 0) return { cp: null, mate: 0, lost: e.win !== color };
  return { cp: e.cp == null ? null : e.cp * s, mate: e.mate == null ? null : e.mate * s };
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
    const pos = new Chess(fens[i]);
    const inCheck = pos.inCheck();
    const nLegal = pos.moves().length;
    const mv = playUci(pos, moves[i]);
    if (nLegal === 1) { labels.push('forced'); continue; }
    const givesMate = pos.isCheckmate();
    // a move that scores clearly better than the engine's own first choice was at least as good
    let label = givesMate ? 'best' : labelFor(l, raw.best[i] === moves[i] || after - before >= 1);

    // mates, graded like Lichess: allowing a forced mate (or throwing one away) is a blunder
    // unless the position was already lost (or still overwhelmingly won)
    const b = moverScore(raw.evals[i], color);
    const a = moverScore(raw.evals[i + 1], color);
    const matedAfter = (a.mate != null && a.mate < 0) || (a.mate === 0 && a.lost);
    const matedBefore = b.mate != null && b.mate < 0;
    if (matedAfter && !matedBefore) {
      const prevCp = b.mate != null ? 10000 : b.cp ?? 0;
      label = worse(label, prevCp < -999 ? 'inaccuracy' : prevCp < -700 ? 'mistake' : 'blunder');
    }
    if (b.mate != null && b.mate > 0 && !givesMate && !(a.mate != null && a.mate > 0)) {
      const cpAfter = matedAfter ? -10000 : a.cp ?? 0;
      label = worse(label, cpAfter > 999 ? 'inaccuracy' : cpAfter > 700 ? 'mistake' : 'blunder');
    }

    // great: the only good move. Not for obvious captures or a king escaping check with few options.
    if (label === 'best' && !givesMate && second[i] && before > 15 && before < 90 && !(inCheck && nLegal <= 3)) {
      const prevTo = i > 0 ? moves[i - 1].slice(2, 4) : null;
      const takesLastMoved = !!mv.captured && mv.to === prevTo;
      const winningCapture = !!mv.captured && (VALUES[mv.captured] >= VALUES[mv.piece] || !new Chess(fens[i]).attackers(mv.to, color === 'w' ? 'b' : 'w').length);
      if (!takesLastMoved && !winningCapture && before - pov(winPct(second[i]), color) >= 15) label = 'great';
    }
    // brilliant: a sound sacrifice that is also (one of) the best moves, in a position that is not already won
    if (['best', 'great', 'excellent'].includes(label) && !givesMate && l < 2 && after >= 45 && before < 95 && isSacrifice(fens[i], moves[i])) {
      label = 'brilliant';
    }
    // miss: the opponent just erred and this move hands roughly that advantage straight back
    if (i > 0 && BAD_LABELS.includes(label) && loss[i - 1] >= 10 && l >= 10) {
      const beforeTheirError = pov(wins[i - 1], color);
      if (after <= beforeTheirError + 5 && after >= beforeTheirError - 5) label = 'miss';
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
