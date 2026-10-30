// Drives one Lichess-format puzzle on a Board: the first move is the opponent's, then the solver
// must find each of their moves. Any checkmate is accepted on the final move.
import { Chess, dests, checkSquare, playUci, uciToMove, colorName } from './chessutil.js';
import { moveSound } from './ui.js';

export const START_RATING = 1100;

export function kFactor(attempts) {
  return attempts < 15 ? 48 : attempts < 40 ? 32 : attempts < 100 ? 24 : 18;
}

/** Elo-style update: score is 1 (clean solve), 0.5 (solved with a hint) or 0 (failed). */
export function updateRating(user, puzzleRating, score, attempts) {
  const expected = 1 / (1 + 10 ** ((puzzleRating - user) / 400));
  return user + kFactor(attempts) * (score - expected);
}

/** True if `uci` solves step `idx` of the puzzle from `fen` (the position before that step). */
export function isCorrect(puzzle, idx, fen, uci) {
  if (uci === puzzle.moves[idx]) return true;
  if (idx !== puzzle.moves.length - 1) return false;
  const c = new Chess(fen);
  return !!playUci(c, uci) && c.isCheckmate();
}

export class PuzzlePlayer {
  constructor(board, puzzle, { onWrong, onSolved, onStep, retry = true, replyDelay = 320 } = {}) {
    this.board = board;
    this.p = puzzle;
    this.chess = new Chess(puzzle.fen);
    this.idx = 0;
    this.done = false;
    this.cb = { onWrong, onSolved, onStep };
    this.retry = retry;
    this.replyDelay = replyDelay;
    this.timers = [];
    this.solver = this.chess.turn() === 'w' ? 'b' : 'w';
    this.lastMove = null;
    board.opts.onMove = (f, t, promo) => this.userMove(f, t, promo);
    board.el.dataset.puzzle = puzzle.id;
  }

  get solverName() { return this.solver === 'w' ? 'White' : 'Black'; }

  later(fn, ms) { const id = setTimeout(fn, ms); this.timers.push(id); }

  destroy() { this.timers.forEach(clearTimeout); this.done = true; this.board.opts.onMove = null; }

  render(animate = true) {
    const c = this.chess;
    this.board.setPosition(c.fen(), { lastMove: this.lastMove, check: checkSquare(c), animate });
    const mine = !this.done && c.turn() === this.solver;
    this.board.setMovable({ color: mine ? colorName(this.solver) : null, dests: mine ? dests(c) : new Map() });
  }

  start(delay = 450) {
    this.board.setOrientation(colorName(this.solver));
    this.board.setArrows([]);
    this.board.setMarks([]);
    this.render(false);
    this.later(() => this.playOpponent(), delay);
  }

  playOpponent() {
    if (this.done) return;
    const m = playUci(this.chess, this.p.moves[this.idx]);
    if (!m) return;
    this.idx++;
    this.lastMove = [m.from, m.to];
    moveSound(m, this.chess);
    this.render();
    this.cb.onStep?.(this);
  }

  userMove(from, to, promo) {
    if (this.done || this.chess.turn() !== this.solver) return;
    const legal = this.chess.moves({ verbose: true }).find(m => m.from === from && m.to === to && (!m.promotion || m.promotion === (promo || 'q')));
    if (!legal) return;
    const uci = from + to + (legal.promotion || '');
    if (isCorrect(this.p, this.idx, this.chess.fen(), uci)) {
      const m = playUci(this.chess, uci);
      this.idx++;
      this.lastMove = [m.from, m.to];
      moveSound(m, this.chess);
      this.board.setArrows([]);
      this.board.setMarks([{ sq: to, cls: 'right' }]);
      this.later(() => this.board.setMarks([]), 400);
      if (this.idx >= this.p.moves.length || this.chess.isCheckmate()) {
        this.done = true;
        this.render();
        this.cb.onSolved?.(this);
        return;
      }
      this.render();
      this.cb.onStep?.(this);
      this.later(() => this.playOpponent(), this.replyDelay);
    } else {
      const fen = this.chess.fen();
      const shown = new Chess(fen);
      const m = playUci(shown, uci);
      this.board.setPosition(shown.fen(), { lastMove: [m.from, m.to], check: checkSquare(shown) });
      this.board.setMovable({});
      this.board.setMarks([{ sq: to, cls: 'wrong' }]);
      this.board.shake();
      if (!this.retry) this.done = true;
      this.cb.onWrong?.(this, uci, m.san);
      if (this.retry) {
        this.later(() => { this.board.setMarks([]); this.render(); }, 650);
      }
    }
  }

  expected() { return this.p.moves[this.idx]; }

  hint() {
    if (this.done || this.chess.turn() !== this.solver) return false;
    const m = uciToMove(this.expected());
    this.board.setMarks([{ sq: m.from, cls: 'hint' }]);
    return true;
  }

  showArrow(color = 'rgba(16,150,110,.85)') {
    const u = this.expected();
    if (!u) return;
    const m = uciToMove(u);
    this.board.setArrows([{ from: m.from, to: m.to, color }]);
  }

  /** Plays the rest of the solution, one move at a time. */
  showSolution(onDone) {
    this.done = true;
    this.board.setMarks([]);
    const stepFn = () => {
      if (this.idx >= this.p.moves.length) { this.render(); onDone?.(); return; }
      const m = playUci(this.chess, this.p.moves[this.idx]);
      this.idx++;
      if (!m) { onDone?.(); return; }
      this.lastMove = [m.from, m.to];
      moveSound(m, this.chess);
      this.render();
      this.later(stepFn, 650);
    };
    this.render(false);
    this.later(stepFn, 200);
  }
}
