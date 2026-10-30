// Short plain-English explanations for reviewed moves, built from the engine's lines.
import { Chess, playUci, uciLineToSan, formatLine, VALUES, PIECE_NAMES, other } from './chessutil.js';
import { formatScore } from './engine.js';
import { winPct, isSacrifice } from './analysis.js';

const article = (name) => (/^[aeiou]/.test(name) ? 'an ' : 'a ') + name;

function balance(chess, color) {
  let s = 0;
  for (const row of chess.board()) for (const p of row) {
    if (!p || p.type === 'k') continue;
    s += (p.color === color ? 1 : -1) * VALUES[p.type];
  }
  return s;
}

/**
 * Plays an engine line and returns the mover's material balance at the last quiet point
 * (no check to answer and no capture pending), plus the captures made up to that point.
 */
export function playOut(fen, ucis, color, maxPlies = 10) {
  const c = new Chess(fen);
  const start = balance(c, color);
  let settled = start, settledCaps = 0, settlePly = -1;
  const caps = [];
  const n = Math.min(ucis.length, maxPlies);
  for (let i = 0; i < n; i++) {
    const m = playUci(c, ucis[i]);
    if (!m) break;
    if (m.captured) caps.push({ by: m.color, piece: m.captured, square: m.to, san: m.san, ply: i, attacker: m.piece });
    const next = i + 1 < n ? ucis[i + 1] : null;
    if (!c.inCheck() && (!next || !isCapture(c, next))) { settled = balance(c, color); settledCaps = caps.length; settlePly = i; }
  }
  // settlePly: index of the last move up to the settled position (show the line that far)
  return { start, end: settled, caps: caps.slice(0, settledCaps), settlePly };
}

const NUM = ['', '', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
/** ['n', 'p', 'p'] -> "a knight and two pawns" */
function pieceList(types) {
  const cnt = {};
  for (const t of types) cnt[t] = (cnt[t] || 0) + 1;
  const parts = ['q', 'r', 'b', 'n', 'p'].filter(t => cnt[t]).map(t => (cnt[t] === 1 ? article(PIECE_NAMES[t]) : `${NUM[cnt[t]] || cnt[t]} ${PIECE_NAMES[t]}s`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '';
}
/**
 * Net trade for `color` over a played-out line: identical pieces lost and won cancel out.
 * Returns { gave: [types], got: [types], net } where net is the material value `color` gains.
 */
function netTrade(caps, color) {
  const gave = caps.filter(c => c.by !== color).map(c => c.piece);
  const got = caps.filter(c => c.by === color).map(c => c.piece);
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    let k = Math.min(gave.filter(x => x === t).length, got.filter(x => x === t).length);
    while (k-- > 0) { gave.splice(gave.indexOf(t), 1); got.splice(got.indexOf(t), 1); }
  }
  // a knight for a bishop is an even swap too
  for (const [x, y] of [['n', 'b'], ['b', 'n']]) {
    while (gave.includes(x) && got.includes(y)) { gave.splice(gave.indexOf(x), 1); got.splice(got.indexOf(y), 1); }
  }
  const val = (a) => a.reduce((sum, t) => sum + VALUES[t], 0);
  return { gave, got, net: val(got) - val(gave) };
}
/** "a knight for a pawn" when `color` comes out at least a pawn down, otherwise null. */
export function lossText(caps, color) {
  const t = netTrade(caps, color);
  if (t.net > -1 || !t.gave.length) return null;
  return t.got.length ? `${pieceList(t.gave)} for ${pieceList(t.got)}` : pieceList(t.gave);
}
/** "a bishop for a pawn" when `color` comes out at least a pawn up, otherwise null. */
export function gainText(caps, color) {
  const t = netTrade(caps, color);
  if (t.net < 1 || !t.got.length) return null;
  return t.gave.length ? `${pieceList(t.got)} for ${pieceList(t.gave)}` : pieceList(t.got);
}

/** Could the opponent already win the piece on `sq` before the move was played? */
function wasHanging(fen, sq, color) {
  const parts = fen.split(' ');
  parts[1] = color === 'w' ? 'b' : 'w';
  parts[3] = '-';
  let c;
  try { c = new Chess(parts.join(' ')); } catch { return false; }
  const p = c.get(sq);
  if (!p || p.color !== color) return false;
  const caps = c.moves({ verbose: true }).filter(m => m.to === sq && m.captured).map(m => (m.piece === 'k' ? 100 : VALUES[m.piece])).sort((a, b) => a - b);
  if (!caps.length) return false;
  return !c.attackers(sq, color).length || caps[0] < VALUES[p.type];
}

function isCapture(chess, uci) {
  const from = chess.get(uci.slice(0, 2));
  if (chess.get(uci.slice(2, 4))) return true;
  return !!from && from.type === 'p' && uci[0] !== uci[2];
}


/** Pieces (value >= 3, or the king) of `victim` attacked by the piece standing on `sq`. */
function forkTargets(chess, sq, victim) {
  const targets = [];
  for (const row of chess.board()) for (const p of row) {
    if (!p || p.color !== victim) continue;
    if (p.type !== 'k' && VALUES[p.type] < 3) continue;
    if (chess.attackers(p.square, other(victim)).includes(sq)) targets.push(p);
  }
  return targets;
}

function describeBest(fen, uci) {
  const c = new Chess(fen);
  const m = playUci(c, uci);
  if (!m) return '';
  if (m.san.includes('#')) return ', which is checkmate';
  if (m.flags.includes('k') || m.flags.includes('q')) return ', castling to safety';
  if (m.promotion) return `, promoting to ${article(PIECE_NAMES[m.promotion])}`;
  if (m.captured) return `, capturing the ${PIECE_NAMES[m.captured]}`;
  if (c.inCheck()) return ' with check';
  return '';
}

function pov(score, color) {
  if (!score) return { cp: 0, mate: null };
  const s = color === 'w' ? 1 : -1;
  return { cp: score.cp == null ? null : score.cp * s, mate: score.mate == null ? null : score.mate * s };
}

/**
 * Who is being talked about. viewer: the user's colour, or null when reviewing someone else's game.
 * names: { w, b } display names.
 */
function voice(mover, viewer, names) {
  const nm = (c) => names?.[c] || (c === 'w' ? 'White' : 'Black');
  if (viewer === mover) return { Subj: 'You', subj: 'you', Poss: 'Your', poss: 'your', loses: 'lose', has: 'had', oppPoss: 'your opponent\'s', Opp: 'Your opponent' };
  if (viewer) return { Subj: nm(mover), subj: nm(mover), Poss: `${nm(mover)}'s`, poss: `${nm(mover)}'s`, loses: 'loses', has: 'had', oppPoss: 'your', Opp: 'You' };
  const o = other(mover);
  return { Subj: nm(mover), subj: nm(mover), Poss: `${nm(mover)}'s`, poss: `${nm(mover)}'s`, loses: 'loses', has: 'had', oppPoss: `${nm(o)}'s`, Opp: nm(o) };
}

/**
 * game: { fens, moves (uci), sans, review, viewer ('w'|'b'|null), names {w, b} }.
 * Returns { headline, lines: [sentences], bestSan }.
 */
export function explainMove(i, game) {
  const { fens, moves, sans, review } = game;
  const viewer = game.viewer === undefined ? fens[i].split(' ')[1] : game.viewer;
  const label = review.labels[i];
  const san = sans[i];
  const color = fens[i].split(' ')[1];
  const v = voice(color, viewer, game.names);
  const before = review.evals[i];
  const after = review.evals[i + 1];
  const bestUci = review.best[i];
  const bestSan = bestUci ? uciLineToSan(fens[i], [bestUci])[0] : null;
  const bestLine = uciLineToSan(fens[i], review.pv[i] || [], 6);
  const refuteLine = uciLineToSan(fens[i + 1], review.pv[i + 1] || [], 6);
  const b = pov(before, color);
  const a = pov(after, color);
  const evalShift = `${formatScore(before)} → ${formatScore(after)}`;
  const lines = [];

  if (label === 'forced') {
    return { headline: `${san} was forced.`, lines: ['It was the only legal move.'], bestSan };
  }
  if (label === 'book') {
    return { headline: `${san} is a book move.`, lines: ['A well-known opening move that theory and strong players use.'], bestSan };
  }
  if (label === 'brilliant') {
    const sac = isSacrifice(fens[i], moves[i], review.pv[i + 1] || []);
    if (sac) {
      const piece = PIECE_NAMES[sac.piece];
      const takes = refuteLine[0] && review.pv[i + 1]?.[0]?.slice(2, 4) === sac.square;
      lines.push(`A sound sacrifice: ${san} offers the ${piece} on ${sac.square}, yet it is one of the strongest moves (${formatScore(after)}).`);
      lines.push(takes ? `Taking it with ${refuteLine[0]} is still the best try, but ${formatLine(fens[i + 1], refuteLine.slice(0, 5))} shows why the sacrifice works.` : `Taking the ${piece} would be a mistake${refuteLine[0] ? `; the best reply is ${refuteLine[0]}` : ''}.`);
    } else {
      lines.push(`It is one of the strongest moves (${formatScore(after)}).`);
    }
    return { headline: `${san} is brilliant!`, lines, bestSan };
  }
  if (label === 'great') {
    const sec = review.second?.[i];
    const secSan = sec?.move ? uciLineToSan(fens[i], [sec.move])[0] : null;
    const wa = color === 'w' ? winPct(after) : 100 - winPct(after);
    const keeps = wa >= 60 ? `keeps ${v.poss} advantage` : wa >= 40 ? 'holds the balance' : `keeps ${v.subj === 'you' ? 'you' : v.subj} in the game`;
    lines.push(`It is the only move that ${keeps} (${formatScore(after)}).`);
    if (secSan) lines.push(`The next best option, ${secSan}, would have been much worse (${formatScore(sec)}).`);
    return { headline: `${san} is a great move!`, lines, bestSan };
  }
  if (label === 'best') {
    if (a.mate != null && a.mate > 0) lines.push(`It keeps a forced mate in ${a.mate}.`);
    else if (after?.mate === 0) lines.push('Checkmate. Nothing better exists.');
    else if (bestUci && bestUci !== moves[i]) lines.push(`It is at least as strong as the engine's first choice, ${bestSan} (${formatScore(after)}).`);
    else lines.push(`It is the engine's top choice here (${formatScore(after)}).`);
    return { headline: `${san} is the best move.`, lines, bestSan };
  }
  if (label === 'excellent' || label === 'good') {
    const word = label === 'excellent' ? 'an excellent' : 'a good';
    if (bestSan && bestSan !== san) {
      lines.push(`It stays close to the best line (${evalShift}).`);
      lines.push(`The engine's first choice was ${bestSan}${describeBest(fens[i], bestUci)}: ${formatLine(fens[i], bestLine)}.`);
    }
    return { headline: `${san} is ${word} move.`, lines, bestSan };
  }

  const headline = `${san} is ${label === 'inaccuracy' ? 'an inaccuracy' : 'a ' + label}.`;
  const replySan = refuteLine[0];
  if (label === 'miss') {
    lines.push(`${v.Opp === 'You' ? 'Your' : v.Opp === 'Your opponent' ? 'Your opponent\'s' : `${v.Opp}'s`} previous move was an error, but ${san} lets the chance slip (${evalShift}).`);
  }

  // 1. mates
  if (b.mate != null && b.mate > 0 && !(a.mate != null && a.mate > 0)) {
    const full = uciLineToSan(fens[i], review.pv[i] || [], b.mate * 2 - 1);
    const shown = full.length >= b.mate * 2 - 1 ? formatLine(fens[i], full) : `starting with ${bestSan}`;
    lines.push(`${v.Subj} ${v.has} a forced mate in ${b.mate}: ${shown}.`);
  } else if (a.mate != null && a.mate < 0 && !(b.mate != null && b.mate < 0)) {
    const full = uciLineToSan(fens[i + 1], review.pv[i + 1] || [], -a.mate * 2 - 1);
    const shown = full.length >= -a.mate * 2 - 1 ? formatLine(fens[i + 1], full) : `starting with ${replySan}`;
    lines.push(`This allows a forced mate in ${-a.mate}: ${shown}.`);
  } else {
    // 2. material: compare where the played line and the best line settle, and only say so when
    // the evaluation agrees that material is the story
    const pawns = (x) => (x.mate != null ? (x.mate > 0 ? 20 : -20) : (x.cp ?? 0) / 100);
    const evalLoss = pawns(b) - pawns(a);
    const played = playOut(fens[i + 1], review.pv[i + 1] || [], color);
    const bestFull = bestUci ? [bestUci, ...(review.pv[i] || []).slice(1)] : [];
    const bestL = playOut(fens[i], bestFull, color);
    const matLoss = bestL.end - played.end;         // what the move costs compared with the best line
    const actualLoss = played.start - played.end;   // what the played line really drops
    const moved = moves[i].slice(2, 4);
    const firstCap = played.caps.find(c => c.ply === 0 && c.by !== color);
    const lostWhat = lossText(played.caps, color);
    const supported = (x) => evalLoss >= Math.min(x, 9) * 0.6;
    if (actualLoss >= 1 && matLoss >= 1 && lostWhat && supported(actualLoss)) {
      // print the line as far as the trade is counted, so every capture named is visible
      const shown = uciLineToSan(fens[i + 1], review.pv[i + 1] || [], Math.max(1, Math.min(played.settlePly + 1, 10)));
      const lineTxt = formatLine(fens[i + 1], shown);
      const tail = `, ${v.subj} ${v.loses} ${lostWhat}`;
      const extra = shown.length > 1 ? ` (after ${lineTxt}${tail})` : '';
      if (firstCap) {
        const what = PIECE_NAMES[firstCap.piece];
        const sq = firstCap.square;
        const defended = new Chess(fens[i + 1]).attackers(sq, color).length > 0;
        const by = PIECE_NAMES[firstCap.attacker];
        if (sq === moved && !defended) lines.push(`${v.Poss} ${what} on ${sq} is left hanging: ${replySan} wins it${extra}.`);
        else if (sq === moved) lines.push(`${v.Poss} ${what} on ${sq} can be taken by a ${by}: after ${lineTxt}${tail}.`);
        else if (wasHanging(fens[i], sq, color)) lines.push(`${v.Poss} ${what} on ${sq} was already under attack, and ${san} does nothing about it: ${replySan} wins it${extra}.`);
        else if (!defended) lines.push(`This leaves ${v.poss} ${what} on ${sq} undefended, and ${replySan} wins it${extra}.`);
        else lines.push(`${v.Poss} ${what} on ${sq} is attacked by a ${by}: after ${lineTxt}${tail}.`);
      } else {
        const fork = replyFork(fens[i + 1], review.pv[i + 1], color, v);
        if (fork) lines.push(`${fork} After ${lineTxt}${tail}.`);
        else lines.push(`It allows ${lineTxt}, and ${v.subj} ${v.loses} ${lostWhat}.`);
      }
    } else if (matLoss >= 1 && bestL.end - bestL.start >= 1 && gainText(bestL.caps, color) && supported(matLoss)) {
      const winLine = uciLineToSan(fens[i], bestFull, Math.max(1, Math.min(bestL.settlePly + 1, 10)));
      lines.push(`${v.Subj} missed ${bestSan}, which wins ${gainText(bestL.caps, color)}${winLine.length > 1 ? `: ${formatLine(fens[i], winLine)}` : ''}.`);
    } else if (label !== 'miss') {
      // 3. positional / evaluation swing
      const wb = winPct(b), wa = winPct(a);
      if (wb >= 65 && wa < wb) lines.push(`This lets ${wa < 55 ? `${v.poss} whole` : `much of ${v.poss}`} advantage slip (${evalShift}).`);
      else if (wb > 42 && wa <= 42) lines.push(`This hands ${v.Opp === 'You' ? 'you' : v.Opp === 'Your opponent' ? 'your opponent' : v.Opp} the advantage (${evalShift}).`);
      else lines.push(`${v.Poss} position gets worse (${evalShift}).`);
      if (replySan) lines.push(`${v.Opp === 'Your opponent' ? 'Your opponent\'s' : v.Opp === 'You' ? 'Your' : `${v.Opp}'s`} strongest reply is ${replySan}.`);
    }
  }
  if (bestSan) {
    lines.push(`Better was ${bestSan}${describeBest(fens[i], bestUci)} (${formatScore(before)}), for example ${formatLine(fens[i], bestLine)}.`);
  }
  return { headline, lines, bestSan };
}

function replyFork(fen, pv, color, v) {
  if (!pv?.length) return null;
  const c = new Chess(fen);
  const m = playUci(c, pv[0]);
  if (!m) return null;
  const targets = forkTargets(c, m.to, color);
  if (targets.length >= 2) {
    const names = targets.slice(0, 2).map(t => t.type === 'k' ? 'king' : `${PIECE_NAMES[t.type]} on ${t.square}`);
    return `This allows ${m.san}, a fork that attacks ${v.poss} ${names[0]} and ${names[1]} at once.`;
  }
  return null;
}
