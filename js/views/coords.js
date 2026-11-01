// Board-vision trainer with three timed modes:
//  find  - a square name is shown, tap that square (30 s)
//  name  - a square is highlighted, pick its name from four buttons or type it (30 s)
//  moves - a lone piece stands on the board, tap every square it can move to (60 s)
import { Board } from '../board.js';
import { Chess, PIECE_NAMES } from '../chessutil.js';
import * as store from '../store.js';
import { icons, $, sound } from '../ui.js';
import { learnTabs } from './learn.js';

const EMPTY = '8/8/8/8/8/8/8/8 w - - 0 1';
const FILES = 'abcdefgh';
const MODES = {
  find: { label: 'Find the square', duration: 30000, unit: 'squares', blurb: 'Tap the square shown above the board.' },
  name: { label: 'Name the square', duration: 30000, unit: 'squares', blurb: 'A square lights up on the board: pick its name from the buttons above the board, or type it (e.g. e then 4).' },
  moves: { label: 'Moves', duration: 60000, unit: 'positions', blurb: 'Tap every square the piece can move to. The next piece comes as soon as you have found them all; press Done if you think you have them all.' },
};
const MOVE_PIECES = ['n', 'b', 'r', 'q', 'k'];

let ctx = null;
export function unmount() { ctx?.destroy(); ctx = null; }

function data() { return { best: {}, ...store.get('coords', {}) }; }
// "find" keeps the original best.white / best.black keys so old saves stay valid
export const bestKey = (mode, side) => (mode === 'find' ? side : `${mode}-${side}`);

const randomSquare = (not) => {
  let s;
  do { s = FILES[Math.floor(Math.random() * 8)] + (1 + Math.floor(Math.random() * 8)); } while (s === not);
  return s;
};
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Four answer choices for "name the square": the answer plus easily-confused squares. */
export function nameChoices(sq) {
  const f = FILES.indexOf(sq[0]), r = +sq[1];
  const at = (ff, rr) => (ff >= 0 && ff < 8 && rr >= 1 && rr <= 8 ? FILES[ff] + rr : null);
  const pool = [
    at(7 - f, 9 - r), // the same square seen from the other side
    at(f, 9 - r), at(7 - f, r), // mirrored rank / file
    at(f, r + 1), at(f, r - 1), at(f + 1, r), at(f - 1, r),
  ];
  const out = [sq];
  for (const s of shuffle(pool.slice(1)).concat(pool[0])) {
    if (out.length >= 4) break;
    if (s && !out.includes(s)) out.push(s);
  }
  if (out.length < 4 && pool[0] && !out.includes(pool[0])) out[3] = pool[0];
  while (out.length < 4) { const s = randomSquare(); if (!out.includes(s)) out.push(s); }
  return shuffle(out);
}

/** Every square a lone piece can move to on an otherwise empty board (via chess.js). */
function fenFor(type, sq, color) {
  const f = FILES.indexOf(sq[0]), r = +sq[1];
  const rows = [];
  for (let rank = 8; rank >= 1; rank--) rows.push(rank !== r ? '8' : `${f || ''}${color === 'w' ? type.toUpperCase() : type}${7 - f || ''}`);
  return `${rows.join('/')} ${color} - - 0 1`;
}

/** Every square a lone piece can move to on an otherwise empty board (via chess.js). */
export function pieceDests(type, sq, color = 'w') {
  const chess = new Chess(fenFor(type, sq, color), { skipValidation: true });
  return [...new Set(chess.moves({ square: sq, verbose: true }).map(m => m.to))].sort();
}

export function mount(root) {
  let side = store.get('coords.side', 'white');
  let mode = store.get('coords.mode', 'find');
  if (!MODES[mode]) mode = 'find';
  root.innerHTML = `
    ${learnTabs('coords')}
    <div class="stage">
      <div class="board-col">
        <div class="rush-hud">
          <div><div class="stat-label">Score</div><div class="rush-score" id="c-score">0</div></div>
          <div class="coord-mid" id="c-mid" aria-live="polite"></div>
          <div style="text-align:right"><div class="stat-label">Time</div><div class="rush-time" id="c-time">0:30</div></div>
        </div>
        <div class="board-shell"><div id="board"></div></div>
      </div>
      <div class="side-col">
        <section class="card stack">
          <h1 style="margin:0">Coordinates</h1>
          <p class="small muted" style="margin:0">Knowing square names by heart makes reading notation, following lessons and spotting tactics much faster. <span id="c-blurb"></span></p>
          <div class="field"><span class="label">Mode</span>
            <div class="seg" id="c-mode" role="group" aria-label="Mode">${Object.entries(MODES).map(([v, m]) => `<button type="button" data-v="${v}">${m.label}</button>`).join('')}</div>
          </div>
          <div class="field"><span class="label">Board side</span>
            <div class="seg" id="c-side" role="group" aria-label="Board side"><button type="button" data-v="white">White</button><button type="button" data-v="black">Black</button></div>
          </div>
          <div class="kpis"><div class="kpi"><div class="stat-label">Best as White</div><div class="stat-big" id="c-best-white">—</div></div><div class="kpi"><div class="stat-label">Best as Black</div><div class="stat-big" id="c-best-black">—</div></div></div>
          <button class="btn primary block" id="c-start" type="button"></button>
          <div id="c-result"></div>
        </section>
      </div>
    </div>`;
  const board = new Board($('#board', root), { fen: EMPTY, coordinates: false, orientation: side, onSquare: (sq) => tap(sq) });
  const mid = $('#c-mid', root);
  let running = false, target = null, score = 0, errors = 0, endAt = 0, timer = null;
  let flashTimer = 0, nextTimer = 0, typed = '';
  // moves mode
  let piece = null, answers = [], found = [], busy = false;

  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const press = (sel, v) => root.querySelectorAll(`${sel} button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  const idleMid = () => { mid.innerHTML = '<div class="rush-score mono coord-target-name">—</div>'; };

  function renderSetup() {
    press('#c-side', side);
    press('#c-mode', mode);
    const best = data().best;
    $('#c-best-white', root).textContent = best[bestKey(mode, 'white')] ?? '—';
    $('#c-best-black', root).textContent = best[bestKey(mode, 'black')] ?? '—';
    $('#c-blurb', root).textContent = MODES[mode].blurb;
    $('#c-start', root).innerHTML = `${icons.start} Start (${MODES[mode].duration / 1000} seconds)`;
    $('#c-time', root).textContent = fmt(MODES[mode].duration);
  }
  idleMid();
  renderSetup();

  $('#c-side', root).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || running) return;
    side = b.dataset.v;
    store.set('coords.side', side);
    board.setOrientation(side);
    renderSetup();
  });
  $('#c-mode', root).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || running || !MODES[b.dataset.v]) return;
    mode = b.dataset.v;
    store.set('coords.mode', mode);
    $('#c-result', root).innerHTML = '';
    board.setPosition(EMPTY, { animate: false });
    board.setMarks([]);
    renderSetup();
  });

  // brief right/wrong flash on top of any persistent marks
  function flash(marks, keep = []) {
    board.setMarks([...keep, ...marks]);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => board.setMarks(keep), 250);
  }

  // ----- find the square -----
  function nextFind() {
    target = randomSquare(target);
    mid.innerHTML = `<div class="rush-score mono coord-target-name">${target}</div>`;
  }

  // ----- name the square -----
  const targetMark = () => [{ sq: target, cls: 'coord-target' }];
  function nextName() {
    target = randomSquare(target);
    typed = '';
    board.setMarks(targetMark());
    mid.innerHTML = `<div class="coord-choices" role="group" aria-label="Which square is highlighted?">${nameChoices(target).map(s => `<button type="button" class="btn mono" data-sq="${s}">${s}</button>`).join('')}</div>`;
  }
  function answerName(sq, btn) {
    if (!running || mode !== 'name' || busy) return;
    if (sq === target) {
      score++;
      $('#c-score', root).textContent = score;
      busy = true;
      board.setMarks([{ sq: target, cls: 'right' }]);
      clearTimeout(nextTimer);
      nextTimer = setTimeout(() => { busy = false; if (running) nextName(); }, 180);
    } else {
      errors++;
      sound('bad');
      if (btn) { btn.disabled = true; btn.classList.add('wrong'); }
      flash([{ sq: target, cls: 'wrong' }]);
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { if (running && mode === 'name') board.setMarks(targetMark()); }, 250);
    }
  }
  mid.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sq) answerName(b.dataset.sq, b);
    else if (b.id === 'c-done') doneMoves();
  });
  function onKey(e) {
    if (!running || mode !== 'name' || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (FILES.includes(k) && k.length === 1) { typed = k; e.preventDefault(); }
    else if (/^[1-8]$/.test(k) && typed) {
      e.preventDefault();
      const sq = typed + k;
      typed = '';
      answerName(sq, mid.querySelector(`button[data-sq="${sq}"]`));
    } else if (k === 'escape' || k === 'backspace') typed = '';
  }
  document.addEventListener('keydown', onKey);

  // ----- moves (piece vision) -----
  const foundMarks = () => found.map(sq => ({ sq, cls: 'right' }));
  function nextMoves() {
    const type = MOVE_PIECES[Math.floor(Math.random() * MOVE_PIECES.length)];
    const color = side === 'white' ? 'w' : 'b';
    const sq = randomSquare(piece?.sq);
    piece = { type, sq, color };
    answers = pieceDests(type, sq, color);
    found = [];
    busy = false;
    board.setPosition(fenFor(type, sq, color), { animate: false, lastMove: null });
    board.setMarks([]);
    const name = PIECE_NAMES[type];
    mid.innerHTML = `<div class="coord-moves"><div><div class="stat-label">${name[0].toUpperCase() + name.slice(1)} on ${sq}</div><div class="small muted" id="c-found">0 found</div></div><button type="button" class="btn small" id="c-done">${icons.check} Done</button></div>`;
  }
  function finishPosition(completed) {
    busy = true;
    if (completed) {
      score++;
      $('#c-score', root).textContent = score;
      sound('good');
      board.setMarks(foundMarks());
    } else {
      const missed = answers.filter(s => !found.includes(s));
      errors += missed.length;
      sound('bad');
      board.setMarks([...foundMarks(), ...missed.map(sq => ({ sq, cls: 'hint-sq' }))]);
    }
    clearTimeout(nextTimer);
    nextTimer = setTimeout(() => { if (running) nextMoves(); }, completed ? 350 : 1100);
  }
  function tapMoves(sq) {
    if (busy || sq === piece.sq || found.includes(sq)) return;
    if (answers.includes(sq)) {
      found.push(sq);
      const el = $('#c-found', root);
      if (el) el.textContent = `${found.length} found`;
      if (found.length === answers.length) finishPosition(true);
      else board.setMarks(foundMarks());
    } else {
      errors++;
      sound('bad');
      flash([{ sq, cls: 'wrong' }], foundMarks());
    }
  }
  function doneMoves() {
    if (!running || mode !== 'moves' || busy) return;
    finishPosition(found.length === answers.length);
  }

  function tap(sq) {
    if (!running) return;
    if (mode === 'name') return; // answers come from the buttons / keyboard
    if (mode === 'moves') { tapMoves(sq); return; }
    if (sq === target) {
      score++;
      $('#c-score', root).textContent = score;
      flash([{ sq, cls: 'right' }]);
      nextFind();
    } else {
      flash([{ sq, cls: 'wrong' }]);
      sound('bad');
    }
  }

  function stop() {
    running = false;
    busy = false;
    clearInterval(timer);
    clearTimeout(nextTimer);
    clearTimeout(flashTimer);
    const dd = data();
    const key = bestKey(mode, side);
    const isBest = score > (dd.best[key] ?? -1);
    if (isBest) dd.best[key] = score;
    store.set('coords', dd);
    sound('end');
    idleMid();
    board.setMarks([]);
    if (mode === 'moves') board.setPosition(EMPTY, { animate: false });
    const errs = mode === 'find' ? '' : ` · ${errors} ${errors === 1 ? 'error' : 'errors'}`;
    $('#c-result', root).innerHTML = `<div class="status ${isBest ? 'ok' : 'info'}">${score} ${score === 1 ? MODES[mode].unit.slice(0, -1) : MODES[mode].unit}${errs}${isBest ? ' · new best!' : ` · best ${dd.best[key]}`}</div>`;
    $('#c-start', root).disabled = false;
    renderSetup();
    $('#c-time', root).textContent = '0:00';
  }

  $('#c-start', root).addEventListener('click', () => {
    running = true;
    score = 0;
    errors = 0;
    target = null;
    piece = null;
    busy = false;
    $('#c-score', root).textContent = '0';
    $('#c-result', root).innerHTML = '';
    $('#c-start', root).disabled = true;
    // on phones the Start button sits below the board: bring the whole board back into view
    window.scrollTo({ top: 0, behavior: 'smooth' });
    board.setMarks([]);
    if (mode === 'find') { board.setPosition(EMPTY, { animate: false }); nextFind(); }
    else if (mode === 'name') { board.setPosition(EMPTY, { animate: false }); nextName(); }
    else nextMoves();
    const duration = MODES[mode].duration;
    endAt = performance.now() + duration;
    $('#c-time', root).textContent = fmt(duration);
    timer = setInterval(() => {
      const left = endAt - performance.now();
      $('#c-time', root).textContent = fmt(left);
      if (left <= 0) stop();
    }, 100);
  });
  ctx = {
    destroy() {
      clearInterval(timer);
      clearTimeout(nextTimer);
      clearTimeout(flashTimer);
      document.removeEventListener('keydown', onKey);
      board.destroy();
    },
  };
}
