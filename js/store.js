// Progress storage: an in-memory map mirrored to IndexedDB (localStorage fallback).
// Everything lives in the browser; export/import moves it between devices.

const DB_NAME = 'kibitz-chess';
const STORE = 'kv';
const LS_PREFIX = 'kibitz:';
const cache = new Map();
let db = null;
let useLS = false;
const listeners = new Set();

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
  listeners.forEach(fn => fn(key));
}

export function del(key) {
  cache.delete(key);
  persist(key, undefined);
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
    theme: 'system', board: 'slate', sound: true, coords: true, animation: true,
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
  if (!obj || obj.format !== EXPORT_FORMAT || typeof obj.data !== 'object' || obj.data === null) {
    throw new Error('This file is not a Kibitz Chess progress file.');
  }
  return obj;
}

/** Merge (default) keeps everything from both devices; replace wipes local data first. */
export function importData(obj, mode = 'merge') {
  validateImport(obj);
  const incoming = obj.data;
  if (mode === 'replace') {
    for (const k of [...cache.keys()]) del(k);
    for (const [k, v] of Object.entries(incoming)) set(k, v);
    return summarize(incoming);
  }
  const merged = mergeData(Object.fromEntries(cache), incoming);
  for (const [k, v] of Object.entries(merged)) {
    if (JSON.stringify(get(k)) !== JSON.stringify(v)) set(k, v);
  }
  return summarize(incoming);
}

function summarize(data) {
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
