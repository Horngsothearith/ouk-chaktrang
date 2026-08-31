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
