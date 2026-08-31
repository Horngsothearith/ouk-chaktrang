(function (root) {
  'use strict';

  var OukEngine = root.OukEngine;
  var OukPieces = root.OukPieces;

  function squareColorClass(rank, file) {
    return (rank + file) % 2 === 0 ? 'dark' : 'light';
  }

  function renderBoard(gameState, containerEl) {
    containerEl.innerHTML = '';
    // Engine rank 0 (White's back rank) renders at the BOTTOM of the screen,
    // so iterate display rows top (engine rank 7) to bottom (engine rank 0).
    for (var displayRow = 0; displayRow < 8; displayRow++) {
      var rank = 7 - displayRow;
      for (var file = 0; file < 8; file++) {
        var sq = document.createElement('div');
        sq.className = 'oc-square ' + squareColorClass(rank, file);
        sq.dataset.rank = String(rank);
        sq.dataset.file = String(file);
        var piece = OukEngine.pieceAt(gameState, rank, file);
        if (piece) sq.innerHTML = OukPieces.svgFor(piece.type, piece.color);
        containerEl.appendChild(sq);
      }
    }
  }

  function createApp(els) {
    var appState = {
      gameState: OukEngine.createInitialState(),
      selectedSquare: null,
      legalMovesForSelected: []
    };

    function render() {
      renderBoard(appState.gameState, els.board);
      if (appState.selectedSquare) {
        var selEl = els.board.querySelector(
          '.oc-square[data-rank="' + appState.selectedSquare.rank + '"][data-file="' + appState.selectedSquare.file + '"]'
        );
        if (selEl) selEl.classList.add('selected');
        appState.legalMovesForSelected.forEach(function (mv) {
          var targetEl = els.board.querySelector(
            '.oc-square[data-rank="' + mv.to.rank + '"][data-file="' + mv.to.file + '"]'
          );
          if (targetEl) targetEl.classList.add(mv.captured ? 'legal-capture' : 'legal-target');
        });
      }
    }

    function selectSquare(rank, file) {
      var piece = OukEngine.pieceAt(appState.gameState, rank, file);
      if (piece && piece.color === appState.gameState.turn) {
        appState.selectedSquare = { rank: rank, file: file };
        appState.legalMovesForSelected = OukEngine.generateLegalMoves(appState.gameState, piece.color)
          .filter(function (m) { return m.from.rank === rank && m.from.file === file; });
      } else {
        appState.selectedSquare = null;
        appState.legalMovesForSelected = [];
      }
    }

    function tryMove(rank, file) {
      var match = appState.legalMovesForSelected.find(function (m) { return m.to.rank === rank && m.to.file === file; });
      if (!match) return false;
      appState.gameState = OukEngine.applyMove(appState.gameState, match);
      appState.selectedSquare = null;
      appState.legalMovesForSelected = [];
      return true;
    }

    function handleSquareClick(rank, file) {
      if (appState.gameState.status !== 'active') return;
      if (appState.selectedSquare && tryMove(rank, file)) {
        render();
        return;
      }
      selectSquare(rank, file);
      render();
    }

    els.board.addEventListener('click', function (evt) {
      var sq = evt.target.closest('.oc-square');
      if (!sq) return;
      handleSquareClick(parseInt(sq.dataset.rank, 10), parseInt(sq.dataset.file, 10));
    });

    render();
    return { handleSquareClick: handleSquareClick, getState: function () { return appState; } };
  }

  var api = { renderBoard: renderBoard, createApp: createApp };
  root.OukUI = api;
})(typeof window !== 'undefined' ? window : globalThis);
