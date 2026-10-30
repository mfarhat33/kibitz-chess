// Short plain-English explanations for reviewed moves, built from the engine's lines.
import { Chess, playUci, uciLineToSan, formatLine, VALUES, PIECE_NAMES, other } from './chessutil.js';
import { formatScore } from './engine.js';
import { winPct } from './analysis.js';

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
 * Plays a line and returns the mover's material balance once the captures settle,
 * plus the captures made along the way.
 */
export function playOut(fen, ucis, color, maxPlies = 8) {
  const c = new Chess(fen);
  const start = balance(c, color);
  let settled = start;
  const caps = [];
  const n = Math.min(ucis.length, maxPlies);
  for (let i = 0; i < n; i++) {
    const m = playUci(c, ucis[i]);
    if (!m) break;
    if (m.captured) caps.push({ by: m.color, piece: m.captured, square: m.to, san: m.san, ply: i, attacker: m.piece });
    const next = i + 1 < n ? ucis[i + 1] : null;
    if (!next || !isCapture(c, next)) {
      // quiet point: no recapture pending
      settled = balance(c, color);
      if (i >= 2) break;
    }
  }
  return { start, end: settled, caps };
}

function isCapture(chess, uci) {
  const from = chess.get(uci.slice(0, 2));
  if (chess.get(uci.slice(2, 4))) return true;
  return !!from && from.type === 'p' && uci[0] !== uci[2];
}

function materialWords(n) {
  if (n >= 9) return 'a lot of material';
  if (n >= 5) return 'a rook\'s worth of material';
  if (n >= 3) return 'a piece';
  if (n === 2) return 'two pawns';
  return 'a pawn';
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

  if (label === 'book') {
    return { headline: `${san} is a book move.`, lines: ['A well-known opening move that theory and strong players use.'], bestSan };
  }
  if (label === 'brilliant') {
    const c = new Chess(fens[i]);
    const m = playUci(c, moves[i]);
    const piece = PIECE_NAMES[m.promotion || m.piece];
    const takes = refuteLine[0] && review.pv[i + 1]?.[0]?.slice(2, 4) === m.to;
    lines.push(`A sound sacrifice: the ${piece} on ${m.to} can be taken, yet ${san} is one of the strongest moves (${formatScore(after)}).`);
    lines.push(takes ? `Taking it with ${refuteLine[0]} is still the best try, but ${formatLine(fens[i + 1], refuteLine.slice(0, 5))} shows why the sacrifice works.` : `Taking the ${piece} would be a mistake${refuteLine[0] ? `: the best reply is ${refuteLine[0]}` : ''}.`);
    return { headline: `${san} is brilliant!`, lines, bestSan };
  }
  if (label === 'great') {
    const sec = review.second?.[i];
    const secSan = sec?.move ? uciLineToSan(fens[i], [sec.move])[0] : null;
    lines.push(`It is the only move that keeps ${v.poss} position (${formatScore(after)}).`);
    if (secSan) lines.push(`The next best option, ${secSan}, would have been much worse (${formatScore(sec)}).`);
    return { headline: `${san} is a great move!`, lines, bestSan };
  }
  if (label === 'best') {
    if (a.mate != null && a.mate > 0) lines.push(`It keeps a forced mate in ${a.mate}.`);
    else if (after?.mate === 0) lines.push('Checkmate. Nothing better exists.');
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
    // 2. material
    const afterPlayed = playOut(fens[i + 1], review.pv[i + 1] || [], color);
    const bestFull = bestUci ? [bestUci, ...(review.pv[i] || []).slice(1)] : [];
    const afterBest = playOut(fens[i], bestFull, color);
    const base = afterBest.start;
    const lost = base - afterPlayed.end;
    const gained = afterBest.end - base;
    const moved = moves[i].slice(2, 4);
    const firstOpp = afterPlayed.caps.find(c => c.by !== color);
    if (lost >= 1 && firstOpp && firstOpp.ply === 0) {
      const what = PIECE_NAMES[firstOpp.piece];
      const posAfter = new Chess(fens[i + 1]);
      const defended = posAfter.attackers(firstOpp.square, color).length > 0;
      const by = PIECE_NAMES[firstOpp.attacker];
      if (firstOpp.square === moved && !defended) {
        lines.push(`${v.Poss} ${what} on ${moved} can simply be taken: ${replySan} wins it for free.`);
      } else if (firstOpp.square === moved) {
        lines.push(`${v.Poss} ${what} on ${moved} can be taken by a ${by}: after ${formatLine(fens[i + 1], refuteLine.slice(0, 3))}, ${v.subj} ${v.loses} ${materialWords(lost)}.`);
      } else if (!defended) {
        lines.push(`This leaves ${v.poss} ${what} on ${firstOpp.square} undefended, and ${replySan} wins it.`);
      } else {
        lines.push(`${v.Poss} ${what} on ${firstOpp.square} is attacked by a ${by}: ${replySan} wins ${materialWords(lost)}.`);
      }
    } else if (lost >= 1) {
      const fork = replyFork(fens[i + 1], review.pv[i + 1], color, v);
      lines.push(fork || `It allows ${formatLine(fens[i + 1], refuteLine.slice(0, 4))}, and ${v.subj} ${v.loses} ${materialWords(lost)}.`);
    } else if (gained >= 2 && gained - Math.max(0, -lost) >= 2) {
      const myCap = afterBest.caps.find(c => c.by === color);
      const what = myCap ? `the ${PIECE_NAMES[myCap.piece]} on ${myCap.square}` : materialWords(gained);
      lines.push(`${v.Subj} missed a chance to win ${gained >= 3 && myCap ? what : materialWords(gained)} with ${bestSan}.`);
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
