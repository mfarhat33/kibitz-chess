// Original lessons for 800-1400 players. Each lesson: short explanation, guided positions
// ("show" = look and read, "move" = find the move), then practice puzzles from the Lichess
// database on the same theme. Every "move" position is checked with Stockfish by tests/verify-content.mjs.
//
// move steps: line = [your move, reply, your move, ...]; accept = other first moves that also count;
// anyMate = any checkmating move is accepted on your final move; strict = only the listed moves count
// (otherwise any move Stockfish rates as good as the lesson move is accepted too).
//
// show steps: fen + text, optional arrows (["e2e4", ...]), optional line (moves the reader can play through)
// with optional `after` text shown at the end, optional orientation ("white"/"black", default: side to move).

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
    id: 'openings', group: 'Fundamentals', title: 'Opening principles',
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
    id: 'thinking', group: 'Fundamentals', title: 'Checks, captures, threats',
    blurb: 'A simple routine for every move: look at all checks, captures and threats, for both sides.',
    intro: [
      'Strong players are not magicians; they have a habit. Before each move they scan the board for <b>checks</b>, <b>captures</b> and <b>threats</b>, first their own and then the opponent\'s. Forcing moves come first because they leave the other side the fewest choices.',
      'This routine stops you from missing a mate in one, and it stops you from walking into one. Say it in your head every move until it becomes automatic: <i>checks, captures, threats</i>.',
    ],
    steps: [
      { type: 'show', fen: '6k1/5ppp/8/4n3/8/1q3Q2/2r2PPP/3R2K1 w - - 0 1', arrows: ['e5f3', 'b3f3'], text: 'Black attacks your queen twice, with the knight and with the queen. The natural reaction is to save the queen at once. Before you do, run the routine: do you have any checks?' },
      { type: 'move', fen: '6k1/5ppp/8/4n3/8/1q3Q2/2r2PPP/3R2K1 w - - 0 1', text: 'Look at every check White has. One of them ends the game.', line: ['d1d8'], anyMate: true, success: 'Rd8#. Black\'s own pawns trap the king, and no black piece can block on e8 or f8. Checks first: the attack on your queen no longer matters.' },
    ],
    practice: { themes: ['mateIn1', 'hangingPiece'], min: 500, max: 1100 },
  },
  {
    id: 'kingsafety', group: 'Fundamentals', title: 'Keep your king safe',
    blurb: 'Castle early, leave the pawns in front of your king alone, and punish a king stuck in the centre.',
    intro: [
      'A king in the middle of the board is a target. Once the centre opens, enemy rooks and queens can attack it along the open files, and the pieces in front of it get pinned. That is why you should <b>castle early</b>, usually within the first ten moves.',
      'After castling, be careful with the pawns in front of your king: every pawn move there leaves holes that can never be repaired. When it is your opponent\'s king that is stuck or exposed, look for <b>pins and checks</b> along the open lines.',
    ],
    steps: [
      { type: 'show', fen: 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 1', text: 'A healthy position for both sides: each king has castled and sits behind three unmoved pawns on f, g and h, with a knight on f3 or f6 guarding the squares in front.' },
      { type: 'move', fen: 'r3k2r/ppp2ppp/4b3/8/3P4/8/PPPB1PPP/R3R1K1 w - - 0 1', text: 'Black\'s king is still in the centre and can no longer castle. Your rook pins the bishop on e6 to it. Attack the pinned piece.', line: ['d4d5'], success: 'd5! The pinned bishop cannot move at all, so Black will have to give it up for a pawn at best. A king left in the centre turns the pieces in front of it into targets.' },
      { type: 'move', fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2', text: 'White has played two careless pawn moves, f3 and g4, opening the diagonal to the white king. Black to move: punish it.', line: ['d8h4'], anyMate: true, success: 'Qh4#. This is the fastest checkmate possible. The f- and g-pawns should have stayed at home to shelter the king.' },
    ],
    practice: { themes: ['exposedKing', 'kingsideAttack'], min: 700, max: 1400 },
  },
  {
    id: 'pawns', group: 'Fundamentals', title: 'Pawn structure basics',
    blurb: 'Doubled, isolated and passed pawns: which pawns are weak, which are strong, and why.',
    intro: [
      'Pawns cannot move backwards, so every pawn move changes the position for good. A pawn with no friendly pawn on the files next to it is <b>isolated</b>: no pawn can ever defend it. Two pawns of the same colour on one file are <b>doubled</b>: they block each other and are easy to attack.',
      'A <b>passed pawn</b> has no enemy pawns in front of it or on the files next to it, so only pieces can stop it. Passed pawns grow stronger as pieces come off the board. A good rule of thumb: <i>passed pawns must be pushed</i>.',
    ],
    steps: [
      { type: 'show', fen: '6k1/5ppp/3p4/2p5/P3P3/2P5/2P3PP/6K1 w - - 0 1', arrows: ['a4a8'], text: 'White\'s a-pawn is passed: there is no black pawn on the a- or b-file to stop it. White\'s c-pawns are doubled, and the e-pawn is isolated. Even so, the passed a-pawn decides this pawn ending: the black king is too far away to catch it.' },
      { type: 'move', fen: '6k1/ppp5/8/PPP5/8/8/8/6K1 w - - 0 1', text: 'There is no passed pawn yet, but you can create one. Both kings are far away. Find the pawn breakthrough.', line: ['b5b6', 'c7b6', 'a5a6', 'b7a6', 'c5c6'], success: 'b6! After ...cxb6 comes a6!, and after ...axb6 comes c6!. Either way one white pawn breaks through, and the black king is much too far away to stop it.' },
    ],
    practice: { themes: ['advancedPawn', 'pawnEndgame'], min: 600, max: 1400 },
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
    id: 'decoy', group: 'Tactics', title: 'Decoys',
    blurb: 'Sacrifice to drag an enemy piece, often the king, onto a square where it can be forked or mated.',
    intro: [
      'A <b>decoy</b> (also called attraction) is a sacrifice that forces an enemy piece onto a particular square. You give something up because that square is exactly where your next move does damage.',
      'Look for decoys when you can see a fork or a mate that <i>almost</i> works: if only the king stood one square over. A check that the king has to capture is the most forcing way to move it there.',
    ],
    steps: [
      { type: 'show', fen: '6k1/pp4pp/8/2N1q3/8/5R2/PP4PP/7K w - - 0 1', arrows: ['c5d7'], text: 'Your knight can jump to d7, where it would attack both e5 and f8. The queen is on e5, but the black king is on g8, out of reach. Can you make the king come to f8?' },
      { type: 'move', fen: '6k1/pp4pp/8/2N1q3/8/5R2/PP4PP/7K w - - 0 1', text: 'Give up your rook to bring the king to f8, then fork.', line: ['f3f8', 'g8f8', 'c5d7', 'f8e7', 'd7e5'], success: 'Rf8+! The king has to take, and Nd7+ forks king and queen. You gave a rook and won the queen, so you end up a knight ahead.' },
    ],
    practice: { themes: ['attraction'], min: 1000, max: 1600 },
  },
  {
    id: 'zwischenzug', group: 'Tactics', title: 'In-between moves',
    blurb: 'Before you recapture on autopilot, check whether a stronger move can come first.',
    intro: [
      'When a piece is taken, most players take back at once. Sometimes there is something better: an <b>in-between move</b> (zwischenzug, or intermezzo), such as a check that the opponent must answer first. You recapture afterwards.',
      'Often the recapture is still there after your opponent has dealt with your check. So every time you are about to take back, pause for a second and look for checks and captures first.',
    ],
    steps: [
      { type: 'show', fen: 'r4rk1/pp2bppp/8/3N4/8/8/PP3PPP/R2q1RK1 w - - 0 1', arrows: ['a1d1', 'f1d1'], text: 'Black has just taken your queen on d1, offering a queen trade. Either rook can take back, and material will be level. But is there something better to play first?' },
      { type: 'move', fen: 'r4rk1/pp2bppp/8/3N4/8/8/PP3PPP/R2q1RK1 w - - 0 1', text: 'Find the in-between check that wins material, then recapture.', line: ['d5e7', 'g8h8', 'a1d1'], success: 'Nxe7+! The king has to go to h8, and only then do you take back on d1. The in-between check won a whole bishop.' },
    ],
    practice: { themes: ['intermezzo'], min: 1000, max: 1600 },
  },
  {
    id: 'trapped', group: 'Tactics', title: 'Trapped pieces',
    blurb: 'A piece with no safe squares can be won. Greedy bishops and knights on the edge are the usual victims.',
    intro: [
      'A piece is <b>trapped</b> when it is attacked, or soon will be, and every square it could flee to is covered. You do not have to win it at once: first take away its escape squares, then collect it.',
      'Typical victims are a bishop that grabs a pawn on a2 or h2 (a7 or h7 for Black), a knight on the edge of the board, and a queen that goes pawn-hunting deep in enemy territory. Before you grab a pawn, ask: <i>how does my piece get back out?</i>',
    ],
    steps: [
      { type: 'move', fen: '6k1/1pp2ppp/8/8/8/5N2/bPP2PPP/2K5 w - - 0 1', text: 'Black\'s bishop has just grabbed your pawn on a2. Shut the door so it can never come back.', line: ['b2b3', 'g8f8', 'c1b2'], success: 'b3! The bishop\'s only way out was the diagonal through b3, and b1 is covered by your king. Kb2 now attacks it, and the best Black can do is give it up for two pawns.' },
      { type: 'move', fen: '6k1/5ppp/8/4P2n/8/4P3/5PPP/6K1 w - - 0 1', text: 'The knight on h5 is on the edge of the board. Attack it so that it has nowhere to go.', line: ['g2g4', 'f7f6', 'g4h5'], success: 'g4! Every escape square is covered: f4 and f6 by your e-pawns, g3 by your f- and h-pawns, and g7 is blocked by Black\'s own pawn. The knight is lost for at most a pawn.' },
    ],
    practice: { themes: ['trappedPiece'], min: 1100, max: 1600 },
  },
  {
    id: 'xray', group: 'Tactics', title: 'X-ray attacks',
    blurb: 'A rook, bishop or queen can work through an enemy piece: when that piece moves, the line opens.',
    intro: [
      'An <b>x-ray</b> is an attack or defence that passes through an enemy piece. Your rook may look blocked by an enemy piece on its file, but the moment that piece moves or captures, the rook controls every square behind it.',
      'X-rays often decide exchanges and back-rank fights. When you count attackers and defenders of a square, include the pieces lined up behind, on both sides.',
    ],
    steps: [
      { type: 'show', fen: '6k1/5ppp/8/3r4/8/8/5PPP/3R2K1 w - - 0 1', arrows: ['d1d8'], text: 'The white rook on d1 is blocked by the black rook on d5, yet it x-rays the d-file all the way to d8. If the black rook ever leaves the d-file, or goes to d8 itself, the white rook sees d8 again.' },
      { type: 'move', fen: '6k1/pq3ppp/8/Q2r4/8/8/5PPP/3R2K1 w - - 0 1', text: 'Your queen is attacked by the rook on d5. Use the x-ray of your rook on d1.', line: ['a5d8', 'd5d8', 'd1d8'], anyMate: true, success: 'Qd8+! Black has to take with the rook, and that opens the d-file: Rxd8 is mate. Your rook on d1 was aiming at d8 all along.' },
    ],
    practice: { themes: ['xRayAttack'], min: 700, max: 1500 },
  },
  {
    id: 'promotion', group: 'Tactics', title: 'Promotion tactics',
    blurb: 'A pawn on the seventh rank is worth a lot. Learn to clear the way to the promotion square.',
    intro: [
      'A pawn that reaches the last rank becomes a queen, so a pawn on the seventh rank ties down the enemy pieces that guard its promotion square. Often a single sacrifice is enough to get rid of that guard.',
      'Two ideas to look for: <b>deflect</b> the piece that stops the pawn, or <b>cut it off</b> by putting one of your pieces in its way. Promoting with check is even better, because the opponent gets no time to react.',
    ],
    steps: [
      { type: 'move', fen: '1r5k/1P4pp/8/8/8/8/6PP/2R3K1 w - - 0 1', text: 'The rook on b8 is the only thing stopping your pawn. Lure it away with check.', line: ['c1c8', 'b8c8', 'b7c8q'], anyMate: true, success: 'Rc8+! The rook has to take, and bxc8=Q is checkmate: Black\'s own pawns trap the king.' },
      { type: 'move', fen: '7r/P5k1/8/8/8/8/6K1/1R6 w - - 0 1', text: 'Black\'s rook on h8 guards a8 along the back rank. Block its path.', line: ['b1b8'], success: 'Rb8! The rook on h8 no longer sees a8. If ...Rxb8, then axb8=Q, and otherwise the pawn will soon promote on a8.' },
    ],
    practice: { themes: ['promotion', 'advancedPawn'], min: 600, max: 1400 },
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
  {
    id: 'smothered', group: 'Checkmate', title: 'Smothered mate',
    blurb: 'A knight mates a king that is boxed in by its own pieces. Includes the famous queen sacrifice.',
    intro: [
      'In a <b>smothered mate</b> the king cannot move because its own pieces fill every escape square, and a knight gives the check. A knight check can never be blocked, so it is mate on the spot.',
      'It usually happens with the king in the corner on h8 (or h1 for White). Watch for a knight that can reach f7 (or f2), especially when a rook stands next to the king on g8.',
    ],
    steps: [
      { type: 'move', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', text: 'The black king is surrounded by its own rook and pawns. Mate in one.', line: ['g5f7'], anyMate: true, success: 'Nf7#. The king has no square to go to, and a knight check cannot be blocked.' },
      { type: 'move', fen: '5r1k/6pp/7N/8/2Q5/8/5PPP/6K1 w - - 0 1', text: 'Mate in two. Sacrifice your queen to force the rook onto g8.', line: ['c4g8', 'f8g8', 'h6f7'], anyMate: true, success: 'Qg8+! The king cannot take because your knight guards g8, so the rook has to. Then Nf7# is a smothered mate.' },
      { type: 'show', fen: '4r2k/6pp/8/6N1/2Q5/8/5PPP/6K1 w - - 0 1', line: ['g5f7', 'h8g8', 'f7h6', 'g8h8', 'c4g8', 'e8g8', 'h6f7'], text: 'The whole pattern, known as Philidor\'s legacy: a knight check, a double check, the queen sacrifice and the smothered mate. Watch how the king is driven back into the corner.', after: 'Nh6+ was a double check (knight and queen), so the king had to move. Had it gone to f8 instead, Qf7 would have been mate.' },
    ],
    practice: { themes: ['smotheredMate'], min: 600, max: 1300 },
  },
  {
    id: 'knightrook', group: 'Checkmate', title: 'Rook and knight mates',
    blurb: 'The Arabian mate and Anastasia\'s mate: rook and knight working together against a king on the edge.',
    intro: [
      'A rook and a knight make a strong mating team. In the <b>Arabian mate</b> the king is in the corner. The knight protects the rook and covers an escape square, and the rook gives check from right next to the king.',
      'In <b>Anastasia\'s mate</b> the king is on the edge, hemmed in by one of its own pawns. A knight takes away the escape squares and the rook mates along the edge file. Both patterns turn up often in real games.',
    ],
    steps: [
      { type: 'move', fen: '7k/pR6/1p3N2/8/8/8/2r2PPP/6K1 w - - 0 1', text: 'Your knight on f6 covers g8 and h7. Deliver the Arabian mate.', line: ['b7h7'], anyMate: true, success: 'Rh7#. The rook checks next to the king and is protected by the knight, which also covers g8.' },
      { type: 'move', fen: '5rk1/5ppp/8/3N3Q/8/4R3/5PPP/6K1 w - - 0 1', text: 'Mate in three, Anastasia style. Start with a knight check.', line: ['d5e7', 'g8h8', 'h5h7', 'h8h7', 'e3h3'], anyMate: true, success: 'Ne7+ Kh8, then Qxh7+! Kxh7 and Rh3#. The knight on e7 covers g8 and g6, and the pawn on g7 takes away the king\'s last square.' },
    ],
    practice: { themes: ['arabianMate', 'anastasiaMate'], min: 500, max: 1500 },
  },
  {
    id: 'rookmate', group: 'Checkmate', title: 'Mate with king and rook',
    blurb: 'The basic technique: cut the king off, shrink its box, and bring your own king to help.',
    intro: [
      'King and rook against a lone king is always a win, but you need a method. Use the rook to <b>cut off</b> the enemy king along a rank or file, bring your own king closer, and shrink the box one line at a time until the enemy king reaches the edge.',
      'The mate usually comes when the two kings stand <b>face to face</b>, with one square between them, and the rook checks along the edge. Keep your rook far away from the enemy king so it cannot be attacked, and before every move make sure the opponent still has a legal move, or it is stalemate.',
    ],
    steps: [
      { type: 'show', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', arrows: ['a1a4'], text: 'A good start is Ra4: the black king can no longer cross the 4th rank, so it is locked in the top half of the board. Then your king walks up to help.' },
      { type: 'move', fen: '4k3/8/4K3/8/8/8/8/R7 w - - 0 1', text: 'The kings stand face to face. Mate in one.', line: ['a1a8'], anyMate: true, success: 'Ra8#. Your king covers d7, e7 and f7, and the rook covers the whole back rank.' },
      { type: 'move', fen: '7k/R7/5K2/8/8/8/8/8 w - - 0 1', text: 'Mate in two. Careful: one natural king move is stalemate.', line: ['f6g6', 'h8g8', 'a7a8'], anyMate: true, success: 'Kg6! forces ...Kg8, and Ra8# follows. Kf7?? would have been stalemate, since Black would have no legal move.' },
    ],
    practice: { themes: ['backRankMate', 'mateIn2'], min: 500, max: 1200 },
  },
  {
    id: 'traps', group: 'Checkmate', title: 'Opening traps',
    blurb: 'Two classic early knockouts, so you can spring them and never fall for them.',
    intro: [
      'At the start of the game the squares f7 and f2 are weak: only the king defends them. Early attacks against f7 with queen and bishop win many games at club level, and lose many more.',
      'Learn these traps from both sides. The point is not to play for tricks, but to see them coming: <b>develop your pieces, and ask what every enemy move attacks</b>.',
    ],
    steps: [
      { type: 'move', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', text: 'After 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? Black has attacked your queen but forgotten about f7. Finish the game.', line: ['h5f7'], anyMate: true, success: 'Qxf7#, the Scholar\'s mate. Black should have defended f7 with 3...g6 or 3...Qe7.' },
      { type: 'move', fen: 'rn1qkbnr/ppp2p1p/3p2p1/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5', text: 'After 1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 g6? your knight on f3 is pinned to your queen. Break the pin anyway!', line: ['f3e5', 'g4d1', 'c4f7', 'e8e7', 'c3d5'], anyMate: true, success: 'Nxe5! If Black grabs the queen with ...Bxd1, then Bxf7+ Ke7 Nd5# is Légal\'s mate. Black\'s best is 5...dxe5 6.Qxg4, and White has won a pawn.' },
    ],
    practice: { themes: ['attackingF2F7'], min: 500, max: 1300 },
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
    id: 'opposition', group: 'Endgames', title: 'The opposition',
    blurb: 'In king and pawn endings, the side that does not have to move often wins. Learn to take the opposition.',
    intro: [
      'When the two kings stand on the same file with one square between them, the side that is <b>not</b> to move has <b>the opposition</b>. The other king has to step aside and let the enemy king through.',
      'With king and pawn against king, the attacker wants to get the king in front of the pawn and keep the opposition; the defender wants the opposite. Often only one move does the job, so count carefully before you move.',
    ],
    steps: [
      { type: 'move', fen: '8/8/8/3k4/8/8/3PK3/8 w - - 0 1', text: 'Take the opposition, so the black king has to give way.', line: ['e2d3'], success: 'Kd3! The kings face each other and Black is to move, so Black must step aside and your king gets in front of the pawn. Any other move allows Black to draw.' },
      { type: 'move', fen: '8/8/3k4/8/3PK3/8/8/8 b - - 0 1', text: 'Now defend with Black. Only one move holds the draw.', line: ['d6e6'], success: 'Ke6! Black takes the opposition, and the white king cannot get in front of the pawn. Every other move loses.' },
    ],
    practice: { themes: ['pawnEndgame', 'zugzwang'], min: 700, max: 1500 },
  },
  {
    id: 'rookendings', group: 'Endgames', title: 'Lucena and Philidor',
    blurb: 'The two rook endings every player should know: how to win with an extra pawn, and how to draw without one.',
    intro: [
      'Rook endings are the most common endings of all, and with rook and pawn against rook two positions tell you most of what you need. The <b>Philidor</b> position shows the defender how to draw: keep your king in front of the pawn and your rook on the third rank from your side, so the enemy king cannot come forward. Once the pawn advances, move the rook behind it and check from a distance.',
      'The <b>Lucena</b> position shows the attacker how to win once the pawn is on the seventh rank with the king in front of it: drive the enemy king away with a check, then <b>build a bridge</b> with your rook to block the checks.',
    ],
    steps: [
      { type: 'show', fen: '4k3/8/r7/3KP3/8/8/8/7R b - - 0 1', arrows: ['a6h6'], text: 'Philidor: Black\'s rook guards the 6th rank, so the white king cannot step up to d6 or e6. If White just waits, Black waits too by moving the rook along the 6th rank.' },
      { type: 'move', fen: '4k3/7R/3KP3/8/8/8/8/r7 b - - 0 1', text: 'The pawn has gone to e6, so it can no longer shelter its king from checks from behind. White threatens Rh8 mate. Save the game.', line: ['a1d1'], accept: ['a1a6'], success: 'Rd1+! A check from behind. The white king has nowhere to hide from the checks, and the game is a draw. (Ra6+, checking from the side, also holds.)' },
      { type: 'move', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', text: 'Lucena: your pawn is on b7 and your king is stuck in front of it. First drive the black king further away with a check.', line: ['c1d1'], success: 'Rd1+! The king has to step over to the e-file, away from your pawn. Next comes the bridge.' },
      { type: 'show', fen: '1K6/1P2k3/8/8/8/8/r7/3R4 w - - 0 1', line: ['d1d4', 'a2a1', 'b8c7', 'a1c1', 'c7b6', 'c1b1', 'b6c6', 'b1c1', 'c6b5', 'c1b1', 'd4b4'], text: 'Building the bridge: Rd4! first, then the king walks out. When the checks finally run out of room, the rook on the 4th rank blocks them.', after: 'Rb4 blocks the last check, and the pawn will promote.' },
    ],
    practice: { themes: ['rookEndgame'], min: 600, max: 1500 },
  },
  {
    id: 'convert', group: 'Endgames', title: 'Converting extra material',
    blurb: 'Ahead in material? Trade pieces, keep it simple, and head for an ending you can win easily.',
    intro: [
      'Being a piece up is only half the job: you still have to win. The simplest method is to <b>trade pieces</b>. Every trade makes your extra material count for more and leaves the opponent fewer chances to attack you or set traps.',
      'The rule of thumb: when ahead, trade pieces but keep pawns; when behind, avoid piece trades and try to trade pawns. A won king and pawn ending is often the cleanest way home, so learn to spot when trading the last pieces wins.',
    ],
    steps: [
      { type: 'move', fen: '3r4/p3kppp/1p6/8/8/5B2/PP3PPP/3R2K1 w - - 0 1', text: 'You are a bishop up. The simplest plan is to trade off Black\'s last piece.', line: ['d1d8'], success: 'Rxd8! After ...Kxd8 Black has no pieces left at all, and nothing to fight your extra bishop with.' },
      { type: 'move', fen: '3r4/4kppp/8/P7/8/8/5PPP/3R2K1 w - - 0 1', text: 'You are a pawn up, and your extra pawn is a passed a-pawn far away from the kings. Trade into the pawn ending.', line: ['d1d8'], success: 'Rxd8! After ...Kxd8 the pawn ending is winning: the black king has to run to stop the a-pawn, and meanwhile your king heads for the kingside pawns.' },
    ],
    practice: { themes: ['endgame'], min: 800, max: 1400 },
  },
  {
    id: 'rooks', group: 'Strategy', title: 'Active rooks',
    blurb: 'Rooks belong on open files and on the seventh rank, not behind their own pawns.',
    intro: [
      'Rooks need open lines. A file with no pawns on it is an <b>open file</b>, and a rook there can travel the whole length of the board. Put your rooks on open files before your opponent does, and double them when you can.',
      'The goal is often the <b>seventh rank</b> (the second rank for Black). A rook there attacks pawns still on their starting squares and can trap the enemy king on its back rank.',
    ],
    steps: [
      { type: 'move', fen: 'r4rk1/pp3ppp/2p1p3/8/8/2P1P3/PP3PPP/R4RK1 w - - 0 1', text: 'Only the d-file is open. Take it with a rook before Black does.', line: ['f1d1'], accept: ['a1d1'], success: 'Rd1. Your rook controls the open file. If Black challenges it with ...Rfd8, you can trade or double your rooks.' },
      { type: 'move', fen: '6kr/pp3p1p/6p1/8/8/8/PP3PPP/3R2K1 w - - 0 1', text: 'Your rook has the open d-file, while Black\'s rook on h8 is boxed in by its own king and pawn. Invade.', line: ['d1d7'], success: 'Rd7! On the seventh rank the rook attacks b7 and f7, and Black\'s rook still needs time to get out.' },
    ],
    practice: { themes: ['rookEndgame'], min: 700, max: 1400 },
  },
  {
    id: 'outposts', group: 'Strategy', title: 'Knight outposts',
    blurb: 'A knight on a square that no enemy pawn can attack, backed by one of your pawns, is a monster.',
    intro: [
      'An <b>outpost</b> is a square in or near the enemy half that no enemy pawn can ever attack, ideally protected by one of your own pawns. A knight planted there cannot be chased away; the opponent has to give up a piece for it to get rid of it.',
      'Knights love outposts because they are short-range pieces: they need a safe square close to the action. Look for holes in the enemy pawn chain, such as d5 when Black has pawns on d6 and e5 and no c-pawn left to challenge it.',
    ],
    steps: [
      { type: 'show', fen: 'r4rk1/pp2bppp/3p4/4p3/4P3/2N5/PPP2PPP/R4RK1 w - - 0 1', arrows: ['c3d5'], text: 'Look at d5. Black has no c-pawn, and the e-pawn has already moved past e6, so no black pawn can ever attack that square. Your e4 pawn guards it. It is a perfect outpost.' },
      { type: 'move', fen: 'r4rk1/pp2bppp/3p4/4p3/4P3/2N5/PPP2PPP/R4RK1 w - - 0 1', text: 'Put your knight on the outpost.', line: ['c3d5'], success: 'Nd5! The knight is safe and central, hits e7 and c7, and controls f6. Black\'s bishop is hemmed in by its own pawns on d6 and e5, which stand on its colour.' },
    ],
    practice: { themes: ['knightEndgame', 'fork'], min: 800, max: 1500 },
  },
  {
    id: 'bishops', group: 'Strategy', title: 'Good and bad bishops',
    blurb: 'A bishop hemmed in by its own pawns is a poor piece. Learn to spot one and to exploit it.',
    intro: [
      'A bishop is <b>bad</b> when many of its own pawns are fixed on squares of its colour: they block its diagonals, and the squares of the other colour become holes it can never defend. A bishop whose pawns stand on the other colour is <b>good</b>.',
      'Two practical rules: put your pawns on the opposite colour to your bishop, and when your opponent has a bad bishop, use the squares of the other colour, where your king and knight can never be challenged by it.',
    ],
    steps: [
      { type: 'show', fen: '8/1p1b1k2/p3p1p1/P2pP1Pp/1P1P3P/3NK3/8/8 w - - 0 1', text: 'Every black pawn stands on a light square, the same colour as Black\'s bishop. The bishop has to defend them, it can never attack a single white pawn, and it has no say at all over dark squares such as c5, f4 and d6.' },
      { type: 'move', fen: '8/1p1b1k2/p3p1p1/P2pP1Pp/1P1P3P/3NK3/8/8 w - - 0 1', text: 'White is much better, because the king and knight can use the dark squares freely. Start by bringing your king towards the queenside.', line: ['e3d2'], success: 'Kd2! The king heads for c3, and after the pawn break b5 it can go on to b4 and beyond. Black\'s bishop can never chase it off a dark square.' },
    ],
    practice: { themes: ['bishopEndgame'], min: 800, max: 1600 },
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
