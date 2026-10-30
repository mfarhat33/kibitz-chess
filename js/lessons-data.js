// Original lessons for 800-1400 players. Each lesson: short explanation, guided positions
// ("show" = look and read, "move" = find the move), then practice puzzles from the Lichess
// database on the same theme. Every "move" position is checked with Stockfish by tests/verify-content.mjs.
//
// move steps: line = [your move, reply, your move, ...]; accept = other first moves that also count;
// anyMate = any checkmating move is accepted on your final move; strict = only the listed moves count
// (otherwise any move Stockfish rates as good as the lesson move is accepted too).

export const LESSONS = [
  {
    id: 'safety', group: 'Fundamentals', title: 'Count before you capture',
    blurb: 'Most games at club level are decided by a piece left hanging. Learn to count attackers and defenders.',
    intro: [
      'A piece is <b>hanging</b> when the opponent can take it for free. Before every move, ask two questions: <i>what did my opponent\'s last move attack?</i> and <i>is anything of mine undefended?</i>',
      'To judge a capture, count. If a square is attacked more times than it is defended, the piece on it can be won. Trade the cheapest pieces first: a pawn that takes a knight wins even if the pawn is recaptured.',
    ],
    steps: [
      { type: 'move', fen: '4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1', text: 'The black knight on d5 has no defenders. Take it.', line: ['d1d5'], success: 'Free material. Always check whether a piece is defended before you leave it, or take it.' },
      { type: 'move', fen: '4k3/1p4pp/2p5/5b2/3N4/8/P5PP/4K3 w - - 0 1', text: 'Your knight can capture on c6 or f5. Only one capture is safe. Which?', line: ['d4f5'], strict: true, success: 'Right. The bishop on f5 had no defender. Nxc6? would lose the knight to bxc6, because the b7 pawn guards c6.' },
    ],
    practice: { themes: ['hangingPiece'], min: 500, max: 1250 },
  },
  {
    id: 'forks', group: 'Tactics', title: 'Forks',
    blurb: 'One piece attacks two targets at once. Knights and queens are the best forkers.',
    intro: [
      'A <b>fork</b> is a single move that attacks two or more pieces. The opponent can only save one of them.',
      'Look for forks when enemy pieces stand on the same colour (knight forks), on the same line, or when the king is exposed: a fork with check is the strongest kind, because the king must respond first.',
    ],
    steps: [
      { type: 'move', fen: '4k3/5ppp/r7/3N4/8/8/5PPP/4K3 w - - 0 1', text: 'Find the knight fork that wins the rook.', line: ['d5c7', 'e8d7', 'c7a6'], success: 'Nc7+ hits the king and the rook on a6. The king must move, and the rook falls.' },
      { type: 'move', fen: '4k3/8/8/7r/8/8/2Q5/4K3 w - - 0 1', text: 'Now use the queen: give a check that also attacks the rook on h5.', line: ['c2e2', 'e8f7', 'e2h5'], accept: ['c2g6'], success: 'Qe2+ checks along the e-file and hits h5 along the diagonal (Qg6+ works too). If Black blocks with ...Re5, Qxe5+ still wins the rook.' },
    ],
    practice: { themes: ['fork'], min: 600, max: 1300 },
  },
  {
    id: 'pins', group: 'Tactics', title: 'Pins and skewers',
    blurb: 'Line pieces (bishops, rooks, queens) can freeze or chase what stands on their line.',
    intro: [
      'A <b>pin</b> attacks a piece that cannot move without exposing something more valuable behind it. If the piece behind is the king, the pinned piece cannot legally move at all.',
      'A <b>skewer</b> is a pin in reverse: the valuable piece is in front. When it moves away, you take what was behind it.',
    ],
    steps: [
      { type: 'move', fen: '7q/8/8/7k/8/8/4K3/6R1 w - - 0 1', text: 'Skewer the king and the queen on the h-file.', line: ['g1h1', 'h5g6', 'h1h8'], success: 'Rh1+ forces the king off the file and the queen on h8 is lost.' },
    ],
    practice: { themes: ['pin', 'skewer'], min: 600, max: 1350 },
  },
  {
    id: 'backrank', group: 'Checkmate', title: 'Back-rank mates',
    blurb: 'A king boxed in by its own pawns can be mated on the back rank by a single rook or queen.',
    intro: [
      'When a castled king still has all three pawns in front of it, a rook or queen landing on the back rank can deliver mate because the king has no escape square.',
      'To defend, make <b>luft</b> (a breathing hole) with a quiet pawn move such as h3 or h6, or keep a rook on the back rank.',
    ],
    steps: [
      { type: 'move', fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', text: 'Black\'s king has no escape squares. Deliver mate.', line: ['e1e8'], anyMate: true, success: 'Re8#. The pawns on f7, g7 and h7 block the king\'s own escape.' },
    ],
    practice: { themes: ['backRankMate'], min: 600, max: 1400 },
  },
  {
    id: 'discovered', group: 'Tactics', title: 'Discovered attacks',
    blurb: 'Move one piece out of the way and unleash the piece behind it.',
    intro: [
      'In a <b>discovered attack</b>, a piece moves and uncovers an attack by a rook, bishop or queen behind it. Both pieces can now attack, so the opponent often cannot meet both threats.',
      'If the uncovered piece gives check, it is a <b>discovered check</b>, and the moving piece is free to grab almost anything.',
    ],
    steps: [
      { type: 'move', fen: '4k3/3q4/8/8/4N3/8/8/4R1K1 w - - 0 1', text: 'Your knight blocks the rook on the e-file. Move it with check and win the queen.', line: ['e4f6', 'e8f8', 'f6d7'], success: 'Nf6+ is a double check: knight and rook both give check, so only a king move is possible, and Nxd7 wins the queen.' },
    ],
    practice: { themes: ['discoveredAttack'], min: 700, max: 1400 },
  },
  {
    id: 'defender', group: 'Tactics', title: 'Remove the defender',
    blurb: 'If one piece is holding everything together, capture it or drive it away.',
    intro: [
      'Many positions hinge on one defender. If a piece guards something important, <b>capture the defender</b> or <b>deflect</b> it with a check or a threat, and what it was guarding falls.',
      'Ask: "what is this piece doing?" before you trade it off. Sometimes the answer is "everything".',
    ],
    steps: [],
    practice: { themes: ['capturingDefender', 'deflection'], min: 700, max: 1400 },
  },
  {
    id: 'openings', group: 'Strategy', title: 'Opening principles',
    blurb: 'Control the centre, develop your pieces and castle early.',
    intro: [
      'You do not need to memorise lines to play a good opening. Follow three habits: put pawns and pieces on the <b>centre</b> squares (e4, d4, e5, d5), <b>develop</b> knights and bishops before moving any piece twice, and <b>castle</b> to tuck your king away.',
      'Avoid early queen adventures: the queen gets chased around while your opponent develops with tempo.',
    ],
    steps: [
      { type: 'move', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', text: 'First move: take space in the centre.', line: ['e2e4'], accept: ['d2d4', 'c2c4', 'g1f3'], success: 'Good. Central pawns give your pieces room to come out.' },
      { type: 'move', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', text: 'Develop a knight towards the centre, ideally with a threat.', line: ['g1f3'], accept: ['b1c3'], success: 'Nf3 develops and attacks the e5 pawn at the same time.' },
      { type: 'move', fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 1 5', text: 'Your knight and bishop are out. Time to make the king safe.', line: ['e1g1'], strict: true, success: 'Castled. Your king is safe and your rook can join the game.' },
    ],
    practice: null,
  },
  {
    id: 'kpk', group: 'Endgames', title: 'King and pawn endings',
    blurb: 'The king becomes a fighting piece. Learn the 6th-rank rule and the square of the pawn.',
    intro: [
      'With only kings and a pawn left, the king leads the pawn. A key rule: if your king stands on the <b>6th rank in front of your pawn</b> (any pawn except a rook pawn), you win no matter who moves.',
      '<b>The square of the pawn</b>: draw a square from the pawn to its promotion rank. If the defending king can step inside it, it catches the pawn.',
    ],
    steps: [
      { type: 'move', fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', text: 'Your king is on the 6th rank in front of the pawn. Step aside so the pawn can advance.', line: ['e6d6'], accept: ['e6f6'], success: 'Kd6 or Kf6. After ...Kd8 e6 Ke8 e7, the pawn promotes.' },
      { type: 'move', fen: '8/8/8/8/P4k2/8/8/7K b - - 0 1', text: 'Black to move. Step into the square of the a-pawn to catch it.', line: ['f4e5'], accept: ['f4e4'], success: 'Ke5 (or Ke4) enters the square a4-e4-e8-a8, so the king reaches the pawn in time.' },
    ],
    practice: { themes: ['pawnEndgame'], min: 600, max: 1400 },
  },
  {
    id: 'mates', group: 'Checkmate', title: 'Basic checkmates',
    blurb: 'Finish the game: queen mates, and the two-rook ladder.',
    intro: [
      'With extra material you still have to mate. Push the enemy king to the edge, keep your pieces protected, and watch out for <b>stalemate</b>: the opponent must always have a legal move until the final blow.',
      'The <b>ladder</b>: two rooks take turns checking and cutting off ranks until the king reaches the edge.',
    ],
    steps: [
      { type: 'move', fen: '7k/8/6K1/8/8/8/8/1Q6 w - - 0 1', text: 'Your king guards g7 and h7. Mate in one.', line: ['b1b8'], anyMate: true, success: 'Qb8#. The queen controls the back rank and your king covers the escape squares.' },
      { type: 'move', fen: '6k1/8/8/8/8/8/R7/1R4K1 w - - 0 1', text: 'Ladder mate in two: first cut the king off on the 7th rank.', line: ['a2a7', 'g8f8', 'b1b8'], anyMate: true, success: 'Ra7 cuts off the 7th rank and Rb8# finishes the ladder.' },
    ],
    practice: { themes: ['mateIn1', 'mateIn2'], min: 500, max: 1200 },
  },
];

// Endgame drills: play the position out against full-strength Stockfish.
// goal: 'mate' (checkmate within `limit` of your moves), 'promote' (promote and stay winning),
// 'hold' (draw, or survive `limit` moves without the opponent promoting or mating).
// side: the side you play when Stockfish has to move first (defaults to the side to move).
export const DRILLS = [
  { id: 'kqk', title: 'Queen and king mate', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', goal: 'mate', limit: 25, text: 'Use your queen to box in the king (stay a knight\'s jump away), bring your king up, then mate. Avoid stalemate.' },
  { id: 'krk', title: 'Rook and king mate', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', goal: 'mate', limit: 35, text: 'Cut the king off with the rook, use your king to take the opposition, and shrink the box.' },
  { id: 'krrk', title: 'Two-rook ladder', fen: '4k3/8/8/8/8/8/8/R3K2R w - - 0 1', goal: 'mate', limit: 15, text: 'Alternate rook checks to push the king to the edge. Keep the rooks far from the king.' },
  { id: 'kpk6', title: 'Pawn ending: king on the 6th', fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', goal: 'promote', limit: 15, text: 'Win by promoting the pawn. Keep the opposition and do not stalemate the king.' },
  { id: 'kpkdef', title: 'Pawn ending: hold the draw', fen: '4k3/8/8/8/4P3/4K3/8/8 b - - 0 1', goal: 'hold', limit: 25, text: 'You defend with Black. Get your king in front of the pawn and keep the opposition.' },
  { id: 'opposition', title: 'Pawn ending: use the opposition', fen: '8/8/8/3k4/8/3K4/3P4/8 b - - 0 1', side: 'w', goal: 'promote', limit: 20, text: 'You have the opposition and Black must give way. Get your king in front of the pawn, keep the opposition, then push.' },
  { id: 'square', title: 'Pawn ending: the square', fen: '8/8/8/8/P4k2/8/8/7K b - - 0 1', goal: 'hold', limit: 12, text: 'You defend with Black. Step into the square of the a-pawn and catch it before it promotes.' },
  { id: 'lucena', title: 'Lucena position', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', goal: 'promote', limit: 30, text: 'The classic winning technique: drive the enemy king away with a check, then "build a bridge" with your rook to shield your king from checks.' },
  { id: 'philidor', title: 'Philidor defence', fen: '4k3/8/r7/3KP3/8/8/8/7R b - - 0 1', goal: 'hold', limit: 25, text: 'You defend with Black. Keep your rook on the 6th rank until the pawn advances, then check from behind.' },
];
