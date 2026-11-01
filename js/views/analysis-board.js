// Analysis board: analyse any position with Stockfish's top lines, import PGN/FEN, send games to review.
import { Board, pieceUrl } from '../board.js';
import { Chess, dests, checkSquare, playUci, uciToMove, uciLineToSan, formatLine, START_FEN } from '../chessutil.js';
import { getEngine, formatScore, toWhite } from '../engine.js';
import { winPct } from '../analysis.js';
import * as store from '../store.js';
import { icons, esc, toast, dialog, $, moveSound, downloadFile, scrollToBoard } from '../ui.js';
import { loadOpenings, openingOf } from '../openings-data.js';
import { playTabs, playFromPosition } from './tabs.js';

let ctx = null;
export function unmount() { ctx?.destroy(); ctx = null; }

export async function mount(root, params) {
  loadOpenings().catch(() => {});
  const saved = store.get('analysis.board', {});
  let startFen = saved.startFen || START_FEN;
  let line = saved.line || [];
  if (params[0]) { startFen = START_FEN; line = params[0].split(',').filter(Boolean); }
  let ply = Number.isInteger(saved.ply) && !params[0] ? Math.max(0, Math.min(saved.ply, line.length)) : line.length;
  let headers = saved.headers || null;
  let alive = true;
  // when you branch off a loaded line, the part you replaced is kept so you can go back to it
  let mainLine = Array.isArray(saved.mainLine) ? saved.mainLine : null;
  let engineOn = saved.engineOn !== false;
  let showArrows = saved.showArrows !== false;
  let nLines = [1, 2, 3].includes(saved.nLines) ? saved.nLines : 3;
  let editing = null;
  const settings = store.getSettings();

  root.innerHTML = `
    ${playTabs('analysis')}
    <div class="stage with-evalbar">
      <div class="board-col">
        <div class="evalbar-h" aria-hidden="true"><i id="ebh" style="width:50%"></i></div>
        <div class="board-and-bar">
          <div class="evalbar-v" id="ebv" aria-hidden="true"><i style="height:50%"></i><span></span></div>
          <div class="board-shell"><div id="board"></div></div>
        </div>
        <div class="review-nav">
          <button class="btn" id="a-first" type="button" aria-label="Start">${icons.first}</button>
          <button class="btn" id="a-back" type="button" aria-label="Back">${icons.prev}</button>
          <button class="btn" id="a-fwd" type="button" aria-label="Forward">${icons.next}</button>
          <button class="btn" id="a-last" type="button" aria-label="End">${icons.last}</button>
          <button class="btn" id="a-flip" type="button" aria-label="Flip board">${icons.flip}</button>
        </div>
      </div>
      <div class="side-col">
        <section class="card stack hidden" id="a-editor"></section>
        <section class="card stack" id="a-lines"></section>
        <section class="card stack">
          <div class="row between"><h3 style="margin:0">Moves</h3><span class="tiny muted" id="a-opening"></span></div>
          <div class="moves" id="a-moves"></div>
          <div class="status info small hidden" id="a-branch"></div>
          <div class="row">
            <button class="btn small" id="a-import" type="button">${icons.upload} Load PGN / FEN</button>
            <button class="btn small" id="a-edit" type="button">${icons.settings} Set up position</button>
            <button class="btn small" id="a-copyfen" type="button">Copy FEN</button>
            <button class="btn small" id="a-copypgn" type="button">Copy PGN</button>
            <button class="btn small" id="a-review" type="button">${icons.eye} Review this game</button>
            <button class="btn small" id="a-play" type="button">${icons.start} Play vs bot from here</button>
            <button class="btn small" id="a-clear" type="button">${icons.retry} New board</button>
          </div>
          <div class="tiny muted" id="a-headers"></div>
        </section>
      </div>
    </div>`;

  const board = new Board($('#board', root), {
    coordinates: settings.coords, animate: settings.animation, orientation: saved.orientation || 'white',
    onMove: (from, to, promo) => {
      const c = chessAt(ply);
      const m = c.moves({ verbose: true }).find(x => x.from === from && x.to === to && (!x.promotion || x.promotion === (promo || 'q')));
      if (!m) return;
      playLineMove(m.from + m.to + (m.promotion || ''));
    },
  });
  const eng = getEngine('analysis');

  function chessAt(n) {
    const c = new Chess(startFen);
    for (const u of line.slice(0, n)) if (!playUci(c, u)) break;
    return c;
  }
  function playLineMove(uci) {
    if (line[ply] === uci) ply++;
    else {
      // branching off: remember the original line (once) so it can be restored
      if (ply < line.length && !mainLine) mainLine = line.slice();
      line = [...line.slice(0, ply), uci]; ply = line.length;
    }
    const c = chessAt(ply);
    const h = c.history({ verbose: true });
    moveSound(h[h.length - 1], c);
    update();
  }
  function persist() { store.set('analysis.board', { startFen, line, ply, headers, orientation: board.orientation, mainLine, engineOn, showArrows, nLines }); }

  let token = 0;
  function update() {
    persist();
    const c = chessAt(ply);
    const h = c.history({ verbose: true });
    const lm = h.length ? [h[h.length - 1].from, h[h.length - 1].to] : null;
    board.setPosition(c.fen(), { lastMove: lm, check: checkSquare(c) });
    board.setMovable({ color: 'both', dests: dests(c) });
    renderMoves();
    analyse(c);
  }

  function renderMoves() {
    const c = chessAt(line.length);
    const sans = c.history();
    const first = startFen.split(' ')[1] === 'b' ? 1 : 0;
    const startNo = +(startFen.split(' ')[5] || 1);
    let html = first ? `<span class="num">${startNo}.</span><span class="mv muted">…</span>` : '';
    sans.forEach((s, i) => {
      const p = i + first;
      if (p % 2 === 0) html += `<span class="num">${startNo + p / 2}.</span>`;
      html += `<span class="mv${i === ply - 1 ? ' cur' : ''}" data-i="${i}">${esc(s)}</span>`;
    });
    const box = $('#a-moves', root);
    box.innerHTML = html || '<span class="muted small" style="grid-column:1/-1">Move pieces for either side, or load a game.</span>';
    const curEl = box.querySelector('.mv.cur');
    if (curEl) box.scrollTop = curEl.offsetTop - box.offsetTop - box.clientHeight / 2;
    const op = startFen === START_FEN ? openingOf(line.slice(0, ply)) : null;
    $('#a-opening', root).textContent = op ? `${op.eco} ${op.name}` : '';
    $('#a-review', root).disabled = line.length < 2;
    const br = $('#a-branch', root);
    // the branch notice disappears once the line is back on the original moves
    if (mainLine && mainLine.length >= line.length && line.every((u, i) => u === mainLine[i])) mainLine = mainLine.length === line.length ? null : mainLine;
    br.classList.toggle('hidden', !mainLine);
    if (mainLine) {
      let at = 0;
      while (at < line.length && line[at] === mainLine[at]) at++;
      br.innerHTML = `You are trying your own moves from move ${Math.floor(at / 2) + 1}. <button class="btn small" id="a-mainline" type="button">${icons.retry} Back to the main line</button>`;
      $('#a-mainline', br).addEventListener('click', () => { line = mainLine; mainLine = null; ply = Math.min(at, line.length); update(); });
    }
    $('#a-headers', root).textContent = headers ? `${headers.White || '?'} vs ${headers.Black || '?'}${headers.Result ? ` · ${headers.Result}` : ''}${headers.Date ? ` · ${headers.Date}` : ''}` : '';
  }

  function analyse(c) {
    const el = $('#a-lines', root);
    eng.cancel();
    const t = ++token;
    const fen = c.fen();
    const engineToggle = () => {
      el.querySelector('#a-engine')?.addEventListener('click', () => { engineOn = !engineOn; persist(); analyse(chessAt(ply)); });
    };
    if (!engineOn) {
      el.innerHTML = `<div class="row between"><h3 style="margin:0">Engine</h3><button class="btn small" id="a-engine" type="button" aria-pressed="false">Turn on</button></div><div class="muted small">Stockfish is off. Think it through yourself, then turn it on to check.</div>`;
      setBar({ cp: 0 });
      board.setArrows([]);
      engineToggle();
      return;
    }
    if (c.isGameOver()) {
      el.innerHTML = `<h3 style="margin:0">Engine</h3><div class="muted small">${c.isCheckmate() ? 'Checkmate.' : 'Draw.'}</div>`;
      setBar(c.isCheckmate() ? { mate: 0, win: c.turn() === 'w' ? 'b' : 'w' } : { cp: 0 });
      board.setArrows([]);
      return;
    }
    el.innerHTML = `<div class="row between"><h3 style="margin:0">Engine</h3><span class="row nowrap"><span class="tiny muted" id="a-depth">starting…</span><button class="btn small" id="a-engine" type="button" aria-pressed="true">Turn off</button></span></div>
      <div class="row between small"><span class="seg" id="a-n" role="group" aria-label="Number of lines">${[1, 2, 3].map(k => `<button type="button" data-v="${k}" aria-pressed="${k === nLines}">${k} line${k > 1 ? 's' : ''}</button>`).join('')}</span>
        <label class="row nowrap" style="gap:6px"><input type="checkbox" id="a-arrows" ${showArrows ? 'checked' : ''}> Arrows</label></div>
      <div id="a-pv" class="stack" style="gap:6px"></div>`;
    engineToggle();
    $('#a-n', el).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { nLines = +b.dataset.v; persist(); analyse(chessAt(ply)); } });
    $('#a-arrows', el).addEventListener('change', (e) => { showArrows = e.target.checked; persist(); if (!showArrows) board.setArrows([]); else analyse(chessAt(ply)); });
    const n = Math.min(nLines, c.moves().length);
    const show = (lines) => {
      if (!alive || t !== token || !lines.length) return;
      $('#a-depth', root).textContent = `Stockfish · depth ${lines[0].depth}`;
      $('#a-pv', root).innerHTML = lines.slice(0, n).map((l, i) => {
        const s = toWhite(l, c.turn());
        const sans = uciLineToSan(fen, l.pv, 10);
        return `<button class="btn small block" type="button" data-pv="${i}" style="justify-content:flex-start;white-space:normal;text-align:left;min-height:38px;height:auto;padding:6px 10px">
          <b class="mono" style="min-width:52px">${formatScore(s)}</b><span class="small">${esc(formatLine(fen, sans))}</span></button>`;
      }).join('');
      $('#a-pv', root).querySelectorAll('[data-pv]').forEach(b => b.addEventListener('click', () => {
        const l = lines[+b.dataset.pv];
        if (l?.pv[0]) playLineMove(l.pv[0]);
      }));
      setBar(toWhite(lines[0], c.turn()));
      const arrows = lines.slice(0, n).map((l, i) => { const m = uciToMove(l.pv[0]); return { from: m.from, to: m.to, color: i === 0 ? 'rgba(16,150,110,.8)' : 'rgba(16,150,110,.35)', width: i === 0 ? 0.16 : 0.11 }; });
      board.setArrows(showArrows ? arrows : []);
    };
    eng.analyze(fen, { depth: 22, movetime: 8000, multipv: n, onInfo: show }).then(r => {
      if (r) show(r.lines);
      else if (eng.failed && alive && t === token) $('#a-depth', root).textContent = 'Engine unavailable: reload the page';
    });
  }

  function setBar(score) {
    const w = winPct(score);
    $('#ebh', root).style.width = w + '%';
    const v = $('#ebv', root);
    const flipped = board.orientation === 'black';
    v.classList.toggle('flipped', flipped);
    v.querySelector('i').style.height = w + '%';
    // the score is written on the side that is ahead, as in the review
    const span = v.querySelector('span');
    span.textContent = !engineOn ? '' : score.mate === 0 ? '#' : formatScore(score).replace('+', '').replace(/^-0\.0$/, '0.0');
    const whiteAhead = w >= 50;
    span.style.top = (whiteAhead !== flipped) ? 'auto' : '4px';
    span.style.bottom = (whiteAhead !== flipped) ? '4px' : 'auto';
    span.style.color = whiteAhead ? 'var(--eval-black)' : 'var(--eval-white)';
  }

  async function importDialog() {
    const body = `<p class="small muted" style="margin-top:0">Paste a PGN (a whole game) or a FEN (a single position). You can export PGNs from any chess site.</p>
      <textarea id="imp-text" rows="8" style="width:100%;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);padding:10px;font:13px var(--mono)" placeholder="1. e4 e5 2. Nf3 ...  or  rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"></textarea>
      <p class="tiny muted" id="imp-err" style="color:var(--bad)"></p>`;
    const d = document.createElement('div');
    const res = await new Promise((resolve) => {
      dialog({ title: 'Load PGN or FEN', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Load', value: 'load', primary: true }] }).then(v => resolve(v ? d.dataset.text : null));
      const ta = document.getElementById('imp-text');
      ta?.addEventListener('input', () => { d.dataset.text = ta.value; });
      ta?.focus();
    });
    if (!res || !res.trim()) return;
    const text = res.trim();
    const looksFen = /^[rnbqkpRNBQKP1-8/]+ [wb] /.test(text);
    try {
      if (looksFen) {
        const c = new Chess(text);
        startFen = c.fen(); line = []; ply = 0; headers = null; mainLine = null;
        toast('Position loaded');
      } else {
        const c = new Chess();
        c.loadPgn(text, { strict: false });
        const hist = c.history({ verbose: true });
        if (!hist.length) throw new Error('No moves found');
        const hdr = c.getHeaders ? c.getHeaders() : c.header();
        startFen = hdr.FEN && hdr.SetUp === '1' ? new Chess(hdr.FEN).fen() : START_FEN;
        line = hist.map(m => m.from + m.to + (m.promotion || ''));
        ply = line.length;
        headers = hdr;
        mainLine = null;
        toast(`Loaded ${Math.ceil(line.length / 2)} moves`);
      }
      update();
      scrollToBoard(root);
    } catch (err) {
      dialog({ title: 'Could not read that', body: `<p>${esc(looksFen ? 'That FEN is not a legal position.' : 'That PGN could not be parsed. Check that the moves are legal and in standard notation.')}</p><p class="tiny muted">${esc(err.message || '')}</p>` });
    }
  }

  async function reviewGame() {
    if (line.length < 2) return;
    const side = await dialog({
      title: 'Review this game',
      body: '<p class="small">Which side did you play? The review will speak to you as that side, and the game will count in your insights.</p>',
      buttons: [{ label: 'Neither', value: 'none' }, { label: 'White', value: 'w' }, { label: 'Black', value: 'b', primary: true }],
    });
    if (!side) return;
    const c = chessAt(line.length);
    const result = ['1-0', '0-1', '1/2-1/2'].includes(headers?.Result) ? headers.Result : (c.isCheckmate() ? (c.turn() === 'w' ? '0-1' : '1-0') : c.isDraw() ? '1/2-1/2' : '*');
    const userColor = side === 'none' ? 'w' : side;
    const userResult = side === 'none' || result === '*' ? null : result === '1/2-1/2' ? 'draw' : ((result === '1-0') === (userColor === 'w') ? 'win' : 'loss');
    const op = startFen === START_FEN ? openingOf(line) : null;
    const parsedDate = headers?.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(headers.Date) ? Date.parse(headers.Date.replace(/\./g, '-')) : NaN;
    const id = 'imp' + Date.now().toString(36);
    const opp = userColor === 'w' ? 'Black' : 'White';
    store.set('game:' + id, {
      id, imported: true, spectator: side === 'none',
      date: Number.isFinite(parsedDate) ? parsedDate : Date.now(), endedAt: Date.now(),
      startFen: startFen === START_FEN ? undefined : startFen,
      whiteName: headers?.White || 'White', blackName: headers?.Black || 'Black',
      userColor, botName: headers?.[opp] || opp, botLabel: headers?.[opp + 'Elo'] || '', botElo: +(headers?.[opp + 'Elo']) || null,
      tc: headers?.TimeControl || null, moves: line.slice(), sans: c.history(),
      result, reason: c.isCheckmate() ? 'checkmate' : 'imported game', userResult,
      opening: op ? { eco: op.eco, name: op.name } : null, takebacks: 0, hints: 0, review: null,
    });
    location.hash = '#/review/' + id;
  }

  $('#a-moves', root).addEventListener('click', (e) => { const m = e.target.closest('.mv[data-i]'); if (m && !editing) { ply = +m.dataset.i + 1; update(); } });
  $('#a-first', root).addEventListener('click', () => { ply = 0; update(); });
  $('#a-back', root).addEventListener('click', () => { if (ply > 0) { ply--; update(); } });
  $('#a-fwd', root).addEventListener('click', () => { if (ply < line.length) { ply++; update(); } });
  $('#a-last', root).addEventListener('click', () => { ply = line.length; update(); });
  $('#a-flip', root).addEventListener('click', () => { board.flip(); update(); });
  $('#a-import', root).addEventListener('click', importDialog);
  $('#a-review', root).addEventListener('click', reviewGame);
  $('#a-play', root).addEventListener('click', async () => {
    if ((await playFromPosition(chessAt(ply).fen())) === 'over') toast('The game is over in this position');
  });
  $('#a-clear', root).addEventListener('click', () => { startFen = START_FEN; line = []; ply = 0; headers = null; mainLine = null; update(); });
  $('#a-copyfen', root).addEventListener('click', () => copyText(chessAt(ply).fen(), 'FEN copied'));
  $('#a-copypgn', root).addEventListener('click', () => copyText(pgnText(), 'PGN copied'));
  $('#a-edit', root).addEventListener('click', () => openEditor(chessAt(ply).fen()));

  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg); }
    catch { downloadFile(msg.startsWith('FEN') ? 'position.fen' : 'analysis.pgn', text, 'text/plain'); toast('Copy is blocked here, so it was downloaded instead'); }
  }
  function pgnText() {
    const c = new Chess(startFen);
    if (startFen !== START_FEN) { c.setHeader('SetUp', '1'); c.setHeader('FEN', startFen); }
    for (const [k, v] of Object.entries(headers || {})) if (k !== 'SetUp' && k !== 'FEN') { try { c.setHeader(k, String(v)); } catch { /* skip odd headers */ } }
    for (const u of line) if (!playUci(c, u)) break;
    return c.pgn();
  }

  // ---------- position editor: tap a square to place the chosen piece ----------
  function openEditor(fen) {
    eng.cancel(); token++;
    const parts = fen.split(' ');
    const map = new Map();
    parts[0].split('/').forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += +ch;
        else { map.set('abcdefgh'[f] + (8 - r), (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase()); f++; }
      }
    });
    editing = { map, turn: parts[1] || 'w', tool: 'wP', castle: parts[2] || '-' };
    const ed = $('#a-editor', root);
    ed.classList.remove('hidden');
    $('#a-lines', root).classList.add('hidden');
    const tools = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
    ed.innerHTML = `
      <div class="row between"><h3 style="margin:0">Set up a position</h3><span class="tiny muted">tap squares to place</span></div>
      <div class="editor-tools" id="e-tools">
        ${tools.map(t => `<button type="button" class="chip" data-t="${t}" aria-label="${t[0] === 'w' ? 'White' : 'Black'} ${({ K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' })[t[1]]}"><img src="${pieceUrl(t)}" alt="" width="30" height="30"></button>`).join('')}
        <button type="button" class="chip" data-t="x" aria-label="Eraser">${icons.trash}</button>
      </div>
      <div class="seg" id="e-turn" role="group" aria-label="Side to move"><button type="button" data-v="w">White to move</button><button type="button" data-v="b">Black to move</button></div>
      <div class="row small" id="e-castle">
        ${[['K', 'White O-O'], ['Q', 'White O-O-O'], ['k', 'Black O-O'], ['q', 'Black O-O-O']].map(([c, l]) => `<label class="row nowrap" style="gap:4px"><input type="checkbox" data-c="${c}" ${editing.castle.includes(c) ? 'checked' : ''}>${l}</label>`).join('')}
      </div>
      <div class="row">
        <button class="btn small" id="e-start" type="button">Start position</button>
        <button class="btn small" id="e-clear" type="button">${icons.trash} Clear board</button>
      </div>
      <div class="status bad small hidden" id="e-err"></div>
      <div class="grid-2">
        <button class="btn" id="e-cancel" type="button">Cancel</button>
        <button class="btn primary" id="e-done" type="button">${icons.check} Done</button>
      </div>`;
    const markTool = () => ed.querySelectorAll('#e-tools [data-t]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === editing.tool)));
    const markTurn = () => ed.querySelectorAll('#e-turn button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === editing.turn)));
    markTool(); markTurn();
    $('#e-tools', ed).addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) { editing.tool = b.dataset.t; markTool(); } });
    $('#e-turn', ed).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { editing.turn = b.dataset.v; markTurn(); } });
    $('#e-start', ed).addEventListener('click', () => { editing.map.clear(); const f = START_FEN.split(' ')[0]; loadPlacement(f); editing.turn = 'w'; markTurn(); ed.querySelectorAll('#e-castle input').forEach(i => { i.checked = true; }); drawEditor(); });
    $('#e-clear', ed).addEventListener('click', () => { editing.map.clear(); drawEditor(); });
    $('#e-cancel', ed).addEventListener('click', closeEditor);
    $('#e-done', ed).addEventListener('click', finishEditor);
    board.setMovable({});
    board.setArrows([]);
    board.opts.onSquare = (sq) => {
      if (!editing) return;
      const cur = editing.map.get(sq);
      if (editing.tool === 'x' || cur === editing.tool) editing.map.delete(sq);
      else editing.map.set(sq, editing.tool);
      drawEditor();
    };
    drawEditor();
  }
  function loadPlacement(placement) {
    placement.split('/').forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += +ch;
        else { editing.map.set('abcdefgh'[f] + (8 - r), (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase()); f++; }
      }
    });
  }
  function placementOf(map) {
    const rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = '', empty = 0;
      for (const f of 'abcdefgh') {
        const p = map.get(f + r);
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p[0] === 'w' ? p[1] : p[1].toLowerCase();
      }
      rows.push(row + (empty || ''));
    }
    return rows.join('/');
  }
  function drawEditor() {
    board.setPosition(placementOf(editing.map) + ' w - - 0 1', { lastMove: null, check: null, animate: false });
    $('#e-err', root)?.classList.add('hidden');
  }
  function editorFen() {
    const m = editing.map;
    const at = (sq, p) => m.get(sq) === p;
    // keep only castling rights that the pieces on the board still allow
    let castle = '';
    const want = new Set([...root.querySelectorAll('#e-castle input:checked')].map(i => i.dataset.c));
    if (want.has('K') && at('e1', 'wK') && at('h1', 'wR')) castle += 'K';
    if (want.has('Q') && at('e1', 'wK') && at('a1', 'wR')) castle += 'Q';
    if (want.has('k') && at('e8', 'bK') && at('h8', 'bR')) castle += 'k';
    if (want.has('q') && at('e8', 'bK') && at('a8', 'bR')) castle += 'q';
    return `${placementOf(m)} ${editing.turn} ${castle || '-'} - 0 1`;
  }
  function finishEditor() {
    const fen = editorFen();
    const err = (msg) => { const e = $('#e-err', root); e.textContent = msg; e.classList.remove('hidden'); };
    const pieces = [...editing.map.values()];
    if (pieces.filter(p => p === 'wK').length !== 1 || pieces.filter(p => p === 'bK').length !== 1) return err('Each side needs exactly one king.');
    if ([...editing.map.entries()].some(([sq, p]) => p[1] === 'P' && (sq[1] === '1' || sq[1] === '8'))) return err('Pawns cannot stand on the first or last rank.');
    let c;
    try { c = new Chess(fen); } catch (e) { return err('That is not a legal position.'); }
    // the side that is not to move must not be in check
    const flipped = fen.replace(/ [wb] /, editing.turn === 'w' ? ' b ' : ' w ');
    try { if (new Chess(flipped).inCheck()) return err(`${editing.turn === 'w' ? 'Black' : 'White'} is in check but it is ${editing.turn === 'w' ? 'White' : 'Black'}'s move. Change the side to move.`); } catch { /* fine */ }
    startFen = c.fen(); line = []; ply = 0; headers = null; mainLine = null;
    closeEditor();
    toast('Position set up');
  }
  function closeEditor() {
    editing = null;
    board.opts.onSquare = null;
    $('#a-editor', root).classList.add('hidden');
    $('#a-lines', root).classList.remove('hidden');
    update();
  }
  const onKey = (e) => {
    if (e.target.closest('input,textarea,select,dialog') || editing) return;
    if (e.key === 'ArrowLeft' && ply > 0) { ply--; update(); e.preventDefault(); }
    else if (e.key === 'ArrowRight' && ply < line.length) { ply++; update(); e.preventDefault(); }
    else if (e.key === 'Home' || e.key === 'ArrowUp') { ply = 0; update(); e.preventDefault(); }
    else if (e.key === 'End' || e.key === 'ArrowDown') { ply = line.length; update(); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  ctx = { destroy() { alive = false; eng.cancel(); document.removeEventListener('keydown', onKey); board.destroy(); } };
  update();
}
