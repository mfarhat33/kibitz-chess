// Settings, progress export/import and credits.
import * as store from '../store.js';
import { applyTheme } from '../main.js';
import { icons, esc, toast, dialog, confirm, downloadFile, pickFile, $ } from '../ui.js';

const PIECES = [
  { id: 'cburnett', name: 'Classic' }, { id: 'merida', name: 'Merida' }, { id: 'chessnut', name: 'Chessnut' }, { id: 'fantasy', name: 'Fantasy' },
];
const BOARDS = [
  { id: 'slate', name: 'Slate' }, { id: 'walnut', name: 'Walnut' }, { id: 'ocean', name: 'Ocean' },
  { id: 'olive', name: 'Olive' }, { id: 'mono', name: 'Mono' },
];

export function mount(root) {
  const s = store.getSettings();
  const games = store.keys('game:').length;
  const attempts = store.get('puzzles')?.attempts?.length || 0;
  const lines = store.get('trainer')?.cards?.length || 0;
  root.innerHTML = `
    <div class="page stack" style="max-width:720px;margin:0 auto">
      <h1 style="margin:0">Settings</h1>
      <section class="card stack">
        <h3 style="margin:0">Appearance</h3>
        <div class="field"><span class="label">Theme</span>
          <div class="seg" id="s-theme" role="group" aria-label="Theme">
            <button type="button" data-v="system">System</button><button type="button" data-v="light">Light</button><button type="button" data-v="dark">Dark</button>
          </div>
        </div>
        <div class="field"><span class="label">Board colours</span>
          <div class="chips" id="s-board" role="group" aria-label="Board colours">
            ${BOARDS.map(b => `<button type="button" class="chip" data-v="${b.id}"><span style="display:inline-flex;vertical-align:-3px;margin-right:6px;border-radius:4px;overflow:hidden"><i data-board-swatch="${b.id}" style="display:block;width:16px;height:16px"></i></span>${b.name}</button>`).join('')}
          </div>
        </div>
        <div class="field"><span class="label">Pieces</span>
          <div class="chips" id="s-pieces" role="group" aria-label="Piece set">
            ${PIECES.map(p => `<button type="button" class="chip" data-v="${p.id}" style="display:inline-flex;align-items:center;gap:6px"><img src="img/pieces/${p.id}/wN.svg" alt="" width="22" height="22">${p.name}</button>`).join('')}
          </div>
        </div>
        <label class="toggle"><span>Show coordinates</span><input type="checkbox" id="s-coords" ${s.coords ? 'checked' : ''}></label>
        <label class="toggle"><span>Show legal moves</span><input type="checkbox" id="s-dests" ${s.showDests !== false ? 'checked' : ''}></label>
        <label class="toggle"><span>Animate pieces</span><input type="checkbox" id="s-anim" ${s.animation ? 'checked' : ''}></label>
        <label class="toggle"><span>Always promote to a queen</span><input type="checkbox" id="s-autoq" ${s.autoQueen ? 'checked' : ''}></label>
        <label class="toggle"><span>Evaluation bar in games vs bots</span><input type="checkbox" id="s-peval" ${s.playEval ? 'checked' : ''}></label>
        <label class="toggle"><span>Show threats in games vs bots</span><input type="checkbox" id="s-threats" ${s.showThreats ? 'checked' : ''}></label>
        <label class="toggle"><span>Bot chat</span><input type="checkbox" id="s-chat" ${s.botChat !== false ? 'checked' : ''}></label>
        <label class="toggle"><span>Move sounds</span><input type="checkbox" id="s-sound" ${s.sound ? 'checked' : ''}></label>
      </section>
      <section class="card stack">
        <h3 style="margin:0">Game review depth</h3>
        <div class="seg" id="s-depth" role="group" aria-label="Review depth">
          <button type="button" data-v="fast">Fast</button><button type="button" data-v="standard">Standard</button><button type="button" data-v="deep">Deep</button>
        </div>
        <p class="tiny muted" style="margin:0">Deeper reviews are more precise but take longer, especially on phones (Fast: depth 11, Standard: 14, Deep: 18).</p>
      </section>
      <section class="card stack">
        <h3 style="margin:0">Your progress</h3>
        <p class="small muted" style="margin:0">Everything is saved in this browser only: ${games} game${games === 1 ? '' : 's'}, ${attempts} puzzle attempt${attempts === 1 ? '' : 's'}, ${lines} trainer line${lines === 1 ? '' : 's'}. To move it to another device, export a progress file here and import it there. Importing merges with what is already on that device.</p>
        <div class="grid-2">
          <button class="btn" id="s-export" type="button">${icons.download} Export progress</button>
          <button class="btn" id="s-import" type="button">${icons.upload} Import progress</button>
        </div>
        <button class="btn danger" id="s-reset" type="button">${icons.trash} Erase all progress on this device</button>
      </section>
      <section class="card stack small">
        <h3 style="margin:0">About Kibitz Chess</h3>
        <p style="margin:0">A free, private chess trainer that runs entirely in your browser. No account, no tracking, no server.</p>
        <ul style="margin:0;padding-left:1.2em" class="muted">
          <li>Engine: <a href="https://stockfishchess.org" target="_blank" rel="noopener">Stockfish</a> 19 (lite, single-threaded WASM build by <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">stockfish.js</a>), GPL-3.0.</li>
          <li>Puzzles: <a href="https://database.lichess.org/#puzzles" target="_blank" rel="noopener">Lichess puzzle database</a>, CC0.</li>
          <li>Opening names: <a href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noopener">lichess-org/chess-openings</a>, CC0.</li>
          <li>Move rules: <a href="https://github.com/jhlywa/chess.js" target="_blank" rel="noopener">chess.js</a>, BSD-2-Clause.</li>
          <li>Pieces: Classic by Colin M.L. Burnett (GPLv2+), Merida by Armando Hernandez Marroquin (GPLv2+), Chessnut by Alexis Luengas (Apache-2.0), Fantasy by Maurizio Monge (MIT).</li>
        </ul>
        <p class="tiny muted" style="margin:0">Kibitz Chess is free software under the GPL-3.0. Bot ratings are approximate.</p>
      </section>
    </div>`;

  const seg = (id, val, onPick) => {
    const g = $(id, root);
    const mark = (v) => g.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    mark(val);
    g.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; mark(b.dataset.v); onPick(b.dataset.v); });
  };
  seg('#s-theme', s.theme, (v) => { store.setSettings({ theme: v }); applyTheme(); });
  seg('#s-board', s.board, (v) => { store.setSettings({ board: v }); applyTheme(); });
  seg('#s-pieces', s.pieces, (v) => { store.setSettings({ pieces: v }); applyTheme(); });
  seg('#s-depth', s.reviewDepth, (v) => store.setSettings({ reviewDepth: v }));
  for (const sw of root.querySelectorAll('[data-board-swatch]')) {
    const [l, d] = SWATCH[sw.dataset.boardSwatch];
    sw.style.background = `conic-gradient(${d} 0 25%, ${l} 0 50%, ${d} 0 75%, ${l} 0)`;
  }
  $('#s-coords', root).addEventListener('change', (e) => store.setSettings({ coords: e.target.checked }));
  $('#s-anim', root).addEventListener('change', (e) => store.setSettings({ animation: e.target.checked }));
  $('#s-autoq', root).addEventListener('change', (e) => { store.setSettings({ autoQueen: e.target.checked }); applyTheme(); });
  $('#s-peval', root).addEventListener('change', (e) => store.setSettings({ playEval: e.target.checked }));
  $('#s-dests', root).addEventListener('change', (e) => { store.setSettings({ showDests: e.target.checked }); applyTheme(); });
  $('#s-threats', root).addEventListener('change', (e) => store.setSettings({ showThreats: e.target.checked }));
  $('#s-chat', root).addEventListener('change', (e) => store.setSettings({ botChat: e.target.checked }));
  $('#s-sound', root).addEventListener('change', (e) => store.setSettings({ sound: e.target.checked }));

  $('#s-export', root).addEventListener('click', () => {
    const data = store.exportData();
    const d = new Date();
    const name = `kibitz-chess-progress-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    downloadFile(name, JSON.stringify(data));
    toast('Progress file downloaded');
  });

  $('#s-import', root).addEventListener('click', async () => {
    const file = await pickFile();
    if (!file) return;
    let obj;
    try {
      obj = store.validateImport(JSON.parse(await file.text()));
    } catch (err) {
      dialog({ title: 'Import failed', body: `<p>${esc(err.message.includes('JSON') ? 'That file could not be read.' : err.message)}</p>` });
      return;
    }
    const mode = await dialog({
      title: 'Import progress',
      body: `<p class="small">From <b>${esc(file.name)}</b>${obj.exportedAt ? `, exported ${esc(new Date(obj.exportedAt).toLocaleString())}` : ''}.</p><p class="small muted"><b>Merge</b> keeps everything from both devices. <b>Replace</b> erases this device's progress first.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Replace', value: 'replace', danger: true }, { label: 'Merge', value: 'merge', primary: true }],
    });
    if (!mode) return;
    const sum = store.importData(obj, mode);
    applyTheme();
    toast(`Imported ${sum.games} games, ${sum.attempts} puzzle attempts, ${sum.lines} lines`);
    mount(root);
  });

  $('#s-reset', root).addEventListener('click', async () => {
    if (await confirm('Erase all progress?', '<p>This deletes your games, puzzle rating, Rush scores and trainer lines from this browser. Export first if you want a backup.</p>', 'Erase everything', true)) {
      for (const k of store.keys()) store.del(k);
      applyTheme();
      toast('All progress erased');
      mount(root);
    }
  });
}

const SWATCH = {
  slate: ['#e4e0d4', '#7d93a6'], walnut: ['#ead7b6', '#a7774e'], ocean: ['#dae5ea', '#5a86a3'],
  olive: ['#e7e3c8', '#9a9a63'], mono: ['#d8d8d8', '#8c8c8c'],
};

export function unmount() {}
