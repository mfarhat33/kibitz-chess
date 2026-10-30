// History of games played in the app, newest first.
import * as store from '../store.js';
import { esc, timeAgo, icons } from '../ui.js';

export function mount(root) {
  const games = store.allGames();
  const cur = store.get('play.current');
  root.innerHTML = `
    <nav class="subtabs"><a href="#/play">New game</a><a href="#/games" class="active">My games</a></nav>
    <div class="page stack">
      ${cur && !cur.over ? `<a class="card row" href="#/play" style="text-decoration:none;color:inherit">${icons.start}<div class="grow"><b>Game in progress</b><div class="small muted">${cur.moves.length} moves played. Tap to continue.</div></div></a>` : ''}
      <section class="card">
        <div class="row between"><h2 style="margin:0">My games</h2><span class="small muted">${games.length} game${games.length === 1 ? '' : 's'}</span></div>
        <div class="list" style="margin-top:6px">
          ${games.length ? games.map(row).join('') : `<div class="empty">No finished games yet.<br><a class="btn primary" style="margin-top:12px" href="#/play">${icons.start} Play your first game</a></div>`}
        </div>
      </section>
    </div>`;
}

function row(g) {
  const acc = g.review?.accuracy?.[g.userColor];
  const res = { win: 'Win', loss: 'Loss', draw: 'Draw' }[g.userResult];
  const blunders = g.review ? g.review.counts[g.userColor].blunder : null;
  return `<a class="list-item" href="#/review/${encodeURIComponent(g.id)}">
    <span class="color-dot ${g.userColor}" title="You played ${g.userColor === 'w' ? 'White' : 'Black'}"></span>
    <div class="grow">
      <div class="t">vs ${esc(g.botName)} <span class="muted">(${esc(g.botLabel || g.botElo)})</span></div>
      <div class="s">${esc(g.opening?.name || 'Unknown opening')} · ${Math.ceil(g.moves.length / 2)} moves · ${timeAgo(g.date)}</div>
    </div>
    <div style="text-align:right">
      <div class="result-pill ${g.userResult}">${res}</div>
      <div class="tiny muted" style="margin-top:3px">${acc != null ? `${acc.toFixed(0)}% acc${blunders ? ` · ${blunders}??` : ''}` : 'Review'}</div>
    </div>
  </a>`;
}

export function unmount() {}
