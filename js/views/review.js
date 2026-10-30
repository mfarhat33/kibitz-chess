// Game review: engine pass over every position, then labels, accuracy, graph and explanations.
import { Board } from '../board.js';
import { Chess, checkSquare, playUci, uciToMove, colorName, dests, START_FEN } from '../chessutil.js';
import { getEngine, formatScore, toWhite } from '../engine.js';
import { positions, analyzePositions, classify, phaseStats, DEPTHS, LABELS, BAD_LABELS, LABEL_TEXT, LABEL_GLYPH, winPct, labelFor } from '../analysis.js';
import { explainMove } from '../explain.js';
import { evalGraph } from '../charts.js';
import * as store from '../store.js';
import { playTabs } from './tabs.js';
import { icons, esc, toast, confirm, $, downloadFile, fmtDate, moveSound, sound } from '../ui.js';
import { loadOpenings, isBook } from '../openings-data.js';

const SHOW_IN_LIST = ['brilliant', 'great', 'best', 'book', ...BAD_LABELS];
let ctx = null;

export function unmount() { ctx?.destroy(); ctx = null; }

/** Display names for both sides; `viewer` is the user's colour, or null for someone else's game. */
export function sidesOf(game) {
  const label = game.botLabel ? ` (${game.botLabel})` : '';
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
  const user = game.userColor;
  const settings = store.getSettings();
  let cur = -1;
  let alive = true;
  let graph = null;
  let retry = null;

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

  function go(i, withSound = false) {
    if (retry) exitRetry(false);
    const moved = Math.max(-1, Math.min(game.moves.length - 1, i)) !== cur;
    cur = Math.max(-1, Math.min(game.moves.length - 1, i));
    const p = cur + 1;
    const c = new Chess(fens[p]);
    let last = null;
    if (cur >= 0) { const m = uciToMove(game.moves[cur]); last = [m.from, m.to]; }
    board.setPosition(fens[p], { lastMove: last, check: checkSquare(c) });
    board.setMovable({});
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
    if (!r) return;
    if (cur < 0) {
      el.innerHTML = `<div class="explain-head">${icons.start} Start of the game</div>
        <p class="muted small" style="margin:0">Step through the moves with the arrows, tap the graph, or jump straight to the mistakes.</p>
        <button class="btn primary" id="x-next-mistake" type="button">${icons.target} ${viewer ? 'Go to my first mistake' : 'Go to the first mistake'}</button>`;
      $('#x-next-mistake', el).addEventListener('click', nextMistake);
      return;
    }
    const ex = explainMove(cur, { fens, moves: game.moves, sans, review: r, viewer, names });
    const lab = r.labels[cur];
    const canRetry = BAD_LABELS.includes(lab) && isMine(cur) && r.best[cur];
    el.innerHTML = `
      <div class="explain-head"><i class="q q-${lab}">${LABEL_GLYPH[lab]}</i><span class="grow">${esc(ex.headline)}</span><span class="mono small muted">${formatScore(r.evals[cur + 1])}</span></div>
      <div class="explain" style="border-left-color:var(--q-${lab})">${ex.lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>
      <div class="row between tiny muted"><span>${esc(names[mover(cur)])} · move ${Math.floor((fens[cur].split(' ')[5] | 0) || 1)}</span><span>${LABEL_TEXT[lab]} · accuracy ${Math.round(r.acc[cur])}%</span></div>
      <div class="row">
        ${canRetry ? `<button class="btn small primary" id="x-retry" type="button">${icons.retry} Retry this move</button>` : ''}
        <button class="btn small" id="x-next-mistake" type="button">${icons.target} Next mistake</button>
      </div>`;
    $('#x-next-mistake', el).addEventListener('click', nextMistake);
    $('#x-retry', el)?.addEventListener('click', () => startRetry(cur));
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
        if (!res) { status('The engine is not available right now.', 'bad'); return; }
        score = toWhite(res.lines[0], after.turn());
      }
      const pov = (w) => (mover(i) === 'w' ? w : 100 - w);
      const loss = Math.max(0, pov(winPct(r.evals[i])) - pov(winPct(score)));
      label = labelFor(loss, false);
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
      <table class="counts"><thead><tr><th>White</th><th></th><th>Black</th></tr></thead><tbody>${rows}</tbody></table>
      ${phTxt ? `<div><div class="label" style="margin-bottom:6px">Your accuracy by phase</div><div class="kpis">${phTxt}</div></div>` : ''}`;
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
    const head = game.imported
      ? `${esc(names.w)} vs ${esc(names.b)} · ${esc(game.result)}`
      : `${res} as ${user === 'w' ? 'White' : 'Black'} vs ${esc(names[opp])} · ${esc(game.result)} by ${esc(game.reason)}`;
    el.innerHTML = `
      <h3 style="margin:0">Game details${game.imported ? ' <span class="tiny muted">(imported)</span>' : ''}</h3>
      <div class="small">${head}</div>
      <div class="small muted">${fmtDate(game.date)}${game.tc ? ` · ${esc(game.tc)}` : ''}${game.opening ? ` · ${esc(game.opening.eco)} ${esc(game.opening.name)}` : ''}</div>
      ${game.takebacks || game.hints ? `<div class="tiny muted">Takebacks used: ${Number(game.takebacks) || 0} · Hints used: ${Number(game.hints) || 0}</div>` : ''}
      <div class="row">
        <button class="btn small" id="i-copy" type="button">Copy PGN</button>
        <button class="btn small" id="i-dl" type="button">${icons.download} PGN</button>
        <a class="btn small" href="#/analysis/${game.startFen ? '' : game.moves.join(',')}" id="i-analyse">${icons.search} Analysis board</a>
        <button class="btn small" id="i-deep" type="button">${icons.retry} Deeper analysis</button>
        <button class="btn small danger" id="i-del" type="button">${icons.trash} Delete</button>
      </div>`;
    $('#i-copy', el).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pgnOf(game)); toast('PGN copied'); } catch { toast('Copy failed: use the download button'); }
    });
    $('#i-dl', el).addEventListener('click', () => downloadFile(`kibitz-${game.id}.pgn`, pgnOf(game), 'application/x-chess-pgn'));
    $('#i-deep', el).addEventListener('click', () => runAnalysis(DEPTHS.deep));
    $('#i-del', el).addEventListener('click', async () => {
      if (await confirm('Delete this game?', '<p class="muted">It will be removed from your history and insights.</p>', 'Delete', true)) {
        store.del('game:' + game.id);
        location.hash = '#/games';
      }
    });
  }

  async function runAnalysis(depth) {
    if (retry) exitRetry(false);
    const el = $('#explain', root);
    el.innerHTML = `
      <div class="explain-head"><span class="spinner"></span> Analysing the game</div>
      <p class="muted small" style="margin:0">Stockfish is checking every position at depth ${depth}. This runs on your device and usually takes under a minute.</p>
      <div class="progress"><i id="prog"></i></div><div class="tiny muted" id="prog-t">Starting engine…</div>`;
    const eng = getEngine('analysis');
    eng.cancel();
    const raw = await analyzePositions(eng, fens, {
      depth,
      moves: game.moves,
      isCancelled: () => !alive,
      onProgress: (d, t) => {
        if (!alive) return;
        $('#prog', root).style.width = (d / t * 100) + '%';
        $('#prog-t', root).textContent = `${d} of ${t} positions`;
      },
    });
    if (!alive) return;
    if (!raw) {
      el.innerHTML = `<div class="status bad">${icons.x} The engine stopped before the review finished. This can happen on phones that are low on memory.</div>
        <button class="btn primary" id="x-again" type="button">${icons.retry} Try again</button>`;
      $('#x-again', el).addEventListener('click', () => runAnalysis(depth));
      return;
    }
    const cls = classify(raw, game.moves, fens, isBook);
    game.review = {
      v: 2, depth, date: Date.now(),
      evals: raw.evals, best: raw.best, pv: raw.pv, second: raw.second,
      labels: cls.labels, acc: cls.acc.map(a => Math.round(a * 10) / 10), loss: cls.loss.map(a => Math.round(a * 10) / 10),
      phases: cls.phases, accuracy: cls.accuracy, counts: cls.counts,
    };
    store.set('game:' + game.id, game);
    renderAll();
  }

  function renderAll() {
    renderSummary();
    renderGraph();
    renderInfo();
    go(cur);
  }

  const onKey = (e) => {
    if (e.target.closest('input,textarea,select,dialog') || retry) return;
    if (e.key === 'ArrowLeft') { go(cur - 1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { go(cur + 1, true); e.preventDefault(); }
    else if (e.key === 'Home') { go(-1); e.preventDefault(); }
    else if (e.key === 'End') { go(game.moves.length - 1); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  $('#n-first', root).addEventListener('click', () => go(-1));
  $('#n-prev', root).addEventListener('click', () => go(cur - 1));
  $('#n-next', root).addEventListener('click', () => go(cur + 1, true));
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
  else renderAll();
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
