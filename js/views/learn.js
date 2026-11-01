// Learn: lessons (explanation, guided positions, themed practice puzzles) and endgame drills.
import { Board } from '../board.js';
import { Chess, dests, checkSquare, playUci, uciToMove, colorName, uciLineToSan, formatLine, gameOverInfo } from '../chessutil.js';
import { getEngine, formatScore } from '../engine.js';
import * as store from '../store.js';
import { icons, esc, toast, $, sound, moveSound } from '../ui.js';
import { LESSONS, DRILLS } from '../lessons-data.js';
import { pickPuzzle, loadIndex } from '../puzzle-data.js';
import { PuzzlePlayer } from '../puzzle-player.js';
import { themeName } from '../themes.js';

const PRACTICE_COUNT = 5;
let ctx = null;

export function unmount() { ctx?.destroy(); ctx = null; }

export function learnTabs(active) {
  const t = (id, href, label) => `<a href="${href}" class="${active === id ? 'active' : ''}">${label}</a>`;
  return `<nav class="subtabs">${t('lessons', '#/learn', 'Lessons')}${t('quiz', '#/quiz', 'Quizzes')}${t('drills', '#/learn/drills', 'Drills')}${t('coords', '#/coords', 'Coordinates')}</nav>`;
}

function progress() { return { lessons: {}, drills: {}, ...store.get('learn', {}) }; }
function saveProgress(p) { store.set('learn', p); }

export async function mount(root, params) {
  if (params[0] === 'lesson' && params[1]) return lessonView(root, params[1]);
  if (params[0] === 'drill' && params[1]) return drillView(root, params[1]);
  if (params[0] === 'drills') return drillsHub(root);
  return lessonsHub(root);
}

// ---------------- hubs ----------------
function lessonsHub(root) {
  const p = progress();
  const groups = [...new Set(LESSONS.map(l => l.group))];
  const done = LESSONS.filter(l => p.lessons[l.id]?.done).length;
  root.innerHTML = `
    ${learnTabs('lessons')}
    <div class="page stack" style="max-width:860px;margin:0 auto">
      <div class="hero"><h1 style="margin:0">Lessons</h1><p class="muted small" style="margin:.2em 0 0">Short, hands-on lessons for club players. Each one explains an idea, lets you try it, then gives you real puzzles to practise. ${done}/${LESSONS.length} completed.</p></div>
      ${groups.map(g => `
        <section class="card">
          <h3>${esc(g)}</h3>
          <div class="list">${LESSONS.filter(l => l.group === g).map(l => {
            const st = p.lessons[l.id];
            return `<a class="list-item" href="#/learn/lesson/${l.id}">
              <span class="q ${st?.done ? 'q-best' : ''}" style="${st?.done ? '' : 'background:var(--surface-3);color:var(--muted)'}">${st?.done ? '✓' : ''}</span>
              <div class="grow"><div class="t">${esc(l.title)}</div><div class="s">${esc(l.blurb)}</div></div>
              ${st?.practice != null ? `<span class="tiny muted">${st.practice}/${PRACTICE_COUNT}</span>` : ''}
              ${icons.next}
            </a>`;
          }).join('')}</div>
        </section>`).join('')}
    </div>`;
}

function drillsHub(root) {
  const p = progress();
  root.innerHTML = `
    ${learnTabs('drills')}
    <div class="page stack" style="max-width:860px;margin:0 auto">
      <div class="hero"><h1 style="margin:0">Endgame drills</h1><p class="muted small" style="margin:.2em 0 0">Play key endgames against full-strength Stockfish. Win the won positions and hold the drawn ones.</p></div>
      <section class="card"><div class="list">${DRILLS.map(d => {
        const st = p.drills[d.id];
        return `<a class="list-item" href="#/learn/drill/${d.id}">
          <span class="q ${st?.done ? 'q-best' : ''}" style="${st?.done ? '' : 'background:var(--surface-3);color:var(--muted)'}">${st?.done ? '✓' : ''}</span>
          <div class="grow"><div class="t">${esc(d.title)}</div><div class="s">${d.goal === 'hold' ? 'Hold the draw' : d.goal === 'mate' ? `Checkmate within ${d.limit} moves` : 'Promote and win'}${st?.best ? ` · best: ${st.best} moves` : ''}</div></div>
          ${icons.next}
        </a>`;
      }).join('')}</div></section>
    </div>`;
}

// ---------------- lesson player ----------------
function lessonView(root, id) {
  const lesson = LESSONS.find(l => l.id === id);
  if (!lesson) { lessonsHub(root); return; }
  const settings = store.getSettings();
  root.innerHTML = `
    ${learnTabs('lessons')}
    <div class="stage">
      <div class="board-col"><div class="board-shell"><div id="board"></div></div></div>
      <div class="side-col">
        <section class="card stack" id="l-card"></section>
      </div>
    </div>`;
  const board = new Board($('#board', root), { coordinates: settings.coords, animate: settings.animation });
  const engine = getEngine('analysis');
  let alive = true;
  let timers = [];
  let player = null;
  let stepToken = 0; // bumped on every step change so late engine answers are ignored
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const card = $('#l-card', root);
  const total = lesson.steps.length + (lesson.practice ? 1 : 0);

  const small = (ic) => ic.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"');
  // back: show a "Previous" link that returns to the step before (or the introduction)
  const header = (k, back = false) => `<div class="row between nowrap"><a class="tiny" href="#/learn">${small(icons.prev)} Lessons</a><span class="row nowrap" style="gap:10px">${back ? `<button type="button" class="linklike tiny" id="l-prevstep">${small(icons.prev)} Previous</button>` : ''}<span class="tiny muted">${k}</span></span></div><h2 style="margin:0">${esc(lesson.title)}</h2>`;
  const wireBack = (n) => $('#l-prevstep', card)?.addEventListener('click', () => (n > 0 ? step(n - 1) : intro()));

  function intro() {
    ++stepToken;
    engine.cancel();
    board.opts.onMove = null;
    board.setArrows([]);
    board.setMarks([]);
    board.setOrientation('white');
    board.setPosition(lesson.steps[0]?.fen || new Chess().fen(), { lastMove: null, animate: false });
    board.setMovable({});
    card.innerHTML = `${header('Introduction')}${lesson.intro.map(t => `<p style="margin:0">${t}</p>`).join('')}
      <button class="btn primary block" id="l-go" type="button">${icons.start} ${lesson.steps.length ? 'Try it' : 'Practise'}</button>`;
    $('#l-go', card).addEventListener('click', () => (lesson.steps.length ? step(0) : practice()));
  }

  function step(n) {
    const tok = ++stepToken;
    engine.cancel();
    board.opts.onMove = null;
    const s = lesson.steps[n];
    if (!s) { if (lesson.practice) practice(); else finish(null); return; }
    if (s.type === 'show') { showStep(n, s); return; }
    const chess = new Chess(s.fen);
    const me = chess.turn();
    let ply = 0;
    let last = null;
    let busy = false;
    board.setOrientation(colorName(me));
    board.setArrows([]);
    board.setMarks([]);
    card.innerHTML = `${header(`Step ${n + 1} of ${total}`, true)}
      <p style="margin:0">${esc(s.text)}</p>
      <div class="status info" id="l-status">${me === 'w' ? 'White' : 'Black'} to move</div>
      <div class="grid-2"><button class="btn" id="l-show" type="button">${icons.eye} Show me</button><button class="btn" id="l-skip" type="button">${icons.next} Skip</button></div>`;
    wireBack(n);
    const status = (html, cls = 'info') => { const e = $('#l-status', card); if (e) { e.className = 'status ' + cls; e.innerHTML = html; } };
    const render = () => {
      board.setPosition(chess.fen(), { lastMove: last, check: checkSquare(chess) });
      const mine = chess.turn() === me && ply < s.line.length && !busy;
      board.setMovable({ color: mine ? colorName(me) : null, dests: mine ? dests(chess) : new Map() });
    };
    const success = (extra = '') => {
      sound('good');
      board.setMovable({});
      card.querySelector('.grid-2').outerHTML = `<button class="btn primary block" id="l-next" type="button">${icons.next} ${n + 1 < lesson.steps.length ? 'Next' : lesson.practice ? 'Practice puzzles' : 'Finish'}</button>`;
      status(`${icons.check} ${extra}${esc(s.success)}`, 'ok');
      $('#l-next', card).addEventListener('click', () => step(n + 1));
    };
    const play = (uci) => {
      const m = playUci(chess, uci);
      last = [m.from, m.to];
      moveSound(m, chess);
      ply++;
    };
    const advance = () => {
      if (ply >= s.line.length) { render(); success(); return; }
      if (chess.turn() !== me) {
        busy = true;
        render();
        later(() => { if (!alive || tok !== stepToken) return; play(s.line[ply]); busy = false; advance(); }, 450);
        return;
      }
      render();
      status('Your move', 'info');
    };
    board.opts.onMove = async (from, to, promo) => {
      if (busy || tok !== stepToken || chess.turn() !== me) return;
      const legal = chess.moves({ verbose: true }).find(m => m.from === from && m.to === to && (!m.promotion || m.promotion === (promo || 'q')));
      if (!legal) return;
      const uci = from + to + (legal.promotion || '');
      const expected = [s.line[ply], ...(ply === 0 ? s.accept || [] : [])];
      const isLast = ply === s.line.length - 1;
      const test = new Chess(chess.fen());
      playUci(test, uci);
      if (expected.includes(uci) || (s.anyMate && isLast && test.isCheckmate())) {
        play(uci);
        board.setMarks([{ sq: to, cls: 'right' }]);
        later(() => board.setMarks([]), 350);
        advance();
        return;
      }
      // not the lesson move: a strict step wants that idea; otherwise ask Stockfish if it is just as good
      const san = legal.san;
      if (!s.strict) {
        busy = true;
        // show the move while Stockfish checks it, and lock the board meanwhile
        board.setPosition(test.fen(), { lastMove: [from, to], check: checkSquare(test) });
        board.setMovable({});
        status('<span class="spinner"></span> Checking your move…');
        const before = chess.fen();
        const lessonSan = uciLineToSan(before, [s.line[ply]])[0];
        const r1 = await engine.analyze(before, { depth: 14, multipv: 1 });
        const r2 = await engine.analyze(test.fen(), { depth: 14, multipv: 1 });
        busy = false;
        if (!alive || tok !== stepToken || chess.fen() !== before) return;
        if (r1 && r2 && r1.lines[0] && r2.lines[0]) {
          const sc = (l) => (l.mate != null ? (l.mate > 0 ? 100000 - l.mate : -100000 - l.mate) : l.cp);
          const best = sc(r1.lines[0]);
          const mine = -sc(r2.lines[0]);
          const good = mine >= best - 30 || (best >= 300 && mine >= 300) || (best > 50000 && mine > 50000) || (test.isCheckmate());
          if (good) {
            play(uci);
            render();
            success(`${esc(san)} works too! The lesson move was ${esc(lessonSan)}. `);
            return;
          }
        }
      }
      sound('bad');
      board.shake();
      board.setMarks([{ sq: to, cls: 'wrong' }]);
      later(() => { if (tok !== stepToken) return; board.setMarks([]); render(); }, 600);
      status(s.strict ? `${esc(san)} is playable, but it is not the idea of this step. Try again.` : `${esc(san)} is not the right idea. Try again, or tap Show me.`, 'bad');
    };
    $('#l-show', card).addEventListener('click', () => {
      if (chess.turn() !== me || ply >= s.line.length) return;
      const m = uciToMove(s.line[ply]);
      board.setArrows([{ from: m.from, to: m.to, color: 'rgba(32,150,210,.85)' }]);
    });
    $('#l-skip', card).addEventListener('click', () => step(n + 1));
    render();
    advance();
  }

  // "show" step: a position to look at, with optional arrows and an optional line to play through
  function showStep(n, s) {
    const nextLabel = n + 1 < lesson.steps.length ? 'Next' : lesson.practice ? 'Practice puzzles' : 'Finish';
    const arrows = (s.arrows || []).map(u => ({ ...uciToMove(u), color: 'rgba(32,150,210,.85)' }));
    const sans = s.line ? uciLineToSan(s.fen, s.line) : [];
    let chess = new Chess(s.fen);
    const reset = () => {
      chess = new Chess(s.fen);
      board.setPosition(s.fen, { lastMove: null, check: checkSquare(chess), animate: false });
      board.setArrows(arrows);
    };
    board.setOrientation(s.orientation || colorName(chess.turn()));
    board.setMarks([]);
    board.setMovable({});
    reset();
    card.innerHTML = `${header(`Step ${n + 1} of ${total}`, true)}
      <p style="margin:0">${esc(s.text)}</p>
      ${sans.length ? `<div class="status info" id="l-status">Tap <b>Play the moves</b> to see how it goes.</div>` : ''}
      ${sans.length ? `<div class="grid-2"><button class="btn" id="l-play" type="button">${icons.start} Play the moves</button><button class="btn primary" id="l-next" type="button">${icons.next} ${nextLabel}</button></div>`
        : `<button class="btn primary block" id="l-next" type="button">${icons.next} ${nextLabel}</button>`}`;
    $('#l-next', card).addEventListener('click', () => step(n + 1));
    wireBack(n);
    $('#l-play', card)?.addEventListener('click', () => {
      const playTok = ++stepToken; // also cancels a playback already running
      reset();
      board.setArrows([]);
      const status = $('#l-status', card);
      let i = 0;
      const tick = () => {
        if (!alive || playTok !== stepToken) return;
        const m = playUci(chess, s.line[i]);
        if (!m) return;
        moveSound(m, chess);
        board.setPosition(chess.fen(), { lastMove: [m.from, m.to], check: checkSquare(chess) });
        i++;
        status.innerHTML = esc(formatLine(s.fen, sans.slice(0, i)));
        if (i < s.line.length) later(tick, 900);
        else if (s.after) { status.className = 'status ok'; status.innerHTML = `${esc(formatLine(s.fen, sans))}<br>${esc(s.after)}`; }
      };
      later(tick, 400);
    });
  }

  async function practice() {
    ++stepToken;
    engine.cancel();
    board.opts.onMove = null;
    const cfg = lesson.practice;
    let k = 0, solved = 0;
    const seen = new Set();
    board.setArrows([]);
    try { await loadIndex(); } catch {
      card.innerHTML = `${header('Practice')}<div class="status bad">Practice puzzles could not be loaded.</div>`;
      return;
    }
    const nextOne = async () => {
      if (!alive) return;
      if (k >= PRACTICE_COUNT) { finish(solved); return; }
      k++;
      card.innerHTML = `${header(`Practice ${k} of ${PRACTICE_COUNT}`)}<div class="theme-tags">${cfg.themes.map(t => `<span>${esc(themeName(t))}</span>`).join('')}</div><div class="status info" id="l-status"><span class="spinner"></span> Loading puzzle…</div>
        <div class="grid-2 grid-3"><button class="btn" id="l-hint" type="button">${icons.hint} Hint</button><button class="btn" id="l-sol" type="button">${icons.eye} Solution</button><button class="btn" id="l-pskip" type="button">${icons.next} Skip</button></div>`;
      const target = cfg.min + Math.random() * (cfg.max - cfg.min);
      let pz;
      try {
        pz = await pickPuzzle(target, { exclude: seen, spread: (cfg.max - cfg.min) / 2, filter: (p) => p.rating >= cfg.min - 100 && p.rating <= cfg.max + 100 && cfg.themes.some(t => p.themes.includes(t)) });
      } catch { return; }
      if (!alive) return;
      seen.add(pz.id);
      let clean = true;
      const status = (html, cls = 'info') => { const e = $('#l-status', card); if (e) { e.className = 'status ' + cls; e.innerHTML = html; } };
      player?.destroy();
      player = new PuzzlePlayer(board, pz, {
        onStep: (pl) => { if (pl.chess.turn() === pl.solver) status(`Find the best move for <b>${pl.solverName}</b> · rated ${pz.rating}`); },
        onWrong: (pl, uci, san) => { clean = false; sound('bad'); status(`${esc(san)} is not it. Try again.`, 'bad'); },
        onSolved: () => {
          if (clean) solved++;
          sound('good');
          status(`${icons.check} ${clean ? 'Solved!' : 'Solved, after a retry.'}`, 'ok');
          card.querySelector('.grid-2').outerHTML = `<button class="btn primary block" id="l-next" type="button">${icons.next} ${k < PRACTICE_COUNT ? 'Next puzzle' : 'Finish lesson'}</button>`;
          $('#l-next', card).addEventListener('click', nextOne);
        },
      });
      player.start();
      $('#l-hint', card).addEventListener('click', () => { clean = false; player.hint(); });
      $('#l-pskip', card).addEventListener('click', () => { clean = false; player?.destroy(); player = null; nextOne(); });
      $('#l-sol', card).addEventListener('click', () => {
        clean = false;
        status('Here is the solution.', 'info');
        player.showSolution(() => {
          const g = card.querySelector('.grid-2');
          if (g) {
            g.outerHTML = `<button class="btn primary block" id="l-next" type="button">${icons.next} ${k < PRACTICE_COUNT ? 'Next puzzle' : 'Finish lesson'}</button>`;
            $('#l-next', card).addEventListener('click', nextOne);
          }
        });
      });
    };
    nextOne();
  }

  function finish(score) {
    const p = progress();
    p.lessons[lesson.id] = { done: true, t: Date.now(), practice: score };
    saveProgress(p);
    sound('end');
    const i = LESSONS.findIndex(l => l.id === lesson.id);
    const nextL = LESSONS[i + 1];
    card.innerHTML = `${header('Complete')}
      <div class="status ok">${icons.check} Lesson complete${score != null ? `: ${score} of ${PRACTICE_COUNT} puzzles solved cleanly` : ''}.</div>
      <div class="grid-2">
        ${nextL ? `<a class="btn primary" href="#/learn/lesson/${nextL.id}">${icons.next} Next lesson</a>` : `<a class="btn primary" href="#/learn">${icons.list} All lessons</a>`}
        <button class="btn" id="l-again" type="button">${icons.retry} Again</button>
      </div>`;
    $('#l-again', card).addEventListener('click', intro);
  }

  ctx = { destroy() { alive = false; timers.forEach(clearTimeout); player?.destroy(); engine.cancel(); board.destroy(); } };
  intro();
}

// ---------------- drills ----------------
function drillView(root, id) {
  const drill = DRILLS.find(d => d.id === id);
  if (!drill) { drillsHub(root); return; }
  const settings = store.getSettings();
  root.innerHTML = `
    ${learnTabs('drills')}
    <div class="stage">
      <div class="board-col"><div class="board-shell"><div id="board"></div></div></div>
      <div class="side-col">
        <section class="card stack">
          <div class="row between nowrap"><a class="tiny" href="#/learn/drills">Drills</a><span class="tiny muted" id="d-count"></span></div>
          <h2 style="margin:0">${esc(drill.title)}</h2>
          <p class="small muted" style="margin:0">${esc(drill.text)}</p>
          <div class="status info" id="d-status"></div>
        </section>
        <div class="btn-row">
          <button class="btn" id="d-hint" type="button">${icons.hint}<span>Hint</span></button>
          <button class="btn" id="d-undo" type="button">${icons.undo}<span>Takeback</span></button>
          <button class="btn" id="d-restart" type="button">${icons.retry}<span>Restart</span></button>
        </div>
      </div>
    </div>`;
  const board = new Board($('#board', root), { coordinates: settings.coords, animate: settings.animation, onMove: (f, t, p) => userMove(f, t, p) });
  const opp = getEngine('bot');
  const hintEng = getEngine('analysis');
  let chess, me, myMoves, over, last, token = 0, alive = true, hintsUsed = 0;

  const status = (html, cls = 'info') => { const e = $('#d-status', root); e.className = 'status ' + cls; e.innerHTML = html; };
  const goalText = () => drill.goal === 'mate' ? `Checkmate within ${drill.limit} moves.` : drill.goal === 'promote' ? 'Promote your pawn and keep a winning position.' : `Hold the draw for ${drill.limit} moves.`;

  function render() {
    board.setPosition(chess.fen(), { lastMove: last, check: checkSquare(chess) });
    const mine = !over && chess.turn() === me;
    board.setMovable({ color: mine ? colorName(me) : null, dests: mine ? dests(chess) : new Map() });
    $('#d-count', root).textContent = `move ${myMoves} / ${drill.limit}`;
  }

  function start() {
    token++;
    opp.newGame();
    chess = new Chess(drill.fen);
    me = drill.side || chess.turn();
    myMoves = 0; over = false; last = null; hintsUsed = 0;
    board.setOrientation(colorName(me));
    board.setArrows([]);
    render();
    status(goalText());
    if (chess.turn() !== me) engineReply();
  }

  function end(ok, msg) {
    over = true;
    render();
    sound(ok ? 'good' : 'bad');
    status(`${ok ? icons.check : icons.x} ${esc(msg)}`, ok ? 'ok' : 'bad');
    if (ok) {
      const p = progress();
      const prev = p.drills[drill.id];
      p.drills[drill.id] = { done: true, t: Date.now(), best: Math.min(prev?.best || Infinity, myMoves) };
      saveProgress(p);
    }
  }

  async function afterMine(m) {
    const t = token;
    const info = gameOverInfo(chess);
    if (info) {
      if (info.reason === 'checkmate') end(true, drill.goal === 'hold' ? 'Checkmate! Even better than a draw.' : `Checkmate in ${myMoves} moves!`);
      else end(drill.goal === 'hold', drill.goal === 'hold' ? `Draw by ${info.reason}. Well held!` : `Draw by ${info.reason}. The win slipped away.`);
      return;
    }
    if (drill.goal === 'promote' && m.promotion) {
      status('<span class="spinner"></span> Checking the position…');
      const r = await hintEng.analyze(chess.fen(), { depth: 16 });
      if (!alive || t !== token) return;
      const l = r?.lines[0];
      const mine = l ? -(l.mate != null ? (l.mate > 0 ? 100000 : -100000) : l.cp) : 0;
      if (mine >= 400) { end(true, `Promoted and winning after ${myMoves} moves!`); return; }
      end(false, 'You promoted, but the new piece is lost or the win is gone. Try again.');
      return;
    }
    if (drill.goal !== 'hold' && myMoves >= drill.limit) { end(false, `Out of moves: no ${drill.goal === 'mate' ? 'mate' : 'promotion'} within ${drill.limit}.`); return; }
    if (drill.goal === 'hold' && myMoves >= drill.limit) { end(true, `You held for ${drill.limit} moves. Draw secured!`); return; }
    engineReply();
  }

  async function engineReply() {
    const t = token;
    status('<span class="spinner"></span> Stockfish is thinking…');
    const r = await opp.analyze(chess.fen(), { depth: 20, movetime: 500 });
    if (!alive || t !== token) return;
    if (!r?.bestmove) { status('The engine stopped responding. Tap Restart to try again.', 'bad'); return; }
    const om = playUci(chess, r.bestmove);
    last = [om.from, om.to];
    moveSound(om, chess);
    const info2 = gameOverInfo(chess);
    if (info2) {
      if (info2.reason === 'checkmate') end(false, 'You were checkmated.');
      else end(drill.goal === 'hold', drill.goal === 'hold' ? `Draw by ${info2.reason}. Well held!` : `Draw by ${info2.reason}.`);
      return;
    }
    if (drill.goal === 'hold' && om.promotion) { end(false, 'The pawn promoted. Try again.'); return; }
    render();
    status(goalText());
  }

  function userMove(from, to, promo) {
    if (over || chess.turn() !== me) return;
    const legal = chess.moves({ verbose: true }).find(m => m.from === from && m.to === to && (!m.promotion || m.promotion === (promo || 'q')));
    if (!legal) return;
    const m = playUci(chess, from + to + (legal.promotion || ''));
    last = [m.from, m.to];
    myMoves++;
    board.setArrows([]);
    moveSound(m, chess);
    render();
    afterMine(m);
  }

  $('#d-hint', root).addEventListener('click', async () => {
    if (over || chess.turn() !== me) return;
    const fen = chess.fen();
    const r = await hintEng.analyze(fen, { depth: 18, movetime: 1500 });
    if (!alive || chess.fen() !== fen || !r?.bestmove) return;
    hintsUsed++;
    const b = uciToMove(r.bestmove);
    board.setArrows([{ from: b.from, to: b.to, color: 'rgba(32,150,210,.85)' }]);
  });
  $('#d-undo', root).addEventListener('click', () => {
    if (myMoves === 0) return;
    token++;
    opp.cancel();
    hintEng.cancel();
    over = false;
    // if Stockfish has not answered yet (thinking, or the drill ended on your move) undo just your move
    if (chess.turn() !== me) chess.undo();
    else { chess.undo(); chess.undo(); }
    myMoves--;
    const h = chess.history({ verbose: true });
    last = h.length ? [h[h.length - 1].from, h[h.length - 1].to] : null;
    render();
    status(goalText());
  });
  $('#d-restart', root).addEventListener('click', start);
  ctx = { destroy() { alive = false; token++; opp.cancel(); hintEng.cancel(); board.destroy(); } };
  start();
}
