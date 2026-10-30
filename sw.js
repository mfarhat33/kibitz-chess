// Offline support: network first (so updates arrive straight away), cache as fallback.
const CACHE = 'kibitz-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'img/icon.svg',
  'js/main.js', 'js/store.js', 'js/ui.js', 'js/board.js', 'js/chessutil.js', 'js/lib/chess.js', 'js/poskey.js',
  'js/engine.js', 'js/bot.js', 'js/analysis.js', 'js/explain.js', 'js/charts.js', 'js/srs.js', 'js/themes.js',
  'js/openings-data.js', 'js/puzzle-data.js', 'js/puzzle-player.js',
  'js/views/play.js', 'js/views/games.js', 'js/views/review.js', 'js/views/puzzles.js', 'js/views/rush.js',
  'js/views/openings.js', 'js/views/trainer.js', 'js/views/insights.js', 'js/views/settings.js',
  'engine/stockfish-19-lite-single.js', 'engine/stockfish-19-lite-single.wasm',
  'data/openings.json', 'data/puzzles/index.json',
  ...['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'].map(p => `img/pieces/${p}.svg`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return cache.match('index.html');
      throw err;
    }
  })());
});
