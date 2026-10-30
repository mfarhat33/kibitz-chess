// Stockfish (single-threaded WASM, lite net) in a Web Worker, wrapped as a small promise-based UCI client.
// Searches are queued; cancel() drops pending jobs and stops the running one.

const ENGINE_URL = new URL('../engine/stockfish-19-lite-single.js', import.meta.url);

export class Engine {
  constructor() {
    this.queue = [];
    this.job = null;
    this.opts = {};
    this.listeners = [];
    this.ready = this.start();
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(ENGINE_URL);
      } catch (err) { this.fail(); reject(err); return; }
      this.worker.onmessage = (e) => this.onLine(String(e.data));
      this.worker.onerror = (e) => {
        console.error('engine error', e.message);
        this.fail();
        reject(e);
      };
      this.listeners = [];
      const wait = (token, then) => this.listeners.push({ token, then });
      wait('uciok', () => {
        this.send('setoption name Hash value 16');
        this.send('isready');
        wait('readyok', () => { this.isReady = true; resolve(); this.pump(); });
      });
      this.send('uci');
    });
  }

  /** The worker crashed or never started: settle every waiting search with null so no screen hangs. */
  fail() {
    this.failed = true;
    this.isReady = false;
    clearTimeout(this.watchdog);
    const pending = [this.job, ...this.queue].filter(Boolean);
    this.job = null;
    this.queue = [];
    for (const j of pending) j.resolve?.(null);
  }

  /** Replace a hung worker with a fresh one; the current search resolves null. */
  restart() {
    console.warn('engine restarted after a stuck search');
    const job = this.job;
    this.job = null;
    clearTimeout(this.watchdog);
    try { this.worker.terminate(); } catch { /* already gone */ }
    this.isReady = false;
    this.opts = {};
    job?.resolve?.(null);
    this.ready = this.start().catch(() => {});
  }

  send(cmd) { this.worker.postMessage(cmd); }

  setOption(name, value) {
    if (this.opts[name] === value) return;
    this.opts[name] = value;
    this.send(`setoption name ${name} value ${value}`);
  }

  newGame() {
    this.cancel();
    this.queue.push({ special: 'ucinewgame' });
    this.pump();
  }

  /**
   * Search a position. Scores in the result are from the side to move's point of view.
   * opts: { depth, movetime, multipv, elo (UCI_Elo limit), onInfo(lines),
   *         startFen + moves: send the game history so Stockfish can see repetitions }
   * Resolves to { bestmove, lines: [{ multipv, depth, cp, mate, pv: [uci] }] } or null if cancelled.
   */
  analyze(fen, opts = {}) {
    if (this.failed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.queue.push({ fen, opts, resolve, lines: [] });
      this.pump();
    });
  }

  cancel() {
    for (const j of this.queue) j.resolve?.(null);
    this.queue = [];
    if (this.job && !this.job.stopping) {
      this.job.cancelled = true;
      this.job.stopping = true;
      this.send('stop');
    }
  }

  stop() {
    if (this.job && !this.job.stopping) { this.job.stopping = true; this.send('stop'); }
  }

  pump() {
    if (!this.isReady || this.job || !this.queue.length) return;
    const job = this.queue.shift();
    if (job.special === 'ucinewgame') {
      this.send('ucinewgame');
      this.send('isready');
      this.job = job;
      return;
    }
    this.job = job;
    const o = job.opts;
    this.setOption('MultiPV', o.multipv || 1);
    if (o.elo) {
      this.setOption('UCI_LimitStrength', 'true');
      this.setOption('UCI_Elo', Math.max(1320, Math.min(3190, Math.round(o.elo))));
    } else {
      this.setOption('UCI_LimitStrength', 'false');
    }
    if (o.moves?.length && o.startFen) this.send(`position fen ${o.startFen} moves ${o.moves.join(' ')}`);
    else this.send(`position fen ${job.fen}`);
    let go = 'go';
    if (o.depth) go += ` depth ${o.depth}`;
    if (o.movetime) go += ` movetime ${o.movetime}`;
    if (o.nodes) go += ` nodes ${o.nodes}`;
    if (go === 'go') go += ' infinite';
    this.send(go);
    // watchdog: a search that overruns its budget is stopped, and a worker that ignores stop is replaced
    const budget = (o.movetime || 60000) + 10000;
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (this.job !== job) return;
      this.send('stop');
      this.watchdog = setTimeout(() => { if (this.job === job) this.restart(); }, 5000);
    }, budget);
  }

  onLine(line) {
    if (this.listeners.length) {
      const l = this.listeners[0];
      if (line.startsWith(l.token)) { this.listeners.shift(); l.then(); return; }
    }
    const job = this.job;
    if (!job) return;
    if (job.special) {
      if (line === 'readyok') { this.job = null; this.pump(); }
      return;
    }
    if (line.startsWith('info') && line.includes(' pv ')) {
      const info = parseInfo(line);
      if (!info || info.bound) return;
      job.lines[info.multipv - 1] = info;
      job.opts.onInfo?.(job.lines.filter(Boolean));
    } else if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const result = job.cancelled ? null : {
        bestmove: parts[1] === '(none)' ? null : parts[1],
        lines: job.lines.filter(Boolean),
      };
      clearTimeout(this.watchdog);
      this.job = null;
      job.resolve(result);
      this.pump();
    }
  }

  terminate() {
    this.cancel();
    this.worker?.terminate();
  }
}

export function parseInfo(line) {
  const t = line.split(' ');
  const out = { multipv: 1, depth: 0, cp: null, mate: null, pv: [], bound: false };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': out.depth = +t[++i]; break;
      case 'multipv': out.multipv = +t[++i]; break;
      case 'nodes': out.nodes = +t[++i]; break;
      case 'score':
        if (t[i + 1] === 'cp') out.cp = +t[i + 2];
        else if (t[i + 1] === 'mate') out.mate = +t[i + 2];
        i += 2;
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') { out.bound = true; i++; }
        break;
      case 'pv': out.pv = t.slice(i + 1); i = t.length; break;
      default: break;
    }
  }
  return out.pv.length ? out : null;
}

// Engines are created lazily and shared: one for the bot and hints, one for analysis.
const pool = {};
export function getEngine(name = 'analysis') {
  if (!pool[name]) pool[name] = new Engine();
  return pool[name];
}

// Score helpers. `turn` is 'w' or 'b' for the side to move in the analysed position.
export function toWhite(line, turn) {
  if (!line) return { cp: 0, mate: null };
  const s = turn === 'w' ? 1 : -1;
  return { cp: line.cp == null ? null : line.cp * s, mate: line.mate == null ? null : line.mate * s };
}

export function formatScore(score) {
  if (!score) return '0.0';
  if (score.mate != null) {
    if (score.mate === 0) return '#';
    return (score.mate > 0 ? '+' : '-') + 'M' + Math.abs(score.mate);
  }
  const v = (score.cp || 0) / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}
