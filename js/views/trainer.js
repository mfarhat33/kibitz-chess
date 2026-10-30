// Opening trainer: drill chosen lines with spaced repetition. You play your side; the app plays the other.
import { Board } from '../board.js';
import { Chess, dests, checkSquare, playUci, uciToMove, uciLineToSan, formatLine, colorName } from '../chessutil.js';
import * as store from '../store.js';
import { icons, esc, toast, confirm, $, moveSound, sound } from '../ui.js';
import { loadOpenings, searchLines } from '../openings-data.js';
import { newCard, reviewCard, qualityFor, dueCards, dueText, strength } from '../srs.js';

const START = new Chess().fen();
let ctx = null;

export function cards() { return store.get('trainer', { cards: [] }).cards || []; }
function saveCards(list) { store.set('trainer', { ...store.get('trainer', {}), cards: list }); }

export function addLine({ name, eco, color, moves }) {
  const list = cards();
  const card = newCard({ name, eco, color, moves });
  if (list.some(c => c.id === card.id)) return 'exists';
  saveCards([...list, card]);
  return 'added';
}

export function trainerTabs(active) {
  const due = dueCards(cards()).length;
  return `<nav class="subtabs"><a href="#/openings" class="${active === 'explorer' ? 'active' : ''}">Explorer</a><a href="#/trainer" class="${active === 'trainer' ? 'active' : ''}">Trainer${due ? ` · ${due} due` : ''}</a></nav>`;
}

export function unmount() { ctx?.destroy(); ctx = null; }

export async function mount(root) {
  loadOpenings().catch(() => {});
  const settings = store.getSettings();
  root.innerHTML = `
    ${trainerTabs('trainer')}
    <div class="stage">
      <div class="board-col">
        <div class="board-shell"><div id="board"></div></div>
        <div class="review-nav" id="t-nav" style="grid-template-columns:repeat(3,1fr)">
          <button class="btn" id="t-show" type="button">${icons.eye} Show move</button>
          <button class="btn" id="t-restart" type="button">${icons.retry} Restart</button>
          <button class="btn" id="t-stop" type="button">${icons.x} Stop</button>
        </div>
      </div>
      <div class="side-col" id="t-side"></div>
    </div>`;
  const board = new Board($('#board', root), { fen: START, coordinates: settings.coords, animate: settings.animation, onMove: (f, t, p) => drill?.userMove(f, t, p) });
  let drill = null;
  let session = [];
  let alive = true;

  const nav = $('#t-nav', root);
  const setNav = (on) => { nav.style.visibility = on ? 'visible' : 'hidden'; };
  setNav(false);

  function overview() {
    drill = null;
    setNav(false);
    board.setPosition(START, { lastMove: null });
    board.setMovable({});
    board.setArrows([]);
    board.setMarks([]);
    const list = cards();
    const due = dueCards(list);
    const side = $('#t-side', root);
    side.innerHTML = `
      <section class="card stack">
        <h1 style="margin:0">Opening trainer</h1>
        <p class="muted small" style="margin:0">Pick lines to learn. You play your side's moves and the trainer plays the replies. Lines you know well come back less often; lines you miss come back soon.</p>
        <div class="kpis">
          <div class="kpi"><div class="stat-label">Due now</div><div class="stat-big">${due.length}</div></div>
          <div class="kpi"><div class="stat-label">Lines</div><div class="stat-big">${list.length}</div></div>
          <div class="kpi"><div class="stat-label">Solid</div><div class="stat-big">${list.filter(c => strength(c) === 'solid').length}</div></div>
        </div>
        <button class="btn primary block" id="t-review" type="button" ${due.length ? '' : 'disabled'}>${icons.start} ${due.length ? `Review ${due.length} due line${due.length === 1 ? '' : 's'}` : 'Nothing due right now'}</button>
      </section>
      <section class="card stack">
        <h3 style="margin:0">Add a line</h3>
        <input type="search" id="t-search" placeholder="Search openings, e.g. Italian, Queen's Gambit" autocomplete="off" aria-label="Search openings to add">
        <div class="list" id="t-results"></div>
        <p class="tiny muted" style="margin:0">Tip: you can also build any line in the <a href="#/openings">Explorer</a> and tap the + button.</p>
      </section>
      <section class="card">
        <h3>My lines</h3>
        <div class="list" id="t-list">${list.length ? list.slice().sort((a, b) => a.due - b.due).map(cardRow).join('') : '<div class="empty small">No lines yet. Add one above.</div>'}</div>
      </section>`;
    $('#t-review', side).addEventListener('click', () => { session = dueCards(cards()).map(c => c.id); nextInSession(); });
    const search = $('#t-search', side);
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const res = searchLines(search.value, 20);
        $('#t-results', side).innerHTML = res.map(l => `
          <div class="list-item">
            <div class="grow"><div class="t">${esc(l.name)}</div><div class="s">${esc(l.eco)} · ${esc(formatLine(START, uciLineToSan(START, l.moves)))}</div></div>
            <div class="row nowrap" style="gap:6px">
              <button class="btn small" type="button" data-add="w" data-idx="${l.idx}" title="Train as White"><span class="color-dot w"></span></button>
              <button class="btn small" type="button" data-add="b" data-idx="${l.idx}" title="Train as Black"><span class="color-dot b"></span></button>
            </div>
          </div>`).join('') || (search.value.trim() ? '<div class="empty small">No openings match.</div>' : '');
      }, 150);
    });
    $('#t-results', side).addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]');
      if (!b) return;
      const l = searchLines(search.value, 20).find(x => x.idx === +b.dataset.idx);
      if (!l) return;
      const r = addLine({ name: l.name, eco: l.eco, color: b.dataset.add, moves: l.moves });
      toast(r === 'exists' ? 'Already in your lines' : `Added: ${l.name} as ${b.dataset.add === 'w' ? 'White' : 'Black'}`);
      if (r === 'added') { const q = search.value; overview(); const s2 = $('#t-search', root); s2.value = q; s2.dispatchEvent(new Event('input')); }
    });
    $('#t-list', side).addEventListener('click', async (e) => {
      const d = e.target.closest('[data-drill]');
      const del = e.target.closest('[data-del]');
      if (d) { session = [d.dataset.drill]; nextInSession(); }
      if (del) {
        const c = cards().find(x => x.id === del.dataset.del);
        if (c && await confirm('Remove this line?', `<p>${esc(c.name)}</p>`, 'Remove', true)) {
          saveCards(cards().filter(x => x.id !== c.id));
          overview();
        }
      }
    });
  }

  function cardRow(c) {
    const sans = uciLineToSan(START, c.moves);
    const st = strength(c);
    return `<div class="list-item">
      <span class="color-dot ${c.color}" title="You play ${c.color === 'w' ? 'White' : 'Black'}"></span>
      <div class="grow"><div class="t">${esc(c.name)}</div><div class="s">${esc(formatLine(START, sans))}</div>
        <div class="tiny muted">${st} · ${dueText(c)}${c.reps ? ` · every ${c.interval} day${c.interval === 1 ? '' : 's'}` : ''}</div></div>
      <div class="row nowrap" style="gap:6px">
        <button class="btn small" type="button" data-drill="${esc(c.id)}">Drill</button>
        <button class="btn small ghost" type="button" data-del="${esc(c.id)}" aria-label="Remove line">${icons.trash}</button>
      </div>
    </div>`;
  }

  function nextInSession() {
    const id = session.shift();
    const card = cards().find(c => c.id === id);
    if (!card) { overview(); return; }
    startDrill(card);
  }

  function startDrill(card) {
    setNav(true);
    const chess = new Chess();
    const user = card.color;
    const learning = !card.reps;
    let ply = 0;
    let mistakes = 0;
    let wrongHere = 0;
    let usedShow = false;
    let done = false;
    let token = 0;
    board.setOrientation(colorName(user));
    board.setMarks([]);
    const userMoves = card.moves.filter((_, i) => (i % 2 === 0) === (user === 'w')).length;

    const side = $('#t-side', root);
    side.innerHTML = `
      <section class="card stack">
        <div class="row between nowrap"><span class="tiny muted">${learning ? 'Learning a new line' : 'Review'} · you play ${user === 'w' ? 'White' : 'Black'}</span><span class="tiny muted" id="t-left">${session.length ? `${session.length} more after this` : ''}</span></div>
        <h2 style="margin:0">${esc(card.name)}</h2>
        <div class="progress"><i id="t-prog"></i></div>
        <div class="status info" id="t-status"></div>
        <div class="moves-inline" id="t-moves" style="padding:0;flex-wrap:wrap"></div>
      </section>`;

    const status = (msg, cls = 'info') => { const s = $('#t-status', root); s.className = 'status ' + cls; s.textContent = msg; };
    const myTurn = () => (ply % 2 === 0) === (user === 'w');

    function render(animate = true) {
      const h = chess.history({ verbose: true });
      const lm = h.length ? [h[h.length - 1].from, h[h.length - 1].to] : null;
      board.setPosition(chess.fen(), { lastMove: lm, check: checkSquare(chess), animate });
      board.setMovable({ color: !done && myTurn() ? colorName(user) : null, dests: !done && myTurn() ? dests(chess) : new Map() });
      const arrows = [];
      if (!done && myTurn() && (learning || wrongHere >= 2) && card.moves[ply]) {
        const m = uciToMove(card.moves[ply]);
        arrows.push({ from: m.from, to: m.to, color: 'rgba(32,150,210,.8)' });
      }
      board.setArrows(arrows);
      let html = '';
      chess.history().forEach((s, i) => { if (i % 2 === 0) html += `<span class="n">${i / 2 + 1}.</span>`; html += `<span>${esc(s)}</span>`; });
      $('#t-moves', root).innerHTML = html;
      const doneMine = card.moves.slice(0, ply).filter((_, i) => (i % 2 === 0) === (user === 'w')).length;
      $('#t-prog', root).style.width = (doneMine / Math.max(1, userMoves) * 100) + '%';
    }

    async function step() {
      if (!alive || done) return;
      if (ply >= card.moves.length) { finish(); return; }
      if (myTurn()) {
        status(learning ? 'Play the move shown by the arrow.' : wrongHere >= 2 ? 'The arrow shows the line move.' : 'Your move: play the line.');
        render();
        return;
      }
      status('Opponent replies…');
      render();
      const t = ++token;
      await new Promise(r => setTimeout(r, 420));
      if (!alive || t !== token || done) return;
      const m = playUci(chess, card.moves[ply]);
      ply++;
      moveSound(m, chess);
      step();
    }

    drill = {
      userMove(from, to, promo) {
        if (done || !myTurn()) return;
        const expected = card.moves[ply];
        const legal = chess.moves({ verbose: true }).find(x => x.from === from && x.to === to && (!x.promotion || x.promotion === (promo || 'q')));
        if (!legal) return;
        const uci = from + to + (legal.promotion || '');
        if (uci === expected) {
          const m = playUci(chess, uci);
          ply++;
          wrongHere = 0;
          moveSound(m, chess);
          board.setMarks([{ sq: to, cls: 'right' }]);
          setTimeout(() => board.setMarks([]), 350);
          step();
        } else {
          mistakes++;
          wrongHere++;
          sound('bad');
          board.shake();
          board.setMarks([{ sq: to, cls: 'wrong' }]);
          setTimeout(() => board.setMarks([]), 600);
          const san = uciLineToSan(chess.fen(), [uci])[0];
          status(wrongHere >= 2 ? `${san} is not the line move. Follow the arrow.` : `${san} is not the move in this line. Try again.`, 'bad');
          render(false);
        }
      },
      show() {
        if (done || !myTurn()) return;
        usedShow = true;
        wrongHere = 2;
        status('Here is the line move.', 'info');
        render(false);
      },
      restart() { token++; startDrill(cards().find(c => c.id === card.id) || card); },
    };

    function finish() {
      done = true;
      const q = qualityFor(mistakes, usedShow, learning);
      const updated = reviewCard(card, q);
      saveCards(cards().map(c => c.id === card.id ? updated : c));
      if (q < 3) session.push(card.id);
      sound(q >= 3 ? 'good' : 'bad');
      render();
      const side2 = $('#t-side', root);
      const ok = q >= 3;
      side2.insertAdjacentHTML('beforeend', `
        <section class="card stack">
          <div class="status ${ok ? 'ok' : 'bad'}">${ok ? icons.check : icons.retry} ${ok ? (mistakes ? 'Line complete with one slip.' : 'Perfect! Line complete.') : 'Line complete, but it needs more practice.'}</div>
          <div class="small">${ok ? `Next review ${dueText(updated)}.` : 'It will come back again in this session and in about 10 minutes.'}</div>
          <div class="grid-2">
            <button class="btn primary" id="t-next" type="button">${session.length ? `${icons.next} Next line` : `${icons.list} All lines`}</button>
            <button class="btn" id="t-again" type="button">${icons.retry} Drill again</button>
          </div>
        </section>`);
      $('#t-status', root).textContent = 'Done';
      $('#t-next', root).addEventListener('click', () => (session.length ? nextInSession() : overview()));
      $('#t-again', root).addEventListener('click', () => drill.restart());
      setNav(false);
    }

    render(false);
    step();
  }

  $('#t-show', root).addEventListener('click', () => drill?.show());
  $('#t-restart', root).addEventListener('click', () => drill?.restart());
  $('#t-stop', root).addEventListener('click', () => { session = []; overview(); });

  ctx = { destroy() { alive = false; board.destroy(); } };
  overview();
}
