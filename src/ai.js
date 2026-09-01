(function (root) {
  'use strict';

  var OukEngine = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.OukEngine;

  // ---------------------------------------------------------------------------
  // Scale
  //
  // Everything inside the search is integer centipawns: a Trey (pawn) is 100.
  // Integers are not just faster, they are what makes the evaluation of a
  // symmetric position come out at exactly zero — floating-point addition is
  // not associative, so summing the same set of values in White's order and in
  // Black's order can differ in the last bit. The public evaluate() divides
  // back down to pawn units, which is the scale src/review.js classifies with.
  // ---------------------------------------------------------------------------

  var VALUE = { R: 500, N: 300, B: 250, Q: 150, P: 100, K: 0 };

  var MATE_SCORE = 100000;
  // Any score this large is a mate score carrying a distance-to-mate, not an
  // evaluation. 1000 is comfortably more than the deepest ply we can reach.
  var MATE_THRESHOLD = MATE_SCORE - 1000;
  // A finite stand-in for infinity. Windows are narrowed with `-alpha - 1`,
  // and doing that arithmetic on Infinity produces a window that excludes
  // every score.
  var INF = 1000000;

  // ---------------------------------------------------------------------------
  // Piece-square tables
  //
  // Written from White's point of view, row 0 = rank 1 (White's back rank).
  // Black reads the same table with the rank mirrored.
  //
  // Every table is symmetric about the file axis — value[r][f] === value[r][7-f].
  // That is not decoration. Ouk Chaktrang's opening position is symmetric under
  // a 180° rotation, not under a plain rank flip: White's Sdaach starts on d1
  // and Black's on e8. Rank-mirrored lookups therefore only cancel out on the
  // starting position if the tables are file-symmetric, and evaluate() must
  // return exactly 0 there. tests/ai.test.js checks the symmetry directly.
  // ---------------------------------------------------------------------------

  function flatten(rows) {
    var out = new Array(64);
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) out[r * 8 + f] = rows[r][f];
    }
    return out;
  }

  // Trey. Promotes on rank 6 (index 5) rather than the last rank, so a pawn on
  // rank 5 is one step from becoming a Neang and the table rises steeply there.
  // Ranks 6-8 are unreachable for a White pawn: arriving is promoting.
  var PST_P = flatten([
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 2, 4, 4, 2, 0, 0],
    [4, 6, 10, 14, 14, 10, 6, 4],
    [20, 24, 30, 34, 34, 30, 24, 20],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0]
  ]);

  // Neang — one diagonal step. Short-range, so placement is nearly everything
  // it has: a Neang on the rim touches two squares instead of four.
  var PST_Q = flatten([
    [-6, -4, -2, 0, 0, -2, -4, -6],
    [-4, 0, 2, 4, 4, 2, 0, -4],
    [-2, 2, 6, 8, 8, 6, 2, -2],
    [0, 4, 8, 10, 10, 8, 4, 0],
    [0, 4, 8, 10, 10, 8, 4, 0],
    [-2, 2, 6, 8, 8, 6, 2, -2],
    [-4, 0, 2, 4, 4, 2, 0, -4],
    [-6, -4, -2, 0, 0, -2, -4, -6]
  ]);

  // Koul — one diagonal step or one step straight forward. It can only ever go
  // forward or sideways-forward, so a Koul left at home is a Koul doing nothing.
  var PST_B = flatten([
    [-8, -4, -2, 0, 0, -2, -4, -8],
    [-4, 0, 4, 6, 6, 4, 0, -4],
    [-2, 4, 8, 10, 10, 8, 4, -2],
    [0, 6, 10, 12, 12, 10, 6, 0],
    [2, 6, 10, 12, 12, 10, 6, 2],
    [0, 4, 8, 10, 10, 8, 4, 0],
    [-2, 0, 4, 6, 6, 4, 0, -2],
    [-6, -4, -2, 0, 0, -2, -4, -6]
  ]);

  // Ses — the knight, unchanged from chess and, with only one true slider on
  // the board, relatively much stronger here than it is there.
  var PST_N = flatten([
    [-30, -20, -12, -8, -8, -12, -20, -30],
    [-20, -8, 0, 4, 4, 0, -8, -20],
    [-12, 0, 10, 14, 14, 10, 0, -12],
    [-8, 4, 14, 18, 18, 14, 4, -8],
    [-8, 4, 14, 18, 18, 14, 4, -8],
    [-12, 0, 10, 14, 14, 10, 0, -12],
    [-20, -8, 0, 4, 4, 0, -8, -20],
    [-30, -20, -12, -8, -8, -12, -20, -30]
  ]);

  // Touk — the only long-range piece in the game, and so the piece that decides
  // most of them. Rank 6 is where the enemy Trey line starts.
  var PST_R = flatten([
    [0, 2, 4, 6, 6, 4, 2, 0],
    [0, 2, 4, 6, 6, 4, 2, 0],
    [0, 2, 4, 6, 6, 4, 2, 0],
    [2, 4, 6, 8, 8, 6, 4, 2],
    [4, 6, 8, 10, 10, 8, 6, 4],
    [8, 10, 12, 12, 12, 12, 10, 8],
    [6, 8, 10, 10, 10, 10, 8, 6],
    [4, 6, 8, 8, 8, 8, 6, 4]
  ]);

  // Sdaach, with pieces still on: stay home, out of the open.
  var PST_K_MID = flatten([
    [10, 14, 8, 0, 0, 8, 14, 10],
    [6, 8, 2, -6, -6, 2, 8, 6],
    [-6, -6, -10, -14, -14, -10, -6, -6],
    [-20, -20, -24, -28, -28, -24, -20, -20],
    [-30, -30, -34, -38, -38, -34, -30, -30],
    [-40, -40, -44, -48, -48, -44, -40, -40],
    [-50, -50, -54, -58, -58, -54, -50, -50],
    [-60, -60, -64, -68, -68, -64, -60, -60]
  ]);

  // Sdaach, once the board has emptied: march it to the middle. This matters
  // more in Ouk Chaktrang than in chess, because a king that will not help
  // cannot mate, and a mate that does not arrive is a counting draw.
  var PST_K_END = flatten([
    [-40, -26, -16, -10, -10, -16, -26, -40],
    [-26, -12, -2, 4, 4, -2, -12, -26],
    [-16, -2, 10, 16, 16, 10, -2, -16],
    [-10, 4, 16, 22, 22, 16, 4, -10],
    [-10, 4, 16, 22, 22, 16, 4, -10],
    [-16, -2, 10, 16, 16, 10, -2, -16],
    [-26, -12, -2, 4, 4, -2, -12, -26],
    [-40, -26, -16, -10, -10, -16, -26, -40]
  ]);

  var PST = { P: PST_P, Q: PST_Q, B: PST_B, N: PST_N, R: PST_R };

  // Both sides' non-king, non-pawn material at the opening: 2 Touk + 2 Ses +
  // 2 Koul + 1 Neang per side. Used to blend the two king tables.
  var PHASE_MAX = 2 * (2 * VALUE.R + 2 * VALUE.N + 2 * VALUE.B + VALUE.Q);

  var ROOK_MOBILITY_CP = 3;

  // ---------------------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------------------

  // Counted inline rather than through OukEngine.generateBaseMoves so the
  // evaluation allocates nothing: at a hundred thousand leaves a second, the
  // move objects it would throw away are the expensive part. The Touk is the
  // only piece whose reach depends on what is in the way, so it is the only
  // one worth counting — every other piece's placement is already in its table.
  function rookMobility(board, index) {
    var rank = index >> 3, file = index & 7;
    var color = board[index].color;
    var count = 0;
    var deltas = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var d = 0; d < 4; d++) {
      var r = rank + deltas[d][0], f = file + deltas[d][1];
      while (r >= 0 && r < 8 && f >= 0 && f < 8) {
        var occ = board[r * 8 + f];
        if (occ) {
          if (occ.color !== color) count++;
          break;
        }
        count++;
        r += deltas[d][0];
        f += deltas[d][1];
      }
    }
    return count;
  }

  function edgeDistance(index) {
    var rank = index >> 3, file = index & 7;
    return Math.min(rank, 7 - rank, file, 7 - file);
  }

  function kingDistance(a, b) {
    return Math.max(Math.abs((a >> 3) - (b >> 3)), Math.abs((a & 7) - (b & 7)));
  }

  // With the loser reduced to a bare Sdaach, material tells the search nothing
  // it does not already know and every move looks alike. These two terms are
  // the gradient that turns "winning" into "winning by move 40": drive the
  // lone king to the rim, and bring your own king up to help. Kept under a
  // pawn so it can never outweigh material.
  function mateDriveScore(winnerKing, loserKing) {
    return (3 - edgeDistance(loserKing)) * 12 + (7 - kingDistance(winnerKing, loserKing)) * 8;
  }

  // An advantage you cannot convert before the count expires is not worth what
  // the material says. Scaling the leader's score down as the budget is spent
  // is what makes the search prefer the line that mates in eight over the line
  // that wins another Touk in twelve — the second one is a draw.
  function countingPressure(score, state) {
    var counting = state.counting;
    if (!counting || !counting.active || !counting.budget || counting.budget <= 0) return score;
    var remaining = counting.budget - counting.elapsed;
    if (remaining <= 0) return 0;
    var urgency = remaining / counting.budget;
    // 0.35 at the buzzer rather than 0: the leader should still prefer being a
    // Touk up when the count resets, and captures do reset the no-progress one.
    var damping = 0.35 + 0.65 * urgency;
    var leaderIsWhite = score > 0;
    if (counting.trigger === 'bareKing' && counting.disadvantagedColor) {
      leaderIsWhite = counting.disadvantagedColor === 'b';
      if ((leaderIsWhite && score <= 0) || (!leaderIsWhite && score >= 0)) return score;
    }
    return Math.round(score * damping);
  }

  // White-relative score in centipawns.
  function evaluateCp(state) {
    var board = state.board;
    var score = 0;
    var phaseMaterial = 0;
    var kingIndex = { w: -1, b: -1 };
    var otherPieces = { w: 0, b: 0 };

    for (var i = 0; i < 64; i++) {
      var piece = board[i];
      if (!piece) continue;
      var white = piece.color === 'w';

      if (piece.type === 'K') {
        kingIndex[piece.color] = i;
        continue;
      }
      otherPieces[piece.color]++;

      // Black reads the tables with the rank mirrored; the file is left alone
      // because every table is file-symmetric anyway.
      var pstIndex = white ? i : (7 - (i >> 3)) * 8 + (i & 7);
      var value = VALUE[piece.type] + PST[piece.type][pstIndex];
      if (piece.type !== 'P') phaseMaterial += VALUE[piece.type];
      if (piece.type === 'R') value += rookMobility(board, i) * ROOK_MOBILITY_CP;

      score += white ? value : -value;
    }

    // Blend the two king tables by how much material is still on: a king that
    // should hide behind its Trey line at move ten should be in the middle of
    // the board at move sixty, and nothing in between should be a cliff edge.
    var phase = phaseMaterial > PHASE_MAX ? 1 : phaseMaterial / PHASE_MAX;
    var colors = ['w', 'b'];
    for (var c = 0; c < 2; c++) {
      var index = kingIndex[colors[c]];
      if (index < 0) continue;
      var kIndex = colors[c] === 'w' ? index : (7 - (index >> 3)) * 8 + (index & 7);
      var king = Math.round(PST_K_MID[kIndex] * phase + PST_K_END[kIndex] * (1 - phase));
      score += colors[c] === 'w' ? king : -king;
    }

    if (kingIndex.w >= 0 && kingIndex.b >= 0) {
      if (otherPieces.b === 0 && otherPieces.w > 0) {
        score += mateDriveScore(kingIndex.w, kingIndex.b);
      } else if (otherPieces.w === 0 && otherPieces.b > 0) {
        score -= mateDriveScore(kingIndex.b, kingIndex.w);
      }
    }

    return countingPressure(score, state);
  }

  // Public evaluation, in pawn units and from White's point of view — the scale
  // src/review.js classifies swings on.
  function evaluate(state) {
    return evaluateCp(state) / 100;
  }

  // ---------------------------------------------------------------------------
  // Position hashing
  //
  // Zobrist, split across two 32-bit halves and folded into one 53-bit float so
  // it can key a plain Map. The hash covers everything a score depends on: the
  // board, the side to move, the three first-move flags, and the counting
  // clock — two identical boards with different counts are different positions,
  // because one of them is closer to being a draw.
  // ---------------------------------------------------------------------------

  var PIECE_ORDER = { P: 0, N: 1, B: 2, R: 3, Q: 4, K: 5 };
  var COUNT_SLOTS = 128;

  function randomTable(size, seed) {
    var state = seed >>> 0;
    var table = new Int32Array(size);
    for (var i = 0; i < size; i++) {
      state ^= state << 13; state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5; state >>>= 0;
      table[i] = state | 0;
    }
    return table;
  }

  var Z_PIECE_HI = randomTable(64 * 12, 0x9e3779b9);
  var Z_PIECE_LO = randomTable(64 * 12, 0x85ebca6b);
  var Z_FLAG_HI = randomTable(8, 0xc2b2ae35);
  var Z_FLAG_LO = randomTable(8, 0x27d4eb2f);
  var Z_COUNT_HI = randomTable(COUNT_SLOTS * 3, 0x165667b1);
  var Z_COUNT_LO = randomTable(COUNT_SLOTS * 3, 0xd3a2646c);

  function hashState(state) {
    var hi = 0, lo = 0;
    var board = state.board;
    for (var i = 0; i < 64; i++) {
      var piece = board[i];
      if (!piece) continue;
      var slot = i * 12 + PIECE_ORDER[piece.type] * 2 + (piece.color === 'w' ? 0 : 1);
      hi ^= Z_PIECE_HI[slot];
      lo ^= Z_PIECE_LO[slot];
    }
    if (state.turn === 'b') { hi ^= Z_FLAG_HI[0]; lo ^= Z_FLAG_LO[0]; }
    if (state.anyCaptureYet) { hi ^= Z_FLAG_HI[1]; lo ^= Z_FLAG_LO[1]; }
    if (state.kingHasMoved.w) { hi ^= Z_FLAG_HI[2]; lo ^= Z_FLAG_LO[2]; }
    if (state.kingHasMoved.b) { hi ^= Z_FLAG_HI[3]; lo ^= Z_FLAG_LO[3]; }
    if (state.queenHasMoved.w) { hi ^= Z_FLAG_HI[4]; lo ^= Z_FLAG_LO[4]; }
    if (state.queenHasMoved.b) { hi ^= Z_FLAG_HI[5]; lo ^= Z_FLAG_LO[5]; }

    var counting = state.counting;
    if (counting && counting.active) {
      var trigger = counting.trigger === 'bareKing' ? 1 : 2;
      var elapsed = Math.min(Math.max(counting.elapsed | 0, 0), COUNT_SLOTS - 1);
      var budget = Math.min(Math.max(counting.budget | 0, 0), COUNT_SLOTS - 1);
      var slots = [trigger * COUNT_SLOTS, COUNT_SLOTS + elapsed, 2 * COUNT_SLOTS + budget];
      for (var s = 0; s < 3; s++) {
        var k = slots[s] % (COUNT_SLOTS * 3);
        hi ^= Z_COUNT_HI[k];
        lo ^= Z_COUNT_LO[k];
      }
      if (counting.disadvantagedColor === 'w') { hi ^= Z_FLAG_HI[6]; lo ^= Z_FLAG_LO[6]; }
      if (counting.disadvantagedColor === 'b') { hi ^= Z_FLAG_HI[7]; lo ^= Z_FLAG_LO[7]; }
    }

    // 21 bits of the high word above the full 32 of the low word: 53 bits, the
    // most a double holds exactly, so distinct keys stay distinct.
    return ((hi >>> 0) & 0x1fffff) * 4294967296 + (lo >>> 0);
  }

  // ---------------------------------------------------------------------------
  // Transposition table
  // ---------------------------------------------------------------------------

  var TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;
  var TT_MAX_ENTRIES = 150000;
  var tt = new Map();
  var generation = 0;
  // Whether what is currently in the table was scored with evaluation noise on.
  var ttNoisy = false;

  // Mate scores are stored relative to the position, not to the root, or a
  // "mate in 3" found at ply 8 would be read back at ply 2 as a mate in 9.
  function scoreToTT(score, ply) {
    if (score >= MATE_THRESHOLD) return score + ply;
    if (score <= -MATE_THRESHOLD) return score - ply;
    return score;
  }

  function scoreFromTT(score, ply) {
    if (score >= MATE_THRESHOLD) return score - ply;
    if (score <= -MATE_THRESHOLD) return score + ply;
    return score;
  }

  function ttStore(key, depth, score, flag, move, ply) {
    var existing = tt.get(key);
    // Depth-preferred: a shallow result must not evict a deep one.
    if (existing && existing.depth > depth && existing.generation === generation) return;
    if (!existing && tt.size >= TT_MAX_ENTRIES) tt.clear();
    tt.set(key, {
      depth: depth,
      score: scoreToTT(score, ply),
      flag: flag,
      move: move,
      generation: generation
    });
  }

  // ---------------------------------------------------------------------------
  // Move ordering
  //
  // Alpha-beta only pays for itself when the best move is tried first, so this
  // is not a nicety: it is most of the search's strength. Order is transposition
  // move, then captures by MVV-LVA, then promotions, then the two killers for
  // this ply, then the history score.
  // ---------------------------------------------------------------------------

  // from-square and to-square identify a move uniquely here: nothing can reach
  // the same square both normally and as a Sdaach jump, a Neang double step or
  // a promotion.
  function moveKey(move) {
    return (move.from.rank * 8 + move.from.file) * 64 + (move.to.rank * 8 + move.to.file);
  }

  var MAX_PLY = 64;
  var killers = [];
  var historyTable = { w: new Int32Array(4096), b: new Int32Array(4096) };

  function resetKillers() {
    killers = new Array(MAX_PLY + 8);
    for (var i = 0; i < killers.length; i++) killers[i] = [-1, -1];
  }
  resetKillers();

  function recordKiller(ply, move) {
    if (ply >= killers.length || move.captured) return;
    var slot = killers[ply];
    var key = moveKey(move);
    if (slot[0] === key) return;
    slot[1] = slot[0];
    slot[0] = key;
  }

  function recordHistory(color, move, depth) {
    if (move.captured) return;
    var table = historyTable[color];
    var key = moveKey(move);
    table[key] += depth * depth;
    if (table[key] > 1 << 24) {
      for (var i = 0; i < 4096; i++) table[i] >>= 1;
    }
  }

  function ageHistory() {
    for (var c = 0; c < 2; c++) {
      var table = c === 0 ? historyTable.w : historyTable.b;
      for (var i = 0; i < 4096; i++) table[i] >>= 1;
    }
  }

  function scoreMoves(state, moves, ttMove, ply) {
    var slot = ply < killers.length ? killers[ply] : null;
    var table = historyTable[state.turn];
    var scores = new Array(moves.length);
    for (var i = 0; i < moves.length; i++) {
      var move = moves[i];
      var key = moveKey(move);
      if (key === ttMove) {
        scores[i] = 10000000;
      } else if (move.captured) {
        // Most valuable victim, least valuable attacker.
        scores[i] = 5000000 + VALUE[move.captured.type] * 16 - VALUE[move.piece.type];
      } else if (move.special === 'promotion') {
        scores[i] = 4000000;
      } else if (slot && slot[0] === key) {
        scores[i] = 3000000;
      } else if (slot && slot[1] === key) {
        scores[i] = 2900000;
      } else {
        scores[i] = table[key];
      }
    }
    return scores;
  }

  // Selection sort, one step at a time from inside the move loop: a node that
  // cuts off after two moves should not have paid to order thirty.
  function selectNext(moves, scores, from) {
    var best = from;
    for (var i = from + 1; i < moves.length; i++) {
      if (scores[i] > scores[best]) best = i;
    }
    if (best === from) return;
    var m = moves[from]; moves[from] = moves[best]; moves[best] = m;
    var s = scores[from]; scores[from] = scores[best]; scores[best] = s;
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  var ABORT = { abort: true };
  var deadline = 0;
  var nodes = 0;
  var evalNoiseCp = 0;
  var noiseSalt = 0;

  function checkTime() {
    nodes++;
    // Date.now() at every node would cost more than the nodes do. Checking
    // every 1024 puts the worst measured overshoot at about 40ms, which is
    // close enough for a budget counted in hundreds of them.
    if (deadline !== 0 && (nodes & 1023) === 0 && Date.now() >= deadline) throw ABORT;
  }

  // Difficulty, done by blurring the engine's eyesight rather than by cutting
  // its depth alone. A shallow but exact engine plays sound, dull moves and
  // still wins every material race; one that misjudges each position by a few
  // tenths of a Trey drops a pawn now and then, the way a human does. The
  // offset is derived from the position hash so it stays consistent within a
  // search — an evaluation that changed between two visits to the same node
  // would make alpha-beta return nonsense.
  function noiseFor(state) {
    if (evalNoiseCp === 0) return 0;
    var key = hashState(state) + noiseSalt;
    var span = evalNoiseCp * 2 + 1;
    return Math.floor(key % span) - evalNoiseCp;
  }

  function relativeEval(state) {
    var score = evaluateCp(state) + noiseFor(state);
    return state.turn === 'w' ? score : -score;
  }

  function terminalScore(state, ply) {
    if (state.status === 'checkmate') return -(MATE_SCORE - ply);
    // Stalemate and both counting draws. This one check is the whole mechanism
    // by which the search is counting-aware: applyMove has already resolved the
    // counting rule into state.status.
    return 0;
  }

  var QUIESCENCE_MAX_PLY = 6;
  var DELTA_MARGIN = 200;

  function isTactical(move) {
    return !!move.captured || move.special === 'promotion';
  }

  // Standing still at depth 0 in the middle of a capture sequence is how an
  // engine convinces itself it has won a piece one ply before losing two. The
  // quiescence search keeps going until the position is quiet — or until the
  // side to move is happy to stop, which is what the stand-pat score means.
  function quiesce(state, alpha, beta, ply, qply) {
    if (state.status !== 'active') return terminalScore(state, ply);
    checkTime();

    // In check there is nothing quiet about the position and no option to
    // stand pat, so every legal move is examined, not just the captures.
    var inCheck = OukEngine.isInCheck(state, state.turn);
    var standPat = -INF;

    if (!inCheck) {
      standPat = relativeEval(state);
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
      if (qply >= QUIESCENCE_MAX_PLY) return standPat;
    } else if (qply >= QUIESCENCE_MAX_PLY) {
      return relativeEval(state);
    }

    var legal = OukEngine.generateLegalMoves(state, state.turn);
    var moves = inCheck ? legal : legal.filter(isTactical);
    if (moves.length === 0) return inCheck ? relativeEval(state) : standPat;

    var scores = scoreMoves(state, moves, -1, ply);
    var best = standPat;

    for (var i = 0; i < moves.length; i++) {
      selectNext(moves, scores, i);
      var move = moves[i];

      // Delta pruning: even winning this piece for free would not drag the
      // score up to alpha, so the line cannot matter. Never while in check —
      // there the moves are not optional.
      if (!inCheck && move.captured &&
          standPat + VALUE[move.captured.type] + DELTA_MARGIN < alpha) continue;

      var score = -quiesce(OukEngine.applyMove(state, move), -beta, -alpha, ply + 1, qply + 1);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }

    return best;
  }

  function search(state, depth, ply, alpha, beta) {
    if (state.status !== 'active') return terminalScore(state, ply);
    if (depth <= 0) return quiesce(state, alpha, beta, ply, 0);
    checkTime();

    var key = hashState(state);
    var entry = tt.get(key);
    var ttMove = -1;

    if (entry) {
      ttMove = entry.move;
      if (entry.depth >= depth) {
        var stored = scoreFromTT(entry.score, ply);
        if (entry.flag === TT_EXACT) return stored;
        if (entry.flag === TT_LOWER) { if (stored > alpha) alpha = stored; }
        else if (stored < beta) beta = stored;
        if (alpha >= beta) return stored;
      }
    }

    // The window the moves are actually searched with, which is what decides
    // whether the result is an exact score or only a bound on one.
    var alphaAtEntry = alpha;
    var betaAtEntry = beta;

    // status === 'active' guarantees at least one legal move exists.
    var moves = OukEngine.generateLegalMoves(state, state.turn);
    var scores = scoreMoves(state, moves, ttMove, ply);
    var best = -INF;
    var bestMove = -1;

    for (var i = 0; i < moves.length; i++) {
      selectNext(moves, scores, i);
      var move = moves[i];
      var child = OukEngine.applyMove(state, move);
      var score;

      if (i === 0) {
        score = -search(child, depth - 1, ply + 1, -beta, -alpha);
      } else {
        // Late move reductions: once the ordering has been wrong three times
        // in a row the remaining quiet moves are unlikely to be best, so look
        // at them a ply shallower and only pay full price if one surprises us.
        var reduction = (depth >= 3 && i >= 3 && !move.captured && !move.special) ? 1 : 0;
        score = -search(child, depth - 1 - reduction, ply + 1, -alpha - 1, -alpha);
        if (score > alpha && (reduction > 0 || score < beta)) {
          score = -search(child, depth - 1, ply + 1, -beta, -alpha);
        }
      }

      if (score > best) {
        best = score;
        bestMove = moveKey(move);
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        recordKiller(ply, move);
        recordHistory(state.turn, move, depth);
        break;
      }
    }

    var flag = best <= alphaAtEntry ? TT_UPPER : (best >= betaAtEntry ? TT_LOWER : TT_EXACT);
    ttStore(key, depth, best, flag, bestMove, ply);
    return best;
  }

  // Deliberately kept in module scope: when the clock runs out mid-iteration
  // the stack unwinds through an exception, and whatever the root had already
  // established has to survive that.
  var rootBestMove = null;
  var rootBestScore = -INF;
  var rootMovesDone = 0;

  function searchRoot(state, depth, previousBest) {
    var moves = OukEngine.generateLegalMoves(state, state.turn);
    if (moves.length === 0) return null;

    var scores = scoreMoves(state, moves, previousBest, 0);
    var alpha = -INF, beta = INF;
    var best = null, bestScore = -INF;

    rootBestMove = null;
    rootBestScore = -INF;
    rootMovesDone = 0;

    for (var i = 0; i < moves.length; i++) {
      selectNext(moves, scores, i);
      var move = moves[i];
      var child = OukEngine.applyMove(state, move);
      var score;

      if (i === 0) {
        score = -search(child, depth - 1, 1, -beta, -alpha);
      } else {
        score = -search(child, depth - 1, 1, -alpha - 1, -alpha);
        if (score > alpha) score = -search(child, depth - 1, 1, -beta, -alpha);
      }

      if (score > bestScore) {
        bestScore = score;
        best = move;
        rootBestMove = move;
        rootBestScore = score;
      }
      if (bestScore > alpha) alpha = bestScore;
      rootMovesDone++;
    }

    return { move: best, score: bestScore };
  }

  // ---------------------------------------------------------------------------
  // Public search entry points
  // ---------------------------------------------------------------------------

  function firstLegalMove(state) {
    var moves = OukEngine.generateLegalMoves(state, state.turn);
    return moves.length ? moves[0] : null;
  }

  // Full search result: the move, what the engine thinks of it, how deep it
  // got and how many nodes that took. chooseMove is this with everything but
  // the move thrown away.
  function analyze(state, options) {
    options = options || {};
    if (!state || state.status !== 'active') return null;

    var timeLimitMs = options.timeLimitMs || 1000;
    var maxDepth = options.maxDepth || 6;
    var noise = options.evalNoiseCp || 0;

    // A noisy evaluation is a different evaluation, and the table remembers
    // scores, not positions. Entries scored with one salt must not be read back
    // under another, or by the exact search that follows a blurred one.
    if (noise !== 0 || ttNoisy) tt.clear();
    ttNoisy = noise !== 0;
    evalNoiseCp = noise;
    noiseSalt = noise === 0 ? 0 : Math.floor(Math.random() * 1000000);

    deadline = Date.now() + timeLimitMs;
    nodes = 0;
    generation++;
    resetKillers();
    ageHistory();

    var best = null;
    var completedDepth = 0;
    var aborted = false;

    try {
      // Iterative deepening. Each pass is not wasted work: it leaves the
      // transposition table and the history scores primed so the next, deeper
      // pass finds the good move first and prunes almost everything else.
      for (var depth = 1; depth <= maxDepth; depth++) {
        var result;
        try {
          result = searchRoot(state, depth, best ? moveKey(best.move) : -1);
        } catch (error) {
          if (error !== ABORT) throw error;
          aborted = true;
          // A partial iteration is still usable as long as one root move was
          // searched to completion: the ordering put the previous best first,
          // so anything that displaced it did so on a full-depth score.
          if (rootMovesDone > 0 && rootBestMove) {
            best = { move: rootBestMove, score: rootBestScore };
          }
          break;
        }

        if (!result) break;
        best = result;
        completedDepth = depth;
        if (Date.now() >= deadline) break;
        // Mate found: deeper searching cannot improve on it.
        if (Math.abs(result.score) >= MATE_THRESHOLD) break;
      }
    } finally {
      // Both of these are read by the search itself, so leaving either set
      // would quietly change what the *next* caller gets.
      deadline = 0;
      evalNoiseCp = 0;
    }

    if (!best || !best.move) {
      var fallback = firstLegalMove(state);
      return fallback ? { move: fallback, scoreCp: 0, score: 0, depth: 0, nodes: nodes, mateIn: null, aborted: aborted } : null;
    }

    var mateIn = null;
    if (Math.abs(best.score) >= MATE_THRESHOLD) {
      var plies = MATE_SCORE - Math.abs(best.score);
      mateIn = Math.ceil(plies / 2) * (best.score > 0 ? 1 : -1);
    }

    return {
      move: best.move,
      scoreCp: best.score,
      score: best.score / 100,
      depth: completedDepth,
      nodes: nodes,
      mateIn: mateIn,
      aborted: aborted
    };
  }

  function chooseMove(state, options) {
    var result = analyze(state, options);
    return result ? result.move : null;
  }

  // Public negamax, kept at its original signature. The window is clamped
  // because the search narrows it with `-alpha - 1`, and doing that to
  // Infinity yields a window nothing can score inside.
  function negamax(state, depth, ply, alpha, beta) {
    return search(
      state,
      depth,
      ply,
      alpha === undefined ? -INF : Math.max(alpha, -INF),
      beta === undefined ? INF : Math.min(beta, INF)
    );
  }

  // A hint is advice to the human player, so it always searches at one fixed
  // strength rather than the opponent's difficulty setting - a hint from the
  // "easy" engine would be bad advice.
  var HINT_OPTIONS = { timeLimitMs: 800, maxDepth: 6 };

  // The full hint: the move, and what the engine makes of the position it
  // leads to, so the board can say why it is suggesting this rather than
  // leaving an arrow to speak for itself.
  function suggest(state) {
    return analyze(state, HINT_OPTIONS);
  }

  function suggestMove(state) {
    var result = suggest(state);
    return result ? result.move : null;
  }

  var api = {
    evaluate: evaluate,
    evaluateCp: evaluateCp,
    suggest: suggest,
    suggestMove: suggestMove,
    negamax: negamax,
    analyze: analyze,
    MATE_SCORE: MATE_SCORE,
    MATE_THRESHOLD: MATE_THRESHOLD,
    chooseMove: chooseMove,
    hashState: hashState,
    // Exposed for the piece-square symmetry test, which is what guarantees
    // evaluate() is exactly 0 on the opening position.
    PIECE_SQUARE_TABLES: { P: PST_P, Q: PST_Q, B: PST_B, N: PST_N, R: PST_R, KMid: PST_K_MID, KEnd: PST_K_END }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukAI = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
