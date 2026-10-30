// Short plain-English explanations for reviewed moves, built from the engine's lines.
import { Chess, playUci, uciLineToSan, formatLine, VALUES, PIECE_NAMES, other } from './chessutil.js';
import { formatScore } from './engine.js';

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
 * plus the first capture made by each side.
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
    if (m.captured) caps.push({ by: m.color, piece: m.captured, square: m.to, san: m.san, ply: i });
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
 * game: { fens, moves (uci), sans, review }. Returns { headline, lines: [sentences], bestSan }.
 */
export function explainMove(i, game) {
  const { fens, moves, sans, review } = game;
  const label = review.labels[i];
  const san = sans[i];
  const color = fens[i].split(' ')[1];
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
  if (label === 'best') {
    if (a.mate != null && a.mate > 0) lines.push(`It keeps a forced mate in ${a.mate}.`);
    else if (after?.mate === 0) lines.push('Checkmate. Nothing better exists.');
    else lines.push(`It is the engine's top choice here (${formatScore(after)}).`);
    return { headline: `${san} is the best move.`, lines, bestSan };
  }
  if (label === 'excellent' || label === 'good') {
    const word = label === 'excellent' ? 'an excellent' : 'a good';
    if (bestSan && bestSan !== san) {
      lines.push(`It keeps the balance close to the best line (${evalShift}).`);
      lines.push(`The engine's first choice was ${bestSan}${describeBest(fens[i], bestUci)}: ${formatLine(fens[i], bestLine)}.`);
    }
    return { headline: `${san} is ${word} move.`, lines, bestSan };
  }

  const headline = `${san} is ${label === 'inaccuracy' ? 'an inaccuracy' : 'a ' + label}.`;
  const replySan = refuteLine[0];

  // 1. mates
  if (b.mate != null && b.mate > 0 && !(a.mate != null && a.mate > 0)) {
    lines.push(`You had a forced mate in ${b.mate}: ${formatLine(fens[i], bestLine.slice(0, b.mate * 2 - 1))}.`);
  } else if (a.mate != null && a.mate < 0 && !(b.mate != null && b.mate < 0)) {
    lines.push(`This allows a forced mate in ${-a.mate}: ${formatLine(fens[i + 1], refuteLine.slice(0, -a.mate * 2))}.`);
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
    if (lost >= 1 && firstOpp) {
      const what = PIECE_NAMES[firstOpp.piece];
      if (firstOpp.square === moved && firstOpp.ply === 0) {
        lines.push(`Your ${what} on ${moved} can simply be taken: ${replySan}${lost >= VALUES[firstOpp.piece] ? ' wins it for free' : ''}.`);
      } else if (firstOpp.ply === 0) {
        lines.push(`This leaves your ${what} on ${firstOpp.square} undefended, and ${replySan} wins it.`);
      } else {
        const fork = replyFork(fens[i + 1], review.pv[i + 1], color);
        if (fork) lines.push(fork);
        else lines.push(`It allows ${formatLine(fens[i + 1], refuteLine.slice(0, 4))}, and you lose ${materialWords(lost)}.`);
      }
    } else if (lost >= 1) {
      const fork = replyFork(fens[i + 1], review.pv[i + 1], color);
      lines.push(fork || `It allows ${formatLine(fens[i + 1], refuteLine.slice(0, 4))}, and you lose ${materialWords(lost)}.`);
    } else if (gained >= 2 && gained - Math.max(0, -lost) >= 2) {
      const myCap = afterBest.caps.find(c => c.by === color);
      const what = myCap ? `the ${PIECE_NAMES[myCap.piece]} on ${myCap.square}` : materialWords(gained);
      lines.push(`You missed a chance to win ${gained >= 3 && myCap ? what : materialWords(gained)} with ${bestSan}.`);
    } else {
      // 3. positional / evaluation swing
      const bc = b.mate != null ? (b.mate > 0 ? 1000 : -1000) : b.cp;
      const ac = a.mate != null ? (a.mate > 0 ? 1000 : -1000) : a.cp;
      if (bc >= 150 && ac < bc) lines.push(`This lets ${ac < 60 ? 'your whole' : 'much of your'} advantage slip (${evalShift}).`);
      else if (bc > -80 && ac <= -80) lines.push(`This hands your opponent the advantage (${evalShift}).`);
      else lines.push(`Your position gets worse (${evalShift}).`);
      if (replySan) lines.push(`Your opponent's strongest reply is ${replySan}.`);
    }
  }
  if (bestSan) {
    lines.push(`Better was ${bestSan}${describeBest(fens[i], bestUci)} (${formatScore(before)}), for example ${formatLine(fens[i], bestLine)}.`);
  }
  return { headline, lines, bestSan };
}

function replyFork(fen, pv, color) {
  if (!pv?.length) return null;
  const c = new Chess(fen);
  const m = playUci(c, pv[0]);
  if (!m) return null;
  const targets = forkTargets(c, m.to, color);
  if (targets.length >= 2) {
    const names = targets.slice(0, 2).map(t => t.type === 'k' ? 'king' : `${PIECE_NAMES[t.type]} on ${t.square}`);
    return `This allows ${m.san}, a fork that attacks your ${names[0]} and ${names[1]} at once.`;
  }
  return null;
}
