// Sync progress between devices through one private GitHub Gist.
// The token is kept in this browser only (localStorage, outside the progress store), so it is never
// exported or uploaded. Each sync pulls the Gist, merges it into local progress with the same safe
// merge as Import progress, then uploads the merged result if it changed.
import * as store from './store.js';

const CFG_KEY = 'kibitzsync'; // deliberately not "kibitz:" so the store never loads or exports it
const FILE = 'kibitz-progress.txt';
const DESC = 'Kibitz Chess progress (sync)';
const API = 'https://api.github.com';
// in-progress state that should stay on the device it belongs to
const LOCAL_ONLY = new Set(['play.current', 'play.fromFen']);
const AUTO_KEYS = /^(game:|puzzles$|rush$|trainer$|learn$|quiz$|coords$|mistakes$|daily$|coach$)/;

const listeners = new Set();
let running = null;
let timer = null;
let dirty = false;

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch { return {}; }
}
function saveConfig(patch) {
  const c = { ...getConfig(), ...patch };
  try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch { /* storage blocked */ }
  listeners.forEach(fn => { try { fn(c); } catch { /* gone */ } });
  return c;
}
export function onSyncChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function isConfigured() { return !!getConfig().token; }

export function disconnect() {
  try { localStorage.removeItem(CFG_KEY); } catch { /* ignore */ }
  listeners.forEach(fn => { try { fn({}); } catch { /* gone */ } });
}

// ---------- encoding: gzip + base64 when the browser can, plain JSON otherwise ----------
const PREFIX = 'KBZ1:';
export async function encode(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream === 'undefined') return json;
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return PREFIX + btoa(bin);
}
export async function decode(text) {
  if (!text) return null;
  if (!text.startsWith(PREFIX)) return JSON.parse(text);
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read the compressed sync file. Update it and try again.');
  const bin = atob(text.slice(PREFIX.length));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

/** Progress to upload: everything except per-device, in-progress state. */
export function syncPayload() {
  const ex = store.exportData();
  const data = {};
  for (const [k, v] of Object.entries(ex.data)) if (!LOCAL_ONLY.has(k)) data[k] = v;
  return { ...ex, data };
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + s.length;
}

// ---------- GitHub ----------
async function gh(path, token, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (res.status === 401) throw new Error('GitHub rejected the token. Create a new one with Gist access.');
  if (res.status === 403 || res.status === 429) throw new Error('GitHub is limiting requests or the token lacks Gist access. Try again later.');
  if (res.status === 404) { const e = new Error('Sync Gist not found.'); e.notFound = true; throw e; }
  if (!res.ok) throw new Error(`GitHub answered with an error (${res.status}).`);
  return res.status === 204 ? null : res.json();
}

async function findGist(token) {
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`, token);
    const hit = list.find(g => g.description === DESC && g.files?.[FILE]);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  return null;
}

async function readGist(token, id) {
  const g = await gh(`/gists/${id}`, token);
  const f = g.files?.[FILE];
  if (!f) return null;
  if (!f.truncated) return f.content;
  // big files come back cut short: fetch the raw file (its secret URL needs no token)
  const r = await fetch(f.raw_url);
  if (!r.ok) throw new Error(`Could not download the sync file (${r.status}).`);
  return r.text();
}

/**
 * Connects this browser: checks the token, finds the sync Gist (or creates one on the first
 * device) and runs a first sync. Returns the sync result.
 */
export async function connect(token) {
  token = token.trim();
  if (!/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(token)) throw new Error('That does not look like a GitHub token (it starts with ghp_ or github_pat_).');
  await gh('/user', token);
  const id = await findGist(token);
  saveConfig({ token, gistId: id || null, lastPushed: null, lastError: null });
  return syncNow({ force: true });
}

/** Pull, merge, push. Runs one at a time; calls during a sync wait for it. */
export function syncNow({ force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const cfg = getConfig();
    if (!cfg.token) return { ok: false, error: 'Not connected' };
    saveConfig({ busy: true });
    dirty = false;
    try {
      let added = { games: 0, attempts: 0, lines: 0 };
      let gistId = cfg.gistId;
      if (gistId) {
        let text = null;
        try { text = await readGist(cfg.token, gistId); } catch (err) { if (err.notFound) gistId = null; else throw err; }
        if (text) {
          const remote = await decode(text);
          if (remote) added = store.importData(remote, 'merge');
        }
      }
      const payload = syncPayload();
      const body = JSON.stringify(payload.data);
      const h = hash(body);
      let pushed = false;
      if (force || !gistId || h !== cfg.lastPushed) {
        const content = await encode(payload);
        if (gistId) {
          await gh(`/gists/${gistId}`, cfg.token, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content } } }) });
        } else {
          const g = await gh('/gists', cfg.token, { method: 'POST', body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content } } }) });
          gistId = g.id;
        }
        pushed = true;
      }
      saveConfig({ gistId, lastPushed: h, lastSync: Date.now(), lastError: null, busy: false });
      return { ok: true, added, pushed };
    } catch (err) {
      saveConfig({ lastError: String(err.message || err), busy: false });
      dirty = true;
      return { ok: false, error: String(err.message || err) };
    } finally {
      running = null;
    }
  })();
  return running;
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => { if (navigator.onLine !== false) syncNow(); }, ms);
}

/** Starts automatic sync: on open, 20 s after progress changes, and when the app is hidden. */
export function initSync() {
  if (isConfigured()) schedule(1500);
  store.onChange((key) => {
    if (!isConfigured() || !AUTO_KEYS.test(key)) return;
    dirty = true;
    schedule(20000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty && isConfigured()) { clearTimeout(timer); syncNow(); }
  });
  window.addEventListener('online', () => { if (dirty) schedule(2000); });
}
