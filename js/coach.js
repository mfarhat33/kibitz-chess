// Personal coach: why each of your mistakes happened, what it cost, and what to drill next.
// Pure logic (no DOM) so it can be unit-tested. Works on reviewed game records from the store.
import { Chess, playUci, VALUES, other, START_FEN, uciLineToSan } from './chessutil.js';
import { positions, winPct } from './analysis.js';
import { playOut } from './explain.js';
import { themeName } from './themes.js';

export const ERROR_LABELS = ['mistake', 'miss', 'blunder'];
const DAY = 86400000;
export const WEEK = 7 * DAY;

/** Pattern categories, in the order the coach checks them. */
export const CATS = {
  time: { name: 'Time trouble', verb: 'blundered with almost no time left' },
  allowedMate: { name: 'Allowing mate', verb: 'walked into a forced mate' },
  missedMate: { name: 'Missing mate', verb: 'had a forced mate and missed it' },
  hung: { name: 'Hanging pieces', verb: 'left a piece en prise' },
  allowedTactic: { name: 'Walking into tactics', verb: 'allowed a tactic that wins material' },
  missedTactic: { name: 'Missing tactics', verb: 'missed a move that wins material' },
  opening: { name: 'Opening slips', verb: 'went wrong in the opening' },
  endgame: { name: 'Endgame technique', verb: 'misplayed an endgame' },
  positional: { name: 'Middlegame judgement', verb: 'drifted in the middlegame' },
};
export const CAT_KEYS = Object.keys(CATS);

export const MOTIFS = {
  mate: 'mate', freePiece: 'free piece', fork: 'fork', pin: 'pin', skewer: 'skewer',
  discovered: 'discovered attack', check: 'checks', combination: 'combination',
};

// ---------- motif detection ----------
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const sqOf = (f, r) => 'abcdefgh'[f] + (r + 1);
const val = (t) => (t === 'k' ? 100 : VALUES[t]);

/** Pieces of `victim` worth 3+ (or the king) attacked by the piece on `sq`. */
function attackedBig(chess, sq, victim) {
  const out = [];
  for (const row of chess.board()) for (const p of row) {
    if (!p || p.color !== victim || (p.type !== 'k' && VALUES[p.type] < 3)) continue;
    if (chess.attackers(p.square, other(victim)).includes(sq)) out.push(p);
  }
  return out;
}

/** Pin or skewer by the slider standing on `sq` against `victim`. */
function lineMotif(chess, sq, victim) {
  const p = chess.get(sq);
  if (!p || !['b', 'r', 'q'].includes(p.type)) return null;
  const dirs = p.type === 'b' ? BISHOP_DIRS : p.type === 'r' ? ROOK_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
  const f0 = sq.charCodeAt(0) - 97, r0 = +sq[1] - 1;
  for (const [df, dr] of dirs) {
    const hit = [];
    for (let f = f0 + df, r = r0 + dr; f >= 0 && f < 8 && r >= 0 && r < 8 && hit.length < 2; f += df, r += dr) {
      const q = chess.get(sqOf(f, r));
      if (!q) continue;
      if (q.color !== victim) break;
      hit.push(q);
    }
    if (hit.length < 2) continue;
    const [front, back] = hit;
    if (front.type !== 'k' && (back.type === 'k' || val(back.type) > val(front.type)) && val(back.type) >= 3) return 'pin';
    if ((front.type === 'k' || val(front.type) > val(back.type)) && val(back.type) >= 3) return 'skewer';
  }
  return null;
}

/**
 * What kind of tactic the move `uci` starts against `victim` (the side not moving).
 * One of the MOTIFS keys.
 */
export function motifOf(fen, uci) {
  const c = new Chess(fen);
  const mover = c.turn();
  const victim = other(mover);
  const before = new Chess(fen);
  const m = playUci(c, uci);
  if (!m) return 'combination';
  if (c.isCheckmate()) return 'mate';
  if (m.captured && VALUES[m.captured] >= 3) {
    const defenders = before.attackers(m.to, victim).length;
    if (!defenders || VALUES[m.piece] < VALUES[m.captured]) return 'freePiece';
  }
  if (attackedBig(c, m.to, victim).length >= 2) return 'fork';
  const lm = lineMotif(c, m.to, victim);
  if (lm) return lm;
  if (c.inCheck()) {
    const king = c.board().flat().find(p => p && p.type === 'k' && p.color === victim);
    if (king && c.attackers(king.square, mover).some(s => s !== m.to)) return 'discovered';
    return 'check';
  }
  return 'combination';
}

// ---------- clock ----------
/** The mover's clock (ms) just before move `i`, or null when the game has no clocks. */
export function clockBefore(game, i) {
  const mc = game.moveClocks;
  if (!Array.isArray(mc)) return null;
  if (i >= 2 && Number.isFinite(mc[i - 2])) return mc[i - 2];
  if (i < 2 && Number.isFinite(game.tcBase)) return game.tcBase;
  return null;
}

/** Below this much time (ms) a move counts as played in time trouble. */
export function timeThreshold(game) {
  const base = game.tcBase || 600000;
  const inc = game.tcInc || 0;
  const t = Math.max(10000, Math.min(45000, base * 0.08));
  return Math.max(5000, t - Math.min(inc * 2, t / 2));
}

// ---------- one error ----------
/**
 * Why move `i` (a user error) went wrong. `fens` from positions(). Returns
 * { cat, motif, matLoss, under, clock } where `under` is the category ignoring the clock.
 */
export function classifyError(game, i, fens) {
  const r = game.review;
  const color = fens[i].split(' ')[1];
  const s = color === 'w' ? 1 : -1;
  const b = r.evals[i] || {}, a = r.evals[i + 1] || {};
  const bm = b.mate == null ? null : b.mate * s;
  const am = a.mate === 0 ? (a.win === color ? 1 : -1) : a.mate == null ? null : a.mate * s;
  let under = null, motif = null, matLoss = 0;

  if (am != null && am < 0 && !(bm != null && bm < 0)) { under = 'allowedMate'; motif = 'mate'; }
  else if (bm != null && bm > 0 && !(am != null && am > 0)) { under = 'missedMate'; motif = 'mate'; }
  else {
    const reply = r.pv[i + 1] || [];
    const played = playOut(fens[i + 1], reply, color);
    const bestFull = r.best[i] ? [r.best[i], ...(r.pv[i] || []).slice(1)] : [];
    const bestL = playOut(fens[i], bestFull, color);
    const actualLoss = played.start - played.end;
    matLoss = Math.max(actualLoss, bestL.end - played.end);
    if (actualLoss >= 2 && reply[0]) {
      const c = new Chess(fens[i + 1]);
      const first = playUci(c, reply[0]);
      if (first?.captured && VALUES[first.captured] >= 3) { under = 'hung'; motif = 'freePiece'; }
      else { under = 'allowedTactic'; motif = motifOf(fens[i + 1], reply[0]); }
    } else if (bestL.end - played.end >= 2 && bestL.end - bestL.start >= 2 && r.best[i]) {
      under = 'missedTactic'; motif = motifOf(fens[i], r.best[i]);
    } else {
      const ph = r.phases?.[i];
      under = ph === 'opening' ? 'opening' : ph === 'endgame' ? 'endgame' : 'positional';
    }
  }
  const clock = clockBefore(game, i);
  const pressed = clock != null && clock < timeThreshold(game);
  return { cat: pressed ? 'time' : under, under, motif, matLoss, clock };
}

const pov = (w, c) => (c === 'w' ? w : 100 - w);

/**
 * Your mistakes, misses and blunders in one reviewed game, each classified, with the one that
 * decided a lost or drawn game marked `decisive`. Empty for unreviewed or watched games.
 */
export function gameErrors(game) {
  const r = game.review;
  if (!r || game.spectator || !Array.isArray(r.labels)) return [];
  let fens;
  try { fens = positions(game.moves, game.startFen || START_FEN); } catch { return []; }
  if (fens.length !== r.labels.length + 1) return [];
  const out = [];
  r.labels.forEach((lab, i) => {
    if (!ERROR_LABELS.includes(lab) || fens[i].split(' ')[1] !== game.userColor) return;
    let info;
    try { info = classifyError(game, i, fens); } catch { return; }
    const before = pov(winPct(r.evals[i]), game.userColor);
    const after = pov(winPct(r.evals[i + 1]), game.userColor);
    out.push({
      gameId: game.id, ply: i, label: lab, ...info, phase: r.phases?.[i] || 'middlegame',
      before, after, loss: Math.max(0, before - after), fen: fens[i], best: r.best[i] || null,
      san: game.sans?.[i] || game.moves[i], date: game.date, decisive: false,
    });
  });
  if (game.userResult === 'loss' || game.userResult === 'draw') {
    // the error that threw the game away: the biggest drop from a position that was not already lost
    const live = out.filter(e => e.before >= 35);
    const worst = live.sort((x, y) => y.loss - x.loss)[0];
    if (worst) worst.decisive = true;
    else if (game.userResult === 'loss' && /time/i.test(game.reason || '')) {
      out.push({ gameId: game.id, ply: game.moves.length - 1, label: 'blunder', cat: 'time', under: 'time', motif: null, matLoss: 0, clock: 0, phase: r.phases?.[game.moves.length - 1] || 'endgame', before: 50, after: 0, loss: 50, fen: fens[fens.length - 1], best: null, san: 'flag', date: game.date, decisive: true, flagged: true });
    }
  }
  out.sort((x, y) => x.ply - y.ply);
  return out;
}

/** Games that count for coaching: played by you, finished, reviewed. */
export function coachGames(games) {
  return games.filter(g => !g.spectator && g.userResult && g.review && Array.isArray(g.review.labels));
}

/**
 * Per-pattern totals over these games. `points` = game points the pattern cost you
 * (1 per lost game it decided, 0.5 per drawn game). Sorted worst first.
 */
export function patternStats(games) {
  const gs = coachGames(games);
  const byId = new Map(gs.map(g => [g.id, g]));
  const stats = Object.fromEntries(CAT_KEYS.map(k => [k, { cat: k, count: 0, decisive: 0, points: 0, winLost: 0, games: new Set(), motifs: {}, examples: [] }]));
  const errors = gs.flatMap(gameErrors);
  for (const e of errors) {
    const s = stats[e.cat];
    s.count++;
    s.winLost += e.loss;
    s.games.add(e.gameId);
    if (e.motif) s.motifs[e.motif] = (s.motifs[e.motif] || 0) + 1;
    if (e.decisive) {
      s.decisive++;
      s.points += byId.get(e.gameId)?.userResult === 'draw' ? 0.5 : 1;
    }
    s.examples.push(e);
  }
  const list = Object.values(stats).map(s => ({
    ...s, games: s.games.size,
    perGame: gs.length ? s.count / gs.length : 0,
    topMotif: Object.entries(s.motifs).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    // decisive and recent examples first
    examples: s.examples.sort((x, y) => (y.decisive - x.decisive) || (y.date - x.date) || (y.loss - x.loss)).slice(0, 4),
  }));
  list.sort((a, b) => b.points - a.points || b.count - a.count || b.winLost - a.winLost);
  return { games: gs.length, errors: errors.length, list };
}

// ---------- weeks ----------
/** Monday 00:00 local time of the week containing `ts`. */
export function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

const MIN_GAMES = 5;

function summary(games) {
  const played = games.filter(g => !g.spectator && g.userResult);
  const rv = coachGames(played);
  const accs = rv.map(g => g.review.accuracy?.[g.userColor]).filter(x => typeof x === 'number');
  const count = (l) => rv.reduce((s, g) => s + (Number(g.review.counts?.[g.userColor]?.[l]) || 0), 0);
  return {
    played: played.length, reviewed: rv.length,
    win: played.filter(g => g.userResult === 'win').length,
    draw: played.filter(g => g.userResult === 'draw').length,
    loss: played.filter(g => g.userResult === 'loss').length,
    acc: accs.length ? accs.reduce((s, x) => s + x, 0) / accs.length : null,
    blundersPerGame: rv.length ? count('blunder') / rv.length : null,
  };
}

/**
 * The Monday report for the week starting `start` (a weekStart value). If that week has fewer than
 * 5 reviewed games, the patterns use the 28 days ending with it instead, and `widened` says so.
 */
export function weeklyReport(allGames, start) {
  const end = start + WEEK;
  const inWeek = allGames.filter(g => g.date >= start && g.date < end);
  const prevWeek = allGames.filter(g => g.date >= start - WEEK && g.date < start);
  const week = summary(inWeek);
  const prev = summary(prevWeek);
  // a quiet week: widen to the last four weeks, then to everything before the week ended
  let windowStart = start, widened = false;
  if (week.reviewed < MIN_GAMES) { windowStart = end - 4 * WEEK; widened = '4w'; }
  if (widened && coachGames(allGames.filter(g => g.date >= windowStart && g.date < end)).length < MIN_GAMES) { windowStart = 0; widened = 'all'; }
  const windowGames = allGames.filter(g => g.date >= windowStart && g.date < end);
  const before = windowStart ? allGames.filter(g => g.date >= windowStart - (end - windowStart) && g.date < windowStart) : [];
  const pats = patternStats(windowGames);
  const prevPats = patternStats(before);
  const prevBy = Object.fromEntries(prevPats.list.map(p => [p.cat, p]));
  const top = pats.list.filter(p => p.count > 0).slice(0, 3).map(p => ({
    ...p,
    prevPerGame: prevPats.games ? (prevBy[p.cat]?.count || 0) / prevPats.games : null,
  }));
  return { start, end, week, prev, widened, windowStart, windowGames: pats.games, errors: pats.errors, top, all: pats.list };
}

/** The week whose report is due: last week (the Monday report covers the previous Mon to Sun). */
export function reportWeek(now = Date.now()) { return weekStart(now) - WEEK; }

// ---------- blunt advice ----------
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pct = (x) => `${Math.round(x)}%`;

/** One or two blunt sentences on a pattern and the rule that fixes it. */
export function adviceFor(p, games) {
  const n = p.count, d = p.decisive;
  const cost = d ? ` It decided ${plural(d, 'game')} (${p.points} point${p.points === 1 ? '' : 's'} thrown away).` : '';
  const motif = p.topMotif && MOTIFS[p.topMotif] && !['mate', 'freePiece'].includes(p.topMotif) ? ` Mostly ${MOTIFS[p.topMotif]}s.` : '';
  const rate = games ? ` That is ${(n / games).toFixed(1)} per game.` : '';
  const T = {
    time: `You ${CATS.time.verb} ${plural(n, 'time')}.${cost}${rate} Fix: bank time early. Play your first 10 moves in under 10 seconds each, and switch to 10|5 or 15|10 until this drops.`,
    allowedMate: `You ${CATS.allowedMate.verb} ${plural(n, 'time')}.${cost} Fix: before every move, check every check your opponent has. Back rank first.`,
    missedMate: `You ${CATS.missedMate.verb} ${plural(n, 'time')}.${cost} Fix: when their king is short of squares, look at every check before anything else.`,
    hung: `You ${CATS.hung.verb} ${plural(n, 'time')}.${cost}${rate} Fix: before you let go of a piece, ask "what can take it, and what did it stop guarding?"`,
    allowedTactic: `You ${CATS.allowedTactic.verb} ${plural(n, 'time')}.${motif}${cost} Fix: after choosing a move, find your opponent's most forcing reply (checks, captures, threats) before playing it.`,
    missedTactic: `You ${CATS.missedTactic.verb} ${plural(n, 'time')}.${motif}${cost} Fix: every move, scan checks, captures and threats for yourself first. Free material is the easiest win at your level.`,
    opening: `You ${CATS.opening.verb} ${plural(n, 'time')}.${cost} Fix: drill the exact lines below where you keep going wrong, not more theory.`,
    endgame: `You ${CATS.endgame.verb} ${plural(n, 'time')}.${cost} Fix: activate the king, push passed pawns, and learn the basic rook endings. Drills below.`,
    positional: `You ${CATS.positional.verb} ${plural(n, 'time')} without hanging anything.${cost} Fix: when nothing is hanging, improve your worst piece instead of pushing pawns.`,
  };
  return T[p.cat];
}

/** One line comparing this window with the one before. */
export function trendText(p) {
  if (p.prevPerGame == null) return 'No earlier games to compare with.';
  const diff = p.perGame - p.prevPerGame;
  if (Math.abs(diff) < 0.1) return `Flat: ${p.perGame.toFixed(1)} per game, same as before.`;
  return diff > 0 ? `Worse: ${p.perGame.toFixed(1)} per game, up from ${p.prevPerGame.toFixed(1)}.` : `Better: ${p.perGame.toFixed(1)} per game, down from ${p.prevPerGame.toFixed(1)}.`;
}

// ---------- 7-day plan ----------
/** Puzzle theme that trains each pattern (Lichess theme keys), or null. */
export const THEME_FOR = {
  allowedMate: 'mateIn2', missedMate: 'mateIn2', hung: 'hangingPiece', time: null, opening: 'opening', endgame: 'endgame', positional: 'quietMove',
  allowedTactic: null, missedTactic: null,
};
const MOTIF_THEME = { fork: 'fork', pin: 'pin', skewer: 'skewer', discovered: 'discoveredAttack', freePiece: 'hangingPiece', mate: 'mateIn2', check: 'attraction', combination: 'sacrifice' };

export function themeFor(p) {
  if ((p.cat === 'allowedTactic' || p.cat === 'missedTactic') && p.topMotif) return MOTIF_THEME[p.topMotif] || 'fork';
  return THEME_FOR[p.cat] ?? null;
}

/**
 * Seven days of 15 to 20 minutes, built from the top patterns. Each item:
 * { kind: 'mistakes'|'puzzles'|'play'|'openings'|'learn', cat, theme, text, minutes }.
 */
export function weekPlan(top) {
  const pats = top.length ? top : [];
  const order = [0, 1, 0, 2, 0, 1, -1];
  return order.map((k, day) => {
    const p = k >= 0 ? pats[k] : null;
    if (!p) {
      // fewer than three patterns: fill the gaps with mixed tactics and real games rather than repeating one drill
      return { day, items: day === 6 || !pats.length
        ? [{ kind: 'play', text: 'Play two rapid games (15|10 or slower) against a bot near your level and review both.', minutes: 40 }]
        : [{ kind: 'puzzles', theme: '', text: 'Rated puzzles, all themes.', minutes: 15 }] };
    }
    const name = CATS[p.cat].name.toLowerCase();
    const items = [{ kind: 'mistakes', cat: p.cat, text: `Replay your own ${name} positions until each is fixed.`, minutes: 10 }];
    const th = themeFor(p);
    if (p.cat === 'opening') items.push({ kind: 'openings', cat: p.cat, text: 'Drill your opening fixes in the trainer.', minutes: 10 });
    else if (p.cat === 'endgame') items.push({ kind: 'learn', cat: p.cat, text: 'One endgame lesson or drill in Learn.', minutes: 10 });
    else if (p.cat === 'time') items.push({ kind: 'play', cat: p.cat, text: 'One 10|5 game: first 10 moves in under 10 seconds each.', minutes: 20 });
    if (th) items.push({ kind: 'puzzles', cat: p.cat, theme: th, text: `Rated puzzles: ${themeName(th).toLowerCase()}.`, minutes: 10 });
    return { day, items };
  });
}

// ---------- opening fixes ----------
/** A position key that ignores move counters, so the same position from different games matches. */
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

/**
 * Opening positions where you keep choosing a bad move: same position (your move, first 15 of
 * your moves), loss of 8+ winning-chance points, seen in 2+ games (or once if it was a blunder).
 * Returns [{ key, fen, color, prefix, played, best, bestSan, playedSan, count, loss, opening, gameIds }].
 */
export function openingFixes(games, { minCount = 2 } = {}) {
  const groups = new Map();
  for (const g of coachGames(games)) {
    if (g.startFen) continue;
    let fens;
    try { fens = positions(g.moves, START_FEN); } catch { continue; }
    const r = g.review;
    for (let i = 0; i < Math.min(g.moves.length, 30); i++) {
      if (fens[i].split(' ')[1] !== g.userColor) continue;
      if (r.phases?.[i] !== 'opening') break;
      const loss = r.loss?.[i] ?? 0;
      if (loss < 8 || r.labels[i] === 'book' || !r.best[i] || r.best[i] === g.moves[i]) continue;
      const key = posKey(fens[i]) + '|' + g.moves[i];
      const x = groups.get(key) || { key, fen: fens[i], color: g.userColor, prefix: g.moves.slice(0, i), played: g.moves[i], bests: {}, count: 0, lossSum: 0, blunder: false, opening: g.opening?.name || null, gameIds: [] };
      x.count++;
      x.lossSum += loss;
      x.blunder = x.blunder || r.labels[i] === 'blunder';
      x.bests[r.best[i]] = (x.bests[r.best[i]] || 0) + 1;
      x.gameIds.push(g.id);
      groups.set(key, x);
      break; // the first real error of each game is the one worth fixing
    }
  }
  return [...groups.values()].filter(x => x.count >= minCount || x.blunder).map(x => {
    const best = Object.entries(x.bests).sort((a, b) => b[1] - a[1])[0][0];
    const [playedSan] = uciLineToSan(x.fen, [x.played]);
    const [bestSan] = uciLineToSan(x.fen, [best]);
    return { key: x.key, fen: x.fen, color: x.color, prefix: x.prefix, played: x.played, best, playedSan, bestSan, count: x.count, loss: x.lossSum / x.count, opening: x.opening, gameIds: x.gameIds };
  }).sort((a, b) => b.count * b.loss - a.count * a.loss);
}

// ---------- sparring ----------
/**
 * Positions to replay against a bot: the position before your decisive errors in a phase,
 * newest first. kind: 'endgame' | 'opening' | 'any'.
 */
export function sparringPositions(games, kind = 'any') {
  const out = [];
  for (const g of coachGames(games)) {
    for (const e of gameErrors(g)) {
      if (e.flagged || !e.decisive && e.label !== 'blunder') continue;
      if (kind !== 'any' && e.phase !== kind) continue;
      if (e.before < 40) continue; // only positions that were still fine for you
      out.push({ fen: e.fen, gameId: g.id, ply: e.ply, cat: e.cat, phase: e.phase, date: g.date, opp: g.botName, color: g.userColor });
    }
  }
  return out.sort((a, b) => b.date - a.date);
}

/** Bot level index closest to a rating. */
export function levelFor(rating, levels) {
  let best = 0;
  levels.forEach((l, i) => { if (!l.max && Math.abs(l.elo - rating) < Math.abs(levels[best].elo - rating)) best = i; });
  return best;
}
