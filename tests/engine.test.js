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
