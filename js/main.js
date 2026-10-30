// App shell: storage init, theme, hash router.
import { initStore, getSettings, setSettings } from './store.js';
import { icons, logo, $, $$ } from './ui.js';

const routes = {
  play: () => import('./views/play.js'),
  games: () => import('./views/games.js'),
  review: () => import('./views/review.js'),
  puzzles: () => import('./views/puzzles.js'),
  rush: () => import('./views/rush.js'),
  openings: () => import('./views/openings.js'),
  trainer: () => import('./views/trainer.js'),
  insights: () => import('./views/insights.js'),
  settings: () => import('./views/settings.js'),
  analysis: () => import('./views/analysis-board.js'),
  learn: () => import('./views/learn.js'),
  quiz: () => import('./views/quiz.js'),
  coords: () => import('./views/coords.js'),
};
const TAB_OF = {
  play: 'play', games: 'play', review: 'play', puzzles: 'puzzles', rush: 'puzzles',
  openings: 'openings', trainer: 'openings', insights: 'insights', settings: 'settings',
  analysis: 'play', learn: 'learn', quiz: 'learn', coords: 'learn',
};

const media = matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const s = getSettings();
  const dark = s.theme === 'dark' || (s.theme === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.board = s.board;
  document.documentElement.dataset.pieces = s.pieces;
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121419' : '#f4f2ee');
  const tt = $('#theme-toggle');
  if (tt) {
    tt.innerHTML = dark ? icons.sun : icons.moon;
    tt.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }
  try { localStorage.setItem('kibitz:theme-cache', JSON.stringify({ theme: s.theme, board: s.board, pieces: s.pieces })); } catch { /* ignore */ }
}

let current = null;
let routeToken = 0;

async function route() {
  const token = ++routeToken;
  const isCurrent = () => token === routeToken;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(p => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
  const name = routes[parts[0]] ? parts[0] : 'play';
  const view = $('#view');
  try { current?.unmount?.(); } catch (err) { console.error(err); }
  current = null;
  let mod;
  try {
    mod = await routes[name]();
  } catch (err) {
    console.error(err);
    if (isCurrent()) view.innerHTML = '<div class="page"><div class="card">This page failed to load. Check your connection and reload.</div></div>';
    return;
  }
  if (!isCurrent()) return;
  // every page gets its own container, so a page that finishes loading late cannot paint over the next one
  const container = document.createElement('div');
  view.replaceChildren(container);
  current = mod;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === TAB_OF[name]));
  $('#settings-link')?.classList.toggle('active', name === 'settings');
  window.scrollTo(0, 0);
  try {
    await mod.mount(container, parts.slice(1), isCurrent);
  } catch (err) {
    console.error(err);
    if (isCurrent()) container.innerHTML = `<div class="page"><div class="card">Something went wrong: ${String(err.message || err).replace(/</g, '&lt;')}</div></div>`;
  }
  // the user moved on while this page was still loading: release what it set up
  if (!isCurrent() && current !== mod) {
    try { mod.unmount?.(); } catch (err) { console.error(err); }
  }
}

async function boot() {
  $('#logo').innerHTML = logo;
  $$('[data-icon]').forEach(e => { e.outerHTML = icons[e.dataset.icon]; });
  await initStore();
  applyTheme();
  media.addEventListener('change', applyTheme);
  $('#theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    setSettings({ theme: dark ? 'light' : 'dark' });
    applyTheme();
  });
  window.addEventListener('hashchange', route);
  await route();
  if ('serviceWorker' in navigator && !/[?&]nosw\b/.test(location.search)) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('service worker', err));
  }
}

boot();
