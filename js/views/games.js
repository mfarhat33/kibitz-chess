// History of games played in the app, newest first.
import * as store from '../store.js';
import { playTabs } from './tabs.js';
import { esc, timeAgo, icons, toast, $ } from '../ui.js';
import { fetchRecentGames, recordFromPgn } from '../game-import.js';
import { loadOpenings } from '../openings-data.js';

export function mount(root) {
  loadOpenings().catch(() => {});
  const games = store.allGames();
  const imp = { site: 'chesscom', user: '', ...store.get('import.prefs', {}) };
  const cur = store.get('play.current');
  const flt = { q: '', res: 'all', kind: 'all', ...store.get('games.filter', {}) };
  root.innerHTML = `
    ${playTabs('games')}
    <div class="page stack">
      ${cur && !cur.over ? `<a class="card row" href="#/play" style="text-decoration:none;color:inherit">${icons.start}<div class="grow"><b>Game in progress</b><div class="small muted">${cur.moves.length} moves played. Tap to continue.</div></div></a>` : ''}
      <section class="card stack">
        <div class="row between"><h3 style="margin:0">Import your games</h3><span class="tiny muted">from chess.com or Lichess</span></div>
        <div class="seg" id="g-site" role="group" aria-label="Site"><button type="button" data-v="chesscom">chess.com</button><button type="button" data-v="lichess">Lichess</button></div>
        <div class="row nowrap"><input type="text" id="g-user" placeholder="Your username" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(imp.user)}" aria-label="Username" class="grow"><button class="btn primary" id="g-fetch" type="button">${icons.download} Fetch</button></div>
        <div id="g-found" class="list"></div>
      </section>
      <section class="card">
        <div class="row between"><h2 style="margin:0">My games</h2><span class="small muted" id="g-count">${games.length} game${games.length === 1 ? '' : 's'}</span></div>
        ${games.length ? `
        <div class="stack" style="gap:8px;margin-top:10px">
          <input type="search" id="g-q" placeholder="Search opponent or opening" aria-label="Search games" value="${esc(flt.q)}">
          <div class="chips" id="g-res" role="group" aria-label="Result">
            ${[['all', 'All'], ['win', 'Wins'], ['draw', 'Draws'], ['loss', 'Losses']].map(([v, l]) => `<button type="button" class="chip" data-v="${v}">${l}</button>`).join('')}
          </div>
          <div class="chips" id="g-kind" role="group" aria-label="Type">
            ${[['all', 'All games'], ['bot', 'Vs bots'], ['imported', 'Imported'], ['friend', 'With a friend'], ['todo', 'Not reviewed']].map(([v, l]) => `<button type="button" class="chip" data-v="${v}">${l}</button>`).join('')}
          </div>
        </div>` : ''}
        <div class="list" id="g-list" style="margin-top:6px">
          ${games.length ? '' : `<div class="empty">No finished games yet.<br><a class="btn primary" style="margin-top:12px" href="#/play">${icons.start} Play your first game</a></div>`}
        </div>
      </section>
    </div>`;
  wire(root, imp);
  if (games.length) wireFilters(root, games, flt);
}

function matches(g, f) {
  if (f.res !== 'all' && g.userResult !== f.res) return false;
  if (f.kind === 'bot' && (g.imported || g.friend)) return false;
  if (f.kind === 'imported' && !g.imported) return false;
  if (f.kind === 'friend' && !g.friend) return false;
  if (f.kind === 'todo' && g.review) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = [g.botName, g.whiteName, g.blackName, g.opening?.name, g.opening?.eco, g.botLabel].filter(Boolean).join(' ').toLowerCase();
    if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

function wireFilters(root, games, flt) {
  const list = $('#g-list', root);
  const mark = (sel, v) => root.querySelectorAll(`${sel} button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  const draw = () => {
    store.set('games.filter', flt);
    mark('#g-res', flt.res);
    mark('#g-kind', flt.kind);
    const shown = games.filter(g => matches(g, flt));
    const LIMIT = 200;
    list.innerHTML = shown.length ? shown.slice(0, LIMIT).map(row).join('') + (shown.length > LIMIT ? `<div class="tiny muted" style="padding:8px">Showing the newest ${LIMIT}. Search to narrow it down.</div>` : '')
      : '<div class="empty small">No games match these filters.</div>';
    $('#g-count', root).textContent = shown.length === games.length ? `${games.length} game${games.length === 1 ? '' : 's'}` : `${shown.length} of ${games.length}`;
  };
  $('#g-q', root).addEventListener('input', (e) => { flt.q = e.target.value; draw(); });
  $('#g-res', root).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { flt.res = b.dataset.v; draw(); } });
  $('#g-kind', root).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { flt.kind = b.dataset.v; draw(); } });
  draw();
}

function wire(root, imp) {
  let site = imp.site;
  const mark = () => root.querySelectorAll('#g-site button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === site)));
  mark();
  let found = [];
  let busy = false;
  let req = 0;
  const fetchBtn = $('#g-fetch', root);
  const out = $('#g-found', root);
  $('#g-site', root).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.v === site) return;
    site = b.dataset.v;
    mark();
    // switching site drops any fetch still running for the other one
    if (busy) { req++; busy = false; fetchBtn.disabled = false; }
    found = [];
    out.innerHTML = '';
  });
  const go = async () => {
    const user = $('#g-user', root).value.trim().replace(/^@/, '');
    if (!user || busy) return;
    busy = true;
    const mine = ++req;
    store.set('import.prefs', { site, user });
    fetchBtn.disabled = true;
    out.innerHTML = '<div class="status"><span class="spinner"></span> Fetching your recent games…</div>';
    try {
      const list = await fetchRecentGames(site === 'lichess' ? 'lichess' : 'chesscom', user, 40);
      if (mine !== req || !out.isConnected) return;
      found = list.map(g => { try { return { ...g, rec: recordFromPgn(g.pgn, user, { site, date: g.date || null }) }; } catch { return null; } }).filter(Boolean);
      if (!found.length) { out.innerHTML = '<div class="empty small">No standard games found for that player.</div>'; return; }
      out.innerHTML = found.map((g, i) => {
        const r = g.rec;
        const res = { win: 'Win', loss: 'Loss', draw: 'Draw' }[r.userResult] || r.result;
        const have = !!store.get('game:' + r.id);
        return `<div class="list-item">
          <span class="color-dot ${r.userColor}"></span>
          <div class="grow"><div class="t">vs ${esc(r.botName)}${r.botLabel ? ` <span class="muted">(${esc(r.botLabel)})</span>` : ''}</div>
            <div class="s" style="white-space:normal">${timeAgo(r.date)}${g.speed ? ` · ${esc(g.speed)}` : ''} · ${Math.ceil(r.moves.length / 2)} moves · ${esc(r.opening?.name || 'Unknown opening')}</div></div>
          <span class="result-pill ${r.userResult || 'draw'}">${esc(res)}</span>
          <button class="btn small" type="button" data-review="${i}">${have ? 'Open' : 'Review'}</button>
        </div>`;
      }).join('') + `<button class="btn small" id="g-all" type="button">${icons.plus} Add all ${found.length} to My games</button>`;
      $('#g-all', out).addEventListener('click', () => {
        let n = 0;
        for (const g of found) if (!store.get('game:' + g.rec.id)) { store.set('game:' + g.rec.id, g.rec); n++; }
        toast(n ? `Added ${n} game${n === 1 ? '' : 's'}. Open one to review it.` : 'All of these are already in My games');
        mount(root);
      });
    } catch (err) {
      out.innerHTML = `<div class="status bad">${esc(err.message?.includes('fetch') ? 'Could not reach the site. Check your connection.' : err.message)}</div>`;
    } finally {
      if (mine === req) { busy = false; fetchBtn.disabled = false; }
    }
  };
  fetchBtn.addEventListener('click', go);
  $('#g-user', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  out.addEventListener('click', (e) => {
    const b = e.target.closest('[data-review]');
    if (!b) return;
    const g = found[+b.dataset.review];
    if (!store.get('game:' + g.rec.id)) store.set('game:' + g.rec.id, g.rec);
    location.hash = '#/review/' + g.rec.id;
  });
}

function row(g) {
  const accRaw = g.review?.accuracy?.[g.userColor];
  const acc = typeof accRaw === 'number' ? accRaw : null;
  const res = { win: 'Win', loss: 'Loss', draw: 'Draw' }[g.userResult] || (g.friend ? 'Friend' : g.spectator ? 'Watched' : g.result);
  const blunders = g.review ? Number(g.review.counts?.[g.userColor]?.blunder) || 0 : null;
  return `<a class="list-item" href="#/review/${encodeURIComponent(g.id)}">
    ${g.spectator ? `<span class="color-dot n" title="${g.friend ? 'Played with a friend on this device' : 'A game you watched'}"></span>` : `<span class="color-dot ${g.userColor}" title="You played ${g.userColor === 'w' ? 'White' : 'Black'}"></span>`}
    <div class="grow">
      <div class="t">${g.friend ? 'Game with a friend' : g.spectator ? `${esc(g.whiteName)} vs ${esc(g.blackName)}` : `vs ${esc(g.botName)}`}${!g.spectator && (g.botLabel || g.botElo) ? ` <span class="muted">(${esc(g.botLabel || g.botElo)})</span>` : ''}${g.imported ? ' <span class="tiny muted">· imported</span>' : ''}</div>
      <div class="s">${esc(g.opening?.name || 'Unknown opening')} · ${Math.ceil(g.moves.length / 2)} moves · ${timeAgo(g.date)}</div>
    </div>
    <div style="text-align:right">
      <div class="result-pill ${g.userResult || 'draw'}">${esc(res)}</div>
      <div class="tiny muted" style="margin-top:3px">${acc != null ? `${acc.toFixed(0)}% acc${blunders ? ` · ${blunders}??` : ''}` : 'Review'}</div>
    </div>
  </a>`;
}

export function unmount() {}
