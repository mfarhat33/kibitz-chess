// Sub-navigation shared by the Play pages.
export function playTabs(active) {
  const t = (id, href, label) => `<a href="${href}" class="${active === id ? 'active' : ''}">${label}</a>`;
  return `<nav class="subtabs">${t('new', '#/play', 'New game')}${t('games', '#/games', 'My games')}${t('analysis', '#/analysis', 'Analysis')}</nav>`;
}
