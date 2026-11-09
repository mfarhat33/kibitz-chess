// Unit tests for the coach: error classification, cost attribution, reports, plans, opening fixes, sync.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.fetch = async (url) => {
  const p = fileURLToPath(url);
  if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
};

const { positions } = await import('../js/analysis.js');
const coach = await import('../js/coach.js');
const { mergeData, validateImport } = await import('../js/store.js');
const { encode, decode } = await import('../js/sync.js');
const { collectMistakes } = await import('../js/views/mistakes.js');
const { LEVELS } = await import('../js/bot.js');

const DAY = 86400000;

// 1.e4 d5 2.Qg4?? hangs the queen to Bxg4
function hungQueenGame(id = 'g1', date = Date.UTC(2026, 10, 3, 12), extra = {}) {
  const moves = ['e2e4', 'd7d5', 'd1g4', 'c8g4'];
  return {
    id, date, userColor: 'w', userResult: 'loss', botName: 'Cedar', moves, sans: ['e4', 'd5', 'Qg4', 'Bxg4'], result: '0-1', reason: 'resign',
    review: {
      labels: ['book', 'book', 'blunder', 'best'],
      evals: [{ cp: 30 }, { cp: 40 }, { cp: 35 }, { cp: -880 }, { cp: -870 }],
      best: ['e2e4', 'd7d5', 'e4d5', 'c8g4', null],
      pv: [['e2e4'], ['d7d5'], ['e4d5', 'd8d5', 'b1c3'], ['c8g4', 'g1f3', 'e7e6'], []],
      acc: [100, 100, 3, 100], loss: [0, 0, 45, 0], phases: ['opening', 'opening', 'opening', 'opening'],
      accuracy: { w: 40, b: 90 }, counts: { w: { blunder: 1 }, b: {} },
    },
    ...extra,
  };
}

// 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? allows Qxf7# (user is black)
function scholarGame(id = 'g2', date = Date.UTC(2026, 10, 4, 12)) {
  const moves = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];
  return {
    id, date, userColor: 'b', userResult: 'loss', botName: 'Maple', moves, result: '1-0', reason: 'checkmate',
    review: {
      labels: ['book', 'book', 'book', 'book', 'book', 'blunder', 'best'],
      evals: [{ cp: 30 }, { cp: 30 }, { cp: 20 }, { cp: 20 }, { cp: 20 }, { cp: 20 }, { mate: 1 }, { mate: 0, win: 'w' }],
      best: [null, null, null, null, null, 'g7g6', 'h5f7', null],
      pv: [[], [], [], [], [], ['g7g6', 'h5f3'], ['h5f7'], []],
      acc: [], loss: [0, 0, 0, 0, 0, 48, 0], phases: Array(7).fill('opening'),
      accuracy: { w: 90, b: 50 }, counts: { w: {}, b: { blunder: 1 } },
    },
  };
}

test('classifier: a piece left en prise is "hung", and it decided the game', () => {
  const g = hungQueenGame();
  const errs = coach.gameErrors(g);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].cat, 'hung');
  assert.equal(errs[0].ply, 2);
  assert.ok(errs[0].decisive);
  assert.ok(errs[0].matLoss >= 8);
});

test('classifier: allowing Qxf7# is "allowedMate"', () => {
  const errs = coach.gameErrors(scholarGame());
  assert.equal(errs.length, 1);
  assert.equal(errs[0].cat, 'allowedMate');
  assert.equal(errs[0].motif, 'mate');
});

test('classifier: low clock turns the error into time trouble but keeps the cause', () => {
  const g = hungQueenGame('t1', Date.UTC(2026, 10, 3), { tcBase: 180000, tcInc: 0, moveClocks: [9000, 175000, 8000, 160000] });
  const [e] = coach.gameErrors(g);
  assert.equal(e.cat, 'time');
  assert.equal(e.under, 'hung');
  // plenty of time: not time trouble
  const g2 = hungQueenGame('t2', Date.UTC(2026, 10, 3), { tcBase: 180000, tcInc: 0, moveClocks: [170000, 175000, 150000, 160000] });
  assert.equal(coach.gameErrors(g2)[0].cat, 'hung');
  assert.ok(coach.timeThreshold({ tcBase: 180000 }) < coach.timeThreshold({ tcBase: 600000 }));
});

test('classifier: games lost on time with no decisive error still count as time trouble', () => {
  const g = hungQueenGame('t3');
  g.review.labels = ['book', 'book', 'good', 'best'];
  g.reason = 'Lost on time';
  const errs = coach.gameErrors(g);
  assert.equal(errs.length, 1);
  assert.ok(errs[0].flagged && errs[0].decisive && errs[0].cat === 'time');
});

test('motifs: fork, pin, free piece and mate', () => {
  assert.equal(coach.motifOf('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7'), 'fork');
  assert.equal(coach.motifOf('r3k3/8/2n5/8/8/8/8/3BK3 w - - 0 1', 'd1a4'), 'pin');
  assert.equal(coach.motifOf('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1', 'd1d5'), 'freePiece');
  assert.equal(coach.motifOf('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8'), 'mate');
});

test('pattern stats rank by points thrown away; draws cost half', () => {
  const d = hungQueenGame('d1', Date.UTC(2026, 10, 5));
  d.userResult = 'draw';
  const games = [hungQueenGame('a'), hungQueenGame('b'), scholarGame('c'), d, { ...hungQueenGame('w'), spectator: true }];
  const s = coach.patternStats(games);
  assert.equal(s.games, 4);
  assert.equal(s.list[0].cat, 'hung');
  assert.equal(s.list[0].points, 2.5);
  assert.equal(s.list[0].count, 3);
  assert.equal(s.list[1].cat, 'allowedMate');
  assert.equal(s.list[1].points, 1);
});

test('weekly report widens a quiet week and compares with the window before', () => {
  const mon = coach.weekStart(Date.UTC(2026, 10, 9, 12)); // a Monday
  assert.equal(new Date(mon).getDay(), 1);
  assert.equal(coach.reportWeek(mon + 3 * DAY), mon - coach.WEEK);
  const last = mon - coach.WEEK;
  const games = [];
  for (let i = 0; i < 6; i++) games.push(hungQueenGame('x' + i, last + DAY + i * 3600000));
  games.push(scholarGame('y', last + 2 * DAY));
  const rep = coach.weeklyReport(games, last);
  assert.equal(rep.widened, false);
  assert.equal(rep.week.played, 7);
  assert.equal(rep.top[0].cat, 'hung');
  assert.equal(rep.top[0].count, 6);
  // two games only: falls back to everything
  const quiet = coach.weeklyReport(games.slice(0, 2), last);
  assert.equal(quiet.widened, 'all');
  assert.ok(coach.adviceFor(rep.top[0], rep.windowGames).startsWith('You left a piece en prise 6 times.'));
});

test('7-day plan: seven days, top pattern most often, a play day at the end', () => {
  const plan = coach.weekPlan([{ cat: 'hung', topMotif: 'freePiece' }, { cat: 'missedTactic', topMotif: 'fork' }, { cat: 'endgame' }]);
  assert.equal(plan.length, 7);
  assert.equal(plan.filter(d => d.items[0].cat === 'hung').length, 3);
  assert.equal(plan[1].items.find(i => i.kind === 'puzzles').theme, 'fork');
  assert.equal(plan[3].items.some(i => i.kind === 'learn'), true);
  assert.equal(plan[6].items[0].kind, 'play');
  assert.equal(coach.weekPlan([]).every(d => d.items[0].kind === 'play'), true);
});

test('opening fixes find the same bad move in two games', () => {
  const games = [hungQueenGame('o1'), hungQueenGame('o2', Date.UTC(2026, 10, 6))];
  const fixes = coach.openingFixes(games);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].playedSan, 'Qg4');
  assert.equal(fixes[0].bestSan, 'exd5');
  assert.equal(fixes[0].count, 2);
  assert.deepEqual(fixes[0].prefix, ['e2e4', 'd7d5']);
  // one game: only shown because it was a blunder
  assert.equal(coach.openingFixes([hungQueenGame('o3')]).length, 1);
});

test('sparring positions and bot level choice', () => {
  const pos = coach.sparringPositions([hungQueenGame('s1'), scholarGame('s2')], 'opening');
  assert.equal(pos.length, 2);
  assert.equal(pos[0].gameId, 's2');
  assert.equal(LEVELS[coach.levelFor(1180, LEVELS)].elo, 1200);
});

test('mistake trainer cards carry the pattern and keep their old ids', () => {
  const ms = collectMistakes([hungQueenGame('m1'), scholarGame('m2')]);
  assert.deepEqual(ms.map(m => m.id).sort(), ['m1:2', 'm2:5']);
  assert.equal(ms.find(m => m.id === 'm1:2').cat, 'hung');
});

test('coach progress is sanitised and merged', () => {
  const ok = validateImport({ format: 'kibitz-chess-progress', data: { coach: { done: { '1762732800000:0:1': 5, 'bad': 1 }, fixes: { 'k': 3 } } } });
  assert.deepEqual(Object.keys(ok.data.coach.done), ['1762732800000:0:1']);
  const m = mergeData({ coach: { done: { a: 1 }, fixes: {} } }, { coach: { done: { b: 2 }, fixes: { f: 1 } } });
  assert.deepEqual(m.coach, { done: { b: 2, a: 1 }, fixes: { f: 1 } });
});

test('sync file round-trips through gzip and reads plain JSON', async () => {
  const obj = { format: 'kibitz-chess-progress', data: { 'game:x': { id: 'x', moves: Array(80).fill('e2e4') } } };
  const enc = await encode(obj);
  assert.ok(enc.startsWith('KBZ1:'));
  assert.ok(enc.length < JSON.stringify(obj).length);
  assert.deepEqual(await decode(enc), obj);
  assert.deepEqual(await decode(JSON.stringify(obj)), obj);
});
