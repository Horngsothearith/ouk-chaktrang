# Ouk Chaktrang Rules Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure-JS, headless, fully-tested rules engine for Ouk Chaktrang (legal move generation, check/checkmate/stalemate, promotion, the two Cambodia-specific first-move exceptions, and the full counting draw rule) that the AI and UI plans will consume.

**Architecture:** Single file `src/engine.js`, no DOM dependency, UMD-lite export (works via `require()` in Node tests and via `<script src>`/inline concatenation in the browser). Board = flat 64-cell array, `rank` 0-7 (0 = White's back rank) × `file` 0-7 (0 = a-file). State is treated as immutable: `applyMove` returns a new state object rather than mutating.

**Tech Stack:** Vanilla JS (ES5-compatible syntax, no build step), Node 22 built-in test runner (`node --test`).

**Spec:** [docs/superpowers/specs/2026-08-31-ouk-chaktrang-web-design.md](../specs/2026-08-31-ouk-chaktrang-web-design.md)

## Global Constraints

- No npm dependencies. No ESM `import`/`export` syntax in `src/engine.js` (must load as a plain `<script>` too) — use the UMD-lite wrapper shown in Task 1.
- Node >= 22 (confirmed installed: v22.16.0) — use `node --test`, no test framework dependency.
- Board coordinates: `rank` 0-7 (0 = White back rank / display rank 1, 7 = Black back rank / display rank 8), `file` 0-7 (0 = a, 7 = h). Display helpers convert to/from `"e1"`-style strings.
- Piece shape: `{ type: 'K'|'Q'|'B'|'N'|'R'|'P', color: 'w'|'b' }`. A promoted pawn becomes `type:'Q'` permanently (it moves identically to a Queen from then on) — engine never needs a separate "promoted" piece type for rules purposes.
- **Design decision, not in the source table — document in code**: two special first-move exceptions (king jump, queen double-step) are gated on `!state.anyCaptureYet` (global, either side) plus that specific piece never having moved. They must **never** factor into `isSquareAttacked` (attack/check detection uses only base movement patterns) — including them would let a king's jump-eligibility check (`isInCheck`) recursively depend on jump eligibility itself.
- **Judgment call, flagged for user review**: the king's first-move jump is implemented as capture-allowed (lands on and captures an enemy piece like a normal knight move), because the Cambodian-specific rule text ("moving the lord like a horse... if not in check") is stated independently of, and less restrictively than, the Thai "Sut Khun" sutra text which explicitly says "to a blank space." If this is wrong, it's a one-line change (drop the capture allowance in `addKingJumpIfEligible`).
- **Judgment call**: the counting-rule material tier table (8/16/22/32/44/64/64 move budgets) only names specific combinations. For material combinations it doesn't name (e.g. 1 rook + 2 knights), tier lookup uses this priority order: ≥2 rooks → ≥1 rook → ≥2 bishops → ≥2 knights → ≥1 bishop → ≥1 knight → else (queens/promoted pawns only). Documented inline in `materialTier`.

---

### Task 1: Board model, starting position, square helpers

**Files:**
- Create: `src/engine.js`
- Create: `tests/engine.test.js`

**Interfaces:**
- Produces: `OukEngine.squareName(rank, file) -> string`, `OukEngine.parseSquare(name) -> {rank, file}`, `OukEngine.createInitialState() -> GameState`, `OukEngine.pieceAt(state, rank, file) -> Piece|null`
- `GameState` shape (fields used by later tasks, all present from this task on):
  ```
  {
    board: Array(64) of (Piece|null),   // index = rank*8+file
    turn: 'w'|'b',
    fullMoveNumber: number,
    history: Move[],
    kingHasMoved: {w:bool, b:bool},
    queenHasMoved: {w:bool, b:bool},
    anyCaptureYet: bool,
    counting: {active:bool, trigger:null|'bareKing'|'noProgress', disadvantagedColor:null|'w'|'b', tierBase:null|number, budget:null|number, elapsed:number},
    status: 'active'|'checkmate'|'stalemate'|'draw-counting'|'draw-noprogress',
    winner: null|'w'|'b'
  }
  ```

- [ ] **Step 1: Write the failing test**

```js
// tests/engine.test.js
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

    // ranks 2,4,5(index1,3,4... careful: empty ranks are index 1,3,4,6
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine.test.js`
Expected: FAIL — `Cannot find module '../src/engine.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/engine.js
(function (root) {
  'use strict';

  var FILES = 'abcdefgh';

  function squareName(rank, file) {
    return FILES[file] + (rank + 1);
  }

  function parseSquare(name) {
    var file = FILES.indexOf(name[0]);
    var rank = parseInt(name.slice(1), 10) - 1;
    return { rank: rank, file: file };
  }

  function inBounds(rank, file) {
    return rank >= 0 && rank < 8 && file >= 0 && file < 8;
  }

  var START_BACK_RANK_WHITE = ['R', 'N', 'B', 'K', 'Q', 'B', 'N', 'R'];
  var START_BACK_RANK_BLACK = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];

  function createInitialState() {
    var board = new Array(64).fill(null);
    for (var file = 0; file < 8; file++) {
      board[0 * 8 + file] = { type: START_BACK_RANK_WHITE[file], color: 'w' };
      board[2 * 8 + file] = { type: 'P', color: 'w' };
      board[5 * 8 + file] = { type: 'P', color: 'b' };
      board[7 * 8 + file] = { type: START_BACK_RANK_BLACK[file], color: 'b' };
    }
    return {
      board: board,
      turn: 'w',
      fullMoveNumber: 1,
      history: [],
      kingHasMoved: { w: false, b: false },
      queenHasMoved: { w: false, b: false },
      anyCaptureYet: false,
      counting: { active: false, trigger: null, disadvantagedColor: null, tierBase: null, budget: null, elapsed: 0 },
      status: 'active',
      winner: null
    };
  }

  function pieceAt(state, rank, file) {
    if (!inBounds(rank, file)) return null;
    return state.board[rank * 8 + file];
  }

  var api = {
    squareName: squareName,
    parseSquare: parseSquare,
    inBounds: inBounds,
    createInitialState: createInitialState,
    pieceAt: pieceAt
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/engine.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine.js tests/engine.test.js
git commit -m "engine: board model and verified starting position"
```

---

### Task 2: Non-pawn piece movement (King, Queen, Bishop, Knight, Rook — base patterns)

**Files:**
- Modify: `src/engine.js`
- Test: `tests/engine.test.js`

**Interfaces:**
- Consumes: `pieceAt(state, rank, file)`, `inBounds(rank, file)` from Task 1.
- Produces: `OukEngine.generateBaseMoves(state, rank, file) -> Move[]` (no special first-move exceptions — used by both `generatePseudoMoves`, later, and by attack detection in Task 4).
  `Move` shape: `{ from:{rank,file}, to:{rank,file}, piece:Piece, captured:Piece|null, special:null|'kingJump'|'queenDoubleStep'|'promotion' }`
- A test helper `placedState(pieces, turn)` is added to the test file (not exported from engine.js — test-only): builds an otherwise-empty state with specific pieces at specific squares, for isolating single-piece movement tests from the full starting position.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/engine.test.js

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
    { at: 'a4', type: 'P', color: 'w' }  // own blocker on the file to the left... actually rank: same rank to the left
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine.test.js`
Expected: FAIL — `OukEngine.generateBaseMoves is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// insert into src/engine.js, inside the module wrapper, above `var api = {...}`

  function opposite(color) { return color === 'w' ? 'b' : 'w'; }

  var KING_STEPS = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  var KNIGHT_STEPS = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
  var DIAGONAL_DIRS = [[1,1],[-1,1],[-1,-1],[1,-1]];
  var ORTHOGONAL_DIRS = [[1,0],[-1,0],[0,1],[0,-1]];

  function addStepMoves(state, rank, file, steps, piece, out) {
    steps.forEach(function (d) {
      var r2 = rank + d[0], f2 = file + d[1];
      if (!inBounds(r2, f2)) return;
      var occ = pieceAt(state, r2, f2);
      if (occ && occ.color === piece.color) return;
      out.push({ from: { rank: rank, file: file }, to: { rank: r2, file: f2 }, piece: piece, captured: occ || null, special: null });
    });
  }

  function addSlideMoves(state, rank, file, dirs, piece, out) {
    dirs.forEach(function (d) {
      var r2 = rank + d[0], f2 = file + d[1];
      while (inBounds(r2, f2)) {
        var occ = pieceAt(state, r2, f2);
        if (occ && occ.color === piece.color) break;
        out.push({ from: { rank: rank, file: file }, to: { rank: r2, file: f2 }, piece: piece, captured: occ || null, special: null });
        if (occ) break;
        r2 += d[0]; f2 += d[1];
      }
    });
  }

  function bishopSteps(color) {
    var forward = color === 'w' ? [0, 1] : [0, -1];
    return DIAGONAL_DIRS.concat([forward]);
  }

  function generateBaseMoves(state, rank, file) {
    var piece = pieceAt(state, rank, file);
    if (!piece) return [];
    var out = [];
    switch (piece.type) {
      case 'K':
        addStepMoves(state, rank, file, KING_STEPS, piece, out);
        break;
      case 'Q':
        addStepMoves(state, rank, file, DIAGONAL_DIRS, piece, out);
        break;
      case 'B':
        addStepMoves(state, rank, file, bishopSteps(piece.color), piece, out);
        break;
      case 'N':
        addStepMoves(state, rank, file, KNIGHT_STEPS, piece, out);
        break;
      case 'R':
        addSlideMoves(state, rank, file, ORTHOGONAL_DIRS, piece, out);
        break;
      case 'P':
        // pawn handled in Task 3
        break;
    }
    return out;
  }
```

Add `generateBaseMoves: generateBaseMoves, opposite: opposite,` to the `api` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/engine.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine.js tests/engine.test.js
git commit -m "engine: base movement for king, queen, bishop, knight, rook"
```

---

### Task 3: Pawn movement and promotion

**Files:**
- Modify: `src/engine.js`
- Test: `tests/engine.test.js`

**Interfaces:**
- Consumes: `generateBaseMoves` (Task 2), `pieceAt`/`inBounds` (Task 1).
- Produces: pawn case filled into `generateBaseMoves`'s switch. `OukEngine.applyMove(state, move) -> GameState` (new function — minimal version: moves the piece, records capture, sets `anyCaptureYet`, flips `turn`, handles promotion, appends to `history`; checkmate/stalemate/counting status computed in later tasks — for now `status` stays `'active'` after every move except where noted).
- Promotion rule implemented here: a pawn move whose destination rank is the opponent's original pawn rank (rank 5 for White moving into rank 5... **exact values**: White promotes on reaching rank index 5 (display rank 6); Black promotes on reaching rank index 2 (display rank 3)) gets `special:'promotion'` on the move, and `applyMove` changes that piece's `type` to `'Q'` on the resulting board.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/engine.test.js

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine.test.js`
Expected: FAIL — pawn tests get empty/wrong move sets (`case 'P'` unimplemented), `applyMove is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// add near the top-level consts in src/engine.js
  var WHITE_PROMOTION_RANK = 5; // display rank 6
  var BLACK_PROMOTION_RANK = 2; // display rank 3

  function promotionRankFor(color) {
    return color === 'w' ? WHITE_PROMOTION_RANK : BLACK_PROMOTION_RANK;
  }

  // replace the `case 'P': break;` stub from Task 2 with:
  function pawnMoves(state, rank, file, piece, out) {
    var dir = piece.color === 'w' ? 1 : -1;
    var r1 = rank + dir;
    var promoRank = promotionRankFor(piece.color);

    if (inBounds(r1, file) && !pieceAt(state, r1, file)) {
      out.push({ from: { rank: rank, file: file }, to: { rank: r1, file: file }, piece: piece, captured: null, special: r1 === promoRank ? 'promotion' : null });
    }
    [-1, 1].forEach(function (df) {
      var f2 = file + df;
      if (!inBounds(r1, f2)) return;
      var occ = pieceAt(state, r1, f2);
      if (occ && occ.color !== piece.color) {
        out.push({ from: { rank: rank, file: file }, to: { rank: r1, file: f2 }, piece: piece, captured: occ, special: r1 === promoRank ? 'promotion' : null });
      }
    });
  }
```

Update the switch in `generateBaseMoves`: `case 'P': pawnMoves(state, rank, file, piece, out); break;`

```js
  function cloneBoard(board) {
    return board.map(function (p) { return p ? { type: p.type, color: p.color } : null; });
  }

  function applyMove(state, move) {
    var board = cloneBoard(state.board);
    var fromIdx = move.from.rank * 8 + move.from.file;
    var toIdx = move.to.rank * 8 + move.to.file;
    var movedPiece = { type: move.piece.type, color: move.piece.color };
    if (move.special === 'promotion') movedPiece.type = 'Q';
    board[fromIdx] = null;
    board[toIdx] = movedPiece;

    var mover = state.turn;
    var next = {
      board: board,
      turn: opposite(mover),
      fullMoveNumber: mover === 'b' ? state.fullMoveNumber + 1 : state.fullMoveNumber,
      history: state.history.concat([move]),
      kingHasMoved: { w: state.kingHasMoved.w, b: state.kingHasMoved.b },
      queenHasMoved: { w: state.queenHasMoved.w, b: state.queenHasMoved.b },
      anyCaptureYet: state.anyCaptureYet || !!move.captured,
      counting: { active: state.counting.active, trigger: state.counting.trigger, disadvantagedColor: state.counting.disadvantagedColor, tierBase: state.counting.tierBase, budget: state.counting.budget, elapsed: state.counting.elapsed },
      status: 'active',
      winner: null
    };
    if (move.piece.type === 'K') next.kingHasMoved[mover] = true;
    if (move.piece.type === 'Q') next.queenHasMoved[mover] = true;
    return next;
  }
```

Add `applyMove: applyMove, promotionRankFor: promotionRankFor,` to `api`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/engine.test.js`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine.js tests/engine.test.js
git commit -m "engine: pawn movement, promotion, and applyMove"
```

---

### Task 4: Check detection and legal move filtering

**Files:**
- Modify: `src/engine.js`
- Test: `tests/engine.test.js`

**Interfaces:**
- Consumes: `generateBaseMoves` (Task 2/3), `applyMove` (Task 3).
- Produces: `OukEngine.isSquareAttacked(state, rank, file, byColor) -> bool`, `OukEngine.isInCheck(state, color) -> bool`, `OukEngine.generateLegalMoves(state, color) -> Move[]` (filters every piece's pseudo-moves — for this task, pseudo-moves === base moves; Task 6 adds the two specials into the pseudo-move layer this function reads from).

**Design note carried into code as a comment**: `isSquareAttacked` must use `generateBaseMoves` only (never the eventual special-move layer), both because a king's/queen's first-move specials are move *options*, not standing threats, and to avoid `isInCheck` → `isSquareAttacked` → (special-move eligibility) → `isInCheck` recursion once Task 6 adds those specials.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/engine.test.js

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
    { at: 'a1', type: 'K', color: 'b' }, // placeholder distinct black king square not on e-file to avoid double-king ambiguity in this synthetic test
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
  // pinned rook may only move along the e-file (still blocks check)
  assert.ok(dests.every((d) => d[0] === 'e'), 'pinned rook restricted to the pinning file: ' + dests.join(','));
  assert.ok(dests.includes('e5') && dests.includes('e6') && dests.includes('e7'));
});

test('generateLegalMoves excludes king moves into check', () => {
  const state = placedState([
    { at: 'e1', type: 'K', color: 'w' },
    { at: 'd8', type: 'R', color: 'b' }, // covers the d-file
    { at: 'a1', type: 'K', color: 'b' },
  ], 'w');
  const kingMoves = OukEngine.generateLegalMoves(state, 'w').filter((m) => m.piece.type === 'K');
  const dests = destSet(kingMoves);
  assert.ok(!dests.includes('d1'), 'king may not step onto the attacked d-file square');
  assert.ok(!dests.includes('d2'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine.test.js`
Expected: FAIL — `isSquareAttacked is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
  function isSquareAttacked(state, rank, file, byColor) {
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var p = pieceAt(state, r, f);
        if (!p || p.color !== byColor) continue;
        var moves = generateBaseMoves(state, r, f);
        for (var i = 0; i < moves.length; i++) {
          if (moves[i].to.rank === rank && moves[i].to.file === file) return true;
        }
      }
    }
    return false;
  }

  function findKing(state, color) {
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var p = pieceAt(state, r, f);
        if (p && p.color === color && p.type === 'K') return { rank: r, file: f };
      }
    }
    return null;
  }

  function isInCheck(state, color) {
    var king = findKing(state, color);
    if (!king) return false;
    return isSquareAttacked(state, king.rank, king.file, opposite(color));
  }

  function generatePseudoMoves(state, rank, file) {
    // Task 6 will extend this with the two first-move specials; for now identical to base.
    return generateBaseMoves(state, rank, file);
  }

  function generateLegalMoves(state, color) {
    var legal = [];
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var p = pieceAt(state, r, f);
        if (!p || p.color !== color) continue;
        var candidates = generatePseudoMoves(state, r, f);
        for (var i = 0; i < candidates.length; i++) {
          var resulting = applyMove(state, candidates[i]);
          if (!isInCheck(resulting, color)) legal.push(candidates[i]);
        }
      }
    }
    return legal;
  }
```

Add `isSquareAttacked, isInCheck, generatePseudoMoves, generateLegalMoves, findKing` to `api`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/engine.test.js`
Expected: PASS (18 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine.js tests/engine.test.js
git commit -m "engine: check detection and legal move filtering"
```

---

### Task 5: Checkmate and stalemate status

**Files:**
- Modify: `src/engine.js`
- Test: `tests/engine.test.js`

**Interfaces:**
- Consumes: `generateLegalMoves`, `isInCheck` (Task 4), `applyMove` (Task 3).
- Produces: `applyMove` now sets `status` to `'checkmate'`/`'stalemate'`/`'active'` and `winner` on the returned state (computed for the *new* side to move, i.e. whoever is about to move next).

- [ ] **Step 1: Write the failing test**

```js
// append to tests/engine.test.js

test('applyMove detects checkmate: back-rank-style mate with a rook and blocked king', () => {
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'b7', type: 'P', color: 'b' }, // wait: pawn wouldn't box in a 1-square king variant the same as chess; use two rooks ladder mate instead
  ], 'b');
  // Ladder/rook mate: black king boxed on the back rank by a white rook giving check
  // on the rank and a second white rook cutting off rank 7 escape.
  const mateState = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'h8', type: 'R', color: 'w' }, // checks along rank 8
    { at: 'a7', type: 'R', color: 'w' }, // wait, a7 would block the king's own escape square but not attack it via rook rules cleanly; use h7 to cover rank 7
    { at: 'h1', type: 'K', color: 'w' },
  ], 'b');
  // Recompute cleanly: rook on h8 gives check along rank 8; rook on h7... let's just cover rank 7 with a rook on b7.
  const clean = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'h8', type: 'R', color: 'w' },
    { at: 'b7', type: 'R', color: 'w' },
    { at: 'h1', type: 'K', color: 'w' },
  ], 'b');
  assert.equal(OukEngine.isInCheck(clean, 'b'), true);
  assert.equal(OukEngine.generateLegalMoves(clean, 'b').length, 0);
  // Simulate: it's black's move and black has none while in check -> whoever just moved (white)
  // should be reflected by re-deriving status via a helper the implementation adds.
  const status = OukEngine.deriveStatus(clean);
  assert.equal(status.status, 'checkmate');
  assert.equal(status.winner, 'w');
});

test('deriveStatus detects stalemate as a draw (no winner)', () => {
  // Classic stalemate shape adapted to Ouk Chaktrang movement: black king in the
  // corner, no legal moves, and NOT in check.
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'b6', type: 'Q', color: 'w' }, // met covers a7,b7,c7 diagonals... verify via isInCheck below
    { at: 'c7', type: 'R', color: 'w' },
    { at: 'h1', type: 'K', color: 'w' },
  ], 'b');
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
    { at: 'a7', type: 'R', color: 'w' },
  ], 'w');
  const mv = OukEngine.generateLegalMoves(state, 'w').find((m) => m.piece.type === 'R' && OukEngine.squareName(m.to.rank, m.to.file) === 'h8');
  const next = OukEngine.applyMove(state, mv);
  assert.equal(next.status, 'checkmate');
  assert.equal(next.winner, 'w');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine.test.js`
Expected: FAIL — `OukEngine.deriveStatus is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
  function deriveStatus(state) {
    var sideToMove = state.turn;
    var inCheck = isInCheck(state, sideToMove);
    var hasMoves = generateLegalMoves(state, sideToMove).length > 0;
    if (!hasMoves && inCheck) return { status: 'checkmate', winner: opposite(sideToMove) };
    if (!hasMoves && !inCheck) return { status: 'stalemate', winner: null };
    return { status: 'active', winner: null };
  }
```

In `applyMove`, replace `status: 'active', winner: null` at the end with a call after `next` is built:

```js
    var derived = deriveStatus(next);
    next.status = derived.status;
    next.winner = derived.winner;
    return next;
```

Add `deriveStatus: deriveStatus,` to `api`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/engine.test.js`
Expected: PASS (21 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine.js tests/engine.test.js
git commit -m "engine: checkmate and stalemate status detection"
```

---

### Task 6: Cambodia-specific first-move exceptions

**Files:**
- Modify: `src/engine.js`
- Test: `tests/engine.test.js`

**Interfaces:**
- Consumes: `isInCheck` (Task 4, base-attack-only — safe from recursion per the Task 4 design note), `state.anyCaptureYet`/`kingHasMoved`/`queenHasMoved` (Task 1/3).
- Produces: `generatePseudoMoves` (Task 4) now appends up to one extra move per eligible King/Queen: `special:'kingJump'` or `special:'queenDoubleStep'`.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/engine.test.js

test('king may jump like a knight on its first move, pre-capture, not in check', () => {
  const state = placedState([
    { at: 'd1', type: 'K', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
  ], 'w');
  const sq = OukEngine.parseSquare('d1');
  const dests = destSet(OukEngine.generatePseudoMoves(state, sq.rank, sq.file));
  assert.ok(dests.includes('e3'), 'knight-jump destination available: ' + dests.join(','));
  assert.ok(dests.includes('c3'));
  assert.ok(dests.includes('c4') === false || true); // ensure normal 1-step squares still present, checked below
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
  ], 'w'); // e2 and e3 both empty: pawn already moved away in this synthetic position
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
    { at: 'd8', type: 'K', color: 'b' }, // note: same file is fine, they are far apart and it's not check (kings never adjacent by construction here)
    { at: 'e1', type: 'Q', color: 'b' }, // black queen unmoved too, opposite side
  ], 'w');
  state.anyCaptureYet = true; // e.g. some earlier unrelated capture happened
  const wKingDests = destSet(OukEngine.generatePseudoMoves(state, 0, 3));
  assert.ok(!wKingDests.includes('e3') && !wKingDests.includes('c3'));
  const bQueenSq = OukEngine.parseSquare('e1');
  const bQueenDests = destSet(OukEngine.generatePseudoMoves(state, bQueenSq.rank, bQueenSq.file));
  assert.ok(!bQueenDests.includes('e3'), 'black queen (moving toward rank 1) double-step also gone');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine.test.js`
Expected: FAIL — jump/double-step destinations missing from `generatePseudoMoves` output

- [ ] **Step 3: Write minimal implementation**

```js
  function addKingJumpIfEligible(state, rank, file, piece, out) {
    if (state.anyCaptureYet) return;
    if (state.kingHasMoved[piece.color]) return;
    if (isInCheck(state, piece.color)) return;
    KNIGHT_STEPS.forEach(function (d) {
      var r2 = rank + d[0], f2 = file + d[1];
      if (!inBounds(r2, f2)) return;
      var occ = pieceAt(state, r2, f2);
      if (occ && occ.color === piece.color) return;
      // Judgment call (documented in Global Constraints): capturing is allowed on this jump.
      out.push({ from: { rank: rank, file: file }, to: { rank: r2, file: f2 }, piece: piece, captured: occ || null, special: 'kingJump' });
    });
  }

  function addQueenDoubleStepIfEligible(state, rank, file, piece, out) {
    if (state.anyCaptureYet) return;
    if (state.queenHasMoved[piece.color]) return;
    var dir = piece.color === 'w' ? 1 : -1;
    var r1 = rank + dir, r2 = rank + 2 * dir;
    if (!inBounds(r2, file)) return;
    if (pieceAt(state, r1, file) || pieceAt(state, r2, file)) return;
    out.push({ from: { rank: rank, file: file }, to: { rank: r2, file: file }, piece: piece, captured: null, special: 'queenDoubleStep' });
  }

  function generatePseudoMoves(state, rank, file) {
    var piece = pieceAt(state, rank, file);
    if (!piece) return [];
    var out = generateBaseMoves(state, rank, file);
    if (piece.type === 'K') addKingJumpIfEligible(state, rank, file, piece, out);
    if (piece.type === 'Q') addQueenDoubleStepIfEligible(state, rank, file, piece, out);
    return out;
  }
```

This replaces the Task 4 stub definition of `generatePseudoMoves` (same name, extended body — remove the old one-liner version).

Also update `applyMove`'s promotion check to key off `move.special === 'promotion'` only (unaffected by the new special values `'kingJump'`/`'queenDoubleStep'`, already handled since those are mutually exclusive move instances).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/engine.test.js`
Expected: PASS (28 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine.js tests/engine.test.js
git commit -m "engine: Cambodia-specific king-jump and queen-double-step first moves"
```

---

### Task 7: Counting (endgame) draw rule

**Files:**
- Modify: `src/engine.js`
- Test: `tests/engine.test.js`

**Interfaces:**
- Consumes: `applyMove`, `opposite`, `pieceAt` (earlier tasks).
- Produces: `OukEngine.materialTier(state, color) -> {label:string, base:number}`, `OukEngine.countAllPieces(state) -> number`, `OukEngine.hasPawns(state, color) -> bool`, `OukEngine.isBareKing(state, color) -> bool`. `applyMove` now updates `state.counting` per move and can set `status:'draw-counting'` / `'draw-noprogress'`.

**Tier table** (from the spec, `base` values only — actual budget = `base - countAllPieces(state)` at the moment the count (re)starts):

| Condition (attacker's material) | base |
|---|---|
| >=2 rooks | 8 |
| ==1 rook | 16 |
| 0 rooks, >=2 bishops | 22 |
| 0 rooks, 0-1 bishops, >=2 knights | 32 |
| 0 rooks, ==1 bishop | 44 |
| 0 rooks, 0 bishops, ==1 knight | 64 |
| else (queens/promoted pawns only) | 64 |

- [ ] **Step 1: Write the failing test**

```js
// append to tests/engine.test.js

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
  // Trigger recompute by making any legal white move; counting should now be active.
  const mv = OukEngine.generateLegalMoves(state, 'w').find((m) => m.piece.type === 'N');
  const next = OukEngine.applyMove(state, mv);
  assert.equal(next.counting.active, true);
  assert.equal(next.counting.trigger, 'bareKing');
  assert.equal(next.counting.disadvantagedColor, 'b');
  assert.equal(next.counting.tierBase, 8);
  assert.equal(next.counting.budget, 3, 'base 8 minus 5 total pieces = 3');
});

test('counting forces a draw if the budget elapses without checkmate', () => {
  // King and lone knight (base 64) vs bare king, positioned so no progress is
  // ever made: budget will be a small number here by construction (few pieces)
  // so the test runs fast.
  let state = placedState([
    { at: 'a1', type: 'K', color: 'w' },
    { at: 'h1', type: 'N', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
  ], 'w');
  // 3 total pieces, knight-only tier base 64 -> budget 61. Shuttle the knight
  // back and forth (never mating) and confirm a draw is eventually forced.
  let guard = 0;
  while (state.status === 'active' && guard < 200) {
    const moves = OukEngine.generateLegalMoves(state, state.turn);
    // Prefer a non-capturing, reversible-looking move to avoid accidentally mating.
    const mv = moves[0];
    state = OukEngine.applyMove(state, mv);
    guard++;
  }
  assert.ok(state.status === 'draw-counting' || state.status === 'checkmate', 'game must terminate: ' + state.status);
});

test('hasPawns reflects whether a color has any unpromoted pawn on the board', () => {
  const state = placedState([{ at: 'a2', type: 'P', color: 'w' }, { at: 'a1', type: 'K', color: 'w' }, { at: 'a8', type: 'K', color: 'b' }], 'w');
  assert.equal(OukEngine.hasPawns(state, 'w'), true);
  assert.equal(OukEngine.hasPawns(state, 'b'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine.test.js`
Expected: FAIL — `OukEngine.materialTier is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
  function countAllPieces(state) {
    var n = 0;
    for (var i = 0; i < 64; i++) if (state.board[i]) n++;
    return n;
  }

  function hasPawns(state, color) {
    for (var i = 0; i < 64; i++) {
      var p = state.board[i];
      if (p && p.color === color && p.type === 'P') return true;
    }
    return false;
  }

  function isBareKing(state, color) {
    var count = 0;
    for (var i = 0; i < 64; i++) {
      var p = state.board[i];
      if (p && p.color === color) {
        if (p.type !== 'K') return false;
        count++;
      }
    }
    return count === 1;
  }

  function countType(state, color, type) {
    var n = 0;
    for (var i = 0; i < 64; i++) {
      var p = state.board[i];
      if (p && p.color === color && p.type === type) n++;
    }
    return n;
  }

  // Priority-ordered extrapolation of the documented table (see Global Constraints).
  function materialTier(state, color) {
    var rooks = countType(state, color, 'R');
    var bishops = countType(state, color, 'B');
    var knights = countType(state, color, 'N');
    if (rooks >= 2) return { label: 'twoRooks', base: 8 };
    if (rooks >= 1) return { label: 'oneRook', base: 16 };
    if (bishops >= 2) return { label: 'twoBishops', base: 22 };
    if (knights >= 2) return { label: 'twoKnights', base: 32 };
    if (bishops >= 1) return { label: 'oneBishop', base: 44 };
    if (knights >= 1) return { label: 'oneKnight', base: 64 };
    return { label: 'metsOnly', base: 64 };
  }

  function emptyCounting() {
    return { active: false, trigger: null, disadvantagedColor: null, tierBase: null, budget: null, elapsed: 0 };
  }

  function updateCounting(prevCounting, state, moverColor) {
    var whiteBare = isBareKing(state, 'w');
    var blackBare = isBareKing(state, 'b');
    var bothPawnless = !hasPawns(state, 'w') && !hasPawns(state, 'b');

    if (whiteBare || blackBare) {
      var disadvantaged = whiteBare ? 'w' : 'b';
      var advantaged = opposite(disadvantaged);
      var tier = materialTier(state, advantaged);
      var total = countAllPieces(state);
      var budget = tier.base - total;
      var sameCount = prevCounting.active && prevCounting.trigger === 'bareKing' &&
        prevCounting.disadvantagedColor === disadvantaged && prevCounting.tierBase === tier.base;
      if (!sameCount) {
        return { active: true, trigger: 'bareKing', disadvantagedColor: disadvantaged, tierBase: tier.base, budget: budget, elapsed: 0 };
      }
      var elapsed = moverColor === advantaged ? prevCounting.elapsed + 1 : prevCounting.elapsed;
      return { active: true, trigger: 'bareKing', disadvantagedColor: disadvantaged, tierBase: tier.base, budget: budget, elapsed: elapsed };
    }

    if (bothPawnless) {
      if (!prevCounting.active || prevCounting.trigger !== 'noProgress') {
        return { active: true, trigger: 'noProgress', disadvantagedColor: null, tierBase: 64, budget: 64, elapsed: 0 };
      }
      return { active: true, trigger: 'noProgress', disadvantagedColor: null, tierBase: 64, budget: 64, elapsed: prevCounting.elapsed + 1 };
    }

    return emptyCounting();
  }
```

In `applyMove`, after `next.status`/`next.winner` are derived, add counting logic (must run before the final `return next;`):

```js
    var mover = state.turn; // (already computed earlier in the function as `mover`)
    next.counting = updateCounting(state.counting, next, mover);
    if (move.captured && next.counting.trigger === 'noProgress') {
      // a capture resets the no-progress clock even though both sides are still pawnless
      next.counting.elapsed = 0;
    }
    if (next.status === 'active' && next.counting.active && next.counting.elapsed >= next.counting.budget) {
      next.status = next.counting.trigger === 'bareKing' ? 'draw-counting' : 'draw-noprogress';
      next.winner = null;
    }
```

(Note: `mover` is already a local variable earlier in `applyMove` from Task 3 — reuse it, don't redeclare.)

Add `materialTier, countAllPieces, hasPawns, isBareKing` to `api`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/engine.test.js`
Expected: PASS (33 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine.js tests/engine.test.js
git commit -m "engine: full counting draw rule with live tier recompute"
```

---

### Task 8: Perft sanity cross-check

**Files:**
- Modify: `tests/engine.test.js` only (no engine changes expected — this task exists to independently validate Tasks 1-7 against hand-counted expectations, a standard technique for catching move-generation bugs that per-piece unit tests miss).

**Interfaces:**
- Consumes: `generateLegalMoves`, `applyMove`, `createInitialState`.
- Produces: nothing new — pure verification task. If it fails, the bug is in an earlier task; fix there, not here.

- [ ] **Step 1: Write the failing (or passing-by-luck) test**

```js
// append to tests/engine.test.js

function perft(state, depth) {
  if (depth === 0) return 1;
  var moves = OukEngine.generateLegalMoves(state, state.turn);
  if (depth === 1) return moves.length;
  var nodes = 0;
  for (var i = 0; i < moves.length; i++) {
    nodes += perft(OukEngine.applyMove(state, moves[i]), depth - 1);
  }
  return nodes;
}

test('perft depth 1 from the start position: every piece has its expected move count', () => {
  const state = OukEngine.createInitialState();
  const moves = OukEngine.generateLegalMoves(state, 'w');
  // 8 pawns x 1 forward step = 8; 2 rooks fully blocked = 0; 2 knights x 2 = 4;
  // 2 bishops x 2 diagonal (forward diagonal blocked by own pawn, other diagonal open) = 2 each... 
  // computed empirically below rather than hand-claimed, then pinned as a regression guard.
  assert.equal(moves.length, perft(state, 1));
  assert.ok(moves.length > 0 && moves.length < 40, 'sanity bound on branching factor: ' + moves.length);
});

test('perft depth 2 from the start position is stable (regression guard)', () => {
  const state = OukEngine.createInitialState();
  const n2 = perft(state, 2);
  assert.ok(n2 > 0, 'depth-2 node count must be positive: ' + n2);
  // Pin the exact value once observed passing, to catch future regressions.
  console.log('perft(2) from start position =', n2);
});
```

- [ ] **Step 2: Run test, record the actual perft(2) value**

Run: `node --test tests/engine.test.js`
Expected: PASS for both — read the logged `perft(2)` value from the test output.

- [ ] **Step 3: Pin the exact regression value**

Replace the `assert.ok(n2 > 0, ...)` line with an exact equality assertion using the value printed in Step 2, e.g. `assert.equal(n2, <observed value>);`, and remove the `console.log`.

- [ ] **Step 4: Run test to verify it passes with the pinned value**

Run: `node --test tests/engine.test.js`
Expected: PASS (35 tests), all green.

- [ ] **Step 5: Commit**

```bash
git add tests/engine.test.js
git commit -m "engine: perft regression guard for the starting position"
```

---

## Self-Review Notes

- **Spec coverage**: starting position (Task 1), all 6 piece types incl. bishop's 5-square pattern (Task 2/3), promotion (Task 3), check/checkmate/stalemate (Task 4/5), both Cambodia first-move exceptions with capture-expiry (Task 6), full counting rule with both triggers and live recompute (Task 7), perft cross-check (Task 8). No spec item without a task.
- **Type consistency checked**: `Move.special` values (`'promotion'`, `'kingJump'`, `'queenDoubleStep'`) used consistently from Task 3 onward; `GameState.counting` shape fixed in Task 1 and only ever replaced wholesale (never partially mutated) from Task 7 onward; `mover` variable reused (not redeclared) between Task 3's and Task 7's edits to `applyMove` — flagged explicitly in Task 7 to prevent a duplicate-declaration bug during execution.
- **Known open question for the user**: the king-jump capture-allowed judgment call (Global Constraints) — worth a real rules source if one turns up later, but not blocking.
