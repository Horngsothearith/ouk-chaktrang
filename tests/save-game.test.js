const test = require('node:test');
const assert = require('node:assert/strict');
const OukEngine = require('../src/engine.js');

test('serializeGame and deserializeGame round-trip from initial state', () => {
  const state = OukEngine.createInitialState();
  const serialized = OukEngine.serializeGame(state, {
    name: 'Opening Test',
    mode: 'vs-ai',
    aiColor: 'b',
    difficulty: 'hard'
  });

  assert.equal(serialized.version, 1);
  assert.equal(serialized.format, 'ouk-chaktrong');
  assert.equal(serialized.name, 'Opening Test');
  assert.equal(serialized.mode, 'vs-ai');
  assert.equal(serialized.difficulty, 'hard');
  assert.equal(serialized.moves.length, 0);
  assert.equal(serialized.plyCount, 0);

  const restored = OukEngine.deserializeGame(serialized);
  assert.equal(restored.gameState.turn, 'w');
  assert.equal(restored.gameState.history.length, 0);
  assert.equal(restored.gameState.status, 'active');
  assert.equal(restored.metadata.name, 'Opening Test');
  assert.equal(restored.metadata.mode, 'vs-ai');
});

test('serializeGame and deserializeGame round-trip with multiple plies and captures', () => {
  let state = OukEngine.createInitialState();

  // 1. e3-e4 (pawn)
  const legals1 = OukEngine.generateLegalMoves(state, 'w');
  const e3e4 = legals1.find(m => OukEngine.squareName(m.from.rank, m.from.file) === 'e3' && OukEngine.squareName(m.to.rank, m.to.file) === 'e4');
  assert.ok(e3e4);
  state = OukEngine.applyMove(state, e3e4);

  // 1... d6-d5 (pawn)
  const legals2 = OukEngine.generateLegalMoves(state, 'b');
  const d6d5 = legals2.find(m => OukEngine.squareName(m.from.rank, m.from.file) === 'd6' && OukEngine.squareName(m.to.rank, m.to.file) === 'd5');
  assert.ok(d6d5);
  state = OukEngine.applyMove(state, d6d5);

  // 2. e4xd5 (capture)
  const legals3 = OukEngine.generateLegalMoves(state, 'w');
  const e4d5 = legals3.find(m => OukEngine.squareName(m.from.rank, m.from.file) === 'e4' && OukEngine.squareName(m.to.rank, m.to.file) === 'd5');
  assert.ok(e4d5);
  state = OukEngine.applyMove(state, e4d5);

  const serialized = OukEngine.serializeGame(state, {
    name: 'Capture Game',
    moveReviews: { 0: { comment: 'Good move' } }
  });

  assert.equal(serialized.moves.length, 3);
  assert.equal(serialized.notation, '1. e3-e4 d6-d5 2. e4xd5');
  assert.deepEqual(serialized.moveReviews, { 0: { comment: 'Good move' } });

  // Deserialize from JSON string
  const jsonString = JSON.stringify(serialized);
  const restored = OukEngine.deserializeGame(jsonString);

  assert.equal(restored.gameState.history.length, 3);
  assert.equal(restored.gameState.turn, 'b');
  assert.equal(restored.gameState.anyCaptureYet, true);
  assert.equal(restored.metadata.name, 'Capture Game');
  assert.deepEqual(restored.metadata.moveReviews, { 0: { comment: 'Good move' } });
});

test('serializeGame and deserializeGame preserve special moves (King jump, Queen 2-step, Promotion)', () => {
  let state = OukEngine.createInitialState();

  // King Jump: d1 to b2
  const legals1 = OukEngine.generateLegalMoves(state, 'w');
  const kingJump = legals1.find(m => m.special === 'kingJump' && OukEngine.squareName(m.to.rank, m.to.file) === 'b2');
  assert.ok(kingJump);
  state = OukEngine.applyMove(state, kingJump);

  // Black pawn move: e6-e5
  const legals2 = OukEngine.generateLegalMoves(state, 'b');
  const e6e5 = legals2.find(m => OukEngine.squareName(m.from.rank, m.from.file) === 'e6' && OukEngine.squareName(m.to.rank, m.to.file) === 'e5');
  assert.ok(e6e5);
  state = OukEngine.applyMove(state, e6e5);

  const serialized = OukEngine.serializeGame(state);
  assert.equal(serialized.moves[0].special, 'kingJump');

  const restored = OukEngine.deserializeGame(serialized);
  assert.equal(restored.gameState.history[0].special, 'kingJump');
  assert.equal(restored.gameState.kingHasMoved.w, true);
});

test('deserializeGame rejects illegal moves with descriptive error', () => {
  const invalidData = {
    version: 1,
    moves: [
      { from: 'a1', to: 'a5' } // Rook cannot move through own pawns on a3!
    ]
  };

  assert.throws(() => {
    OukEngine.deserializeGame(invalidData);
  }, /Illegal move at ply 1: a1-a5/);
});

test('deserializeGame rejects malformed JSON or move formats', () => {
  assert.throws(() => {
    OukEngine.deserializeGame('{ invalid json');
  }, /Invalid JSON format/);

  assert.throws(() => {
    OukEngine.deserializeGame({ moves: 'not an array' });
  }, /Game moves must be an array/);
});

test('deserializeGame supports string array notation moves', () => {
  const data = {
    version: 1,
    moves: ['e3-e4', 'd6-d5', 'e4xd5']
  };

  const restored = OukEngine.deserializeGame(data);
  assert.equal(restored.gameState.history.length, 3);
  assert.equal(restored.gameState.turn, 'b');
  assert.equal(restored.gameState.anyCaptureYet, true);
});

test('serializeGame and deserializeGame preserve Queen 2-step and Promotion', () => {
  let state = OukEngine.createInitialState();

  // White moves pawn e3-e4 to open way for Queen
  const e3e4 = OukEngine.generateLegalMoves(state, 'w').find(m => OukEngine.squareName(m.from.rank, m.from.file) === 'e3' && OukEngine.squareName(m.to.rank, m.to.file) === 'e4');
  state = OukEngine.applyMove(state, e3e4);

  // Black moves pawn a6-a5
  const a6a5 = OukEngine.generateLegalMoves(state, 'b').find(m => OukEngine.squareName(m.from.rank, m.from.file) === 'a6' && OukEngine.squareName(m.to.rank, m.to.file) === 'a5');
  state = OukEngine.applyMove(state, a6a5);

  // White Queen makes 2-step jump e1 to e3
  const qDouble = OukEngine.generateLegalMoves(state, 'w').find(m => m.special === 'queenDoubleStep');
  assert.ok(qDouble, 'Queen 2-step must be legal');
  state = OukEngine.applyMove(state, qDouble);

  const serialized = OukEngine.serializeGame(state);
  assert.equal(serialized.moves[2].special, 'queenDoubleStep');

  const restored = OukEngine.deserializeGame(serialized);
  assert.equal(restored.gameState.history[2].special, 'queenDoubleStep');
  assert.equal(restored.gameState.queenHasMoved.w, true);
});

test('serializeGame and deserializeGame preserve bareKing counting state', () => {
  const state = OukEngine.createInitialState();
  state.board = new Array(64).fill(null);
  const wR1 = OukEngine.parseSquare('a1');
  const wR2 = OukEngine.parseSquare('a2');
  const wK = OukEngine.parseSquare('d1');
  const bK = OukEngine.parseSquare('h8');
  state.board[wR1.rank * 8 + wR1.file] = { type: 'R', color: 'w' };
  state.board[wR2.rank * 8 + wR2.file] = { type: 'R', color: 'w' };
  state.board[wK.rank * 8 + wK.file] = { type: 'K', color: 'w' };
  state.board[bK.rank * 8 + bK.file] = { type: 'K', color: 'b' };
  state.turn = 'w';

  // Apply a rook move to trigger bare king counting
  const legals = OukEngine.generateLegalMoves(state, 'w');
  const mv = legals.find(m => m.piece.type === 'R' && OukEngine.squareName(m.from.rank, m.from.file) === 'a2' && OukEngine.squareName(m.to.rank, m.to.file) === 'a3');
  const countedState = OukEngine.applyMove(state, mv);

  assert.equal(countedState.counting.active, true);
  assert.equal(countedState.counting.trigger, 'bareKing');

  const serialized = OukEngine.serializeGame(countedState);
  assert.equal(serialized.moves.length, 1);
});

test('exportMoveNotation formats move pairs properly', () => {
  assert.equal(OukEngine.exportMoveNotation([]), '');

  let state = OukEngine.createInitialState();
  const legals1 = OukEngine.generateLegalMoves(state, 'w');
  const e3e4 = legals1.find(m => OukEngine.squareName(m.from.rank, m.from.file) === 'e3' && OukEngine.squareName(m.to.rank, m.to.file) === 'e4');
  state = OukEngine.applyMove(state, e3e4);

  assert.equal(OukEngine.exportMoveNotation(state.history), '1. e3-e4');
});


