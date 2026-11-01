// Progress storage: an in-memory map mirrored to IndexedDB (localStorage fallback).
// Everything lives in the browser; export/import moves it between devices.

const DB_NAME = 'kibitz-chess';
const STORE = 'kv';
const LS_PREFIX = 'kibitz:';
const cache = new Map();
let db = null;
let useLS = false;
const listeners = new Set();
// keep other open tabs in step: each tab has its own cache, so tell them about every write
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('kibitz-store') : null;
channel?.unref?.(); // Node only: do not keep test processes alive
if (channel) {
  channel.onmessage = (e) => {
    const { key, value, deleted } = e.data || {};
    if (typeof key !== 'string') return;
    if (deleted) cache.delete(key); else cache.set(key, value);
    listeners.forEach(fn => fn(key));
  };
}

export async function initStore() {
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const st = tx.objectStore(STORE);
      const keysReq = st.getAllKeys();
      const valsReq = st.getAll();
      tx.oncomplete = () => {
        keysReq.result.forEach((k, i) => cache.set(k, valsReq.result[i]));
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('IndexedDB unavailable, using localStorage', err);
    useLS = true;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(LS_PREFIX)) cache.set(k.slice(LS_PREFIX.length), JSON.parse(localStorage.getItem(k)));
      }
    } catch { /* storage blocked: run in memory only */ }
  }
}

export function get(key, fallback = null) {
  return cache.has(key) ? cache.get(key) : fallback;
}

export function set(key, value) {
  cache.set(key, value);
  persist(key, value);
  try { channel?.postMessage({ key, value }); } catch { /* value not cloneable: other tabs reload it later */ }
  listeners.forEach(fn => fn(key));
}

export function del(key) {
  cache.delete(key);
  persist(key, undefined);
  try { channel?.postMessage({ key, deleted: true }); } catch { /* ignore */ }
  listeners.forEach(fn => fn(key));
}

export function keys(prefix = '') {
  return [...cache.keys()].filter(k => k.startsWith(prefix));
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function persist(key, value) {
  if (useLS || !db) {
    try {
      if (value === undefined) localStorage.removeItem(LS_PREFIX + key);
      else localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    } catch (err) { console.warn('save failed', err); }
    return;
  }
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    if (value === undefined) st.delete(key); else st.put(value, key);
    tx.onerror = () => console.warn('save failed', tx.error);
  } catch (err) { console.warn('save failed', err); }
}

// ---------- typed helpers ----------
export function getSettings() {
  return {
    theme: 'system', board: 'slate', pieces: 'cburnett', autoQueen: false, playEval: false, showThreats: false, botChat: true, coach: false, reviewLines: false, figurine: false, boardSize: 'm', showDests: true, premoves: true, lastMove: true, sound: true, coords: true, animation: true,
    reviewDepth: 'standard', ...get('settings', {}),
  };
}
export function setSettings(patch) { set('settings', { ...getSettings(), ...patch }); }

export function allGames() {
  return keys('game:').map(k => get(k)).filter(Boolean).sort((a, b) => b.date - a.date);
}

// ---------- export / import ----------
export const EXPORT_FORMAT = 'kibitz-chess-progress';

export function exportData() {
  const data = {};
  for (const [k, v] of cache) data[k] = v;
  return { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), data };
}

export function validateImport(obj) {
  if (!obj || obj.format !== EXPORT_FORMAT || typeof obj.data !== 'object' || obj.data === null || Array.isArray(obj.data)) {
    throw new Error('This file is not a Kibitz Chess progress file.');
  }
  return { ...obj, data: sanitize(obj.data) };
}

// ---------- import sanitising: progress files are untrusted, so keep only well-typed values ----------
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const ucis = (a) => (Array.isArray(a) ? a.filter(u => typeof u === 'string' && UCI.test(u)).slice(0, 1000) : []);
const strs = (a, max = 60) => (Array.isArray(a) ? a.filter(x => typeof x === 'string').map(x => x.slice(0, max)).slice(0, 2000) : []);
const LABEL_SET = new Set(['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'miss', 'mistake', 'blunder']);
const score = (e) => (e && typeof e === 'object' ? { cp: e.cp == null ? null : num(e.cp), mate: e.mate == null ? null : num(e.mate), ...(e.win === 'w' || e.win === 'b' ? { win: e.win } : {}) } : { cp: 0, mate: null });

function cleanReview(r, n) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.labels) || r.labels.length !== n) return null;
  const counts = { w: {}, b: {} };
  for (const c of ['w', 'b']) for (const k of LABEL_SET) counts[c][k] = num(r.counts?.[c]?.[k]);
  return {
    v: num(r.v, 1), depth: num(r.depth), date: num(r.date),
    evals: (r.evals || []).slice(0, n + 1).map(score),
    best: (r.best || []).slice(0, n + 1).map(u => (typeof u === 'string' && UCI.test(u) ? u : null)),
    pv: (r.pv || []).slice(0, n + 1).map(ucis),
    second: Array.isArray(r.second) ? r.second.slice(0, n + 1).map(x => (x ? { ...score(x), move: UCI.test(x.move || '') ? x.move : null } : null)) : undefined,
    labels: r.labels.map(l => (LABEL_SET.has(l) ? l : 'good')),
    acc: (r.acc || []).map(x => num(x)), loss: (r.loss || []).map(x => num(x)),
    phases: (r.phases || []).map(p => (['opening', 'middlegame', 'endgame'].includes(p) ? p : 'middlegame')),
    accuracy: { w: r.accuracy?.w == null ? null : num(r.accuracy.w), b: r.accuracy?.b == null ? null : num(r.accuracy.b) },
    counts,
  };
}

function cleanGame(g) {
  if (!g || typeof g !== 'object') return null;
  const moves = ucis(g.moves);
  const colour = g.userColor === 'b' ? 'b' : 'w';
  return {
    id: str(g.id, 40), imported: !!g.imported, spectator: !!g.spectator, friend: !!g.friend,
    date: num(g.date, Date.now()), endedAt: num(g.endedAt), startFen: g.startFen ? str(g.startFen, 100) : undefined,
    whiteName: str(g.whiteName, 60) || undefined, blackName: str(g.blackName, 60) || undefined,
    userColor: colour, botElo: num(g.botElo), botName: str(g.botName, 60) || 'Bot', botLabel: str(String(g.botLabel ?? ''), 20),
    tc: g.tc ? str(g.tc, 20) : null, moves, sans: strs(g.sans, 10).slice(0, moves.length),
    result: ['1-0', '0-1', '1/2-1/2', '*'].includes(g.result) ? g.result : '*', reason: str(g.reason, 60),
    userResult: ['win', 'loss', 'draw'].includes(g.userResult) ? g.userResult : null,
    opening: g.opening ? { eco: str(g.opening.eco, 4), name: str(g.opening.name, 120) } : null,
    takebacks: num(g.takebacks), hints: num(g.hints), review: cleanReview(g.review, moves.length),
    ...(Array.isArray(g.moveClocks) ? {
      tcBase: num(g.tcBase) || null, tcInc: num(g.tcInc) || 0,
      moveClocks: g.moveClocks.slice(0, moves.length).map(x => (Number.isFinite(+x) && x !== null ? Math.max(0, Math.round(+x)) : null)),
    } : {}),
  };
}

function sanitize(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('game:')) { const g = cleanGame(v); if (g && g.id && 'game:' + g.id === k) out[k] = g; continue; }
    switch (k) {
      case 'puzzles': out[k] = {
        rating: num(v?.rating, 1100),
        attempts: (Array.isArray(v?.attempts) ? v.attempts : []).map(a => ({
          id: str(a?.id, 12), t: num(a?.t), pr: num(a?.pr), ok: [0, 0.5, 1].includes(a?.ok) ? a.ok : 0,
          before: num(a?.before), after: num(a?.after), themes: strs(a?.themes, 40), mode: a?.mode === 'rush' ? 'rush' : 'rated',
        })).filter(a => a.id),
      }; break;
      case 'rush': out[k] = {
        best: Object.fromEntries(Object.entries(v?.best || {}).filter(([m]) => m === '3' || m === '5' || m === '0').map(([m, x]) => [m, num(x)])),
        runs: (Array.isArray(v?.runs) ? v.runs : []).map(r => ({ mode: r?.mode === 5 ? 5 : r?.mode === 0 ? 0 : 3, score: num(r?.score), t: num(r?.t), strikes: num(r?.strikes), maxRating: num(r?.maxRating), reason: str(r?.reason, 20) })),
      }; break;
      case 'trainer': out[k] = {
        cards: (Array.isArray(v?.cards) ? v.cards : []).map(c => ({
          id: str(c?.id, 4000), name: str(c?.name, 120), eco: str(c?.eco, 4), color: c?.color === 'b' ? 'b' : 'w', moves: ucis(c?.moves),
          ease: num(c?.ease, 2.5), interval: num(c?.interval), reps: num(c?.reps), lapses: num(c?.lapses), due: num(c?.due), last: num(c?.last), created: num(c?.created),
          history: (Array.isArray(c?.history) ? c.history : []).map(h => ({ t: num(h?.t), q: num(h?.q) })).slice(-30),
        })).filter(c => c.moves.length),
      }; break;
      case 'learn': out[k] = {
        lessons: Object.fromEntries(Object.entries(v?.lessons || {}).map(([id, x]) => [str(id, 40), { done: !!x?.done, t: num(x?.t), practice: x?.practice == null ? null : num(x.practice) }])),
        drills: Object.fromEntries(Object.entries(v?.drills || {}).map(([id, x]) => [str(id, 40), { done: !!x?.done, t: num(x?.t), best: num(x?.best) }])),
      }; break;
      case 'quiz': out[k] = { best: Object.fromEntries(Object.entries(v?.best || {}).map(([m, x]) => [str(m, 20), num(x)])), runs: (Array.isArray(v?.runs) ? v.runs : []).map(r => ({ mode: str(r?.mode, 20), score: num(r?.score), t: num(r?.t) })) }; break;
      case 'coords': out[k] = { best: { ...(v?.best?.white != null ? { white: num(v.best.white) } : {}), ...(v?.best?.black != null ? { black: num(v.best.black) } : {}) } }; break;
      case 'mistakes': out[k] = {
        cards: Object.fromEntries(Object.entries(v?.cards || {}).filter(([id]) => typeof id === 'string' && id.length < 80).map(([id, c]) => [id, {
          ease: num(c?.ease, 2.5), interval: num(c?.interval), reps: num(c?.reps), lapses: num(c?.lapses), due: num(c?.due), last: num(c?.last),
        }])),
      }; break;
      case 'daily': out[k] = { days: Object.fromEntries(Object.entries(v?.days || {}).filter(([d]) => /^\d{4}-\d{2}-\d{2}$/.test(d)).map(([d, x]) => [d, x === 1 ? 1 : 0])) }; break;
      case 'settings': out[k] = {
        theme: ['system', 'light', 'dark'].includes(v?.theme) ? v.theme : 'system',
        board: ['slate', 'walnut', 'ocean', 'olive', 'mono'].includes(v?.board) ? v.board : 'slate',
        pieces: ['cburnett', 'merida', 'chessnut', 'fantasy'].includes(v?.pieces) ? v.pieces : 'cburnett',
        sound: v?.sound !== false, coords: v?.coords !== false, animation: v?.animation !== false, autoQueen: v?.autoQueen === true, playEval: v?.playEval === true, showThreats: v?.showThreats === true, coach: v?.coach === true, reviewLines: v?.reviewLines === true, figurine: v?.figurine === true, boardSize: ['s', 'm', 'l'].includes(v?.boardSize) ? v.boardSize : 'm', botChat: v?.botChat !== false, showDests: v?.showDests !== false, premoves: v?.premoves !== false, lastMove: v?.lastMove !== false,
        reviewDepth: ['fast', 'standard', 'deep'].includes(v?.reviewDepth) ? v.reviewDepth : 'standard',
      }; break;
      default: break; // unknown keys (and in-progress state) are not imported
    }
  }
  return out;
}

/** Merge (default) keeps everything from both devices; replace wipes local data first. */
export function importData(obj, mode = 'merge') {
  const { data: incoming } = validateImport(obj);
  const beforeStats = stats(Object.fromEntries(cache));
  if (mode === 'replace') {
    for (const k of [...cache.keys()]) del(k);
    for (const [k, v] of Object.entries(incoming)) set(k, v);
  } else {
    const merged = mergeData(Object.fromEntries(cache), incoming);
    for (const [k, v] of Object.entries(merged)) {
      if (JSON.stringify(get(k)) !== JSON.stringify(v)) set(k, v);
    }
  }
  const after = stats(Object.fromEntries(cache));
  if (mode === 'replace') return after;
  return { games: after.games - beforeStats.games, attempts: after.attempts - beforeStats.attempts, lines: after.lines - beforeStats.lines };
}

function stats(data) {
  const games = Object.keys(data).filter(k => k.startsWith('game:')).length;
  const attempts = data.puzzles?.attempts?.length || 0;
  const lines = data.trainer?.cards?.length || 0;
  return { games, attempts, lines };
}

// Pure merge so it can be unit-tested.
export function mergeData(local, incoming) {
  const out = { ...local };
  for (const [k, v] of Object.entries(incoming)) {
    if (k.startsWith('game:')) {
      const mine = local[k];
      if (!mine || (!mine.review && v.review)) out[k] = v;
    } else if (k === 'puzzles') {
      out[k] = mergePuzzles(local[k], v);
    } else if (k === 'rush') {
      out[k] = mergeRush(local[k], v);
    } else if (k === 'trainer') {
      out[k] = mergeTrainer(local[k], v);
    } else if (k === 'learn') {
      out[k] = mergeLearn(local[k], v);
    } else if (k === 'quiz' || k === 'coords') {
      out[k] = mergeBest(local[k], v);
    } else if (k === 'mistakes') {
      const cards = { ...(v?.cards || {}) };
      for (const [id, c] of Object.entries(local[k]?.cards || {})) if (!cards[id] || (c.last || 0) > (cards[id].last || 0)) cards[id] = c;
      out[k] = { cards };
    } else if (k === 'daily') {
      out[k] = { days: { ...(v?.days || {}), ...Object.fromEntries(Object.entries(local[k]?.days || {}).filter(([d, x]) => x === 1 || !(d in (v?.days || {})))) } };
    } else if (!(k in local)) {
      out[k] = v;
    }
  }
  return out;
}

function mergePuzzles(a, b) {
  if (!a) return b;
  if (!b) return a;
  const seen = new Set();
  const attempts = [...(a.attempts || []), ...(b.attempts || [])]
    .filter(x => { const id = x.id + '@' + x.t; if (seen.has(id)) return false; seen.add(id); return true; })
    .sort((x, y) => x.t - y.t);
  const last = attempts[attempts.length - 1];
  return { ...a, ...b, attempts, rating: last ? last.after : (b.rating ?? a.rating) };
}

function mergeRush(a, b) {
  if (!a) return b;
  if (!b) return a;
  const best = { ...(a.best || {}) };
  for (const [m, s] of Object.entries(b.best || {})) best[m] = Math.max(best[m] || 0, s);
  const seen = new Set();
  const runs = [...(a.runs || []), ...(b.runs || [])]
    .filter(r => { if (seen.has(r.t)) return false; seen.add(r.t); return true; })
    .sort((x, y) => x.t - y.t);
  return { best, runs };
}

function mergeTrainer(a, b) {
  if (!a) return b;
  if (!b) return a;
  const byId = new Map((a.cards || []).map(c => [c.id, c]));
  for (const c of b.cards || []) {
    const mine = byId.get(c.id);
    if (!mine || (c.last || 0) > (mine.last || 0)) byId.set(c.id, c);
  }
  return { ...a, cards: [...byId.values()] };
}

function mergeLearn(a, b) {
  if (!a) return b;
  if (!b) return a;
  const lessons = { ...b.lessons };
  for (const [id, x] of Object.entries(a.lessons || {})) lessons[id] = lessons[id] ? { ...lessons[id], done: lessons[id].done || x.done, t: Math.max(lessons[id].t || 0, x.t || 0) } : x;
  const drills = { ...b.drills };
  for (const [id, x] of Object.entries(a.drills || {})) {
    const y = drills[id];
    drills[id] = y ? { done: y.done || x.done, t: Math.max(y.t || 0, x.t || 0), best: Math.min(y.best || Infinity, x.best || Infinity) } : x;
    if (!Number.isFinite(drills[id].best)) drills[id].best = 0;
  }
  return { lessons, drills };
}

function mergeBest(a, b) {
  if (!a) return b;
  if (!b) return a;
  const best = { ...(a.best || {}) };
  for (const [m, x] of Object.entries(b.best || {})) best[m] = Math.max(best[m] ?? -Infinity, x);
  const out = { ...a, best };
  if (a.runs || b.runs) {
    const seen = new Set();
    out.runs = [...(a.runs || []), ...(b.runs || [])].filter(r => { const id = r.t + ':' + r.mode; if (seen.has(id)) return false; seen.add(id); return true; }).sort((x, y) => x.t - y.t);
  }
  return out;
}
