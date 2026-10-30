// Friendly names for Lichess puzzle themes.
const NAMES = {
  advancedPawn: 'Advanced pawn', advantage: 'Advantage', anastasiaMate: "Anastasia's mate", arabianMate: 'Arabian mate',
  attackingF2F7: 'Attacking f2/f7', attraction: 'Attraction', backRankMate: 'Back-rank mate', balestraMate: 'Balestra mate',
  bishopEndgame: 'Bishop endgame', blindSwineMate: 'Blind swine mate', bodenMate: "Boden's mate", capturingDefender: 'Capture the defender',
  castling: 'Castling', clearance: 'Clearance', cornerMate: 'Corner mate', crushing: 'Crushing', defensiveMove: 'Defensive move',
  deflection: 'Deflection', discoveredAttack: 'Discovered attack', discoveredCheck: 'Discovered check', doubleBishopMate: 'Double bishop mate',
  doubleCheck: 'Double check', dovetailMate: 'Dovetail mate', endgame: 'Endgame', enPassant: 'En passant', epauletteMate: 'Epaulette mate',
  equality: 'Equality', exposedKing: 'Exposed king', fork: 'Fork', hangingPiece: 'Hanging piece', hookMate: 'Hook mate',
  interference: 'Interference', intermezzo: 'Intermezzo', killBoxMate: 'Kill box mate', kingsideAttack: 'Kingside attack',
  knightEndgame: 'Knight endgame', long: 'Long puzzle', master: 'Master game', masterVsMaster: 'Master vs master', mate: 'Checkmate',
  mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', mateIn4: 'Mate in 4', mateIn5: 'Mate in 5+',
  middlegame: 'Middlegame', morphysMate: "Morphy's mate", oneMove: 'One move', opening: 'Opening', operaMate: 'Opera mate',
  pawnEndgame: 'Pawn endgame', pillsburysMate: "Pillsbury's mate", pin: 'Pin', promotion: 'Promotion', queenEndgame: 'Queen endgame',
  queenRookEndgame: 'Queen and rook endgame', queensideAttack: 'Queenside attack', quietMove: 'Quiet move', rookEndgame: 'Rook endgame',
  sacrifice: 'Sacrifice', short: 'Short puzzle', skewer: 'Skewer', smotheredMate: 'Smothered mate', superGM: 'Super GM game',
  swallowstailMate: "Swallow's tail mate", trappedPiece: 'Trapped piece', triangleMate: 'Triangle mate', underPromotion: 'Underpromotion',
  veryLong: 'Very long puzzle', vukovicMate: 'Vukovic mate', xRayAttack: 'X-ray attack', zugzwang: 'Zugzwang',
};

// Tags that describe length, evaluation, source or phase rather than a tactical idea.
const META = new Set(['advantage', 'crushing', 'equality', 'short', 'long', 'veryLong', 'oneMove', 'master', 'masterVsMaster', 'superGM', 'opening', 'middlegame', 'endgame', 'mate']);

export function themeName(key) {
  return NAMES[key] || key.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}

export function isTactical(key) { return !META.has(key); }
