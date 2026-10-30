// Fetch a player's recent games from chess.com or Lichess (public APIs, called from the browser)
// and turn PGNs into game records that the review understands.
import { Chess, START_FEN } from './chessutil.js';
import { openingOf } from './openings-data.js';

/** Recent standard games for a username: [{ site, id, pgn, white, black, result, date, speed }] */
export async function fetchRecentGames(site, username, max = 20) {
  const user = username.trim();
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(user)) throw new Error('That does not look like a valid username.');
  if (site === 'lichess') {
    const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${max}&pgnInJson=true&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence`;
    const res = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });
    if (res.status === 404) throw new Error('No Lichess player with that name.');
    if (res.status === 429) throw new Error('Lichess is rate-limiting requests. Wait a minute and try again.');
    if (!res.ok) throw new Error(`Lichess answered with an error (${res.status}).`);
    const text = await res.text();
    return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
      .filter(g => g.variant === 'standard' && g.pgn)
      .map(g => ({ site, id: g.id, pgn: g.pgn, date: g.createdAt, speed: g.speed }));
  }
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/archives`;
  const res = await fetch(base);
  if (res.status === 404) throw new Error('No chess.com player with that name.');
  if (!res.ok) throw new Error(`chess.com answered with an error (${res.status}).`);
  const { archives = [] } = await res.json();
  const out = [];
  for (const url of [...archives].reverse()) {
    const r = await fetch(url);
    if (!r.ok) break;
    const { games = [] } = await r.json();
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
  return { headers, startFen: start, moves, sans: c.history(), final: c };
}

/**
 * Builds a review-ready game record from a PGN. `me` is the username to find (case-insensitive),
 * or an explicit colour 'w'/'b', or null for a game you only watched.
 */
export function recordFromPgn(pgn, me, { site = 'import' } = {}) {
  const { headers, startFen, moves, sans, final } = parsePgn(pgn);
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
  const dateStr = headers.UTCDate || headers.Date;
  const parsed = dateStr && /^\d{4}\.\d{2}\.\d{2}$/.test(dateStr) ? Date.parse(dateStr.replace(/\./g, '-')) : NaN;
  const op = startFen === START_FEN ? openingOf(moves) : null;
  const key = `${site}:${headers.Link || headers.Site || ''}:${dateStr || ''}:${white}:${black}:${moves.length}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return {
    id: 'imp' + (h >>> 0).toString(36),
    imported: true, spectator, source: site,
    date: Number.isFinite(parsed) ? parsed : Date.now(), endedAt: Date.now(),
    startFen: startFen === START_FEN ? undefined : startFen,
    whiteName: white, blackName: black,
    userColor: colour, botName: headers[opp] || opp, botLabel: headers[opp + 'Elo'] || '', botElo: +(headers[opp + 'Elo']) || null,
    tc: headers.TimeControl || null, moves, sans,
    result, reason: headers.Termination || (final.isCheckmate() ? 'checkmate' : 'imported game'), userResult,
    opening: op ? { eco: op.eco, name: op.name } : null, takebacks: 0, hints: 0, review: null,
  };
}
