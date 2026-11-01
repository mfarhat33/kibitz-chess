// Interactive chessboard. Tap a piece then a square, or drag it. Pointer events cover mouse and touch.
// The board never decides legality itself: callers pass `dests` (from -> [to]) and get onMove(from, to, promo).
// Castling also works by moving the king onto its own rook. While it is not your turn, callers can
// allow premoves with setPremovable(); the chosen premove is kept in `board.premove`.

const PROMO_ORDER = ['q', 'n', 'r', 'b'];

/** URL of a piece image ('wK', 'bP', ...) in the piece set chosen in settings. */
export function pieceUrl(code) {
  return `img/pieces/${document.documentElement.dataset.pieces || 'cburnett'}/${code}.svg`;
}

export function sqToXY(sq, orientation) {
  const f = sq.charCodeAt(0) - 97, r = sq.charCodeAt(1) - 49;
  return orientation === 'white' ? [f, 7 - r] : [7 - f, r];
}
function xyToSq(x, y, orientation) {
  const f = orientation === 'white' ? x : 7 - x;
  const r = orientation === 'white' ? 7 - y : y;
  return String.fromCharCode(97 + f) + (r + 1);
}
export function parseBoard(fen) {
  const map = new Map();
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      map.set(String.fromCharCode(97 + f) + (8 - i), color + ch.toUpperCase());
      f++;
    }
  });
  return map;
}

const svgNS = 'http://www.w3.org/2000/svg';

const DRAW_COLORS = { g: 'rgba(21,128,61,.75)', r: 'rgba(200,40,40,.75)', b: 'rgba(32,110,210,.75)', y: 'rgba(214,160,0,.8)' };
function drawColor(e) {
  const alt = e.altKey || e.ctrlKey || e.metaKey;
  if (e.shiftKey && alt) return 'y';
  if (e.shiftKey) return 'r';
  if (alt) return 'b';
  return 'g';
}

export class Board {
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    this.orientation = opts.orientation || 'white';
    this.coordinates = opts.coordinates !== false;
    this.pieces = new Map();
    this.els = new Map();
    this.movable = { color: null, dests: new Map() };
    this.premovable = { color: null, dests: new Map() };
    this.premove = null;
    this.lastMove = null;
    this.check = null;
    this.selected = null;
    this.hover = null;
    this.arrows = [];
    this.userArrows = [];
    this.userCircles = [];
    this.badges = [];
    this.marks = [];
    this.drag = null;
    this.version = 0;
    this.animate = opts.animate !== false;
    this.snapSq = null;
    this.ghost = null;
    this.raf = 0;
    this.boardFen = null;
    this.rightStart = null;
    this.rightHover = null;
    this.promoPreview = null;

    el.classList.add('kb-board');
    el.innerHTML = '';
    this.sqLayer = this.layer('kb-sqs');
    this.coordLayer = this.layer('kb-coords');
    this.pieceLayer = this.layer('kb-pieces');
    this.arrowSvg = document.createElementNS(svgNS, 'svg');
    this.arrowSvg.setAttribute('class', 'kb-layer kb-arrows');
    this.arrowSvg.setAttribute('viewBox', '0 0 8 8');
    el.appendChild(this.arrowSvg);
    this.badgeLayer = this.layer('kb-badges');

    this.onDown = this.onDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onUp = this.onUp.bind(this);
    this.onCancel = this.onCancel.bind(this);
    this.onContext = (e) => e.preventDefault();
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('contextmenu', this.onContext);

    this.renderCoords();
    if (opts.fen) this.setPosition(opts.fen, { animate: false });
  }

  layer(cls) {
    const d = document.createElement('div');
    d.className = 'kb-layer ' + cls;
    this.el.appendChild(d);
    return d;
  }

  destroy() {
    if (this.drag) this.endDrag(this.drag);
    this.drag = null;
    this.floatLayer?.remove();
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onPointerMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onCancel);
    this.el.removeEventListener('contextmenu', this.onContext);
    this.el.innerHTML = '';
  }

  // ---------- state setters ----------
  setPosition(fen, { lastMove = this.lastMove, check = null, animate = true } = {}) {
    this.version++;
    this.lastMove = lastMove;
    this.check = check;
    this.closePromo();
    const boardFen = fen.split(' ')[0];
    if (boardFen !== this.boardFen && (this.userArrows.length || this.userCircles.length)) {
      // hand-drawn arrows and circles belong to the position they were drawn on
      this.userArrows = [];
      this.userCircles = [];
      this.renderArrows();
    }
    this.boardFen = boardFen;
    const next = parseBoard(fen);
    const doAnim = animate && this.animate && this.pieces.size > 0;
    this.el.classList.toggle('animate', doAnim);
    const old = new Map(this.els);
    const placed = new Map();
    for (const [sq, p] of next) {
      const e = old.get(sq);
      if (e && e.dataset.p === p) { placed.set(sq, e); old.delete(sq); }
    }
    for (const [sq, p] of next) {
      if (placed.has(sq)) continue;
      // reuse the nearest element of the same piece type so moves animate
      let best = null, bestD = 99;
      const [tx, ty] = sqToXY(sq, 'white');
      for (const [osq, e] of old) {
        if (e.dataset.p !== p) continue;
        const [ox, oy] = sqToXY(osq, 'white');
        const d = Math.hypot(ox - tx, oy - ty);
        if (d < bestD) { bestD = d; best = osq; }
      }
      let e;
      if (best) { e = old.get(best); old.delete(best); }
      else {
        e = document.createElement('div');
        e.className = 'kb-piece ' + p;
        e.dataset.p = p;
        this.pieceLayer.appendChild(e);
      }
      placed.set(sq, e);
    }
    // the piece in the player's hand moved or vanished (a premove ran, it was captured): drop the drag
    if (this.drag && placed.get(this.drag.sq) !== this.drag.el) this.cancelDrag();
    for (const e of placed.values()) if (e !== this.drag?.el) e.classList.remove('dragging');
    if (!this.drag && this.ghost) { this.ghost.remove(); this.ghost = null; }
    // a piece that was just dropped by hand lands at once instead of sliding from the pointer
    if (this.snapSq && placed.get(this.snapSq)) {
      const e = placed.get(this.snapSq);
      e.classList.add('snap');
      requestAnimationFrame(() => requestAnimationFrame(() => e.classList.remove('snap')));
    }
    this.snapSq = null;
    for (const e of old.values()) {
      if (e === this.drag?.el) this.cancelDrag();
      if (doAnim) { e.classList.add('fade'); setTimeout(() => e.remove(), 320); }
      else e.remove();
    }
    this.els = placed;
    this.pieces = next;
    if (this.premove && this.pieces.get(this.premove.from) !== this.premove.piece) this.premove = null;
    this.placeAll();
    if (this.selected && !this.pieces.has(this.selected)) this.selected = null;
    this.renderSquares();
  }

  setMovable({ color = null, dests = new Map() } = {}) {
    this.movable = { color, dests };
    if (this.selected && !this.selectable(this.selected)) this.selected = null;
    this.renderSquares();
  }

  /** Allow premoves for `color` with these (pseudo-legal) destinations while it is not that side's turn. */
  setPremovable({ color = null, dests = new Map() } = {}) {
    this.premovable = { color, dests };
    if (!color && this.premove) { this.premove = null; this.placeAll(); }
    if (this.selected && !this.selectable(this.selected)) this.selected = null;
    this.renderSquares();
  }

  setPremove(pm) {
    this.premove = pm;
    this.placeAll();
    this.renderSquares();
  }

  premoveMode() {
    return !this.movable.color && !!this.premovable.color;
  }

  activeDests() {
    return this.premoveMode() ? this.premovable.dests : this.movable.dests;
  }

  selectable(sq) {
    const p = this.pieces.get(sq);
    return !!p && this.isMine(p);
  }

  setOrientation(o) {
    if (o === this.orientation) return;
    this.orientation = o;
    this.el.classList.remove('animate');
    this.placeAll();
    this.renderCoords();
    this.renderSquares();
    this.renderArrows();
    this.renderBadges();
  }
  flip() { this.setOrientation(this.orientation === 'white' ? 'black' : 'white'); }

  setArrows(arrows = []) { this.arrows = arrows; this.renderArrows(); }
  setBadges(badges = []) { this.badges = badges; this.renderBadges(); }
  setMarks(marks = []) { this.marks = marks; this.renderSquares(); }
  clearUserDrawings() { this.userArrows = []; this.userCircles = []; this.renderArrows(); this.renderSquares(); }

  shake() {
    this.el.classList.remove('shake');
    void this.el.offsetWidth;
    this.el.classList.add('shake');
  }

  // ---------- rendering ----------
  placeEl(e, sq) {
    const [x, y] = sqToXY(sq, this.orientation);
    e.style.transform = `translate3d(${x * 100}%, ${y * 100}%, 0)`;
  }

  /** Put every piece on its square; a premoved piece is shown on its target, a held piece stays in hand. */
  placeAll() {
    const pm = this.premove;
    for (const [sq, e] of this.els) {
      if (this.drag?.started && e === this.drag.el) continue;
      this.placeEl(e, pm && pm.from === sq ? pm.to : sq);
    }
  }

  sqStyle(sq) {
    const [x, y] = sqToXY(sq, this.orientation);
    return `left:${x * 12.5}%;top:${y * 12.5}%`;
  }

  renderCoords() {
    this.coordLayer.innerHTML = '';
    if (!this.coordinates) return;
    let html = '';
    for (let y = 0; y < 8; y++) {
      const sq = xyToSq(0, y, this.orientation);
      const light = (0 + y) % 2 === 0;
      html += `<div class="kb-sq" style="left:0;top:${y * 12.5}%"><span class="kb-coord rank ${light ? 'on-light' : 'on-dark'}">${sq[1]}</span></div>`;
    }
    for (let x = 0; x < 8; x++) {
      const sq = xyToSq(x, 7, this.orientation);
      const light = (x + 7) % 2 === 0;
      html += `<div class="kb-sq" style="left:${x * 12.5}%;top:87.5%"><span class="kb-coord file ${light ? 'on-light' : 'on-dark'}">${sq[0]}</span></div>`;
    }
    this.coordLayer.innerHTML = html;
  }

  renderSquares() {
    const cls = new Map();
    const add = (sq, c) => { if (sq) cls.set(sq, (cls.get(sq) || '') + ' ' + c); };
    if (this.lastMove) { add(this.lastMove[0], 'last'); add(this.lastMove[1], 'last'); }
    if (this.premove) { add(this.premove.from, 'premove'); add(this.premove.to, 'premove'); }
    for (const m of this.marks) add(m.sq, m.cls);
    if (this.check) add(this.check, 'check');
    if (this.selected) {
      add(this.selected, 'sel');
      for (const d of this.activeDests().get(this.selected) || []) {
        add(d, this.pieces.has(d) ? 'dest cap' : 'dest');
      }
      // when the king can castle, its rook is a target too (drop the king on it to castle)
      for (const rookSq of this.castleRooks(this.selected)) add(rookSq, 'dest cap castle');
    }
    if (this.hover && this.drag?.started) add(this.hover, this.drag.touch ? 'hover touch' : 'hover');
    for (const c of this.userCircles) add(c.sq, 'mark-circle mc-' + c.c);
    let html = '';
    for (const [sq, c] of cls) html += `<div class="kb-sq${c}" style="${this.sqStyle(sq)}"></div>`;
    this.sqLayer.innerHTML = html;
  }

  renderArrows() {
    const all = [...this.arrows, ...this.userArrows.map(a => ({ ...a, color: a.color || 'rgba(21,128,61,.75)' }))];
    // the arrow being drawn with the right button follows the pointer
    if (this.rightStart && this.rightHover && this.rightHover !== this.rightStart) {
      all.push({ from: this.rightStart, to: this.rightHover, color: DRAW_COLORS[this.rightColor || 'g'].replace(/[\d.]+\)$/, '.5)') });
    }
    let html = '';
    for (const a of all) {
      const [x1, y1] = sqToXY(a.from, this.orientation);
      const [x2, y2] = sqToXY(a.to, this.orientation);
      html += arrowPath(x1 + .5, y1 + .5, x2 + .5, y2 + .5, a.color || 'rgba(59,91,219,.8)', a.width || 0.16);
    }
    this.arrowSvg.innerHTML = html;
  }

  renderBadges() {
    let html = '';
    for (const b of this.badges) {
      const [x, y] = sqToXY(b.sq, this.orientation);
      const left = Math.min((x + 1) * 12.5, 100);
      const tx = x === 7 ? '-100%' : '-60%';
      const ty = y === 0 ? '0%' : '-40%';
      html += `<div class="kb-badge q-${b.cls}" style="left:${left}%;top:${y * 12.5}%;transform:translate(${tx},${ty})">${b.text}</div>`;
    }
    this.badgeLayer.innerHTML = html;
  }

  // ---------- input ----------
  squareAt(cx, cy) {
    const r = this.el.getBoundingClientRect();
    const x = Math.floor((cx - r.left) / r.width * 8);
    const y = Math.floor((cy - r.top) / r.height * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return xyToSq(x, y, this.orientation);
  }

  canMove(from, to) {
    return (this.activeDests().get(from) || []).includes(to);
  }

  /**
   * The real destination for a move attempt from -> to, or null. A king moved onto its own rook castles
   * towards it, but only when that castling move is available. In premove mode a tap on one of your own
   * pieces selects it rather than premoving onto it (a drag can still premove a recapture there).
   */
  resolveDest(from, to, { tap = false } = {}) {
    if (!from || !to || from === to) return null;
    if (this.castleRooks(from).includes(to)) return (to > from ? 'g' : 'c') + from[1];
    if (!this.canMove(from, to)) return null;
    // (only premove targets can hold your own pieces; ordinary legal moves never do)
    const target = this.pieces.get(to);
    if (tap && this.premoveMode() && target && this.isMine(target)) return null;
    return to;
  }

  /** Rook squares the selected king could be dropped on to castle. */
  castleRooks(sq) {
    const piece = this.pieces.get(sq);
    if (piece?.[1] !== 'K') return [];
    const out = [];
    for (const d of this.activeDests().get(sq) || []) {
      if (d[1] !== sq[1] || Math.abs(d.charCodeAt(0) - sq.charCodeAt(0)) !== 2) continue;
      const step = d > sq ? 1 : -1;
      for (let f = d.charCodeAt(0) + step; f >= 97 && f <= 104; f += step) {
        const rs = String.fromCharCode(f) + sq[1];
        if (this.pieces.get(rs) === piece[0] + 'R') { out.push(rs); break; }
      }
    }
    return out;
  }

  isMine(piece) {
    const c = this.movable.color || this.premovable.color;
    if (!c || !piece) return false;
    return c === 'both' || (piece[0] === 'w') === (c === 'white');
  }

  select(sq) {
    this.selected = sq;
    this.renderSquares();
  }

  onDown(e) {
    if (this.promoEl) return;
    const sq = this.squareAt(e.clientX, e.clientY);
    if (e.button === 2) {
      this.rightStart = sq;
      this.rightColor = drawColor(e);
      this.rightHover = null;
      if (this.premove) this.cancelPremove();
      return;
    }
    if (e.button !== 0) return;
    // one finger at a time: a second touch while a piece is held is ignored
    if (this.drag || e.isPrimary === false) return;
    if (this.userArrows.length || this.userCircles.length) this.clearUserDrawings();
    if (!sq) return;
    e.preventDefault();
    if (this.opts.onSquare) { this.opts.onSquare(sq); return; }
    if (this.selected && this.selected !== sq) {
      const dest = this.resolveDest(this.selected, sq, { tap: true });
      if (dest) { this.tryMove(this.selected, dest); return; }
    }
    const piece = this.pieces.get(sq);
    if (piece && this.isMine(piece)) {
      const wasSelected = this.selected === sq;
      this.select(sq);
      // a piece that cannot move is still selected (no dots), so the tap is acknowledged
      if (!this.activeDests().has(sq) && !this.castleRooks(sq).length) return;
      const r = this.el.getBoundingClientRect();
      this.drag = {
        sq, el: this.els.get(sq), piece, started: false, wasSelected, pointerId: e.pointerId,
        x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
        touch: e.pointerType !== 'mouse', size: r.width / 8,
      };
      try { this.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    } else {
      if (this.premove && !this.selected) this.cancelPremove();
      this.select(null);
    }
  }

  onPointerMove(e) {
    if (this.rightStart && (e.buttons & 2)) {
      const sq = this.squareAt(e.clientX, e.clientY);
      if (sq !== this.rightHover) { this.rightHover = sq; this.renderArrows(); }
      return;
    }
    const d = this.drag;
    if (!d) {
      // desktop: a grab cursor over pieces you can pick up
      if (e.pointerType === 'mouse') {
        const sq = this.squareAt(e.clientX, e.clientY);
        const p = sq && this.pieces.get(sq);
        const c = p && this.isMine(p) && (this.activeDests().has(sq) || this.castleRooks(sq).length) ? 'grab' : '';
        if (this.el.style.cursor !== c) this.el.style.cursor = c;
      }
      return;
    }
    if (e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.started && Math.hypot(d.x - d.x0, d.y - d.y0) < (d.touch ? 7 : 3)) return;
    if (!d.started) this.startDrag(d);
    // draw once per frame, however many pointer events arrive
    if (!this.raf) this.raf = requestAnimationFrame(() => this.drawDrag());
  }

  startDrag(d) {
    d.started = true;
    d.size = this.el.getBoundingClientRect().width / 8;
    this.el.classList.remove('animate');
    this.el.style.cursor = 'grabbing';
    // a faded copy stays on the starting square while the piece is in the air
    this.ghost = document.createElement('div');
    this.ghost.className = `kb-piece ${d.piece} ghost`;
    this.placeEl(this.ghost, d.sq);
    this.pieceLayer.insertBefore(this.ghost, this.pieceLayer.firstChild);
    // the held piece floats above the page so it can pass the board's edge
    if (!this.floatLayer) {
      this.floatLayer = document.createElement('div');
      this.floatLayer.className = 'kb-float';
    }
    if (!this.floatLayer.isConnected) document.body.appendChild(this.floatLayer);
    d.el.style.width = d.el.style.height = d.size + 'px';
    d.el.classList.add('dragging');
    this.floatLayer.appendChild(d.el);
  }

  drawDrag() {
    this.raf = 0;
    const d = this.drag;
    if (!d?.started) return;
    const lift = d.touch ? d.size * 0.45 : 0;
    d.el.style.transform = `translate3d(${d.x - d.size / 2}px, ${d.y - d.size / 2 - lift}px, 0) scale(${d.touch ? 1.25 : 1.06})`;
    const over = this.squareAt(d.x, d.y - lift);
    if (over !== this.hover) { this.hover = over; this.renderSquares(); }
  }

  /** Puts a held piece back into the board (it is placed by the caller). */
  endDrag(d) {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.ghost?.remove();
    this.ghost = null;
    this.hover = null;
    this.el.style.cursor = '';
    if (d?.el) {
      d.el.classList.remove('dragging');
      d.el.style.width = d.el.style.height = '';
      if (d.el.parentNode === this.floatLayer) this.pieceLayer.appendChild(d.el);
    }
  }

  cancelDrag() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    this.endDrag(d);
    this.select(null);
  }

  onUp(e) {
    if (e.button === 2) {
      const end = this.squareAt(e.clientX, e.clientY);
      const start = this.rightStart;
      this.rightStart = null;
      this.rightHover = null;
      if (!start || !end) { this.renderArrows(); return; }
      // like other chess sites: plain = green, Shift = red, Alt/Ctrl = blue, Shift+Alt = yellow
      const col = drawColor(e) || this.rightColor || 'g';
      if (start === end) {
        const i = this.userCircles.findIndex(c => c.sq === start);
        const same = i >= 0 && this.userCircles[i].c === col;
        if (i >= 0) this.userCircles.splice(i, 1);
        if (!same) this.userCircles.push({ sq: start, c: col });
        this.renderSquares();
      } else {
        const i = this.userArrows.findIndex(a => a.from === start && a.to === end);
        const same = i >= 0 && this.userArrows[i].color === DRAW_COLORS[col];
        if (i >= 0) this.userArrows.splice(i, 1);
        if (!same) this.userArrows.push({ from: start, to: end, color: DRAW_COLORS[col] });
      }
      this.renderArrows();
      return;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    if (!d.started) {
      if (d.wasSelected) this.select(null);
      return;
    }
    const lift = d.touch ? d.size * 0.45 : 0;
    const to = this.squareAt(e.clientX, e.clientY - lift);
    this.endDrag(d);
    const dest = to && to !== d.sq ? this.resolveDest(d.sq, to) : null;
    if (dest) {
      // land at once: on the drop square, or for a king dropped on its rook straight on its castling square
      this.placeEl(d.el, dest);
      this.snapSq = dest;
      d.el.classList.add('snap');
      requestAnimationFrame(() => requestAnimationFrame(() => d.el.classList.remove('snap')));
      this.tryMove(d.sq, dest);
    } else {
      // not a legal square: glide back
      this.el.classList.toggle('animate', this.animate);
      this.placeAll();
      if (to !== d.sq) this.select(null); else this.renderSquares();
    }
  }

  onCancel(e) {
    const d = this.drag;
    if (!d || (e && e.pointerId !== d.pointerId)) return;
    this.drag = null;
    this.endDrag(d);
    this.placeAll();
    this.renderSquares();
  }

  cancelPremove() {
    this.premove = null;
    this.el.classList.toggle('animate', this.animate);
    this.placeAll();
    this.renderSquares();
    this.opts.onPremove?.(null);
  }

  tryMove(from, to) {
    const piece = this.pieces.get(from);
    const promotes = piece && piece[1] === 'P' && (to[1] === '8' || to[1] === '1');
    if (this.premoveMode()) {
      // premoves always promote to a queen
      this.select(null);
      this.snapSq = null;
      this.premove = { from, to, piece, promo: promotes ? 'q' : undefined };
      this.el.classList.toggle('animate', this.animate);
      this.placeAll();
      this.renderSquares();
      this.opts.onPremove?.(this.premove);
      return;
    }
    if (promotes) {
      if (document.documentElement.dataset.autoqueen === '1') { this.finishMove(from, to, 'q'); return; }
      this.openPromo(from, to, piece[0]);
      return;
    }
    this.finishMove(from, to);
  }

  finishMove(from, to, promo) {
    const v = this.version;
    this.select(null);
    this.opts.onMove?.(from, to, promo);
    // caller rejected or deferred the move: put the pieces back
    if (this.version === v) {
      this.snapSq = null;
      this.el.classList.toggle('animate', this.animate);
      this.placeAll();
    }
  }

  openPromo(from, to, color) {
    this.closePromo();
    // preview the pawn on its promotion square, hiding anything it captures
    const pawn = this.els.get(from);
    const victim = this.els.get(to);
    if (pawn) this.placeEl(pawn, to);
    if (victim) victim.style.visibility = 'hidden';
    this.promoPreview = { victim };
    const [x, y] = sqToXY(to, this.orientation);
    const wrap = document.createElement('div');
    wrap.className = 'kb-promo';
    const col = document.createElement('div');
    col.className = 'kb-promo-col';
    col.style.left = x * 12.5 + '%';
    if (y === 0) col.style.top = '0'; else col.style.bottom = '0';
    const order = y === 0 ? PROMO_ORDER : [...PROMO_ORDER].reverse();
    // The tap that opened the picker is followed by a synthetic click on whatever is under the finger
    // (the picker itself). Only a click whose press also started on the picker counts.
    let armed = null;
    for (const p of order) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', { q: 'Queen', n: 'Knight', r: 'Rook', b: 'Bishop' }[p]);
      b.style.backgroundImage = `url(${pieceUrl(color + p.toUpperCase())})`;
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); armed = b; });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (armed !== b) return;
        this.closePromo();
        this.finishMove(from, to, p);
      });
      col.appendChild(b);
    }
    wrap.appendChild(col);
    wrap.addEventListener('pointerdown', (e) => { e.stopPropagation(); armed = wrap; });
    wrap.addEventListener('click', () => {
      if (armed !== wrap) return;
      this.closePromo();
      this.select(null);
      this.el.classList.toggle('animate', this.animate);
      this.placeAll();
    });
    this.el.appendChild(wrap);
    this.promoEl = wrap;
  }

  closePromo() {
    if (this.promoEl) { this.promoEl.remove(); this.promoEl = null; }
    if (this.promoPreview) {
      if (this.promoPreview.victim) this.promoPreview.victim.style.visibility = '';
      this.promoPreview = null;
    }
  }
}

function arrowPath(x1, y1, x2, y2, color, w) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return '';
  const ux = dx / len, uy = dy / len;
  const head = 0.42, hw = 0.3;
  const sx = x1 + ux * 0.18, sy = y1 + uy * 0.18;
  const bx = x2 - ux * head, by = y2 - uy * head;
  const nx = -uy, ny = ux;
  const p = (x, y) => `${x.toFixed(3)},${y.toFixed(3)}`;
  const pts = [
    p(sx + nx * w / 2, sy + ny * w / 2), p(bx + nx * w / 2, by + ny * w / 2), p(bx + nx * hw, by + ny * hw),
    p(x2, y2), p(bx - nx * hw, by - ny * hw), p(bx - nx * w / 2, by - ny * w / 2), p(sx - nx * w / 2, sy - ny * w / 2),
  ];
  return `<polygon points="${pts.join(' ')}" fill="${color}" stroke-linejoin="round"/>`;
}
