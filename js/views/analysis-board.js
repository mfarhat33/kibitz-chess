// Analysis board: analyse any position with Stockfish's top lines, keep side lines (variations),
// comment and annotate moves, import/export PGN or FEN, set up positions, send games to review.
import { Board, pieceUrl } from '../board.js';
import { Chess, dests, checkSquare, uciToMove, uciLineToSan, formatLine, START_FEN } from '../chessutil.js';
import { getEngine, formatScore, toWhite } from '../engine.js';
import { winPct } from '../analysis.js';
import * as store from '../store.js';
import { icons, esc, toast, dialog, $, moveSound, downloadFile, scrollToBoard, fig } from '../ui.js';
import { loadOpenings, openingOf } from '../openings-data.js';
import { playTabs, playFromPosition } from './tabs.js';
import { MoveTree, NAGS } from '../movetree.js';

let ctx = null;
export function unmount() { ctx?.destroy(); ctx = null; }

/** Rebuilds the saved board: a full tree, or a simple line handed over by the review, puzzles or openings. */
function loadSaved(saved, params) {
  if (params[0]) {
    const t = MoveTree.fromLine(START_FEN, params[0].split(',').filter(Boolean));
    return { tree: t, cur: t.mainEnd() };
  }
  if (saved.tree) {
    try { const t = MoveTree.fromJSON(saved.tree); return { tree: t, cur: t.fromIndexPath(saved.at) }; } catch { /* fall through */ }
  }
  let t;
  try { t = MoveTree.fromLine(saved.startFen || START_FEN, saved.line || []); } catch { t = new MoveTree(); }
  const ply = Number.isInteger(saved.ply) ? saved.ply : Infinity;
  let cur = t.root;
  for (let i = 0; i < ply && cur.children.length; i++) cur = cur.children[0];
  return { tree: t, cur };
}

export async function mount(root, params) {
  loadOpenings().catch(() => {});
  const saved = store.get('analysis.board', {});
  let { tree, cur } = loadSaved(saved, params);
  let headers = saved.headers || null;
  let alive = true;
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
          <button class="btn" id="a-last" type="button" aria-label="End of this line">${icons.last}</button>
          <button class="btn" id="a-flip" type="button" aria-label="Flip board">${icons.flip}</button>
        </div>
      </div>
      <div class="side-col">
        <section class="card stack hidden" id="a-editor"></section>
        <section class="card stack" id="a-lines"></section>
        <section class="card stack">
          <div class="row between"><h3 style="margin:0">Moves</h3><span class="tiny muted" id="a-opening"></span></div>
          <div class="tree-moves" id="a-moves"></div>
          <div class="move-tools hidden" id="a-tools"></div>
          <div class="row">
            <button class="btn small" id="a-import" type="button">${icons.upload} Load PGN / FEN</button>
            <button class="btn small" id="a-edit" type="button">${icons.settings} Set up position</button>
            <button class="btn small" id="a-copyfen" type="button">Copy FEN</button>
            <button class="btn small" id="a-copypgn" type="button">Copy PGN</button>
            <button class="btn small" id="a-dlpgn" type="button">${icons.download} PGN</button>
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
      const c = new Chess(cur.fen);
      const m = c.moves({ verbose: true }).find(x => x.from === from && x.to === to && (!x.promotion || x.promotion === (promo || 'q')));
      if (!m) return;
      playMove(m.from + m.to + (m.promotion || ''));
    },
  });
  const eng = getEngine('analysis');

  // a move from the current position: follows an existing move, or starts a new side line
  function playMove(uci) {
    const n = tree.add(cur, uci);
    if (!n) return;
    cur = n;
    const c = new Chess(n.fen);
    moveSound({ captured: /x/.test(n.san) }, c);
    update();
  }
  function goTo(node) { if (node && node !== cur) { cur = node; update(); } }
  function persist() {
    store.set('analysis.board', { tree: tree.toJSON(), at: tree.indexPath(cur), headers, orientation: board.orientation, engineOn, showArrows, nLines });
  }

  let token = 0;
  function update() {
    persist();
    const c = new Chess(cur.fen);
    board.setPosition(cur.fen, { lastMove: cur.last || null, check: checkSquare(c) });
    board.setMovable({ color: 'both', dests: dests(c) });
    renderMoves();
    renderTools();
    analyse(c);
  }

  // ---------- move list with side lines, comments and annotations ----------
  function moveHtml(n, force) {
    const [, turn, , , , full] = n.parent.fen.split(' ');
    const no = turn === 'w' ? `<span class="tn">${full}.</span>` : force ? `<span class="tn">${full}...</span>` : '';
    return `${no}<span class="tm${n === cur ? ' cur' : ''}" data-id="${n.id}">${esc(fig(n.san))}${n.nag ? `<b class="nag nag-${NAGS.indexOf(n.nag)}">${esc(n.nag)}</b>` : ''}</span>${n.comment ? `<span class="cmt">${esc(n.comment)}</span>` : ''}`;
  }
  function lineHtml(parent, force, depth) {
    let html = '', p = parent, f = force;
    while (p.children.length) {
      const [main, ...alts] = p.children;
      html += moveHtml(main, f);
      for (const a of alts) html += `<div class="var" style="--d:${Math.min(depth + 1, 4)}">${moveHtml(a, true)}${lineHtml(a, false, depth + 1)}</div>`;
      f = alts.length > 0 || !!main.comment;
      p = main;
    }
    return html;
  }
  function renderMoves() {
    const box = $('#a-moves', root);
    const html = (tree.root.comment ? `<span class="cmt">${esc(tree.root.comment)}</span>` : '') + lineHtml(tree.root, true, 0);
    box.innerHTML = html || '<span class="muted small">Move pieces for either side, or load a game. Moves you try from an earlier position are kept as side lines.</span>';
    const curEl = box.querySelector('.tm.cur');
    if (curEl && (curEl.offsetTop < box.scrollTop || curEl.offsetTop > box.scrollTop + box.clientHeight - 24)) box.scrollTop = curEl.offsetTop - box.clientHeight / 2;
    const op = tree.startFen === START_FEN ? openingOf(tree.ucis(cur)) : null;
    $('#a-opening', root).textContent = op ? `${op.eco} ${op.name}` : '';
    $('#a-review', root).disabled = tree.mainLine().length < 2;
    $('#a-headers', root).textContent = headers ? `${headers.White || '?'} vs ${headers.Black || '?'}${headers.Result ? ` · ${headers.Result}` : ''}${headers.Date ? ` · ${headers.Date}` : ''}` : '';
  }
  // tools for the current move: annotation, comment, promote / delete side line
  function renderTools() {
    const el = $('#a-tools', root);
    if (cur === tree.root) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const side = !tree.isMain(cur);
    el.innerHTML = `
      <div class="row nowrap" style="gap:6px;flex-wrap:wrap">
        <span class="tiny muted">${esc(fig(cur.san))}${side ? ' · side line' : ''}</span>
        <span class="nag-btns" role="group" aria-label="Annotate this move">${NAGS.map((g, i) => `<button type="button" class="chip nag-${i}" data-nag="${esc(g)}" aria-pressed="${cur.nag === g}">${esc(g)}</button>`).join('')}</span>
      </div>
      <div class="row" style="gap:6px">
        <button class="btn small" id="t-cmt" type="button">${cur.comment ? 'Edit comment' : 'Add comment'}</button>
        ${side ? `<button class="btn small" id="t-promote" type="button">${icons.prev} Promote line</button>` : ''}
        <button class="btn small danger" id="t-del" type="button">${icons.trash} Delete from here</button>
      </div>`;
    el.querySelector('.nag-btns').addEventListener('click', (e) => {
      const b = e.target.closest('[data-nag]');
      if (!b) return;
      cur.nag = cur.nag === b.dataset.nag ? '' : b.dataset.nag;
      persist(); renderMoves(); renderTools();
    });
    $('#t-cmt', el).addEventListener('click', editComment);
    $('#t-promote', el)?.addEventListener('click', () => { tree.promote(cur); persist(); renderMoves(); renderTools(); });
    $('#t-del', el).addEventListener('click', () => { cur = tree.remove(cur); update(); });
  }
  async function editComment() {
    const node = cur;
    const holder = document.createElement('div');
    holder.dataset.text = node.comment || '';
    const res = await new Promise((resolve) => {
      dialog({
        title: `Comment on ${fig(node.san)}`,
        body: `<textarea id="cmt-text" rows="4" maxlength="2000" style="width:100%;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);padding:10px;font:inherit" placeholder="What is the idea of this move?">${esc(node.comment || '')}</textarea>`,
        buttons: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'save', primary: true }],
      }).then(v => resolve(v ? holder.dataset.text : null));
      const ta = document.getElementById('cmt-text');
      ta?.addEventListener('input', () => { holder.dataset.text = ta.value; });
      ta?.focus();
    });
    if (res == null) return;
    node.comment = res.trim().slice(0, 2000);
    persist(); renderMoves(); renderTools();
  }

  function analyse(c) {
    const el = $('#a-lines', root);
    eng.cancel();
    const t = ++token;
    const fen = c.fen();
    const engineToggle = () => {
      el.querySelector('#a-engine')?.addEventListener('click', () => { engineOn = !engineOn; persist(); analyse(new Chess(cur.fen)); });
    };
    if (!engineOn) {
      el.innerHTML = `<div class="row between"><h3 style="margin:0">Engine</h3><button class="btn small" id="a-engine" type="button" aria-pressed="false">Turn on</button></div><div class="muted small">Stockfish is off. Think it through yourself, then turn it on to check.</div>`;
      setBar({ cp: 0 });
      board.setArrows([]);
      engineToggle();
      return;
    }
    if (c.isGameOver()) {
      el.innerHTML = `<div class="row between"><h3 style="margin:0">Engine</h3><button class="btn small" id="a-engine" type="button" aria-pressed="true">Turn off</button></div><div class="muted small">${c.isCheckmate() ? 'Checkmate.' : 'Draw.'}</div>`;
      setBar(c.isCheckmate() ? { mate: 0, win: c.turn() === 'w' ? 'b' : 'w' } : { cp: 0 });
      board.setArrows([]);
      engineToggle();
      return;
    }
    el.innerHTML = `<div class="row between"><h3 style="margin:0">Engine</h3><span class="row nowrap"><span class="tiny muted" id="a-depth">starting…</span><button class="btn small" id="a-engine" type="button" aria-pressed="true">Turn off</button></span></div>
      <div class="row between small"><span class="seg" id="a-n" role="group" aria-label="Number of lines">${[1, 2, 3].map(k => `<button type="button" data-v="${k}" aria-pressed="${k === nLines}">${k} line${k > 1 ? 's' : ''}</button>`).join('')}</span>
        <label class="row nowrap" style="gap:6px"><input type="checkbox" id="a-arrows" ${showArrows ? 'checked' : ''}> Arrows</label></div>
      <div id="a-pv" class="stack" style="gap:6px"></div>`;
    engineToggle();
    $('#a-n', el).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { nLines = +b.dataset.v; persist(); analyse(new Chess(cur.fen)); } });
    $('#a-arrows', el).addEventListener('change', (e) => { showArrows = e.target.checked; persist(); if (!showArrows) board.setArrows([]); else analyse(new Chess(cur.fen)); });
    const n = Math.min(nLines, c.moves().length);
    const show = (lines) => {
      if (!alive || t !== token || !lines.length) return;
      $('#a-depth', root).textContent = `Stockfish · depth ${lines[0].depth}`;
      $('#a-pv', root).innerHTML = lines.slice(0, n).map((l, i) => {
        const s = toWhite(l, c.turn());
        const sans = uciLineToSan(fen, l.pv, 10);
        return `<button class="btn small block" type="button" data-pv="${i}" style="justify-content:flex-start;white-space:normal;text-align:left;min-height:38px;height:auto;padding:6px 10px">
          <b class="mono" style="min-width:52px">${formatScore(s)}</b><span class="small">${esc(fig(formatLine(fen, sans)))}</span></button>`;
      }).join('');
      $('#a-pv', root).querySelectorAll('[data-pv]').forEach(b => b.addEventListener('click', () => {
        const l = lines[+b.dataset.pv];
        if (l?.pv[0]) playMove(l.pv[0]);
      }));
      setBar(toWhite(lines[0], c.turn()));
      const arrows = lines.slice(0, n).map((l, i) => { const m = uciToMove(l.pv[0]); return { from: m.from, to: m.to, color: i === 0 ? 'rgba(16,150,110,.8)' : 'rgba(16,150,110,.35)', width: i === 0 ? 0.16 : 0.11 }; });
      board.setArrows(showArrows ? arrows : []);
    };
    eng.analyze(fen, { depth: 22, movetime: 8000, multipv: n, startFen: tree.startFen, moves: tree.ucis(cur), onInfo: show }).then(r => {
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
    const body = `<p class="small muted" style="margin-top:0">Paste a PGN (a whole game, side lines and comments are kept) or a FEN (a single position). You can export PGNs from any chess site.</p>
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
        tree = new MoveTree(new Chess(text).fen()); cur = tree.root; headers = null;
        toast('Position loaded');
      } else {
        const r = MoveTree.fromPgn(text);
        if (!r.mainMoves) throw new Error('No moves found');
        tree = r.tree; headers = r.headers; cur = tree.mainEnd();
        const extra = tree.size() - r.mainMoves;
        toast(`Loaded ${Math.ceil(r.mainMoves / 2)} moves${extra ? ` and ${extra} side-line move${extra === 1 ? '' : 's'}` : ''}`);
      }
      update();
      scrollToBoard(root);
    } catch (err) {
      dialog({ title: 'Could not read that', body: `<p>${esc(looksFen ? 'That FEN is not a legal position.' : 'That PGN could not be parsed. Check that the moves are legal and in standard notation.')}</p><p class="tiny muted">${esc(err.message || '')}</p>` });
    }
  }

  async function reviewGame() {
    const line = tree.mainLine();
    if (line.length < 2) return;
    const side = await dialog({
      title: 'Review this game',
      body: '<p class="small">Which side did you play? The review will speak to you as that side, and the game will count in your insights. Only the main line is reviewed.</p>',
      buttons: [{ label: 'Neither', value: 'none' }, { label: 'White', value: 'w' }, { label: 'Black', value: 'b', primary: true }],
    });
    if (!side) return;
    const end = tree.mainEnd();
    const c = new Chess(end.fen);
    const sans = tree.path(end).map(n => n.san);
    const result = ['1-0', '0-1', '1/2-1/2'].includes(headers?.Result) ? headers.Result : (c.isCheckmate() ? (c.turn() === 'w' ? '0-1' : '1-0') : c.isDraw() ? '1/2-1/2' : '*');
    const userColor = side === 'none' ? 'w' : side;
    const userResult = side === 'none' || result === '*' ? null : result === '1/2-1/2' ? 'draw' : ((result === '1-0') === (userColor === 'w') ? 'win' : 'loss');
    const op = tree.startFen === START_FEN ? openingOf(line) : null;
    const parsedDate = headers?.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(headers.Date) ? Date.parse(headers.Date.replace(/\./g, '-')) : NaN;
    const id = 'imp' + Date.now().toString(36);
    const opp = userColor === 'w' ? 'Black' : 'White';
    store.set('game:' + id, {
      id, imported: true, spectator: side === 'none',
      date: Number.isFinite(parsedDate) ? parsedDate : Date.now(), endedAt: Date.now(),
      startFen: tree.startFen === START_FEN ? undefined : tree.startFen,
      whiteName: headers?.White || 'White', blackName: headers?.Black || 'Black',
      userColor, botName: headers?.[opp] || opp, botLabel: headers?.[opp + 'Elo'] || '', botElo: +(headers?.[opp + 'Elo']) || null,
      tc: headers?.TimeControl || null, moves: line, sans,
      result, reason: c.isCheckmate() ? 'checkmate' : 'imported game', userResult,
      opening: op ? { eco: op.eco, name: op.name } : null, takebacks: 0, hints: 0, review: null,
    });
    location.hash = '#/review/' + id;
  }

  $('#a-moves', root).addEventListener('click', (e) => { const m = e.target.closest('.tm[data-id]'); if (m && !editing) goTo(tree.get(+m.dataset.id)); });
  $('#a-first', root).addEventListener('click', () => goTo(tree.root));
  $('#a-back', root).addEventListener('click', () => goTo(cur.parent));
  $('#a-fwd', root).addEventListener('click', () => goTo(cur.children[0]));
  $('#a-last', root).addEventListener('click', () => goTo(tree.lineEnd(cur)));
  $('#a-flip', root).addEventListener('click', () => { board.flip(); update(); });
  $('#a-import', root).addEventListener('click', importDialog);
  $('#a-review', root).addEventListener('click', reviewGame);
  $('#a-play', root).addEventListener('click', async () => {
    if ((await playFromPosition(cur.fen)) === 'over') toast('The game is over in this position');
  });
  $('#a-clear', root).addEventListener('click', () => { tree = new MoveTree(); cur = tree.root; headers = null; update(); });
  $('#a-copyfen', root).addEventListener('click', () => copyText(cur.fen, 'FEN copied'));
  $('#a-copypgn', root).addEventListener('click', () => copyText(pgnText(), 'PGN copied'));
  $('#a-dlpgn', root).addEventListener('click', () => downloadFile('kibitz-analysis.pgn', pgnText(), 'application/x-chess-pgn'));
  $('#a-edit', root).addEventListener('click', () => openEditor(cur.fen));

  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg); }
    catch { downloadFile(msg.startsWith('FEN') ? 'position.fen' : 'analysis.pgn', text, 'text/plain'); toast('Copy is blocked here, so it was downloaded instead'); }
  }
  function pgnText() {
    const h = {};
    for (const [k, v] of Object.entries(headers || {})) if (!['SetUp', 'FEN'].includes(k) && v != null) h[k] = String(v);
    return tree.toPgn(h);
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
    tree = new MoveTree(c.fen()); cur = tree.root; headers = null;
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
    if (e.key === 'ArrowLeft') { goTo(cur.parent); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { goTo(cur.children[0]); e.preventDefault(); }
    else if (e.key === 'Home' || e.key === 'ArrowUp') { goTo(tree.root); e.preventDefault(); }
    else if (e.key === 'End' || e.key === 'ArrowDown') { goTo(tree.lineEnd(cur)); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  ctx = { destroy() { alive = false; eng.cancel(); document.removeEventListener('keydown', onKey); board.destroy(); } };
  update();
}
