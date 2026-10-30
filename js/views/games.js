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
        <div class="row between"><h2 style="margin:0">My games</h2><span class="small muted">${games.length} game${games.length === 1 ? '' : 's'}</span></div>
        <div class="list" style="margin-top:6px">
          ${games.length ? games.map(row).join('') : `<div class="empty">No finished games yet.<br><a class="btn primary" style="margin-top:12px" href="#/play">${icons.start} Play your first game</a></div>`}
        </div>
      </section>
    </div>`;
  wire(root, imp);
}

function wire(root, imp) {
  let site = imp.site;
  const mark = () => root.querySelectorAll('#g-site button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === site)));
  mark();
  $('#g-site', root).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { site = b.dataset.v; mark(); } });
  let found = [];
  const fetchBtn = $('#g-fetch', root);
  const out = $('#g-found', root);
  const go = async () => {
    const user = $('#g-user', root).value.trim();
    if (!user) return;
    store.set('import.prefs', { site, user });
    fetchBtn.disabled = true;
    out.innerHTML = '<div class="status"><span class="spinner"></span> Fetching your recent games…</div>';
    try {
      const list = await fetchRecentGames(site === 'lichess' ? 'lichess' : 'chesscom', user, 20);
      found = list.map(g => { try { return { ...g, rec: recordFromPgn(g.pgn, user, { site }) }; } catch { return null; } }).filter(Boolean);
      if (!found.length) { out.innerHTML = '<div class="empty small">No standard games found for that player.</div>'; return; }
      out.innerHTML = found.map((g, i) => {
        const r = g.rec;
        const res = { win: 'Win', loss: 'Loss', draw: 'Draw' }[r.userResult] || r.result;
        const have = !!store.get('game:' + r.id);
        return `<div class="list-item">
          <span class="color-dot ${r.userColor}"></span>
          <div class="grow"><div class="t">vs ${esc(r.botName)}${r.botLabel ? ` <span class="muted">(${esc(r.botLabel)})</span>` : ''}</div>
            <div class="s">${esc(r.opening?.name || 'Unknown opening')} · ${Math.ceil(r.moves.length / 2)} moves · ${esc(g.speed || '')} · ${timeAgo(r.date)}</div></div>
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
      fetchBtn.disabled = false;
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
  const res = { win: 'Win', loss: 'Loss', draw: 'Draw' }[g.userResult] || (g.spectator ? 'Watched' : g.result);
  const blunders = g.review ? Number(g.review.counts?.[g.userColor]?.blunder) || 0 : null;
  return `<a class="list-item" href="#/review/${encodeURIComponent(g.id)}">
    <span class="color-dot ${g.userColor}" title="You played ${g.userColor === 'w' ? 'White' : 'Black'}"></span>
    <div class="grow">
      <div class="t">${g.spectator ? `${esc(g.whiteName)} vs ${esc(g.blackName)}` : `vs ${esc(g.botName)}`}${!g.spectator && (g.botLabel || g.botElo) ? ` <span class="muted">(${esc(g.botLabel || g.botElo)})</span>` : ''}${g.imported ? ' <span class="tiny muted">· imported</span>' : ''}</div>
      <div class="s">${esc(g.opening?.name || 'Unknown opening')} · ${Math.ceil(g.moves.length / 2)} moves · ${timeAgo(g.date)}</div>
    </div>
    <div style="text-align:right">
      <div class="result-pill ${g.userResult || 'draw'}">${esc(res)}</div>
      <div class="tiny muted" style="margin-top:3px">${acc != null ? `${acc.toFixed(0)}% acc${blunders ? ` · ${blunders}??` : ''}` : 'Review'}</div>
    </div>
  </a>`;
}

export function unmount() {}
