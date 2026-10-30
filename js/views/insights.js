// Insights: results, accuracy and blunders over time; splits by colour, opening and phase; puzzle trends.
import * as store from '../store.js';
import { positions, phaseStats } from '../analysis.js';
import { family } from '../openings-data.js';
import { lineChart, stackedBars, legend, hbars } from '../charts.js';
import { themeName, isTactical } from '../themes.js';
import { esc, icons, fmtDate } from '../ui.js';

const WEEK = 7 * 86400000;

export function computeInsights(games, puzzles, rush) {
  // only games you played count (not imported games you just watched, nor ones without a result)
  const chron = [...games].filter(g => !g.spectator && g.userResult).sort((a, b) => a.date - b.date);
  const reviewed = chron.filter(g => g.review && g.review.accuracy?.[g.userColor] != null);
  const score = (gs) => gs.length ? gs.reduce((s, g) => s + (g.userResult === 'win' ? 1 : g.userResult === 'draw' ? 0.5 : 0), 0) / gs.length : null;
  const wdl = (gs) => ({
    win: gs.filter(g => g.userResult === 'win').length,
    draw: gs.filter(g => g.userResult === 'draw').length,
    loss: gs.filter(g => g.userResult === 'loss').length,
  });
  const myAcc = (g) => g.review.accuracy[g.userColor];
  const myCount = (g, l) => Number(g.review.counts[g.userColor]?.[l]) || 0;
  const avg = (xs) => { const v = xs.filter(x => typeof x === 'number' && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

  // weekly results (weeks start Monday)
  const weekKey = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const weeks = new Map();
  for (const g of chron) {
    const k = weekKey(g.date);
    if (!weeks.has(k)) weeks.set(k, []);
    weeks.get(k).push(g);
  }
  const weekly = [...weeks.entries()].slice(-12).map(([k, gs]) => ({ week: k, ...wdl(gs) }));

  const byColor = {};
  for (const c of ['w', 'b']) {
    const gs = chron.filter(g => g.userColor === c);
    const rv = gs.filter(g => reviewed.includes(g));
    byColor[c] = { games: gs.length, ...wdl(gs), score: score(gs), acc: avg(rv.map(myAcc)), blunders: avg(rv.map(g => myCount(g, 'blunder'))) };
  }

  const fam = new Map();
  for (const g of chron) {
    const f = family(g.opening?.name);
    if (!fam.has(f)) fam.set(f, []);
    fam.get(f).push(g);
  }
  const byOpening = [...fam.entries()].map(([name, gs]) => {
    const rv = gs.filter(g => reviewed.includes(g));
    return { name, games: gs.length, ...wdl(gs), score: score(gs), acc: avg(rv.map(myAcc)), whiteGames: gs.filter(g => g.userColor === 'w').length };
  }).sort((a, b) => b.games - a.games);

  const phases = { opening: { moves: 0, accSum: 0, blunders: 0, mistakes: 0, games: 0 }, middlegame: { moves: 0, accSum: 0, blunders: 0, mistakes: 0, games: 0 }, endgame: { moves: 0, accSum: 0, blunders: 0, mistakes: 0, games: 0 } };
  for (const g of reviewed) {
    const ps = phaseStats(g.review, positions(g.moves), g.userColor);
    for (const k of Object.keys(phases)) {
      if (!ps[k].moves) continue;
      phases[k].moves += ps[k].moves;
      phases[k].accSum += ps[k].accSum;
      phases[k].blunders += ps[k].blunders;
      phases[k].mistakes += ps[k].mistakes;
      phases[k].games++;
    }
  }

  const attempts = puzzles?.attempts || [];
  const themeStats = new Map();
  for (const a of attempts) {
    for (const t of a.themes || []) {
      if (!isTactical(t)) continue;
      const s = themeStats.get(t) || { n: 0, ok: 0 };
      s.n++;
      s.ok += a.ok === 1 ? 1 : 0;
      themeStats.set(t, s);
    }
  }
  const themes = [...themeStats.entries()].map(([k, s]) => ({ key: k, name: themeName(k), n: s.n, rate: s.ok / s.n }));
  const weakest = themes.filter(t => t.n >= 3).sort((a, b) => a.rate - b.rate || b.n - a.n).slice(0, 8);

  return {
    total: chron.length,
    ...wdl(chron),
    score: score(chron),
    reviewedCount: reviewed.length,
    recentAcc: avg(reviewed.slice(-10).map(myAcc)),
    recentBlunders: avg(reviewed.slice(-10).map(g => myCount(g, 'blunder'))),
    accSeries: reviewed.map((g, i) => ({ x: i, y: myAcc(g), tip: `${fmtDate(g.date)} vs ${g.botName}` })),
    errSeries: reviewed.slice(-30).map(g => ({ label: '', tip: `${fmtDate(g.date)} vs ${g.botName}`, b: myCount(g, 'blunder'), m: myCount(g, 'mistake') + (myCount(g, 'miss') || 0), i: myCount(g, 'inaccuracy') })),
    weekly, byColor, byOpening, phases,
    puzzleRating: puzzles?.rating ?? null,
    puzzleSeries: ratedSeries(attempts.filter(a => a.mode !== 'rush')),
    puzzleCount: attempts.filter(a => a.mode !== 'rush').length,
    puzzleSolved: attempts.filter(a => a.mode !== 'rush' && a.ok === 1).length,
    weakest,
    rushBest: rush?.best || {},
  };
}

function ratedSeries(rated) {
  if (!rated.length) return [];
  return [{ x: 0, y: rated[0].before, tip: 'Start' }, ...rated.map((a, i) => ({ x: i + 1, y: a.after, tip: fmtDate(a.t) }))];
}

function rolling(points, n) {
  return points.map((p, i) => {
    const w = points.slice(Math.max(0, i - n + 1), i + 1);
    return { x: p.x, y: w.reduce((s, q) => s + q.y, 0) / w.length, tip: p.tip };
  });
}

const pct = (v) => v == null ? '—' : `${Math.round(v * 100)}%`;
const num = (v, d = 1) => v == null ? '—' : v.toFixed(d);

export function mount(root) {
  const games = store.allGames();
  const d = computeInsights(games, store.get('puzzles'), store.get('rush'));
  const unreviewed = d.total - d.reviewedCount;
  root.innerHTML = `
    <div class="page stack">
      <div class="hero"><h1 style="margin:0">Insights</h1><p class="muted small" style="margin:.2em 0 0">Based on ${d.total} game${d.total === 1 ? '' : 's'} played here (${d.reviewedCount} reviewed) and ${d.puzzleCount} puzzle attempt${d.puzzleCount === 1 ? '' : 's'}.</p></div>
      <div class="kpis">
        <div class="kpi"><div class="stat-label">Games</div><div class="stat-big">${d.total}</div><div class="tiny muted">${d.win}W · ${d.draw}D · ${d.loss}L</div></div>
        <div class="kpi"><div class="stat-label">Score</div><div class="stat-big">${pct(d.score)}</div><div class="tiny muted">points won</div></div>
        <div class="kpi"><div class="stat-label">Accuracy</div><div class="stat-big">${num(d.recentAcc)}</div><div class="tiny muted">last 10 reviewed</div></div>
        <div class="kpi"><div class="stat-label">Blunders</div><div class="stat-big">${num(d.recentBlunders)}</div><div class="tiny muted">per game, last 10</div></div>
        <div class="kpi"><div class="stat-label">Puzzle rating</div><div class="stat-big">${d.puzzleRating != null ? Math.round(d.puzzleRating) : '—'}</div><div class="tiny muted">${d.puzzleSolved}/${d.puzzleCount} solved</div></div>
        <div class="kpi"><div class="stat-label">Rush best</div><div class="stat-big">${d.rushBest[3] ?? '—'} / ${d.rushBest[5] ?? '—'}</div><div class="tiny muted">3 min / 5 min</div></div>
      </div>
      ${!d.total ? `<div class="card empty">Play a few games against the bots and review them to unlock game insights.<br><a class="btn primary" style="margin-top:12px" href="#/play">${icons.start} Play a game</a></div>` : ''}
      ${unreviewed > 0 ? `<div class="status info small">${unreviewed} game${unreviewed === 1 ? ' is' : 's are'} not reviewed yet, so accuracy and blunder charts leave ${unreviewed === 1 ? 'it' : 'them'} out. <a href="#/games">Review from My games</a></div>` : ''}
      <div class="cards-2">
        <section class="card"><h3>Results by week</h3><div id="c-results"></div>${legend([{ name: 'Wins', color: 'var(--status-good)' }, { name: 'Draws', color: 'var(--status-neutral)' }, { name: 'Losses', color: 'var(--status-bad)' }])}</section>
        <section class="card"><h3>Accuracy over time</h3><div id="c-acc"></div>${legend([{ name: 'Game accuracy', color: 'var(--series-1)' }, { name: '5-game average', color: 'var(--series-2)' }])}</section>
        <section class="card"><h3>Errors per game</h3><div id="c-err"></div>${legend([{ name: 'Blunders', color: 'var(--q-blunder)' }, { name: 'Mistakes & misses', color: 'var(--q-mistake)' }, { name: 'Inaccuracies', color: 'var(--q-inaccuracy)' }])}</section>
        <section class="card"><h3>By game phase</h3><div id="c-phase"></div><p class="tiny muted" style="margin:.6em 0 0">Your accuracy in each phase, with blunders per game that reached it.</p></section>
        <section class="card"><h3>By colour</h3>${colorTable(d.byColor)}</section>
        <section class="card"><h3>By opening</h3>${openingTable(d.byOpening)}</section>
        <section class="card"><h3>Puzzle rating</h3><div id="c-puz"></div></section>
        <section class="card"><h3>Weakest puzzle themes</h3><div id="c-themes"></div><p class="tiny muted" style="margin:.6em 0 0">Success rate on first try, themes with at least 3 attempts.</p></section>
      </div>
    </div>`;

  stackedBars(root.querySelector('#c-results'), d.weekly.map(w => ({
    label: new Date(w.week).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    tip: `Week of ${fmtDate(w.week)}`,
    parts: [{ key: 'win', value: w.win }, { key: 'draw', value: w.draw }, { key: 'loss', value: w.loss }],
  })), [{ key: 'win', name: 'Wins', color: 'var(--status-good)' }, { key: 'draw', name: 'Draws', color: 'var(--status-neutral)' }, { key: 'loss', name: 'Losses', color: 'var(--status-bad)' }]);

  lineChart(root.querySelector('#c-acc'), [
    { name: 'Game accuracy', color: 'var(--series-1)', points: d.accSeries },
    { name: '5-game average', color: 'var(--series-2)', points: rolling(d.accSeries, 5) },
  ], { yMin: 0, yMax: 100, yFmt: v => `${Math.round(v)}`, xLabel: i => `#${i + 1}` });

  stackedBars(root.querySelector('#c-err'), d.errSeries.map((g, i) => ({
    label: `${i + 1}`, tip: g.tip,
    parts: [{ key: 'b', value: g.b }, { key: 'm', value: g.m }, { key: 'i', value: g.i }],
  })), [{ key: 'b', name: 'Blunders', color: 'var(--q-blunder)' }, { key: 'm', name: 'Mistakes & misses', color: 'var(--q-mistake)' }, { key: 'i', name: 'Inaccuracies', color: 'var(--q-inaccuracy)' }]);

  const ph = d.phases;
  root.querySelector('#c-phase').innerHTML = d.reviewedCount ? hbars(['opening', 'middlegame', 'endgame'].filter(k => ph[k].moves).map(k => ({
    label: `${k[0].toUpperCase() + k.slice(1)} · ${(ph[k].blunders / ph[k].games).toFixed(1)} blunders`,
    value: ph[k].accSum / ph[k].moves, max: 100, text: `${Math.round(ph[k].accSum / ph[k].moves)}%`,
    color: 'var(--series-1)', title: `${ph[k].moves} moves in ${ph[k].games} games`,
  }))) : '<div class="empty small">Review games to see phase accuracy.</div>';

  const ys = d.puzzleSeries.map(p => p.y);
  const pad = ys.length ? Math.max(20, (Math.max(...ys) - Math.min(...ys)) * 0.15) : 0;
  lineChart(root.querySelector('#c-puz'), [{ name: 'Rating', color: 'var(--series-1)', points: d.puzzleSeries }], {
    xLabel: i => (i === 0 ? 'start' : `#${i}`), yMin: ys.length ? Math.min(...ys) - pad : undefined, yMax: ys.length ? Math.max(...ys) + pad : undefined,
  });

  root.querySelector('#c-themes').innerHTML = d.weakest.length ? hbars(d.weakest.map(t => ({
    label: t.name, value: t.rate * 100, max: 100, text: `${Math.round(t.rate * 100)}% (${t.n})`, color: 'var(--series-2)',
  }))) : '<div class="empty small">Solve more puzzles to find your weak spots.</div>';
}

function colorTable(bc) {
  const row = (c, label) => {
    const s = bc[c];
    return `<tr><td><span class="row nowrap" style="gap:8px"><span class="color-dot ${c}"></span>${label}</span></td><td class="num">${s.games}</td><td class="num">${s.win}/${s.draw}/${s.loss}</td><td class="num">${pct(s.score)}</td><td class="num">${num(s.acc)}</td><td class="num">${num(s.blunders)}</td></tr>`;
  };
  return `<table class="table"><thead><tr><th>Colour</th><th class="num">Games</th><th class="num">W/D/L</th><th class="num">Score</th><th class="num">Acc.</th><th class="num">Blund.</th></tr></thead><tbody>${row('w', 'White')}${row('b', 'Black')}</tbody></table>`;
}

function openingTable(rows) {
  if (!rows.length) return '<div class="empty small">No games yet.</div>';
  return `<div style="overflow-x:auto"><table class="table"><thead><tr><th>Opening</th><th class="num">Games</th><th class="num">Score</th><th class="num">Acc.</th></tr></thead><tbody>${rows.slice(0, 10).map(r => `<tr><td>${esc(r.name)}</td><td class="num">${r.games}</td><td class="num">${pct(r.score)}</td><td class="num">${num(r.acc)}</td></tr>`).join('')}</tbody></table></div>`;
}

export function unmount() {}
