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
};
const TAB_OF = {
  play: 'play', games: 'play', review: 'play', puzzles: 'puzzles', rush: 'puzzles',
  openings: 'openings', trainer: 'openings', insights: 'insights', settings: 'settings',
};

const media = matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const s = getSettings();
  const dark = s.theme === 'dark' || (s.theme === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.board = s.board;
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121419' : '#f4f2ee');
  const tt = $('#theme-toggle');
  if (tt) {
    tt.innerHTML = dark ? icons.sun : icons.moon;
    tt.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }
  try { localStorage.setItem('kibitz:theme-cache', JSON.stringify({ theme: s.theme, board: s.board })); } catch { /* ignore */ }
}

let current = null;
let routeToken = 0;

async function route() {
  const token = ++routeToken;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const name = routes[parts[0]] ? parts[0] : 'play';
  const view = $('#view');
  try { current?.unmount?.(); } catch (err) { console.error(err); }
  current = null;
  let mod;
  try {
    mod = await routes[name]();
  } catch (err) {
    console.error(err);
    view.innerHTML = '<div class="page"><div class="card">This page failed to load. Check your connection and reload.</div></div>';
    return;
  }
  if (token !== routeToken) return;
  view.innerHTML = '';
  current = mod;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === TAB_OF[name]));
  window.scrollTo(0, 0);
  try {
    await mod.mount(view, parts.slice(1));
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="page"><div class="card">Something went wrong: ${String(err.message || err)}</div></div>`;
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
