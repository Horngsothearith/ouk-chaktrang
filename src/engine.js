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

  // Pawns start on rank index 2 (White) / 5 (Black) and promote on reaching
  // the rank where the OPPONENT's pawns started.
  var WHITE_PROMOTION_RANK = 5; // display rank 6
  var BLACK_PROMOTION_RANK = 2; // display rank 3

  function promotionRankFor(color) {
    return color === 'w' ? WHITE_PROMOTION_RANK : BLACK_PROMOTION_RANK;
  }

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
        pawnMoves(state, rank, file, piece, out);
        break;
    }
    return out;
  }

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

  // Attack detection deliberately does NOT reuse pawnMoves()'s forward-step
  // logic: a pawn's forward move requires an empty destination and is not a
  // threat, while its diagonal squares are threatened regardless of whether
  // anything currently occupies them. Reusing generateBaseMoves verbatim for
  // pawns would report the empty square ahead as "attacked", which is wrong.
  function pawnAttackSquares(rank, file, color) {
    var dir = color === 'w' ? 1 : -1;
    var r1 = rank + dir;
    var squares = [];
    [-1, 1].forEach(function (df) {
      var f2 = file + df;
      if (inBounds(r1, f2)) squares.push({ rank: r1, file: f2 });
    });
    return squares;
  }

  function isSquareAttacked(state, rank, file, byColor) {
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var p = pieceAt(state, r, f);
        if (!p || p.color !== byColor) continue;
        if (p.type === 'P') {
          var attacks = pawnAttackSquares(r, f, byColor);
          for (var k = 0; k < attacks.length; k++) {
            if (attacks[k].rank === rank && attacks[k].file === file) return true;
          }
          continue;
        }
        // Base patterns only: the first-move exceptions (Task 6) are move
        // options, not standing threats, and including them here would make
        // isInCheck depend circularly on their own eligibility check.
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
    // Task 6 extends this with the two Cambodia-specific first-move options.
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

  var api = {
    squareName: squareName,
    parseSquare: parseSquare,
    inBounds: inBounds,
    createInitialState: createInitialState,
    pieceAt: pieceAt,
    generateBaseMoves: generateBaseMoves,
    opposite: opposite,
    applyMove: applyMove,
    promotionRankFor: promotionRankFor,
    isSquareAttacked: isSquareAttacked,
    isInCheck: isInCheck,
    generatePseudoMoves: generatePseudoMoves,
    generateLegalMoves: generateLegalMoves,
    findKing: findKing
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
