// Game review: engine pass over every position, then labels, accuracy, graph and explanations.
import { Board } from '../board.js';
import { Chess, checkSquare, playUci, uciToMove, colorName } from '../chessutil.js';
import { getEngine, formatScore } from '../engine.js';
import { positions, analyzePositions, classify, phaseStats, DEPTHS, LABELS, LABEL_TEXT, LABEL_GLYPH, winPct } from '../analysis.js';
import { explainMove } from '../explain.js';
import { evalGraph } from '../charts.js';
import * as store from '../store.js';
import { icons, esc, toast, confirm, $, downloadFile, fmtDate, moveSound } from '../ui.js';
import { loadOpenings, isBook } from '../openings-data.js';

const BAD = ['inaccuracy', 'mistake', 'blunder'];
let ctx = null;

export function unmount() { ctx?.destroy(); ctx = null; }

export async function mount(root, [id]) {
  const game = store.get('game:' + id);
  if (!game) {
    root.innerHTML = `<div class="page"><div class="card empty">That game was not found. <a href="#/games">See all games</a></div></div>`;
    return;
  }
  try { await loadOpenings(); } catch { /* book labels need the openings file; carry on without */ }
  const fens = positions(game.moves);
  const sans = game.sans?.length ? game.sans : sansOf(game.moves);
  const user = game.userColor;
  const names = { [user]: 'You', [user === 'w' ? 'b' : 'w']: `${game.botName} (${game.botLabel || game.botElo})` };
  const settings = store.getSettings();
  let cur = -1;
  let alive = true;
  let graph = null;

  root.innerHTML = `
    <nav class="subtabs"><a href="#/play">New game</a><a href="#/games" class="active">My games</a></nav>
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
  const wins = () => review() ? review().evals.map(winPct) : null;

  function go(i, sound = false) {
    cur = Math.max(-1, Math.min(game.moves.length - 1, i));
    const p = cur + 1;
    const c = new Chess(fens[p]);
    let last = null;
    if (cur >= 0) { const m = uciToMove(game.moves[cur]); last = [m.from, m.to]; }
    board.setPosition(fens[p], { lastMove: last, check: checkSquare(c) });
    if (sound && cur >= 0) {
      const prev = new Chess(fens[cur]);
      moveSound(playUci(prev, game.moves[cur]), prev);
    }
    const r = review();
    const arrows = [], badges = [];
    if (r && cur >= 0) {
      const lab = r.labels[cur];
      badges.push({ sq: last[1], cls: lab, text: LABEL_GLYPH[lab] });
      if (r.best[cur] && r.best[cur] !== game.moves[cur] && !['best', 'book'].includes(lab)) {
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

  function renderEval() {
    const r = review();
    const p = cur + 1;
    const w = r ? winPct(r.evals[p]) : 50;
    const ebh = $('#ebh', root);
    ebh.style.width = w + '%';
    const v = $('#ebv', root);
    const flipped = board.orientation === 'black';
    v.classList.toggle('flipped', flipped);
    v.querySelector('i').style.height = w + '%';
    const span = v.querySelector('span');
    span.textContent = r ? formatScore(r.evals[p]).replace('+', '') : '';
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
        <p class="muted small" style="margin:0">Step through the moves with the arrows, tap the graph, or jump straight to your mistakes.</p>
        <button class="btn primary" id="x-next-mistake" type="button">${icons.target} Go to my first mistake</button>`;
      $('#x-next-mistake', el).addEventListener('click', nextMistake);
      return;
    }
    const ex = explainMove(cur, { fens, moves: game.moves, sans, review: r });
    const lab = r.labels[cur];
    const mover = fens[cur].split(' ')[1];
    el.innerHTML = `
      <div class="explain-head"><i class="q q-${lab}">${LABEL_GLYPH[lab]}</i><span class="grow">${esc(ex.headline)}</span><span class="mono small muted">${formatScore(r.evals[cur + 1])}</span></div>
      <div class="explain" style="border-left-color:var(--q-${lab})">${ex.lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>
      <div class="row between tiny muted"><span>${mover === user ? 'Your move' : esc(names[mover])} · move ${Math.floor(cur / 2) + 1}</span><span>${LABEL_TEXT[lab]} · accuracy ${Math.round(r.acc[cur])}%</span></div>
      <button class="btn small" id="x-next-mistake" type="button">${icons.target} Next mistake</button>`;
    $('#x-next-mistake', el).addEventListener('click', nextMistake);
  }

  function nextMistake() {
    const r = review();
    if (!r) return;
    const n = game.moves.length;
    for (let k = 1; k <= n; k++) {
      const i = (cur + k + n) % n;
      if (fens[i].split(' ')[1] === user && BAD.includes(r.labels[i])) {
        if (i <= cur) toast('Back to your first mistake');
        go(i);
        return;
      }
    }
    toast('No inaccuracies, mistakes or blunders. Clean game!');
  }

  function renderMoves() {
    const r = review();
    let html = '';
    sans.forEach((s, i) => {
      if (i % 2 === 0) html += `<span class="num">${i / 2 + 1}.</span>`;
      const lab = r?.labels[i];
      const show = lab && (BAD.includes(lab) || lab === 'best' || lab === 'book');
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
    const acc = (c) => r.accuracy[c] == null ? '—' : r.accuracy[c].toFixed(1);
    const rows = LABELS.map(l => `<tr><td class="n">${r.counts.w[l]}</td><td><span class="row nowrap" style="gap:8px"><i class="q q-${l}">${LABEL_GLYPH[l]}</i>${LABEL_TEXT[l]}</span></td><td class="n">${r.counts.b[l]}</td></tr>`).join('');
    const ph = phaseStats(r, fens, user);
    const phTxt = ['opening', 'middlegame', 'endgame'].filter(k => ph[k].moves).map(k =>
      `<div class="kpi"><div class="stat-label">${k[0].toUpperCase() + k.slice(1)}</div><div style="font-weight:800;font-size:1.2rem">${Math.round(ph[k].accSum / ph[k].moves)}%</div><div class="tiny muted">${ph[k].blunders} blunder${ph[k].blunders === 1 ? '' : 's'}, ${ph[k].mistakes} mistake${ph[k].mistakes === 1 ? '' : 's'}</div></div>`).join('');
    el.innerHTML = `
      <div class="row between"><h3 style="margin:0">Accuracy</h3><span class="tiny muted">Stockfish depth ${r.depth}</span></div>
      <div class="acc-pair">
        <div class="acc-box${user === 'w' ? ' me' : ''}"><div class="stat-label">White · ${esc(names.w)}</div><div class="stat-big">${acc('w')}</div></div>
        <div class="acc-box${user === 'b' ? ' me' : ''}"><div class="stat-label">Black · ${esc(names.b)}</div><div class="stat-big">${acc('b')}</div></div>
      </div>
      <table class="counts"><thead><tr><th>White</th><th></th><th>Black</th></tr></thead><tbody>${rows}</tbody></table>
      ${phTxt ? `<div><div class="label" style="margin-bottom:6px">Your accuracy by phase</div><div class="kpis">${phTxt}</div></div>` : ''}`;
  }

  function renderGraph() {
    const r = review();
    if (!r) return;
    const marks = r.labels.map((l, i) => ({ ply: i + 1, cls: l })).filter(m => ['mistake', 'blunder'].includes(m.cls));
    graph = evalGraph($('#graph', root), wins(), { cur: cur + 1, marks, onPick: (p) => go(p - 1) });
  }

  function renderInfo() {
    const el = $('#info', root);
    const res = { win: 'Won', loss: 'Lost', draw: 'Drew' }[game.userResult];
    el.innerHTML = `
      <h3 style="margin:0">Game details</h3>
      <div class="small">${res} as ${user === 'w' ? 'White' : 'Black'} vs ${esc(names[user === 'w' ? 'b' : 'w'])} · ${esc(game.result)} by ${esc(game.reason)}</div>
      <div class="small muted">${fmtDate(game.date)}${game.tc ? ` · ${esc(game.tc)}` : ' · no clock'}${game.opening ? ` · ${esc(game.opening.eco)} ${esc(game.opening.name)}` : ''}</div>
      ${game.takebacks || game.hints ? `<div class="tiny muted">Takebacks used: ${game.takebacks || 0} · Hints used: ${game.hints || 0}</div>` : ''}
      <div class="row">
        <button class="btn small" id="i-copy" type="button">Copy PGN</button>
        <button class="btn small" id="i-dl" type="button">${icons.download} PGN</button>
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
    const el = $('#explain', root);
    el.innerHTML = `
      <div class="explain-head"><span class="spinner"></span> Analysing your game</div>
      <p class="muted small" style="margin:0">Stockfish is checking every position at depth ${depth}. This runs on your device and usually takes under a minute.</p>
      <div class="progress"><i id="prog"></i></div><div class="tiny muted" id="prog-t">Starting engine…</div>`;
    const eng = getEngine('analysis');
    eng.cancel();
    const raw = await analyzePositions(eng, fens, {
      depth,
      isCancelled: () => !alive,
      onProgress: (d, t) => {
        if (!alive) return;
        $('#prog', root).style.width = (d / t * 100) + '%';
        $('#prog-t', root).textContent = `${d} of ${t} positions`;
      },
    });
    if (!raw || !alive) return;
    const cls = classify(raw, game.moves, fens, isBook);
    game.review = {
      v: 1, depth, date: Date.now(),
      evals: raw.evals, best: raw.best, pv: raw.pv,
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
    if (e.target.closest('input,textarea,select')) return;
    if (e.key === 'ArrowLeft') { go(cur - 1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { go(cur + 1, true); e.preventDefault(); }
    else if (e.key === 'Home' || e.key === 'ArrowUp') { go(-1); e.preventDefault(); }
    else if (e.key === 'End' || e.key === 'ArrowDown') { go(game.moves.length - 1); e.preventDefault(); }
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
      document.removeEventListener('keydown', onKey);
      getEngine('analysis').cancel();
      board.destroy();
    },
  };

  renderInfo();
  go(-1);
  if (!game.review) await runAnalysis(DEPTHS[settings.reviewDepth] || DEPTHS.standard);
  else renderAll();
}

function sansOf(moves) {
  const c = new Chess();
  const out = [];
  for (const u of moves) { const m = playUci(c, u); if (!m) break; out.push(m.san); }
  return out;
}

export function pgnOf(game) {
  const c = new Chess();
  for (const u of game.moves) if (!playUci(c, u)) break;
  const d = new Date(game.date);
  const bot = `${game.botName} (${game.botLabel || game.botElo})`;
  c.setHeader('Event', 'Kibitz Chess training game');
  c.setHeader('Site', 'Kibitz Chess');
  c.setHeader('Date', `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`);
  c.setHeader('White', game.userColor === 'w' ? 'You' : bot);
  c.setHeader('Black', game.userColor === 'b' ? 'You' : bot);
  c.setHeader('Result', game.result);
  c.setHeader('Termination', game.reason);
  if (game.tc) c.setHeader('TimeControl', game.tc);
  if (game.opening) { c.setHeader('ECO', game.opening.eco); c.setHeader('Opening', game.opening.name); }
  return c.pgn();
}
