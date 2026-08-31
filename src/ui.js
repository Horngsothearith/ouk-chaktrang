(function (root) {
  'use strict';

  var OukEngine = root.OukEngine;
  var OukPieces = root.OukPieces;
  var OukAI = root.OukAI;
  var OukReview = root.OukReview;
  var OukOpponent = root.OukOpponent;

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

  function prefersReducedMotion() {
    return typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Where the move list has to scroll to show the active move. The answer is
  // always the list's own scrollTop - the page is never part of it.
  //
  // scrollIntoView() is the one-liner, but it scrolls every scrollable ancestor
  // up to the viewport. In the single-column phone layout the move list sits
  // below the board, so appending a move scrolled the board - the thing the
  // player is actually looking at - off the top of the screen.
  //
  // `view` is the list's client rect plus its scroll metrics, `item` the active
  // row's client rect. `edge` names the two rows that are an end of the list
  // rather than a position in it - the newest move and the first - which run to
  // the very bottom and top, so the list ends flush with its own padding
  // instead of with the row jammed against the border.
  function moveListScrollTop(view, item, edge) {
    var max = Math.max(0, view.scrollHeight - view.clientHeight);
    if (edge === 'last') return max;
    if (edge === 'first') return 0;
    var below = item.bottom - view.bottom;
    if (below > 0) return Math.min(max, view.scrollTop + below);
    var above = view.top - item.top;
    if (above > 0) return Math.max(0, view.scrollTop - above);
    return view.scrollTop;
  }

  function loadSetting(key, fallback) {
    try {
      var val = localStorage.getItem(key);
      return val !== null ? val : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveSetting(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (e) {
      // Storage unavailable
    }
  }

  function applyAppTheme(theme) {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  function applyBoardTheme(board) {
    document.documentElement.setAttribute('data-board', board || 'angkor');
  }

  function applyPieceSkin(skin) {
    if (OukPieces.setSkin) {
      OukPieces.setSkin(skin || 'ivory-teak');
    }
  }

  function createApp(els) {
    var reviewSession = OukReview ? OukReview.createReviewSession() : null;

    var themeState = {
      appTheme: loadSetting('ouk_app_theme', 'system'),
      boardTheme: loadSetting('ouk_board_theme', 'angkor'),
      pieceSkin: loadSetting('ouk_piece_skin', 'ivory-teak')
    };

    // Apply active theme tokens
    applyAppTheme(themeState.appTheme);
    applyBoardTheme(themeState.boardTheme);
    applyPieceSkin(themeState.pieceSkin);

    var appState = {
      gameState: OukEngine.createInitialState(),
      selectedSquare: null,
      legalMovesForSelected: [],
      // '2p' | 'vs-ai' (local negamax search) | 'vs-llm' (the configured
      // chat model picks the moves, via src/opponent.js)
      mode: '2p',
      aiColor: 'b',
      aiOptions: { timeLimitMs: 800, maxDepth: 5 },
      aiThinkingTimeoutId: null,
      // An LLM reply arrives over the network, long after the position that
      // asked for it may have been undone, reset or switched away from. Every
      // request carries the counter's value and a reply whose value is stale
      // is dropped rather than played onto a board it does not belong to.
      opponentRequestId: 0,
      opponentNotice: null, // why the engine answered instead of the model
      hintMove: null, // { move, atPly } - engine suggestion drawn on the live board
      hintTimeoutId: null,
      themeState: themeState,
      viewMoveIndex: -1, // -1 means live position; >= 0 means viewing historical move
      recommendMoveIndex: null, // move index whose AI recommendation is drawn on the board
      reviewSession: reviewSession,
      moveReviews: {} // moveIndex -> review object
    };

    // Both AI modes hand the same colour to a machine; only the thing that
    // picks the move differs. Everything that just needs to know "is it the
    // opponent's turn" asks this rather than naming a mode.
    function hasComputerOpponent() {
      return appState.mode === 'vs-ai' || appState.mode === 'vs-llm';
    }

    function isComputerTurn() {
      return hasComputerOpponent() && appState.gameState.turn === appState.aiColor;
    }

    // Invalidates any LLM reply still in flight. Called wherever the position
    // the request was asked about stops being the position on the board.
    function cancelPendingOpponentMove() {
      appState.opponentRequestId++;
    }

    function isShowingRecommendation() {
      return appState.recommendMoveIndex !== null;
    }

    function clearRecommendation() {
      appState.recommendMoveIndex = null;
    }

    // A hint is only offered for a live position the player can actually move
    // in: not a finished game, not a rewound board, and not the AI's turn.
    function canRequestHint() {
      if (appState.gameState.status !== 'active') return false;
      if (isViewingHistory() || isShowingRecommendation()) return false;
      if (isComputerTurn()) return false;
      return true;
    }

    function clearHint() {
      if (appState.hintTimeoutId) {
        clearTimeout(appState.hintTimeoutId);
        appState.hintTimeoutId = null;
      }
      appState.hintMove = null;
    }

    function requestHint() {
      // Second press takes the hint back down, whether it is drawn already or
      // still being searched for.
      if (appState.hintMove || appState.hintTimeoutId) {
        clearHint();
        render();
        return;
      }
      if (!canRequestHint()) return;
      // The search blocks the main thread, so paint the notice first and let
      // the browser render before starting - the same handoff maybeTriggerAI
      // uses for the opponent's move.
      els.status.textContent = 'Thinking of a hint...';
      appState.hintTimeoutId = setTimeout(function () {
        appState.hintTimeoutId = null;
        var move = OukAI.suggestMove(appState.gameState);
        appState.hintMove = move
          ? { move: move, atPly: appState.gameState.history.length }
          : null;
        render();
      }, 30);
    }

    // The review for a move, whether it came from the live AI or the offline
    // simulation - both store the same shape under appState.moveReviews.
    function reviewAt(moveIndex) {
      if (moveIndex < 0) return null;
      return appState.moveReviews[moveIndex] ||
        (reviewSession && reviewSession.getCachedReview(appState.gameState.history, moveIndex)) ||
        null;
    }

    // What the board draws for a reviewed move: the LLM's own suggestion when
    // it named a legal move, otherwise the local engine's pick. Resolving costs
    // a replay to the pre-move position, so the answer is cached on the review
    // object - re-reviewing a move replaces that object, and the cache with it.
    function recommendationFor(moveIndex) {
      var data = reviewAt(moveIndex);
      if (!data) return { coords: null, source: null };
      if (!data.recommendation) {
        data.recommendation = OukReview.resolveRecommendedMove(
          OukReview.stateBeforeMoveIndex(appState.gameState.history, moveIndex),
          data.context,
          data.review
        );
      }
      return data.recommendation;
    }

    function recommendationCoords(moveIndex) {
      return recommendationFor(moveIndex).coords;
    }

    function coordsText(coords) {
      if (!coords) return '';
      return OukEngine.squareName(coords.from.rank, coords.from.file) + '-' +
             OukEngine.squareName(coords.to.rank, coords.to.file);
    }

    function currentDisplayState() {
      // A recommendation is an alternative to move N, so it only makes sense
      // against the position *before* N was played - rewind one ply further
      // than the move list navigation would.
      if (isShowingRecommendation()) {
        return OukReview.stateBeforeMoveIndex(appState.gameState.history, appState.recommendMoveIndex);
      }
      if (appState.viewMoveIndex >= 0 && appState.viewMoveIndex < appState.gameState.history.length - 1) {
        return OukReview.replayToMoveIndex(appState.gameState.history, appState.viewMoveIndex);
      }
      return appState.gameState;
    }

    function isViewingHistory() {
      return appState.viewMoveIndex >= 0 && appState.viewMoveIndex < appState.gameState.history.length - 1;
    }

    function statusText(state) {
      if (isShowingRecommendation()) {
        var recIdx = appState.recommendMoveIndex;
        var recData = reviewAt(recIdx);
        var recCtx = (recData && recData.context) || {};
        var played = (recCtx.from || '?') + '-' + (recCtx.to || '?');
        var rec = recommendationFor(recIdx);
        // Describe the arrow that is actually drawn, so the words and the board
        // can never disagree about which move is being recommended.
        var who = rec.source === 'llm' ? 'the AI recommends' : 'the engine prefers';
        return '🔍 Move ' + (recIdx + 1) + ': you played ' + played +
          ' — ' + who + ' ' + (coordsText(rec.coords) || 'a different move');
      }
      if (isViewingHistory()) {
        return 'Viewing Move ' + (appState.viewMoveIndex + 1) + ' of ' + appState.gameState.history.length;
      }
      if (state.status === 'checkmate') return (state.winner === 'w' ? 'White' : 'Black') + ' wins by checkmate';
      if (state.status === 'stalemate') return 'Draw by stalemate';
      if (state.status === 'draw-counting') return 'Draw — counting limit reached';
      if (state.status === 'draw-noprogress') return 'Draw — no progress for 64 moves';
      var turnName = state.turn === 'w' ? 'White' : 'Black';
      var checkPrefix = OukEngine.isInCheck(state, state.turn) ? '⚠️ ' + turnName + ' is in check! ' : '';

      if (appState.selectedSquare) {
        var piece = OukEngine.pieceAt(state, appState.selectedSquare.rank, appState.selectedSquare.file);
        var sqName = OukEngine.squareName(appState.selectedSquare.rank, appState.selectedSquare.file);
        var pInfo = piece && OukReview && OukReview.PIECE_NAMES && OukReview.PIECE_NAMES[piece.type];
        var pName = pInfo ? (pInfo.km + ' / ' + pInfo.name) : 'Piece';
        var moveCount = appState.legalMovesForSelected.length;
        return checkPrefix + turnName + ': Selected ' + pName + ' (' + sqName + ') &mdash; ' + moveCount + ' move' + (moveCount === 1 ? '' : 's');
      }

      // A move the model did not actually choose is still the model's move as
      // far as the board shows, so the reason the engine stepped in is said
      // out loud rather than left to look like the AI just played badly.
      if (appState.opponentNotice) {
        return checkPrefix + turnName + ' to move — ⚠️ AI fell back to the local engine: ' + appState.opponentNotice;
      }

      return checkPrefix + turnName + ' to move';
    }

    function renderCounting(state) {
      if (!els.counting) return;
      if (!state.counting.active) { els.counting.hidden = true; return; }
      els.counting.hidden = false;
      var remaining = state.counting.budget - state.counting.elapsed;
      var side = state.counting.trigger === 'bareKing'
        ? (state.counting.disadvantagedColor === 'w' ? 'Black' : 'White') + ' must deliver checkmate'
        : 'Either side must make progress';
      els.counting.textContent = 'Counting rule active: ' + side + ' within ' + remaining + ' more move(s), or it is a draw.';
    }

    function renderCaptured(state) {
      if (!els.capturedByWhite || !els.capturedByBlack) return;
      var byWhite = [], byBlack = [];
      state.history.forEach(function (mv) {
        if (!mv.captured) return;
        (mv.piece.color === 'w' ? byWhite : byBlack).push(mv.captured);
      });
      els.capturedByWhite.innerHTML = byWhite.map(function (p) { return OukPieces.svgFor(p.type, p.color); }).join('');
      els.capturedByBlack.innerHTML = byBlack.map(function (p) { return OukPieces.svgFor(p.type, p.color); }).join('');
    }

    function renderMoves(state) {
      if (!els.moves) return;
      var history = appState.gameState.history;
      var activeIndex = appState.viewMoveIndex >= 0 ? appState.viewMoveIndex : history.length - 1;

      els.moves.innerHTML = history.map(function (mv, i) {
        var text = OukEngine.squareName(mv.from.rank, mv.from.file) + (mv.captured ? 'x' : '-') + OukEngine.squareName(mv.to.rank, mv.to.file) + (mv.special === 'promotion' ? '=Q' : '');
        var isSelected = (i === activeIndex);
        var review = appState.moveReviews[i];
        var badgeHtml = '';
        if (review && review.review) {
          var qual = review.context && review.context.classification;
          var symbol = (qual && qual.symbol) || '🟢';
          var label = (qual && qual.label) || 'Analyzed';
          badgeHtml = '<span class="oc-move-badge-dot" title="' + label + '">' + symbol + '</span>';
        }
        return '<div class="oc-move-item' + (isSelected ? ' selected' : '') + '" data-index="' + i + '">' +
          '<span>' + (i + 1) + '. ' + text + '</span>' +
          badgeHtml +
          '</div>';
      }).join('');

      keepActiveMoveInView(activeIndex, history.length);
    }

    // Chasing the active move on every render would fight a player who has
    // scrolled up to reread an earlier one, so only follow when the list or the
    // selection actually changed under them - not when a re-render lands for
    // some other reason, such as a review badge arriving.
    var movesScrollKey = null;

    function listEdge(activeIndex, total) {
      if (activeIndex === total - 1) return 'last';
      if (activeIndex === 0) return 'first';
      return null;
    }

    function keepActiveMoveInView(activeIndex, total) {
      var key = activeIndex + '/' + total;
      if (key === movesScrollKey) return;
      movesScrollKey = key;

      var item = els.moves.querySelector('.oc-move-item.selected');
      if (!item || typeof els.moves.getBoundingClientRect !== 'function') return;

      var rect = els.moves.getBoundingClientRect();
      var top = moveListScrollTop({
        top: rect.top,
        bottom: rect.bottom,
        scrollTop: els.moves.scrollTop,
        scrollHeight: els.moves.scrollHeight,
        clientHeight: els.moves.clientHeight
      }, item.getBoundingClientRect(), listEdge(activeIndex, total));

      if (top === els.moves.scrollTop) return;
      if (typeof els.moves.scrollTo === 'function') {
        els.moves.scrollTo({ top: top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      } else {
        els.moves.scrollTop = top;
      }
    }

    function squareEl(rank, file) {
      return els.board.querySelector('.oc-square[data-rank="' + rank + '"][data-file="' + file + '"]');
    }

    var SVG_NS = 'http://www.w3.org/2000/svg';

    // Board coordinates for an 8x8 viewBox. renderBoard draws engine rank 7 on
    // the top row, so display row = 7 - rank; +0.5 centres within the square.
    function squareCenter(rank, file) {
      return { x: file + 0.5, y: (7 - rank) + 0.5 };
    }

    function arrowMarker(id, color) {
      var marker = document.createElementNS(SVG_NS, 'marker');
      marker.setAttribute('id', id);
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '7');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '4');
      marker.setAttribute('markerHeight', '4');
      marker.setAttribute('orient', 'auto-start-reverse');
      var head = document.createElementNS(SVG_NS, 'path');
      head.setAttribute('d', 'M 0 1 L 9 5 L 0 9 z');
      head.setAttribute('fill', color);
      marker.appendChild(head);
      return marker;
    }

    // Stop the shaft short of the destination centre so the arrowhead sits on
    // the square edge rather than covering the piece that would stand there.
    function shortenedLine(from, to, gap) {
      var dx = to.x - from.x, dy = to.y - from.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      return {
        x1: from.x + (dx / len) * gap,
        y1: from.y + (dy / len) * gap,
        x2: to.x - (dx / len) * gap,
        y2: to.y - (dy / len) * gap
      };
    }

    function appendArrow(svg, coords, className, markerId) {
      if (!coords) return;
      var seg = shortenedLine(
        squareCenter(coords.from.rank, coords.from.file),
        squareCenter(coords.to.rank, coords.to.file),
        0.3
      );
      var line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', seg.x1);
      line.setAttribute('y1', seg.y1);
      line.setAttribute('x2', seg.x2);
      line.setAttribute('y2', seg.y2);
      line.setAttribute('class', className);
      line.setAttribute('marker-end', 'url(#' + markerId + ')');
      svg.appendChild(line);
    }

    // Overlay comparing the move actually played (amber) with the engine's
    // preferred alternative (green), drawn over the pre-move position.
    function drawRecommendationArrows(playedCoords, recCoords) {
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'oc-arrow-layer');
      svg.setAttribute('viewBox', '0 0 8 8');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');

      var defs = document.createElementNS(SVG_NS, 'defs');
      defs.appendChild(arrowMarker('oc-arrow-played', 'var(--arrow-played, #d97706)'));
      defs.appendChild(arrowMarker('oc-arrow-recommend', 'var(--arrow-recommend, #16a34a)'));
      svg.appendChild(defs);

      appendArrow(svg, playedCoords, 'oc-arrow oc-arrow-played-line', 'oc-arrow-played');
      appendArrow(svg, recCoords, 'oc-arrow oc-arrow-recommend-line', 'oc-arrow-recommend');

      els.board.appendChild(svg);
    }

    // One green arrow for the engine's suggestion in the live position. Unlike
    // the review overlay this is purely additive - the usual highlights stay
    // put and the board stays clickable, so the hint can be played at once.
    function drawHintArrow(coords) {
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'oc-arrow-layer');
      svg.setAttribute('viewBox', '0 0 8 8');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');

      var defs = document.createElementNS(SVG_NS, 'defs');
      defs.appendChild(arrowMarker('oc-arrow-hint', 'var(--arrow-recommend, #16a34a)'));
      svg.appendChild(defs);

      appendArrow(svg, coords, 'oc-arrow oc-arrow-recommend-line', 'oc-arrow-hint');
      els.board.appendChild(svg);
    }

    function renderRecommendationOverlay() {
      var idx = appState.recommendMoveIndex;
      var data = reviewAt(idx);
      var recCoords = recommendationCoords(idx);
      if (!data || !recCoords) return false;

      var playedCoords = data.context.playedMoveCoords;
      function mark(coords, fromClass, toClass) {
        if (!coords) return;
        var f = squareEl(coords.from.rank, coords.from.file);
        var t = squareEl(coords.to.rank, coords.to.file);
        if (f) f.classList.add(fromClass);
        if (t) t.classList.add(toClass);
      }
      mark(playedCoords, 'played-from', 'played-to');
      mark(recCoords, 'recommend-from', 'recommend-to');

      drawRecommendationArrows(playedCoords, recCoords);
      return true;
    }

    function updateNavControls() {
      var total = appState.gameState.history.length;
      var cur = appState.viewMoveIndex >= 0 ? appState.viewMoveIndex + 1 : total;
      var labelEl = document.getElementById('oc-nav-label');
      var btnFirst = document.getElementById('oc-nav-first');
      var btnPrev = document.getElementById('oc-nav-prev');
      var btnNext = document.getElementById('oc-nav-next');
      var btnLast = document.getElementById('oc-nav-last');

      if (labelEl) labelEl.textContent = 'Move ' + cur + ' / ' + total;
      if (btnFirst) btnFirst.disabled = (total === 0 || cur <= 1);
      if (btnPrev) btnPrev.disabled = (total === 0 || cur <= 1);
      if (btnNext) btnNext.disabled = (total === 0 || cur >= total);
      if (btnLast) btnLast.disabled = (total === 0 || cur >= total);
    }

    function updateReviewCard() {
      var cardPlaceholder = document.getElementById('oc-review-placeholder');
      var cardContent = document.getElementById('oc-review-content');
      if (!cardPlaceholder || !cardContent) return;

      var history = appState.gameState.history;
      var moveIndex = appState.viewMoveIndex >= 0 ? appState.viewMoveIndex : history.length - 1;

      if (moveIndex < 0 || history.length === 0) {
        cardPlaceholder.hidden = false;
        cardContent.hidden = true;
        return;
      }

      var reviewData = appState.moveReviews[moveIndex] || (reviewSession && reviewSession.getCachedReview(history, moveIndex));

      if (!reviewData) {
        cardPlaceholder.hidden = false;
        cardContent.hidden = true;
        cardPlaceholder.innerHTML =
          '<div class="oc-review-placeholder-icon">💡</div>' +
          '<p>Move <strong>#' + (moveIndex + 1) + '</strong> not reviewed yet.</p>' +
          '<div style="display:flex;gap:8px;justify-content:center;margin-top:8px;flex-wrap:wrap">' +
          '<button class="oc-btn-accent" id="oc-explain-inline-btn">Explain This Move</button>' +
          '<button class="oc-btn-secondary" id="oc-simulate-inline-btn" title="Instant Grandmaster simulation without API key">🎮 Simulate</button>' +
          '</div>';
        var inlineBtn = document.getElementById('oc-explain-inline-btn');
        if (inlineBtn) {
          inlineBtn.addEventListener('click', function () { explainMoveAtIndex(moveIndex); });
        }
        var inlineSimBtn = document.getElementById('oc-simulate-inline-btn');
        if (inlineSimBtn) {
          inlineSimBtn.addEventListener('click', function () { simulateMoveAtIndex(moveIndex); });
        }
        return;
      }

      cardPlaceholder.hidden = true;
      cardContent.hidden = false;

      var moveBadge = document.getElementById('oc-move-badge');
      var qualBadge = document.getElementById('oc-quality-badge');
      var evalBadge = document.getElementById('oc-eval-badge');
      var titleEl = document.getElementById('oc-review-title');
      var expEl = document.getElementById('oc-review-explanation');
      var betterWrap = document.getElementById('oc-better-move');
      var betterText = document.getElementById('oc-better-move-text');
      var tagsEl = document.getElementById('oc-review-tags');

      var ctx = reviewData.context;
      var rev = reviewData.review;
      var qual = ctx.classification;

      if (moveBadge) moveBadge.textContent = ctx.moveNotation;
      if (qualBadge) {
        qualBadge.textContent = (qual.symbol || '') + ' ' + (rev.classification ? rev.classification.toUpperCase() : qual.label);
        qualBadge.style.color = qual.color || '#fff';
      }
      if (evalBadge) {
        var sign = ctx.evalDiff >= 0 ? '+' : '';
        evalBadge.textContent = 'Eval: ' + ctx.evalAfter + ' (' + sign + ctx.evalDiff + ')';
      }
      if (titleEl) titleEl.textContent = rev.title || 'Move Analysis';
      if (expEl) expEl.textContent = rev.explanation || '';

      var recInfo = recommendationFor(moveIndex);
      var recText = coordsText(recInfo.coords);
      var sourceEl = document.getElementById('oc-rec-source');

      if (betterWrap && betterText) {
        if (rev.betterMove && recInfo.source === 'llm') {
          // The model's prose and the drawn arrow are the same move.
          betterWrap.hidden = false;
          betterText.textContent = rev.betterMove;
        } else if (rev.betterMove && recInfo.source === 'engine') {
          // The model said something but gave no usable move, so the arrow is
          // the engine's. Name it rather than let the two silently disagree.
          betterWrap.hidden = false;
          betterText.textContent = rev.betterMove + ' (arrow shows the engine\'s ' + recText + ')';
        } else if (recInfo.coords) {
          betterWrap.hidden = false;
          betterText.textContent = recText + ' was the engine preference.';
        } else {
          betterWrap.hidden = true;
        }
      }

      if (sourceEl) {
        sourceEl.hidden = !recInfo.coords;
        if (recInfo.coords) {
          var fromLlm = (recInfo.source === 'llm');
          sourceEl.textContent = fromLlm ? '🤖 AI' : '⚙️ Engine';
          sourceEl.title = fromLlm
            ? 'Drawn from the AI\'s own recommendation'
            : 'The AI gave no usable move, so the local engine\'s pick is drawn';
          sourceEl.classList.toggle('is-llm', fromLlm);
        }
      }

      // "Show on board" only appears when there is a validated move to draw.
      var showBtn = document.getElementById('oc-show-on-board-btn');
      if (showBtn) {
        var canDraw = !!recInfo.coords;
        showBtn.hidden = !canDraw;
        if (canDraw) {
          var active = (appState.recommendMoveIndex === moveIndex);
          showBtn.textContent = active ? '✕ Hide from board' : '👁 Show on board';
          showBtn.classList.toggle('active', active);
          showBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
          showBtn.onclick = function () {
            if (appState.recommendMoveIndex === moveIndex) {
              clearRecommendation();
            } else {
              appState.recommendMoveIndex = moveIndex;
              // Pin the move list to this move so any later navigation is a
              // mismatch, which is what render() uses to close the overlay.
              appState.viewMoveIndex = moveIndex;
              appState.selectedSquare = null;
              appState.legalMovesForSelected = [];
            }
            render();
          };
        }
      }

      if (tagsEl) {
        var tags = rev.tags || [];
        tagsEl.innerHTML = tags.map(function (t) {
          return '<span class="oc-tag-pill">#' + t.replace(/^#/, '') + '</span>';
        }).join('');
      }
    }

    function render() {
      // Close the overlay when it no longer applies: the review it points at is
      // gone (undo, new game), or the user navigated away. Every navigation
      // path - nav buttons, move list, playing a move, the AI replying - moves
      // viewMoveIndex, so that one comparison covers them all.
      if (isShowingRecommendation() &&
          (appState.viewMoveIndex !== appState.recommendMoveIndex ||
           !recommendationCoords(appState.recommendMoveIndex))) {
        clearRecommendation();
      }
      // A hint answers one exact live position, so anything that leaves that
      // position retires it: a move played, an undo, a new game, or a step
      // back into history or the review overlay.
      if (appState.hintMove &&
          (appState.hintMove.atPly !== appState.gameState.history.length ||
           !canRequestHint())) {
        clearHint();
      }
      var displayState = currentDisplayState();
      renderBoard(displayState, els.board);
      els.status.textContent = statusText(displayState);
      renderCounting(displayState);
      renderCaptured(displayState);
      renderMoves(displayState);
      updateNavControls();
      updateReviewCard();

      var undoBtn = document.getElementById('oc-undo-btn');
      if (undoBtn) {
        // Undo acts on the real game, not the position being viewed, so it
        // stays available while rewound for history or a recommendation.
        undoBtn.disabled = (appState.gameState.history.length === 0);
      }

      var hintBtn = document.getElementById('oc-hint-btn');
      if (hintBtn) {
        // Stays enabled while a hint is up so the same button takes it down.
        hintBtn.disabled = !canRequestHint() && !appState.hintMove;
        hintBtn.setAttribute('aria-pressed', appState.hintMove ? 'true' : 'false');
      }

      // The recommendation overlay is a read-only comparison view: its own
      // four square markers and two arrows replace the usual highlights, which
      // would otherwise fight them for the same squares.
      if (isShowingRecommendation()) {
        renderRecommendationOverlay();
        return;
      }

      var history = displayState.history;
      if (history.length > 0) {
        var lastMove = history[history.length - 1];
        var fromEl = squareEl(lastMove.from.rank, lastMove.from.file);
        var toEl = squareEl(lastMove.to.rank, lastMove.to.file);
        if (fromEl) fromEl.classList.add('last-move');
        if (toEl) toEl.classList.add('last-move');
      }

      if (!isViewingHistory() && OukEngine.isInCheck(displayState, displayState.turn)) {
        var king = OukEngine.findKing(displayState, displayState.turn);
        if (king) {
          var kingEl = squareEl(king.rank, king.file);
          if (kingEl) kingEl.classList.add('in-check');
        }
      }

      if (!isViewingHistory() && displayState.status === 'active') {
        var allLegal = OukEngine.generateLegalMoves(displayState, displayState.turn);
        var moveableSquares = {};
        allLegal.forEach(function (m) {
          moveableSquares[m.from.rank + '_' + m.from.file] = true;
        });
        Object.keys(moveableSquares).forEach(function (key) {
          var parts = key.split('_');
          var sq = squareEl(parseInt(parts[0], 10), parseInt(parts[1], 10));
          if (sq) sq.classList.add('can-move');
        });
      }

      if (!isViewingHistory() && appState.selectedSquare) {
        var selEl = squareEl(appState.selectedSquare.rank, appState.selectedSquare.file);
        if (selEl) selEl.classList.add('selected');
        appState.legalMovesForSelected.forEach(function (mv) {
          var targetEl = squareEl(mv.to.rank, mv.to.file);
          if (targetEl) {
            if (mv.special === 'kingJump' || mv.special === 'queenDouble' || mv.special === 'promotion') {
              targetEl.classList.add('legal-special');
            } else if (mv.captured) {
              targetEl.classList.add('legal-capture');
            } else {
              targetEl.classList.add('legal-target');
            }
          }
        });
      }

      if (appState.hintMove) {
        var hintFrom = squareEl(appState.hintMove.move.from.rank, appState.hintMove.move.from.file);
        var hintTo = squareEl(appState.hintMove.move.to.rank, appState.hintMove.move.to.file);
        if (hintFrom) hintFrom.classList.add('hint-from');
        if (hintTo) hintTo.classList.add('hint-to');
        drawHintArrow(appState.hintMove.move);
      }
    }

    function selectSquare(rank, file) {
      if (isViewingHistory()) {
        appState.viewMoveIndex = -1;
      }
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
      if (isViewingHistory()) return false;
      var match = appState.legalMovesForSelected.find(function (m) { return m.to.rank === rank && m.to.file === file; });
      if (!match) return false;
      appState.gameState = OukEngine.applyMove(appState.gameState, match);
      appState.selectedSquare = null;
      appState.legalMovesForSelected = [];
      appState.viewMoveIndex = -1;
      return true;
    }

    function undoMove() {
      if (appState.gameState.history.length === 0) return false;

      // Cancel any pending AI search, local or remote
      if (appState.aiThinkingTimeoutId) {
        clearTimeout(appState.aiThinkingTimeoutId);
        appState.aiThinkingTimeoutId = null;
      }
      cancelPendingOpponentMove();
      appState.opponentNotice = null;

      clearHint();

      var history = appState.gameState.history;
      var stepsToUndo = 1;

      if (hasComputerOpponent()) {
        var lastMove = history[history.length - 1];
        // If last move was AI, roll back 2 moves so player gets their turn back
        // If last move was player (e.g. before AI replied or game ended), roll back 1 move
        if (lastMove.piece.color === appState.aiColor) {
          stepsToUndo = history.length >= 2 ? 2 : 1;
        } else {
          stepsToUndo = 1;
        }
      }

      var targetCount = Math.max(0, history.length - stepsToUndo);
      var newState = OukEngine.createInitialState();
      for (var i = 0; i < targetCount; i++) {
        newState = OukEngine.applyMove(newState, history[i]);
      }

      for (var u = targetCount; u < history.length; u++) {
        delete appState.moveReviews[u];
      }

      appState.gameState = newState;
      appState.selectedSquare = null;
      appState.legalMovesForSelected = [];
      appState.viewMoveIndex = -1;

      render();
      return true;
    }

    function opponentName() {
      return appState.aiColor === 'w' ? 'White' : 'Black';
    }

    // Plays whatever the opponent chose and hands the turn on. Shared by both
    // modes so a move reaches the board by exactly one path.
    function playOpponentMove(move, notice) {
      if (!move) return;
      appState.opponentNotice = notice || null;
      appState.gameState = OukEngine.applyMove(appState.gameState, move);
      appState.viewMoveIndex = -1;
      render();
      maybeTriggerAI();
    }

    function triggerEngineMove() {
      // The search blocks the main thread, so let the browser paint the
      // "thinking" notice before it starts.
      appState.aiThinkingTimeoutId = setTimeout(function () {
        appState.aiThinkingTimeoutId = null;
        playOpponentMove(OukAI.chooseMove(appState.gameState, appState.aiOptions), null);
      }, 30);
    }

    function triggerLlmMove() {
      var requestId = appState.opponentRequestId;
      var state = appState.gameState;
      var settings = reviewSession ? reviewSession.getSettings() : null;

      OukOpponent.chooseOpponentMove(state, state.history, settings, appState.aiOptions, function (err, result) {
        // A new game, an undo or a mode change happened while the request was
        // out: this move answers a position that is no longer on the board.
        if (requestId !== appState.opponentRequestId) return;
        if (!result || !result.move) return;
        playOpponentMove(
          result.move,
          result.source === 'engine' ? result.reason : null
        );
      });
    }

    function maybeTriggerAI() {
      if (!hasComputerOpponent()) return;
      if (appState.gameState.status !== 'active') return;
      if (appState.gameState.turn !== appState.aiColor) return;

      appState.opponentNotice = null;
      els.status.textContent = opponentName() + thinkingSuffix();

      if (appState.aiThinkingTimeoutId) {
        clearTimeout(appState.aiThinkingTimeoutId);
        appState.aiThinkingTimeoutId = null;
      }

      if (appState.mode === 'vs-llm') {
        triggerLlmMove();
      } else {
        triggerEngineMove();
      }
    }

    // Names the opponent that is actually thinking. In vs-llm that is the
    // configured model, and saying which one is the difference between a
    // pause the player understands and one that looks like a hang.
    function thinkingSuffix() {
      if (appState.mode !== 'vs-llm') return ' (Computer) is thinking...';
      var settings = reviewSession ? reviewSession.getSettings() : null;
      if (OukOpponent.unusableEndpointReason(settings)) {
        return ' (Computer) is thinking...';
      }
      return ' (' + (settings.model || 'AI') + ') is thinking...';
    }

    function handleSquareClick(rank, file) {
      // The recommendation overlay is a read-only comparison of a past
      // position; clicking through it would move pieces in the live game.
      if (isShowingRecommendation()) return;
      if (appState.gameState.status !== 'active') return;
      if (isComputerTurn()) return;
      if (appState.selectedSquare && tryMove(rank, file)) {
        render();
        maybeTriggerAI();
        return;
      }
      selectSquare(rank, file);
      render();
    }

    function newGame() {
      if (appState.aiThinkingTimeoutId) {
        clearTimeout(appState.aiThinkingTimeoutId);
        appState.aiThinkingTimeoutId = null;
      }
      cancelPendingOpponentMove();
      appState.opponentNotice = null;
      clearHint();
      appState.gameState = OukEngine.createInitialState();
      appState.selectedSquare = null;
      appState.legalMovesForSelected = [];
      appState.viewMoveIndex = -1;
      appState.moveReviews = {};
      if (reviewSession) reviewSession.clearCache();
      render();
      maybeTriggerAI();
    }

    function simulateMoveAtIndex(idx) {
      if (!OukReview || !OukReview.generateSimulatedReview) return;
      var history = appState.gameState.history;
      if (idx < 0 || idx >= history.length) return;

      var promptCtx = OukReview.buildPromptContext(history, idx);
      var currentLang = (reviewSession && reviewSession.getSettings().language) || 'en';
      var simReview = OukReview.generateSimulatedReview(promptCtx.contextData, currentLang);

      appState.moveReviews[idx] = {
        moveIndex: idx,
        context: promptCtx.contextData,
        review: simReview,
        raw: JSON.stringify(simReview)
      };
      render();
    }

    function explainMoveAtIndex(idx) {
      if (!reviewSession) return;
      var history = appState.gameState.history;
      if (idx < 0 || idx >= history.length) return;

      var cardPlaceholder = document.getElementById('oc-review-placeholder');
      var cardContent = document.getElementById('oc-review-content');
      if (cardPlaceholder) {
        cardPlaceholder.hidden = false;
        cardPlaceholder.innerHTML = '<div class="oc-review-placeholder-icon">⏳</div><p>Consulting Grandmaster AI for Move #' + (idx + 1) + '...</p>';
      }
      if (cardContent) cardContent.hidden = true;

      reviewSession.getReviewForMove(history, idx, function (err, result) {
        if (err) {
          if (err.message === 'NO_API_KEY') {
            if (cardPlaceholder) {
              cardPlaceholder.innerHTML =
                '<div class="oc-review-placeholder-icon">💡</div>' +
                '<p>No API key configured for live AI.</p>' +
                '<div style="display:flex;gap:8px;justify-content:center;margin-top:8px;flex-wrap:wrap">' +
                '<button class="oc-btn-accent" id="oc-err-settings-btn">⚙️ Configure API</button>' +
                '<button class="oc-btn-secondary" id="oc-err-sim-btn">🎮 Simulate Review</button>' +
                '</div>';
              var sBtn = document.getElementById('oc-err-settings-btn');
              if (sBtn) sBtn.addEventListener('click', function () { openSettingsDialog(); });
              var simBtn = document.getElementById('oc-err-sim-btn');
              if (simBtn) simBtn.addEventListener('click', function () { simulateMoveAtIndex(idx); });
            }
          } else if (cardPlaceholder) {
            cardPlaceholder.innerHTML =
              '<div class="oc-review-placeholder-icon">⚠️</div>' +
              '<p style="color:var(--danger)">Review failed: ' + err.message + '</p>' +
              '<div style="display:flex;gap:8px;justify-content:center;margin-top:8px;flex-wrap:wrap">' +
              '<button class="oc-btn-secondary" id="oc-retry-explain-btn">Retry</button>' +
              '<button class="oc-btn-accent" id="oc-fallback-sim-btn">🎮 Simulate Review</button>' +
              '</div>';
            var retryBtn = document.getElementById('oc-retry-explain-btn');
            if (retryBtn) retryBtn.addEventListener('click', function () { explainMoveAtIndex(idx); });
            var fallbackSimBtn = document.getElementById('oc-fallback-sim-btn');
            if (fallbackSimBtn) fallbackSimBtn.addEventListener('click', function () { simulateMoveAtIndex(idx); });
          }
          return;
        }

        appState.moveReviews[idx] = result;
        render();
      });
    }

    function startFullGameReview() {
      if (!reviewSession) return;
      var history = appState.gameState.history;
      if (history.length === 0) {
        alert('Make some moves first to review the game!');
        return;
      }

      var progressWrap = document.getElementById('oc-review-progress-wrap');
      var progressFill = document.getElementById('oc-review-progress-fill');
      var progressText = document.getElementById('oc-review-progress-text');
      var reviewBtn = document.getElementById('oc-review-game-btn');

      if (progressWrap) progressWrap.hidden = false;
      if (reviewBtn) reviewBtn.disabled = true;

      reviewSession.reviewFullGame(
        history,
        function onProgress(current, total, result) {
          var pct = Math.round((current / total) * 100);
          if (progressFill) progressFill.style.width = pct + '%';
          if (progressText) progressText.textContent = 'Analyzing move ' + current + ' of ' + total + ' (' + pct + '%)...';
          if (result && typeof result.moveIndex === 'number') {
            appState.moveReviews[result.moveIndex] = result;
            renderMoves(appState.gameState);
          }
        },
        function onComplete(err, results) {
          if (progressWrap) progressWrap.hidden = true;
          if (reviewBtn) reviewBtn.disabled = false;
          if (err && err.message === 'NO_API_KEY') {
            openSettingsDialog('Please configure your OpenAI API Key or local endpoint in Settings.');
            return;
          }
          if (err) {
            alert('Game review error: ' + err.message);
            return;
          }
          if (results) {
            results.forEach(function (r) {
              if (r.result) appState.moveReviews[r.moveIndex] = r.result;
            });
          }
          appState.viewMoveIndex = 0;
          render();
        }
      );
    }

    function openSettingsDialog(message) {
      var dialog = document.getElementById('oc-settings-dialog');
      if (!dialog) return;
      var settings = reviewSession ? reviewSession.getSettings() : OukReview.loadSettings();

      var baseUrlInput = document.getElementById('oc-setting-base-url');
      var apiKeyInput = document.getElementById('oc-setting-api-key');
      var modelInput = document.getElementById('oc-setting-model');
      var langSelect = document.getElementById('oc-setting-lang');
      var useProxyInput = document.getElementById('oc-setting-use-proxy');
      var statusDiv = document.getElementById('oc-dialog-status');

      if (baseUrlInput) baseUrlInput.value = settings.baseURL || 'https://api.openai.com/v1';
      if (apiKeyInput) apiKeyInput.value = settings.apiKey || '';
      if (modelInput) modelInput.value = settings.model || 'gpt-4o-mini';
      // A list belongs to the endpoint it came from. Reopening the dialog may
      // be the first step of pointing it somewhere else, so the old names go.
      resetModelPicker();
      if (langSelect) langSelect.value = settings.language || 'en';
      if (useProxyInput) useProxyInput.checked = !!settings.useProxy;
      if (statusDiv) {
        statusDiv.className = 'oc-dialog-status' + (message ? ' error' : '');
        statusDiv.textContent = message || '';
      }

      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    }

    // Fills the datalist behind the model field. The text input is left alone:
    // it is the setting, and an endpoint that will not list its models - or a
    // model released since the list was fetched - must still be typeable.
    //
    // Built through the DOM rather than innerHTML: these ids are whatever a
    // remote endpoint chose to send, so they go in as values, never as markup.
    function setModelOptions(ids) {
      var list = document.getElementById('oc-model-options');
      if (!list) return;
      list.innerHTML = '';
      ids.forEach(function (id) {
        var opt = document.createElement('option');
        opt.value = String(id);
        list.appendChild(opt);
      });
    }

    function setModelHint(text) {
      var hint = document.getElementById('oc-model-hint');
      if (hint) hint.textContent = text;
    }

    // A loaded list describes one endpoint. Anything that repoints the dialog
    // clears the names and the count that went with them - leaving the count
    // behind would have the hint advertising models that are no longer offered.
    function resetModelPicker() {
      setModelOptions([]);
      setModelHint('Type a model name, or load the list the endpoint offers and pick from it.');
    }

    function loadModelList() {
      var btn = document.getElementById('oc-load-models');
      var statusDiv = document.getElementById('oc-dialog-status');
      var bInput = document.getElementById('oc-setting-base-url');
      var kInput = document.getElementById('oc-setting-api-key');
      var pCheck = document.getElementById('oc-setting-use-proxy');

      var baseURL = (bInput ? bInput.value.trim() : '').replace(/\/+$/, '');

      function say(cls, text) {
        if (!statusDiv) return;
        statusDiv.className = 'oc-dialog-status' + (cls ? ' ' + cls : '');
        statusDiv.textContent = text;
      }

      // The Simulation preset answers from the local engine; there is no
      // endpoint to ask, and its one model name is already in the field.
      if (baseURL === 'simulation' || baseURL === 'demo' || baseURL === 'mock') {
        say('', 'Simulation mode has no endpoint to list models from.');
        return;
      }
      if (!baseURL) {
        say('error', '❌ Set an API Base URL first.');
        return;
      }

      // The list is read from the form as typed, not from saved settings, so
      // the button answers for the endpoint on screen.
      var probeSettings = {
        baseURL: baseURL,
        apiKey: kInput ? kInput.value.trim() : '',
        useProxy: pCheck ? pCheck.checked : false
      };

      if (btn) btn.disabled = true;
      say('loading', 'Loading models from ' + baseURL + '...');

      OukReview.listModels(probeSettings)
        .then(function (ids) {
          setModelOptions(ids);
          setModelHint('Click the Model field to pick from ' + ids.length + ' model' + (ids.length === 1 ? '' : 's') + ', or keep typing.');
          var via = probeSettings.useProxy ? ' (via Dev Proxy)' : '';
          say('success', '✅ Loaded ' + ids.length + ' model' + (ids.length === 1 ? '' : 's') + via + '. Click the Model field to choose one.');
          // listModels turns on the proxy itself when the direct call is
          // blocked; reflect that so the checkbox matches what just worked.
          if (pCheck && probeSettings.useProxy) pCheck.checked = true;
        })
        .catch(function (err) {
          setModelOptions([]);
          setModelHint('Type a model name — this endpoint did not return a list.');
          say('error', '❌ Could not list models: ' + err.message);
        })
        .then(function () {
          if (btn) btn.disabled = false;
        });
    }

    function closeSettingsDialog() {
      var dialog = document.getElementById('oc-settings-dialog');
      if (!dialog) return;
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }

    function renderControls() {
      var skins = OukPieces.getAvailableSkins ? OukPieces.getAvailableSkins() : [
        { id: 'ivory-teak', name: 'Ivory & Teak', nameKm: 'ភ្លុក & ឈើប្រណិត' },
        { id: 'gold-bronze', name: 'Gold & Antique Bronze', nameKm: 'មាស & សំរឹទ្ធ' },
        { id: 'jade-ruby', name: 'Imperial Jade & Ruby', nameKm: 'ត្បូងមរកត & ត្បូងទទឹម' },
        { id: 'sandstone', name: 'Bayon Sandstone', nameKm: 'ថ្មភក់ & ថ្មបាសាល់' },
        { id: 'modern', name: 'Modern Minimalist', nameKm: 'ស & ខ្មៅ ទំនើប' }
      ];

      var skinOptions = skins.map(function (s) {
        var selected = s.id === themeState.pieceSkin ? ' selected' : '';
        return '<option value="' + s.id + '"' + selected + '>' + s.name + ' (' + s.nameKm + ')</option>';
      }).join('');

      els.controls.innerHTML =
        '<div class="oc-btn-row">' +
        '<button id="oc-new-game">New Game</button>' +
        '<button id="oc-undo-btn" title="Undo last move (Ctrl+Z / U)" aria-label="Undo Move" ' + (appState.gameState.history.length === 0 ? 'disabled' : '') + '>↶ Undo</button>' +
        '<button id="oc-hint-btn" title="Show the suggested move (H)" aria-label="Show Hint" aria-pressed="false" ' + (canRequestHint() ? '' : 'disabled') + '>💡 Hint</button>' +
        '</div>' +
        '<label><input type="radio" name="oc-mode" value="2p"' + (appState.mode === '2p' ? ' checked' : '') + '> 2-Player</label>' +
        '<label><input type="radio" name="oc-mode" value="vs-ai"' + (appState.mode === 'vs-ai' ? ' checked' : '') + '> vs Computer</label>' +
        '<label title="The model configured in ⚙ AI Settings picks the moves"><input type="radio" name="oc-mode" value="vs-llm"' + (appState.mode === 'vs-llm' ? ' checked' : '') + '> vs AI</label>' +
        '<label title="Strength of the local engine — in vs AI that is the fallback it plays when the model cannot answer">Difficulty: <select id="oc-difficulty">' +
        '<option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option>' +
        '</select></label>' +
        '<div class="oc-theme-card">' +
        '<div class="oc-theme-card-title"><span>🎨</span> Themes & Skins</div>' +
        '<div class="oc-theme-row">' +
        '<label for="oc-theme-select">Theme <span>រូបរាង</span></label>' +
        '<select id="oc-theme-select">' +
        '<option value="system"' + (themeState.appTheme === 'system' ? ' selected' : '') + '>System (Auto) / តាមប្រព័ន្ធ</option>' +
        '<option value="light"' + (themeState.appTheme === 'light' ? ' selected' : '') + '>Angkor Light / ស្លឹករឹត</option>' +
        '<option value="dark"' + (themeState.appTheme === 'dark' ? ' selected' : '') + '>Royal Dark Teak / ឈើប្រណិត</option>' +
        '<option value="obsidian"' + (themeState.appTheme === 'obsidian' ? ' selected' : '') + '>Deep Obsidian / ថ្មខ្មៅរាត្រី</option>' +
        '</select>' +
        '</div>' +
        '<div class="oc-theme-row">' +
        '<label for="oc-board-select">Board <span>ក្ដារអុក</span></label>' +
        '<select id="oc-board-select">' +
        '<option value="angkor"' + (themeState.boardTheme === 'angkor' ? ' selected' : '') + '>Angkor Classic / អង្គរ</option>' +
        '<option value="teak"' + (themeState.boardTheme === 'teak' ? ' selected' : '') + '>Royal Teak / ឈើប្រណិត</option>' +
        '<option value="jade"' + (themeState.boardTheme === 'jade' ? ' selected' : '') + '>Temple Jade / ត្បូងមរកត</option>' +
        '<option value="sandstone"' + (themeState.boardTheme === 'sandstone' ? ' selected' : '') + '>Bayon Sandstone / ថ្មបាយ័ន</option>' +
        '<option value="obsidian"' + (themeState.boardTheme === 'obsidian' ? ' selected' : '') + '>Midnight Obsidian / ថ្មខ្មៅ</option>' +
        '<option value="saffron"' + (themeState.boardTheme === 'saffron' ? ' selected' : '') + '>Lotus Saffron / ស្បង់ជីវរ</option>' +
        '</select>' +
        '</div>' +
        '<div class="oc-theme-row">' +
        '<label for="oc-piece-select">Pieces <span>កូនអុក</span></label>' +
        '<select id="oc-piece-select">' +
        skinOptions +
        '</select>' +
        '</div>' +
        '</div>';

      document.getElementById('oc-new-game').addEventListener('click', newGame);
      var undoBtnEl = document.getElementById('oc-undo-btn');
      if (undoBtnEl) undoBtnEl.addEventListener('click', undoMove);
      var hintBtnEl = document.getElementById('oc-hint-btn');
      if (hintBtnEl) hintBtnEl.addEventListener('click', requestHint);
      Array.prototype.forEach.call(els.controls.querySelectorAll('input[name="oc-mode"]'), function (radio) {
        radio.addEventListener('change', function (evt) {
          cancelPendingOpponentMove();
          appState.opponentNotice = null;
          appState.mode = evt.target.value;
          render();
          maybeTriggerAI();
        });
      });
      document.getElementById('oc-difficulty').addEventListener('change', function (evt) {
        var presets = { easy: { timeLimitMs: 300, maxDepth: 3 }, medium: { timeLimitMs: 800, maxDepth: 5 }, hard: { timeLimitMs: 1500, maxDepth: 7 } };
        appState.aiOptions = presets[evt.target.value];
      });

      // Theme event listeners
      var themeSelect = document.getElementById('oc-theme-select');
      var boardSelect = document.getElementById('oc-board-select');
      var pieceSelect = document.getElementById('oc-piece-select');

      if (themeSelect) {
        themeSelect.addEventListener('change', function (evt) {
          var val = evt.target.value;
          themeState.appTheme = val;
          saveSetting('ouk_app_theme', val);
          applyAppTheme(val);
        });
      }
      if (boardSelect) {
        boardSelect.addEventListener('change', function (evt) {
          var val = evt.target.value;
          themeState.boardTheme = val;
          saveSetting('ouk_board_theme', val);
          applyBoardTheme(val);
        });
      }
      if (pieceSelect) {
        pieceSelect.addEventListener('change', function (evt) {
          var val = evt.target.value;
          themeState.pieceSkin = val;
          saveSetting('ouk_piece_skin', val);
          applyPieceSkin(val);
          render();
        });
      }

      // Settings modal wire-up
      var openSettingsBtn = document.getElementById('oc-open-settings');
      var closeSettingsBtn = document.getElementById('oc-close-settings');
      var settingsForm = document.getElementById('oc-settings-form');
      var togglePwBtn = document.getElementById('oc-toggle-api-key');
      var apiKeyInput = document.getElementById('oc-setting-api-key');
      var testBtn = document.getElementById('oc-test-connection');
      var cancelReviewBtn = document.getElementById('oc-cancel-review-btn');
      var reviewGameBtn = document.getElementById('oc-review-game-btn');
      var explainCurBtn = document.getElementById('oc-explain-current-btn');

      if (openSettingsBtn) openSettingsBtn.addEventListener('click', function () { openSettingsDialog(); });
      var loadModelsBtn = document.getElementById('oc-load-models');
      if (loadModelsBtn) loadModelsBtn.addEventListener('click', loadModelList);
      if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettingsDialog);
      if (togglePwBtn && apiKeyInput) {
        togglePwBtn.addEventListener('click', function () {
          apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
        });
      }

      // Presets
      var presetConfigs = {
        simulation: { baseURL: 'simulation', model: 'ouk-grandmaster-v1' },
        openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        openrouter: { baseURL: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' },
        groq: { baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
        ollama: { baseURL: 'http://localhost:11434/v1', model: 'llama3' },
        lmstudio: { baseURL: 'http://localhost:1234/v1', model: 'local-model' }
      };

      Array.prototype.forEach.call(document.querySelectorAll('.oc-preset-btn'), function (btn) {
        btn.addEventListener('click', function () {
          var p = presetConfigs[btn.dataset.preset];
          if (p) {
            var bInput = document.getElementById('oc-setting-base-url');
            var mInput = document.getElementById('oc-setting-model');
            if (bInput) bInput.value = p.baseURL;
            if (mInput) mInput.value = p.model;
            // Different endpoint, different catalogue.
            resetModelPicker();
          }
        });
      });

      if (settingsForm) {
        settingsForm.addEventListener('submit', function (evt) {
          evt.preventDefault();
          var bInput = document.getElementById('oc-setting-base-url');
          var kInput = document.getElementById('oc-setting-api-key');
          var mInput = document.getElementById('oc-setting-model');
          var lSelect = document.getElementById('oc-setting-lang');
          var pCheck = document.getElementById('oc-setting-use-proxy');

          if (reviewSession) {
            reviewSession.updateSettings({
              baseURL: bInput ? bInput.value.trim() : 'https://api.openai.com/v1',
              apiKey: kInput ? kInput.value.trim() : '',
              model: mInput ? mInput.value.trim() : 'gpt-4o-mini',
              language: lSelect ? lSelect.value : 'en',
              useProxy: pCheck ? pCheck.checked : false
            });
          }
          closeSettingsDialog();
        });
      }

      if (testBtn) {
        testBtn.addEventListener('click', function () {
          var statusDiv = document.getElementById('oc-dialog-status');
          var bInput = document.getElementById('oc-setting-base-url');
          var kInput = document.getElementById('oc-setting-api-key');
          var mInput = document.getElementById('oc-setting-model');
          var pCheck = document.getElementById('oc-setting-use-proxy');

          var baseURL = (bInput ? bInput.value.trim() : '').replace(/\/+$/, '');
          var apiKey = kInput ? kInput.value.trim() : '';
          var model = mInput ? mInput.value.trim() : 'gpt-4o-mini';
          var useProxy = pCheck ? pCheck.checked : false;

          if (baseURL === 'simulation' || baseURL === 'demo' || baseURL === 'mock') {
            if (statusDiv) {
              statusDiv.className = 'oc-dialog-status success';
              statusDiv.textContent = '✅ Simulation engine ready! Generates Grandmaster move recommendations instantly.';
            }
            return;
          }

          if (statusDiv) {
            statusDiv.className = 'oc-dialog-status loading';
            statusDiv.textContent = 'Testing connection...';
          }

          var testSettings = {
            baseURL: baseURL,
            apiKey: apiKey,
            model: model,
            useProxy: useProxy
          };

          var payload = {
            model: model,
            messages: [{ role: 'user', content: 'Say hello in 1 word.' }],
            max_tokens: 5,
            stream: false
          };

          if (OukReview && OukReview.sendChatRequest) {
            OukReview.sendChatRequest(testSettings, payload)
              .then(function () {
                if (statusDiv) {
                  statusDiv.className = 'oc-dialog-status success';
                  var via = testSettings.useProxy ? ' (via Dev Proxy)' : '';
                  statusDiv.textContent = '✅ Connected successfully to ' + model + via + '!';
                }
                if (pCheck && testSettings.useProxy) {
                  pCheck.checked = true;
                }
              })
              .catch(function (err) {
                if (statusDiv) {
                  statusDiv.className = 'oc-dialog-status error';
                  statusDiv.textContent = '❌ Error: ' + err.message;
                }
              });
          } else {
            var headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
            fetch(baseURL + '/chat/completions', {
              method: 'POST',
              headers: headers,
              body: JSON.stringify(payload)
            })
              .then(function (res) {
                return res.text().then(function (rawText) {
                  var data = OukReview && OukReview.parseChatResponseBody ? OukReview.parseChatResponseBody(rawText) : null;
                  if (!res.ok) throw new Error((data && data.error && data.error.message) || ('HTTP ' + res.status));
                  if (!data) throw new Error('Received unexpected non-JSON response: ' + rawText.slice(0, 100));
                  return data;
                });
              })
              .then(function () {
                if (statusDiv) {
                  statusDiv.className = 'oc-dialog-status success';
                  statusDiv.textContent = '✅ Connected successfully to ' + model + '!';
                }
              })
              .catch(function (err) {
                if (statusDiv) {
                  statusDiv.className = 'oc-dialog-status error';
                  statusDiv.textContent = '❌ Error: ' + err.message;
                }
              });
          }
        });
      }

      var simulateCurBtn = document.getElementById('oc-simulate-current-btn');
      if (simulateCurBtn) {
        simulateCurBtn.addEventListener('click', function () {
          var history = appState.gameState.history;
          if (history.length === 0) {
            alert('Make a move first on the board to simulate an AI review!');
            return;
          }
          var idx = appState.viewMoveIndex >= 0 ? appState.viewMoveIndex : history.length - 1;
          simulateMoveAtIndex(idx);
        });
      }

      if (reviewGameBtn) reviewGameBtn.addEventListener('click', startFullGameReview);
      if (cancelReviewBtn) {
        cancelReviewBtn.addEventListener('click', function () {
          if (reviewSession) reviewSession.cancelFullGameReview();
        });
      }
      if (explainCurBtn) {
        explainCurBtn.addEventListener('click', function () {
          var history = appState.gameState.history;
          if (history.length === 0) {
            alert('No moves played yet!');
            return;
          }
          var idx = appState.viewMoveIndex >= 0 ? appState.viewMoveIndex : history.length - 1;
          explainMoveAtIndex(idx);
        });
      }

      // Step navigation wire-up
      var btnFirst = document.getElementById('oc-nav-first');
      var btnPrev = document.getElementById('oc-nav-prev');
      var btnNext = document.getElementById('oc-nav-next');
      var btnLast = document.getElementById('oc-nav-last');

      if (btnFirst) {
        btnFirst.addEventListener('click', function () {
          if (appState.gameState.history.length > 0) {
            appState.viewMoveIndex = 0;
            render();
          }
        });
      }
      if (btnPrev) {
        btnPrev.addEventListener('click', function () {
          var history = appState.gameState.history;
          if (history.length === 0) return;
          var cur = appState.viewMoveIndex >= 0 ? appState.viewMoveIndex : history.length - 1;
          appState.viewMoveIndex = Math.max(0, cur - 1);
          render();
        });
      }
      if (btnNext) {
        btnNext.addEventListener('click', function () {
          var history = appState.gameState.history;
          if (history.length === 0) return;
          var cur = appState.viewMoveIndex >= 0 ? appState.viewMoveIndex : history.length - 1;
          appState.viewMoveIndex = Math.min(history.length - 1, cur + 1);
          render();
        });
      }
      if (btnLast) {
        btnLast.addEventListener('click', function () {
          appState.viewMoveIndex = -1;
          render();
        });
      }
    }

    if (els.moves) {
      els.moves.addEventListener('click', function (evt) {
        var item = evt.target.closest('.oc-move-item');
        if (!item) return;
        var idx = parseInt(item.dataset.index, 10);
        if (!isNaN(idx)) {
          appState.viewMoveIndex = idx;
          render();
        }
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

    // Global keyboard navigation for moves and undo shortcut
    window.addEventListener('keydown', function (evt) {
      if (evt.target.tagName === 'INPUT' || evt.target.tagName === 'SELECT' || evt.target.tagName === 'TEXTAREA') return;

      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'z') {
        evt.preventDefault();
        undoMove();
        return;
      }
      if (evt.key.toLowerCase() === 'u' && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
        evt.preventDefault();
        undoMove();
        return;
      }
      if (evt.key.toLowerCase() === 'h' && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
        evt.preventDefault();
        requestHint();
        return;
      }

      var history = appState.gameState.history;
      if (history.length === 0) return;

      if (evt.key === 'ArrowLeft') {
        var cur = appState.viewMoveIndex >= 0 ? appState.viewMoveIndex : history.length - 1;
        appState.viewMoveIndex = Math.max(0, cur - 1);
        render();
      } else if (evt.key === 'ArrowRight') {
        var curR = appState.viewMoveIndex >= 0 ? appState.viewMoveIndex : history.length - 1;
        appState.viewMoveIndex = Math.min(history.length - 1, curR + 1);
        render();
      } else if (evt.key === 'Home') {
        appState.viewMoveIndex = 0;
        render();
      } else if (evt.key === 'End') {
        appState.viewMoveIndex = -1;
        render();
      }
    });

    render();
    renderControls();

    return {
      handleSquareClick: handleSquareClick,
      getState: function () { return appState; },
      undoMove: undoMove,
      requestHint: requestHint,
      explainMoveAtIndex: explainMoveAtIndex,
      setTheme: function (theme) {
        themeState.appTheme = theme;
        saveSetting('ouk_app_theme', theme);
        applyAppTheme(theme);
      },
      setBoardTheme: function (board) {
        themeState.boardTheme = board;
        saveSetting('ouk_board_theme', board);
        applyBoardTheme(board);
      },
      setPieceSkin: function (skin) {
        themeState.pieceSkin = skin;
        saveSetting('ouk_piece_skin', skin);
        applyPieceSkin(skin);
        render();
      }
    };
  }

  var api = { renderBoard: renderBoard, createApp: createApp, moveListScrollTop: moveListScrollTop };
  root.OukUI = api;
})(typeof window !== 'undefined' ? window : globalThis);

