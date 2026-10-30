// Builds data/openings.json from the Lichess chess-openings TSV files (CC0).
// Output: { lines: [[eco, name, "uci uci ..."]...], pos: { key: [namedLineIdx or -1, [nextUci...], representativeLineIdx] } }
import fs from 'node:fs';
// Usage: download a.tsv..e.tsv from https://github.com/lichess-org/chess-openings into tools/openings/, then
//   node tools/build-openings.mjs
import { Chess } from '../js/lib/chess.js';
import { posKey } from '../js/poskey.js';

const here = new URL('.', import.meta.url).pathname;

const lines = [];
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const rows = fs.readFileSync(`${here}openings/${f}.tsv`, 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const c = new Chess();
    c.loadPgn(pgn);
    const ucis = c.history({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
    lines.push({ eco, name, ucis });
  }
}
// Shorter lines first so that a position's name is the most specific line ending there
const pos = new Map();
lines.forEach((l, idx) => {
  const c = new Chess();
  let key = posKey(c.fen());
  for (let i = 0; i < l.ucis.length; i++) {
    const u = l.ucis[i];
    if (!pos.has(key)) pos.set(key, { n: -1, next: new Set(), rep: idx });
    const pe = pos.get(key);
    pe.next.add(u);
    if (lines[pe.rep].ucis.length > l.ucis.length) pe.rep = idx;
    c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    key = posKey(c.fen());
  }
  if (!pos.has(key)) pos.set(key, { n: -1, next: new Set(), rep: idx });
  const e = pos.get(key);
  // If several lines end in the same position (transpositions), keep the first listed
  if (e.n === -1) e.n = idx;
});
const out = {
  lines: lines.map(l => [l.eco, l.name, l.ucis.join(' ')]),
  pos: Object.fromEntries([...pos].map(([k, v]) => [k, [v.n, [...v.next], v.n >= 0 ? v.n : v.rep]])),
};
fs.writeFileSync(`${here}../data/openings.json`, JSON.stringify(out));
console.log('lines', lines.length, 'positions', pos.size, 'bytes', JSON.stringify(out).length);
