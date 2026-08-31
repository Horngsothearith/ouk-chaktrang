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

  var api = { renderBoard: renderBoard };
  root.OukUI = api;
})(typeof window !== 'undefined' ? window : globalThis);
