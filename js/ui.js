// DOM helpers, icons, dialogs, toasts and synthesized sounds.
import { getSettings } from './store.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ic = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const icons = {
  play: ic('<circle cx="12" cy="6.5" r="3"/><path d="M9.6 10.5h4.8l1.6 7H8z"/><path d="M6 20.5h12"/>'),
  puzzle: ic('<path d="M10 5V3.8a2 2 0 0 1 4 0V5h4a1 1 0 0 1 1 1v4h-1.2a2 2 0 0 0 0 4H19v4a1 1 0 0 1-1 1h-4v-1.2a2 2 0 0 0-4 0V19H6a1 1 0 0 1-1-1v-4h1.2a2 2 0 0 0 0-4H5V6a1 1 0 0 1 1-1z"/>'),
  book: ic('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>'),
  chart: ic('<path d="M4 20h16"/><path d="M7 16v-5"/><path d="M12 16V6"/><path d="M17 16v-8"/>'),
  settings: ic('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  flip: ic('<path d="M7 4v16M7 4 4 7M7 4l3 3"/><path d="M17 20V4M17 20l-3-3M17 20l3-3"/>'),
  hint: ic('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'),
  undo: ic('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  flag: ic('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  first: ic('<path d="M17 18l-6-6 6-6"/><path d="M7 6v12"/>'),
  prev: ic('<path d="M15 18l-6-6 6-6"/>'),
  next: ic('<path d="M9 6l6 6-6 6"/>'),
  last: ic('<path d="M7 6l6 6-6 6"/><path d="M17 6v12"/>'),
  sun: ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: ic('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  download: ic('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>'),
  upload: ic('<path d="M12 15V4M7 9l5-5 5 5"/><path d="M5 20h14"/>'),
  trash: ic('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  bolt: ic('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  search: ic('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  retry: ic('<path d="M20 11A8 8 0 0 0 6 6.3L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14 4.7l2-1.7"/><path d="M20 20v-4h-4"/>'),
  eye: ic('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  target: ic('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'),
  check: ic('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  x: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
  clock: ic('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
  start: ic('<path d="M8 5v14l11-7z"/>'),
  list: ic('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  learn: ic('<path d="M3 9l9-5 9 5-9 5z"/><path d="M7 11.2V16c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5v-4.8"/><path d="M21 9v5"/>'),
  bulbOff: ic('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5"/>'),
};

export const logo = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 3h20a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H14l-6 5v-5H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z" fill="var(--accent)"/><rect x="9" y="7" width="7" height="7" rx="1.2" fill="var(--accent-ink)"/><rect x="16" y="14" width="7" height="7" rx="1.2" fill="var(--accent-ink)"/><rect x="16" y="7" width="7" height="7" rx="1.2" fill="var(--accent-ink)" opacity=".4"/><rect x="9" y="14" width="7" height="7" rx="1.2" fill="var(--accent-ink)" opacity=".4"/></svg>`;

/** Scrolls so a board column sits just below the sticky header (phones put buttons below the board). */
export function scrollToBoard(root) {
  const col = root.querySelector('.board-col');
  if (!col) return;
  const top = col.getBoundingClientRect().top + window.scrollY - (document.querySelector('.topbar')?.offsetHeight || 0) - 4;
  if (Math.abs(window.scrollY - top) > 4 && col.getBoundingClientRect().top < 0) window.scrollTo({ top, behavior: 'smooth' });
}

export function toast(msg, ms = 2400) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}

/** Modal with buttons; resolves to the clicked button's value (or null when dismissed). */
export function dialog({ title, body = '', buttons = [{ label: 'OK', value: true, primary: true }] }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<h2>${esc(title)}</h2><div class="dialog-body">${body}</div><div class="dialog-actions"></div>`;
    const actions = d.querySelector('.dialog-actions');
    let value = null;
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => { value = b.value; d.close(); });
      actions.appendChild(btn);
    }
    d.addEventListener('close', () => { d.remove(); resolve(value); });
    // only a tap outside the dialog box (on the backdrop) dismisses it, not one in its padding
    d.addEventListener('click', (e) => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    });
    document.body.appendChild(d);
    d.showModal();
  });
}

export function confirm(title, body, okLabel = 'OK', danger = false) {
  return dialog({ title, body, buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: !danger, danger }] });
}

export function fmtClock(ms) {
  ms = Math.max(0, ms);
  const s = ms / 1000;
  if (s < 10) return s.toFixed(1);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`;
  return fmtDate(ts);
}

export function downloadFile(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.addEventListener('change', () => resolve(i.files[0] || null));
    i.click();
  });
}

// ---------- sound: tiny synthesized clicks, no audio files ----------
let actx = null;
function ctx() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function blip(freq, dur, { type = 'triangle', gain = 0.12, delay = 0, slide = 0 } = {}) {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
export function sound(kind) {
  if (!getSettings().sound) return;
  try {
    switch (kind) {
      case 'move': blip(420, 0.07, { slide: 0.6 }); break;
      case 'capture': blip(260, 0.11, { gain: 0.18, slide: 0.5 }); blip(900, 0.03, { type: 'square', gain: 0.03 }); break;
      case 'check': blip(660, 0.09, { type: 'square', gain: 0.05 }); blip(880, 0.1, { type: 'square', gain: 0.04, delay: 0.08 }); break;
      case 'end': blip(523, 0.18, { gain: 0.1 }); blip(392, 0.3, { gain: 0.1, delay: 0.16 }); break;
      case 'good': blip(660, 0.09, { gain: 0.1 }); blip(990, 0.16, { gain: 0.1, delay: 0.08 }); break;
      case 'bad': blip(200, 0.2, { type: 'sawtooth', gain: 0.05, slide: 0.7 }); break;
      case 'lowtime': blip(880, 0.08, { type: 'square', gain: 0.05 }); blip(880, 0.08, { type: 'square', gain: 0.05, delay: 0.18 }); blip(880, 0.08, { type: 'square', gain: 0.05, delay: 0.36 }); break;
      default: break;
    }
  } catch { /* audio unavailable */ }
}
export function moveSound(move, chess) {
  if (chess?.inCheck()) sound('check');
  else if (move?.captured) sound('capture');
  else sound('move');
}

/** Builds the move list grid (desktop) from SAN moves. */
export function moveListHtml(sans, cur, { startPly = 0, badges = [] } = {}) {
  let html = '';
  const first = startPly % 2;
  if (first === 1) html += `<span class="num">${Math.floor(startPly / 2) + 1}.</span><span class="mv"></span>`;
  sans.forEach((s, i) => {
    const ply = startPly + i;
    if (ply % 2 === 0) html += `<span class="num">${ply / 2 + 1}.</span>`;
    const b = badges[i];
    html += `<span class="mv${i === cur ? ' cur' : ''}" data-i="${i}">${esc(s)}${b ? `<i class="q q-${b.cls}" title="${b.cls}">${b.text}</i>` : ''}</span>`;
  });
  return html;
}

export function boardThemeAttr() {
  const s = getSettings();
  return s.board;
}
