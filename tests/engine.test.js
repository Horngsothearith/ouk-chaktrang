const test = require('node:test');
const assert = require('node:assert/strict');
const OukEngine = require('../src/engine.js');

test('squareName and parseSquare round-trip', () => {
  assert.equal(OukEngine.squareName(0, 0), 'a1');
  assert.equal(OukEngine.squareName(7, 7), 'h8');
  assert.equal(OukEngine.squareName(2, 4), 'e3');
  assert.deepEqual(OukEngine.parseSquare('e3'), { rank: 2, file: 4 });
  assert.deepEqual(OukEngine.parseSquare('a1'), { rank: 0, file: 0 });
});

test('initial state has the verified Ouk Chaktrang starting position', () => {
  const state = OukEngine.createInitialState();
  const expectedWhiteBackRank = ['R', 'N', 'B', 'K', 'Q', 'B', 'N', 'R'];
  const expectedBlackBackRank = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];

  for (let file = 0; file < 8; file++) {
    const w = OukEngine.pieceAt(state, 0, file);
    assert.equal(w.type, expectedWhiteBackRank[file], 'white back rank file ' + file);
    assert.equal(w.color, 'w');

    const wp = OukEngine.pieceAt(state, 2, file);
    assert.deepEqual(wp, { type: 'P', color: 'w' }, 'white pawn file ' + file);

    const bp = OukEngine.pieceAt(state, 5, file);
    assert.deepEqual(bp, { type: 'P', color: 'b' }, 'black pawn file ' + file);

    const b = OukEngine.pieceAt(state, 7, file);
    assert.equal(b.type, expectedBlackBackRank[file], 'black back rank file ' + file);
    assert.equal(b.color, 'b');

    assert.equal(OukEngine.pieceAt(state, 1, file), null, 'rank index 1 empty, file ' + file);
    assert.equal(OukEngine.pieceAt(state, 3, file), null, 'rank index 3 empty, file ' + file);
    assert.equal(OukEngine.pieceAt(state, 4, file), null, 'rank index 4 empty, file ' + file);
    assert.equal(OukEngine.pieceAt(state, 6, file), null, 'rank index 6 empty, file ' + file);
  }

  // King/Queen asymmetry: White King d1 (rank0,file3), White Queen e1 (rank0,file4)
  assert.deepEqual(OukEngine.parseSquare('d1'), { rank: 0, file: 3 });
  assert.equal(OukEngine.pieceAt(state, 0, 3).type, 'K');
  assert.equal(OukEngine.pieceAt(state, 0, 4).type, 'Q');
  // Black Queen d8 (rank7,file3), Black King e8 (rank7,file4)
  assert.equal(OukEngine.pieceAt(state, 7, 3).type, 'Q');
  assert.equal(OukEngine.pieceAt(state, 7, 4).type, 'K');

  assert.equal(state.turn, 'w');
  assert.equal(state.anyCaptureYet, false);
  assert.equal(state.status, 'active');
  assert.equal(state.counting.active, false);
});

function placedState(pieces, turn) {
  const state = OukEngine.createInitialState();
  state.board = new Array(64).fill(null);
  for (const p of pieces) {
    const sq = OukEngine.parseSquare(p.at);
    state.board[sq.rank * 8 + sq.file] = { type: p.type, color: p.color };
  }
  state.turn = turn || 'w';
  return state;
}

function destSet(moves) {
  return moves.map((m) => OukEngine.squareName(m.to.rank, m.to.file)).sort();
}

test('rook slides until blocked, can capture enemy, stops before own piece', () => {
  const state = placedState([
    { at: 'd4', type: 'R', color: 'w' },
    { at: 'd6', type: 'P', color: 'b' }, // enemy blocker 2 up
    { at: 'a4', type: 'P', color: 'w' }  // own blocker on the same rank
  ], 'w');
  const sq = OukEngine.parseSquare('d4');
  const moves = OukEngine.generateBaseMoves(state, sq.rank, sq.file);
  const dests = destSet(moves);
  assert.ok(dests.includes('d5'));
  assert.ok(dests.includes('d6'), 'captures enemy pawn on d6');
  assert.ok(!dests.includes('d7'), 'cannot slide past captured square');
  assert.ok(dests.includes('b4') && dests.includes('c4'));
  assert.ok(!dests.includes('a4'), 'cannot land on own piece');
});

test('bishop moves 4 diagonals one step plus 1 step straight forward only', () => {
  const white = placedState([{ at: 'd4', type: 'B', color: 'w' }], 'w');
  let sq = OukEngine.parseSquare('d4');
  let dests = destSet(OukEngine.generateBaseMoves(white, sq.rank, sq.file));
  assert.deepEqual(dests, ['c3', 'c5', 'd5', 'e3', 'e5'].sort());

  const black = placedState([{ at: 'd4', type: 'B', color: 'b' }], 'b');
  dests = destSet(OukEngine.generateBaseMoves(black, sq.rank, sq.file));
  assert.deepEqual(dests, ['c3', 'c5', 'd3', 'e3', 'e5'].sort());
});

test('queen moves exactly 1 step diagonally, 4 directions, no straight moves', () => {
  const state = placedState([{ at: 'd4', type: 'Q', color: 'w' }], 'w');
  const sq = OukEngine.parseSquare('d4');
  const dests = destSet(OukEngine.generateBaseMoves(state, sq.rank, sq.file));
  assert.deepEqual(dests, ['c3', 'c5', 'e3', 'e5'].sort());
});

test('knight jumps in L-shape over blocking pieces', () => {
  const state = placedState([
    { at: 'd4', type: 'N', color: 'w' },
    { at: 'd5', type: 'P', color: 'w' }, // adjacent piece must not block the jump
  ], 'w');
  const sq = OukEngine.parseSquare('d4');
  const dests = destSet(OukEngine.generateBaseMoves(state, sq.rank, sq.file));
  assert.deepEqual(dests, ['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5'].sort());
});

test('king moves exactly 1 step in any of 8 directions', () => {
  const state = placedState([{ at: 'd4', type: 'K', color: 'w' }], 'w');
  const sq = OukEngine.parseSquare('d4');
  const dests = destSet(OukEngine.generateBaseMoves(state, sq.rank, sq.file));
  assert.deepEqual(dests, ['c3', 'c4', 'c5', 'd3', 'd5', 'e3', 'e4', 'e5'].sort());
});

test('white pawn moves 1 forward, captures 1 diagonally forward, no double-step', () => {
  const state = placedState([
    { at: 'd4', type: 'P', color: 'w' },
    { at: 'e5', type: 'P', color: 'b' }, // diagonal capture target
    { at: 'd5', type: 'P', color: 'w' }, // own piece blocks forward move
  ], 'w');
  const sq = OukEngine.parseSquare('d4');
  const dests = destSet(OukEngine.generateBaseMoves(state, sq.rank, sq.file));
  assert.deepEqual(dests, ['e5'].sort(), 'forward blocked by own pawn, only diagonal capture available');
});

test('black pawn direction is mirrored', () => {
  const state = placedState([{ at: 'd5', type: 'P', color: 'b' }], 'b');
  const sq = OukEngine.parseSquare('d5');
  const dests = destSet(OukEngine.generateBaseMoves(state, sq.rank, sq.file));
  assert.deepEqual(dests, ['d4']);
});

test('pawn cannot capture straight ahead, only diagonally, and never backward', () => {
  const state = placedState([
    { at: 'd4', type: 'P', color: 'w' },
    { at: 'd5', type: 'P', color: 'b' }, // directly ahead: blocks, not capturable
  ], 'w');
  const sq = OukEngine.parseSquare('d4');
  const dests = destSet(OukEngine.generateBaseMoves(state, sq.rank, sq.file));
  assert.deepEqual(dests, []);
});

test('white pawn promotes to queen-moving piece on reaching rank 6 (opponent pawn start rank)', () => {
  const state = placedState([
    { at: 'd5', type: 'P', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'a1', type: 'K', color: 'w' },
  ], 'w');
  const sq = OukEngine.parseSquare('d5');
  const moves = OukEngine.generateBaseMoves(state, sq.rank, sq.file);
  const mv = moves.find((m) => OukEngine.squareName(m.to.rank, m.to.file) === 'd6');
  assert.equal(mv.special, 'promotion');

  const next = OukEngine.applyMove(state, mv);
  const promoted = OukEngine.pieceAt(next, 5, 3); // d6
  assert.equal(promoted.type, 'Q');
  assert.equal(promoted.color, 'w');
  const afterDests = destSet(OukEngine.generateBaseMoves(next, 5, 3));
  assert.deepEqual(afterDests, ['c5', 'c7', 'e5', 'e7'].sort(), 'promoted piece now moves like a queen');
});

test('black pawn promotes on reaching rank 3', () => {
  const state = placedState([
    { at: 'd4', type: 'P', color: 'b' },
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'a1', type: 'K', color: 'w' },
  ], 'b');
  const sq = OukEngine.parseSquare('d4');
  const mv = OukEngine.generateBaseMoves(state, sq.rank, sq.file)[0];
  assert.equal(OukEngine.squareName(mv.to.rank, mv.to.file), 'd3');
  assert.equal(mv.special, 'promotion');
});

test('applyMove flips turn, records capture, and tracks anyCaptureYet', () => {
  const state = placedState([
    { at: 'd4', type: 'R', color: 'w' },
    { at: 'd6', type: 'P', color: 'b' },
    { at: 'a1', type: 'K', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
  ], 'w');
  const sq = OukEngine.parseSquare('d4');
  const mv = OukEngine.generateBaseMoves(state, sq.rank, sq.file)
    .find((m) => OukEngine.squareName(m.to.rank, m.to.file) === 'd6');
  assert.equal(state.anyCaptureYet, false);
  const next = OukEngine.applyMove(state, mv);
  assert.equal(next.turn, 'b');
  assert.equal(next.anyCaptureYet, true);
  assert.equal(next.history.length, 1);
  assert.equal(OukEngine.pieceAt(next, 2, 3), null, 'origin square vacated');
  assert.equal(OukEngine.pieceAt(next, 5, 3).type, 'R');
  assert.equal(state.anyCaptureYet, false, 'original state untouched (immutable apply)');
});

test('isSquareAttacked detects rook attack along a clear file', () => {
  const state = placedState([{ at: 'd1', type: 'R', color: 'w' }], 'w');
  assert.equal(OukEngine.isSquareAttacked(state, 5, 3, 'w'), true); // d6
  assert.equal(OukEngine.isSquareAttacked(state, 5, 4, 'w'), false); // e6, off the file
});

test('isSquareAttacked for pawn only covers diagonal-forward squares, not the square ahead', () => {
  const state = placedState([{ at: 'd4', type: 'P', color: 'w' }], 'w');
  const ahead = OukEngine.parseSquare('d5');
  const diag = OukEngine.parseSquare('e5');
  assert.equal(OukEngine.isSquareAttacked(state, ahead.rank, ahead.file, 'w'), false);
  assert.equal(OukEngine.isSquareAttacked(state, diag.rank, diag.file, 'w'), true);
});

test('isInCheck is true when the king square is attacked', () => {
  const state = placedState([
    { at: 'e1', type: 'K', color: 'w' },
    { at: 'e8', type: 'R', color: 'b' },
    { at: 'a1', type: 'K', color: 'b' },
  ], 'w');
  assert.equal(OukEngine.isInCheck(state, 'w'), true);
});

test('generateLegalMoves excludes moves that leave own king in check (pin)', () => {
  const state = placedState([
    { at: 'e1', type: 'K', color: 'w' },
    { at: 'e4', type: 'R', color: 'w' }, // pinned: same file as king, enemy rook behind it
    { at: 'e8', type: 'R', color: 'b' },
    { at: 'a1', type: 'K', color: 'b' },
  ], 'w');
  const rookMoves = OukEngine.generateLegalMoves(state, 'w').filter((m) => m.piece.type === 'R');
  const dests = destSet(rookMoves);
  assert.ok(dests.every((d) => d[0] === 'e'), 'pinned rook restricted to the pinning file: ' + dests.join(','));
  assert.ok(dests.includes('e5') && dests.includes('e6') && dests.includes('e7'));
});

test('generateLegalMoves excludes king moves into check', () => {
  const state = placedState([
    { at: 'e1', type: 'K', color: 'w' },
    { at: 'd8', type: 'R', color: 'b' },
    { at: 'a1', type: 'K', color: 'b' },
  ], 'w');
  const kingMoves = OukEngine.generateLegalMoves(state, 'w').filter((m) => m.piece.type === 'K');
  const dests = destSet(kingMoves);
  assert.ok(!dests.includes('d1'), 'king may not step onto the attacked d-file square');
  assert.ok(!dests.includes('d2'));
});

test('deriveStatus detects checkmate: ladder mate with two rooks', () => {
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'h8', type: 'R', color: 'w' },
    { at: 'h7', type: 'R', color: 'w' },
    { at: 'h1', type: 'K', color: 'w' },
  ], 'b');
  assert.equal(OukEngine.isInCheck(state, 'b'), true);
  assert.equal(OukEngine.generateLegalMoves(state, 'b').length, 0);
  const status = OukEngine.deriveStatus(state);
  assert.equal(status.status, 'checkmate');
  assert.equal(status.winner, 'w');
});

test('deriveStatus detects stalemate as a draw (no winner)', () => {
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'c7', type: 'K', color: 'w' },
    { at: 'c6', type: 'N', color: 'w' },
  ], 'b');
  // Isolate this from the Task 6 king-jump first-move exception (tested on
  // its own below) so this fixture only has to cover the king's normal
  // 1-step moves.
  state.kingHasMoved.b = true;
  assert.equal(OukEngine.isInCheck(state, 'b'), false, 'must not be in check for a true stalemate test');
  assert.equal(OukEngine.generateLegalMoves(state, 'b').length, 0, 'no legal moves');
  const status = OukEngine.deriveStatus(state);
  assert.equal(status.status, 'stalemate');
  assert.equal(status.winner, null);
});

test('applyMove wires deriveStatus in automatically', () => {
  const state = placedState([
    { at: 'a1', type: 'K', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'h7', type: 'R', color: 'w' },
    { at: 'e8', type: 'R', color: 'w' },
  ], 'w');
  const mv = OukEngine.generateLegalMoves(state, 'w')
    .find((m) => m.piece.type === 'R' && OukEngine.squareName(m.from.rank, m.from.file) === 'e8' && OukEngine.squareName(m.to.rank, m.to.file) === 'h8');
  const next = OukEngine.applyMove(state, mv);
  assert.equal(next.status, 'checkmate');
  assert.equal(next.winner, 'w');
});

test('king may jump like a knight on its first move, pre-capture, not in check', () => {
  const state = placedState([
    { at: 'd1', type: 'K', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
  ], 'w');
  const sq = OukEngine.parseSquare('d1');
  const dests = destSet(OukEngine.generatePseudoMoves(state, sq.rank, sq.file));
  assert.ok(dests.includes('e3'), 'knight-jump destination available: ' + dests.join(','));
  assert.ok(dests.includes('c3'));
  assert.ok(dests.includes('c1') && dests.includes('d2') && dests.includes('e1'), 'normal king steps still present');
});

test('king jump unavailable once a capture has happened anywhere in the game', () => {
  const state = placedState([
    { at: 'd1', type: 'K', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
  ], 'w');
  state.anyCaptureYet = true;
  const sq = OukEngine.parseSquare('d1');
  const dests = destSet(OukEngine.generatePseudoMoves(state, sq.rank, sq.file));
  assert.ok(!dests.includes('e3') && !dests.includes('c3'), 'jump squares gone: ' + dests.join(','));
});

test('king jump unavailable once that king has already moved once', () => {
  const state = placedState([
    { at: 'd1', type: 'K', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
  ], 'w');
  state.kingHasMoved.w = true;
  const sq = OukEngine.parseSquare('d1');
  const dests = destSet(OukEngine.generatePseudoMoves(state, sq.rank, sq.file));
  assert.ok(!dests.includes('e3') && !dests.includes('c3'));
});

test('king jump unavailable while currently in check', () => {
  const state = placedState([
    { at: 'd1', type: 'K', color: 'w' },
    { at: 'd8', type: 'R', color: 'b' },
    { at: 'a8', type: 'K', color: 'b' },
  ], 'w');
  const sq = OukEngine.parseSquare('d1');
  assert.equal(OukEngine.isInCheck(state, 'w'), true);
  const dests = destSet(OukEngine.generatePseudoMoves(state, sq.rank, sq.file));
  assert.ok(!dests.includes('e3') && !dests.includes('c3'));
});

test('queen may advance 2 squares straight forward on her first move once the path is clear', () => {
  const state = placedState([
    { at: 'e1', type: 'Q', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'a1', type: 'K', color: 'w' },
  ], 'w');
  const sq = OukEngine.parseSquare('e1');
  const dests = destSet(OukEngine.generatePseudoMoves(state, sq.rank, sq.file));
  assert.ok(dests.includes('e3'), 'double-step available: ' + dests.join(','));
});

test('queen double-step blocked if either intermediate or destination square is occupied', () => {
  const state = placedState([
    { at: 'e1', type: 'Q', color: 'w' },
    { at: 'e3', type: 'P', color: 'w' }, // own pawn still sitting on the destination square
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'a1', type: 'K', color: 'w' },
  ], 'w');
  const sq = OukEngine.parseSquare('e1');
  const dests = destSet(OukEngine.generatePseudoMoves(state, sq.rank, sq.file));
  assert.ok(!dests.includes('e3'));
});

test('both first-move exceptions vanish permanently for both sides after any capture', () => {
  const state = placedState([
    { at: 'd1', type: 'K', color: 'w' },
    { at: 'd8', type: 'K', color: 'b' },
    { at: 'e8', type: 'Q', color: 'b' },
  ], 'w');
  state.anyCaptureYet = true;
  const wKingDests = destSet(OukEngine.generatePseudoMoves(state, 0, 3));
  assert.ok(!wKingDests.includes('e3') && !wKingDests.includes('c3'));
  const bQueenSq = OukEngine.parseSquare('e8');
  const bQueenDests = destSet(OukEngine.generatePseudoMoves(state, bQueenSq.rank, bQueenSq.file));
  assert.ok(!bQueenDests.includes('e6'), 'black queen (moving toward rank 1) double-step also gone: ' + bQueenDests.join(','));
});

test('materialTier matches the documented table', () => {
  const twoRooks = placedState([{ at: 'a1', type: 'R', color: 'w' }, { at: 'b1', type: 'R', color: 'w' }, { at: 'a8', type: 'K', color: 'w' }], 'w');
  assert.equal(OukEngine.materialTier(twoRooks, 'w').base, 8);

  const oneRook = placedState([{ at: 'a1', type: 'R', color: 'w' }, { at: 'a8', type: 'K', color: 'w' }], 'w');
  assert.equal(OukEngine.materialTier(oneRook, 'w').base, 16);

  const twoBishops = placedState([{ at: 'a1', type: 'B', color: 'w' }, { at: 'b1', type: 'B', color: 'w' }, { at: 'a8', type: 'K', color: 'w' }], 'w');
  assert.equal(OukEngine.materialTier(twoBishops, 'w').base, 22);

  const twoKnights = placedState([{ at: 'a1', type: 'N', color: 'w' }, { at: 'b1', type: 'N', color: 'w' }, { at: 'a8', type: 'K', color: 'w' }], 'w');
  assert.equal(OukEngine.materialTier(twoKnights, 'w').base, 32);

  const oneBishop = placedState([{ at: 'a1', type: 'B', color: 'w' }, { at: 'a8', type: 'K', color: 'w' }], 'w');
  assert.equal(OukEngine.materialTier(oneBishop, 'w').base, 44);

  const oneKnight = placedState([{ at: 'a1', type: 'N', color: 'w' }, { at: 'a8', type: 'K', color: 'w' }], 'w');
  assert.equal(OukEngine.materialTier(oneKnight, 'w').base, 64);

  const onlyQueen = placedState([{ at: 'a1', type: 'Q', color: 'w' }, { at: 'a8', type: 'K', color: 'w' }], 'w');
  assert.equal(OukEngine.materialTier(onlyQueen, 'w').base, 64);
});

test('bare-king trigger computes budget via the worked example from the source rules: two rooks and a knight vs lone king = 3 moves', () => {
  const state = placedState([
    { at: 'a1', type: 'K', color: 'w' },
    { at: 'a2', type: 'R', color: 'w' },
    { at: 'a3', type: 'R', color: 'w' },
    { at: 'a4', type: 'N', color: 'w' },
    { at: 'h8', type: 'K', color: 'b' },
  ], 'w');
  assert.equal(OukEngine.isBareKing(state, 'b'), true);
  assert.equal(OukEngine.countAllPieces(state), 5);
  const mv = OukEngine.generateLegalMoves(state, 'w').find((m) => m.piece.type === 'N');
  const next = OukEngine.applyMove(state, mv);
  assert.equal(next.counting.active, true);
  assert.equal(next.counting.trigger, 'bareKing');
  assert.equal(next.counting.disadvantagedColor, 'b');
  assert.equal(next.counting.tierBase, 8);
  assert.equal(next.counting.budget, 3, 'base 8 minus 5 total pieces = 3');
});

test('counting forces a draw if the budget elapses without checkmate', () => {
  let state = placedState([
    { at: 'a1', type: 'K', color: 'w' },
    { at: 'h1', type: 'N', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
  ], 'w');
  let guard = 0;
  while (state.status === 'active' && guard < 200) {
    const moves = OukEngine.generateLegalMoves(state, state.turn);
    const mv = moves[0];
    state = OukEngine.applyMove(state, mv);
    guard++;
  }
  assert.ok(state.status === 'draw-counting' || state.status === 'checkmate', 'game must terminate: ' + state.status + ' after ' + guard + ' plies');
});

test('hasPawns reflects whether a color has any unpromoted pawn on the board', () => {
  const state = placedState([{ at: 'a2', type: 'P', color: 'w' }, { at: 'a1', type: 'K', color: 'w' }, { at: 'a8', type: 'K', color: 'b' }], 'w');
  assert.equal(OukEngine.hasPawns(state, 'w'), true);
  assert.equal(OukEngine.hasPawns(state, 'b'), false);
});

function perft(state, depth) {
  if (depth === 0) return 1;
  const moves = OukEngine.generateLegalMoves(state, state.turn);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (let i = 0; i < moves.length; i++) {
    nodes += perft(OukEngine.applyMove(state, moves[i]), depth - 1);
  }
  return nodes;
}

test('perft depth 1 from the start position matches a hand count of every piece\'s moves', () => {
  const state = OukEngine.createInitialState();
  const moves = OukEngine.generateLegalMoves(state, 'w');
  // Hand count: 8 pawns (1 fwd step each) + 2 rooks (1 each, to a2/h2) +
  // 2 knights (1 each, to d2/e2) + 2 bishops (3 each: 2 diag + 1 fwd) +
  // queen (2 diag; double-step blocked by own pawn on e3) + king (3 normal
  // steps + 2 extra via the first-move knight-jump, to b2/f2, not in check)
  // = 8 + 2 + 2 + 6 + 2 + 5 = 25.
  assert.equal(moves.length, 25);
  assert.equal(moves.length, perft(state, 1));
});

test('perft depth 2 from the start position is a stable regression guard', () => {
  const state = OukEngine.createInitialState();
  const n2 = perft(state, 2);
  assert.equal(n2, 625);
});
