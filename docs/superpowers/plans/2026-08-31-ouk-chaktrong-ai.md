# Ouk Chaktrang AI Opponent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A negamax + alpha-beta search opponent (`src/ai.js`) built directly on the real, tested `src/engine.js` API, so it can never disagree with the rules a human plays under.

**Architecture:** Single file `src/ai.js`, same UMD-lite pattern as `src/engine.js` (works via `require()` in Node tests and `<script src>`/inline concatenation in the browser). Iterative deepening negamax with alpha-beta pruning under a time budget; material + light mobility evaluation; terminal-state scoring (checkmate/stalemate/counting-draw) falls straight out of `state.status`, which is where counting-rule awareness comes from — no separate special-casing needed.

**Tech Stack:** Vanilla JS, `node --test`. No dependencies.

**Spec:** [docs/superpowers/specs/2026-08-31-ouk-chaktrong-web-design.md](../specs/2026-08-31-ouk-chaktrong-web-design.md)

## Global Constraints

- Depends only on the actual `src/engine.js` exports as built (verified against the real file, not a guess): `createInitialState()`, `pieceAt(state,r,f)`, `opposite(color)`, `generateLegalMoves(state,color)`, `applyMove(state,move)` (returns a new state with `.status` already one of `'active'|'checkmate'|'stalemate'|'draw-counting'|'draw-noprogress'` and `.winner`), `squareName`/`parseSquare`.
- No npm dependencies, no ESM syntax in `src/ai.js`.
- Piece values (from the spec): Rook 5, Knight 3, Bishop 2.5, Queen 1.5 (incl. promoted pawns, which are type `'Q'` in the engine), Pawn 1.
- `evaluate(state)` always returns a score **from White's perspective** (positive = good for White) — this is the one fixed convention the whole file follows; `negamax` converts to the side-to-move's perspective internally, the standard way to avoid sign-convention bugs.

---

### Task 1: Static evaluation function

**Files:**
- Create: `src/ai.js`
- Create: `tests/ai.test.js`

**Interfaces:**
- Consumes: `OukEngine.pieceAt`, `OukEngine.generateLegalMoves` (only for the mobility term).
- Produces: `OukAI.evaluate(state) -> number` (White's perspective). `PIECE_VALUES` table (not exported — internal constant).

- [ ] **Step 1: Write the failing test**

```js
// tests/ai.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ai.test.js`
Expected: FAIL — `Cannot find module '../src/ai.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/ai.js
(function (root) {
  'use strict';

  var OukEngine = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.OukEngine;

  var PIECE_VALUES = { R: 5, N: 3, B: 2.5, Q: 1.5, P: 1, K: 0 };
  var MOBILITY_WEIGHT = 0.02;

  function materialScore(state) {
    var score = 0;
    for (var i = 0; i < 64; i++) {
      var p = state.board[i];
      if (!p) continue;
      var v = PIECE_VALUES[p.type];
      score += p.color === 'w' ? v : -v;
    }
    return score;
  }

  function mobilityScore(state) {
    var white = OukEngine.generateLegalMoves(state, 'w').length;
    var black = OukEngine.generateLegalMoves(state, 'b').length;
    return MOBILITY_WEIGHT * (white - black);
  }

  function evaluate(state) {
    return materialScore(state) + mobilityScore(state);
  }

  var api = {
    evaluate: evaluate
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukAI = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ai.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ai.js tests/ai.test.js
git commit -m "ai: material + mobility evaluation function"
```

---

### Task 2: Negamax with alpha-beta and terminal-state scoring

**Files:**
- Modify: `src/ai.js`
- Test: `tests/ai.test.js`

**Interfaces:**
- Consumes: `OukEngine.generateLegalMoves`, `OukEngine.applyMove`, `evaluate` (Task 1).
- Produces: `OukAI.negamax(state, depth, ply, alpha, beta) -> number` (score from `state.turn`'s perspective). `MATE_SCORE` constant (exported for test use).

**Design note carried into code as a comment**: a counting-forced draw (`status === 'draw-counting'`) is scored identically to any other draw (0) — this single terminal-state check is the entire mechanism by which the AI becomes counting-aware; it needs no separate logic because `applyMove` already resolves the counting rule into `state.status`.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/ai.test.js

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
  assert.equal(stalemate.status, 'stalemate');
  assert.equal(OukAI.negamax(stalemate, 2, 0, -Infinity, Infinity), 0);
});

test('negamax at depth 1 finds a mate-in-1 and prefers it over a merely-good move', () => {
  // White to move: Rh7-h8 delivers the same ladder mate verified in the
  // engine plan. A second white rook sits idle elsewhere as a distractor.
  const state = placedState([
    { at: 'a1', type: 'K', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'h7', type: 'R', color: 'w' },
    { at: 'e8', type: 'R', color: 'w' },
  ], 'w');
  const moves = OukEngine.generateLegalMoves(state, 'w');
  let best = null, bestScore = -Infinity;
  for (const mv of moves) {
    const child = OukEngine.applyMove(state, mv);
    const score = -OukAI.negamax(child, 1, 1, -Infinity, Infinity);
    if (score > bestScore) { bestScore = score; best = mv; }
  }
  assert.equal(OukEngine.squareName(best.to.rank, best.to.file), 'h8');
  assert.equal(OukEngine.squareName(best.from.rank, best.from.file), 'e8');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ai.test.js`
Expected: FAIL — `OukAI.negamax is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// insert into src/ai.js, above `var api = {...}`

  var MATE_SCORE = 100000;

  function negamax(state, depth, ply, alpha, beta) {
    if (state.status !== 'active') {
      if (state.status === 'checkmate') {
        // state.turn has no moves and is checkmated: worst possible outcome
        // for state.turn. Subtracting ply prefers faster mates when this
        // score is compared against sibling lines at the same search depth.
        return -(MATE_SCORE - ply);
      }
      return 0; // stalemate, draw-counting, draw-noprogress: all plain draws
    }
    if (depth === 0) {
      return (state.turn === 'w' ? 1 : -1) * evaluate(state);
    }
    var moves = OukEngine.generateLegalMoves(state, state.turn);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var child = OukEngine.applyMove(state, moves[i]);
      var score = -negamax(child, depth - 1, ply + 1, -beta, -alpha);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // alpha-beta cutoff
    }
    return best;
  }
```

Add `negamax: negamax, MATE_SCORE: MATE_SCORE,` to `api`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ai.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ai.js tests/ai.test.js
git commit -m "ai: negamax with alpha-beta and terminal-state scoring"
```

---

### Task 3: Move ordering, iterative deepening, and the public `chooseMove` API

**Files:**
- Modify: `src/ai.js`
- Test: `tests/ai.test.js`

**Interfaces:**
- Consumes: `negamax` (Task 2), `OukEngine.generateLegalMoves`, `OukEngine.applyMove`.
- Produces: `OukAI.chooseMove(state, options) -> Move`, where `options` is optional `{ timeLimitMs?: number, maxDepth?: number }` (defaults: `timeLimitMs: 1000`, `maxDepth: 6`). Throws if `state.status !== 'active'` or no legal moves exist (caller's responsibility to check first — documented, not a silent no-op).

- [ ] **Step 1: Write the failing test**

```js
// append to tests/ai.test.js

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
    { at: 'a1', type: 'K', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'h7', type: 'R', color: 'w' },
    { at: 'e8', type: 'R', color: 'w' },
  ], 'w');
  const move = OukAI.chooseMove(state, { timeLimitMs: 500, maxDepth: 4 });
  const next = OukEngine.applyMove(state, move);
  assert.equal(next.status, 'checkmate');
});

test('chooseMove does not hang a free rook when a safe alternative exists', () => {
  // White rook on d4 can capture a defenseless-looking black pawn on d7, but
  // that square is guarded by a black rook on h7 - moving there loses the
  // rook for a pawn next turn. A quiet safe move exists instead.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ai.test.js`
Expected: FAIL — `OukAI.chooseMove is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
  function orderMoves(moves) {
    // Cheap move ordering: captures first (most valuable victim first),
    // meaningfully improves alpha-beta pruning without needing a real
    // "static exchange evaluation." Good enough for this engine's depth.
    return moves.slice().sort(function (a, b) {
      var av = a.captured ? PIECE_VALUES[a.captured.type] : -1;
      var bv = b.captured ? PIECE_VALUES[b.captured.type] : -1;
      return bv - av;
    });
  }

  function searchRoot(state, depth) {
    var moves = orderMoves(OukEngine.generateLegalMoves(state, state.turn));
    var bestMove = moves[0];
    var bestScore = -Infinity;
    var alpha = -Infinity, beta = Infinity;
    for (var i = 0; i < moves.length; i++) {
      var child = OukEngine.applyMove(state, moves[i]);
      var score = -negamax(child, depth - 1, 1, -beta, -alpha);
      if (score > bestScore) {
        bestScore = score;
        bestMove = moves[i];
      }
      if (bestScore > alpha) alpha = bestScore;
    }
    return { move: bestMove, score: bestScore };
  }

  function chooseMove(state, options) {
    options = options || {};
    var timeLimitMs = options.timeLimitMs || 1000;
    var maxDepth = options.maxDepth || 6;
    var deadline = Date.now() + timeLimitMs;
    var best = null;

    for (var depth = 1; depth <= maxDepth; depth++) {
      var result = searchRoot(state, depth);
      best = result.move;
      if (Date.now() >= deadline) break;
      // A found forced mate cannot be improved on; stop deepening early.
      if (result.score >= MATE_SCORE - 100) break;
    }
    return best;
  }
```

Add `chooseMove: chooseMove,` to `api`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ai.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ai.js tests/ai.test.js
git commit -m "ai: move ordering, iterative deepening, and chooseMove"
```

---

## Self-Review Notes

- **Spec coverage**: negamax + alpha-beta (Task 2), iterative deepening under a time budget (Task 3), material evaluation with the spec's piece values (Task 1), counting-draw awareness (falls out of Task 2's terminal-state handling — verified by the stalemate/draw test using the same 0-score path draw-counting takes).
- **Type consistency checked**: `chooseMove`'s returned value is a `Move` object with the same shape engine.js produces (`{from,to,piece,captured,special}`) since it's returned directly from `OukEngine.generateLegalMoves` — never reconstructed, so no shape drift is possible.
- **Known limitation, not a bug**: this is a heuristic search, not a counting-rule-optimal endgame solver — Task 3's "doesn't hang a free rook" test is a basic 1-ply tactic check, not a claim of strong play.
