// Coach: the Monday report on what is costing you games, a 7-day plan, bulk import and analysis.
import * as store from '../store.js';
import { icons, esc, $, toast, fmtDate, timeAgo } from '../ui.js';
import { hbars } from '../charts.js';
import { themeName } from '../themes.js';
import { fetchRecentGames, recordFromPgn } from '../game-import.js';
import { loadOpenings } from '../openings-data.js';
import { startReview } from '../review-run.js';
import { DEPTHS } from '../analysis.js';
import {
  CATS, weeklyReport, reportWeek, weekStart, weekPlan, adviceFor, trendText, patternStats, themeFor,
} from '../coach.js';
import * as sync from '../sync.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const IMPORT_MAX = 200;

// ---------- bulk analysis: lives at module level so it keeps going while you use other pages ----------
const batch = { running: false, queue: [], done: 0, total: 0, current: null, pos: 0, posTotal: 0, started: 0, cancelled: false, failed: 0 };
const batchListeners = new Set();
const ping = () => batchListeners.forEach(fn => { try { fn(); } catch { /* gone */ } });
let wakeLock = null;

export function unanalysed(games) {
  return games.filter(g => !g.spectator && g.userResult && !g.review && g.moves.length >= 4).sort((a, b) => b.date - a.date);
}

async function runBatch(games) {
  if (batch.running) return;
  await loadOpenings().catch(() => {});
  Object.assign(batch, { running: true, queue: games.map(g => g.id), done: 0, total: games.length, started: Date.now(), cancelled: false, failed: 0 });
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
  ping();
  for (const id of batch.queue) {
    if (batch.cancelled) break;
    const g = store.get('game:' + id);
    if (!g || g.review) { batch.done++; continue; }
    batch.current = g;
    batch.pos = 0;
    batch.posTotal = g.moves.length + 1;
    const job = startReview(g, DEPTHS.fast);
    const off = job.listen((d, t) => { batch.pos = d; batch.posTotal = t; ping(); });
    ping();
    const r = await job.promise;
    off();
    if (!r && !batch.cancelled) batch.failed++;
    batch.done++;
    ping();
  }
  batch.running = false;
  batch.current = null;
  try { await wakeLock?.release(); } catch { /* already released */ }
  wakeLock = null;
  ping();
}

function stopBatch() {
  batch.cancelled = true;
  if (batch.current) import('../review-run.js').then(m => m.cancelReview(batch.current?.id));
}

// ---------- page ----------
let offs = [];
export function unmount() { offs.forEach(f => f()); offs = []; }

export function mount(root) {
  unmount();
  const games = store.allGames();
  const now = Date.now();
  const repStart = reportWeek(now);
  const rep = weeklyReport(games, repStart);
  const thisWeek = weekStart(now);
  const plan = weekPlan(rep.top);
  const done = store.get('coach', {}).done || {};
  const todayIdx = (new Date(now).getDay() + 6) % 7;
  const allTime = patternStats(games);
  const imp = { site: 'chesscom', user: '', ...store.get('import.prefs', {}) };
  const syncCfg = sync.getConfig();
  const empty = allTime.games === 0;
  const w = rep.week, p = rep.prev;
  const diff = (a, b, d = 0, unit = '') => (a == null || b == null ? '' : ` (${a - b >= 0 ? '+' : ''}${(a - b).toFixed(d)}${unit} vs the week before)`);
  const scope = rep.widened === 'all' ? 'all your reviewed games' : rep.widened === '4w' ? 'the last 4 weeks (last week alone had fewer than 5 reviewed games)' : 'last week';

  root.innerHTML = `
    <div class="page stack" style="max-width:820px;margin:0 auto">
      <div class="hero"><h1 style="margin:0">Coach</h1><p class="muted small" style="margin:.2em 0 0">Monday report for the week of ${fmtDate(repStart)}. Blunt by design: what cost you points, and what to do about it.</p></div>

      ${empty ? '' : `
      <section class="card stack">
        <h3 style="margin:0">Last week</h3>
        ${w.played ? `<p style="margin:0"><b>${w.played} game${w.played === 1 ? '' : 's'}: ${w.win}W ${w.draw}D ${w.loss}L.</b>${w.acc != null ? ` Accuracy ${w.acc.toFixed(0)}${diff(w.acc, p.acc)}.` : ''}${w.blundersPerGame != null ? ` ${w.blundersPerGame.toFixed(1)} blunders per game${diff(w.blundersPerGame, p.blundersPerGame, 1)}.` : ''}</p>`
          : '<p style="margin:0"><b>No games last week.</b> Patterns only change if you play. Two rapid games this week is the minimum.</p>'}
        <p class="small muted" style="margin:0">Patterns below are from ${scope}: ${rep.windowGames} reviewed game${rep.windowGames === 1 ? '' : 's'}, ${rep.errors} error${rep.errors === 1 ? '' : 's'}.</p>
      </section>

      <h2 style="margin:6px 0 0">What is costing you games</h2>
      ${rep.top.length ? rep.top.map((t, i) => patternCard(t, i, rep.windowGames)).join('') : '<div class="card empty small">No mistakes, misses or blunders in this window. Play more, or analyse your imported games below.</div>'}

      <section class="card stack">
        <div class="row between"><h3 style="margin:0">This week's plan</h3><span class="tiny muted">15 to 20 minutes a day</span></div>
        <div class="stack" style="gap:6px">${plan.map(d => dayRow(d, thisWeek, done, todayIdx)).join('')}</div>
      </section>

      <section class="card stack">
        <h3 style="margin:0">All-time picture</h3>
        <div id="c-all"></div>
        <p class="tiny muted" style="margin:0">Bar length: game points each pattern cost you (1 per loss it decided, 0.5 per draw). ${allTime.games} reviewed games.</p>
      </section>`}

      <section class="card stack" id="c-data">
        <div class="row between"><h3 style="margin:0">Your games</h3><span class="tiny muted">${games.filter(g => !g.spectator).length} games · ${allTime.games} reviewed</span></div>
        ${empty ? '<p class="small" style="margin:0">The coach needs reviewed games. Import your chess.com history and analyse it here (best on the laptop, plugged in).</p>' : ''}
        <div class="row nowrap"><input type="text" id="c-user" placeholder="chess.com username" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(imp.site === 'lichess' ? '' : imp.user)}" aria-label="chess.com username" class="grow"><button class="btn" id="c-import" type="button">${icons.download} Import last ${IMPORT_MAX}</button></div>
        <div id="c-import-status"></div>
        <div id="c-batch"></div>
        <p class="tiny muted" style="margin:0">${syncCfg.token ? `Sync is on${syncCfg.lastSync ? `, last synced ${esc(timeAgo(syncCfg.lastSync))}` : ''}. Analyse on one device and the reviews reach the other.` : 'Tip: turn on <a href="#/settings">Sync</a> so games analysed on the laptop show up on your phone.'}</p>
      </section>
    </div>`;

  if (!empty) {
    const max = Math.max(1, ...allTime.list.map(x => x.points));
    $('#c-all', root).innerHTML = hbars(allTime.list.filter(x => x.count).map(x => ({
      label: CATS[x.cat].name, sub: `${x.count} errors · ${x.perGame.toFixed(1)} per game`,
      value: x.points, max, text: `${x.points} pt${x.points === 1 ? '' : 's'}`, color: 'var(--q-blunder)',
    })));
  }

  // plan ticks
  root.querySelectorAll('[data-tick]').forEach(cb => cb.addEventListener('change', () => {
    const c = store.get('coach', {});
    const d = { ...(c.done || {}) };
    if (cb.checked) d[cb.dataset.tick] = Date.now(); else delete d[cb.dataset.tick];
    store.set('coach', { ...c, done: d });
  }));
  // puzzle links pick the theme first
  root.querySelectorAll('[data-theme]').forEach(a => a.addEventListener('click', () => store.set('puzzles.theme', a.dataset.theme)));

  wireImport(root);
  const drawBatch = () => renderBatch(root);
  batchListeners.add(drawBatch);
  offs.push(() => batchListeners.delete(drawBatch));
  drawBatch();
}

function patternCard(t, i, games) {
  const th = themeFor(t);
  const ex = t.examples.slice(0, 3);
  return `<section class="card stack">
    <div class="row nowrap" style="gap:10px;align-items:flex-start">
      <div class="stat-big" style="min-width:1.4em;color:var(--q-blunder)">${i + 1}</div>
      <div class="grow stack" style="gap:6px">
        <h3 style="margin:0">${esc(CATS[t.cat].name)}</h3>
        <p style="margin:0">${esc(adviceFor(t, games))}</p>
        <p class="tiny muted" style="margin:0">${esc(trendText(t))}</p>
        ${ex.length ? `<div class="list">${ex.map(e => `<a class="list-item" href="#/review/${encodeURIComponent(e.gameId)}/${e.ply}"><div class="grow"><div class="t">${esc(e.san)} <span class="tq-${e.label}" style="font-weight:700">${e.label}</span>${e.decisive ? ' <span class="tiny muted">· lost the game</span>' : ''}</div><div class="s">move ${Math.floor(e.ply / 2) + 1} · ${esc(timeAgo(e.date))}</div></div>${icons.next}</a>`).join('')}</div>` : ''}
        <div class="row" style="gap:8px">
          <a class="btn small primary" href="#/mistakes/${t.cat}">${icons.target} Drill these</a>
          ${th ? `<a class="btn small" href="#/puzzles" data-theme="${th}">${icons.puzzle} ${esc(themeName(th))} puzzles</a>` : ''}
        </div>
      </div>
    </div>
  </section>`;
}

const HREF = { mistakes: (it) => `#/mistakes/${it.cat}`, puzzles: () => '#/puzzles', openings: () => '#/trainer', learn: () => '#/learn', play: () => '#/play' };

function dayRow(d, week, done, today) {
  return `<div class="list-item" style="align-items:flex-start;${d.day === today ? 'border-color:var(--accent);' : ''}">
    <div style="min-width:3em;font-weight:700;${d.day === today ? 'color:var(--accent)' : ''}">${DAYS[d.day]}</div>
    <div class="grow stack" style="gap:4px">${d.items.map((it, j) => {
      const id = `${week}:${d.day}:${j}`;
      return `<label class="row nowrap small" style="gap:8px;align-items:flex-start"><input type="checkbox" data-tick="${id}" ${done[id] ? 'checked' : ''} style="margin-top:3px"><span class="grow">${esc(it.text)} <a href="${HREF[it.kind](it)}"${it.theme != null ? ` data-theme="${esc(it.theme)}"` : ''}>Go</a> <span class="tiny muted">${it.minutes} min</span></span></label>`;
    }).join('')}</div>
  </div>`;
}

function wireImport(root) {
  const btn = $('#c-import', root);
  const out = $('#c-import-status', root);
  btn.addEventListener('click', async () => {
    const user = $('#c-user', root).value.trim().replace(/^@/, '');
    if (!user) { $('#c-user', root).focus(); return; }
    btn.disabled = true;
    out.innerHTML = `<div class="status"><span class="spinner"></span> Fetching up to ${IMPORT_MAX} games from chess.com…</div>`;
    try {
      store.set('import.prefs', { site: 'chesscom', user });
      await loadOpenings().catch(() => {});
      const list = await fetchRecentGames('chesscom', user, IMPORT_MAX);
      let added = 0, skipped = 0, watched = 0;
      for (const g of list) {
        let rec;
        try { rec = recordFromPgn(g.pgn, user, { site: 'chesscom', date: g.date || null }); } catch { skipped++; continue; }
        if (rec.spectator) { watched++; continue; }
        if (store.get('game:' + rec.id)) { skipped++; continue; }
        store.set('game:' + rec.id, rec);
        added++;
      }
      toast(`Imported ${added} new game${added === 1 ? '' : 's'}`);
      if (!out.isConnected) return;
      mount(root);
      const o2 = $('#c-import-status', root);
      if (o2) o2.innerHTML = `<div class="status ok small">${list.length} games found: ${added} new, ${skipped} already here or unreadable${watched ? `, ${watched} not yours` : ''}. Now analyse them below.</div>`;
    } catch (err) {
      out.innerHTML = `<div class="status bad small">${esc(err.message?.includes('fetch') ? 'Could not reach chess.com. Check your connection.' : err.message)}</div>`;
      btn.disabled = false;
    }
  });
}

function renderBatch(root) {
  const el = $('#c-batch', root);
  if (!el) return;
  if (batch.running) {
    const elapsed = Date.now() - batch.started;
    const frac = batch.total ? (batch.done + (batch.posTotal ? batch.pos / batch.posTotal : 0)) / batch.total : 0;
    const eta = frac > 0.02 ? Math.max(0, elapsed / frac - elapsed) : null;
    el.innerHTML = `<div class="stack" style="gap:6px">
      <div class="row between small"><span><span class="spinner"></span> Analysing game ${Math.min(batch.done + 1, batch.total)} of ${batch.total}${batch.current ? ` vs ${esc(batch.current.botName)}` : ''}</span><span class="tiny muted">${eta != null ? `about ${fmtDur(eta)} left` : 'estimating…'}</span></div>
      <div class="progress"><i style="width:${(frac * 100).toFixed(1)}%"></i></div>
      <div class="row between"><span class="tiny muted">Keep this tab open. You can use other pages meanwhile.</span><button class="btn small" id="c-stop" type="button">${icons.x} Stop</button></div>
    </div>`;
    $('#c-stop', el).addEventListener('click', stopBatch);
    return;
  }
  const pending = unanalysed(store.allGames());
  const finished = batch.total && batch.done ? `<div class="status ${batch.failed ? 'bad' : 'ok'} small">${batch.cancelled ? 'Stopped' : 'Done'}: ${batch.done - batch.failed} game${batch.done - batch.failed === 1 ? '' : 's'} analysed${batch.failed ? `, ${batch.failed} failed` : ''}. <a href="#/coach" id="c-refresh">Refresh the report</a></div>` : '';
  el.innerHTML = `${finished}${pending.length ? `<button class="btn primary block" id="c-run" type="button">${icons.start} Analyse ${pending.length} game${pending.length === 1 ? '' : 's'} (fast depth, newest first)</button>
    <p class="tiny muted" style="margin:0">Roughly ${fmtDur(pending.length * 35000)} on a laptop; stop any time and resume later. Phones are slower.</p>` : (batch.total ? '' : '<p class="tiny muted" style="margin:0">Every game you played is reviewed.</p>')}`;
  $('#c-run', el)?.addEventListener('click', () => runBatch(pending));
  $('#c-refresh', el)?.addEventListener('click', (e) => { e.preventDefault(); batch.total = 0; mount(root); });
}

function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

