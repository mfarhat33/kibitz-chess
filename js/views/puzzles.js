// Rated puzzles from the Lichess puzzle database. Your rating moves after every attempt.
import { Board } from '../board.js';
import * as store from '../store.js';
import { icons, esc, toast, $, sound } from '../ui.js';
import { pickPuzzle, loadIndex, prefetch, loadBucket } from '../puzzle-data.js';
import { PuzzlePlayer, updateRating, START_RATING } from '../puzzle-player.js';
import { themeName } from '../themes.js';
import { Chess, playUci, checkSquare } from '../chessutil.js';

let ctx = null;
export function unmount() { ctx?.destroy(); ctx = null; }

// themes offered in the rated-puzzle picker
const PICK_THEMES = ['', 'mateIn1', 'mateIn2', 'mateIn3', 'fork', 'pin', 'skewer', 'discoveredAttack', 'hangingPiece', 'backRankMate',
  'deflection', 'attraction', 'capturingDefender', 'sacrifice', 'trappedPiece', 'promotion', 'quietMove', 'defensiveMove',
  'endgame', 'pawnEndgame', 'rookEndgame', 'opening', 'middlegame'];

export function puzzleTabs(active) {
  return `<nav class="subtabs"><a href="#/puzzles" class="${active === 'rated' ? 'active' : ''}">Rated</a><a href="#/rush" class="${active === 'rush' ? 'active' : ''}">${icons.bolt.replace('<svg', '<svg style="width:15px;height:15px;vertical-align:-2px;margin-right:2px"')}Rush</a><a href="#/puzzles/daily" class="${active === 'daily' ? 'active' : ''}">Daily</a><a href="#/mistakes" class="${active === 'mistakes' ? 'active' : ''}">My mistakes</a></nav>`;
}

// ---------- daily puzzle: same puzzle for everyone on a given date, unrated ----------
export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function dailyStreak(days, today = new Date()) {
  let n = 0;
  const d = new Date(today);
  if (days[todayKey(d)] !== 1) d.setDate(d.getDate() - 1);
  while (days[todayKey(d)] === 1) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
async function dailyPuzzle() {
  const key = todayKey();
  const h = hashStr('kibitz:' + key);
  const list = await loadBucket(1200 + (h % 6) * 100);
  return list[(h >>> 3) % list.length];
}

async function dailyView(root, isCurrent) {
  root.innerHTML = `${puzzleTabs('daily')}<div class="page"><div class="status"><span class="spinner"></span> Loading today's puzzle…</div></div>`;
  let pz;
  try { await loadIndex(); pz = await dailyPuzzle(); } catch (err) {
    root.querySelector('.page').innerHTML = `<div class="card">${esc(err.message)}</div>`;
    return;
  }
  if (!isCurrent()) return;
  const settings = store.getSettings();
  const key = todayKey();
  const d = { days: {}, ...store.get('daily', {}) };
  root.innerHTML = `
    ${puzzleTabs('daily')}
    <div class="stage">
      <div class="board-col"><div class="board-shell"><div id="board"></div></div></div>
      <div class="side-col">
        <section class="card"><div class="row between nowrap">
          <div><div class="stat-label">Daily puzzle</div><div style="font-weight:800;font-size:1.2rem">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div></div>
          <div style="text-align:right"><div class="stat-label">Streak</div><div class="stat-big" id="d-streak">${dailyStreak(d.days)}</div></div>
        </div></section>
        <div class="status info" id="p-status">${d.days[key] === 1 ? 'You already solved today\'s puzzle. Play it again for fun.' : 'Get ready…'}</div>
        <div class="btn-row">
          <button class="btn" id="p-hint" type="button">${icons.hint}<span>Hint</span></button>
          <button class="btn" id="p-sol" type="button">${icons.eye}<span>Solution</span></button>
          <button class="btn" id="p-flip" type="button">${icons.flip}<span>Flip</span></button>
        </div>
        <section class="card stack hidden" id="p-after"></section>
      </div>
    </div>`;
  const board = new Board($('#board', root), { coordinates: settings.coords, animate: settings.animation });
  let failed = d.days[key] === 0; // failing today's puzzle sticks, even after a reload
  const status = (msg, cls = 'info') => { const s = $('#p-status', root); s.className = 'status ' + cls; s.innerHTML = msg; };
  const save = (ok) => {
    const dd = { days: {}, ...store.get('daily', {}) };
    if (dd.days[key] === undefined || (ok && dd.days[key] !== 1 && !failed)) dd.days[key] = ok ? 1 : 0;
    store.set('daily', dd);
    $('#d-streak', root).textContent = dailyStreak(dd.days);
  };
  const after = () => {
    const el = $('#p-after', root);
    el.classList.remove('hidden');
    el.innerHTML = `<div class="row between"><h3 style="margin:0">Rated ${pz.rating}</h3><a class="tiny" href="https://lichess.org/training/${encodeURIComponent(pz.id)}" target="_blank" rel="noopener">Puzzle ${esc(pz.id)} on Lichess</a></div>
      <div class="theme-tags">${pz.themes.map(t => `<span>${esc(themeName(t))}</span>`).join('')}</div>
      <p class="small muted" style="margin:0">A new daily puzzle appears tomorrow. Keep your streak going!</p>
      <div class="grid-2">
        <button class="btn" id="p-analyse" type="button">${icons.search} Analyse</button>
        <a class="btn primary" href="#/puzzles">${icons.next} Rated puzzles</a>
      </div>`;
    $('#p-analyse', el).addEventListener('click', () => analysePuzzle(pz));
    solutionStepper(el, board, pz);
  };
  const player = new PuzzlePlayer(board, pz, {
    onStep: (p) => { if (p.chess.turn() === p.solver) status(`Find the best move for <b>${p.solverName}</b>`); },
    onWrong: (p, uci, san) => { sound('bad'); if (!failed) { failed = true; save(false); } status(`${esc(san)} is not it. Try again.`, 'bad'); },
    onSolved: () => { sound('good'); save(!failed); status(`${icons.check} ${failed ? 'Solved, but it does not count for the streak.' : 'Solved! Streak extended.'}`, 'ok'); after(); },
  });
  player.start();
  $('#p-hint', root).addEventListener('click', () => { if (player.hint()) { if (!failed) { failed = true; save(false); } } });
  $('#p-sol', root).addEventListener('click', () => { if (!failed) { failed = true; save(false); } player.showSolution(after); });
  $('#p-flip', root).addEventListener('click', () => board.flip());
  ctx = { destroy() { player.destroy(); board.destroy(); } };
}

function data() {
  return { rating: START_RATING, attempts: [], ...store.get('puzzles', {}) };
}

export async function mount(root, params = [], isCurrent = () => true) {
  if (params[0] === 'daily') return dailyView(root, isCurrent);
  root.innerHTML = `${puzzleTabs('rated')}<div class="page"><div class="status"><span class="spinner"></span> Loading puzzles…</div></div>`;
  try { await loadIndex(); } catch (err) {
    root.querySelector('.page').innerHTML = `<div class="card stack"><h2 style="margin:0">Puzzles are not available</h2><p class="muted" style="margin:0">${esc(err.message)} Check your connection and try again.</p><button class="btn" type="button" onclick="location.reload()">${icons.retry} Retry</button></div>`;
    return;
  }
  if (!isCurrent()) return;
  const settings = store.getSettings();
  root.innerHTML = `
    ${puzzleTabs('rated')}
    <div class="stage">
      <div class="board-col">
        <div class="board-shell"><div id="board"></div></div>
      </div>
      <div class="side-col">
        <section class="card">
          <div class="row between nowrap">
            <div><div class="stat-label">Puzzle rating</div><div class="stat-big" id="p-rating"></div></div>
            <div style="text-align:right"><div class="stat-label">This puzzle</div><div style="font-weight:800;font-size:1.2rem" id="p-prating">…</div></div>
          </div>
          <select id="p-theme" aria-label="Puzzle theme" style="margin-top:10px">
            ${PICK_THEMES.map(t => `<option value="${t}">${t ? esc(themeName(t)) : 'All themes'}</option>`).join('')}
          </select>
        </section>
        <div class="status info" id="p-status" role="status"></div>
        <div class="btn-row">
          <button class="btn" id="p-hint" type="button">${icons.hint}<span>Hint</span></button>
          <button class="btn" id="p-sol" type="button">${icons.eye}<span>Solution</span></button>
          <button class="btn" id="p-flip" type="button">${icons.flip}<span>Flip</span></button>
          <button class="btn" id="p-next" type="button">${icons.next}<span>Skip</span></button>
        </div>
        <section class="card stack hidden" id="p-after"></section>
        <section class="card"><div class="row between"><h3 style="margin:0">Recent</h3><span class="tiny muted" id="p-streak"></span></div><div id="p-recent" class="rush-track" style="margin-top:10px"></div><div class="tiny muted" style="margin-top:6px">Tap a red square to retry that puzzle (unrated).</div></section>
      </div>
    </div>`;
  const board = new Board($('#board', root), { coordinates: settings.coords, animate: settings.animation });
  let player = null;
  let puzzle = null;
  let rated = false;
  let usedHint = false;
  let moved = false;
  let alive = true;
  let loading = false;

  const status = (msg, cls = 'info') => { const s = $('#p-status', root); s.className = 'status ' + cls; s.innerHTML = msg; };

  function renderHeader(delta) {
    const d = data();
    $('#p-rating', root).innerHTML = `${Math.round(d.rating)}${delta != null ? ` <span class="small ${delta >= 0 ? 'tq-excellent' : 'tq-blunder'}" style="font-weight:700">${delta >= 0 ? '+' : ''}${Math.round(delta)}</span>` : ''}`;
    const recent = d.attempts.filter(a => a.mode !== 'rush').slice(-24);
    $('#p-recent', root).innerHTML = recent.map(a => `<i class="${a.ok === 1 ? '' : 'x'}" title="${a.ok === 1 ? 'Solved' : a.ok ? 'Solved with hint' : 'Failed, tap to retry'} · ${Number(a.pr) || ''}"${a.ok === 1 ? '' : ` data-retry="${esc(a.id)}" data-pr="${Number(a.pr) || 0}" role="button" tabindex="0" style="cursor:pointer${a.ok === 0.5 ? ';background:var(--q-inaccuracy)' : ''}"`}></i>`).join('') || '<span class="tiny muted">Your results will show here.</span>';
    let streak = 0;
    for (let i = recent.length - 1; i >= 0 && recent[i].ok === 1; i--) streak++;
    $('#p-streak', root).textContent = streak >= 2 ? `${streak} in a row` : '';
  }

  function record(score) {
    if (rated) return null;
    rated = true;
    const d = data();
    const before = d.rating;
    const after = updateRating(before, puzzle.rating, score, d.attempts.filter(a => a.mode !== 'rush').length);
    d.attempts.push({ id: puzzle.id, t: Date.now(), pr: puzzle.rating, ok: score, before: Math.round(before * 10) / 10, after: Math.round(after * 10) / 10, themes: puzzle.themes, mode: 'rated' });
    d.rating = after;
    store.set('puzzles', d);
    renderHeader(after - before);
    return after - before;
  }

  function finishCard(solved) {
    const el = $('#p-after', root);
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="row between"><h3 style="margin:0">${solved ? 'Solved' : 'Puzzle over'}</h3><a class="tiny" href="https://lichess.org/training/${encodeURIComponent(puzzle.id)}" target="_blank" rel="noopener">Puzzle ${esc(puzzle.id)} on Lichess</a></div>
      <div class="theme-tags">${puzzle.themes.map(t => `<span>${esc(themeName(t))}</span>`).join('')}</div>
      <div class="grid-2">
        <button class="btn" id="p-analyse" type="button">${icons.search} Analyse</button>
        <button class="btn primary" id="p-next2" type="button">${icons.next} Next puzzle</button>
      </div>`;
    $('#p-next2', el).addEventListener('click', () => next());
    $('#p-analyse', el).addEventListener('click', () => analysePuzzle(puzzle));
    solutionStepper(el, board, puzzle);
    $('#p-next', root).querySelector('span').textContent = 'Next';
  }

  async function next(retry = null) {
    if (loading) return;
    loading = true;
    player?.destroy();
    player = null;
    $('#p-after', root).classList.add('hidden');
    $('#p-next', root).querySelector('span').textContent = 'Skip';
    status('<span class="spinner"></span> Finding a puzzle…');
    const d = data();
    const seen = new Set(d.attempts.map(a => a.id));
    const target = d.rating + (Math.random() * 200 - 80);
    const theme = $('#p-theme', root).value;
    try {
      if (retry) {
        const list = await loadBucket(Math.max(400, Math.min(3000, Math.floor(retry.pr / 100) * 100)));
        puzzle = list.find(p => p.id === retry.id);
        if (!puzzle) throw new Error('missing');
      } else {
        puzzle = await pickPuzzle(target, { exclude: seen, spread: theme ? 150 : 75, filter: theme ? (p) => p.themes.includes(theme) : null });
      }
    } catch (err) {
      loading = false;
      status('Could not load a puzzle. Check your connection.', 'bad');
      return;
    }
    loading = false;
    if (!alive) return;
    prefetch(d.rating + 100);
    // a retry is practice: it never changes the rating
    rated = !!retry; usedHint = false; moved = false;
    $('#p-prating', root).textContent = retry ? `${puzzle.rating} · retry` : '?';
    player = new PuzzlePlayer(board, puzzle, {
      onStep: (p) => {
        if (p.chess.turn() === p.solver) status(moved ? 'Correct! Keep going…' : `Find the best move for <b>${p.solverName}</b>`, moved ? 'ok' : 'info');
      },
      onWrong: (p, uci, san) => {
        moved = true;
        sound('bad');
        const delta = record(0);
        status(`${esc(san)} is not the answer.${delta != null ? ` Rating ${Math.round(delta)}.` : ''} Try again or view the solution.`, 'bad');
      },
      onSolved: () => {
        sound('good');
        const delta = record(usedHint ? 0.5 : 1);
        $('#p-prating', root).textContent = puzzle.rating;
        status(`${icons.check} ${delta == null ? 'Solved.' : usedHint ? `Solved with a hint (${delta >= 0 ? '+' : ''}${Math.round(delta)}).` : `Solved! ${delta >= 0 ? '+' : ''}${Math.round(delta)}`}`, 'ok');
        finishCard(true);
      },
    });
    const origMove = board.opts.onMove;
    board.opts.onMove = (f, t, pr) => { moved = true; origMove(f, t, pr); };
    player.start();
    status(retry ? 'Retry (unrated). Get ready…' : 'Get ready…');
  }

  $('#p-theme', root).value = store.get('puzzles.theme', '');
  $('#p-theme', root).addEventListener('change', (e) => {
    store.set('puzzles.theme', e.target.value);
    if (player && !player.done && moved && !rated) record(0);
    next();
  });
  $('#p-recent', root).addEventListener('click', (e) => {
    const dot = e.target.closest('[data-retry]');
    if (!dot || loading) return;
    if (player && !player.done && moved && !rated) record(0);
    next({ id: dot.dataset.retry, pr: +dot.dataset.pr });
  });

  $('#p-hint', root).addEventListener('click', () => {
    if (loading || !player || player.done) return;
    if (player.hint()) {
      if (usedHint) player.showArrow('rgba(32,150,210,.85)');
      usedHint = true;
      status('Hint: the highlighted piece moves. Tap Hint again to see where.', 'info');
    }
  });
  $('#p-sol', root).addEventListener('click', () => {
    if (loading || !player || (player.done && rated)) return;
    const delta = record(0);
    $('#p-prating', root).textContent = puzzle.rating;
    status(`Here is the solution.${delta != null ? ` Rating ${Math.round(delta)}.` : ''}`, 'info');
    player.showSolution(() => finishCard(false));
  });
  $('#p-flip', root).addEventListener('click', () => board.flip());
  $('#p-next', root).addEventListener('click', () => {
    if (loading) return;
    // skipping an untouched puzzle is free; abandoning one you started counts as a miss
    if (player && !player.done && moved && !rated) record(0);
    next();
  });

  ctx = { destroy() { alive = false; player?.destroy(); board.destroy(); } };
  renderHeader();
  next();
}

/** Opens a puzzle on the analysis board at the position the solver faced, with the full solution as the line. */
function analysePuzzle(pz) {
  const solverWhite = pz.fen.split(' ')[1] === 'b'; // the first move is the opponent's
  store.set('analysis.board', { startFen: pz.fen, line: pz.moves.slice(), ply: 1, headers: null, orientation: solverWhite ? 'white' : 'black' });
  location.hash = '#/analysis';
}

/**
 * After a puzzle ends: step back and forth through the whole solution on the board (buttons and ← → keys).
 * The listener removes itself when the card is replaced or the page changes.
 */
function solutionStepper(el, board, pz) {
  const fens = [pz.fen];
  const lasts = [null];
  const c = new Chess(pz.fen);
  for (const u of pz.moves) { const m = playUci(c, u); if (!m) break; fens.push(c.fen()); lasts.push([m.from, m.to]); }
  let k = fens.length - 1;
  const nav = document.createElement('div');
  nav.className = 'row nowrap';
  nav.innerHTML = `<span class="small muted grow">Step through the solution</span>
    <button class="btn small" type="button" data-s="-1" aria-label="Back one move">${icons.prev}</button>
    <button class="btn small" type="button" data-s="1" aria-label="Forward one move">${icons.next}</button>`;
  el.insertBefore(nav, el.children[2] || null);
  const show = (n) => {
    k = Math.max(1, Math.min(fens.length - 1, n));
    const pos = new Chess(fens[k]);
    board.setPosition(fens[k], { lastMove: lasts[k], check: checkSquare(pos) });
    board.setMovable({});
    board.setArrows([]);
    nav.querySelector('[data-s="-1"]').disabled = k <= 1;
    nav.querySelector('[data-s="1"]').disabled = k >= fens.length - 1;
  };
  nav.addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) show(k + +b.dataset.s); });
  const onKey = (e) => {
    if (!nav.isConnected || el.classList.contains('hidden')) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.closest?.('input,textarea,select,dialog')) return;
    if (e.key === 'ArrowLeft') { show(k - 1); e.preventDefault(); } else if (e.key === 'ArrowRight') { show(k + 1); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  nav.querySelector('[data-s="1"]').disabled = true;
}
