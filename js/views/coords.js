// Coordinates trainer: tap the named square as many times as you can in 30 seconds.
import { Board } from '../board.js';
import * as store from '../store.js';
import { icons, $, sound } from '../ui.js';
import { learnTabs } from './learn.js';

const DURATION = 30000;
const EMPTY = '8/8/8/8/8/8/8/8 w - - 0 1';
let ctx = null;
export function unmount() { ctx?.destroy(); ctx = null; }

function data() { return { best: {}, ...store.get('coords', {}) }; }
const randomSquare = (not) => {
  let s;
  do { s = String.fromCharCode(97 + Math.floor(Math.random() * 8)) + (1 + Math.floor(Math.random() * 8)); } while (s === not);
  return s;
};

export function mount(root) {
  const d = data();
  let side = store.get('coords.side', 'white');
  root.innerHTML = `
    ${learnTabs('coords')}
    <div class="stage">
      <div class="board-col">
        <div class="rush-hud">
          <div><div class="stat-label">Score</div><div class="rush-score" id="c-score">0</div></div>
          <div class="rush-score mono" id="c-target" style="font-size:2.6rem;color:var(--accent)" aria-live="polite">—</div>
          <div style="text-align:right"><div class="stat-label">Time</div><div class="rush-time" id="c-time">0:30</div></div>
        </div>
        <div class="board-shell"><div id="board"></div></div>
      </div>
      <div class="side-col">
        <section class="card stack">
          <h1 style="margin:0">Coordinates</h1>
          <p class="small muted" style="margin:0">Knowing square names by heart makes reading notation, following lessons and spotting tactics much faster. Tap the square shown above the board.</p>
          <div class="field"><span class="label">Board side</span>
            <div class="seg" id="c-side" role="group" aria-label="Board side"><button type="button" data-v="white">White</button><button type="button" data-v="black">Black</button></div>
          </div>
          <div class="kpis"><div class="kpi"><div class="stat-label">Best as White</div><div class="stat-big">${d.best.white ?? '—'}</div></div><div class="kpi"><div class="stat-label">Best as Black</div><div class="stat-big">${d.best.black ?? '—'}</div></div></div>
          <button class="btn primary block" id="c-start" type="button">${icons.start} Start (30 seconds)</button>
          <div id="c-result"></div>
        </section>
      </div>
    </div>`;
  const board = new Board($('#board', root), { fen: EMPTY, coordinates: false, orientation: side, onSquare: (sq) => tap(sq) });
  let running = false, target = null, score = 0, endAt = 0, timer = null;
  const mark = (v) => root.querySelectorAll('#c-side button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  mark(side);
  $('#c-side', root).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || running) return;
    side = b.dataset.v;
    store.set('coords.side', side);
    mark(side);
    board.setOrientation(side);
  });

  function tap(sq) {
    if (!running) return;
    if (sq === target) {
      score++;
      $('#c-score', root).textContent = score;
      board.setMarks([{ sq, cls: 'right' }]);
      target = randomSquare(target);
      $('#c-target', root).textContent = target;
    } else {
      board.setMarks([{ sq, cls: 'wrong' }]);
      sound('bad');
    }
    clearTimeout(board._markTimer);
    board._markTimer = setTimeout(() => board.setMarks([]), 250);
  }

  function stop() {
    running = false;
    clearInterval(timer);
    const dd = data();
    const isBest = score > (dd.best[side] ?? -1);
    if (isBest) dd.best[side] = score;
    store.set('coords', dd);
    sound('end');
    $('#c-target', root).textContent = '—';
    $('#c-result', root).innerHTML = `<div class="status ${isBest ? 'ok' : 'info'}">${score} squares${isBest ? ' · new best!' : ` · best ${dd.best[side]}`}</div>`;
    $('#c-start', root).disabled = false;
  }

  $('#c-start', root).addEventListener('click', () => {
    running = true;
    score = 0;
    $('#c-score', root).textContent = '0';
    $('#c-result', root).innerHTML = '';
    $('#c-start', root).disabled = true;
    target = randomSquare();
    $('#c-target', root).textContent = target;
    endAt = performance.now() + DURATION;
    timer = setInterval(() => {
      const left = endAt - performance.now();
      $('#c-time', root).textContent = `0:${String(Math.max(0, Math.ceil(left / 1000))).padStart(2, '0')}`;
      if (left <= 0) stop();
    }, 100);
  });
  ctx = { destroy() { clearInterval(timer); board.destroy(); } };
}

