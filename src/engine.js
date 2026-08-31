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
    var forward = color === 'w' ? [1, 0] : [-1, 0];
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

  var api = {
    squareName: squareName,
    parseSquare: parseSquare,
    inBounds: inBounds,
    createInitialState: createInitialState,
    pieceAt: pieceAt,
    generateBaseMoves: generateBaseMoves,
    opposite: opposite
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
