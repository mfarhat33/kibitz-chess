# Kibitz Chess

A free, private chess trainer that runs entirely in your browser. No account, no server, no tracking.

**Play it:** https://mfarhat33.github.io/kibitz-chess/

## What's inside

- **Play** against Stockfish bots from about 400 to 2500 Elo, plus full strength. Hints, takebacks, flip board and optional clocks (3|2 up to 30|0).
- **Game review** for every game you play (or import): evaluation for every move, labels (brilliant, great, best, excellent, good, book, inaccuracy, miss, mistake, blunder), accuracy for each side, an evaluation graph, best-move arrows, plain-English explanations, and *Retry this move* to practise your mistakes.
- **Analysis board** with Stockfish's top three lines, PGN/FEN import, and full review of imported games.
- **Puzzles** from the Lichess puzzle database: a rating that adjusts after every attempt (starting at 1100), themes shown after solving, a daily puzzle with streaks, and **Rush** (3 or 5 minutes, three strikes, rising difficulty, best scores saved).
- **Learn**: 27 lessons for club players in five groups (fundamentals such as opening principles, king safety and pawn structure; tactics from forks and pins to decoys, in-between moves and x-rays; checkmate patterns including smothered, Arabian and Anastasia's mates; endgames such as the opposition, Lucena and Philidor; strategy such as active rooks, outposts and good and bad bishops), each with guided positions and followed by themed practice puzzles; endgame drills against Stockfish; quizzes; a coordinates trainer.
- **Openings**: an explorer that names the opening as you play, with engine evaluation and book moves, and a spaced-repetition trainer that drills the lines you choose.
- **Coach**: a Monday report on the patterns costing you the most points (hanging pieces, tactics you walk into or miss, mates, opening slips, endgames, time trouble), with examples from your games, a 7-day drill plan, bulk import of your last 200 chess.com games and batch analysis.
- **Insights**: results, accuracy and blunders over time, by colour, by opening and by game phase, plus your puzzle rating trend and weakest themes.

## Phone and laptop

The board is full width on phones; tap a piece then a square, or drag. On a laptop you can also use the arrow keys in reviews and right-click-drag to draw arrows.
To install it like an app, open the site and choose **Add to Home Screen** (Safari) or **Install app** (Chrome). It also works offline after the first visit.

## Your data

Everything is saved in your browser (IndexedDB). To keep phone and laptop in step, turn on **Settings → Sync** with a GitHub token that has only the gist scope: progress goes to one private Gist and merges on every device. The token stays in that browser. **Export/Import progress** still works as a manual alternative.

## Credits and licences

Kibitz Chess is free software under the **GPL-3.0** (see `LICENSE`).

- Engine: [Stockfish](https://stockfishchess.org) 19, lite single-threaded WebAssembly build from [stockfish.js](https://github.com/nmrugg/stockfish.js), GPL-3.0.
- Puzzles: [Lichess puzzle database](https://database.lichess.org/#puzzles), CC0. `tools/build_puzzles.py` builds the rating buckets in `data/puzzles/`, and the *Build puzzle data* GitHub Action refreshes them.
- Opening names: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), CC0. `tools/build-openings.mjs` builds `data/openings.json`.
- Move generation: [chess.js](https://github.com/jhlywa/chess.js), BSD-2-Clause.
- Pieces: Classic (Colin M.L. Burnett, GPLv2+), Merida (Armando Hernandez Marroquin, GPLv2+), Chessnut (Alexis Luengas, Apache-2.0), Fantasy (Maurizio Monge, MIT).

Bot ratings are approximate.

## Development

It is a static site with no build step:

```bash
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765/. Tests:

```bash
node --test tests/unit.test.mjs tests/coach.test.mjs
```

```bash
node tests/verify-content.mjs
```

The second command checks every lesson and drill position with Stockfish and needs Playwright plus the local server.
