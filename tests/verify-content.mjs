// Checks lesson and drill positions with Stockfish (run with a static server on :8765):
//   node tests/verify-content.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8765/?nosw#/settings');
await page.waitForSelector('#s-theme');
const report = await page.evaluate(async () => {
  const { Engine } = await import('/js/engine.js');
  const { Chess } = await import('/js/lib/chess.js');
  const { LESSONS, DRILLS } = await import('/js/lessons-data.js');
  const eng = new Engine();
  await eng.ready;
  const out = [];
  const score = (l) => (l.mate != null ? (l.mate > 0 ? 100000 - l.mate : -100000 - l.mate) : l.cp);
  const play = (c, u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  for (const lesson of LESSONS) {
    for (const [si, step] of lesson.steps.entries()) {
      if (step.type !== 'move') continue;
      const c = new Chess(step.fen);
      for (let i = 0; i < step.line.length; i++) {
        const fen = c.fen();
        if (i % 2 === 0) {
          const nLegal = c.moves().length;
          const r = await eng.analyze(fen, { depth: 18, multipv: Math.min(8, nLegal) });
          const lines = r.lines.map(l => ({ m: l.pv[0], s: score(l), mate: l.mate }));
          const best = lines[0];
          if (!best) { out.push({ where: `${lesson.id}#${si} ply ${i}`, ok: false, got: `no engine lines (${JSON.stringify(r).slice(0, 120)})`, move: fen }); break; }
          const want = i === 0 ? [step.line[0], ...(step.accept || [])] : [step.line[i]];
          for (const w of want) {
            const l = lines.find(x => x.m === w);
            const winning = (x) => x.s >= 300;
            const ok = l && (l.s >= best.s - 30 || (best.mate > 0 && l.mate > 0) || (winning(best) && winning(l)));
            out.push({ where: `${lesson.id}#${si} ply ${i}`, move: w, ok: !!ok, got: l ? l.s : 'not in top lines', best: `${best.m} ${best.s}` });
          }
          // any other move that is as good as the expected one should be accepted too
          // only strict steps refuse alternatives; the others accept engine-equivalent moves at runtime
          if (i === 0 && step.strict) {
            const exp = lines.find(x => x.m === step.line[0]);
            for (const l of lines) {
              if (!want.includes(l.m) && exp && l.s >= exp.s - 15 && !(exp.mate > 0 && !(l.mate > 0))) out.push({ where: `${lesson.id}#${si}`, move: l.m, ok: true, note: true, got: l.s, best: 'note: equally good by eval, but this step teaches a specific idea' });
            }
          }
        }
        if (!play(c, step.line[i])) { out.push({ where: `${lesson.id}#${si}`, ok: false, move: step.line[i], got: 'illegal' }); break; }
      }
      if (step.anyMate && !c.isCheckmate()) out.push({ where: `${lesson.id}#${si}`, ok: false, got: 'final move is not mate' });
    }
  }
  for (const d of DRILLS) {
    const c = new Chess(d.fen);
    const r = await eng.analyze(d.fen, { depth: 22 });
    const l = r.lines[0];
    // score from the side to move; the drill side is the side to move in every drill
    const s = score(l);
    const ok = d.goal === 'hold' ? Math.abs(s) <= 60 : s >= 500;
    out.push({ where: `drill ${d.id}`, ok, got: l.mate != null ? `mate ${l.mate}` : l.cp, best: r.bestmove, move: d.goal });
    if (c.isGameOver()) out.push({ where: `drill ${d.id}`, ok: false, got: 'game over' });
  }
  eng.terminate();
  return out;
});
let bad = 0;
for (const r of report) { if (!r.ok) bad++; console.log(r.ok ? (r.note ? 'note' : 'ok  ') : 'BAD ', r.where, r.move ?? '', '|', r.got, '|', r.best ?? ''); }
console.log(bad ? `${bad} problem(s)` : 'all lesson and drill positions verified');
await browser.close();
process.exitCode = bad ? 1 : 0;
