// Learn from your mistakes: every mistake, miss and blunder from your reviewed games becomes a
// position to replay, tagged with why it went wrong. Missed tactics are played out move by move,
// and "punish it" positions come from opponent errors you let go. Spaced repetition brings back
// the hard ones.
import { Board } from '../board.js';
import { Chess, dests, checkSquare, playUci, uciToMove, colorName, START_FEN } from '../chessutil.js';
import { getEngine, toWhite } from '../engine.js';
import { positions, gradeMove, LABEL_TEXT, LABEL_GLYPH, BAD_LABELS } from '../analysis.js';
import { playOut } from '../explain.js';
import { gameErrors, CATS, MOTIFS } from '../coach.js';
import { reviewCard } from '../srs.js';
import * as store from '../store.js';
import { icons, esc, $, sound, moveSound, fmtDate } from '../ui.js';
import { puzzleTabs } from './puzzles.js';

let ctx = null;
export function unmount() { ctx?.destroy(); ctx = null; }

/** The winning line to play out after the best move: odd length (your moves at even indexes), or []. */
function tacticLine(g, i, fen, cat) {
  const r = g.review;
  if (!r.best[i]) return [];
  const full = [r.best[i], ...(r.pv[i] || []).slice(1)];
  let n = 1;
  if (cat === 'missedMate') {
    const m = Math.abs(r.evals[i]?.mate || 0);
    n = m * 2 - 1;
  } else if (cat === 'missedTactic' || cat === 'punish') {
    const po = playOut(fen, full, g.userColor, 7);
    n = po.settlePly + 1;
    if (n % 2 === 0) n--; // end on your own move
  }
  n = Math.min(n, 7, full.length % 2 ? full.length : full.length - 1);
  return n >= 3 ? full.slice(0, n) : [];
}

export function collectMistakes(games) {
  const out = [];
  for (const g of games) {
    if (!g.review || g.spectator) continue;
    let fens;
    try { fens = positions(g.moves, g.startFen || START_FEN); } catch { continue; }
    const r = g.review;
    const base = (i) => ({
      id: `${g.id}:${i}`, gameId: g.id, ply: i, fen: fens[i], startFen: g.startFen || START_FEN, prefix: g.moves.slice(0, i),
      played: g.sans?.[i] || g.moves[i], playedUci: g.moves[i], label: r.labels[i], best: r.best[i], bestEval: r.evals[i],
      depth: r.depth || 14, color: g.userColor, opp: g.botName, date: g.date,
    });
    const seen = new Set();
    let errs = [];
    try { errs = gameErrors(g); } catch { errs = []; }
    for (const e of errs) {
      if (e.flagged || !r.best[e.ply]) continue;
      const punish = e.ply > 0 && r.labels[e.ply] === 'miss';
      const lineCat = punish && e.under === 'positional' ? 'punish' : e.under;
      out.push({ ...base(e.ply), cat: e.cat, under: e.under, motif: e.motif, punish, line: tacticLine(g, e.ply, fens[e.ply], lineCat) });
      seen.add(e.ply);
    }
    // punish it: the opponent erred badly and your reply let most of it go (not already an error)
    r.labels.forEach((lab, i) => {
      if (i === 0 || seen.has(i) || fens[i].split(' ')[1] !== g.userColor || !r.best[i] || r.best[i] === g.moves[i]) return;
      if (!['mistake', 'blunder'].includes(r.labels[i - 1]) || (r.loss?.[i - 1] ?? 0) < 15) return;
      if (lab !== 'inaccuracy' || (r.loss?.[i] ?? 0) < 5) return;
      out.push({ ...base(i), cat: 'missedTactic', under: 'missedTactic', motif: null, punish: true, line: tacticLine(g, i, fens[i], 'punish') });
    });
  }
  return out;
}

function cards() { return store.get('mistakes', { cards: {} }).cards || {}; }
function saveCard(id, card) { const c = cards(); c[id] = card; store.set('mistakes', { cards: c }); }

const FILTERS = [['all', 'All'], ['punish', 'Punish it'], ...Object.entries(CATS).map(([k, v]) => [k, v.name])];
const inFilter = (m, f) => f === 'all' || (f === 'punish' ? m.punish : m.cat === f);

export function mount(root, params = []) {
  const all = collectMistakes(store.allGames());
  const filter = FILTERS.some(([k]) => k === params[0]) ? params[0] : 'all';
  const cs = cards();
  const now = Date.now();
  const shown = all.filter(m => inFilter(m, filter));
  const due = shown.filter(m => !cs[m.id] || cs[m.id].due <= now).sort((a, b) => (cs[a.id]?.due || 0) - (cs[b.id]?.due || 0) || b.date - a.date);
  const fixed = shown.filter(m => cs[m.id]?.reps >= 2).length;
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, all.filter(m => inFilter(m, k)).length]));
  root.innerHTML = `
    ${puzzleTabs('mistakes')}
    <div class="page stack" style="max-width:760px;margin:0 auto">
      <div class="hero"><h1 style="margin:0">Learn from your mistakes</h1><p class="muted small" style="margin:.2em 0 0">Every miss, mistake and blunder from your reviewed games, sorted by why it happened. Find a better move than you played; Stockfish judges it. Missed tactics are played to the end. Positions you get wrong come back sooner.</p></div>
      ${all.length ? `<div class="chips" role="group" aria-label="Pattern">${FILTERS.filter(([k]) => k === 'all' || counts[k]).map(([k, name]) => `<a class="chip" href="#/mistakes${k === 'all' ? '' : '/' + k}" aria-pressed="${k === filter}" style="text-decoration:none">${esc(name)} <span class="muted">${counts[k]}</span></a>`).join('')}</div>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="stat-label">Due now</div><div class="stat-big">${due.length}</div></div>
        <div class="kpi"><div class="stat-label">Collected</div><div class="stat-big">${shown.length}</div></div>
        <div class="kpi"><div class="stat-label">Fixed</div><div class="stat-big">${fixed}</div><div class="tiny muted">solved twice or more</div></div>
      </div>
      ${all.length ? `<button class="btn primary block" id="m-go" type="button" ${due.length ? '' : 'disabled'}>${icons.start} ${due.length ? `Practise ${Math.min(due.length, 10)} position${Math.min(due.length, 10) === 1 ? '' : 's'}` : 'Nothing due here. Come back later!'}</button>`
        : `<div class="card empty">No mistakes collected yet. Play and review a few games (or import yours from the Coach tab) and they will appear here.<br><a class="btn primary" style="margin-top:12px" href="#/play">${icons.start} Play a game</a></div>`}
    </div>`;
  $('#m-go', root)?.addEventListener('click', () => practise(root, due.slice(0, 10), filter));
}

function practise(root, queue, filter) {
  const settings = store.getSettings();
  root.innerHTML = `
    ${puzzleTabs('mistakes')}
    <div class="stage">
      <div class="board-col"><div class="board-shell"><div id="board"></div></div></div>
      <div class="side-col"><section class="card stack" id="m-card"></section></div>
    </div>`;
  const board = new Board($('#board', root), { coordinates: settings.coords, animate: settings.animation });
  const engine = getEngine('analysis');
  let alive = true, token = 0;
  const card = $('#m-card', root);
  let k = 0, solved = 0;
  ctx = { destroy() { alive = false; engine.cancel(); board.destroy(); } };

  function next() {
    if (k >= queue.length) { done(); return; }
    const m = queue[k++];
    const tok = ++token;
    let tries = 0;
    let settled = false;
    const c = new Chess(m.fen);
    const prev = m.prefix.length ? uciToMove(m.prefix[m.prefix.length - 1]) : null;
    board.setOrientation(colorName(m.color));
    board.setArrows([]);
    board.setBadges([]);
    const reset = () => {
      board.setPosition(m.fen, { lastMove: prev ? [prev.from, prev.to] : null, check: checkSquare(c) });
      board.setMovable({ color: colorName(m.color), dests: dests(c) });
    };
    reset();
    const why = m.punish ? 'Your opponent had just erred. Punish it.' : CATS[m.cat] ? `Pattern: ${CATS[m.cat].name.toLowerCase()}${m.motif && MOTIFS[m.motif] && !['mate', 'freePiece'].includes(m.motif) ? ` (${MOTIFS[m.motif]})` : ''}.` : '';
    card.innerHTML = `
      <div class="row between nowrap"><span class="tiny muted">Position ${k} of ${queue.length}</span><span class="tiny muted">${solved} fixed</span></div>
      <h2 style="margin:0">${m.punish ? 'Punish it' : 'Find a better move'}</h2>
      <p class="small" style="margin:0">From your game vs ${esc(m.opp)} (${fmtDate(m.date)}), move ${(+m.fen.split(' ')[5]) || 1}. You played <b>${esc(m.played)}</b>, ${m.label === 'inaccuracy' ? 'an' : 'a'} <span class="tq-${m.label}" style="font-weight:700">${LABEL_TEXT[m.label].toLowerCase()}</span>.</p>
      ${why ? `<p class="tiny muted" style="margin:0">${esc(why)}${m.line?.length >= 3 ? ` Winning line: ${(m.line.length + 1) / 2} of your moves.` : ''}</p>` : ''}
      <div class="status info" id="m-status">${m.color === 'w' ? 'White' : 'Black'} to move</div>
      <div class="grid-2"><button class="btn" id="m-show" type="button">${icons.eye} Show best</button><a class="btn" href="#/review/${encodeURIComponent(m.gameId)}/${m.ply}">${icons.search} Open game</a></div>`;
    const status = (html, cls) => { const s = $('#m-status', card); if (s) { s.className = 'status ' + cls; s.innerHTML = html; } };
    const finish = (good) => {
      if (settled) return;
      settled = true;
      const prevCard = cards()[m.id] || { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0, last: 0 };
      saveCard(m.id, reviewCard(prevCard, good ? (tries === 1 ? 5 : 3) : 1));
      if (good) solved++;
      board.setMovable({});
      const g2 = card.querySelector('.grid-2');
      if (g2) g2.outerHTML = `<button class="btn primary block" id="m-next" type="button">${icons.next} ${k < queue.length ? 'Next position' : 'Finish'}</button>`;
      $('#m-next', card)?.addEventListener('click', next);
    };
    $('#m-show', card).addEventListener('click', () => {
      if (settled) return;
      const b = uciToMove(m.best);
      board.setArrows([{ from: b.from, to: b.to, color: 'rgba(16,150,110,.85)' }]);
      tries = Math.max(tries, 2);
      const san = new Chess(m.fen).move({ from: b.from, to: b.to, promotion: b.promotion })?.san;
      status(`The engine's best move was <b>${esc(san || m.best)}</b>. This position will come back soon.`, 'info');
      finish(false);
    });

    // after the first correct move of a winning line: the opponent replies, you continue
    let lineAt = 0;
    let lineBoard = null;
    const playLine = () => {
      const opp = m.line[lineAt];
      setTimeout(() => {
        if (!alive || tok !== token || settled) return;
        const mv = playUci(lineBoard, opp);
        board.setBadges([]);
        board.setPosition(lineBoard.fen(), { lastMove: [mv.from, mv.to], check: checkSquare(lineBoard) });
        moveSound(mv, lineBoard);
        lineAt++;
        status(`${esc(mv.san)}. Keep going: ${(m.line.length - lineAt + 1) / 2} more of your moves.`, 'info');
        board.setMovable({ color: colorName(m.color), dests: dests(lineBoard) });
      }, 450);
    };

    board.opts.onMove = async (from, to, promo) => {
      if (tok !== token || settled) return;
      if (lineBoard) {
        // continuing the winning line
        const legal = lineBoard.moves({ verbose: true }).find(x => x.from === from && x.to === to && (!x.promotion || x.promotion === (promo || 'q')));
        if (!legal) return;
        const uci = from + to + (legal.promotion || '');
        const before = lineBoard.fen();
        const mv = playUci(lineBoard, uci);
        board.setPosition(lineBoard.fen(), { lastMove: [mv.from, mv.to], check: checkSquare(lineBoard) });
        moveSound(mv, lineBoard);
        const want = m.line[lineAt];
        if (uci === want || lineBoard.isCheckmate()) {
          lineAt++;
          if (lineAt >= m.line.length || lineBoard.isCheckmate()) {
            sound('good');
            status(`${icons.check} ${lineBoard.isCheckmate() ? 'Checkmate. ' : ''}You played the whole line. That is the tactic you missed in the game.`, 'ok');
            finish(true);
          } else { board.setMovable({}); playLine(); }
        } else {
          sound('bad');
          const w = uciToMove(want);
          const wantSan = new Chess(before).move({ from: w.from, to: w.to, promotion: w.promotion })?.san || want;
          board.setArrows([{ from: w.from, to: w.to, color: 'rgba(16,150,110,.85)' }]);
          status(`You found the first move, but the follow-up was <b>${esc(wantSan)}</b>. This one comes back soon.`, 'bad');
          tries = Math.max(tries, 2);
          finish(true);
        }
        return;
      }
      const legal = c.moves({ verbose: true }).find(x => x.from === from && x.to === to && (!x.promotion || x.promotion === (promo || 'q')));
      if (!legal) return;
      tries++;
      const uci = from + to + (legal.promotion || '');
      const after = new Chess(m.fen);
      const mv = playUci(after, uci);
      board.setPosition(after.fen(), { lastMove: [mv.from, mv.to], check: checkSquare(after) });
      board.setMovable({});
      moveSound(mv, after);
      let label;
      if (uci === m.best) label = 'best';
      else if (uci === m.playedUci) label = m.label;
      else {
        status('<span class="spinner"></span> Checking with Stockfish…', 'info');
        let score;
        if (after.isCheckmate()) score = { mate: 0, win: m.color };
        else if (after.isGameOver()) score = { cp: 0 };
        else {
          const r = await engine.analyze(after.fen(), { depth: m.depth, movetime: 4000, startFen: m.startFen, moves: [...m.prefix, uci] });
          // the position may have been settled meanwhile (e.g. "Show best" was pressed)
          if (!alive || tok !== token || settled) return;
          if (!r?.lines[0]) { status('The engine is not available right now.', 'bad'); reset(); return; }
          score = toWhite(r.lines[0], after.turn());
        }
        label = gradeMove(m.bestEval, score, m.color, { givesMate: after.isCheckmate() }).label;
      }
      const good = !BAD_LABELS.includes(label);
      sound(good ? 'good' : 'bad');
      board.setBadges([{ sq: mv.to, cls: label, text: LABEL_GLYPH[label] }]);
      if (good && uci === m.best && m.line?.length >= 3 && !after.isCheckmate()) {
        lineBoard = after;
        lineAt = 1;
        status(`${icons.check} ${esc(mv.san)}! Now finish it.`, 'ok');
        playLine();
      } else if (good) {
        status(`${icons.check} ${esc(mv.san)}: ${LABEL_TEXT[label].toLowerCase()}! Much better than ${esc(m.played)}.`, 'ok');
        finish(true);
      } else {
        status(`${esc(mv.san)} is ${label === 'inaccuracy' ? 'an' : 'a'} ${LABEL_TEXT[label].toLowerCase()} too. Try again.`, 'bad');
        setTimeout(() => { if (alive && tok === token && !settled) { board.setBadges([]); reset(); } }, 1100);
      }
    };
  }

  function done() {
    board.setMovable({});
    card.innerHTML = `<div class="stat-label">Session complete</div><div class="rush-score" style="font-size:2.6rem">${solved}/${queue.length}</div>
      <p class="small muted" style="margin:0">positions fixed. The ones you missed will come back sooner.</p>
      <a class="btn primary block" href="#/mistakes${filter && filter !== 'all' ? '/' + filter : ''}">${icons.list} Back</a>`;
  }
  next();
}
