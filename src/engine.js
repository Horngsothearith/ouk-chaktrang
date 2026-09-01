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

  // Board/bookkeeping transition only — deliberately does NOT compute
  // status or counting. generateLegalMoves calls this (via isInCheck) once
  // per candidate move to test king safety; if it called the full applyMove
  // instead, computing one move's status would recursively require
  // computing every future ply's status too (deriveStatus ->
  // generateLegalMoves -> applyMove -> deriveStatus -> ...), which never
  // terminates. Only the public applyMove (below) finalizes status.
  function applyMoveRaw(state, move) {
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

  // Priority-ordered extrapolation of the documented table for material
  // combinations it doesn't explicitly name (see spec/plan Global Constraints).
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
      var elapsed = 0;
      if (sameCount) {
        elapsed = moverColor === advantaged ? prevCounting.elapsed + 1 : prevCounting.elapsed;
      }
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

  function applyMove(state, move) {
    var next = applyMoveRaw(state, move);
    var derived = deriveStatus(next);
    next.status = derived.status;
    next.winner = derived.winner;

    var mover = state.turn;
    next.counting = updateCounting(state.counting, next, mover);
    if (move.captured && next.counting.trigger === 'noProgress') {
      // A capture resets the no-progress clock even though both sides
      // remain pawnless (the trigger condition is unaffected by the capture).
      next.counting.elapsed = 0;
    }
    if (next.status === 'active' && next.counting.active && next.counting.elapsed >= next.counting.budget) {
      next.status = next.counting.trigger === 'bareKing' ? 'draw-counting' : 'draw-noprogress';
      next.winner = null;
    }
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

  function addKingJumpIfEligible(state, rank, file, piece, out) {
    if (state.anyCaptureYet) return;
    if (state.kingHasMoved[piece.color]) return;
    if (isInCheck(state, piece.color)) return;
    KNIGHT_STEPS.forEach(function (d) {
      var r2 = rank + d[0], f2 = file + d[1];
      if (!inBounds(r2, f2)) return;
      var occ = pieceAt(state, r2, f2);
      if (occ && occ.color === piece.color) return;
      // Judgment call (see spec/plan Global Constraints): capturing is
      // allowed on this jump, matching a literal "moves like a horse" reading.
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

  function generateLegalMoves(state, color) {
    var legal = [];
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var p = pieceAt(state, r, f);
        if (!p || p.color !== color) continue;
        var candidates = generatePseudoMoves(state, r, f);
        for (var i = 0; i < candidates.length; i++) {
          var resulting = applyMoveRaw(state, candidates[i]);
          if (!isInCheck(resulting, color)) legal.push(candidates[i]);
        }
      }
    }
    return legal;
  }

  function deriveStatus(state) {
    var sideToMove = state.turn;
    var inCheck = isInCheck(state, sideToMove);
    var hasMoves = generateLegalMoves(state, sideToMove).length > 0;
    if (!hasMoves && inCheck) return { status: 'checkmate', winner: opposite(sideToMove) };
    if (!hasMoves && !inCheck) return { status: 'stalemate', winner: null };
    return { status: 'active', winner: null };
  }

  function formatSingleMove(mv) {
    var from = squareName(mv.from.rank, mv.from.file);
    var to = squareName(mv.to.rank, mv.to.file);
    var sep = mv.captured ? 'x' : '-';
    var promo = mv.special === 'promotion' ? '=Q' : '';
    return from + sep + to + promo;
  }

  function exportMoveNotation(history) {
    if (!history || history.length === 0) return '';
    var pairs = [];
    for (var i = 0; i < history.length; i += 2) {
      var moveNum = Math.floor(i / 2) + 1;
      var wMove = formatSingleMove(history[i]);
      var bMove = (i + 1 < history.length) ? ' ' + formatSingleMove(history[i + 1]) : '';
      pairs.push(moveNum + '. ' + wMove + bMove);
    }
    return pairs.join(' ');
  }

  function serializeGame(state, metadata) {
    metadata = metadata || {};
    var history = (state && state.history) || [];
    var moves = history.map(function (mv) {
      return {
        from: squareName(mv.from.rank, mv.from.file),
        to: squareName(mv.to.rank, mv.to.file),
        piece: mv.piece ? mv.piece.type : null,
        captured: mv.captured ? mv.captured.type : null,
        special: mv.special || null
      };
    });

    return {
      version: 1,
      format: 'ouk-chaktrong',
      id: metadata.id || ('ouk_game_' + Date.now()),
      name: metadata.name || ('Game ' + new Date().toLocaleDateString()),
      savedAt: metadata.savedAt || new Date().toISOString(),
      mode: metadata.mode || '2p',
      aiColor: metadata.aiColor || 'b',
      difficulty: metadata.difficulty || 'medium',
      aiOptions: metadata.aiOptions || null,
      moveReviews: metadata.moveReviews || {},
      moves: moves,
      notation: exportMoveNotation(history),
      status: state ? state.status : 'active',
      winner: state ? state.winner : null,
      plyCount: history.length
    };
  }

  function deserializeGame(data) {
    if (!data) throw new Error('No data provided to deserializeGame');
    var obj = data;
    if (typeof data === 'string') {
      try {
        obj = JSON.parse(data);
      } catch (e) {
        throw new Error('Invalid JSON format: ' + e.message);
      }
    }
    if (!obj || typeof obj !== 'object') {
      throw new Error('Invalid game data structure');
    }

    var rawMoves = obj.moves || obj.history || [];
    if (!Array.isArray(rawMoves)) {
      throw new Error('Game moves must be an array');
    }

    var state = createInitialState();
    for (var i = 0; i < rawMoves.length; i++) {
      var item = rawMoves[i];
      var fromRank, fromFile, toRank, toFile, specialReq = null;

      if (typeof item === 'string') {
        // e.g. "e3-e4" or "e3xe4" or "c6-c7=Q"
        var clean = item.replace(/^\d+\.\s*/, '').trim();
        var parts = clean.split(/[-x]/);
        if (parts.length < 2) throw new Error('Invalid move string format at ply ' + (i + 1) + ': ' + item);
        var fSq = parseSquare(parts[0].slice(-2));
        var tSq = parseSquare(parts[1].slice(0, 2));
        fromRank = fSq.rank; fromFile = fSq.file;
        toRank = tSq.rank; toFile = tSq.file;
      } else if (item && typeof item === 'object') {
        if (typeof item.from === 'string') {
          var f = parseSquare(item.from);
          fromRank = f.rank; fromFile = f.file;
        } else if (item.from && typeof item.from.rank === 'number') {
          fromRank = item.from.rank; fromFile = item.from.file;
        }
        if (typeof item.to === 'string') {
          var t = parseSquare(item.to);
          toRank = t.rank; toFile = t.file;
        } else if (item.to && typeof item.to.rank === 'number') {
          toRank = item.to.rank; toFile = item.to.file;
        }
        specialReq = item.special || null;
      }

      if (fromRank === undefined || fromFile === undefined || toRank === undefined || toFile === undefined) {
        throw new Error('Malformed move coordinates at ply ' + (i + 1));
      }

      var legals = generateLegalMoves(state, state.turn);
      var match = legals.find(function (m) {
        if (m.from.rank !== fromRank || m.from.file !== fromFile) return false;
        if (m.to.rank !== toRank || m.to.file !== toFile) return false;
        if (specialReq && m.special !== specialReq) return false;
        return true;
      });

      if (!match) {
        var fromName = squareName(fromRank, fromFile);
        var toName = squareName(toRank, toFile);
        throw new Error('Illegal move at ply ' + (i + 1) + ': ' + fromName + '-' + toName + ' for ' + (state.turn === 'w' ? 'White' : 'Black'));
      }

      state = applyMove(state, match);
    }

    return {
      gameState: state,
      metadata: {
        id: obj.id || ('ouk_game_' + Date.now()),
        name: obj.name || 'Imported Game',
        savedAt: obj.savedAt || new Date().toISOString(),
        mode: obj.mode || '2p',
        aiColor: obj.aiColor || 'b',
        difficulty: obj.difficulty || 'medium',
        aiOptions: obj.aiOptions || null,
        moveReviews: obj.moveReviews || {}
      }
    };
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
    findKing: findKing,
    deriveStatus: deriveStatus,
    materialTier: materialTier,
    countAllPieces: countAllPieces,
    hasPawns: hasPawns,
    isBareKing: isBareKing,
    undoMove: undoMove,
    exportMoveNotation: exportMoveNotation,
    serializeGame: serializeGame,
    deserializeGame: deserializeGame
  };

  function undoMove(state) {
    if (!state || !state.history || state.history.length === 0) return state;
    var targetLength = state.history.length - 1;
    var nextState = createInitialState();
    for (var i = 0; i < targetLength; i++) {
      nextState = applyMove(nextState, state.history[i]);
    }
    return nextState;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
