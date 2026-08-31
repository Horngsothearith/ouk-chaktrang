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
