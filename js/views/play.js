// Play vs bots: setup, game loop, clocks, hints, takebacks. Finished games are saved for review.
import { Board, pieceUrl } from '../board.js';
import { Chess, dests, checkSquare, playUci, gameOverInfo, canMate, material, colorName, uciToMove, START_FEN } from '../chessutil.js';
import { getEngine, toWhite, formatScore } from '../engine.js';
import { winPct, gradeMove, LABEL_TEXT, LABEL_GLYPH } from '../analysis.js';
import { LEVELS, DEFAULT_LEVEL, chooseBotMove, levelLabel } from '../bot.js';
import * as store from '../store.js';
import { playTabs } from './tabs.js';
import { icons, esc, toast, confirm, fmtClock, sound, moveSound, $, fig } from '../ui.js';
import { loadOpenings, openingOf } from '../openings-data.js';
import { startReview } from '../review-run.js';
import { DEPTHS } from '../analysis.js';

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
  const settings = store.getSettings();
  // "Play vs bot from here" on the analysis board or in a review hands over a position
  const fromFen = store.get('play.fromFen');
  if (fromFen) p.color = fromFen.split(' ')[1];
  root.innerHTML = `
    ${playTabs('new')}
    <div class="stage">
      <div class="board-col desktop-only"><div class="board-shell"><div id="preview"></div></div></div>
      <div class="side-col">
        <section class="card stack" aria-labelledby="setup-h">
          <h1 id="setup-h">New game</h1>
          <div class="seg" id="mode" role="group" aria-label="Opponent">
            <button type="button" data-v="bot">Play a bot</button><button type="button" data-v="friend">Play a friend</button>
          </div>
          ${fromFen ? `<div class="status info small">Starting from a custom position (${fromFen.split(' ')[1] === 'w' ? 'White' : 'Black'} to move). <button class="btn small" id="clear-fen" type="button">Use the normal start</button></div>` : ''}
          <div class="stack" id="bot-opts">
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
          </div>
          <div class="stack hidden" id="friend-opts">
            <p class="muted small" style="margin:0">Pass-and-play on this device. Take turns moving; the game is saved so you can review it together.</p>
            <label class="toggle"><span>Turn the board after each move</span><input type="checkbox" id="autoflip" ${p.autoflip ? 'checked' : ''}></label>
          </div>
          <div class="field"><span class="label">Clock</span>
            <div class="chips" id="tc" role="group" aria-label="Time control">
              ${TCS.map(t => `<button type="button" class="chip" data-v="${t.id}">${t.label}</button>`).join('')}<button type="button" class="chip" data-v="custom">Custom</button>
            </div>
            <div class="row nowrap hidden" id="tc-custom" style="margin-top:8px">
              <label class="grow small">Minutes<input type="number" id="tc-min" min="1" max="180" step="1" value="${p.custom?.min ?? 10}" inputmode="numeric"></label>
              <label class="grow small">Increment (sec)<input type="number" id="tc-inc" min="0" max="60" step="1" value="${p.custom?.inc ?? 5}" inputmode="numeric"></label>
            </div>
          </div>
          <div class="field" id="assist"><span class="label">Help during the game</span>
            <label class="toggle"><span>Evaluation bar (who is winning)</span><input type="checkbox" id="as-eval" ${settings.playEval ? 'checked' : ''}></label>
            <label class="toggle"><span>Show threats (your pieces that can be won)</span><input type="checkbox" id="as-threats" ${settings.showThreats ? 'checked' : ''}></label>
            <label class="toggle"><span>Coach: warn me right after a mistake</span><input type="checkbox" id="as-coach" ${settings.coach ? 'checked' : ''}></label>
            <label class="toggle"><span>Bot chat</span><input type="checkbox" id="as-chat" ${settings.botChat !== false ? 'checked' : ''}></label>
          </div>
          <button class="btn primary block" id="start" type="button">${icons.start} Start game</button>
          <p class="tiny muted" style="margin:0" id="setup-note">Levels are approximate ratings. Hints and takebacks are always available, and every finished game can be reviewed.</p>
        </section>
      </div>
    </div>`;
  const preview = $('#preview', root);
  const board = new Board(preview, { fen: fromFen || new Chess().fen(), coordinates: settings.coords, orientation: fromFen?.split(' ')[1] === 'b' ? 'black' : 'white' });
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
  let color = p.color, tc = p.tc, mode = p.mode === 'friend' ? 'friend' : 'bot';
  const showMode = () => {
    pick('#mode', mode);
    $('#bot-opts', root).classList.toggle('hidden', mode !== 'bot');
    $('#friend-opts', root).classList.toggle('hidden', mode !== 'friend');
    $('#as-threats', root).closest('label').classList.toggle('hidden', mode !== 'bot');
    $('#as-chat', root).closest('label').classList.toggle('hidden', mode !== 'bot');
    $('#as-coach', root).closest('label').classList.toggle('hidden', mode !== 'bot');
    $('#setup-note', root).classList.toggle('hidden', mode !== 'bot');
  };
  const showTc = () => { pick('#tc', tc); $('#tc-custom', root).classList.toggle('hidden', tc !== 'custom'); };
  showMode();
  pick('#color', color);
  showTc();
  $('#mode', root).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { mode = b.dataset.v; showMode(); } });
  $('#color', root).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { color = b.dataset.v; pick('#color', color); } });
  $('#tc', root).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { tc = b.dataset.v; showTc(); } });
  $('#start', root).addEventListener('click', () => {
    const clamp = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    const custom = { min: clamp($('#tc-min', root).value, 1, 180, 10), inc: clamp($('#tc-inc', root).value, 0, 60, 0) };
    const autoflip = $('#autoflip', root).checked;
    store.set('play.prefs', { level: +lv.value, color, tc, mode, custom, autoflip });
    store.setSettings({ playEval: $('#as-eval', root).checked, showThreats: $('#as-threats', root).checked, botChat: $('#as-chat', root).checked, coach: $('#as-coach', root).checked });
    board.destroy();
    startNew(root, { level: +lv.value, color: mode === 'friend' ? 'w' : color, tc, startFen: fromFen || null, mode, custom, autoflip });
  });
  ctx = { destroy: () => board.destroy() };
}

/** Clock settings for a stored game: one of the presets, or a custom base/increment. */
function tcOf(state) {
  if (state.tcCustom) return state.tcCustom;
  return TCS.find(x => x.id === state.tc) || null;
}

function startNew(root, { level, color, tc, startFen = null, mode = 'bot', custom = null, autoflip = false }) {
  store.del('play.fromFen');
  const userColor = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
  let t = TCS.find(x => x.id === tc) || TCS[0];
  let tcCustom = null;
  if (tc === 'custom' && custom) {
    tcCustom = { id: `${custom.min}+${custom.inc}`, label: `${custom.min} | ${custom.inc}`, base: custom.min * 60000, inc: custom.inc * 1000 };
    t = tcCustom;
  }
  const state = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    startedAt: Date.now(),
    mode: mode === 'friend' ? 'friend' : 'bot',
    autoflip: mode === 'friend' && !!autoflip,
    userColor,
    level,
    tc: t.base ? t.id : null,
    tcCustom,
    clocks: t.base ? { w: t.base, b: t.base } : null,
    clockLog: t.base ? [{ w: t.base, b: t.base }] : null,
    moves: [],
    startFen: startFen && startFen !== START_FEN ? startFen : null,
    takebacks: 0,
    hints: 0,
    over: false,
  };
  store.set('play.current', state);
  if (state.mode === 'bot') getEngine('bot').newGame();
  ctx?.destroy?.();
  gameView(root, state);
}

// ---------------- game ----------------
function gameView(root, state) {
  const level = LEVELS[state.level] || LEVELS[DEFAULT_LEVEL];
  const tc = tcOf(state);
  // pass-and-play: both sides are moved on this device and there is no bot
  const friend = state.mode === 'friend';
  const user = state.userColor;
  const bot = friend ? null : (user === 'w' ? 'b' : 'w');
  const startFen = state.startFen || START_FEN;
  const botFirst = !friend && startFen.split(' ')[1] === bot;
  const humanTurn = () => friend || chess.turn() === user;
  const chess = new Chess(startFen);
  for (const u of state.moves) if (!playUci(chess, u)) break;
  const settings = store.getSettings();

  root.innerHTML = `
    <div class="stage play-stage${settings.playEval ? ' with-evalbar' : ' evaloff'}">
      <div class="board-col">
        <div class="bot-chat hidden" id="chat" role="status" aria-live="polite"></div>
        <div class="player-bar" id="bar-top"></div>
        <div class="evalbar-h" aria-hidden="true"><i id="ebh" style="width:50%"></i></div>
        <div class="board-and-bar">
          <div class="evalbar-v" id="ebv" aria-hidden="true"><i style="height:50%"></i><span></span></div>
          <div class="board-shell"><div id="board"></div></div>
        </div>
        <div class="player-bar" id="bar-bottom"></div>
        <div class="review-nav play-nav">
          <button class="btn" id="n-first" type="button" aria-label="First move">${icons.first}</button>
          <button class="btn" id="n-prev" type="button" aria-label="Previous move">${icons.prev}</button>
          <button class="btn" id="n-next" type="button" aria-label="Next move">${icons.next}</button>
          <button class="btn" id="n-last" type="button" aria-label="Back to the current position">${icons.last}</button>
          <button class="btn labelled" id="n-eval" type="button" title="Show who is winning" aria-pressed="${settings.playEval}">${icons.chart}<span>Eval</span></button>
          ${friend ? '' : `<button class="btn labelled" id="n-threats" type="button" title="Highlight your pieces that can be won" aria-pressed="${!!settings.showThreats}">${icons.target}<span>Threats</span></button>`}
        </div>
      </div>
      <div class="side-col">
        <div class="coach hidden" id="coach" role="status" aria-live="polite"></div>
        <div class="status" id="status" role="status"></div>
        <div class="btn-row" id="controls">
          <button class="btn" id="b-hint" type="button">${icons.hint}<span>Hint</span></button>
          <button class="btn" id="b-undo" type="button">${icons.undo}<span>Takeback</span></button>
          <button class="btn" id="b-flip" type="button">${icons.flip}<span>Flip</span></button>
          <button class="btn" id="b-draw" type="button"><b class="half" aria-hidden="true">½</b><span>Draw</span></button>
          <button class="btn" id="b-resign" type="button">${icons.flag}<span>Resign</span></button>
        </div>
        <section class="card stack hidden" id="after"></section>
        <!-- phones: the move list sits below the buttons so the controls stay right under the board -->
        <div class="mobile-only" style="margin:0 -16px">
          <div class="moves-inline" id="moves-m" aria-label="Moves"></div>
          <div class="tiny muted" id="opening-m" style="padding:0 16px;min-height:1.2em"></div>
        </div>
        <section class="card desktop-only">
          <div class="row between"><h3 style="margin:0">Moves</h3><span class="tiny muted" id="opening"></span></div>
          <div class="moves" id="moves" style="margin-top:8px"></div>
        </section>
      </div>
    </div>`;

  const board = new Board($('#board', root), {
    orientation: friend && state.autoflip ? colorName(chess.turn()) : colorName(user),
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
  // hints come in two steps, like chess.com: first the piece to move, then the move itself
  let hintSq = null;
  let hintBest = null;
  let engineState = 'loading';
  let alive = true;
  let threatsOn = !friend && !!settings.showThreats;
  const coachOn = !friend && !!settings.coach;
  let coachEngine = null;
  const coachCache = new Map();
  let coachPly = -1;
  let lowWarned = false;
  let chatTimer = 0;
  let lastChatPly = -9;
  let drawBlockedUntil = 0;
  // move browsing: null shows the live game, a number shows the position after that many moves
  let view = null;
  let evalOn = settings.playEval;
  let evalEngine = null;
  let evalToken = 0;
  const evalCache = new Map();

  function chessAt(ply) {
    const c = new Chess(startFen);
    for (let i = 0; i < ply; i++) playUci(c, state.moves[i]);
    return c;
  }

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
    const isBot = !friend && color === bot;
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
      <div class="avatar ${isBot ? 'bot' : 'me'}">${isBot ? esc(level.name.slice(0, 2)) : friend ? (color === 'w' ? 'W' : 'B') : 'Yo'}</div>
      <div class="who">
        <div class="name">${isBot ? `${esc(level.name)} <span class="muted small">(${levelLabel(level)})</span>` : friend ? (color === 'w' ? 'White' : 'Black') : 'You'}</div>
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
    const curI = view == null ? sans.length - 1 : view - 1;
    sans.forEach((s, i) => {
      if ((i + shift) % 2 === 0) html += `<span class="n">${no0 + (i + shift) / 2}.</span>`;
      html += `<span class="mvi${i === curI ? ' cur' : ''}" data-i="${i}">${esc(fig(s))}</span>`;
    });
    const strip = $('#moves-m', root);
    strip.innerHTML = html || '<span class="muted">No moves yet</span>';
    const curEl = strip.querySelector('.cur');
    if (view == null || !curEl) strip.scrollLeft = strip.scrollWidth;
    else strip.scrollLeft = Math.max(0, curEl.offsetLeft - strip.clientWidth / 2);
    let grid = shift ? `<span class="num">${no0}.</span><span class="mv muted">…</span>` : '';
    sans.forEach((s, i) => {
      if ((i + shift) % 2 === 0) grid += `<span class="num">${no0 + (i + shift) / 2}.</span>`;
      grid += `<span class="mv${i === curI ? ' cur' : ''}" data-i="${i}">${esc(fig(s))}</span>`;
    });
    const g = $('#moves', root);
    g.innerHTML = grid;
    const gCur = g.querySelector('.cur');
    if (view == null || !gCur) g.scrollTop = g.scrollHeight;
    else if (gCur.offsetTop < g.scrollTop || gCur.offsetTop + gCur.offsetHeight > g.scrollTop + g.clientHeight) g.scrollTop = gCur.offsetTop - g.clientHeight / 2;
    const op = state.startFen ? null : openingOf(state.moves);
    const txt = op ? `${op.eco} · ${op.name}` : '';
    $('#opening', root).textContent = txt;
    $('#opening-m', root).textContent = txt;
  }

  function setStatus() {
    const st = $('#status', root);
    st.className = 'status';
    if (view != null) {
      // browsing earlier moves: say where you are and how to get back
      st.classList.add('viewing');
      st.innerHTML = `${esc(view === 0 ? 'Starting position' : `After ${moveLabel(view - 1)}`)} <button class="btn small" id="b-live" type="button">Back to game ${icons.last}</button>`;
      $('#b-live', st).addEventListener('click', () => goTo(state.moves.length));
    } else if (state.over) {
      const r = friend ? 'draw' : userResult(state);
      st.classList.add(r === 'win' ? 'ok' : r === 'loss' ? 'bad' : 'info');
      st.textContent = resultText(state, level);
    } else if (friend) {
      st.classList.add('info');
      st.textContent = `${chess.turn() === 'w' ? 'White' : 'Black'} to move${chess.inCheck() ? ' (check!)' : ''}`;
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
    $('#b-hint', root).disabled = busy || !humanTurn();
    $('#b-draw', root).disabled = busy || state.moves.length < 2;
    $('#b-undo', root).disabled = busy || state.moves.length === 0 || (state.moves.length === 1 && botFirst && !thinking);
    $('#b-resign', root).disabled = busy;
  }

  function render(animate = true) {
    if (view != null) {
      // looking at an earlier position: nothing can be moved until you come back to the game
      const c = chessAt(view);
      const h = c.history({ verbose: true });
      const m = h[h.length - 1];
      board.setPosition(c.fen(), { lastMove: m ? [m.from, m.to] : null, check: checkSquare(c), animate });
      board.setMovable({ color: null, dests: new Map() });
      board.setPremovable({});
      board.setArrows([]);
      board.setMarks([]);
      renderBars();
      renderMoves();
      setStatus();
      renderNav();
      updateEval(c, view);
      return;
    }
    board.setPosition(chess.fen(), { lastMove, check: checkSquare(chess), animate });
    const mine = !state.over && humanTurn();
    board.setMovable({ color: mine ? colorName(chess.turn()) : null, dests: mine ? dests(chess) : new Map() });
    // while the bot thinks you can queue a premove
    board.setPremovable(!friend && settings.premoves !== false && !state.over && !mine ? { color: colorName(user), dests: premoveDests(chess, user) } : {});
    board.setArrows(hintArrow ? [hintArrow] : []);
    board.setMarks([
      ...(threatsOn && !state.over ? threatSquares(chess, user).map(sq => ({ sq, cls: 'threat' })) : []),
      ...(hintSq && !hintArrow ? [{ sq: hintSq, cls: 'hint-sq' }] : []),
    ]);
    renderBars();
    renderMoves();
    setStatus();
    renderNav();
    updateEval(chess, state.moves.length);
  }

  function renderNav() {
    const n = state.moves.length;
    const at = view == null ? n : view;
    $('#n-first', root).disabled = at === 0;
    $('#n-prev', root).disabled = at === 0;
    $('#n-next', root).disabled = at >= n;
    $('#n-last', root).disabled = at >= n;
    $('#n-last', root).classList.toggle('primary', view != null);
  }

  function moveLabel(i) {
    const shift = startFen.split(' ')[1] === 'b' ? 1 : 0;
    const no0 = +(startFen.split(' ')[5] || 1);
    const k = i + shift;
    return `${no0 + Math.floor(k / 2)}${k % 2 === 0 ? '.' : '...'} ${chess.history()[i] || ''}`;
  }

  function goTo(ply) {
    const n = state.moves.length;
    ply = Math.max(0, Math.min(n, ply));
    const next = ply >= n ? null : ply;
    if (next === view) return;
    view = next;
    render(true);
  }

  function setEvalBar(score, mateWinner) {
    const flipped = board.orientation === 'black';
    let w, label;
    if (mateWinner) { w = mateWinner === 'w' ? 100 : 0; label = '#'; }
    else if (!score) { w = 50; label = ''; }
    else { w = winPct(score); label = formatScore(score).replace('+', '').replace(/^-0\.0$/, '0.0'); }
    $('#ebh', root).style.width = w + '%';
    const v = $('#ebv', root);
    v.classList.toggle('flipped', flipped);
    v.querySelector('i').style.height = w + '%';
    const span = v.querySelector('span');
    span.textContent = label;
    const whiteAhead = w >= 50;
    span.style.top = (whiteAhead !== flipped) ? 'auto' : '4px';
    span.style.bottom = (whiteAhead !== flipped) ? '4px' : 'auto';
    span.style.color = whiteAhead ? 'var(--eval-black)' : 'var(--eval-white)';
  }

  // the bar is optional; it uses its own engine so the bot and hints are never interrupted
  function updateEval(c, ply) {
    if (!evalOn) return;
    const fen = c.fen();
    if (c.isCheckmate()) { setEvalBar(null, c.turn() === 'w' ? 'b' : 'w'); return; }
    if (c.isDraw() || c.isStalemate()) { setEvalBar({ cp: 0, mate: null }); return; }
    if (evalCache.has(fen)) { setEvalBar(evalCache.get(fen)); return; }
    evalEngine = evalEngine || getEngine('live');
    const t = ++evalToken;
    evalEngine.cancel();
    const turn = c.turn();
    const show = (lines) => {
      if (!alive || t !== evalToken || !lines?.[0]) return;
      setEvalBar(toWhite(lines[0], turn));
    };
    evalEngine.analyze(fen, { depth: 16, movetime: 1200, startFen, moves: state.moves.slice(0, ply), onInfo: show }).then(r => {
      if (!alive || t !== evalToken || !r?.lines?.[0]) return;
      const sc = toWhite(r.lines[0], turn);
      evalCache.set(fen, sc);
      setEvalBar(sc);
    });
  }

  function toggleEval() {
    evalOn = !evalOn;
    store.setSettings({ playEval: evalOn });
    const stage = root.querySelector('.play-stage');
    stage.classList.toggle('with-evalbar', evalOn);
    stage.classList.toggle('evaloff', !evalOn);
    $('#n-eval', root).setAttribute('aria-pressed', String(evalOn));
    if (evalOn) { setEvalBar(null); render(false); }
    else { evalToken++; evalEngine?.cancel(); }
  }

  function charge(color) {
    if (!clockActive()) return;
    const now = performance.now();
    state.clocks[color] = state.clocks[color] - (now - turnStart) + tc.inc;
    turnStart = now;
  }

  function applyMove(uci) {
    const color = chess.turn();
    const fenBefore = chess.fen();
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
    view = null;
    lastMove = [m.from, m.to];
    hintArrow = null; hintSq = null; hintBest = null;
    moveSound(m, chess);
    const over = gameOverInfo(chess);
    if (over) { finish(over.result, over.reason); return true; }
    if (friend && state.autoflip) board.setOrientation(colorName(chess.turn()));
    if (!friend) chatAfterMove(m, color);
    if (coachOn && color === user) coachCheck(fenBefore, chess.fen(), uci, m.san, state.moves.length);
    save();
    render();
    if (chess.turn() === bot) botTurn();
    else if (pending) playPremove(pending); // in the same frame as the bot's move, so nothing flickers
    return true;
  }

  // a queued premove is played straight away if it is legal in the new position, otherwise dropped
  function playPremove(pm) {
    if (!alive || state.over || chess.turn() !== user) return;
    const legal = chess.moves({ verbose: true }).find(x => x.from === pm.from && x.to === pm.to && (!x.promotion || x.promotion === (pm.promo || 'q')));
    if (legal) userMove(pm.from, pm.to, legal.promotion);
  }

  function userMove(from, to, promo) {
    if (state.over || !humanTurn() || (!friend && engineState === 'error')) return;
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
      ...(friend
        ? { friend: true, spectator: true, whiteName: 'White', blackName: 'Black', botName: 'Friend', botLabel: '', botElo: null }
        : { botElo: level.max ? 3200 : level.elo, botName: level.name, botLabel: levelLabel(level) }),
      tc: state.tc,
      moves: state.moves,
      sans: chess.history(),
      result,
      reason,
      userResult: friend ? null : userResult(state),
      opening: op ? { eco: op.eco, name: op.name } : null,
      takebacks: state.takebacks,
      hints: state.hints,
      review: null,
      // remaining time after each move (ms), for "time per move" in the review
      ...(tc && state.clockLog ? {
        tcBase: tc.base, tcInc: tc.inc,
        moveClocks: state.moves.map((_, i) => { const c = state.clockLog[i + 1]; const mover = new Chess(startFen).turn() === 'w' ? (i % 2 ? 'b' : 'w') : (i % 2 ? 'w' : 'b'); return c ? Math.max(0, Math.round(c[mover])) : null; }),
      } : {}),
    };
    store.set('game:' + state.id, record);
    store.del('play.current');
    sound('end');
    if (!friend) chatEnd();
    render();
    const after = $('#after', root);
    after.classList.remove('hidden');
    after.innerHTML = `
      <h2 style="margin:0">${esc(resultText(state, level))}</h2>
      <p class="muted small" style="margin:0">${state.moves.length ? 'See where the game turned with move-by-move feedback.' : 'No moves were played.'}</p>
      ${state.moves.length >= 2 ? `<div id="auto-review" class="stack" style="gap:6px"><div class="tiny muted"><span class="spinner"></span> Reviewing the game in the background…</div><div class="progress"><i id="ar-prog"></i></div></div>
      <a class="btn primary block" href="#/review/${record.id}">${icons.eye} Review game</a>` : ''}
      <div class="grid-2">
        <button class="btn" id="b-rematch" type="button">${icons.retry} Rematch</button>
        <button class="btn" id="b-new" type="button">${icons.plus} New game</button>
      </div>`;
    $('#b-rematch', after).addEventListener('click', () => {
      const p = prefs();
      unmount();
      startNew(root, {
        ...p, level: state.level, startFen: state.startFen, mode: state.mode || 'bot', autoflip: state.autoflip,
        tc: state.tcCustom ? 'custom' : (state.tc || 'none'),
        custom: state.tcCustom ? { min: state.tcCustom.base / 60000, inc: state.tcCustom.inc / 1000 } : p.custom,
      });
    });
    $('#b-new', after).addEventListener('click', () => { unmount(); setupView(root); });
    after.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    // start the Stockfish review straight away, so it is ready (or nearly) when you open it
    if (state.moves.length >= 2) {
      const job = startReview(record, DEPTHS[settings.reviewDepth] || DEPTHS.standard);
      const box = $('#auto-review', after);
      const stop = job.listen((d, t) => { const bar = $('#ar-prog', after); if (bar) bar.style.width = (d / t * 100) + '%'; });
      job.promise.then((rv) => {
        stop();
        if (!box?.isConnected) return;
        if (!rv) { box.innerHTML = '<div class="tiny muted">The review will run when you open it.</div>'; return; }
        const me = friend ? 'w' : user;
        const acc = (c) => typeof rv.accuracy?.[c] === 'number' ? Number(rv.accuracy[c]).toFixed(1) : '—';
        const cnt = (l) => Number(rv.counts?.[me]?.[l] || 0);
        box.innerHTML = friend
          ? `<div class="summary-line"><b>White ${acc('w')}%</b><b>Black ${acc('b')}%</b><span class="tiny muted">accuracy</span></div>`
          : `<div class="summary-line"><b>Your accuracy: ${acc(me)}%</b>
              <span><i class="q q-blunder">??</i> ${cnt('blunder')}</span><span><i class="q q-mistake">?</i> ${cnt('mistake')}</span><span><i class="q q-inaccuracy">?!</i> ${cnt('inaccuracy')}</span></div>`;
      });
    }
  }

  async function hint() {
    if (state.over || !humanTurn()) return;
    if (view != null) { view = null; render(false); }
    const fen = chess.fen();
    // second press on the same position: show the whole move
    if (hintBest?.fen === fen && hintSq) {
      const m = uciToMove(hintBest.uci);
      hintArrow = { from: m.from, to: m.to, color: 'rgba(32,150,210,.85)' };
      render(false);
      return;
    }
    const btn = $('#b-hint', root);
    btn.disabled = true;
    hintEngine.cancel();
    const r = await hintEngine.analyze(fen, { depth: 16, movetime: 1500, startFen, moves: state.moves });
    if (!alive) return;
    setStatus();
    if (!r?.bestmove || chess.fen() !== fen) return;
    state.hints++;
    hintBest = { fen, uci: r.bestmove };
    hintSq = uciToMove(r.bestmove).from;
    render(false);
    const st = $('#status', root);
    st.className = 'status info';
    st.textContent = 'Hint: move the highlighted piece. Press Hint again to see the move.';
    save();
  }

  function takeback() {
    if (state.over) return;
    view = null;
    coachPly = -1;
    hideCoach();
    let n;
    if (friend) n = 1;
    else if (thinking || chess.turn() === bot) {
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
      const snap = state.clockLog?.[state.moves.length - n] || state.clocks;
      if (friend) state.clocks = { w: Math.min(live('w'), snap.w), b: Math.min(live('b'), snap.b) };
      else state.clocks = { [bot]: snap[bot], [user]: Math.min(live(user), snap[user]) };
    }
    state.moves.splice(-n, n);
    if (state.clockLog) state.clockLog.length = state.moves.length + 1;
    state.takebacks++;
    chess.load(startFen);
    for (const u of state.moves) playUci(chess, u);
    const h = chess.history({ verbose: true });
    lastMove = h.length ? [h[h.length - 1].from, h[h.length - 1].to] : null;
    hintArrow = null; hintSq = null; hintBest = null;
    turnStart = performance.now();
    if (friend && state.autoflip) board.setOrientation(colorName(chess.turn()));
    save();
    render();
    if (chess.turn() === bot) botTurn();
  }

  async function resign() {
    if (state.over) return;
    if (friend) {
      const side = chess.turn();
      if (await confirm(`${side === 'w' ? 'White' : 'Black'} resigns?`, '<p class="muted">The side to move gives up the game.</p>', 'Resign', true)) {
        if (!state.over) finish(side === 'w' ? '0-1' : '1-0', 'resignation');
      }
      return;
    }
    if (await confirm('Resign this game?', '<p class="muted">The game will be saved as a loss and you can review it.</p>', 'Resign', true)) {
      if (!state.over) finish(user === 'w' ? '0-1' : '1-0', 'resignation');
    }
  }

  // A draw offer: a friend is asked; a bot accepts only when it is not better and the game has gone on a while
  async function offerDraw() {
    if (state.over) return;
    if (friend) {
      if (await confirm('Agree to a draw?', '<p class="muted">Both players accept a draw.</p>', 'Draw', false)) {
        if (!state.over) finish('1/2-1/2', 'agreement');
      }
      return;
    }
    if (state.moves.length < drawBlockedUntil) { say(`Let's play a few more moves first.`, true); return; }
    const btn = $('#b-draw', root);
    btn.disabled = true;
    const fen = chess.fen();
    const r = await hintEngine.analyze(fen, { depth: 12, movetime: 800, startFen, moves: state.moves });
    if (!alive || state.over) return;
    setStatus();
    if (chess.fen() !== fen) return;
    const line = r?.lines?.[0];
    const white = line ? toWhite(line, chess.turn()) : { cp: 0, mate: null };
    const sign = bot === 'w' ? 1 : -1;
    const forBot = white.mate != null ? Math.sign(white.mate) * sign * 10000 : (white.cp || 0) * sign;
    // weaker bots are a little more willing; nobody takes a draw early unless clearly worse
    const limit = level.elo < 1000 ? 60 : level.elo < 1600 ? 30 : 15;
    const accept = forBot <= limit && (state.moves.length >= 20 || forBot < -150);
    if (accept) {
      say(pickLine(['Fair enough, a draw it is.', 'Draw accepted. Well played!', "OK, let's call it a draw."]), true);
      finish('1/2-1/2', 'agreement');
    } else {
      drawBlockedUntil = state.moves.length + 6;
      say(pickLine(forBot > limit ? ['No thanks, I like my position.', "I think I'm better here. Let's play on!", 'Not yet!'] : ["It's too early for a draw. Let's play!", "Let's keep going a bit."]), true);
    }
  }

  // ---------- coach: grade your move right away and offer a takeback after a mistake ----------
  function coachEval(fen, ply) {
    if (coachCache.has(fen)) return coachCache.get(fen);
    coachEngine = coachEngine || getEngine('coach');
    const c = new Chess(fen);
    const turn = c.turn();
    const pr = c.isCheckmate() ? Promise.resolve({ score: { mate: 0, win: turn === 'w' ? 'b' : 'w' }, best: null })
      : c.isGameOver() ? Promise.resolve({ score: { cp: 0, mate: null }, best: null })
      : coachEngine.analyze(fen, { depth: 13, movetime: 900, startFen, moves: state.moves.slice(0, ply) }).then(r => {
        if (!r?.lines?.[0]) return null;
        return { score: toWhite(r.lines[0], turn), best: r.lines[0].pv?.[0] || r.bestmove };
      });
    coachCache.set(fen, pr);
    pr.then(v => { if (!v) coachCache.delete(fen); });
    return pr;
  }
  async function coachCheck(before, after, uci, san, ply) {
    coachPly = ply;
    hideCoach();
    const [b, a] = await Promise.all([coachEval(before, ply - 1), coachEval(after, ply)]);
    if (!alive || state.over || coachPly !== ply || !b || !a) return;
    const engineBest = b.best === uci;
    const { label } = gradeMove(b.score, a.score, user, { engineBest, givesMate: new Chess(after).isCheckmate() });
    if (!['blunder', 'mistake', 'miss'].includes(label)) return;
    const bestSan = b.best && !engineBest ? (() => { try { return playUci(new Chess(before), b.best)?.san; } catch { return null; } })() : null;
    const el = $('#coach', root);
    el.className = `coach coach-${label}`;
    el.innerHTML = `<i class="q q-${label}">${LABEL_GLYPH[label]}</i>
      <div class="grow"><b>${esc(san)}</b> was ${label === 'miss' ? 'a missed chance' : `a ${LABEL_TEXT[label].toLowerCase()}`}.${bestSan ? ` Better was <b>${esc(bestSan)}</b>.` : ''}</div>
      <button class="btn small primary" id="c-undo" type="button">${icons.undo} Take back</button>
      <button class="btn small" id="c-hide" type="button" aria-label="Keep playing">${icons.x}</button>`;
    sound('bad');
    $('#c-hide', el).addEventListener('click', hideCoach);
    $('#c-undo', el).addEventListener('click', () => {
      hideCoach();
      // undo back to just before that move (the bot's reply too, if it already came)
      const n = state.moves.length - (ply - 1);
      if (n < 1 || n > 2 || state.over) return;
      if (b.best) { const bm = uciToMove(b.best); setTimeout(() => { hintArrow = { from: bm.from, to: bm.to, color: 'rgba(16,150,110,.85)' }; render(false); }, 50); }
      takeback();
    });
  }
  function hideCoach() { $('#coach', root)?.classList.add('hidden'); }

  // ---------- bot chat: short lines from the bot, shown in a bubble that fades ----------
  function pickLine(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function say(text, force = false) {
    if (friend || (!force && settings.botChat === false) || !alive) return;
    const el = $('#chat', root);
    if (!el) return;
    el.innerHTML = `<b>${esc(level.name)}:</b> ${esc(text)}`;
    el.classList.remove('hidden');
    clearTimeout(chatTimer);
    chatTimer = setTimeout(() => el.classList.add('hidden'), 4200);
  }
  const tier = () => level.max || level.elo >= 1800 ? 'strong' : level.elo >= 1000 ? 'mid' : 'easy';
  const LINES = {
    hello: { easy: ["Hi! I'm still learning, go easy on me!", "Hello! Let's have fun."], mid: ['Good luck, have fun!', 'Ready when you are.'], strong: ["Let's see what you've got.", "Good luck. You'll need it!"] },
    gain: { easy: ['Ooh, I got something!', 'Yay, a free piece!'], mid: ['Thanks for that!', "I'll take it."], strong: ['A free gift. Thank you.', 'That one was hanging.'] },
    loss: { easy: ['Oh no, my piece!', "Oops, I didn't see that."], mid: ['Hmm, nice shot.', 'I missed that one.'], strong: ['Well spotted.', 'Hm. Good move.'] },
    check: { easy: ['Check! Did I do that right?'], mid: ['Check!'], strong: ['Check.'] },
    win: { easy: ['I won?! Wow!'], mid: ['Good game! Want a rematch?'], strong: ['Good game. Review it to see where it turned.'] },
    lose: { easy: ["You're really good! Good game!"], mid: ['Well played! You earned that.'], strong: ['Impressive. Well played.'] },
    draw: { easy: ['A draw! That was close.'], mid: ['A draw. Good fight!'], strong: ['A fair result.'] },
  };
  function chatAfterMove(m, color) {
    const ply = state.moves.length;
    if (m.captured) {
      const v = { p: 1, n: 3, b: 3, r: 5, q: 9 }[m.captured];
      // only real gains: a piece taken that cannot simply be taken back
      const back = chess.moves({ verbose: true }).some(x => x.to === m.to && x.captured);
      if (v >= 3 && !back && ply - lastChatPly >= 2) {
        lastChatPly = ply;
        say(pickLine(LINES[color === bot ? 'gain' : 'loss'][tier()]));
        return;
      }
    }
    if (color === bot && chess.inCheck() && Math.random() < 0.25 && ply - lastChatPly >= 4) {
      lastChatPly = ply;
      say(pickLine(LINES.check[tier()]));
    }
  }
  function chatEnd() {
    const r = userResult(state);
    say(pickLine(LINES[r === 'win' ? 'lose' : r === 'loss' ? 'win' : 'draw'][tier()]));
  }

  $('#b-hint', root).addEventListener('click', hint);
  $('#b-undo', root).addEventListener('click', takeback);
  $('#b-flip', root).addEventListener('click', () => { board.flip(); renderBars(); render(false); });
  $('#n-first', root).addEventListener('click', () => goTo(0));
  $('#n-prev', root).addEventListener('click', () => goTo((view == null ? state.moves.length : view) - 1));
  $('#n-next', root).addEventListener('click', () => goTo((view == null ? state.moves.length : view) + 1));
  $('#n-last', root).addEventListener('click', () => goTo(state.moves.length));
  $('#n-eval', root).addEventListener('click', toggleEval);
  const onMoveClick = (e) => {
    const el = e.target.closest('[data-i]');
    if (el) goTo(+el.dataset.i + 1);
  };
  $('#moves', root).addEventListener('click', onMoveClick);
  $('#moves-m', root).addEventListener('click', onMoveClick);
  const onKey = (e) => {
    if (e.target.closest?.('input,textarea,select,dialog') || e.altKey || e.ctrlKey || e.metaKey) return;
    const at = view == null ? state.moves.length : view;
    if (e.key === 'ArrowLeft') goTo(at - 1);
    else if (e.key === 'ArrowRight') goTo(at + 1);
    else if (e.key === 'ArrowUp') goTo(0);
    else if (e.key === 'ArrowDown') goTo(state.moves.length);
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  $('#b-resign', root).addEventListener('click', resign);
  $('#b-draw', root).addEventListener('click', offerDraw);
  $('#n-threats', root)?.addEventListener('click', () => {
    threatsOn = !threatsOn;
    store.setSettings({ showThreats: threatsOn });
    $('#n-threats', root).setAttribute('aria-pressed', String(threatsOn));
    render(false);
  });

  let ticks = 0;
  const tick = setInterval(() => {
    if (!clockActive()) return;
    renderClocks();
    // unload saves are not guaranteed to finish, so keep the stored clock fresh
    if (++ticks % 30 === 0) save();
    const c = chess.turn();
    // a warning beep when your own clock drops under 10% (max 20 s)
    if (!friend && c === user && !lowWarned && tc && live(c) < Math.min(20000, tc.base * 0.1)) { lowWarned = true; sound('lowtime'); }
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
      clearTimeout(chatTimer);
      thinkToken++;
      botEngine.cancel();
      hintEngine.cancel();
      evalToken++;
      evalEngine?.cancel();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('pagehide', onHide);
      board.destroy();
    },
  };

  render(false);
  if (!friend && !state.moves.length) setTimeout(() => say(pickLine(LINES.hello[tier()])), 400);
  if (friend) { engineState = 'ready'; setStatus(); }
  else botEngine.ready.then(() => {
    if (!alive) return;
    engineState = 'ready';
    setStatus();
    if (!state.over && chess.turn() === bot && !thinking) botTurn();
  }).catch(() => { engineState = 'error'; setStatus(); });
}

/**
 * Squares `color` could premove to while the opponent is thinking. Like chess.com, this is geometric:
 * every square a piece could reach if the board changed (recaptures onto your own piece, pinned pieces,
 * lines through pieces that may move, castling). Illegal premoves are simply dropped when they come up.
 */
export function premoveDests(chess, color) {
  const map = new Map();
  const add = (from, to) => { if (!map.has(from)) map.set(from, []); if (!map.get(from).includes(to)) map.get(from).push(to); };
  const name = (f, r) => String.fromCharCode(97 + f) + (r + 1);
  const castling = chess.fen().split(' ')[2] || '';
  const diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]], orth = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const row of chess.board()) for (const p of row) {
    if (!p || p.color !== color) continue;
    const f = p.square.charCodeAt(0) - 97, r = +p.square[1] - 1;
    const step = (df, dr) => { const nf = f + df, nr = r + dr; if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) add(p.square, name(nf, nr)); };
    if (p.type === 'p') {
      const dir = color === 'w' ? 1 : -1;
      step(0, dir);
      if (r === (color === 'w' ? 1 : 6)) step(0, 2 * dir);
      step(-1, dir); step(1, dir);
    } else if (p.type === 'n') {
      for (const [a, b] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) step(a, b);
    } else if (p.type === 'k') {
      for (const [a, b] of [...diag, ...orth]) step(a, b);
      const home = color === 'w' ? 0 : 7;
      if (r === home && f === 4) {
        if (castling.includes(color === 'w' ? 'K' : 'k')) add(p.square, name(6, home));
        if (castling.includes(color === 'w' ? 'Q' : 'q')) add(p.square, name(2, home));
      }
    } else {
      const dirs = p.type === 'b' ? diag : p.type === 'r' ? orth : [...diag, ...orth];
      for (const [a, b] of dirs) for (let k = 1; k < 8; k++) step(a * k, b * k);
    }
  }
  return map;
}

/**
 * Your pieces the opponent can win right now: attacked and undefended, or attacked by a cheaper piece.
 * (A simple check, like chess.com's "show threats"; the king is never listed.)
 */
export function threatSquares(chess, color) {
  const V = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const opp = color === 'w' ? 'b' : 'w';
  const out = [];
  for (const row of chess.board()) for (const p of row) {
    if (!p || p.color !== color || p.type === 'k') continue;
    const att = chess.attackers(p.square, opp);
    if (!att.length) continue;
    const def = chess.attackers(p.square, color);
    const cheapest = Math.min(...att.map(sq => V[chess.get(sq).type]));
    if (!def.length || cheapest < V[p.type]) out.push(p.square);
  }
  return out;
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
  if (r === 'draw') return `Draw (${state.reason === 'agreement' ? 'agreed' : state.reason})`;
  if (state.mode === 'friend') return `${state.result === '1-0' ? 'White' : 'Black'} won ${why}!`;
  if (r === 'win') return `You won ${why}!`;
  return `${level.name} won ${why}`;
}
