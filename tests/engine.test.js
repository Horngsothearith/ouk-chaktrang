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
