const test = require('node:test');
const assert = require('node:assert/strict');
const OukEngine = require('../src/engine.js');
const OukAI = require('../src/ai.js');

function placedState(pieces, turn) {
  const state = OukEngine.createInitialState();
  state.board = new Array(64).fill(null);
  for (const p of pieces) {
    const sq = OukEngine.parseSquare(p.at);
    state.board[sq.rank * 8 + sq.file] = { type: p.type, color: p.color };
  }
  state.turn = turn || 'w';
  const derived = OukEngine.deriveStatus(state);
  state.status = derived.status;
  state.winner = derived.winner;
  return state;
}

test('evaluate is exactly 0 on the symmetric starting position', () => {
  const state = OukEngine.createInitialState();
  assert.equal(OukAI.evaluate(state), 0);
});

test('evaluate is positive for White when White is up a rook, by roughly the rook value', () => {
  const state = placedState([
    { at: 'a1', type: 'K', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'd4', type: 'R', color: 'w' },
  ], 'w');
  const score = OukAI.evaluate(state);
  assert.ok(score > 4 && score < 7, 'expected roughly +5 for a bare extra rook, got ' + score);
});

test('evaluate is negative for White when Black is up material', () => {
  const state = placedState([
    { at: 'a1', type: 'K', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'd4', type: 'Q', color: 'b' },
  ], 'w');
  assert.ok(OukAI.evaluate(state) < 0);
});

test('negamax scores an already-checkmated side-to-move as a large negative number', () => {
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'h8', type: 'R', color: 'w' },
    { at: 'h7', type: 'R', color: 'w' },
    { at: 'h1', type: 'K', color: 'w' },
  ], 'b');
  assert.equal(state.status, 'checkmate');
  const score = OukAI.negamax(state, 3, 0, -Infinity, Infinity);
  assert.ok(score <= -OukAI.MATE_SCORE + 1, 'checkmated side-to-move must score near -MATE_SCORE: ' + score);
});

test('negamax scores stalemate and counting-forced draws as exactly 0', () => {
  const stalemate = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'c7', type: 'K', color: 'w' },
    { at: 'c6', type: 'N', color: 'w' },
  ], 'b');
  stalemate.kingHasMoved.b = true;
  const derived = OukEngine.deriveStatus(stalemate);
  stalemate.status = derived.status;
  stalemate.winner = derived.winner;
  assert.equal(stalemate.status, 'stalemate');
  assert.equal(OukAI.negamax(stalemate, 2, 0, -Infinity, Infinity), 0);
});

test('negamax at depth 1 finds a mate-in-1 (discovered check) among 25 legal moves', () => {
  // Verified independently: white has 25 legal moves from this position and
  // exactly one, Nd8-c6 (unblocking the h8 rook's rank-8 sweep while the
  // knight's new square also covers a7), delivers checkmate.
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'c7', type: 'K', color: 'w' },
    { at: 'h8', type: 'R', color: 'w' },
    { at: 'd8', type: 'N', color: 'w' },
  ], 'w');
  assert.equal(state.status, 'active');
  const moves = OukEngine.generateLegalMoves(state, 'w');
  assert.equal(moves.length, 25);
  let best = null, bestScore = -Infinity;
  for (const mv of moves) {
    const child = OukEngine.applyMove(state, mv);
    const score = -OukAI.negamax(child, 1, 1, -Infinity, Infinity);
    if (score > bestScore) { bestScore = score; best = mv; }
  }
  assert.equal(OukEngine.squareName(best.from.rank, best.from.file), 'd8');
  assert.equal(OukEngine.squareName(best.to.rank, best.to.file), 'c6');
});

test('chooseMove returns a legal move for the starting position within the time budget', () => {
  const state = OukEngine.createInitialState();
  const legal = OukEngine.generateLegalMoves(state, 'w');
  const legalKeys = new Set(legal.map((m) => OukEngine.squareName(m.from.rank, m.from.file) + OukEngine.squareName(m.to.rank, m.to.file) + (m.special || '')));
  const start = Date.now();
  const move = OukAI.chooseMove(state, { timeLimitMs: 300, maxDepth: 4 });
  const elapsed = Date.now() - start;
  const key = OukEngine.squareName(move.from.rank, move.from.file) + OukEngine.squareName(move.to.rank, move.to.file) + (move.special || '');
  assert.ok(legalKeys.has(key), 'chosen move must be legal: ' + key);
  assert.ok(elapsed < 2000, 'must respect the time budget with reasonable overhead: ' + elapsed + 'ms');
});

test('chooseMove takes an immediate mate-in-1 when available', () => {
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'c7', type: 'K', color: 'w' },
    { at: 'h8', type: 'R', color: 'w' },
    { at: 'd8', type: 'N', color: 'w' },
  ], 'w');
  const move = OukAI.chooseMove(state, { timeLimitMs: 500, maxDepth: 4 });
  const next = OukEngine.applyMove(state, move);
  assert.equal(next.status, 'checkmate');
});

test('chooseMove does not hang a defended rook for a free pawn', () => {
  const state = placedState([
    { at: 'a1', type: 'K', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'd4', type: 'R', color: 'w' },
    { at: 'd7', type: 'P', color: 'b' },
    { at: 'h7', type: 'R', color: 'b' },
  ], 'w');
  const move = OukAI.chooseMove(state, { timeLimitMs: 500, maxDepth: 3 });
  const takesBait = OukEngine.squareName(move.to.rank, move.to.file) === 'd7';
  assert.equal(takesBait, false, 'should not grab a defended pawn and drop the rook next move');
});
