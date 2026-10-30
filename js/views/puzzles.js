// Rated puzzles from the Lichess puzzle database. Your rating moves after every attempt.
import { Board } from '../board.js';
import * as store from '../store.js';
import { icons, esc, toast, $, sound } from '../ui.js';
import { pickPuzzle, loadIndex, prefetch } from '../puzzle-data.js';
import { PuzzlePlayer, updateRating, START_RATING } from '../puzzle-player.js';
import { themeName } from '../themes.js';

let ctx = null;
export function unmount() { ctx?.destroy(); ctx = null; }

export function puzzleTabs(active) {
  return `<nav class="subtabs"><a href="#/puzzles" class="${active === 'rated' ? 'active' : ''}">Rated</a><a href="#/rush" class="${active === 'rush' ? 'active' : ''}">${icons.bolt.replace('<svg', '<svg style="width:15px;height:15px;vertical-align:-2px;margin-right:2px"')}Rush</a></nav>`;
}

function data() {
  return { rating: START_RATING, attempts: [], ...store.get('puzzles', {}) };
}

export async function mount(root) {
  root.innerHTML = `${puzzleTabs('rated')}<div class="page"><div class="status"><span class="spinner"></span> Loading puzzles…</div></div>`;
  try { await loadIndex(); } catch (err) {
    root.querySelector('.page').innerHTML = `<div class="card stack"><h2 style="margin:0">Puzzles are not available</h2><p class="muted" style="margin:0">${esc(err.message)} Check your connection and try again.</p><button class="btn" type="button" onclick="location.reload()">${icons.retry} Retry</button></div>`;
    return;
  }
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
        </section>
        <div class="status info" id="p-status" role="status"></div>
        <div class="btn-row">
          <button class="btn" id="p-hint" type="button">${icons.hint}<span>Hint</span></button>
          <button class="btn" id="p-sol" type="button">${icons.eye}<span>Solution</span></button>
          <button class="btn" id="p-flip" type="button">${icons.flip}<span>Flip</span></button>
          <button class="btn" id="p-next" type="button">${icons.next}<span>Skip</span></button>
        </div>
        <section class="card stack hidden" id="p-after"></section>
        <section class="card"><div class="row between"><h3 style="margin:0">Recent</h3><span class="tiny muted" id="p-streak"></span></div><div id="p-recent" class="rush-track" style="margin-top:10px"></div></section>
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
    $('#p-recent', root).innerHTML = recent.map(a => `<i class="${a.ok === 1 ? '' : 'x'}" title="${a.ok === 1 ? 'Solved' : a.ok ? 'Solved with hint' : 'Failed'} · ${a.pr}"${a.ok === 0.5 ? ' style="background:var(--q-inaccuracy)"' : ''}></i>`).join('') || '<span class="tiny muted">Your results will show here.</span>';
    let streak = 0;
    for (let i = recent.length - 1; i >= 0 && recent[i].ok === 1; i--) streak++;
    $('#p-streak', root).textContent = streak >= 2 ? `${streak} in a row` : '';
  }

  function record(score) {
    if (rated) return null;
    rated = true;
    const d = data();
    const before = d.rating;
    const after = updateRating(before, puzzle.rating, score, d.attempts.length);
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
      <button class="btn primary block" id="p-next2" type="button">${icons.next} Next puzzle</button>`;
    $('#p-next2', el).addEventListener('click', next);
    $('#p-next', root).querySelector('span').textContent = 'Next';
  }

  async function next() {
    if (loading) return;
    loading = true;
    player?.destroy();
    $('#p-after', root).classList.add('hidden');
    $('#p-next', root).querySelector('span').textContent = 'Skip';
    status('<span class="spinner"></span> Finding a puzzle…');
    const d = data();
    const seen = new Set(d.attempts.map(a => a.id));
    const target = d.rating + (Math.random() * 200 - 80);
    try {
      puzzle = await pickPuzzle(target, { exclude: seen });
    } catch (err) {
      loading = false;
      status('Could not load a puzzle. Check your connection.', 'bad');
      return;
    }
    loading = false;
    if (!alive) return;
    prefetch(d.rating + 100);
    rated = false; usedHint = false; moved = false;
    $('#p-prating', root).textContent = '?';
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
    status('Get ready…');
  }

  $('#p-hint', root).addEventListener('click', () => {
    if (!player || player.done) return;
    if (player.hint()) {
      if (usedHint) player.showArrow('rgba(32,150,210,.85)');
      usedHint = true;
      status('Hint: the highlighted piece moves. Tap Hint again to see where.', 'info');
    }
  });
  $('#p-sol', root).addEventListener('click', () => {
    if (!player || player.done && rated) return;
    const delta = record(0);
    $('#p-prating', root).textContent = puzzle.rating;
    status(`Here is the solution.${delta != null ? ` Rating ${Math.round(delta)}.` : ''}`, 'info');
    player.showSolution(() => finishCard(false));
  });
  $('#p-flip', root).addEventListener('click', () => board.flip());
  $('#p-next', root).addEventListener('click', () => {
    // skipping an untouched puzzle is free; abandoning one you started counts as a miss
    if (player && !player.done && moved && !rated) record(0);
    next();
  });

  ctx = { destroy() { alive = false; player?.destroy(); board.destroy(); } };
  renderHeader();
  next();
}
