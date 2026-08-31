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

  var api = {
    evaluate: evaluate,
    negamax: negamax,
    MATE_SCORE: MATE_SCORE
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukAI = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
