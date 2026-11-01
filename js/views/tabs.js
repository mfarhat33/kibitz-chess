// Sub-navigation shared by the Play pages, and the hand-over from analysis/review to a bot game.
import * as store from '../store.js';
import { confirm } from '../ui.js';
import { Chess } from '../chessutil.js';

export function playTabs(active) {
  const t = (id, href, label) => `<a href="${href}" class="${active === id ? 'active' : ''}">${label}</a>`;
  return `<nav class="subtabs">${t('new', '#/play', 'New game')}${t('games', '#/games', 'My games')}${t('analysis', '#/analysis', 'Analysis')}</nav>`;
}

/** True when a saved analysis tree has work worth keeping: side lines, comments or annotations. */
export function isRichTree(t) {
  if (!t || typeof t !== 'object') return false;
  const walk = (list) => (list || []).some(o => o.c || o.n || (o.k && (o.k.length > 1 || walk(o.k))));
  return !!t.c || (t.k || []).length > 1 || walk(t.k);
}

/**
 * Opens a position or game on the analysis board. If the board holds side lines or comments,
 * asks first so that work is never replaced by accident. Returns false if you cancel.
 */
export async function openOnAnalysisBoard(data) {
  const saved = store.get('analysis.board');
  if (saved?.tree && isRichTree(saved.tree)) {
    const ok = await confirm('Replace your analysis board?', '<p class="muted">Your analysis board has side lines or comments. Opening this will replace them. Copy or download its PGN first if you want to keep them.</p>', 'Replace', true);
    if (!ok) return false;
  }
  store.set('analysis.board', data);
  location.hash = '#/analysis';
  return true;
}

/** Open the Play setup with `fen` as the starting position. */
export async function playFromPosition(fen) {
  if (new Chess(fen).isGameOver()) return 'over';
  const cur = store.get('play.current');
  if (cur && !cur.over) {
    const ok = await confirm('Leave your current game?', '<p class="muted">The game in progress will be abandoned and not saved.</p>', 'Leave game', true);
    if (!ok) return false;
    store.del('play.current');
  }
  store.set('play.fromFen', fen);
  location.hash = '#/play';
  return true;
}
