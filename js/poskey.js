// Compact, collision-resistant key for a position (board, side, castling, en passant).
// Used to look up opening names and book moves independent of move order.
export function epd(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

// cyrb53 string hash, 53-bit, returned as base-36 text
export function posKey(fen) {
  const str = epd(fen);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
