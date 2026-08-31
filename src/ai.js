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

  var MATE_SCORE = 100000;

  function negamax(state, depth, ply, alpha, beta) {
    if (state.status !== 'active') {
      if (state.status === 'checkmate') {
        // state.turn has no moves and is checkmated: worst possible outcome
        // for state.turn. Subtracting ply prefers faster mates.
        return -(MATE_SCORE - ply);
      }
      // stalemate, draw-counting, draw-noprogress: all plain draws. This one
      // check is the entire mechanism by which the AI is counting-aware —
      // applyMove already resolved the counting rule into state.status.
      return 0;
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
      if (alpha >= beta) break;
    }
    return best;
  }

  function orderMoves(moves) {
    // Cheap move ordering: captures first (most valuable victim first).
    // Meaningfully improves alpha-beta pruning without a real static
    // exchange evaluation - good enough at this engine's search depth.
    return moves.slice().sort(function (a, b) {
      var av = a.captured ? PIECE_VALUES[a.captured.type] : -1;
      var bv = b.captured ? PIECE_VALUES[b.captured.type] : -1;
      return bv - av;
    });
  }

  function searchRoot(state, depth, deadline) {
    var moves = orderMoves(OukEngine.generateLegalMoves(state, state.turn));
    var bestMove = moves[0];
    var bestScore = -Infinity;
    var alpha = -Infinity, beta = Infinity;
    for (var i = 0; i < moves.length; i++) {
      if (deadline && i > 0 && Date.now() >= deadline) break;
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
      if (depth > 1 && Date.now() >= deadline) break;
      var result = searchRoot(state, depth, deadline);
      best = result.move;
      if (Date.now() >= deadline) break;
      if (result.score >= MATE_SCORE - 100) break;
    }
    return best;
  }

  // A hint is advice to the human player, so it always searches at one fixed
  // strength rather than the opponent's difficulty setting - a hint from the
  // "easy" engine would be bad advice.
  var HINT_OPTIONS = { timeLimitMs: 800, maxDepth: 5 };

  function suggestMove(state) {
    // searchRoot takes moves[0] of an empty move list, so asking a finished
    // position for a move yields undefined. Say null instead, once, here.
    if (state.status !== 'active') return null;
    return chooseMove(state, HINT_OPTIONS);
  }

  var api = {
    evaluate: evaluate,
    suggestMove: suggestMove,
    negamax: negamax,
    MATE_SCORE: MATE_SCORE,
    chooseMove: chooseMove
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukAI = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
