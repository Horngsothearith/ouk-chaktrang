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
        sq.tabIndex = 0;
        sq.setAttribute('role', 'button');
        var piece = OukEngine.pieceAt(gameState, rank, file);
        sq.setAttribute('aria-label', OukEngine.squareName(rank, file) + (piece ? ', ' + piece.color + ' ' + piece.type : ', empty'));
        if (piece) sq.innerHTML = OukPieces.svgFor(piece.type, piece.color);
        containerEl.appendChild(sq);
      }
    }
  }

  function createApp(els) {
    var appState = {
      gameState: OukEngine.createInitialState(),
      selectedSquare: null,
      legalMovesForSelected: [],
      mode: '2p', // '2p' | 'vs-ai'
      aiColor: 'b',
      aiOptions: { timeLimitMs: 800, maxDepth: 5 }
    };

    function statusText(state) {
      if (state.status === 'checkmate') return (state.winner === 'w' ? 'White' : 'Black') + ' wins by checkmate';
      if (state.status === 'stalemate') return 'Draw by stalemate';
      if (state.status === 'draw-counting') return 'Draw — counting limit reached';
      if (state.status === 'draw-noprogress') return 'Draw — no progress for 64 moves';
      var turnName = state.turn === 'w' ? 'White' : 'Black';
      return (OukEngine.isInCheck(state, state.turn) ? turnName + ' is in check — ' : '') + turnName + ' to move';
    }

    function renderCounting(state) {
      if (!state.counting.active) { els.counting.hidden = true; return; }
      els.counting.hidden = false;
      var remaining = state.counting.budget - state.counting.elapsed;
      var side = state.counting.trigger === 'bareKing'
        ? (state.counting.disadvantagedColor === 'w' ? 'Black' : 'White') + ' must deliver checkmate'
        : 'Either side must make progress';
      els.counting.textContent = 'Counting rule active: ' + side + ' within ' + remaining + ' more move(s), or it is a draw.';
    }

    function renderCaptured(state) {
      var byWhite = [], byBlack = [];
      state.history.forEach(function (mv) {
        if (!mv.captured) return;
        (mv.piece.color === 'w' ? byWhite : byBlack).push(mv.captured);
      });
      els.capturedByWhite.innerHTML = byWhite.map(function (p) { return OukPieces.svgFor(p.type, p.color); }).join('');
      els.capturedByBlack.innerHTML = byBlack.map(function (p) { return OukPieces.svgFor(p.type, p.color); }).join('');
    }

    function renderMoves(state) {
      els.moves.innerHTML = state.history.map(function (mv, i) {
        var text = OukEngine.squareName(mv.from.rank, mv.from.file) + (mv.captured ? 'x' : '-') + OukEngine.squareName(mv.to.rank, mv.to.file) + (mv.special === 'promotion' ? '=Q' : '');
        return '<div>' + (i + 1) + '. ' + text + '</div>';
      }).join('');
      els.moves.scrollTop = els.moves.scrollHeight;
    }

    function render() {
      renderBoard(appState.gameState, els.board);
      els.status.textContent = statusText(appState.gameState);
      renderCounting(appState.gameState);
      renderCaptured(appState.gameState);
      renderMoves(appState.gameState);
      if (OukEngine.isInCheck(appState.gameState, appState.gameState.turn)) {
        var king = OukEngine.findKing(appState.gameState, appState.gameState.turn);
        if (king) {
          var kingEl = els.board.querySelector('.oc-square[data-rank="' + king.rank + '"][data-file="' + king.file + '"]');
          if (kingEl) kingEl.classList.add('in-check');
        }
      }
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

    function maybeTriggerAI() {
      if (appState.mode !== 'vs-ai') return;
      if (appState.gameState.status !== 'active') return;
      if (appState.gameState.turn !== appState.aiColor) return;
      els.status.textContent = (appState.aiColor === 'w' ? 'White' : 'Black') + ' (AI) is thinking...';
      setTimeout(function () {
        var move = OukAI.chooseMove(appState.gameState, appState.aiOptions);
        appState.gameState = OukEngine.applyMove(appState.gameState, move);
        render();
        maybeTriggerAI();
      }, 30);
    }

    function handleSquareClick(rank, file) {
      if (appState.gameState.status !== 'active') return;
      if (appState.mode === 'vs-ai' && appState.gameState.turn === appState.aiColor) return;
      if (appState.selectedSquare && tryMove(rank, file)) {
        render();
        maybeTriggerAI();
        return;
      }
      selectSquare(rank, file);
      render();
    }

    function newGame() {
      appState.gameState = OukEngine.createInitialState();
      appState.selectedSquare = null;
      appState.legalMovesForSelected = [];
      render();
      maybeTriggerAI();
    }

    function renderControls() {
      els.controls.innerHTML =
        '<button id="oc-new-game">New Game</button>' +
        '<label><input type="radio" name="oc-mode" value="2p"' + (appState.mode === '2p' ? ' checked' : '') + '> 2-Player</label>' +
        '<label><input type="radio" name="oc-mode" value="vs-ai"' + (appState.mode === 'vs-ai' ? ' checked' : '') + '> vs Computer</label>' +
        '<label>Difficulty: <select id="oc-difficulty">' +
          '<option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option>' +
        '</select></label>';

      document.getElementById('oc-new-game').addEventListener('click', newGame);
      Array.prototype.forEach.call(els.controls.querySelectorAll('input[name="oc-mode"]'), function (radio) {
        radio.addEventListener('change', function (evt) {
          appState.mode = evt.target.value;
          render();
          maybeTriggerAI();
        });
      });
      document.getElementById('oc-difficulty').addEventListener('change', function (evt) {
        var presets = { easy: { timeLimitMs: 300, maxDepth: 3 }, medium: { timeLimitMs: 800, maxDepth: 5 }, hard: { timeLimitMs: 1500, maxDepth: 7 } };
        appState.aiOptions = presets[evt.target.value];
      });
    }

    els.board.addEventListener('click', function (evt) {
      var sq = evt.target.closest('.oc-square');
      if (!sq) return;
      handleSquareClick(parseInt(sq.dataset.rank, 10), parseInt(sq.dataset.file, 10));
    });
    els.board.addEventListener('keydown', function (evt) {
      if (evt.key !== 'Enter' && evt.key !== ' ') return;
      var sq = evt.target.closest('.oc-square');
      if (!sq) return;
      evt.preventDefault();
      handleSquareClick(parseInt(sq.dataset.rank, 10), parseInt(sq.dataset.file, 10));
    });

    render();
    renderControls();
    return { handleSquareClick: handleSquareClick, getState: function () { return appState; } };
  }

  var api = { renderBoard: renderBoard, createApp: createApp };
  root.OukUI = api;
})(typeof window !== 'undefined' ? window : globalThis);
