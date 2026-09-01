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

test('suggestMove returns null when the game is already over', () => {
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'h8', type: 'R', color: 'w' },
    { at: 'h7', type: 'R', color: 'w' },
    { at: 'h1', type: 'K', color: 'w' },
  ], 'b');
  assert.equal(state.status, 'checkmate');
  assert.equal(OukAI.suggestMove(state), null);
});

test('suggestMove returns null on a stalemated position rather than an undefined move', () => {
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'c7', type: 'K', color: 'w' },
    { at: 'c6', type: 'N', color: 'w' },
  ], 'b');
  state.kingHasMoved.b = true;
  const derived = OukEngine.deriveStatus(state);
  state.status = derived.status;
  state.winner = derived.winner;
  assert.equal(state.status, 'stalemate');
  assert.equal(OukAI.suggestMove(state), null);
});

test('suggestMove returns a legal move for whichever side is to move', () => {
  const state = OukEngine.createInitialState();
  state.turn = 'b';
  const legalKeys = new Set(OukEngine.generateLegalMoves(state, 'b').map(
    (m) => OukEngine.squareName(m.from.rank, m.from.file) + OukEngine.squareName(m.to.rank, m.to.file) + (m.special || '')
  ));
  const move = OukAI.suggestMove(state);
  assert.ok(move, 'expected a suggestion on an active position');
  const key = OukEngine.squareName(move.from.rank, move.from.file) + OukEngine.squareName(move.to.rank, move.to.file) + (move.special || '');
  assert.ok(legalKeys.has(key), 'suggested move must be legal for Black: ' + key);
});

test('suggestMove finds a mate-in-1 without being passed any difficulty options', () => {
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'c7', type: 'K', color: 'w' },
    { at: 'h8', type: 'R', color: 'w' },
    { at: 'd8', type: 'N', color: 'w' },
  ], 'w');
  const move = OukAI.suggestMove(state);
  assert.equal(OukEngine.applyMove(state, move).status, 'checkmate');
});

// --- Evaluation ------------------------------------------------------------

// evaluate() must return exactly 0 on the opening position, and it only can if
// every piece-square table is symmetric about the file axis. Ouk Chaktrang's
// start is symmetric under a 180° rotation rather than a plain rank flip —
// White's Sdaach starts on d1, Black's on e8 — so a table that told the two
// king squares apart would leave a non-zero residue on move one.
test('every piece-square table is symmetric about the file axis', () => {
  for (const [name, table] of Object.entries(OukAI.PIECE_SQUARE_TABLES)) {
    assert.equal(table.length, 64, name + ' must cover the board');
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 4; file++) {
        assert.equal(
          table[rank * 8 + file],
          table[rank * 8 + (7 - file)],
          `${name} is asymmetric at rank ${rank}, files ${file}/${7 - file}`
        );
      }
    }
  }
});

test('evaluate stays symmetric after a mirrored pair of opening moves', () => {
  // e3-e4 for White answered by d6-d5 for Black is the same move seen through
  // the 180° rotation the opening position has, so the score returns to 0.
  let state = OukEngine.createInitialState();
  const play = (from, to) => {
    const f = OukEngine.parseSquare(from), t = OukEngine.parseSquare(to);
    const move = OukEngine.generateLegalMoves(state, state.turn).find(
      (m) => m.from.rank === f.rank && m.from.file === f.file && m.to.rank === t.rank && m.to.file === t.file
    );
    assert.ok(move, from + '-' + to + ' should be legal');
    state = OukEngine.applyMove(state, move);
  };
  play('e3', 'e4');
  assert.ok(OukAI.evaluate(state) > 0, 'a free tempo of development should read positive for White');
  play('d6', 'd5');
  assert.equal(OukAI.evaluate(state), 0, 'the mirrored reply should cancel it out');
});

test('a lone enemy king scores better driven to the rim than left in the centre', () => {
  const withKingOnRim = placedState([
    { at: 'd4', type: 'K', color: 'w' },
    { at: 'a1', type: 'R', color: 'w' },
    { at: 'h8', type: 'K', color: 'b' },
  ], 'w');
  const withKingInCentre = placedState([
    { at: 'd4', type: 'K', color: 'w' },
    { at: 'a1', type: 'R', color: 'w' },
    { at: 'e5', type: 'K', color: 'b' },
  ], 'w');
  assert.ok(
    OukAI.evaluateCp(withKingOnRim) > OukAI.evaluateCp(withKingInCentre),
    'without this gradient a won endgame is just a long shuffle into a counting draw'
  );
});

test('a material edge is worth less once the count is nearly spent', () => {
  const pieces = [
    { at: 'e4', type: 'K', color: 'w' },
    { at: 'a1', type: 'R', color: 'w' },
    { at: 'h8', type: 'K', color: 'b' },
  ];
  const counting = (elapsed) => ({
    active: true, trigger: 'bareKing', disadvantagedColor: 'b',
    tierBase: 16, budget: 13, elapsed: elapsed
  });

  const fresh = placedState(pieces, 'w');
  fresh.counting = counting(0);
  const spent = placedState(pieces, 'w');
  spent.counting = counting(12);

  assert.ok(OukAI.evaluateCp(fresh) > OukAI.evaluateCp(spent) * 1.5,
    'a Touk you cannot mate with before the count expires is not worth a Touk');
  assert.ok(OukAI.evaluateCp(spent) > 0, 'but it is still worth more than nothing');
});

// --- Position hashing ------------------------------------------------------

test('the position hash separates positions the search must not confuse', () => {
  const start = OukEngine.createInitialState();
  assert.equal(OukAI.hashState(start), OukAI.hashState(OukEngine.createInitialState()));

  const moved = OukEngine.applyMove(start, OukEngine.generateLegalMoves(start, 'w')[0]);
  assert.notEqual(OukAI.hashState(moved), OukAI.hashState(start));

  // Same board, other side to move.
  const swapped = OukEngine.createInitialState();
  swapped.turn = 'b';
  assert.notEqual(OukAI.hashState(swapped), OukAI.hashState(start));

  // Same board, but one side has spent its first-move privileges.
  const jumped = OukEngine.createInitialState();
  jumped.kingHasMoved.w = true;
  assert.notEqual(OukAI.hashState(jumped), OukAI.hashState(start));

  // Same board, different point on the counting clock: one of these is much
  // closer to being a draw than the other, so they cannot share a table entry.
  const early = placedState([
    { at: 'e4', type: 'K', color: 'w' },
    { at: 'a1', type: 'R', color: 'w' },
    { at: 'h8', type: 'K', color: 'b' },
  ], 'w');
  const late = placedState([
    { at: 'e4', type: 'K', color: 'w' },
    { at: 'a1', type: 'R', color: 'w' },
    { at: 'h8', type: 'K', color: 'b' },
  ], 'w');
  early.counting = { active: true, trigger: 'bareKing', disadvantagedColor: 'b', tierBase: 16, budget: 13, elapsed: 1 };
  late.counting = { active: true, trigger: 'bareKing', disadvantagedColor: 'b', tierBase: 16, budget: 13, elapsed: 11 };
  assert.notEqual(OukAI.hashState(early), OukAI.hashState(late));

  // And it must stay inside the range a double holds exactly.
  assert.ok(Number.isSafeInteger(OukAI.hashState(start)));
});

// --- Quiescence ------------------------------------------------------------

test('quiescence stops the engine grabbing a defended pawn at depth 1', () => {
  // A search that stops counting at depth 1 sees Rxd7 as a free Trey, because
  // the recapture happens on the ply it never looks at. This is the position
  // the old fixed-depth search fell for, at the depth where it fell for it.
  const state = placedState([
    { at: 'a1', type: 'K', color: 'w' },
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'd4', type: 'R', color: 'w' },
    { at: 'd7', type: 'P', color: 'b' },
    { at: 'h7', type: 'R', color: 'b' },
  ], 'w');
  const move = OukAI.chooseMove(state, { timeLimitMs: 2000, maxDepth: 1 });
  assert.notEqual(OukEngine.squareName(move.to.rank, move.to.file), 'd7',
    'even a one-ply search must play out the capture sequence before trusting it');
});

// --- analyze ---------------------------------------------------------------

test('analyze reports the move, its score, the depth reached and the mate distance', () => {
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'c7', type: 'K', color: 'w' },
    { at: 'h8', type: 'R', color: 'w' },
    { at: 'd8', type: 'N', color: 'w' },
  ], 'w');
  const result = OukAI.analyze(state, { timeLimitMs: 1000, maxDepth: 4 });

  assert.ok(result.move, 'an active position must yield a move');
  assert.equal(OukEngine.applyMove(state, result.move).status, 'checkmate');
  assert.equal(result.mateIn, 1);
  assert.ok(result.scoreCp >= OukAI.MATE_THRESHOLD, 'a forced mate must score as one');
  assert.equal(result.score, result.scoreCp / 100);
  assert.ok(result.depth >= 1);
  assert.ok(result.nodes > 0);
});

test('analyze counts a mate in three as three, not as a win of unknown length', () => {
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'c6', type: 'K', color: 'w' },
    { at: 'h1', type: 'R', color: 'w' },
  ], 'w');
  const result = OukAI.analyze(state, { timeLimitMs: 3000, maxDepth: 6 });
  assert.equal(result.mateIn, 3);
});

test('analyze returns null on a finished game rather than a move for nobody', () => {
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'h8', type: 'R', color: 'w' },
    { at: 'h7', type: 'R', color: 'w' },
    { at: 'h1', type: 'K', color: 'w' },
  ], 'b');
  assert.equal(state.status, 'checkmate');
  assert.equal(OukAI.analyze(state, { timeLimitMs: 100, maxDepth: 3 }), null);
  assert.equal(OukAI.chooseMove(state, { timeLimitMs: 100, maxDepth: 3 }), null);
});

test('the time limit holds even when the depth limit is far out of reach', () => {
  const state = OukEngine.createInitialState();
  const start = Date.now();
  const result = OukAI.analyze(state, { timeLimitMs: 250, maxDepth: 40 });
  const elapsed = Date.now() - start;
  assert.ok(result.move, 'an aborted search still has to answer with a move');
  assert.ok(elapsed < 1500, 'a 250ms budget must not become a multi-second freeze: ' + elapsed + 'ms');
  assert.ok(result.depth >= 1, 'and it must complete at least one iteration');
});

// --- Difficulty ------------------------------------------------------------

test('a blurred evaluation still only ever produces legal moves', () => {
  let state = OukEngine.createInitialState();
  for (let ply = 0; ply < 12 && state.status === 'active'; ply++) {
    const legal = OukEngine.generateLegalMoves(state, state.turn);
    const keys = new Set(legal.map((m) =>
      OukEngine.squareName(m.from.rank, m.from.file) + OukEngine.squareName(m.to.rank, m.to.file) + (m.special || '')));
    const move = OukAI.chooseMove(state, { timeLimitMs: 120, maxDepth: 3, evalNoiseCp: 60 });
    const key = OukEngine.squareName(move.from.rank, move.from.file) +
      OukEngine.squareName(move.to.rank, move.to.file) + (move.special || '');
    assert.ok(keys.has(key), 'the easy setting must still obey the rules: ' + key);
    state = OukEngine.applyMove(state, move);
  }
});

test('a blurred evaluation still sees a mate in one', () => {
  // Difficulty should cost the engine judgement, not its eyesight for a mate
  // already on the board — losing to an engine that cannot finish is worse.
  const state = placedState([
    { at: 'a8', type: 'K', color: 'b' },
    { at: 'c7', type: 'K', color: 'w' },
    { at: 'h8', type: 'R', color: 'w' },
    { at: 'd8', type: 'N', color: 'w' },
  ], 'w');
  for (let attempt = 0; attempt < 5; attempt++) {
    const move = OukAI.chooseMove(state, { timeLimitMs: 500, maxDepth: 3, evalNoiseCp: 60 });
    assert.equal(OukEngine.applyMove(state, move).status, 'checkmate');
  }
});

test('the noise from an easy search does not linger into an exact one', () => {
  const state = OukEngine.createInitialState();
  OukAI.chooseMove(state, { timeLimitMs: 150, maxDepth: 3, evalNoiseCp: 90 });
  const first = OukAI.analyze(state, { timeLimitMs: 400, maxDepth: 3 });
  OukAI.chooseMove(state, { timeLimitMs: 150, maxDepth: 3, evalNoiseCp: 90 });
  const second = OukAI.analyze(state, { timeLimitMs: 400, maxDepth: 3 });
  assert.equal(first.scoreCp, second.scoreCp,
    'an exact search must not read back scores a blurred one left in the table');
});

// --- Endgame conversion ----------------------------------------------------

test('the engine mates with a Touk before the bare-king count runs out', () => {
  // The whole point of the endgame terms in the evaluation. Material alone
  // says every move here is equally winning, and a search that believes that
  // shuffles until the count expires and the win becomes a draw.
  let state = placedState([
    { at: 'e4', type: 'K', color: 'w' },
    { at: 'a1', type: 'R', color: 'w' },
    { at: 'd7', type: 'K', color: 'b' },
  ], 'w');
  state.kingHasMoved = { w: true, b: true };
  state.anyCaptureYet = true;

  let plies = 0;
  while (state.status === 'active' && plies < 80) {
    const move = OukAI.chooseMove(state, { timeLimitMs: 400, maxDepth: 5 });
    assert.ok(move, 'an active position must yield a move');
    state = OukEngine.applyMove(state, move);
    plies++;
  }

  assert.equal(state.status, 'checkmate', 'expected a mate, got ' + state.status);
  assert.equal(state.winner, 'w');
});
