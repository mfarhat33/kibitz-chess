// Runs the full Stockfish review of a game and saves it on the game record. One job per game at a time,
// shared between the game-over card (which starts it right away) and the review page (which shows it).
// Jobs for different games wait in line on one engine instead of interrupting each other.
import { getEngine } from './engine.js';
import { positions, analyzePositions, classify } from './analysis.js';
import { isBook } from './openings-data.js';
import { START_FEN } from './chessutil.js';
import * as store from './store.js';

export const REVIEW_VERSION = 3;
const jobs = new Map();
let queue = Promise.resolve();
let active = null;

/** The running or waiting job for this game id, if any: { depth, done, total, promise, listen(fn) }. */
export function reviewJob(id) { return jobs.get(id) || null; }

/** Stops a job (for example to start a deeper one). Only the engine work of that job is stopped. */
export function cancelReview(id) {
  const j = jobs.get(id);
  if (!j) return;
  j.cancelled = true;
  jobs.delete(id);
  if (active === j) getEngine('review').cancel();
}

/**
 * Starts (or joins) the review of `game` at `depth`. The promise resolves to the saved review,
 * or null if the engine failed or the job was cancelled.
 */
export function startReview(game, depth) {
  const running = jobs.get(game.id);
  if (running && running.depth === depth) return running;
  if (running) cancelReview(game.id);
  const fens = positions(game.moves, game.startFen || START_FEN);
  const listeners = new Set();
  const job = { id: game.id, depth, done: 0, total: fens.length, cancelled: false, waiting: true, listen: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  // its own engine, so hints, exploring moves or a new game never interrupt it
  const eng = getEngine('review');
  const run = async () => {
    if (job.cancelled) return null;
    active = job;
    job.waiting = false;
    try {
      return await analyzePositions(eng, fens, {
        depth,
        moves: game.moves,
        isCancelled: () => job.cancelled,
        onProgress: (d, t) => { job.done = d; job.total = t; listeners.forEach(fn => { try { fn(d, t); } catch { /* listener gone */ } }); },
      });
    } finally { if (active === job) active = null; }
  };
  job.promise = (queue = queue.then(run, run)).then((raw) => {
    if (jobs.get(game.id) === job) jobs.delete(game.id);
    if (!raw || job.cancelled) return null;
    const cls = classify(raw, game.moves, fens, isBook);
    const review = {
      v: REVIEW_VERSION, depth, date: Date.now(),
      evals: raw.evals, best: raw.best, pv: raw.pv, second: raw.second,
      labels: cls.labels, acc: cls.acc.map(a => Math.round(a * 10) / 10), loss: cls.loss.map(a => Math.round(a * 10) / 10),
      phases: cls.phases, accuracy: cls.accuracy, counts: cls.counts,
    };
    // save onto the latest copy of the record (it may have changed meanwhile)
    const fresh = store.get('game:' + game.id);
    if (fresh) { fresh.review = review; store.set('game:' + game.id, fresh); }
    game.review = review;
    return review;
  }, () => { if (jobs.get(game.id) === job) jobs.delete(game.id); return null; });
  jobs.set(game.id, job);
  return job;
}
