// Game review: engine pass over every position, then labels, accuracy, graph and explanations.
import { Board } from '../board.js';
import { Chess, checkSquare, playUci, uciToMove, colorName, dests, START_FEN } from '../chessutil.js';
import { getEngine, formatScore, toWhite } from '../engine.js';
import { positions, analyzePositions, classify, phaseStats, DEPTHS, LABELS, BAD_LABELS, LABEL_TEXT, LABEL_GLYPH, winPct, gradeMove } from '../analysis.js';
import { explainMove } from '../explain.js';
import { evalGraph } from '../charts.js';
import * as store from '../store.js';
import { playTabs, playFromPosition } from './tabs.js';
import { icons, esc, toast, confirm, $, downloadFile, fmtDate, moveSound, sound, scrollToBoard } from '../ui.js';
import { loadOpenings, isBook } from '../openings-data.js';

const SHOW_IN_LIST = ['brilliant', 'great', 'best', 'book', ...BAD_LABELS];
// bump when the label rules change: older reviews are re-labelled from their stored engine data
const REVIEW_VERSION = 3;
let ctx = null;

export function unmount() { ctx?.destroy(); ctx = null; }

/** Display names for both sides; `viewer` is the user's colour, or null for someone else's game. */
export function sidesOf(game) {
  const label = game.botLabel ? ` (${game.botLabel})` : '';
  // a game two people played on this device: no "you", just the two colours
  if (game.friend) return { names: { w: game.whiteName || 'White', b: game.blackName || 'Black' }, viewer: null };
  if (game.imported) {
    const names = { w: game.whiteName || 'White', b: game.blackName || 'Black' };
    if (game.spectator) return { names, viewer: null };
    names[game.userColor] = `You (${names[game.userColor]})`;
    return { names, viewer: game.userColor };
  }
  const opp = game.userColor === 'w' ? 'b' : 'w';
  return { names: { [game.userColor]: 'You', [opp]: `${game.botName}${label}` }, viewer: game.userColor };
}

export async function mount(root, [id], isCurrent = () => true) {
  const game = store.get('game:' + id);
  if (!game) {
    root.innerHTML = `<div class="page"><div class="card empty">That game was not found. <a href="#/games">See all games</a></div></div>`;
    return;
  }
  try { await loadOpenings(); } catch { /* book labels need the openings file; carry on without */ }
  if (!isCurrent()) return;
  const startFen = game.startFen || START_FEN;
  const fens = positions(game.moves, startFen);
  const sans = game.sans?.length ? game.sans : sansOf(game.moves, startFen);
  const { names, viewer } = sidesOf(game);
  // in sentences use plain names ("Hazel's queen", not "Hazel (1100)'s queen")
  const speakNames = { w: names.w.replace(/ \([^)]*\)$/, ''), b: names.b.replace(/ \([^)]*\)$/, '') };
  const user = game.userColor;
  const settings = store.getSettings();
  let cur = -1;
  let alive = true;
  let graph = null;
  let retry = null;
  let runId = 0;
  let analysing = false;

  root.innerHTML = `
    ${playTabs('games')}
    <div class="stage with-evalbar">
      <div class="board-col">
        <div class="evalbar-h" aria-hidden="true"><i id="ebh"></i></div>
        <div class="board-and-bar">
          <div class="evalbar-v" id="ebv" aria-hidden="true"><i></i><span></span></div>
          <div class="board-shell"><div id="board"></div></div>
        </div>
        <div class="review-nav">
          <button class="btn" id="n-first" type="button" aria-label="First move">${icons.first}</button>
          <button class="btn" id="n-prev" type="button" aria-label="Previous move">${icons.prev}</button>
          <button class="btn" id="n-next" type="button" aria-label="Next move">${icons.next}</button>
          <button class="btn" id="n-last" type="button" aria-label="Last move">${icons.last}</button>
          <button class="btn" id="n-flip" type="button" aria-label="Flip board">${icons.flip}</button>
        </div>
      </div>
      <div class="side-col">
        <section class="card stack hidden" id="progress-card" aria-live="polite"></section>
        <section class="card stack" id="explain" aria-live="polite"></section>
        <section class="card stack" id="summary"></section>
        <section class="card" id="graph-card"><div class="row between"><h3 style="margin:0">Evaluation</h3><span class="tiny muted">tap to jump</span></div><div id="graph" style="margin-top:8px"></div></section>
        <section class="card"><h3>Moves</h3><div class="moves" id="moves" style="max-height:300px"></div></section>
        <section class="card stack" id="info"></section>
      </div>
    </div>`;

  const board = new Board($('#board', root), {
    orientation: colorName(user), coordinates: settings.coords, animate: settings.animation,
  });

  const review = () => game.review;
  const mover = (i) => fens[i].split(' ')[1];
  const isMine = (i) => viewer == null || mover(i) === viewer;

  // ---------- best line: step through the engine's suggested continuation on the board ----------
  let line = null;
  function startLine(i) {
    explore = null;
    const r = review();
    const pv = r?.pv?.[i];
    if (!pv?.length) return;
    const c = new Chess(fens[i]);
    const lf = [c.fen()], ls = [], lm = [], lu = [];
    for (const u of pv) { const m = playUci(c, u); if (!m) break; lf.push(c.fen()); ls.push(m.san); lm.push([m.from, m.to]); lu.push(u); }
    if (!ls.length) return;
    line = { i, ply: 1, fens: lf, sans: ls, moves: lm, ucis: lu };
    showLine(true);
  }
  function lineStep(k) {
    if (!line) return;
    const n = Math.max(0, Math.min(line.sans.length, k));
    if (n === line.ply) return;
    const fwd = n > line.ply;
    line.ply = n;
    showLine(fwd);
  }
  function showLine(withSound = false) {
    const k = line.ply;
    const c = new Chess(line.fens[k]);
    board.setPosition(line.fens[k], { lastMove: k ? line.moves[k - 1] : null, check: checkSquare(c) });
    board.setMovable({});
    board.setArrows([]);
    board.setBadges([]);
    if (withSound && k) { const prev = new Chess(line.fens[k - 1]); moveSound(playUci(prev, line.ucis[k - 1]), prev); }
    const start = new Chess(line.fens[0]);
    const no0 = +(line.fens[0].split(' ')[5] || 1);
    const shift = start.turn() === 'b' ? 1 : 0;
    let html = shift ? `<span class="n">${no0}...</span>` : '';
    line.sans.forEach((san, j) => {
      if ((j + shift) % 2 === 0) html += `<span class="n">${no0 + (j + shift) / 2}.</span>`;
      html += `<span class="mvi${j === k - 1 ? ' cur' : ''}" data-l="${j}">${esc(san)}</span>`;
    });
    const el = $('#explain', root);
    el.innerHTML = `
      <div class="explain-head">${icons.eye}<span class="grow">${line.ucis[0] === game.moves[line.i] ? `Best continuation after ${esc(sans[line.i])}` : `Best line instead of ${esc(sans[line.i])}`}</span></div>
      <div class="moves-inline line-moves" style="flex-wrap:wrap;padding:0">${html}</div>
      <div class="row">
        <button class="btn small" id="l-prev" type="button" aria-label="Previous move in the line" ${k === 0 ? 'disabled' : ''}>${icons.prev}</button>
        <button class="btn small" id="l-next" type="button" aria-label="Next move in the line" ${k >= line.sans.length ? 'disabled' : ''}>${icons.next}</button>
        <button class="btn small" id="l-play" type="button">${icons.start} Play it out</button>
        <button class="btn small primary" id="l-back" type="button">Back to the game</button>
      </div>
      <p class="tiny muted" style="margin:0">Use the arrows (or ← → keys) to step through what Stockfish would have played.</p>`;
    $('#l-prev', el).addEventListener('click', () => lineStep(line.ply - 1));
    $('#l-next', el).addEventListener('click', () => lineStep(line.ply + 1));
    $('#l-back', el).addEventListener('click', () => go(line ? line.i : cur));
    $('#l-play', el).addEventListener('click', async () => {
      // animate the rest of the line, one move at a time
      const mine = line;
      while (line === mine && line.ply < line.sans.length) {
        lineStep(line.ply + 1);
        await new Promise(res => setTimeout(res, 650));
      }
    });
    el.querySelector('.line-moves').addEventListener('click', (e) => { const m = e.target.closest('[data-l]'); if (m) lineStep(+m.dataset.l + 1); });
  }

  // ---------- explore: drag any piece to try your own moves; Stockfish grades them and shows the best reply ----------
  let explore = null;
  const exploreCache = new Map();
  const BEST_ARROW = 'rgba(16,150,110,.85)';
  const REPLY_ARROW = 'rgba(32,120,220,.85)';

  // the board can always be moved in review (except while the engine is busy with the full analysis)
  function armBoard(fen) {
    const c = new Chess(fen);
    const canMove = review() && !analysing && !c.isGameOver();
    board.setMovable(canMove ? { color: colorName(c.turn()), dests: dests(c) } : {});
    board.opts.onMove = canMove ? (from, to, promo) => exploreMove(from, to, promo) : null;
  }

  function exploreMove(from, to, promo) {
    if (retry || !review() || analysing) return;
    line = null;
    if (!explore) {
      const p = cur + 1;
      const r = review();
      explore = { base: p, fens: [fens[p]], moves: [], sans: [], last: [], labels: [], evals: [r.evals[p]], best: [r.best[p] || null], replyLine: [r.pv?.[p] || []], k: 0, token: 0 };
    }
    const k = explore.k;
    const c = new Chess(explore.fens[k]);
    const legal = c.moves({ verbose: true }).find(m => m.from === from && m.to === to && (!m.promotion || m.promotion === (promo || 'q')));
    if (!legal) return;
    const uci = from + to + (legal.promotion || '');
    // a move from an earlier point in the line replaces everything after it
    for (const key of ['moves', 'sans', 'last', 'labels']) explore[key].length = k;
    for (const key of ['fens', 'evals', 'best', 'replyLine']) explore[key].length = k + 1;
    const m = playUci(c, uci);
    explore.moves.push(uci);
    explore.sans.push(m.san);
    explore.last.push([m.from, m.to]);
    explore.labels.push(null);
    explore.fens.push(c.fen());
    explore.evals.push(null);
    explore.best.push(null);
    explore.replyLine.push([]);
    explore.k = k + 1;
    moveSound(m, c);
    showExplore();
    gradeExplore(explore.k);
  }

  async function gradeExplore(k) {
    const ex = explore;
    const fen = ex.fens[k];
    const c = new Chess(fen);
    const moverColor = ex.fens[k - 1].split(' ')[1];
    let score, best = null, pv = [];
    if (c.isCheckmate()) score = { mate: 0, win: moverColor };
    else if (c.isGameOver()) score = { cp: 0, mate: null };
    else if (exploreCache.has(fen)) ({ score, best, pv } = exploreCache.get(fen));
    else {
      const token = ++ex.token;
      const turn = c.turn();
      const res = await getEngine('analysis').analyze(fen, {
        depth: Math.min(review()?.depth || DEPTHS.standard, 16), movetime: 2500, startFen,
        moves: [...game.moves.slice(0, ex.base), ...ex.moves.slice(0, k)],
        onInfo: (lines) => { if (alive && explore === ex && ex.k === k && token === ex.token && lines?.[0]) renderEval(toWhite(lines[0], turn)); },
      });
      if (!alive || explore !== ex) return;
      if (!res?.lines?.[0]) { if (ex.k === k) showExplore('The engine is not available right now.'); return; }
      score = toWhite(res.lines[0], turn);
      best = res.lines[0].pv?.[0] || res.bestmove || null;
      pv = (res.lines[0].pv || []).slice(0, 8);
      exploreCache.set(fen, { score, best, pv });
    }
    ex.evals[k] = score;
    ex.best[k] = best;
    ex.replyLine[k] = pv;
    // grade the move that led here against the position before it (when that one is known)
    const before = ex.evals[k - 1];
    if (before) {
      ex.labels[k - 1] = ex.moves[k - 1] === ex.best[k - 1] ? 'best'
        : gradeMove(before, score, moverColor, { givesMate: c.isCheckmate() }).label;
    }
    // the next move's grade may have been waiting for this evaluation
    if (ex.fens[k + 1] && ex.evals[k + 1] && !ex.labels[k]) {
      ex.labels[k] = ex.moves[k] === best ? 'best' : gradeMove(score, ex.evals[k + 1], c.turn(), { givesMate: new Chess(ex.fens[k + 1]).isCheckmate() }).label;
    }
    showExplore();
  }

  function exploreStep(k) {
    if (!explore) return;
    const n = Math.max(0, Math.min(explore.moves.length, k));
    if (n === explore.k) return;
    const fwd = n > explore.k;
    explore.k = n;
    if (fwd) { const prev = new Chess(explore.fens[n - 1]); moveSound(playUci(prev, explore.moves[n - 1]), prev); }
    showExplore();
    if (!explore.evals[n] && n > 0) gradeExplore(n);
  }

  function showExplore(err = '') {
    const ex = explore;
    const k = ex.k;
    const fen = ex.fens[k];
    const c = new Chess(fen);
    const baseLast = ex.base > 0 ? (() => { const m = uciToMove(game.moves[ex.base - 1]); return [m.from, m.to]; })() : null;
    board.setPosition(fen, { lastMove: k ? ex.last[k - 1] : baseLast, check: checkSquare(c) });
    armBoard(fen);
    const arrows = [], badges = [];
    const lab = k ? ex.labels[k - 1] : null;
    if (k && lab) badges.push({ sq: ex.last[k - 1][1], cls: lab, text: LABEL_GLYPH[lab] });
    // what the engine would play now (the reply to your move), and what you should have played instead
    if (ex.best[k] && !c.isGameOver()) { const b = uciToMove(ex.best[k]); arrows.push({ from: b.from, to: b.to, color: REPLY_ARROW }); }
    if (k && lab && ex.best[k - 1] && ex.best[k - 1] !== ex.moves[k - 1] && BAD_LABELS.includes(lab)) {
      const b = uciToMove(ex.best[k - 1]);
      arrows.push({ from: b.from, to: b.to, color: BEST_ARROW });
    }
    board.setArrows(arrows);
    board.setBadges(badges);
    if (ex.evals[k]) renderEval(ex.evals[k]);
    // panel
    const start = new Chess(ex.fens[0]);
    const no0 = +(ex.fens[0].split(' ')[5] || 1);
    const shift = start.turn() === 'b' ? 1 : 0;
    let html = shift ? `<span class="n">${no0}...</span>` : '';
    ex.sans.forEach((san, j) => {
      if ((j + shift) % 2 === 0) html += `<span class="n">${no0 + (j + shift) / 2}.</span>`;
      const l = ex.labels[j];
      html += `<span class="mvi${j === k - 1 ? ' cur' : ''}" data-x="${j}">${l ? `<i class="q q-${l}" style="width:15px;height:15px;font-size:9px;vertical-align:-2px;margin-right:3px">${LABEL_GLYPH[l]}</i>` : ''}${esc(san)}</span>`;
    });
    const sc = ex.evals[k];
    const toMove = c.turn() === 'w' ? 'White' : 'Black';
    let verdict = '';
    if (err) verdict = `<div class="status bad small">${esc(err)}</div>`;
    else if (k === 0) verdict = `<p class="small" style="margin:0">Drag or tap a piece to try a move. Stockfish rates it and shows the best reply with a blue arrow.</p>`;
    else if (!lab) verdict = `<div class="status info small"><span class="spinner"></span> Checking ${esc(ex.sans[k - 1])} with Stockfish…</div>`;
    else {
      const bestSan = ex.best[k - 1] && ex.best[k - 1] !== ex.moves[k - 1] ? sanOf(ex.fens[k - 1], ex.best[k - 1]) : null;
      const word = LABEL_TEXT[lab].toLowerCase();
      const phrase = BAD_LABELS.includes(lab) || /move$/.test(word) ? word : `${word} move`;
      verdict = `<p class="small" style="margin:0"><b>${esc(ex.sans[k - 1])}</b> is ${/^[aeiou]/i.test(phrase) ? 'an' : 'a'} <span class="tq-${lab}" style="font-weight:700">${phrase}</span>${bestSan && BAD_LABELS.includes(lab) ? `. Better was <b>${esc(bestSan)}</b> (green arrow)` : ''}.</p>`;
    }
    let reply = '';
    if (c.isCheckmate()) reply = `<p class="small" style="margin:0"><b>Checkmate.</b></p>`;
    else if (c.isGameOver()) reply = `<p class="small" style="margin:0"><b>The game would end in a draw here.</b></p>`;
    else if (ex.best[k]) {
      const pvTxt = lineSans(fen, ex.replyLine[k].slice(0, 6));
      reply = `<p class="small" style="margin:0">Best for ${toMove} now: <b>${esc(sanOf(fen, ex.best[k]))}</b> (blue arrow)${pvTxt ? `, for example <span class="mono">${esc(pvTxt)}</span>` : ''}.</p>`;
    }
    const el = $('#explain', root);
    el.innerHTML = `
      <div class="explain-head">${icons.search}<span class="grow">Exploring your own line</span>${sc ? `<span class="mono small muted">${formatScore(sc)}</span>` : ''}</div>
      ${ex.sans.length ? `<div class="moves-inline line-moves" style="flex-wrap:wrap;padding:0">${html}</div>` : ''}
      ${verdict}
      ${reply}
      <div class="row">
        <button class="btn small" id="e-prev" type="button" aria-label="Back one move in your line" ${k === 0 ? 'disabled' : ''}>${icons.prev}</button>
        <button class="btn small" id="e-next" type="button" aria-label="Forward one move in your line" ${k >= ex.moves.length ? 'disabled' : ''}>${icons.next}</button>
        ${ex.best[k] && !c.isGameOver() ? `<button class="btn small" id="e-play" type="button">${icons.start} Play best</button>` : ''}
        <button class="btn small primary" id="e-back" type="button">Back to the game</button>
      </div>`;
    $('#e-prev', el).addEventListener('click', () => exploreStep(ex.k - 1));
    $('#e-next', el).addEventListener('click', () => exploreStep(ex.k + 1));
    $('#e-back', el).addEventListener('click', () => go(cur));
    $('#e-play', el)?.addEventListener('click', () => { const b = uciToMove(ex.best[ex.k]); exploreMove(b.from, b.to, b.promotion); });
    el.querySelector('.line-moves')?.addEventListener('click', (e) => { const m = e.target.closest('[data-x]'); if (m) exploreStep(+m.dataset.x + 1); });
  }

  function sanOf(fen, uci) {
    try { const c = new Chess(fen); return playUci(c, uci)?.san || uci; } catch { return uci; }
  }
  function lineSans(fen, ucis) {
    const c = new Chess(fen);
    const turn = c.turn();
    let no = +(fen.split(' ')[5] || 1);
    const out = [];
    ucis.forEach((u, j) => {
      const m = playUci(c, u);
      if (!m) return;
      const white = (j % 2 === 0) === (turn === 'w');
      if (white) out.push(`${no}.`);
      else if (j === 0) out.push(`${no}...`);
      out.push(m.san);
      if (!white) no++;
    });
    return out.join(' ');
  }

  function go(i, withSound = false) {
    line = null;
    explore = null;
    if (retry) exitRetry(false);
    const moved = Math.max(-1, Math.min(game.moves.length - 1, i)) !== cur;
    cur = Math.max(-1, Math.min(game.moves.length - 1, i));
    const p = cur + 1;
    const c = new Chess(fens[p]);
    let last = null;
    if (cur >= 0) { const m = uciToMove(game.moves[cur]); last = [m.from, m.to]; }
    board.setPosition(fens[p], { lastMove: last, check: checkSquare(c) });
    armBoard(fens[p]);
    if (withSound && moved && cur >= 0) {
      const prev = new Chess(fens[cur]);
      moveSound(playUci(prev, game.moves[cur]), prev);
    }
    const r = review();
    const arrows = [], badges = [];
    if (r && cur >= 0) {
      const lab = r.labels[cur];
      badges.push({ sq: last[1], cls: lab, text: LABEL_GLYPH[lab] });
      if (r.best[cur] && r.best[cur] !== game.moves[cur] && !['best', 'book', 'great', 'brilliant'].includes(lab)) {
        const b = uciToMove(r.best[cur]);
        arrows.push({ from: b.from, to: b.to, color: 'rgba(16,150,110,.85)' });
      }
    }
    board.setArrows(arrows);
    board.setBadges(badges);
    renderEval();
    renderExplain();
    renderMoves();
    graph?.setCur(p);
  }

  function renderEval(score) {
    const r = review();
    const p = cur + 1;
    const sc = score || (r ? r.evals[p] : null);
    const w = sc ? winPct(sc) : 50;
    $('#ebh', root).style.width = w + '%';
    const v = $('#ebv', root);
    const flipped = board.orientation === 'black';
    v.classList.toggle('flipped', flipped);
    v.querySelector('i').style.height = w + '%';
    const span = v.querySelector('span');
    span.textContent = sc ? formatScore(sc).replace('+', '') : '';
    const whiteAhead = w >= 50;
    // label sits on the side that is ahead, in the contrasting ink
    span.style.top = (whiteAhead !== flipped) ? 'auto' : '4px';
    span.style.bottom = (whiteAhead !== flipped) ? '4px' : 'auto';
    span.style.color = whiteAhead ? 'var(--eval-black)' : 'var(--eval-white)';
  }

  function renderExplain() {
    const el = $('#explain', root);
    const r = review();
    if (!r) { el.innerHTML = '<p class="muted small" style="margin:0">Move-by-move feedback appears here when the analysis finishes. You can step through the game meanwhile.</p>'; return; }
    if (cur < 0) {
      el.innerHTML = `<div class="explain-head">${icons.start} Start of the game</div>
        <p class="muted small" style="margin:0">Step through the moves with the arrows, tap the graph, or jump straight to the mistakes.</p>
        <button class="btn primary" id="x-next-mistake" type="button">${icons.target} ${viewer ? 'Go to my first mistake' : 'Go to the first mistake'}</button>`;
      $('#x-next-mistake', el).addEventListener('click', nextMistake);
      return;
    }
    const ex = explainMove(cur, { fens, moves: game.moves, sans, review: r, viewer, names: speakNames });
    const lab = r.labels[cur];
    const canRetry = BAD_LABELS.includes(lab) && isMine(cur) && r.best[cur];
    el.innerHTML = `
      <div class="explain-head"><i class="q q-${lab}">${LABEL_GLYPH[lab]}</i><span class="grow">${esc(ex.headline)}</span><span class="mono small muted">${formatScore(r.evals[cur + 1])}</span></div>
      <div class="explain" style="border-left-color:var(--q-${lab})">${ex.lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>
      <div class="row between tiny muted"><span>${esc(names[mover(cur)])} · move ${Math.floor((fens[cur].split(' ')[5] | 0) || 1)}</span><span>${LABEL_TEXT[lab]} · accuracy ${Math.round(r.acc[cur])}%</span></div>
      <div class="row">
        ${canRetry ? `<button class="btn small primary" id="x-retry" type="button">${icons.retry} Retry this move</button>` : ''}
        ${r.pv?.[cur]?.length && !['book', 'forced'].includes(lab) ? `<button class="btn small" id="x-line" type="button">${icons.eye} Show best line</button>` : ''}
        <button class="btn small" id="x-next-mistake" type="button">${icons.target} Next mistake</button>
      </div>`;
    $('#x-line', el)?.addEventListener('click', () => { if (!analysing) startLine(cur); });
    $('#x-next-mistake', el).addEventListener('click', nextMistake);
    $('#x-retry', el)?.addEventListener('click', () => { if (!analysing) startRetry(cur); });
    if (analysing) setBusy(true);
  }

  // ---------- retry: replay your mistake and let Stockfish grade the new move ----------
  function startRetry(i) {
    const r = review();
    retry = { i, tries: 0, token: 0 };
    const c = new Chess(fens[i]);
    let last = null;
    if (i > 0) { const m = uciToMove(game.moves[i - 1]); last = [m.from, m.to]; }
    board.setPosition(fens[i], { lastMove: last, check: checkSquare(c) });
    board.setArrows([]);
    board.setBadges([]);
    board.setMovable({ color: colorName(mover(i)), dests: dests(c) });
    renderEval(r.evals[i]);
    const el = $('#explain', root);
    el.innerHTML = `
      <div class="explain-head">${icons.retry} Retry move ${Math.floor((fens[i].split(' ')[5] | 0) || 1)}</div>
      <p class="small" style="margin:0">In the game you played <b>${esc(sans[i])}</b> (${LABEL_TEXT[r.labels[i]].toLowerCase()}). Find something better for ${mover(i) === 'w' ? 'White' : 'Black'}.</p>
      <div class="status info" id="x-status">Your move</div>
      <div class="row"><button class="btn small" id="x-show" type="button">${icons.eye} Show best</button><button class="btn small" id="x-back" type="button">${icons.prev} Back to review</button></div>`;
    $('#x-show', el).addEventListener('click', () => {
      const b = uciToMove(r.best[i]);
      board.setArrows([{ from: b.from, to: b.to, color: 'rgba(16,150,110,.85)' }]);
    });
    $('#x-back', el).addEventListener('click', () => exitRetry(true));
    board.opts.onMove = (from, to, promo) => retryMove(from, to, promo);
    scrollToBoard(root);
  }

  async function retryMove(from, to, promo) {
    if (!retry) return;
    const i = retry.i;
    const r = review();
    const c = new Chess(fens[i]);
    const legal = c.moves({ verbose: true }).find(m => m.from === from && m.to === to && (!m.promotion || m.promotion === (promo || 'q')));
    if (!legal) return;
    const uci = from + to + (legal.promotion || '');
    const status = (html, cls) => { const s = $('#x-status', root); if (s) { s.className = 'status ' + cls; s.innerHTML = html; } };
    const after = new Chess(fens[i]);
    const m = playUci(after, uci);
    board.setPosition(after.fen(), { lastMove: [m.from, m.to], check: checkSquare(after) });
    board.setMovable({});
    moveSound(m, after);
    let label;
    if (uci === r.best[i]) label = 'best';
    else if (uci === game.moves[i]) label = r.labels[i];
    else {
      status('<span class="spinner"></span> Checking with Stockfish…', 'info');
      const token = ++retry.token;
      let score;
      if (after.isCheckmate()) score = { mate: 0, win: mover(i) };
      else if (after.isGameOver()) score = { cp: 0 };
      else {
        const res = await getEngine('analysis').analyze(after.fen(), {
          depth: r.depth || DEPTHS.standard, movetime: 4000, startFen, moves: [...game.moves.slice(0, i), uci],
        });
        if (!retry || token !== retry.token || !alive) return;
        if (!res?.lines[0]) {
          status('The engine is not available right now. Try again in a moment.', 'bad');
          const c2 = new Chess(fens[i]);
          board.setPosition(fens[i], { lastMove: null, check: checkSquare(c2) });
          board.setMovable({ color: colorName(mover(i)), dests: dests(c2) });
          return;
        }
        score = toWhite(res.lines[0], after.turn());
      }
      label = gradeMove(r.evals[i], score, mover(i), { givesMate: after.isCheckmate() }).label;
      renderEval(score);
    }
    const good = !BAD_LABELS.includes(label);
    sound(good ? 'good' : 'bad');
    board.setBadges([{ sq: m.to, cls: label, text: LABEL_GLYPH[label] }]);
    status(good ? `${icons.check} ${esc(m.san)}: ${LABEL_TEXT[label].toLowerCase()}! That fixes it.` : `${esc(m.san)} is ${label === 'inaccuracy' ? 'an' : 'a'} ${LABEL_TEXT[label].toLowerCase()} too. Try again.`, good ? 'ok' : 'bad');
    if (!good) {
      setTimeout(() => {
        if (!retry || retry.i !== i) return;
        const c2 = new Chess(fens[i]);
        board.setPosition(fens[i], { lastMove: null, check: checkSquare(c2) });
        board.setBadges([]);
        board.setMovable({ color: colorName(mover(i)), dests: dests(c2) });
      }, 1100);
    }
  }

  function exitRetry(render) {
    retry = null;
    board.opts.onMove = null;
    if (render) go(cur);
  }

  function nextMistake() {
    const r = review();
    if (!r) return;
    const n = game.moves.length;
    for (let k = 1; k <= n; k++) {
      const i = (cur + k + n) % n;
      if (isMine(i) && BAD_LABELS.includes(r.labels[i])) {
        if (i <= cur) toast('Back to the first mistake');
        go(i);
        return;
      }
    }
    toast('No inaccuracies, misses, mistakes or blunders. Clean game!');
  }

  function renderMoves() {
    const r = review();
    const first = mover(0) === 'b' ? 1 : 0;
    const startNo = +(fens[0].split(' ')[5] || 1);
    let html = first ? `<span class="num">${startNo}.</span><span class="mv muted">…</span>` : '';
    sans.forEach((s, i) => {
      const p = i + first;
      if (p % 2 === 0) html += `<span class="num">${startNo + p / 2}.</span>`;
      const lab = r?.labels[i];
      const show = lab && SHOW_IN_LIST.includes(lab);
      html += `<span class="mv${i === cur ? ' cur' : ''}" data-i="${i}">${esc(s)}${show ? `<i class="q q-${lab}" title="${LABEL_TEXT[lab]}">${LABEL_GLYPH[lab]}</i>` : ''}</span>`;
    });
    const el = $('#moves', root);
    el.innerHTML = html;
    const curEl = el.querySelector('.mv.cur');
    if (curEl) {
      const top = curEl.offsetTop - el.offsetTop;
      if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 30) el.scrollTop = top - el.clientHeight / 2;
    }
  }

  function renderSummary() {
    const r = review();
    const el = $('#summary', root);
    if (!r) return;
    const acc = (c) => r.accuracy[c] == null ? '—' : Number(r.accuracy[c]).toFixed(1);
    const count = (c, l) => Number(r.counts[c]?.[l] || 0);
    const rows = LABELS.map(l => `<tr><td class="n">${count('w', l)}</td><td><span class="row nowrap" style="gap:8px"><i class="q q-${l}">${LABEL_GLYPH[l]}</i>${LABEL_TEXT[l]}</span></td><td class="n">${count('b', l)}</td></tr>`).join('');
    let phTxt = '';
    if (viewer) {
      const ph = phaseStats(r, fens, viewer);
      phTxt = ['opening', 'middlegame', 'endgame'].filter(k => ph[k].moves).map(k =>
        `<div class="kpi"><div class="stat-label">${k[0].toUpperCase() + k.slice(1)}</div><div style="font-weight:800;font-size:1.2rem">${Math.round(ph[k].accSum / ph[k].moves)}%</div><div class="tiny muted">${ph[k].blunders} blunder${ph[k].blunders === 1 ? '' : 's'}, ${ph[k].mistakes} mistake${ph[k].mistakes === 1 ? '' : 's'}</div></div>`).join('');
    }
    el.innerHTML = `
      <div class="row between"><h3 style="margin:0">Accuracy</h3><span class="tiny muted">Stockfish depth ${Number(r.depth) || ''}</span></div>
      <div class="acc-pair">
        <div class="acc-box${viewer === 'w' ? ' me' : ''}"><div class="stat-label">White · ${esc(names.w)}</div><div class="stat-big">${acc('w')}</div></div>
        <div class="acc-box${viewer === 'b' ? ' me' : ''}"><div class="stat-label">Black · ${esc(names.b)}</div><div class="stat-big">${acc('b')}</div></div>
      </div>
      ${ratingRow(r)}
      <table class="counts"><thead><tr><th>White</th><th></th><th>Black</th></tr></thead><tbody>${rows}</tbody></table>
      ${phTxt ? `<div><div class="label" style="margin-bottom:6px">Your accuracy by phase</div><div class="kpis">${phTxt}</div></div>` : ''}`;
  }

  // a rough "played like" rating from each side's accuracy (needs a game of some length to mean anything)
  function ratingRow(r) {
    const perSide = (c) => {
      const n = r.labels.filter((_, i) => mover(i) === c).length;
      return n >= 10 && typeof r.accuracy[c] === 'number' ? ratingFromAccuracy(r.accuracy[c]) : null;
    };
    const w = perSide('w'), b = perSide('b');
    if (w == null && b == null) return '';
    return `<div class="acc-pair game-rating">
        <div class="acc-box${viewer === 'w' ? ' me' : ''}"><div class="stat-label">Played like</div><div style="font-weight:800;font-size:1.25rem">${w == null ? '—' : '≈ ' + w}</div></div>
        <div class="acc-box${viewer === 'b' ? ' me' : ''}"><div class="stat-label">Played like</div><div style="font-weight:800;font-size:1.25rem">${b == null ? '—' : '≈ ' + b}</div></div>
      </div>
      <p class="tiny muted" style="margin:-4px 0 0">A rough estimate of the rating that plays with this accuracy. One game can swing a lot.</p>`;
  }

  function renderGraph() {
    const r = review();
    if (!r) return;
    const marks = r.labels.map((l, i) => ({ ply: i + 1, cls: l })).filter(m => ['miss', 'mistake', 'blunder', 'brilliant', 'great'].includes(m.cls));
    graph = evalGraph($('#graph', root), r.evals.map(winPct), { cur: cur + 1, marks, onPick: (p) => go(p - 1) });
  }

  function renderInfo() {
    const el = $('#info', root);
    const res = { win: 'Won', loss: 'Lost', draw: 'Drew' }[game.userResult];
    const opp = user === 'w' ? 'b' : 'w';
    const head = game.imported || game.friend || !res
      ? `${esc(names.w)} vs ${esc(names.b)} · ${esc(game.result)}${game.reason && !game.imported ? ` by ${esc(game.reason)}` : ''}`
      : `${res} as ${user === 'w' ? 'White' : 'Black'} vs ${esc(names[opp])} · ${esc(game.result)} by ${esc(game.reason)}`;
    el.innerHTML = `
      <h3 style="margin:0">Game details${game.imported ? ' <span class="tiny muted">(imported)</span>' : ''}</h3>
      <div class="small">${head}</div>
      <div class="small muted">${fmtDate(game.date)}${game.tc ? ` · ${esc(game.tc)}` : ''}${game.opening ? ` · ${esc(game.opening.eco)} ${esc(game.opening.name)}` : ''}</div>
      ${game.takebacks || game.hints ? `<div class="tiny muted">Takebacks used: ${Number(game.takebacks) || 0} · Hints used: ${Number(game.hints) || 0}</div>` : ''}
      <div class="row">
        <button class="btn small" id="i-copy" type="button">Copy PGN</button>
        <button class="btn small" id="i-dl" type="button">${icons.download} PGN</button>
        <button class="btn small" type="button" id="i-analyse">${icons.search} Analysis board</button>
        <button class="btn small" type="button" id="i-play">${icons.start} Play from this position</button>
        <button class="btn small" id="i-deep" type="button">${icons.retry} Deeper analysis</button>
        <button class="btn small danger" id="i-del" type="button">${icons.trash} Delete</button>
      </div>`;
    $('#i-copy', el).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pgnOf(game)); toast('PGN copied'); } catch { toast('Copy failed: use the download button'); }
    });
    $('#i-dl', el).addEventListener('click', () => downloadFile(`kibitz-${game.id}.pgn`, pgnOf(game), 'application/x-chess-pgn'));
    $('#i-deep', el).addEventListener('click', () => { if (!analysing) runAnalysis(DEPTHS.deep); });
    $('#i-play', el).addEventListener('click', async () => {
      if ((await playFromPosition(fens[cur + 1])) === 'over') toast('The game is over in this position');
    });
    $('#i-analyse', el).addEventListener('click', () => {
      const result = game.result && game.result !== '*' ? game.result : undefined;
      const white = game.imported ? game.whiteName : names.w, black = game.imported ? game.blackName : names.b;
      store.set('analysis.board', { startFen, line: game.moves.slice(), ply: cur + 1, headers: { White: white, Black: black, Result: result }, orientation: colorName(user) });
      location.hash = '#/analysis';
    });
    $('#i-del', el).addEventListener('click', async () => {
      if (await confirm('Delete this game?', '<p class="muted">It will be removed from your history and insights.</p>', 'Delete', true)) {
        store.del('game:' + game.id);
        location.hash = '#/games';
      }
    });
  }

  async function runAnalysis(depth) {
    if (retry) exitRetry(false);
    const run = ++runId;
    analysing = true;
    setBusy(true);
    // progress gets its own panel so stepping through moves meanwhile does not remove it
    const el = $('#progress-card', root);
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="explain-head"><span class="spinner"></span> Analysing the game</div>
      <p class="muted small" style="margin:0">Stockfish is checking every position at depth ${depth}. This runs on your device and usually takes under a minute.</p>
      <div class="progress"><i id="prog"></i></div><div class="tiny muted" id="prog-t">Starting engine…</div>`;
    const eng = getEngine('analysis');
    eng.cancel();
    const raw = await analyzePositions(eng, fens, {
      depth,
      moves: game.moves,
      isCancelled: () => !alive || run !== runId,
      onProgress: (d, t) => {
        if (!alive || run !== runId) return;
        const bar = $('#prog', root), txt = $('#prog-t', root);
        if (bar) bar.style.width = (d / t * 100) + '%';
        if (txt) txt.textContent = `${d} of ${t} positions`;
      },
    });
    if (!alive || run !== runId) return; // superseded by a newer run
    analysing = false;
    setBusy(false);
    if (!raw) {
      el.innerHTML = eng.failed
        ? `<div class="status bad">${icons.x} The chess engine could not be restarted on this device. Reload the page to try again.</div>`
        : `<div class="status bad">${icons.x} The engine stopped before the review finished. This can happen on phones that are low on memory.</div>
        <button class="btn primary" id="x-again" type="button">${icons.retry} Try again</button>`;
      $('#x-again', el)?.addEventListener('click', () => runAnalysis(depth));
      return;
    }
    el.classList.add('hidden');
    const cls = classify(raw, game.moves, fens, isBook);
    game.review = {
      v: REVIEW_VERSION, depth, date: Date.now(),
      evals: raw.evals, best: raw.best, pv: raw.pv, second: raw.second,
      labels: cls.labels, acc: cls.acc.map(a => Math.round(a * 10) / 10), loss: cls.loss.map(a => Math.round(a * 10) / 10),
      phases: cls.phases, accuracy: cls.accuracy, counts: cls.counts,
    };
    store.set('game:' + game.id, game);
    renderAll();
  }

  function setBusy(on) {
    for (const id of ['#i-deep', '#x-retry']) { const b = $(id, root); if (b) b.disabled = on; }
  }

  function renderAll() {
    renderSummary();
    renderGraph();
    renderInfo();
    go(cur);
  }

  const onKey = (e) => {
    if (e.target.closest('input,textarea,select,dialog') || retry) return;
    if (line && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { lineStep(line.ply + (e.key === 'ArrowRight' ? 1 : -1)); e.preventDefault(); return; }
    if (explore && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      if (e.key === 'ArrowLeft' && explore.k === 0) go(cur); else exploreStep(explore.k + (e.key === 'ArrowRight' ? 1 : -1));
      e.preventDefault(); return;
    }
    if (e.key === 'ArrowLeft') { go(cur - 1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { go(cur + 1, true); e.preventDefault(); }
    else if (e.key === 'Home') { go(-1); e.preventDefault(); }
    else if (e.key === 'End') { go(game.moves.length - 1); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  $('#n-first', root).addEventListener('click', () => go(-1));
  $('#n-prev', root).addEventListener('click', () => { if (explore) { if (explore.k === 0) go(cur); else exploreStep(explore.k - 1); } else go(cur - 1); });
  $('#n-next', root).addEventListener('click', () => { if (explore) exploreStep(explore.k + 1); else go(cur + 1, true); });
  $('#n-last', root).addEventListener('click', () => go(game.moves.length - 1));
  $('#n-flip', root).addEventListener('click', () => { board.flip(); renderEval(); });
  $('#moves', root).addEventListener('click', (e) => { const m = e.target.closest('.mv[data-i]'); if (m) go(+m.dataset.i); });

  ctx = {
    destroy() {
      alive = false;
      retry = null;
      document.removeEventListener('keydown', onKey);
      getEngine('analysis').cancel();
      board.destroy();
    },
  };

  renderInfo();
  go(-1);
  // reviews made before the second-best line was stored are redone so new labels can appear
  if (!game.review || !game.review.second) await runAnalysis(DEPTHS[settings.reviewDepth] || DEPTHS.standard);
  else {
    if ((game.review.v || 0) < REVIEW_VERSION) {
      const r = game.review;
      const cls = classify({ evals: r.evals, best: r.best, pv: r.pv, second: r.second }, game.moves, fens, isBook);
      game.review = { ...r, v: REVIEW_VERSION, labels: cls.labels, acc: cls.acc.map(a => Math.round(a * 10) / 10), loss: cls.loss.map(a => Math.round(a * 10) / 10), phases: cls.phases, accuracy: cls.accuracy, counts: cls.counts };
      store.set('game:' + game.id, game);
    }
    renderAll();
  }
}

/** Rough rating for a game accuracy (Lichess-style accuracy), rounded to 50. */
export function ratingFromAccuracy(acc) {
  const T = [[0, 250], [40, 400], [55, 700], [65, 1000], [72, 1250], [78, 1500], [83, 1750], [87, 2000], [91, 2300], [94, 2600], [97, 2900], [100, 3200]];
  const a = Math.max(0, Math.min(100, acc));
  for (let i = 1; i < T.length; i++) {
    if (a <= T[i][0]) {
      const [x0, y0] = T[i - 1], [x1, y1] = T[i];
      return Math.round((y0 + (y1 - y0) * (a - x0) / (x1 - x0)) / 50) * 50;
    }
  }
  return 3200;
}

function sansOf(moves, startFen = START_FEN) {
  const c = new Chess(startFen);
  const out = [];
  for (const u of moves) { const m = playUci(c, u); if (!m) break; out.push(m.san); }
  return out;
}

export function pgnOf(game) {
  const c = new Chess(game.startFen || START_FEN);
  for (const u of game.moves) if (!playUci(c, u)) break;
  const d = new Date(game.date);
  const { names } = sidesOf(game);
  c.setHeader('Event', game.imported ? 'Imported game' : 'Kibitz Chess training game');
  c.setHeader('Site', 'Kibitz Chess');
  c.setHeader('Date', `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`);
  c.setHeader('White', game.imported ? (game.whiteName || 'White') : names.w);
  c.setHeader('Black', game.imported ? (game.blackName || 'Black') : names.b);
  c.setHeader('Result', game.result);
  if (game.reason) c.setHeader('Termination', game.reason);
  if (game.startFen) { c.setHeader('SetUp', '1'); c.setHeader('FEN', game.startFen); }
  if (game.tc) c.setHeader('TimeControl', game.tc);
  if (game.opening) { c.setHeader('ECO', game.opening.eco); c.setHeader('Opening', game.opening.name); }
  return c.pgn();
}
