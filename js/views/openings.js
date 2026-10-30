// Opening explorer: names the opening as you play, shows book continuations and a live engine eval.
import { Board } from '../board.js';
import { Chess, dests, checkSquare, playUci, uciToMove, uciLineToSan, formatLine } from '../chessutil.js';
import { getEngine, formatScore, toWhite } from '../engine.js';
import { winPct } from '../analysis.js';
import * as store from '../store.js';
import { icons, esc, toast, dialog, $, moveSound } from '../ui.js';
import { loadOpenings, openingOf, continuations, isBook, searchLines } from '../openings-data.js';
import { addLine, trainerTabs } from './trainer.js';

let ctx = null;
export function unmount() { ctx?.destroy(); ctx = null; }

export async function mount(root, params, isCurrent = () => true) {
  root.innerHTML = `${trainerTabs('explorer')}<div class="page"><div class="status"><span class="spinner"></span> Loading openings…</div></div>`;
  try { await loadOpenings(); } catch {
    root.querySelector('.page').innerHTML = '<div class="card">Could not load the openings data. Check your connection and reload.</div>';
    return;
  }
  if (!isCurrent()) return;
  const settings = store.getSettings();
  let line = params[0] ? params[0].split(',').filter(Boolean) : (store.get('explorer.line') || []);
  let ply = line.length;
  let engineOn = store.get('explorer.engine', true);
  let alive = true;

  root.innerHTML = `
    ${trainerTabs('explorer')}
    <div class="stage with-evalbar">
      <div class="board-col">
        <div class="evalbar-h" aria-hidden="true"><i id="ebh" style="width:50%"></i></div>
        <div class="board-and-bar">
          <div class="evalbar-v" id="ebv" aria-hidden="true"><i style="height:50%"></i><span></span></div>
          <div class="board-shell"><div id="board"></div></div>
        </div>
        <div class="review-nav">
          <button class="btn" id="o-reset" type="button" aria-label="Start position">${icons.first}</button>
          <button class="btn" id="o-back" type="button" aria-label="Back">${icons.prev}</button>
          <button class="btn" id="o-fwd" type="button" aria-label="Forward">${icons.next}</button>
          <button class="btn" id="o-flip" type="button" aria-label="Flip board">${icons.flip}</button>
          <button class="btn" id="o-train" type="button" aria-label="Train this line">${icons.plus}</button>
        </div>
      </div>
      <div class="side-col">
        <section class="card stack" id="o-name"></section>
        <section class="card stack" id="o-engine"></section>
        <section class="card" id="o-book-card"><div class="row between"><h3 style="margin:0">Book moves</h3><span class="tiny muted">from the opening database</span></div><div class="list" id="o-book" style="margin-top:4px"></div></section>
        <section class="card stack">
          <h3 style="margin:0">Find an opening</h3>
          <input type="search" id="o-search" placeholder="e.g. Sicilian Najdorf, London, Caro-Kann" autocomplete="off" aria-label="Search openings">
          <div class="list" id="o-results"></div>
        </section>
      </div>
    </div>`;

  const board = new Board($('#board', root), {
    coordinates: settings.coords, animate: settings.animation,
    orientation: store.get('explorer.orientation', 'white'),
    onMove: (from, to, promo) => {
      const c = chessAt(ply);
      const m = c.moves({ verbose: true }).find(x => x.from === from && x.to === to && (!x.promotion || x.promotion === (promo || 'q')));
      if (!m) return;
      const uci = from + to + (m.promotion || '');
      if (line[ply] === uci) { ply++; }
      else { line = [...line.slice(0, ply), uci]; ply = line.length; }
      moveSound(m, chessAfter(c, uci));
      update();
    },
  });

  function chessAt(n) {
    const c = new Chess();
    for (const u of line.slice(0, n)) if (!playUci(c, u)) break;
    return c;
  }
  function chessAfter(c, uci) { const d = new Chess(c.fen()); playUci(d, uci); return d; }

  function update() {
    store.set('explorer.line', line);
    const c = chessAt(ply);
    const fen = c.fen();
    const hist = c.history({ verbose: true });
    const lm = hist.length ? [hist[hist.length - 1].from, hist[hist.length - 1].to] : null;
    board.setPosition(fen, { lastMove: lm, check: checkSquare(c) });
    board.setMovable({ color: 'both', dests: dests(c) });
    board.setArrows([]);
    renderName(c);
    renderBook(fen);
    runEngine(fen, c.turn());
  }

  function renderName(c) {
    const op = openingOf(line.slice(0, ply));
    const inBook = ply === 0 || isBook(c.fen());
    const sans = c.history();
    let moves = '';
    sans.forEach((s, i) => { if (i % 2 === 0) moves += `<span class="n">${i / 2 + 1}.</span>`; moves += `<span class="${i === ply - 1 ? 'cur' : ''}">${esc(s)}</span>`; });
    $('#o-name', root).innerHTML = `
      <div class="row between nowrap"><span class="tiny muted mono">${op ? esc(op.eco) : ply ? '' : 'Start'}</span><span class="tiny ${inBook ? 'tq-book' : 'muted'}" style="font-weight:700">${ply === 0 ? '' : inBook ? 'In book' : 'Out of book'}</span></div>
      <h2 style="margin:0">${op ? esc(op.name) : ply === 0 ? 'Starting position' : 'Unnamed position'}</h2>
      ${!inBook && op ? `<div class="small muted">Last named position: move ${Math.ceil(op.ply / 2)}</div>` : ''}
      <div class="moves-inline" style="padding:0;flex-wrap:wrap">${moves || '<span class="muted small">Make a move on the board or pick a book move below.</span>'}</div>`;
  }

  function renderBook(fen) {
    const conts = continuations(fen);
    const el = $('#o-book', root);
    if (!conts.length) {
      el.innerHTML = `<div class="empty small">${ply === 0 ? '' : 'No more book moves from here. You are on your own!'}</div>`;
      return;
    }
    el.innerHTML = conts.slice(0, 14).map(m => `
      <button class="list-item" type="button" data-uci="${m.uci}" style="background:none;border:0;border-bottom:1px solid var(--border);width:100%;text-align:left;cursor:pointer;font:inherit;color:inherit">
        <b class="mono" style="min-width:56px">${esc(m.san)}</b>
        <div class="grow"><div class="s" style="color:var(--text)">${esc(m.name || '')}${m.named ? '' : ' <span class="muted">(continues)</span>'}</div></div>
        <span class="tiny muted mono">${esc(m.eco)}</span>
      </button>`).join('');
  }

  let engineToken = 0;
  function runEngine(fen, turn) {
    const el = $('#o-engine', root);
    const eng = getEngine('analysis');
    eng.cancel();
    const token = ++engineToken;
    const head = `<div class="row between"><h3 style="margin:0">Engine</h3><label class="toggle small" style="padding:0"><span>Stockfish</span><input type="checkbox" id="o-eng" ${engineOn ? 'checked' : ''}></label></div>`;
    const c = new Chess(fen);
    if (!engineOn || c.isGameOver()) {
      el.innerHTML = head + `<div class="muted small">${c.isGameOver() ? 'Game over in this position.' : 'Engine is off.'}</div>`;
      setBar(null);
      bindToggle();
      return;
    }
    el.innerHTML = head + `<div class="row nowrap"><span class="stat-big" id="o-score" style="font-size:1.5rem">…</span><span class="tiny muted" id="o-depth">starting</span></div><div class="small" id="o-pv"></div>`;
    bindToggle();
    const show = (lines) => {
      if (!alive || token !== engineToken || !lines.length) return;
      const l = lines[0];
      const s = toWhite(l, turn);
      $('#o-score', root).textContent = formatScore(s);
      $('#o-depth', root).textContent = `depth ${l.depth}`;
      const sans = uciLineToSan(fen, l.pv, 8);
      $('#o-pv', root).innerHTML = `<span class="muted">Best line:</span> ${esc(formatLine(fen, sans))}`;
      setBar(s);
      const b = uciToMove(l.pv[0]);
      board.setArrows([{ from: b.from, to: b.to, color: 'rgba(16,150,110,.7)' }]);
    };
    eng.analyze(fen, { depth: 20, movetime: 5000, onInfo: show }).then(r => { if (r) show(r.lines); });
  }

  function bindToggle() {
    $('#o-eng', root)?.addEventListener('change', (e) => {
      engineOn = e.target.checked;
      store.set('explorer.engine', engineOn);
      if (!engineOn) { getEngine('analysis').cancel(); board.setArrows([]); }
      const c = chessAt(ply);
      runEngine(c.fen(), c.turn());
    });
  }

  function setBar(score) {
    const w = score ? winPct(score) : 50;
    $('#ebh', root).style.width = w + '%';
    const v = $('#ebv', root);
    const flipped = board.orientation === 'black';
    v.classList.toggle('flipped', flipped);
    v.querySelector('i').style.height = w + '%';
  }

  $('#o-book', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-uci]');
    if (!b) return;
    const uci = b.dataset.uci;
    const c = chessAt(ply);
    const m = playUci(new Chess(c.fen()), uci);
    if (line[ply] === uci) ply++;
    else { line = [...line.slice(0, ply), uci]; ply = line.length; }
    moveSound(m, chessAt(ply));
    update();
  });
  $('#o-reset', root).addEventListener('click', () => { ply = 0; update(); });
  $('#o-back', root).addEventListener('click', () => { if (ply > 0) { ply--; update(); } });
  $('#o-fwd', root).addEventListener('click', () => { if (ply < line.length) { ply++; update(); } });
  $('#o-flip', root).addEventListener('click', () => {
    board.flip();
    store.set('explorer.orientation', board.orientation);
    const c = chessAt(ply);
    runEngine(c.fen(), c.turn());
  });
  $('#o-train', root).addEventListener('click', async () => {
    const moves = line.slice(0, ply);
    if (moves.length < 2) { toast('Play at least a couple of moves first'); return; }
    const op = openingOf(moves);
    const name = op?.name || 'My line';
    const sans = uciLineToSan(new Chess().fen(), moves);
    const color = await dialog({
      title: 'Train this line',
      body: `<p><b>${esc(name)}</b></p><p class="small muted">${esc(formatLine(new Chess().fen(), sans))}</p><p class="small">Which side do you want to practise? You play that side's moves and the app plays the rest.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'As White', value: 'w' }, { label: 'As Black', value: 'b', primary: true }],
    });
    if (!color) return;
    const res = addLine({ name, eco: op?.eco || '', color, moves });
    toast(res === 'exists' ? 'That line is already in your trainer' : 'Added to your trainer');
  });

  const search = $('#o-search', root);
  let st = null;
  search.addEventListener('input', () => {
    clearTimeout(st);
    st = setTimeout(() => {
      const res = searchLines(search.value, 25);
      $('#o-results', root).innerHTML = res.map(l => `
        <button class="list-item" type="button" data-line="${l.moves.join(',')}" style="background:none;border:0;border-bottom:1px solid var(--border);width:100%;text-align:left;cursor:pointer;font:inherit;color:inherit">
          <span class="tiny muted mono" style="min-width:34px">${esc(l.eco)}</span>
          <div class="grow"><div class="t">${esc(l.name)}</div><div class="s">${esc(formatLine(new Chess().fen(), uciLineToSan(new Chess().fen(), l.moves)))}</div></div>
        </button>`).join('') || (search.value.trim() ? '<div class="empty small">No openings match.</div>' : '');
    }, 150);
  });
  $('#o-results', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-line]');
    if (!b) return;
    line = b.dataset.line.split(',');
    ply = line.length;
    update();
    root.querySelector('.board-col').scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });

  ctx = {
    destroy() {
      alive = false;
      getEngine('analysis').cancel();
      board.destroy();
    },
  };
  update();
}
