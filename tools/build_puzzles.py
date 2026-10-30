#!/usr/bin/env python3
"""Build Kibitz Chess puzzle files from the Lichess puzzle database (CC0).

Reads lichess_db_puzzle.csv.zst (https://database.lichess.org/#puzzles), keeps a
well-rated, popular subset spread across the rating range, and writes one JSON file
per 100-point rating bucket to data/puzzles/:

    data/puzzles/r1100.json  ->  [[id, fen, "uci uci ...", rating, "theme theme ..."], ...]
    data/puzzles/index.json  ->  bucket sizes and provenance

Usage: python3 tools/build_puzzles.py lichess_db_puzzle.csv.zst
"""
import csv
import io
import json
import os
import random
import sys
from datetime import date

import zstandard

LOW, HIGH = 400, 3000          # bucket range (ratings outside are clamped in)
CORE = range(600, 2500)        # buckets that get the full allowance
PER_CORE, PER_EDGE = 1200, 600
STRICT = dict(rd=80, pop=90, plays=1000)
RELAXED = dict(rd=100, pop=80, plays=200)

def bucket_of(r):
    return max(LOW, min(HIGH, (r // 100) * 100))

def main(path):
    rng = random.Random(20261030)
    strict, relaxed, seen = {}, {}, {}
    with open(path, 'rb') as fh:
        reader = zstandard.ZstdDecompressor().stream_reader(fh)
        rows = csv.reader(io.TextIOWrapper(reader, encoding='utf-8'))
        header = next(rows)
        col = {name: i for i, name in enumerate(header)}
        for n, row in enumerate(rows):
            try:
                rating = int(row[col['Rating']]); rd = int(row[col['RatingDeviation']])
                pop = int(row[col['Popularity']]); plays = int(row[col['NbPlays']])
            except (ValueError, IndexError):
                continue
            moves = row[col['Moves']].split()
            if len(moves) < 2 or len(moves) > 12:
                continue
            item = [row[col['PuzzleId']], row[col['FEN']], ' '.join(moves), rating, row[col['Themes']]]
            b = bucket_of(rating)
            seen[b] = seen.get(b, 0) + 1
            for pool, lim in ((strict, STRICT), (relaxed, RELAXED)):
                if rd <= lim['rd'] and pop >= lim['pop'] and plays >= lim['plays']:
                    # reservoir sampling per bucket (Algorithm R), capped at the allowance
                    cap = PER_CORE if b in CORE else PER_EDGE
                    res = pool.setdefault(b, [[], 0])
                    res[1] += 1
                    if len(res[0]) < cap:
                        res[0].append(item)
                    else:
                        j = rng.randrange(res[1])
                        if j < cap:
                            res[0][j] = item
                    break
            if n % 500000 == 0:
                print(f'{n:,} rows', file=sys.stderr)
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'puzzles')
    os.makedirs(out_dir, exist_ok=True)
    index = {}
    for b in range(LOW, HIGH + 1, 100):
        cap = PER_CORE if b in CORE else PER_EDGE
        chosen = list(strict.get(b, [[], 0])[0])
        if len(chosen) < cap:
            ids = {p[0] for p in chosen}
            extra = [p for p in relaxed.get(b, [[], 0])[0] if p[0] not in ids]
            chosen += extra[: cap - len(chosen)]
        if not chosen:
            continue
        chosen.sort(key=lambda p: p[3])
        with open(os.path.join(out_dir, f'r{b:04d}.json'), 'w') as f:
            json.dump(chosen, f, separators=(',', ':'))
        index[str(b)] = len(chosen)
    meta = {
        'source': 'Lichess puzzle database, https://database.lichess.org/#puzzles (CC0)',
        'built': date.today().isoformat(),
        'total': sum(index.values()),
        'buckets': index,
    }
    with open(os.path.join(out_dir, 'index.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print(json.dumps(meta, indent=1))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'lichess_db_puzzle.csv.zst')
