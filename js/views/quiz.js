// Quizzes: multiple-choice questions built from verified data (Lichess puzzles and the openings list).
import { Board } from '../board.js';
import { Chess, playUci, checkSquare, colorName, uciToMove } from '../chessutil.js';
import * as store from '../store.js';
import { icons, esc, $, sound } from '../ui.js';
import { pickPuzzle, loadIndex } from '../puzzle-data.js';
import { loadOpenings, lineByIndex, family } from '../openings-data.js';
import { themeName } from '../themes.js';
import { learnTabs } from './learn.js';

const COUNT = 10;
const MODES = {
  mixed: { title: 'Mixed', blurb: 'A bit of everything: best moves, mates and openings.' },
  best: { title: 'Best move', blurb: 'Pick the strongest move from four candidates.' },
  mate: { title: 'Mate in one', blurb: 'One of the four moves is checkmate. Which one?' },
  opening: { title: 'Name the opening', blurb: 'Recognise common openings from the position.' },
};
// well-known families used for opening questions
const FAMILIES = ['Sicilian Defense', 'French Defense', 'Caro-Kann Defense', 'Italian Game', 'Ruy Lopez', "Queen's Gambit Declined",
  "Queen's Gambit Accepted", 'Slav Defense', "King's Indian Defense", 'Nimzo-Indian Defense', 'English Opening', 'London System',
  'Scandinavian Defense', 'Pirc Defense', 'Dutch Defense', 'Scotch Game', 'Russian Game', 'Vienna Game', "King's Gambit",
  'Grünfeld Defense', 'Benoni Defense', 'Alekhine Defense', 'Philidor Defense', 'Four Knights Game', 'Catalan Opening', 'Modern Defense'];

let ctx = null;
export function unmount() { ctx?.destroy(); ctx = null; }

function quizData() { return { best: {}, runs: [], ...store.get('quiz', {}) }; }
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export async function mount(root) {
  const d = quizData();
  root.innerHTML = `
    ${learnTabs('quiz')}
    <div class="page stack" style="max-width:860px;margin:0 auto">
      <div class="hero"><h1 style="margin:0">Quizzes</h1><p class="muted small" style="margin:.2em 0 0">${COUNT} quick multiple-choice questions. Answers come from real Lichess puzzles and the opening database.</p></div>
      <div class="cards-2">${Object.entries(MODES).map(([k, m]) => `
        <button class="card" type="button" data-mode="${k}" style="text-align:left;cursor:pointer;font:inherit;color:inherit">
          <div class="row between nowrap"><b style="font-size:1.05rem">${m.title}</b><span class="tiny muted">best ${d.best[k] ?? '—'}/${COUNT}</span></div>
          <p class="small muted" style="margin:.4em 0 .8em">${m.blurb}</p>
          <span class="btn primary small">${icons.start} Start</span>
        </button>`).join('')}</div>
    </div>`;
  root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => run(root, b.dataset.mode)));
}

async function makeQuestion(kind, seen) {
  if (kind === 'opening') {
    const data = await loadOpenings();
    const fams = FAMILIES.filter(f => data.lines.some(l => l[1].startsWith(f)));
    for (let tries = 0; tries < 200; tries++) {
      const i = Math.floor(Math.random() * data.lines.length);
      const l = lineByIndex(i);
      const fam = family(l.name);
      if (!fams.includes(fam) || l.moves.length < 4 || l.moves.length > 14 || seen.has('o' + i)) continue;
      seen.add('o' + i);
      const c = new Chess();
      let last = null;
      for (const u of l.moves) { const m = playUci(c, u); last = [m.from, m.to]; }
      const wrong = shuffle(fams.filter(f => f !== fam)).slice(0, 3);
      return {
        kind, fen: c.fen(), last, orientation: 'white', prompt: 'Which opening is this?',
        choices: shuffle([fam, ...wrong]).map(f => ({ label: f, correct: f === fam })),
        explain: `${l.eco} · ${l.name}`,
      };
    }
  }
  const mate = kind === 'mate';
  const pz = await pickPuzzle(mate ? 700 + Math.random() * 500 : 700 + Math.random() * 800, {
    exclude: seen, spread: 300,
    filter: mate ? (p) => p.themes.includes('mateIn1') : (p) => !p.themes.includes('mateIn1'),
  });
  seen.add(pz.id);
  const c = new Chess(pz.fen);
  const om = playUci(c, pz.moves[0]);
  const sol = pz.moves[1];
  const legal = c.moves({ verbose: true });
  const solMove = legal.find(m => m.from + m.to + (m.promotion || '') === sol);
  const isMate = (m) => { const t = new Chess(c.fen()); t.move(m); return t.isCheckmate(); };
  // distractors: other legal moves, preferring forcing ones, never another mate
  let pool = legal.filter(m => m.san !== solMove.san && !isMate(m));
  const forcing = shuffle(pool.filter(m => m.captured || m.san.includes('+')));
  pool = [...forcing, ...shuffle(pool.filter(m => !forcing.includes(m)))];
  const wrong = pool.slice(0, 3);
  return {
    kind, fen: c.fen(), last: [om.from, om.to], orientation: colorName(c.turn()),
    prompt: mate ? `${c.turn() === 'w' ? 'White' : 'Black'} to move: which move is mate?` : `${c.turn() === 'w' ? 'White' : 'Black'} to move: which is the best move?`,
    choices: shuffle([solMove, ...wrong]).map(m => ({ label: m.san, correct: m.san === solMove.san, uci: m.from + m.to })),
    solution: sol,
    explain: `Lichess puzzle ${pz.id} (rated ${pz.rating}): ${pz.themes.filter(t => !['short', 'long', 'veryLong', 'oneMove'].includes(t)).map(themeName).join(', ')}`,
  };
}

async function run(root, mode) {
  const settings = store.getSettings();
  root.innerHTML = `
    ${learnTabs('quiz')}
    <div class="stage">
      <div class="board-col"><div class="board-shell"><div id="board"></div></div></div>
      <div class="side-col"><section class="card stack" id="q-card"><div class="status"><span class="spinner"></span> Preparing questions…</div></section></div>
    </div>`;
  const board = new Board($('#board', root), { coordinates: settings.coords, animate: settings.animation });
  let alive = true;
  ctx = { destroy() { alive = false; board.destroy(); } };
  try { await loadIndex(); } catch {
    $('#q-card', root).innerHTML = '<div class="status bad">Quiz data could not be loaded. Check your connection.</div>';
    return;
  }
  const card = $('#q-card', root);
  const seen = new Set();
  const results = [];
  let n = 0;
  const kinds = ['best', 'mate', 'opening'];

  async function ask() {
    if (!alive) return;
    if (n >= COUNT) { finish(); return; }
    n++;
    const kind = mode === 'mixed' ? kinds[(n - 1) % 3] : mode;
    let q;
    try { q = await makeQuestion(kind, seen); } catch (err) { card.innerHTML = `<div class="status bad">Could not build a question: ${esc(err.message)}</div>`; return; }
    if (!alive) return;
    board.setOrientation(q.orientation);
    board.setPosition(q.fen, { lastMove: q.last, check: checkSquare(new Chess(q.fen)), animate: false });
    board.setMovable({});
    board.setArrows([]);
    card.innerHTML = `
      <div class="row between nowrap"><span class="tiny muted">Question ${n} of ${COUNT}</span><span class="tiny muted">${results.filter(Boolean).length} correct</span></div>
      <div class="progress"><i style="width:${(n - 1) / COUNT * 100}%"></i></div>
      <h2 style="margin:0">${esc(q.prompt)}</h2>
      <div class="stack" id="q-choices">${q.choices.map((c, i) => `<button class="btn block" type="button" data-i="${i}" style="justify-content:flex-start">${esc(c.label)}</button>`).join('')}</div>
      <div id="q-after"></div>`;
    card.querySelector('#q-choices').addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b || card.dataset.answered === String(n)) return;
      card.dataset.answered = String(n);
      const pick = q.choices[+b.dataset.i];
      results.push(pick.correct);
      sound(pick.correct ? 'good' : 'bad');
      card.querySelectorAll('[data-i]').forEach((x, i) => {
        x.disabled = true;
        const c = q.choices[i];
        if (c.correct) x.style.cssText += ';background:color-mix(in srgb,var(--ok) 18%,var(--surface));border-color:var(--ok);color:var(--ok);opacity:1';
        else if (x === b) x.style.cssText += ';background:color-mix(in srgb,var(--bad) 14%,var(--surface));border-color:var(--bad);color:var(--bad);opacity:1';
      });
      if (q.solution) {
        const m = uciToMove(q.solution);
        board.setArrows([{ from: m.from, to: m.to, color: 'rgba(16,150,110,.85)' }]);
      }
      $('#q-after', card).innerHTML = `<div class="status ${pick.correct ? 'ok' : 'bad'}" style="margin-bottom:10px">${pick.correct ? `${icons.check} Correct!` : `${icons.x} The answer was ${esc(q.choices.find(c => c.correct).label)}.`}</div>
        <p class="tiny muted" style="margin:0 0 10px">${esc(q.explain)}</p>
        <button class="btn primary block" id="q-next" type="button">${icons.next} ${n < COUNT ? 'Next question' : 'See results'}</button>`;
      $('#q-next', card).addEventListener('click', ask);
    });
  }

  function finish() {
    const score = results.filter(Boolean).length;
    const d = quizData();
    const isBest = score > (d.best[mode] ?? -1);
    if (isBest) d.best[mode] = score;
    d.runs.push({ mode, score, t: Date.now() });
    d.runs = d.runs.slice(-100);
    store.set('quiz', d);
    sound('end');
    card.innerHTML = `
      <div class="stat-label">${esc(MODES[mode].title)} quiz</div>
      <div class="rush-score" style="font-size:3rem">${score}/${COUNT}</div>
      ${isBest ? '<div class="status ok">New best score!</div>' : `<div class="muted small">Best: ${d.best[mode]}/${COUNT}</div>`}
      <div class="rush-track">${results.map(r => `<i class="${r ? '' : 'x'}"></i>`).join('')}</div>
      <div class="grid-2"><button class="btn primary" id="q-again" type="button">${icons.retry} Again</button><a class="btn" href="#/quiz">${icons.list} All quizzes</a></div>`;
    $('#q-again', card).addEventListener('click', () => { board.destroy(); run(root, mode); });
  }
  ask();
}
