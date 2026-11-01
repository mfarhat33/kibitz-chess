// A tree of moves for the analysis board: a main line plus any number of side lines (variations),
// each move with an optional comment and annotation (!, ?, !!, ??, !?, ?!). Reads and writes PGN.
import { Chess, START_FEN } from './chessutil.js';
import { parsePgnTree } from './lib/chess.js';

export const NAGS = ['!', '?', '!!', '??', '!?', '?!'];
const NAG_CODE = { '!': '$1', '?': '$2', '!!': '$3', '??': '$4', '!?': '$5', '?!': '$6' };
const CODE_NAG = Object.fromEntries(Object.entries(NAG_CODE).map(([k, v]) => [v, k]));

export class MoveTree {
  constructor(startFen = START_FEN) {
    this.startFen = new Chess(startFen).fen();
    this.next = 1;
    this.root = { id: 0, uci: null, san: null, fen: this.startFen, parent: null, children: [], comment: '', nag: '' };
    this.byId = new Map([[0, this.root]]);
  }

  get(id) { return this.byId.get(id) || null; }

  /** Plays `uci` after `parent`: returns the existing child for that move, or a new node (null if illegal). */
  add(parent, uci) {
    const found = parent.children.find(c => c.uci === uci);
    if (found) return found;
    const c = new Chess(parent.fen);
    let m;
    try { m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { m = null; }
    if (!m) return null;
    const node = { id: this.next++, uci: m.from + m.to + (m.promotion || ''), san: m.san, fen: c.fen(), parent, children: [], comment: '', nag: '', last: [m.from, m.to] };
    parent.children.push(node);
    this.byId.set(node.id, node);
    return node;
  }

  /** Nodes from the first move down to `node` (the root itself is not included). */
  path(node) {
    const out = [];
    for (let n = node; n && n.parent; n = n.parent) out.push(n);
    return out.reverse();
  }
  ucis(node) { return this.path(node).map(n => n.uci); }
  /** Last node of the line that continues from `node` (always taking the first child). */
  lineEnd(node) { let n = node; while (n.children.length) n = n.children[0]; return n; }
  mainEnd() { return this.lineEnd(this.root); }
  /** True when `node` is on the main line. */
  isMain(node) { for (let n = node; n.parent; n = n.parent) if (n.parent.children[0] !== n) return false; return true; }
  /** The main-line moves as UCI (for review and "play from here"). */
  mainLine() { return this.ucis(this.mainEnd()); }

  /** Moves the side line containing `node` one step towards the main line. */
  promote(node) {
    for (let n = node; n.parent; n = n.parent) {
      const sib = n.parent.children;
      const i = sib.indexOf(n);
      if (i > 0) { sib.splice(i, 1); sib.splice(i - 1, 0, n); return true; }
    }
    return false;
  }
  /** Removes `node` and everything after it; returns its parent. */
  remove(node) {
    if (!node.parent) return node;
    const p = node.parent;
    p.children = p.children.filter(c => c !== node);
    const drop = (n) => { this.byId.delete(n.id); n.children.forEach(drop); };
    drop(node);
    return p;
  }
  /** Number of nodes after the root. */
  size() { return this.byId.size - 1; }

  // ---------- saving ----------
  toJSON() {
    const ser = (n) => {
      const o = { u: n.uci };
      if (n.comment) o.c = n.comment;
      if (Number.isFinite(n.clk)) o.t = n.clk;
      if (n.nag) o.n = n.nag;
      if (n.children.length) o.k = n.children.map(ser);
      return o;
    };
    return { f: this.startFen, c: this.root.comment || undefined, k: this.root.children.map(ser) };
  }
  static fromJSON(obj) {
    const t = new MoveTree(obj?.f || START_FEN);
    if (obj?.c) t.root.comment = String(obj.c).slice(0, 2000);
    const load = (parent, list) => {
      for (const o of Array.isArray(list) ? list : []) {
        if (typeof o?.u !== 'string') continue;
        const n = t.add(parent, o.u);
        if (!n) continue;
        if (o.c) n.comment = String(o.c).slice(0, 2000);
        if (Number.isFinite(o.t)) n.clk = o.t;
        if (NAGS.includes(o.n)) n.nag = o.n;
        load(n, o.k);
      }
    };
    load(t.root, obj?.k);
    return t;
  }
  static fromLine(startFen, line) {
    const t = new MoveTree(startFen || START_FEN);
    let n = t.root;
    for (const u of line || []) { const c = t.add(n, u); if (!c) break; n = c; }
    return t;
  }
  /** Path of child indexes from the root to `node`, for remembering the current move. */
  indexPath(node) { return this.path(node).map(n => n.parent.children.indexOf(n)); }
  fromIndexPath(idx) {
    let n = this.root;
    for (const i of Array.isArray(idx) ? idx : []) { const c = n.children[i]; if (!c) break; n = c; }
    return n;
  }

  // ---------- PGN ----------
  /** PGN text with variations, comments and annotations. */
  toPgn(headers = {}) {
    const h = { Event: '?', Site: '?', Date: '????.??.??', Round: '?', White: '?', Black: '?', Result: '*', ...headers };
    if (this.startFen !== START_FEN) { h.SetUp = '1'; h.FEN = this.startFen; }
    const head = Object.entries(h).filter(([, v]) => v != null && v !== '').map(([k, v]) => `[${k} "${String(v).replace(/["\\]/g, '')}"]`).join('\n');
    const toks = [];
    const cmt = (s) => s ? `{${s.replace(/[{}]/g, '')}}` : null;
    const num = (n, force) => {
      const [, turn, , , , full] = n.parent.fen.split(' ');
      if (turn === 'w') return `${full}.`;
      return force ? `${full}...` : null;
    };
    const mv = (n, force) => {
      const nb = num(n, force);
      if (nb) toks.push(nb);
      toks.push(n.san + (n.nag ? ` ${NAG_CODE[n.nag]}` : ''));
      if (n.comment) toks.push(cmt(n.comment));
    };
    // writes the line that continues after `parent`, with its side lines
    const line = (parent, force) => {
      let p = parent, f = force;
      while (p.children.length) {
        const [main, ...alts] = p.children;
        mv(main, f);
        for (const a of alts) { toks.push('('); mv(a, true); line(a, false); toks.push(')'); }
        f = alts.length > 0 || !!main.comment;
        p = main;
      }
    };
    if (this.root.comment) toks.push(cmt(this.root.comment));
    line(this.root, true);
    toks.push(h.Result || '*');
    // wrap at about 80 characters like most PGN writers
    let out = '', len = 0;
    for (const t of toks.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')').split(' ')) {
      if (len + t.length + 1 > 80 && len) { out += '\n'; len = 0; } else if (len) { out += ' '; len++; }
      out += t; len += t.length;
    }
    return `${head}\n\n${out}\n`;
  }

  /** Reads a PGN (with variations, comments and annotations). Throws if the main line has an illegal move. */
  static fromPgn(text) {
    // a file with several games: take the first one
    let src = text.trim();
    const second = src.slice(1).search(/\n\s*\n\s*\[Event /);
    if (second > 0) src = src.slice(0, second + 1);
    const parsed = parsePgnTree(src);
    const headers = parsed.headers || {};
    const fenKey = Object.keys(headers).find(k => k.toLowerCase() === 'fen');
    const start = fenKey ? new Chess(headers[fenKey]).fen() : START_FEN;
    const t = new MoveTree(start);
    if (parsed.root?.comment) t.root.comment = parsed.root.comment;
    let mainMoves = 0;
    const walk = (treeNode, parsedNode, main) => {
      // the parser wraps each side line in a node without a move; unwrap those into plain alternatives
      // (recursively: a side line can itself start with a nested side line, and may carry a comment before its first move)
      const kids = [];
      const unwrap = (v, pre) => {
        if (v.move) { if (pre) v.comment = v.comment ? `${pre} ${v.comment}` : pre; kids.push(v); return; }
        (v.variations || []).forEach((w, i) => unwrap(w, i === 0 ? [pre, v.comment].filter(Boolean).join(' ') : ''));
      };
      for (const v of parsedNode.variations || []) unwrap(v, '');
      kids.forEach((k, i) => {
        const c = new Chess(treeNode.fen);
        let m = null;
        try { m = c.move(k.move, { strict: false }); } catch { m = null; }
        if (!m) { if (main && i === 0) throw new Error(`Illegal move ${k.move}`); return; }
        const n = t.add(treeNode, m.from + m.to + (m.promotion || ''));
        if (k.comment) {
          // chess sites put clock and engine data in comments: keep the clock, hide the commands
          const clk = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/.exec(k.comment);
          if (clk) n.clk = Math.round(((+clk[1]) * 3600 + (+clk[2]) * 60 + (+clk[3])) * 1000);
          const text = k.comment.replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
          if (text) n.comment = text;
        }
        const suffix = Array.isArray(k.suffix) ? k.suffix.join('') : k.suffix;
        const code = Array.isArray(k.nag) ? k.nag[0] : k.nag;
        const nag = NAGS.includes(suffix) ? suffix : code != null ? CODE_NAG['$' + String(code).replace('$', '')] : null;
        if (NAGS.includes(nag)) n.nag = nag;
        if (main && i === 0) mainMoves++;
        walk(n, k, main && i === 0);
      });
    };
    walk(t.root, parsed.root || { variations: [] }, true);
    return { tree: t, headers, mainMoves };
  }
}
