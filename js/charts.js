// Hand-rolled responsive SVG charts with hover tooltips (no chart library).
// Colours come from CSS tokens (--series-*, --status-*) so light/dark themes both work.
import { esc } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
let tipEl = null;

function tip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'chart-tip';
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
export function showTip(html, x, y) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let left = x + 14, top = y - r.height - 10;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top < 8) top = y + 16;
  t.style.left = Math.max(8, left) + 'px';
  t.style.top = top + 'px';
}
export function hideTip() { if (tipEl) tipEl.hidden = true; }

/** Re-draws on resize. draw(width) returns an SVG string; after(svg) wires events. */
function responsive(el, height, draw, after) {
  const render = () => {
    const w = Math.max(240, Math.round(el.clientWidth || 320));
    el.innerHTML = `<svg class="chart" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" role="img">${draw(w)}</svg>`;
    after?.(el.firstElementChild, w);
  };
  render();
  if (el._ro) el._ro.disconnect();
  let lastW = el.clientWidth;
  el._ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - lastW) > 2) { lastW = el.clientWidth; render(); } });
  el._ro.observe(el);
}

const niceTicks = (min, max, n = 4) => {
  const span = max - min || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
};

/**
 * Line chart. series: [{ name, color, points: [{ x (index), y, tip }] }]
 * opts: { height, yMin, yMax, yFmt, xLabel(i) }
 */
export function lineChart(el, series, opts = {}) {
  const H = opts.height || 180;
  const pad = { l: 38, r: 12, t: 10, b: 24 };
  const all = series.flatMap(s => s.points);
  if (!all.length) { el.innerHTML = '<div class="empty small">No data yet</div>'; return; }
  const xs = all.map(p => p.x);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const ys = all.map(p => p.y);
  let yMin = opts.yMin ?? Math.min(...ys), yMax = opts.yMax ?? Math.max(...ys);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const fmt = opts.yFmt || (v => String(Math.round(v)));
  let sx, sy;
  responsive(el, H, (W) => {
    sx = (x) => pad.l + (xMax === xMin ? (W - pad.l - pad.r) / 2 : (x - xMin) / (xMax - xMin) * (W - pad.l - pad.r));
    sy = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
    let g = '<g class="grid">';
    for (const t of niceTicks(yMin, yMax)) {
      g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${pad.l - 6}" y="${sy(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`;
    }
    g += '</g>';
    if (opts.xLabel) {
      const n = Math.min(5, xMax - xMin + 1);
      for (let k = 0; k < n; k++) {
        const x = Math.round(xMin + (n === 1 ? 0 : k * (xMax - xMin) / (n - 1)));
        g += `<text x="${sx(x)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === n - 1 ? 'end' : 'middle'}">${esc(opts.xLabel(x))}</text>`;
      }
    }
    for (const s of series) {
      if (!s.points.length) continue;
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="${s.faint ? 0.35 : 1}"/>`;
      if (s.points.length <= 40 && !s.faint) {
        for (const p of s.points) g += `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
      }
    }
    g += `<line class="xhair" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>`;
    g += `<rect class="hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/>`;
    return g;
  }, (svg) => {
    const hit = svg.querySelector('.hit');
    const xh = svg.querySelector('.xhair');
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      let best = null, bd = Infinity;
      for (const p of all) { const d = Math.abs(sx(p.x) - px); if (d < bd) { bd = d; best = p; } }
      if (!best) return;
      xh.setAttribute('x1', sx(best.x)); xh.setAttribute('x2', sx(best.x)); xh.setAttribute('visibility', 'visible');
      const rows = series.filter(s => !s.faint).map(s => {
        const p = s.points.find(q => q.x === best.x);
        return p ? `<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-right:6px"></i>${esc(s.name)}: <b>${esc(fmt(p.y))}</b></div>` : '';
      }).join('');
      showTip(`${best.tip ? `<div>${esc(best.tip)}</div>` : ''}${rows}`, e.clientX, e.clientY);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { hideTip(); xh.setAttribute('visibility', 'hidden'); });
  });
}

/**
 * Stacked vertical bars. data: [{ label, tip, parts: [{ key, value }] }], keys: [{ key, name, color }]
 */
export function stackedBars(el, data, keys, opts = {}) {
  const H = opts.height || 170;
  const pad = { l: 30, r: 8, t: 8, b: 24 };
  if (!data.length) { el.innerHTML = '<div class="empty small">No data yet</div>'; return; }
  const max = Math.max(1, ...data.map(d => d.parts.reduce((s, p) => s + p.value, 0)));
  const ticks = niceTicks(0, max, 3).filter(t => Number.isInteger(t));
  const top = Math.max(max, ticks[ticks.length - 1] || max);
  let geo = [];
  responsive(el, H, (W) => {
    const inner = W - pad.l - pad.r;
    const bw = Math.max(4, Math.min(34, inner / data.length - 4));
    const sy = (v) => (v / top) * (H - pad.t - pad.b);
    let g = '<g class="grid">';
    for (const t of ticks) {
      const y = H - pad.b - sy(t);
      g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${t}</text>`;
    }
    g += '</g>';
    geo = [];
    data.forEach((d, i) => {
      const cx = pad.l + (i + 0.5) * inner / data.length;
      let y = H - pad.b;
      const total = d.parts.reduce((s, p) => s + p.value, 0);
      const segs = d.parts.filter(p => p.value > 0);
      segs.forEach((p, k) => {
        const h = sy(p.value);
        const k2 = keys.find(x => x.key === p.key);
        const isTop = k === segs.length - 1;
        const gap = k > 0 ? 2 : 0;
        const r = isTop ? Math.min(4, bw / 2, h / 2) : 0;
        const x0 = cx - bw / 2, y0 = y - h + (isTop ? 0 : 0), yb = y - gap;
        const hh = Math.max(0, yb - y0);
        g += r
          ? `<path d="M${x0},${yb} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${yb} Z" fill="${k2.color}"/>`
          : `<rect x="${x0}" y="${y0}" width="${bw}" height="${hh}" fill="${k2.color}"/>`;
        y -= h;
      });
      geo.push({ x0: cx - inner / data.length / 2, x1: cx + inner / data.length / 2, d, total });
      if (data.length <= 12 || i % Math.ceil(data.length / 8) === 0) {
        g += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`;
      }
    });
    g += `<rect class="hit" x="${pad.l}" y="0" width="${inner}" height="${H}" fill="transparent"/>`;
    return g;
  }, (svg) => {
    const hit = svg.querySelector('.hit');
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      const b = geo.find(q => px >= q.x0 && px < q.x1);
      if (!b) return hideTip();
      const rows = keys.map(k => {
        const p = b.d.parts.find(q => q.key === k.key);
        return `<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${k.color};margin-right:6px"></i>${esc(k.name)}: <b>${p ? p.value : 0}</b></div>`;
      }).join('');
      showTip(`<div><b>${esc(b.d.tip || b.d.label)}</b></div>${rows}`, e.clientX, e.clientY);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', hideTip);
  });
}

export function legend(items) {
  return `<div class="legend">${items.map(i => `<span><i style="background:${i.color}"></i>${esc(i.name)}</span>`).join('')}</div>`;
}

/** Horizontal bars as HTML rows: [{ label, value, max, text, color }] */
export function hbars(rows) {
  if (!rows.length) return '<div class="empty small">No data yet</div>';
  return `<div class="hbars">${rows.map(r => `
    <div class="hbar-row" title="${esc(r.title || '')}">
      <div class="hbar-label">${esc(r.label)}</div>
      <div class="hbar-track"><i style="width:${Math.max(2, (r.value / (r.max || 100)) * 100)}%;background:${r.color || 'var(--series-1)'}"></i></div>
      <div class="hbar-val">${esc(r.text ?? String(r.value))}</div>
    </div>`).join('')}</div>`;
}

/**
 * Review eval graph: white's winning chances per ply, clickable.
 * wins: [0..100] per position; marks: [{ ply, cls }]; onPick(positionIndex)
 */
export function evalGraph(el, wins, { cur = 0, marks = [], onPick } = {}) {
  const H = 120;
  const n = wins.length;
  let sx;
  responsive(el, H, (W) => {
    sx = (i) => (n <= 1 ? 0 : i / (n - 1) * W);
    const sy = (w) => H - (w / 100) * H;
    let area = `M0,${H} `;
    wins.forEach((w, i) => { area += `L${sx(i).toFixed(1)},${sy(w).toFixed(1)} `; });
    area += `L${W},${H} Z`;
    let g = `<rect x="0" y="0" width="${W}" height="${H}" rx="8" fill="var(--eval-black)"/>`;
    g += `<path d="${area}" fill="var(--eval-white)"/>`;
    g += `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 4" opacity=".6"/>`;
    for (const m of marks) {
      const x = sx(m.ply), y = sy(wins[m.ply]);
      g += `<circle cx="${x}" cy="${y}" r="4.5" fill="var(--q-${m.cls})" stroke="var(--surface)" stroke-width="2"/>`;
    }
    g += `<line class="cur" x1="${sx(cur)}" x2="${sx(cur)}" y1="0" y2="${H}" stroke="var(--accent)" stroke-width="2"/>`;
    g += `<rect class="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent" style="cursor:pointer"/>`;
    return g;
  }, (svg, W) => {
    const hit = svg.querySelector('.hit');
    const idx = (e) => {
      const r = svg.getBoundingClientRect();
      return Math.max(0, Math.min(n - 1, Math.round((e.clientX - r.left) / r.width * (n - 1))));
    };
    hit.addEventListener('pointerdown', (e) => { onPick?.(idx(e)); });
    hit.addEventListener('pointermove', (e) => {
      const i = idx(e);
      const w = wins[i];
      showTip(`${i === 0 ? 'Start' : `Move ${Math.ceil(i / 2)}${i % 2 ? '' : '…'}`}<br>White ${Math.round(w)}% · Black ${Math.round(100 - w)}%`, e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', hideTip);
  });
  return {
    setCur(i) {
      const line = el.querySelector('line.cur');
      if (line && sx) { line.setAttribute('x1', sx(i)); line.setAttribute('x2', sx(i)); }
    },
  };
}
