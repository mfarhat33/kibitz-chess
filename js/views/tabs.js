// Sub-navigation shared by the Play pages, and the hand-over from analysis/review to a bot game.
import * as store from '../store.js';
import { confirm } from '../ui.js';
import { Chess } from '../chessutil.js';

export function playTabs(active) {
  const t = (id, href, label) => `<a href="${href}" class="${active === id ? 'active' : ''}">${label}</a>`;
  return `<nav class="subtabs">${t('new', '#/play', 'New game')}${t('games', '#/games', 'My games')}${t('analysis', '#/analysis', 'Analysis')}</nav>`;
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
