// Play vs bots: setup, game loop, clocks, hints, takebacks. Finished games are saved for review.
import { Board, pieceUrl } from '../board.js';
import { Chess, dests, checkSquare, playUci, gameOverInfo, canMate, material, colorName, uciToMove, START_FEN } from '../chessutil.js';
import { getEngine } from '../engine.js';
import { LEVELS, DEFAULT_LEVEL, chooseBotMove, levelLabel } from '../bot.js';
import * as store from '../store.js';
import { playTabs } from './tabs.js';
import { icons, esc, toast, confirm, fmtClock, sound, moveSound, $ } from '../ui.js';
import { loadOpenings, openingOf } from '../openings-data.js';

export const TCS = [
  { id: 'none', label: 'No clock', base: 0, inc: 0 },
  { id: '3+2', label: '3 | 2', base: 180000, inc: 2000 },
  { id: '5+0', label: '5 | 0', base: 300000, inc: 0 },
  { id: '10+0', label: '10 | 0', base: 600000, inc: 0 },
  { id: '15+10', label: '15 | 10', base: 900000, inc: 10000 },
  { id: '30+0', label: '30 | 0', base: 1800000, inc: 0 },
];
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let ctx = null;

export async function mount(root) {
  loadOpenings().catch(() => {});
  const cur = store.get('play.current');
  if (cur && !cur.over) gameView(root, cur);
  else setupView(root);
}

export function unmount() {
  ctx?.destroy();
  ctx = null;
}

function prefs() {
  return { level: DEFAULT_LEVEL, color: 'w', tc: 'none', ...store.get('play.prefs', {}) };
}

// ---------------- setup ----------------
function setupView(root) {
  const p = prefs();
  // "Play vs bot from here" on the analysis board or in a review hands over a position
  const fromFen = store.get('play.fromFen');
  if (fromFen) p.color = fromFen.split(' ')[1];
  root.innerHTML = `
    ${playTabs('new')}
    <div class="stage">
      <div class="board-col desktop-only"><div class="board-shell"><div id="preview"></div></div></div>
      <div class="side-col">
        <section class="card stack" aria-labelledby="setup-h">
          <h1 id="setup-h">Play a bot</h1>
          ${fromFen ? `<div class="status info small">Starting from a custom position (${fromFen.split(' ')[1] === 'w' ? 'White' : 'Black'} to move). <button class="btn small" id="clear-fen" type="button">Use the normal start</button></div>` : ''}
          <div class="level-display">
            <div><div class="elo" id="lv-elo"></div><div class="lname" id="lv-name"></div></div>
            <div class="avatar bot" id="lv-av" style="width:52px;height:52px;font-size:1.1rem;border-radius:14px"></div>
          </div>
          <p class="muted small" id="lv-blurb" style="margin:0;min-height:2.6em"></p>
          <input type="range" id="lv" min="0" max="${LEVELS.length - 1}" step="1" value="${p.level}" aria-label="Bot strength">
          <div class="row between tiny muted"><span>400</span><span>1100</span><span>1800</span><span>Full</span></div>
          <div class="field"><span class="label">Play as</span>
            <div class="seg" id="color" role="group" aria-label="Your colour">
              <button type="button" data-v="w">White</button><button type="button" data-v="random">Random</button><button type="button" data-v="b">Black</button>
            </div>
          </div>
          <div class="field"><span class="label">Clock</span>
            <div class="chips" id="tc" role="group" aria-label="Time control">
              ${TCS.map(t => `<button type="button" class="chip" data-v="${t.id}">${t.label}</button>`).join('')}
            </div>
          </div>
          <button class="btn primary block" id="start" type="button">${icons.start} Start game</button>
          <p class="tiny muted" style="margin:0">Levels are approximate ratings. Hints and takebacks are always available, and every finished game can be reviewed.</p>
        </section>
      </div>
    </div>`;
  const preview = $('#preview', root);
  const board = new Board(preview, { fen: fromFen || new Chess().fen(), coordinates: store.getSettings().coords, orientation: fromFen?.split(' ')[1] === 'b' ? 'black' : 'white' });
  $('#clear-fen', root)?.addEventListener('click', () => { store.del('play.fromFen'); board.destroy(); setupView(root); });
  const lv = $('#lv', root);
  const showLevel = () => {
    const l = LEVELS[+lv.value];
    $('#lv-elo', root).textContent = levelLabel(l);
    $('#lv-name', root).textContent = l.name;
    $('#lv-blurb', root).textContent = l.blurb;
    $('#lv-av', root).textContent = l.name.slice(0, 2);
  };
  showLevel();
  lv.addEventListener('input', showLevel);
  const pick = (groupSel, val) => {
    root.querySelectorAll(`${groupSel} button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === val)));
  };
  pick('#color', p.color);
  pick('#tc', p.tc);
  let color = p.color, tc = p.tc;
  $('#color', root).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { color = b.dataset.v; pick('#color', color); } });
  $('#tc', root).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { tc = b.dataset.v; pick('#tc', tc); } });
  $('#start', root).addEventListener('click', () => {
    store.set('play.prefs', { level: +lv.value, color, tc });
    board.destroy();
    startNew(root, { level: +lv.value, color, tc, startFen: fromFen || null });
  });
  ctx = { destroy: () => board.destroy() };
}

function startNew(root, { level, color, tc, startFen = null }) {
  store.del('play.fromFen');
  const userColor = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
  const t = TCS.find(x => x.id === tc) || TCS[0];
  const state = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    startedAt: Date.now(),
    userColor,
    level,
    tc: t.base ? t.id : null,
    clocks: t.base ? { w: t.base, b: t.base } : null,
    clockLog: t.base ? [{ w: t.base, b: t.base }] : null,
    moves: [],
    startFen: startFen && startFen !== START_FEN ? startFen : null,
    takebacks: 0,
    hints: 0,
    over: false,
  };
  store.set('play.current', state);
  getEngine('bot').newGame();
  ctx?.destroy?.();
  gameView(root, state);
}

// ---------------- game ----------------
function gameView(root, state) {
  const level = LEVELS[state.level] || LEVELS[DEFAULT_LEVEL];
  const tc = TCS.find(x => x.id === state.tc) || null;
  const user = state.userColor;
  const bot = user === 'w' ? 'b' : 'w';
  const startFen = state.startFen || START_FEN;
  const botFirst = startFen.split(' ')[1] === bot;
  const chess = new Chess(startFen);
  for (const u of state.moves) if (!playUci(chess, u)) break;
  const settings = store.getSettings();

  root.innerHTML = `
    <div class="stage">
      <div class="board-col">
        <div class="player-bar" id="bar-top"></div>
        <div class="board-shell"><div id="board"></div></div>
        <div class="player-bar" id="bar-bottom"></div>
        <div class="moves-inline mobile-only" id="moves-m" aria-label="Moves"></div>
        <div class="tiny muted mobile-only" id="opening-m" style="padding:0 16px;min-height:1.2em"></div>
      </div>
      <div class="side-col">
        <div class="status" id="status" role="status"></div>
        <div class="btn-row" id="controls">
          <button class="btn" id="b-hint" type="button">${icons.hint}<span>Hint</span></button>
          <button class="btn" id="b-undo" type="button">${icons.undo}<span>Takeback</span></button>
          <button class="btn" id="b-flip" type="button">${icons.flip}<span>Flip</span></button>
          <button class="btn" id="b-resign" type="button">${icons.flag}<span>Resign</span></button>
        </div>
        <section class="card stack hidden" id="after"></section>
        <section class="card desktop-only">
          <div class="row between"><h3 style="margin:0">Moves</h3><span class="tiny muted" id="opening"></span></div>
          <div class="moves" id="moves" style="margin-top:8px"></div>
        </section>
      </div>
    </div>`;

  const board = new Board($('#board', root), {
    orientation: colorName(user),
    coordinates: settings.coords,
    animate: settings.animation,
    onMove: (from, to, promo) => userMove(from, to, promo),
  });
  const botEngine = getEngine('bot');
  const hintEngine = getEngine('analysis');
  let lastMove = null;
  if (chess.history().length) {
    const h = chess.history({ verbose: true });
    const m = h[h.length - 1];
    lastMove = [m.from, m.to];
  }
  let thinkToken = 0;
  let thinking = false;
  let turnStart = performance.now();
  let hintArrow = null;
  let engineState = 'loading';
  let alive = true;

  const clockActive = () => !!tc && state.moves.length >= 2 && !state.over;
  const live = (c) => {
    if (!state.clocks) return null;
    const run = clockActive() && chess.turn() === c ? performance.now() - turnStart : 0;
    return state.clocks[c] - run;
  };

  function save() {
    if (state.over) return;
    const snap = { ...state };
    if (state.clocks) snap.clocks = { w: live('w'), b: live('b') };
    store.set('play.current', snap);
  }

  function barHtml(color) {
    const isBot = color === bot;
    const mat = material(chess);
    const opp = color === 'w' ? 'b' : 'w';
    let caps = '';
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      const n = START_COUNT[t] - mat.count[opp][t];
      for (let i = 0; i < n; i++) caps += `<i style="background-image:url(${pieceUrl(opp + t.toUpperCase())})"></i>`;
    }
    const diff = mat[color] - mat[opp];
    const t = live(color);
    const running = clockActive() && chess.turn() === color;
    return `
      <div class="avatar ${isBot ? 'bot' : 'me'}">${isBot ? esc(level.name.slice(0, 2)) : 'You'.slice(0, 2)}</div>
      <div class="who">
        <div class="name">${isBot ? `${esc(level.name)} <span class="muted small">(${levelLabel(level)})</span>` : 'You'}</div>
        <div class="sub"><span class="captured">${caps}${diff > 0 ? `<b>+${diff}</b>` : ''}</span></div>
      </div>
      ${t == null ? '' : `<div class="clock${running ? ' running' : ''}${t < 20000 ? ' low' : ''}" data-clock="${color}">${fmtClock(t)}</div>`}`;
  }

  function renderBars() {
    const topColor = board.orientation === 'white' ? 'b' : 'w';
    $('#bar-top', root).innerHTML = barHtml(topColor);
    $('#bar-bottom', root).innerHTML = barHtml(topColor === 'w' ? 'b' : 'w');
  }

  function renderClocks() {
    if (!state.clocks) return;
    for (const c of ['w', 'b']) {
      const el = root.querySelector(`[data-clock="${c}"]`);
      if (!el) continue;
      const t = live(c);
      el.textContent = fmtClock(t);
      el.classList.toggle('running', clockActive() && chess.turn() === c);
      el.classList.toggle('low', t < 20000);
    }
  }

  function renderMoves() {
    const sans = chess.history();
    // custom starts can begin with Black to move and at any move number
    const shift = startFen.split(' ')[1] === 'b' ? 1 : 0;
    const no0 = +(startFen.split(' ')[5] || 1);
    let html = shift ? `<span class="n">${no0}...</span>` : '';
    sans.forEach((s, i) => {
      if ((i + shift) % 2 === 0) html += `<span class="n">${no0 + (i + shift) / 2}.</span>`;
      html += `<span class="${i === sans.length - 1 ? 'cur' : ''}">${esc(s)}</span>`;
    });
    const strip = $('#moves-m', root);
    strip.innerHTML = html || '<span class="muted">No moves yet</span>';
    strip.scrollLeft = strip.scrollWidth;
    let grid = shift ? `<span class="num">${no0}.</span><span class="mv muted">…</span>` : '';
    sans.forEach((s, i) => {
      if ((i + shift) % 2 === 0) grid += `<span class="num">${no0 + (i + shift) / 2}.</span>`;
      grid += `<span class="mv${i === sans.length - 1 ? ' cur' : ''}">${esc(s)}</span>`;
    });
    const g = $('#moves', root);
    g.innerHTML = grid;
    g.scrollTop = g.scrollHeight;
    const op = state.startFen ? null : openingOf(state.moves);
    const txt = op ? `${op.eco} · ${op.name}` : '';
    $('#opening', root).textContent = txt;
    $('#opening-m', root).textContent = txt;
  }

  function setStatus() {
    const st = $('#status', root);
    st.className = 'status';
    if (state.over) {
      const r = userResult(state);
      st.classList.add(r === 'win' ? 'ok' : r === 'loss' ? 'bad' : 'info');
      st.textContent = resultText(state, level);
    } else if (engineState === 'loading') {
      st.innerHTML = '<span class="spinner"></span> Loading engine…';
    } else if (engineState === 'error') {
      st.classList.add('bad');
      st.textContent = 'The engine could not start in this browser.';
    } else if (chess.turn() === bot) {
      st.innerHTML = `<span class="spinner"></span> ${esc(level.name)} is thinking…`;
    } else {
      st.classList.add('info');
      st.textContent = chess.inCheck() ? 'Check! Your move.' : 'Your move';
    }
    const busy = state.over;
    $('#b-hint', root).disabled = busy || chess.turn() !== user;
    $('#b-undo', root).disabled = busy || state.moves.length === 0 || (state.moves.length === 1 && botFirst && !thinking);
    $('#b-resign', root).disabled = busy;
  }

  function render(animate = true) {
    board.setPosition(chess.fen(), { lastMove, check: checkSquare(chess), animate });
    const mine = !state.over && chess.turn() === user;
    board.setMovable({ color: mine ? colorName(user) : null, dests: mine ? dests(chess) : new Map() });
    // while the bot thinks you can queue a premove
    board.setPremovable(!state.over && !mine ? { color: colorName(user), dests: premoveDests(chess, user) } : {});
    board.setArrows(hintArrow ? [hintArrow] : []);
    renderBars();
    renderMoves();
    setStatus();
  }

  function charge(color) {
    if (!clockActive()) return;
    const now = performance.now();
    state.clocks[color] = state.clocks[color] - (now - turnStart) + tc.inc;
    turnStart = now;
  }

  function applyMove(uci) {
    const color = chess.turn();
    const pending = color === bot ? board.premove : null;
    const m = playUci(chess, uci);
    if (!m) return false;
    charge(color);
    state.moves.push(uci);
    if (state.clocks) {
      state.clockLog = state.clockLog || [];
      state.clockLog[state.moves.length] = { ...state.clocks };
      state.clockLog.length = state.moves.length + 1;
    }
    if (state.moves.length === 2) turnStart = performance.now();
    lastMove = [m.from, m.to];
    hintArrow = null;
    moveSound(m, chess);
    const over = gameOverInfo(chess);
    if (over) { finish(over.result, over.reason); return true; }
    save();
    render();
    if (chess.turn() === bot) botTurn();
    else if (pending) setTimeout(() => playPremove(pending), 40);
    return true;
  }

  // a queued premove is played straight away if it is legal in the new position, otherwise dropped
  function playPremove(pm) {
    if (!alive || state.over || chess.turn() !== user) return;
    const legal = chess.moves({ verbose: true }).find(x => x.from === pm.from && x.to === pm.to && (!x.promotion || x.promotion === (pm.promo || 'q')));
    if (legal) userMove(pm.from, pm.to, legal.promotion);
  }

  function userMove(from, to, promo) {
    if (state.over || chess.turn() !== user || engineState === 'error') return;
    const legal = chess.moves({ verbose: true }).find(m => m.from === from && m.to === to && (!m.promotion || m.promotion === (promo || 'q')));
    if (!legal) return;
    applyMove(from + to + (legal.promotion || ''));
  }

  async function botTurn() {
    const token = ++thinkToken;
    thinking = true;
    setStatus();
    const t0 = performance.now();
    let uci = null;
    try {
      uci = await chooseBotMove(botEngine, chess.fen(), level, { timeLeft: tc ? live(bot) : null, history: { startFen, moves: state.moves } });
    } catch (err) { console.error(err); }
    const minDelay = tc ? Math.min(500, (live(bot) || 0) / 50) : 350 + Math.random() * 450;
    const spent = performance.now() - t0;
    if (spent < minDelay) await sleep(minDelay - spent);
    if (!alive || token !== thinkToken || state.over) return;
    thinking = false;
    if (!uci) {
      // the engine crashed or timed out: say so and let the player retry instead of moving at random
      const st = $('#status', root);
      st.className = 'status bad';
      st.innerHTML = `The engine stopped responding. <button class="btn small" id="b-retry" type="button">${icons.retry} Retry</button>`;
      $('#b-retry', root).addEventListener('click', () => botTurn());
      return;
    }
    applyMove(uci);
  }

  function finish(result, reason) {
    state.over = true;
    state.result = result;
    state.reason = reason;
    state.endedAt = Date.now();
    thinkToken++;
    botEngine.cancel();
    hintEngine.cancel();
    const op = state.startFen ? null : openingOf(state.moves);
    const record = {
      startFen: state.startFen || undefined,
      id: state.id,
      date: state.startedAt,
      endedAt: state.endedAt,
      userColor: user,
      botElo: level.max ? 3200 : level.elo,
      botName: level.name,
      botLabel: levelLabel(level),
      tc: state.tc,
      moves: state.moves,
      sans: chess.history(),
      result,
      reason,
      userResult: userResult(state),
      opening: op ? { eco: op.eco, name: op.name } : null,
      takebacks: state.takebacks,
      hints: state.hints,
      review: null,
    };
    store.set('game:' + state.id, record);
    store.del('play.current');
    sound('end');
    render();
    const after = $('#after', root);
    after.classList.remove('hidden');
    after.innerHTML = `
      <h2 style="margin:0">${esc(resultText(state, level))}</h2>
      <p class="muted small" style="margin:0">${state.moves.length ? 'See where the game turned with move-by-move feedback.' : 'No moves were played.'}</p>
      ${state.moves.length >= 2 ? `<a class="btn primary block" href="#/review/${record.id}">${icons.eye} Review game</a>` : ''}
      <div class="grid-2">
        <button class="btn" id="b-rematch" type="button">${icons.retry} Rematch</button>
        <button class="btn" id="b-new" type="button">${icons.plus} New game</button>
      </div>`;
    $('#b-rematch', after).addEventListener('click', () => {
      const p = prefs();
      unmount();
      startNew(root, { ...p, level: state.level, tc: state.tc || 'none', startFen: state.startFen });
    });
    $('#b-new', after).addEventListener('click', () => { unmount(); setupView(root); });
    after.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  async function hint() {
    if (state.over || chess.turn() !== user) return;
    const fen = chess.fen();
    const btn = $('#b-hint', root);
    btn.disabled = true;
    hintEngine.cancel();
    const r = await hintEngine.analyze(fen, { depth: 16, movetime: 1500, startFen, moves: state.moves });
    if (!alive) return;
    setStatus();
    if (!r?.bestmove || chess.fen() !== fen) return;
    state.hints++;
    const m = uciToMove(r.bestmove);
    hintArrow = { from: m.from, to: m.to, color: 'rgba(32,150,210,.85)' };
    board.setArrows([hintArrow]);
    save();
  }

  function takeback() {
    if (state.over) return;
    let n;
    if (thinking || chess.turn() === bot) {
      thinkToken++;
      thinking = false;
      botEngine.cancel();
      n = 1;
    } else {
      n = 2;
    }
    if (state.moves.length < n) n = state.moves.length;
    // never undo the bot's first move when it moved first
    if (botFirst && state.moves.length - n < 1) n = state.moves.length - 1;
    if (n <= 0) { toast('Nothing to take back'); render(false); return; }
    // clocks go back to where they stood, except that your own thinking time is never refunded
    if (state.clocks) {
      const liveUser = live(user);
      const snap = state.clockLog?.[state.moves.length - n] || state.clocks;
      state.clocks = { [bot]: snap[bot], [user]: Math.min(liveUser, snap[user]) };
    }
    state.moves.splice(-n, n);
    if (state.clockLog) state.clockLog.length = state.moves.length + 1;
    state.takebacks++;
    chess.load(startFen);
    for (const u of state.moves) playUci(chess, u);
    const h = chess.history({ verbose: true });
    lastMove = h.length ? [h[h.length - 1].from, h[h.length - 1].to] : null;
    hintArrow = null;
    turnStart = performance.now();
    save();
    render();
    if (chess.turn() === bot) botTurn();
  }

  async function resign() {
    if (state.over) return;
    if (await confirm('Resign this game?', '<p class="muted">The game will be saved as a loss and you can review it.</p>', 'Resign', true)) {
      if (!state.over) finish(user === 'w' ? '0-1' : '1-0', 'resignation');
    }
  }

  $('#b-hint', root).addEventListener('click', hint);
  $('#b-undo', root).addEventListener('click', takeback);
  $('#b-flip', root).addEventListener('click', () => { board.flip(); renderBars(); });
  $('#b-resign', root).addEventListener('click', resign);

  let ticks = 0;
  const tick = setInterval(() => {
    if (!clockActive()) return;
    renderClocks();
    // unload saves are not guaranteed to finish, so keep the stored clock fresh
    if (++ticks % 30 === 0) save();
    const c = chess.turn();
    if (live(c) <= 0) {
      state.clocks[c] = 0;
      const winner = c === 'w' ? 'b' : 'w';
      if (canMate(chess, winner)) finish(winner === 'w' ? '1-0' : '0-1', 'timeout');
      else finish('1/2-1/2', 'timeout vs insufficient material');
    }
  }, 100);

  const onHide = () => save();
  window.addEventListener('pagehide', onHide);

  ctx = {
    destroy() {
      alive = false;
      save();
      clearInterval(tick);
      thinkToken++;
      botEngine.cancel();
      hintEngine.cancel();
      window.removeEventListener('pagehide', onHide);
      board.destroy();
    },
  };

  render(false);
  botEngine.ready.then(() => {
    if (!alive) return;
    engineState = 'ready';
    setStatus();
    if (!state.over && chess.turn() === bot && !thinking) botTurn();
  }).catch(() => { engineState = 'error'; setStatus(); });
}

/**
 * Squares `color` could premove to while the opponent is thinking: its moves as if it were its turn,
 * plus pawn captures onto empty squares (a piece may land there).
 */
export function premoveDests(chess, color) {
  const map = new Map();
  const parts = chess.fen().split(' ');
  parts[1] = color;
  parts[3] = '-';
  let c;
  try { c = new Chess(parts.join(' ')); } catch { return map; }
  const add = (from, to) => { if (!map.has(from)) map.set(from, []); if (!map.get(from).includes(to)) map.get(from).push(to); };
  try { for (const m of c.moves({ verbose: true })) add(m.from, m.to); } catch { /* unusual position: plain moves only */ }
  const dir = color === 'w' ? 1 : -1;
  for (const row of c.board()) for (const p of row) {
    if (!p || p.type !== 'p' || p.color !== color) continue;
    const f = p.square.charCodeAt(0), r = +p.square[1] + dir;
    if (r < 1 || r > 8) continue;
    for (const df of [-1, 1]) {
      const nf = f + df;
      if (nf < 97 || nf > 104) continue;
      const to = String.fromCharCode(nf) + r;
      const occ = c.get(to);
      if (!occ || occ.color !== color) add(p.square, to);
    }
  }
  return map;
}

export function userResult(g) {
  if (g.result === '1/2-1/2') return 'draw';
  const whiteWon = g.result === '1-0';
  return (whiteWon === (g.userColor === 'w')) ? 'win' : 'loss';
}

function resultText(state, level) {
  const r = userResult(state);
  const why = {
    checkmate: 'by checkmate', resignation: 'by resignation', timeout: 'on time',
  }[state.reason] || `by ${state.reason}`;
  if (r === 'draw') return `Draw (${state.reason})`;
  if (r === 'win') return `You won ${why}!`;
  return `${level.name} won ${why}`;
}
