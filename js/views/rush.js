// Rush: solve as many puzzles as you can in 3 or 5 minutes. Three wrong moves and the run ends.
// Difficulty climbs with every puzzle.
import { Board } from '../board.js';
import * as store from '../store.js';
import { icons, esc, $, sound, fmtClock, timeAgo } from '../ui.js';
import { pickPuzzle, loadIndex, loadBucket, bucketOf } from '../puzzle-data.js';
import { PuzzlePlayer } from '../puzzle-player.js';
import { puzzleTabs } from './puzzles.js';

const MODES = { 3: 180000, 5: 300000 };
let ctx = null;
export function unmount() { ctx?.destroy(); ctx = null; }

export function rushTarget(k) { return Math.min(2900, 600 + k * 55); }

function rushData() { return { best: {}, runs: [], ...store.get('rush', {}) }; }

export async function mount(root, params, isCurrent = () => true) {
  root.innerHTML = `${puzzleTabs('rush')}<div class="page"><div class="status"><span class="spinner"></span> Loading puzzles…</div></div>`;
  try { await loadIndex(); } catch (err) {
    root.querySelector('.page').innerHTML = `<div class="card stack"><h2 style="margin:0">Puzzles are not available</h2><p class="muted" style="margin:0">${esc(err.message)}</p></div>`;
    return;
  }
  if (isCurrent()) setup(root);
}

function setup(root) {
  ctx?.destroy();
  const d = rushData();
  const runs = d.runs.slice(-8).reverse();
  root.innerHTML = `
    ${puzzleTabs('rush')}
    <div class="page stack" style="max-width:720px;margin:0 auto">
      <section class="card stack">
        <h1 style="margin:0">Rush</h1>
        <p class="muted small" style="margin:0">Solve as many puzzles as you can before time runs out. Puzzles start easy and get harder with each one. Three wrong moves and your run is over.</p>
        <div class="grid-2">
          ${[3, 5].map(m => `
            <button class="card" type="button" data-mode="${m}" style="cursor:pointer;text-align:left;font:inherit;color:inherit">
              <div class="row between nowrap"><b style="font-size:1.15rem">${m} minutes</b>${icons.clock.replace('<svg', '<svg style="width:22px;height:22px;color:var(--accent)"')}</div>
              <div class="stat-label" style="margin-top:8px">Best score</div>
              <div class="stat-big">${d.best[m] != null ? Number(d.best[m]) || 0 : '—'}</div>
              <div class="btn primary block" style="margin-top:10px">${icons.start} Start</div>
            </button>`).join('')}
        </div>
      </section>
      <section class="card">
        <h3>Recent runs</h3>
        <div class="list">${runs.length ? runs.map(r => `<div class="list-item"><div class="grow"><div class="t">${Number(r.score) || 0} solved · ${Number(r.mode) || 3} min</div><div class="s">${timeAgo(r.t)} · reached ${Number(r.maxRating) || '—'}</div></div>${d.best[r.mode] === r.score ? '<span class="result-pill win">Best</span>' : ''}</div>`).join('') : '<div class="empty small">No runs yet.</div>'}</div>
      </section>
    </div>`;
  root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => run(root, +b.dataset.mode)));
  for (const r of [600, 700, 800]) loadBucket(bucketOf(r)).catch(() => {});
  ctx = { destroy() {} };
}

function run(root, mode) {
  const settings = store.getSettings();
  root.innerHTML = `
    ${puzzleTabs('rush')}
    <div class="stage">
      <div class="board-col">
        <div class="rush-hud">
          <div><div class="stat-label">Score</div><div class="rush-score" id="r-score">0</div></div>
          <div class="strikes" id="r-strikes" aria-label="Strikes"><i></i><i></i><i></i></div>
          <div style="text-align:right"><div class="stat-label">Time</div><div class="rush-time" id="r-time">${fmtClock(MODES[mode])}</div></div>
        </div>
        <div class="board-shell"><div id="board"></div></div>
      </div>
      <div class="side-col">
        <div class="status info" id="r-status">Get ready…</div>
        <section class="card"><div class="row between"><h3 style="margin:0">This run</h3><span class="tiny muted" id="r-level"></span></div><div class="rush-track" id="r-track" style="margin-top:10px"></div></section>
        <button class="btn" id="r-quit" type="button">${icons.x} End run</button>
      </div>
    </div>`;
  const board = new Board($('#board', root), { coordinates: settings.coords, animate: settings.animation });
  let score = 0, strikes = 0, k = 0, ended = false, player = null, maxRating = 0;
  const results = [];
  const seen = new Set();
  let endAt = null; // the clock starts once the first puzzle is on the board
  let nextP = null;

  const status = (msg, cls = 'info') => { const s = $('#r-status', root); s.className = 'status ' + cls; s.innerHTML = msg; };
  const fetchNext = () => {
    const target = rushTarget(k);
    const p = pickPuzzle(target, { exclude: seen, maxMoves: k < 12 ? 4 : 6, spread: 60 });
    p.then(x => seen.add(x.id)).catch(() => {});
    return p;
  };

  function renderHud() {
    $('#r-score', root).textContent = score;
    $('#r-strikes', root).innerHTML = [0, 1, 2].map(i => `<i class="${i < strikes ? 'on' : ''}">${i < strikes ? '✕' : ''}</i>`).join('');
    $('#r-track', root).innerHTML = results.map(r => `<i class="${r.ok ? '' : 'x'}" title="${r.rating}"></i>`).join('');
  }

  // Rush results do not change your rating, but they do show which themes trip you up
  function logAttempt(p, ok) {
    const d = { rating: 1100, attempts: [], ...store.get('puzzles', {}) };
    d.attempts.push({ id: p.id, t: Date.now(), pr: p.rating, ok, before: d.rating, after: d.rating, themes: p.themes, mode: 'rush' });
    store.set('puzzles', d);
  }

  async function nextPuzzle() {
    if (ended) return;
    let p;
    try { p = await (nextP || fetchNext()); } catch { status('Could not load puzzles. Check your connection.', 'bad'); return; }
    if (ended) return;
    k++;
    nextP = fetchNext();
    maxRating = Math.max(maxRating, p.rating);
    $('#r-level', root).textContent = `puzzle ${k} · rated ${p.rating}`;
    player?.destroy();
    player = new PuzzlePlayer(board, p, {
      retry: false,
      replyDelay: 220,
      onStep: (pl) => { if (pl.chess.turn() === pl.solver) status(`Your move as <b>${pl.solverName}</b>`); },
      onSolved: () => {
        score++;
        results.push({ ok: true, rating: p.rating });
        logAttempt(p, 1);
        sound('good');
        renderHud();
        status(`${icons.check} Correct!`, 'ok');
        setTimeout(nextPuzzle, 250);
      },
      onWrong: (pl) => {
        strikes++;
        results.push({ ok: false, rating: p.rating });
        logAttempt(p, 0);
        sound('bad');
        renderHud();
        setTimeout(() => { pl.render(false); pl.showArrow(); }, 350);
        status(strikes >= 3 ? 'Third strike!' : `Wrong move. Strike ${strikes} of 3.`, 'bad');
        if (strikes >= 3) setTimeout(() => end('strikes'), 900);
        else setTimeout(nextPuzzle, 900);
      },
    });
    player.start(250);
    if (endAt == null) endAt = performance.now() + MODES[mode];
  }

  const tick = setInterval(() => {
    if (endAt == null) return;
    const left = endAt - performance.now();
    const t = $('#r-time', root);
    if (t) { t.textContent = fmtClock(left); t.style.color = left < 15000 ? 'var(--bad)' : ''; }
    if (left <= 0) end('time');
  }, 100);

  function end(reason) {
    if (ended) return;
    ended = true;
    clearInterval(tick);
    player?.destroy();
    board.setMovable({});
    const d = rushData();
    const prevBest = d.best[mode] ?? null;
    const isBest = prevBest == null || score > prevBest;
    if (isBest) d.best[mode] = score;
    d.runs.push({ mode, score, t: Date.now(), strikes, maxRating, reason });
    d.runs = d.runs.slice(-200);
    store.set('rush', d);
    sound('end');
    const side = root.querySelector('.side-col');
    side.innerHTML = `
      <section class="card stack" style="text-align:center">
        <div class="stat-label">${reason === 'time' ? 'Time is up' : reason === 'quit' ? 'Run ended' : 'Three strikes'}</div>
        <div class="rush-score" style="font-size:3rem">${score}</div>
        <div class="${isBest && score > 0 ? 'status ok' : 'muted'}" style="justify-content:center">${isBest && score > 0 ? `New best for ${mode} minutes!` : `Best: ${d.best[mode] ?? 0}`}</div>
        <div class="small muted">Hardest puzzle reached: ${maxRating || '—'}</div>
        <div class="rush-track" style="justify-content:center">${results.map(r => `<i class="${r.ok ? '' : 'x'}" title="${r.rating}"></i>`).join('')}</div>
        <div class="grid-2">
          <button class="btn primary" id="r-again" type="button">${icons.retry} Play again</button>
          <button class="btn" id="r-back" type="button">${icons.list} Rush menu</button>
        </div>
      </section>`;
    $('#r-again', side).addEventListener('click', () => { board.destroy(); run(root, mode); });
    $('#r-back', side).addEventListener('click', () => { board.destroy(); setup(root); });
  }

  $('#r-quit', root).addEventListener('click', () => end('quit'));
  ctx = { destroy() { ended = true; clearInterval(tick); player?.destroy(); board.destroy(); } };
  renderHud();
  nextPuzzle();
}
