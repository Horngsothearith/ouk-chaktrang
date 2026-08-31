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
