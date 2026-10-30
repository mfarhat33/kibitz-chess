// Learn from your mistakes: every mistake, miss and blunder from your reviewed games becomes a
// position to replay. Stockfish judges your new move; spaced repetition brings back the hard ones.
import { Board } from '../board.js';
import { Chess, dests, checkSquare, playUci, uciToMove, colorName, START_FEN } from '../chessutil.js';
import { getEngine, toWhite } from '../engine.js';
import { positions, winPct, labelFor, LABEL_TEXT, LABEL_GLYPH, BAD_LABELS } from '../analysis.js';
import { reviewCard } from '../srs.js';
import * as store from '../store.js';
import { icons, esc, $, sound, moveSound, fmtDate } from '../ui.js';
import { puzzleTabs } from './puzzles.js';

const KINDS = ['miss', 'mistake', 'blunder'];
let ctx = null;
export function unmount() { ctx?.destroy(); ctx = null; }

export function collectMistakes(games) {
  const out = [];
  for (const g of games) {
    if (!g.review || g.spectator) continue;
    let fens;
    try { fens = positions(g.moves, g.startFen || START_FEN); } catch { continue; }
    g.review.labels.forEach((lab, i) => {
      if (!KINDS.includes(lab) || fens[i].split(' ')[1] !== g.userColor || !g.review.best[i]) return;
      out.push({
        id: `${g.id}:${i}`, gameId: g.id, ply: i, fen: fens[i], startFen: g.startFen || START_FEN, prefix: g.moves.slice(0, i),
        played: g.sans?.[i] || g.moves[i], playedUci: g.moves[i], label: lab, best: g.review.best[i], bestEval: g.review.evals[i],
        depth: g.review.depth || 14, color: g.userColor, opp: g.botName, date: g.date,
      });
    });
  }
  return out;
}

function cards() { return store.get('mistakes', { cards: {} }).cards || {}; }
function saveCard(id, card) { const c = cards(); c[id] = card; store.set('mistakes', { cards: c }); }

export function mount(root) {
  const all = collectMistakes(store.allGames());
  const cs = cards();
  const now = Date.now();
  const due = all.filter(m => !cs[m.id] || cs[m.id].due <= now).sort((a, b) => (cs[a.id]?.due || 0) - (cs[b.id]?.due || 0) || b.date - a.date);
  const fixed = all.filter(m => cs[m.id]?.reps >= 2).length;
  root.innerHTML = `
    ${puzzleTabs('mistakes')}
    <div class="page stack" style="max-width:760px;margin:0 auto">
      <div class="hero"><h1 style="margin:0">Learn from your mistakes</h1><p class="muted small" style="margin:.2em 0 0">Every miss, mistake and blunder from your reviewed games, as positions to replay. Find a better move than you played; Stockfish judges it. Positions you get wrong come back sooner.</p></div>
      <div class="kpis">
        <div class="kpi"><div class="stat-label">Due now</div><div class="stat-big">${due.length}</div></div>
        <div class="kpi"><div class="stat-label">Collected</div><div class="stat-big">${all.length}</div></div>
        <div class="kpi"><div class="stat-label">Fixed</div><div class="stat-big">${fixed}</div><div class="tiny muted">solved twice or more</div></div>
      </div>
      ${all.length ? `<button class="btn primary block" id="m-go" type="button" ${due.length ? '' : 'disabled'}>${icons.start} ${due.length ? `Practise ${Math.min(due.length, 10)} position${Math.min(due.length, 10) === 1 ? '' : 's'}` : 'Nothing due. Come back later!'}</button>`
        : `<div class="card empty">No mistakes collected yet. Play and review a few games (or import yours under Play → My games) and they will appear here.<br><a class="btn primary" style="margin-top:12px" href="#/play">${icons.start} Play a game</a></div>`}
    </div>`;
  $('#m-go', root)?.addEventListener('click', () => practise(root, due.slice(0, 10)));
}

function practise(root, queue) {
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
    card.innerHTML = `
      <div class="row between nowrap"><span class="tiny muted">Position ${k} of ${queue.length}</span><span class="tiny muted">${solved} fixed</span></div>
      <h2 style="margin:0">Find a better move</h2>
      <p class="small" style="margin:0">From your game vs ${esc(m.opp)} (${fmtDate(m.date)}), move ${(+m.fen.split(' ')[5]) || 1}. You played <b>${esc(m.played)}</b>, a <span class="tq-${m.label}" style="font-weight:700">${LABEL_TEXT[m.label].toLowerCase()}</span>.</p>
      <div class="status info" id="m-status">${m.color === 'w' ? 'White' : 'Black'} to move</div>
      <div class="grid-2"><button class="btn" id="m-show" type="button">${icons.eye} Show best</button><a class="btn" href="#/review/${encodeURIComponent(m.gameId)}">${icons.search} Open game</a></div>`;
    const status = (html, cls) => { const s = $('#m-status', card); if (s) { s.className = 'status ' + cls; s.innerHTML = html; } };
    const finish = (good) => {
      const prevCard = cards()[m.id] || { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0, last: 0 };
      saveCard(m.id, reviewCard(prevCard, good ? (tries === 1 ? 5 : 3) : 1));
      if (good) solved++;
      board.setMovable({});
      card.querySelector('.grid-2').outerHTML = `<button class="btn primary block" id="m-next" type="button">${icons.next} ${k < queue.length ? 'Next position' : 'Finish'}</button>`;
      $('#m-next', card).addEventListener('click', next);
    };
    $('#m-show', card).addEventListener('click', () => {
      const b = uciToMove(m.best);
      board.setArrows([{ from: b.from, to: b.to, color: 'rgba(16,150,110,.85)' }]);
      tries = Math.max(tries, 2);
      const san = new Chess(m.fen).move({ from: b.from, to: b.to, promotion: b.promotion })?.san;
      status(`The engine's best move was <b>${esc(san || m.best)}</b>. This position will come back soon.`, 'info');
      if (!$('#m-next', card)) finish(false);
    });
    board.opts.onMove = async (from, to, promo) => {
      if (tok !== token) return;
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
          if (!alive || tok !== token) return;
          if (!r?.lines[0]) { status('The engine is not available right now.', 'bad'); reset(); return; }
          score = toWhite(r.lines[0], after.turn());
        }
        const pov = (w) => (m.color === 'w' ? w : 100 - w);
        label = labelFor(Math.max(0, pov(winPct(m.bestEval)) - pov(winPct(score))), false);
      }
      const good = !BAD_LABELS.includes(label);
      sound(good ? 'good' : 'bad');
      board.setBadges([{ sq: mv.to, cls: label, text: LABEL_GLYPH[label] }]);
      if (good) {
        status(`${icons.check} ${esc(mv.san)}: ${LABEL_TEXT[label].toLowerCase()}! Much better than ${esc(m.played)}.`, 'ok');
        if (!$('#m-next', card)) finish(true);
      } else {
        status(`${esc(mv.san)} is ${label === 'inaccuracy' ? 'an' : 'a'} ${LABEL_TEXT[label].toLowerCase()} too. Try again.`, 'bad');
        setTimeout(() => { if (alive && tok === token && !$('#m-next', card)) { board.setBadges([]); reset(); } }, 1100);
      }
    };
  }

  function done() {
    board.setMovable({});
    card.innerHTML = `<div class="stat-label">Session complete</div><div class="rush-score" style="font-size:2.6rem">${solved}/${queue.length}</div>
      <p class="small muted" style="margin:0">positions fixed. The ones you missed will come back sooner.</p>
      <a class="btn primary block" href="#/mistakes">${icons.list} Back</a>`;
  }
  next();
}
