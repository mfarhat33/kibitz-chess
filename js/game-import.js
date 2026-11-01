// Fetch a player's recent games from chess.com or Lichess (public APIs, called from the browser)
// and turn PGNs into game records that the review understands.
import { Chess, START_FEN } from './chessutil.js';
import { openingOf } from './openings-data.js';

/** Recent standard games for a username: [{ site, id, pgn, white, black, result, date, speed }] */
export async function fetchRecentGames(site, username, max = 20) {
  const user = username.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(user)) throw new Error('That does not look like a valid username.');
  if (site === 'lichess') {
    const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${max}&pgnInJson=true&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true`;
    const res = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });
    if (res.status === 404) throw new Error('No Lichess player with that name.');
    if (res.status === 429) throw new Error('Lichess is rate-limiting requests. Wait a minute and try again.');
    if (!res.ok) throw new Error(`Lichess answered with an error (${res.status}).`);
    const text = await res.text();
    // one damaged line should not sink the whole import
    const rows = text.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    if (!rows.length && text.trim()) throw new Error('Lichess sent an answer this app could not read. Try again later.');
    return rows.filter(g => g.variant === 'standard' && g.pgn)
      .map(g => ({ site, id: g.id, pgn: g.pgn, date: g.lastMoveAt || g.createdAt, speed: g.speed }));
  }
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/archives`;
  const res = await fetch(base);
  if (res.status === 404) throw new Error('No chess.com player with that name.');
  if (!res.ok) throw new Error(`chess.com answered with an error (${res.status}).`);
  let archives = [];
  try { ({ archives = [] } = await res.json()); } catch { throw new Error('chess.com sent an answer this app could not read. Try again later.'); }
  const out = [];
  for (const url of [...archives].reverse()) {
    const r = await fetch(url);
    if (!r.ok) break;
    let games = [];
    try { ({ games = [] } = await r.json()); } catch { break; }
    for (const g of [...games].reverse()) {
      if (g.rules !== 'chess' || !g.pgn) continue;
      out.push({ site, id: g.uuid || g.url, pgn: g.pgn, date: (g.end_time || 0) * 1000, speed: g.time_class });
      if (out.length >= max) return out;
    }
    if (out.length >= max) break;
  }
  return out;
}

/** Parses a PGN into the pieces a game record needs. Throws if the PGN cannot be read. */
export function parsePgn(pgn) {
  const c = new Chess();
  c.loadPgn(pgn, { strict: false });
  const headers = c.getHeaders();
  const start = headers.FEN && headers.SetUp === '1' ? new Chess(headers.FEN).fen() : START_FEN;
  const moves = c.history({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
  return { headers, startFen: start, moves, sans: c.history(), final: c, moveClocks: clocksOf(c, start, moves) };
}

/** Remaining clock after each move from PGN [%clk h:mm:ss] comments (chess.com and Lichess both add them), or null. */
function clocksOf(c, start, moves) {
  let comments;
  try { comments = c.getComments(); } catch { return null; }
  if (!comments?.length) return null;
  const byFen = new Map(comments.map(x => [x.fen, x.comment]));
  const r = new Chess(start);
  const out = [];
  let found = 0;
  for (const u of moves) {
    const m = r.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    if (!m) break;
    const k = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/.exec(byFen.get(r.fen()) || '');
    if (k) { out.push(Math.round(((+k[1]) * 3600 + (+k[2]) * 60 + (+k[3])) * 1000)); found++; } else out.push(null);
  }
  return found >= Math.min(4, moves.length) ? out : null;
}

/**
 * Builds a review-ready game record from a PGN. `me` is the username to find (case-insensitive),
 * or an explicit colour 'w'/'b', or null for a game you only watched.
 */
export function recordFromPgn(pgn, me, { site = 'import', date = null } = {}) {
  const { headers, startFen, moves, sans, final, moveClocks } = parsePgn(pgn);
  const tcm = /^(\d+)\+(\d+)$/.exec(headers.TimeControl || '');
  if (moves.length < 2) throw new Error('The game is too short to review.');
  const white = headers.White || 'White', black = headers.Black || 'Black';
  let userColor = me === 'w' || me === 'b' ? me : null;
  if (!userColor && typeof me === 'string') {
    if (white.toLowerCase() === me.toLowerCase()) userColor = 'w';
    else if (black.toLowerCase() === me.toLowerCase()) userColor = 'b';
  }
  const spectator = !userColor;
  const colour = userColor || 'w';
  const result = ['1-0', '0-1', '1/2-1/2'].includes(headers.Result) ? headers.Result
    : final.isCheckmate() ? (final.turn() === 'w' ? '0-1' : '1-0') : final.isDraw() ? '1/2-1/2' : '*';
  const userResult = spectator || result === '*' ? null : result === '1/2-1/2' ? 'draw' : ((result === '1-0') === (colour === 'w') ? 'win' : 'loss');
  const opp = colour === 'w' ? 'Black' : 'White';
  // UTCDate/UTCTime are UTC; a plain Date tag is a local calendar date
  const dateStr = headers.UTCDate || headers.Date;
  let parsed = NaN;
  if (headers.UTCDate && /^\d{4}\.\d{2}\.\d{2}$/.test(headers.UTCDate)) {
    parsed = Date.parse(`${headers.UTCDate.replace(/\./g, '-')}T${/^\d{2}:\d{2}:\d{2}$/.test(headers.UTCTime || '') ? headers.UTCTime : '12:00:00'}Z`);
  } else if (headers.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(headers.Date)) {
    const [y, mo, d] = headers.Date.split('.').map(Number);
    parsed = new Date(y, mo - 1, d, 12).getTime();
  }
  const op = startFen === START_FEN ? openingOf(moves) : null;
  const key = `${site}:${headers.Link || headers.Site || ''}:${dateStr || ''}:${white}:${black}:${moves.length}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return {
    id: 'imp' + (h >>> 0).toString(36),
    imported: true, spectator, source: site,
    date: date || (Number.isFinite(parsed) ? parsed : Date.now()), endedAt: Date.now(),
    startFen: startFen === START_FEN ? undefined : startFen,
    whiteName: white, blackName: black,
    userColor: colour, botName: headers[opp] || opp, botLabel: headers[opp + 'Elo'] || '', botElo: +(headers[opp + 'Elo']) || null,
    tc: headers.TimeControl || null, moves, sans,
    result, reason: headers.Termination || (final.isCheckmate() ? 'checkmate' : 'imported game'), userResult,
    opening: op ? { eco: op.eco, name: op.name } : null, takebacks: 0, hints: 0, review: null,
    ...(moveClocks ? { moveClocks, tcBase: tcm ? +tcm[1] * 1000 : null, tcInc: tcm ? +tcm[2] * 1000 : 0 } : {}),
  };
}
