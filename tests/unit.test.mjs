// Unit tests for the pure logic. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// openings-data and puzzle-data fetch JSON files; serve them from disk under Node.
globalThis.fetch = async (url) => {
  const p = fileURLToPath(url);
  if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
};

const { winPct, moveAccuracy, labelFor, gameAccuracy, classify, positions, phaseOf, isSacrifice, analyzePositions } = await import('../js/analysis.js');
const { botParams, pickCandidate, LEVELS } = await import('../js/bot.js');
const { newCard, reviewCard, qualityFor, dueCards } = await import('../js/srs.js');
const { mergeData, validateImport } = await import('../js/store.js');
const { dailyStreak } = await import('../js/views/puzzles.js');
const { updateRating, isCorrect, kFactor } = await import('../js/puzzle-player.js');
const { explainMove, playOut } = await import('../js/explain.js');
const { parseInfo, toWhite, formatScore } = await import('../js/engine.js');
const { formatLine, uciLineToSan, Chess } = await import('../js/chessutil.js');
const op = await import('../js/openings-data.js');
const pz = await import('../js/puzzle-data.js');
const { computeInsights } = await import('../js/views/insights.js');

test('win percentage is symmetric and saturates', () => {
  assert.equal(winPct({ cp: 0 }), 50);
  assert.ok(Math.abs(winPct({ cp: 300 }) + winPct({ cp: -300 }) - 100) < 1e-9);
  assert.ok(winPct({ cp: 300 }) > 74 && winPct({ cp: 300 }) < 76);
  // like Lichess, a forced mate counts as +/-1000 centipawns
  assert.equal(winPct({ mate: 3 }), winPct({ cp: 1000 }));
  assert.ok(winPct({ mate: 3 }) > 97 && winPct({ mate: 3 }) < 98);
  assert.equal(winPct({ mate: -2 }), winPct({ cp: -1000 }));
  assert.equal(winPct({ mate: 0, win: 'b' }), winPct({ cp: -1000 }));
  assert.equal(winPct({ cp: 5000 }), winPct({ cp: 1000 }));
});

test('move accuracy and labels', () => {
  assert.equal(moveAccuracy(50, 50), 100);
  assert.equal(moveAccuracy(50, 60), 100);
  assert.ok(moveAccuracy(50, 40) < moveAccuracy(50, 45));
  assert.ok(moveAccuracy(80, 10) < 10);
  assert.equal(labelFor(30, true), 'best');
  assert.equal(labelFor(1.5, false), 'excellent');
  assert.equal(labelFor(4, false), 'good');
  assert.equal(labelFor(7, false), 'inaccuracy');
  assert.equal(labelFor(15, false), 'mistake');
  assert.equal(labelFor(25, false), 'blunder');
});

test('game accuracy punishes the side that blunders', () => {
  const flat = Array(41).fill(52);
  const a = gameAccuracy(flat, 'w');
  assert.ok(a.w > 99 && a.b > 99);
  const wins = Array(41).fill(52);
  for (let i = 21; i < 41; i++) wins[i] = 5; // white blunders on move index 20 (white's move)
  const b = gameAccuracy(wins, 'w');
  assert.ok(b.w < a.w - 3, `white accuracy dropped (${b.w})`);
  assert.ok(b.b > 95);
});

test('classify labels moves and detects book moves', () => {
  const moves = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];
  const fens = positions(moves);
  const evals = [{ cp: 30 }, { cp: 30 }, { cp: 30 }, { cp: 10 }, { cp: 10 }, { cp: 30 }, { mate: 1 }, { mate: 0, win: 'w' }];
  const best = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g7g6', 'h5f7', null];
  const raw = { evals, best, pv: best.map(b => (b ? [b] : [])) };
  const r = classify(raw, moves, fens, (fen) => fens.indexOf(fen) <= 2);
  assert.deepEqual(r.labels.slice(0, 2), ['book', 'book']);
  assert.equal(r.labels[5], 'blunder', 'Nf6?? allowing mate is a blunder');
  assert.equal(r.labels[6], 'best');
  assert.equal(r.counts.b.blunder, 1);
  assert.ok(r.accuracy.w > r.accuracy.b);
});

test('phases', () => {
  assert.equal(phaseOf(new Chess().fen(), 0), 'opening');
  assert.equal(phaseOf('8/5k2/8/8/8/8/3K4/8 w - - 0 60', 100), 'endgame');
});

test('bot strength rises smoothly with level', () => {
  let prev = null;
  for (const l of LEVELS.filter(x => !x.max && x.elo < 2400)) {
    const p = botParams(l.elo);
    if (prev) {
      assert.ok(p.depth >= prev.depth);
      assert.ok(p.temp < prev.temp);
      assert.ok(p.blunder < prev.blunder);
    }
    prev = p;
  }
  assert.equal(LEVELS.find(l => l.elo === 1100) !== undefined, true);
});

test('bot candidate choice follows temperature', () => {
  const cands = [{ uci: 'a', score: 100 }, { uci: 'b', score: 0 }, { uci: 'c', score: -500 }];
  let seq = 0;
  const rand = () => (seq++ % 10) / 10 + 0.05;
  const cold = Array.from({ length: 10 }, () => pickCandidate(cands, 5, rand));
  assert.ok(cold.every(x => x === 'a'));
  const hot = new Set(Array.from({ length: 50 }, (_, i) => pickCandidate(cands, 400, () => (i % 50) / 50)));
  assert.ok(hot.size >= 2);
});

test('spaced repetition schedule', () => {
  const t0 = Date.UTC(2026, 0, 1);
  let c = newCard({ name: 'Italian', color: 'w', moves: ['e2e4', 'e7e5'] }, t0);
  assert.equal(dueCards([c], t0).length, 1);
  c = reviewCard(c, 5, t0);
  assert.equal(c.interval, 1);
  c = reviewCard(c, 5, t0);
  assert.equal(c.interval, 3);
  c = reviewCard(c, 5, t0);
  assert.ok(c.interval >= 7 && c.interval <= 9);
  const failed = reviewCard(c, 1, t0);
  assert.equal(failed.reps, 0);
  assert.equal(failed.lapses, 1);
  assert.equal(failed.due, t0 + 10 * 60000);
  assert.ok(failed.ease >= 1.3);
  assert.equal(qualityFor(0, false, false), 5);
  assert.equal(qualityFor(1, false, false), 3);
  assert.equal(qualityFor(0, true, false), 1);
});

test('progress merge keeps both devices', () => {
  const local = {
    settings: { theme: 'dark' },
    'game:a': { id: 'a', review: null },
    puzzles: { rating: 1150, attempts: [{ id: 'p1', t: 1, after: 1150 }] },
    rush: { best: { 3: 10 }, runs: [{ t: 1, score: 10 }] },
    trainer: { cards: [{ id: 'x', last: 5 }] },
  };
  const incoming = {
    settings: { theme: 'light' },
    'game:a': { id: 'a', review: { v: 1 } },
    'game:b': { id: 'b' },
    puzzles: { rating: 1200, attempts: [{ id: 'p1', t: 1, after: 1150 }, { id: 'p2', t: 2, after: 1210 }] },
    rush: { best: { 3: 8, 5: 12 }, runs: [{ t: 2, score: 12 }] },
    trainer: { cards: [{ id: 'x', last: 9 }, { id: 'y', last: 1 }] },
  };
  const m = mergeData(local, incoming);
  assert.equal(m.settings.theme, 'dark');
  assert.ok(m['game:a'].review);
  assert.ok(m['game:b']);
  assert.equal(m.puzzles.attempts.length, 2);
  assert.equal(m.puzzles.rating, 1210);
  assert.deepEqual(m.rush.best, { 3: 10, 5: 12 });
  assert.equal(m.rush.runs.length, 2);
  assert.equal(m.trainer.cards.find(c => c.id === 'x').last, 9);
  assert.throws(() => validateImport({ hello: 1 }));
});

test('puzzle rating and alternative mates', () => {
  assert.ok(updateRating(1100, 1100, 1, 0) > 1100);
  assert.ok(updateRating(1100, 1100, 0, 0) < 1100);
  assert.equal(Math.round(updateRating(1100, 1100, 0.5, 0)), 1100);
  assert.ok(kFactor(200) < kFactor(0));
  // White to mate in one with either rook: Ra8# or Rb8#
  const p = { moves: ['h7h6', 'a1a8'] };
  const fen = '6k1/5ppp/8/8/8/8/5PPP/RR4K1 w - - 0 1';
  assert.ok(isCorrect(p, 1, fen, 'a1a8'));
  assert.ok(isCorrect(p, 1, fen, 'b1b8'), 'other mating move is accepted on the last step');
  assert.ok(!isCorrect(p, 1, fen, 'g1h1'));
});

test('explanations name a hanging queen', () => {
  const moves = ['e2e4', 'd7d5', 'd1g4'];
  const fens = positions(moves);
  const review = {
    labels: ['book', 'book', 'blunder'],
    evals: [{ cp: 30 }, { cp: 40 }, { cp: 35 }, { cp: -880 }],
    best: ['e2e4', 'd7d5', 'e4d5', 'c8g4'],
    pv: [['e2e4'], ['d7d5'], ['e4d5', 'd8d5', 'b1c3'], ['c8g4', 'g1f3', 'e7e6']],
    acc: [100, 100, 3],
  };
  const sans = uciLineToSan(fens[0], moves);
  const ex = explainMove(2, { fens, moves, sans, review });
  assert.match(ex.headline, /Qg4 is a blunder/);
  assert.match(ex.lines.join(' '), /queen on g4/);
  assert.match(ex.lines.join(' '), /Better was exd5/);
});

test('explanations spot an allowed mate', () => {
  const moves = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6'];
  const fens = positions(moves);
  const review = {
    labels: ['book', 'book', 'book', 'book', 'book', 'blunder'],
    evals: [{ cp: 30 }, { cp: 30 }, { cp: 20 }, { cp: 20 }, { cp: 20 }, { cp: 20 }, { mate: 1 }],
    best: [null, null, null, null, null, 'g7g6', 'h5f7'],
    pv: [[], [], [], [], [], ['g7g6', 'h5f3'], ['h5f7']],
    acc: [],
  };
  const ex = explainMove(5, { fens, moves, sans: uciLineToSan(fens[0], moves), review });
  assert.match(ex.lines[0], /forced mate in 1: 4\. Qxf7#/);
});

test('material play-out settles after recaptures', () => {
  // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4 4.Nxe5: in Qg5 5.Nxf7 Qxg2 each side wins a pawn
  const fen = 'r1bqkbnr/pppp1ppp/8/4N3/2BnP3/8/PPPP1PPP/RNBQK2R b KQkq - 0 4';
  const r = playOut(fen, ['d8g5', 'e5f7', 'g5g2'], 'b');
  assert.equal(r.end - r.start, 0);
  assert.equal(r.caps.length, 2);
  // stopping right after 5.Nxf7 leaves Black a pawn worse
  const s = playOut(fen, ['d8g5', 'e5f7'], 'b');
  assert.equal(s.end - s.start, -1);
});

test('UCI info parsing and score helpers', () => {
  const a = parseInfo('info depth 14 seldepth 20 multipv 2 score cp -35 nodes 1000 nps 1 pv e7e5 g1f3');
  assert.deepEqual([a.depth, a.multipv, a.cp, a.pv.length], [14, 2, -35, 2]);
  const b = parseInfo('info depth 9 score mate -3 pv a1a2');
  assert.equal(b.mate, -3);
  assert.ok(parseInfo('info depth 5 score cp 10 lowerbound pv e2e4').bound);
  assert.deepEqual(toWhite({ cp: 50, mate: null }, 'b'), { cp: -50, mate: null });
  assert.equal(formatScore({ mate: -2 }), '-M2');
  assert.equal(formatScore({ cp: 123 }), '+1.2');
  assert.equal(formatLine('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ['e5', 'Nf3']), '1... e5 2. Nf3');
});

test('opening names, transpositions and book moves', async () => {
  await op.loadOpenings();
  assert.equal(op.openingOf(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']).name, 'Ruy Lopez');
  assert.match(op.openingOf(['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6']).name, /Najdorf/);
  // Queen's Gambit Declined reached by move-order transposition
  const qgd = op.openingOf(['g1f3', 'd7d5', 'd2d4', 'g8f6', 'c2c4', 'e7e6']);
  assert.ok(qgd && /Queen's Gambit Declined|Queen's Pawn|Indian/.test(qgd.name), qgd?.name);
  const starts = op.continuations(new Chess().fen()).map(c => c.san);
  for (const m of ['e4', 'd4', 'c4', 'Nf3']) assert.ok(starts.includes(m));
  assert.ok(op.searchLines('caro kann advance').length > 0);
  assert.equal(op.family('Sicilian Defense: Najdorf Variation'), 'Sicilian Defense');
});

test('puzzle picking stays near the target and skips seen ids', async () => {
  const idx = await pz.loadIndex();
  assert.ok(idx.total > 20000);
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const p = await pz.pickPuzzle(1100, { exclude: seen, spread: 75 });
    assert.ok(Math.abs(p.rating - 1100) <= 75, `rating ${p.rating}`);
    assert.ok(!seen.has(p.id));
    seen.add(p.id);
  }
  const short = await pz.pickPuzzle(700, { maxMoves: 4 });
  assert.ok(short.moves.length <= 4);
});

test('insights aggregate results by colour and opening', () => {
  const mk = (id, color, res, acc, blunders, opening) => ({
    id, date: Date.UTC(2026, 9, 1 + id), userColor: color, userResult: res, botName: 'Hazel', moves: ['e2e4', 'e7e5'],
    opening: { eco: 'C20', name: opening },
    review: { accuracy: { [color]: acc, [color === 'w' ? 'b' : 'w']: 50 }, counts: { w: { blunder: blunders, mistake: 0, inaccuracy: 1 }, b: { blunder: blunders, mistake: 0, inaccuracy: 1 } }, labels: ['best', 'best'], acc: [100, 100], phases: ['opening', 'opening'] },
  });
  const games = [mk(1, 'w', 'win', 80, 0, "King's Pawn Game"), mk(2, 'w', 'loss', 60, 2, "King's Pawn Game: Busch-Gass Gambit"), mk(3, 'b', 'draw', 70, 1, 'Sicilian Defense')];
  const d = computeInsights(games, { rating: 1150, attempts: [{ id: 'a', t: 1, after: 1120, ok: 0, themes: ['fork'] }, { id: 'b', t: 2, after: 1130, ok: 1, themes: ['fork'] }, { id: 'c', t: 3, after: 1110, ok: 0, themes: ['fork', 'short'] }] }, null);
  assert.equal(d.total, 3);
  assert.equal(d.score, 0.5);
  assert.equal(d.byColor.w.games, 2);
  assert.equal(d.byColor.w.acc, 70);
  assert.equal(d.byOpening[0].name, "King's Pawn Game");
  assert.equal(d.byOpening[0].games, 2);
  assert.equal(d.weakest[0].key, 'fork');
  assert.ok(Math.abs(d.weakest[0].rate - 1 / 3) < 1e-9);
  assert.ok(!d.weakest.some(t => t.key === 'short'), 'meta themes are excluded');
});

test('great, brilliant and miss labels', () => {
  // great: the only good move. 1.e4 e5 2.Qh5 Nc6 3.Bc4: Black must defend f7 (g6 / Qe7); others lose
  const moves = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g7g6'];
  const fens = positions(moves);
  const raw = {
    evals: [{ cp: 30 }, { cp: 30 }, { cp: 30 }, { cp: 20 }, { cp: 30 }, { cp: 30 }, { cp: 40 }],
    best: ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g7g6', 'h5f3'],
    pv: [[], [], [], [], [], ['g7g6'], ['h5f3']],
    second: [null, null, null, null, null, { mate: 1, move: 'g8f6' }, null],
  };
  const r = classify(raw, moves, fens, () => false);
  assert.equal(r.labels[5], 'great');
  // a recapture is never "great"
  const m2 = ['e2e4', 'd7d5', 'e4d5', 'd8d5'];
  const f2 = positions(m2);
  const r2 = classify({ evals: [{ cp: 30 }, { cp: 30 }, { cp: 30 }, { cp: 30 }, { cp: 30 }], best: m2.concat([null]), pv: [[], [], [], [], []], second: [null, null, null, { cp: -400, move: 'g8f6' }, null] }, m2, f2, () => false);
  assert.equal(r2.labels[3], 'best');
  // brilliant needs a real sacrifice
  assert.ok(isSacrifice('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 3', 'c4f7'), 'Bxf7+ gives up the bishop for a pawn');
  assert.ok(!isSacrifice('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 3', 'e1g1'));
  assert.ok(!isSacrifice('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'e4d5'), 'pawn captures are not sacrifices');
  // miss: Black blunders a piece, White does not take it and gives the advantage back
  const m3 = ['e2e4', 'e7e5', 'g1f3', 'f8a3', 'b1c3'];
  const f3 = positions(m3);
  const r3 = classify({
    evals: [{ cp: 30 }, { cp: 30 }, { cp: 30 }, { cp: 30 }, { cp: 330 }, { cp: 20 }],
    best: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'b2a3', null], pv: [[], [], [], [], ['b2a3'], []],
    second: [null, null, null, null, null, null],
  }, m3, f3, () => false);
  assert.equal(r3.labels[3], 'blunder');
  assert.equal(r3.labels[4], 'miss');
});

test('explanations use the right voice and only say undefended when true', () => {
  // bot (Black) hangs its queen: the text must not say "your"
  const moves = ['e2e4', 'e7e5', 'g1f3', 'd8h4'];
  const fens = positions(moves);
  const review = {
    labels: ['book', 'book', 'book', 'blunder'],
    evals: [{ cp: 30 }, { cp: 30 }, { cp: 30 }, { cp: 30 }, { cp: 900 }],
    best: [null, null, null, 'b8c6', 'f3h4'], pv: [[], [], [], ['b8c6'], ['f3h4', 'g8f6', 'd2d3']], acc: [],
  };
  const ex = explainMove(3, { fens, moves, sans: uciLineToSan(fens[0], moves), review, viewer: 'w', names: { w: 'You', b: 'Sprout' } });
  assert.match(ex.lines[0], /^Sprout's queen on h4 can simply be taken/);
  assert.doesNotMatch(ex.lines.join(' '), /\byour queen\b/i);
  // defended knight attacked by a pawn: not "undefended"
  const fen = 'rnbqkbnr/pp1ppppp/8/8/1p6/2N4P/PPPPPPP1/R1BQKBNR w KQkq - 0 1';
  const g2 = { fens: [fen, fenAfter(fen, 'h3h4')], moves: ['h3h4'], sans: ['h4'], viewer: 'w', names: { w: 'You', b: 'Bot' },
    review: { labels: ['mistake'], evals: [{ cp: 0 }, { cp: -250 }], best: ['c3e4', 'b4c3'], pv: [['c3e4'], ['b4c3', 'b2c3', 'g8f6']], acc: [] } };
  const ex2 = explainMove(0, g2);
  assert.doesNotMatch(ex2.lines.join(' '), /undefended/);
  assert.match(ex2.lines[0], /knight on c3 is attacked by a pawn/);
});

function fenAfter(fen, u) { const c = new Chess(fen); c.move({ from: u.slice(0, 2), to: u.slice(2, 4) }); return c.fen(); }

test('review sees threefold repetition through the game history', async () => {
  // knights shuffle back and forth: the final position is a draw by repetition
  const moves = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const fens = positions(moves);
  const calls = [];
  const stub = { analyze: async (fen, o) => { calls.push(o.moves.length); return { bestmove: 'e2e4', lines: [{ cp: 900, mate: null, pv: ['e2e4'] }] }; } };
  const raw = await analyzePositions(stub, fens, { depth: 5, moves });
  assert.deepEqual(raw.evals[8], { cp: 0, mate: null }, 'repeated position scores as a draw');
  assert.equal(calls.length, 8, 'the drawn final position is not sent to the engine');
  assert.equal(calls[7], 7, 'history is passed so the engine sees repetitions');
});

test('imports are sanitised and new progress merges', () => {
  const v = validateImport({ format: 'kibitz-chess-progress', data: {
    rush: { best: { 3: '<img src=x onerror=alert(1)>' }, runs: [{ score: '<b>', mode: 3, t: 1 }] },
    'game:a': { id: 'a', moves: ['e2e4', 'xx'], botName: '<script>', review: null }, evil: { a: 1 },
  } });
  assert.equal(v.data.rush.best[3], 0);
  assert.equal(v.data.rush.runs[0].score, 0);
  assert.deepEqual(v.data['game:a'].moves, ['e2e4']);
  assert.ok(!('evil' in v.data));
  const m = mergeData(
    { learn: { lessons: { forks: { done: true, t: 1 } }, drills: {} }, daily: { days: { '2026-10-29': 1 } }, quiz: { best: { mixed: 7 }, runs: [] } },
    { learn: { lessons: { pins: { done: true, t: 2 } }, drills: { kqk: { done: true, best: 9 } } }, daily: { days: { '2026-10-30': 1, '2026-10-29': 0 } }, quiz: { best: { mixed: 5, mate: 9 }, runs: [] } },
  );
  assert.ok(m.learn.lessons.forks.done && m.learn.lessons.pins.done && m.learn.drills.kqk.done);
  assert.deepEqual(m.daily.days, { '2026-10-29': 1, '2026-10-30': 1 });
  assert.deepEqual(m.quiz.best, { mixed: 7, mate: 9 });
  assert.equal(dailyStreak(m.daily.days, new Date(2026, 9, 30)), 2);
});
