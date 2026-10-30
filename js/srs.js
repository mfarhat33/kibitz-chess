// Spaced repetition for opening lines (SM-2 style scheduling).
const DAY = 86400000;
const MIN = 60000;

export function newCard({ name, eco = '', color, moves }, now = Date.now()) {
  return {
    id: `${color}:${moves.join(' ')}`,
    name, eco, color, moves,
    ease: 2.5, interval: 0, reps: 0, lapses: 0,
    due: now, last: 0, created: now, history: [],
  };
}

/**
 * quality: 5 perfect, 4 perfect while learning (arrows shown), 3 one slip, below 3 = failed.
 * Returns a new card object.
 */
export function reviewCard(card, quality, now = Date.now()) {
  const c = { ...card, history: [...(card.history || []), { t: now, q: quality }].slice(-30) };
  if (quality < 3) {
    c.reps = 0;
    c.lapses = (c.lapses || 0) + 1;
    c.interval = 0;
    c.due = now + 10 * MIN;
  } else {
    c.reps = (c.reps || 0) + 1;
    if (c.reps === 1) c.interval = 1;
    else if (c.reps === 2) c.interval = 3;
    else c.interval = Math.round(c.interval * c.ease);
    if (quality === 3) c.interval = Math.max(1, Math.round(c.interval * 0.6));
    c.due = now + c.interval * DAY;
  }
  c.ease = Math.max(1.3, c.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  c.last = now;
  return c;
}

export function qualityFor(mistakes, usedShow, learning) {
  if (usedShow || mistakes >= 2) return 1;
  if (mistakes === 1) return learning ? 2 : 3;
  return learning ? 4 : 5;
}

export function isDue(card, now = Date.now()) { return card.due <= now; }

export function dueCards(cards, now = Date.now()) {
  return cards.filter(c => isDue(c, now)).sort((a, b) => a.due - b.due);
}

export function dueText(card, now = Date.now()) {
  const d = card.due - now;
  if (d <= 0) return 'due now';
  if (d < 3600000) return `in ${Math.max(1, Math.round(d / MIN))} min`;
  if (d < DAY) return `in ${Math.round(d / 3600000)} h`;
  const days = Math.round(d / DAY);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

export function strength(card) {
  if (!card.reps) return card.lapses ? 'relearning' : 'new';
  if (card.interval < 7) return 'learning';
  if (card.interval < 30) return 'familiar';
  return 'solid';
}
