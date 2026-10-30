// Interactive chessboard. Tap a piece then a square, or drag it. Pointer events cover mouse and touch.
// The board never decides legality itself: callers pass `dests` (from -> [to]) and get onMove(from, to, promo).

const PROMO_ORDER = ['q', 'n', 'r', 'b'];

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

export class Board {
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    this.orientation = opts.orientation || 'white';
    this.coordinates = opts.coordinates !== false;
    this.pieces = new Map();
    this.els = new Map();
    this.movable = { color: null, dests: new Map() };
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
      e.classList.remove('dragging');
      placed.set(sq, e);
    }
    for (const e of old.values()) {
      if (doAnim) { e.classList.add('fade'); setTimeout(() => e.remove(), 200); }
      else e.remove();
    }
    this.els = placed;
    this.pieces = next;
    for (const [sq, e] of placed) this.placeEl(e, sq);
    if (this.selected && !this.pieces.has(this.selected)) this.selected = null;
    this.renderSquares();
  }

  setMovable({ color = null, dests = new Map() } = {}) {
    this.movable = { color, dests };
    if (this.selected && !dests.has(this.selected)) this.selected = null;
    this.renderSquares();
  }

  setOrientation(o) {
    if (o === this.orientation) return;
    this.orientation = o;
    this.el.classList.remove('animate');
    for (const [sq, e] of this.els) this.placeEl(e, sq);
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
    e.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
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
    for (const m of this.marks) add(m.sq, m.cls);
    if (this.check) add(this.check, 'check');
    if (this.selected) {
      add(this.selected, 'sel');
      for (const d of this.movable.dests.get(this.selected) || []) {
        add(d, this.pieces.has(d) ? 'dest cap' : 'dest');
      }
    }
    if (this.hover && this.drag?.started) add(this.hover, 'hover');
    for (const c of this.userCircles) add(c, 'mark-circle');
    let html = '';
    for (const [sq, c] of cls) html += `<div class="kb-sq${c}" style="${this.sqStyle(sq)}"></div>`;
    this.sqLayer.innerHTML = html;
  }

  renderArrows() {
    const all = [...this.arrows, ...this.userArrows.map(a => ({ ...a, color: a.color || 'rgba(21,128,61,.75)' }))];
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
    return (this.movable.dests.get(from) || []).includes(to);
  }

  isMine(piece) {
    const c = this.movable.color;
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
    if (e.button === 2) { this.rightStart = sq; return; }
    if (e.button !== 0) return;
    if (this.userArrows.length || this.userCircles.length) this.clearUserDrawings();
    if (!sq) return;
    e.preventDefault();
    if (this.selected && this.selected !== sq && this.canMove(this.selected, sq)) {
      this.tryMove(this.selected, sq);
      return;
    }
    const piece = this.pieces.get(sq);
    if (piece && this.isMine(piece) && this.movable.dests.has(sq)) {
      const wasSelected = this.selected === sq;
      this.select(sq);
      const r = this.el.getBoundingClientRect();
      this.drag = {
        sq, el: this.els.get(sq), started: false, wasSelected,
        x0: e.clientX, y0: e.clientY, touch: e.pointerType !== 'mouse', size: r.width / 8,
      };
      try { this.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    } else {
      this.select(null);
    }
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if (!d.started && dist < (d.touch ? 7 : 3)) return;
    if (!d.started) {
      d.started = true;
      d.el.classList.add('dragging');
      this.el.classList.remove('animate');
    }
    const r = this.el.getBoundingClientRect();
    const lift = d.touch ? d.size * 0.45 : 0;
    const px = e.clientX - r.left - d.size / 2;
    const py = e.clientY - r.top - d.size / 2 - lift;
    d.el.style.transform = `translate(${px}px, ${py}px) scale(${d.touch ? 1.25 : 1.06})`;
    const over = this.squareAt(e.clientX, e.clientY - lift);
    if (over !== this.hover) { this.hover = over; this.renderSquares(); }
  }

  onUp(e) {
    if (e.button === 2) {
      const end = this.squareAt(e.clientX, e.clientY);
      const start = this.rightStart;
      this.rightStart = null;
      if (!start || !end) return;
      if (start === end) {
        const i = this.userCircles.indexOf(start);
        if (i >= 0) this.userCircles.splice(i, 1); else this.userCircles.push(start);
        this.renderSquares();
      } else {
        const i = this.userArrows.findIndex(a => a.from === start && a.to === end);
        if (i >= 0) this.userArrows.splice(i, 1); else this.userArrows.push({ from: start, to: end });
        this.renderArrows();
      }
      return;
    }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.started) {
      const lift = d.touch ? d.size * 0.45 : 0;
      const to = this.squareAt(e.clientX, e.clientY - lift);
      this.hover = null;
      d.el.classList.remove('dragging');
      if (to && to !== d.sq && this.canMove(d.sq, to)) {
        this.tryMove(d.sq, to);
      } else {
        this.el.classList.add('animate');
        this.placeEl(d.el, d.sq);
        if (to !== d.sq) this.select(null); else this.renderSquares();
      }
    } else if (d.wasSelected) {
      this.select(null);
    }
  }

  onCancel() {
    const d = this.drag;
    this.drag = null;
    this.hover = null;
    if (d) { d.el.classList.remove('dragging'); this.placeEl(d.el, d.sq); }
    this.renderSquares();
  }

  tryMove(from, to) {
    const piece = this.pieces.get(from);
    if (piece && piece[1] === 'P' && (to[1] === '8' || to[1] === '1')) {
      this.openPromo(from, to, piece[0]);
      return;
    }
    this.finishMove(from, to);
  }

  finishMove(from, to, promo) {
    const v = this.version;
    this.select(null);
    this.opts.onMove?.(from, to, promo);
    // caller rejected or deferred the move: put the piece back
    if (this.version === v) for (const [sq, e] of this.els) this.placeEl(e, sq);
  }

  openPromo(from, to, color) {
    this.closePromo();
    const [x, y] = sqToXY(to, this.orientation);
    const wrap = document.createElement('div');
    wrap.className = 'kb-promo';
    const col = document.createElement('div');
    col.className = 'kb-promo-col';
    col.style.left = x * 12.5 + '%';
    if (y === 0) col.style.top = '0'; else col.style.bottom = '0';
    const order = y === 0 ? PROMO_ORDER : [...PROMO_ORDER].reverse();
    for (const p of order) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', { q: 'Queen', n: 'Knight', r: 'Rook', b: 'Bishop' }[p]);
      b.style.backgroundImage = `url(img/pieces/${color}${p.toUpperCase()}.svg)`;
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      b.addEventListener('click', (e) => { e.stopPropagation(); this.closePromo(); this.finishMove(from, to, p); });
      col.appendChild(b);
    }
    wrap.appendChild(col);
    wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
    wrap.addEventListener('click', () => { this.closePromo(); this.select(null); for (const [sq, el] of this.els) this.placeEl(el, sq); });
    this.el.appendChild(wrap);
    this.promoEl = wrap;
  }

  closePromo() {
    if (this.promoEl) { this.promoEl.remove(); this.promoEl = null; }
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
