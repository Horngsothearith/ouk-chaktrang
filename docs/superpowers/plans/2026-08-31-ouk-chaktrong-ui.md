# Ouk Chaktrang Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable board in the browser — click-to-move, legal-move highlighting, check/checkmate/draw/counting-rule display, captured pieces, move list, 2-player and vs-AI modes — built on the real, tested `src/engine.js` and `src/ai.js`, plus a single-file build for publishing as a Claude Artifact.

**Architecture:** `index.html` + `styles.css` + `src/pieces.js` (original SVG glyphs) + `src/ui.js` (rendering, interaction, a single mutable `appState`), loaded as plain `<script>` tags in dependency order (engine → ai → pieces → ui). `scripts/build-artifact.js` concatenates all four JS files plus the CSS into one inlined HTML file at the end.

**Tech Stack:** Vanilla JS/DOM, no framework, no build step for local dev. Node (for the tiny concatenation script only).

**Spec:** [docs/superpowers/specs/2026-08-31-ouk-chaktrong-web-design.md](../specs/2026-08-31-ouk-chaktrong-web-design.md)

## Global Constraints

- No npm dependencies. `src/pieces.js` and `src/ui.js` use the same UMD-lite/global-attach pattern as `engine.js`/`ai.js` (attach to `window` when there's no `module`), so `scripts/build-artifact.js` can concatenate them verbatim with zero transformation.
- Verification for this plan is primarily **the running app in a browser**, not `node --test` — DOM/interaction correctness isn't meaningfully unit-testable without a browser, and the design instructions call for testing the actual golden path in one. Each task's "run to verify" step says exactly what to click and see.
- Promotion is automatic (engine always promotes to the queen-moving piece, no choice) — no promotion-picker UI is needed, confirmed already in the spec.
- Board orientation: White's back rank (engine rank index 0) renders at the bottom of the screen, consistent with how the pieces were verified against Wikipedia's diagram.

---

### Task 1: Static board rendering

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Create: `src/pieces.js`
- Create: `src/ui.js`

**Interfaces:**
- Produces: `OukPieces.svgFor(type, color) -> string` (inline `<svg>...</svg>` markup, viewBox `0 0 100 100`). `OukUI.renderBoard(gameState, containerEl)` — clears and redraws the 8×8 grid with pieces from the given engine state; each square is a `<div class="oc-square" data-rank data-file>`.

- [ ] **Step 1: Write `src/pieces.js`**

```js
// src/pieces.js
(function (root) {
  'use strict';

  // Original glyphs (not copied from any source): flat geometric shapes
  // evoking the traditional bulbous Makruk/Ouk piece silhouettes, one per
  // type, colored via `currentColor` so a single path works for both sides.
  var PATHS = {
    K: '<circle cx="50" cy="34" r="16"/><path d="M28 90 Q50 58 72 90 Z"/><rect x="44" y="14" width="12" height="14"/>',
    Q: '<circle cx="50" cy="40" r="14"/><path d="M30 90 Q50 64 70 90 Z"/>',
    B: '<circle cx="50" cy="42" r="13"/><path d="M32 90 Q50 66 68 90 Z"/><circle cx="50" cy="20" r="5"/>',
    N: '<path d="M35 90 L40 50 Q30 40 38 22 Q55 18 62 34 L58 50 L68 90 Z"/>',
    R: '<rect x="32" y="26" width="36" height="14"/><path d="M30 90 Q50 62 70 90 Z"/><rect x="32" y="26" width="8" height="8"/><rect x="60" y="26" width="8" height="8"/>',
    P: '<circle cx="50" cy="48" r="15"/><path d="M36 90 Q50 72 64 90 Z"/>'
  };

  function svgFor(type, color) {
    var body = PATHS[type] || '';
    var fill = color === 'w' ? '#f5efe0' : '#3a2a1a';
    var stroke = color === 'w' ? '#7a5c30' : '#1a1008';
    return '<svg viewBox="0 0 100 100" class="oc-piece" style="fill:' + fill + ';stroke:' + stroke + ';stroke-width:3">' + body + '</svg>';
  }

  var api = { svgFor: svgFor };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukPieces = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Write `styles.css`**

```css
:root {
  --oc-light: #eadfc4;
  --oc-dark: #a97c50;
  --oc-highlight: #6fae4a;
  --oc-select: #4a90d9;
  --oc-check: #c0392b;
  --oc-bg: #f7f3ea;
  --oc-panel-bg: #ffffff;
  --oc-text: #2a2016;
}
@media (prefers-color-scheme: dark) {
  :root {
    --oc-bg: #1c1712;
    --oc-panel-bg: #2a2119;
    --oc-text: #f0e9db;
  }
}
body { margin: 0; }
.oc-app { display: flex; flex-wrap: wrap; gap: 24px; padding: 24px; background: var(--oc-bg); color: var(--oc-text); font-family: system-ui, sans-serif; min-height: 100vh; box-sizing: border-box; }
.oc-board { display: grid; grid-template-columns: repeat(8, minmax(36px, 64px)); grid-template-rows: repeat(8, minmax(36px, 64px)); border: 3px solid var(--oc-dark); width: min(90vw, 512px); aspect-ratio: 1; }
.oc-square { position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.oc-square.light { background: var(--oc-light); }
.oc-square.dark { background: var(--oc-dark); }
.oc-square.selected::after { content: ''; position: absolute; inset: 0; box-shadow: inset 0 0 0 4px var(--oc-select); }
.oc-square.legal-target::after { content: ''; position: absolute; width: 30%; height: 30%; border-radius: 50%; background: var(--oc-highlight); opacity: 0.75; }
.oc-square.legal-capture::after { content: ''; position: absolute; inset: 0; box-shadow: inset 0 0 0 4px var(--oc-highlight); }
.oc-square.in-check::after { content: ''; position: absolute; inset: 0; box-shadow: inset 0 0 0 4px var(--oc-check); }
.oc-piece { width: 82%; height: 82%; pointer-events: none; }
.oc-panel { min-width: 260px; display: flex; flex-direction: column; gap: 16px; }
.oc-status { font-weight: 600; font-size: 1.1em; }
.oc-counting { background: #fff3cd; color: #7a5c00; padding: 8px 12px; border-radius: 6px; font-size: 0.9em; }
.oc-captured { display: flex; flex-wrap: wrap; gap: 4px; min-height: 28px; }
.oc-captured .oc-piece { width: 22px; height: 22px; }
.oc-moves { max-height: 200px; overflow-y: auto; font-family: monospace; font-size: 0.9em; }
.oc-controls { display: flex; flex-direction: column; gap: 8px; }
```

- [ ] **Step 3: Write `src/ui.js` (rendering only, so far)**

```js
// src/ui.js
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
```

- [ ] **Step 4: Write `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ouk Chaktrang</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<div class="oc-app">
  <div class="oc-board" id="board"></div>
  <div class="oc-panel">
    <div class="oc-status" id="status">White to move</div>
    <div class="oc-counting" id="counting" hidden></div>
    <div>
      <div>Captured by White:</div>
      <div class="oc-captured" id="captured-by-white"></div>
      <div>Captured by Black:</div>
      <div class="oc-captured" id="captured-by-black"></div>
    </div>
    <div class="oc-moves" id="moves"></div>
    <div class="oc-controls" id="controls"></div>
  </div>
</div>
<script src="src/engine.js"></script>
<script src="src/ai.js"></script>
<script src="src/pieces.js"></script>
<script src="src/ui.js"></script>
<script>
  var gameState = OukEngine.createInitialState();
  OukUI.renderBoard(gameState, document.getElementById('board'));
</script>
</body>
</html>
```

- [ ] **Step 5: Run to verify — start a static server and look at the board**

Run (background):
```bash
cd C:\Users\MDC\Documents\Project\rean-ouk-chaktrong && npx --yes serve -l 5173 .
```
Open `http://localhost:5173/index.html` in the Browser tool and confirm: 8×8 checkered board, White's back rank (Rook-Knight-Bishop-**King**-**Queen**-Bishop-Knight-Rook) at the bottom on rank "1", pawns on the row above it, mirrored Black setup at the top with **Queen** left of **King** — matching the verified starting position from the engine plan.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css src/pieces.js src/ui.js
git commit -m "ui: static board rendering"
```

---

### Task 2: Click-to-select and click-to-move

**Files:**
- Modify: `src/ui.js`, `index.html`

**Interfaces:**
- Consumes: `OukEngine.generateLegalMoves`, `OukEngine.applyMove`, `renderBoard` (Task 1).
- Produces: `OukUI.createApp(containerEls) -> {handleSquareClick, getState}` — owns the mutable `appState` (`{gameState, selectedSquare, legalMovesForSelected}`) and wires clicks; `index.html`'s inline script now calls this instead of `renderBoard` directly.

- [ ] **Step 1: Extend `src/ui.js`**

```js
  function squareKey(rank, file) { return rank + ',' + file; }

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
```

Add `createApp: createApp,` to `api`.

- [ ] **Step 2: Update `index.html`'s inline script**

```html
<script>
  var app = OukUI.createApp({ board: document.getElementById('board') });
</script>
```
(replacing the Task 1 inline script)

- [ ] **Step 3: Run to verify — play a few moves in the browser**

Reload the page. Click a White pawn: confirm its square gets a selection ring and its one legal forward square gets a highlight dot. Click that highlighted square: confirm the pawn moves and it becomes Black's turn (click a Black piece next and confirm ITS legal moves show, not White's). Click a piece, then click a non-legal square: confirm it deselects (or reselects if the second click was on another own piece) rather than moving illegally.

- [ ] **Step 4: Commit**

```bash
git add src/ui.js index.html
git commit -m "ui: click-to-select and click-to-move interaction"
```

---

### Task 3: Game status, check indicator, captured pieces, move list

**Files:**
- Modify: `src/ui.js`

**Interfaces:**
- Consumes: `appState.gameState.status/winner/counting/history` (engine.js), `OukEngine.isInCheck`, `OukEngine.findKing`, `OukEngine.squareName`.
- Produces: `render()` (Task 2) now also updates `els.status`, `els.counting`, `els.capturedByWhite`, `els.capturedByBlack`, `els.moves`, and adds `.in-check` to the checked king's square. `createApp`'s `els` parameter grows to include these.

- [ ] **Step 1: Extend `render()` in `src/ui.js`**

```js
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
```

Update `render()`'s body to call these and to mark the checked king's square:

```js
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
        // ...(unchanged from Task 2)
      }
    }
```

Update `index.html`'s `createApp` call to pass the new elements:

```html
<script>
  var app = OukUI.createApp({
    board: document.getElementById('board'),
    status: document.getElementById('status'),
    counting: document.getElementById('counting'),
    capturedByWhite: document.getElementById('captured-by-white'),
    capturedByBlack: document.getElementById('captured-by-black'),
    moves: document.getElementById('moves')
  });
</script>
```

- [ ] **Step 2: Run to verify — trigger a check and a promotion in the browser**

Play moves that put a king in check: confirm the king's square gets a red ring and the status line says "in check". Advance a pawn to promotion: confirm it visually becomes the queen-moving piece and the move list shows `=Q`. Capture a piece: confirm it appears in the correct side's captured tray and the move list shows `x`.

- [ ] **Step 3: Commit**

```bash
git add src/ui.js index.html
git commit -m "ui: status line, check indicator, captured pieces, move list"
```

---

### Task 4: Mode controls and the AI opponent

**Files:**
- Modify: `src/ui.js`, `index.html`

**Interfaces:**
- Consumes: `OukAI.chooseMove` (ai.js).
- Produces: `render()`'s controls section gets New Game / 2-Player / vs-AI / difficulty inputs; `handleSquareClick` triggers an AI reply (via `setTimeout`, so the human's move paints before the AI's synchronous search runs) when `appState.mode === 'vs-ai'` and it becomes the AI's turn.

- [ ] **Step 1: Extend `src/ui.js`**

```js
    appState.mode = '2p'; // '2p' | 'vs-ai'
    appState.aiColor = 'b';
    appState.aiOptions = { timeLimitMs: 800, maxDepth: 5 };

    function maybeTriggerAI() {
      if (appState.mode !== 'vs-ai') return;
      if (appState.gameState.status !== 'active') return;
      if (appState.gameState.turn !== appState.aiColor) return;
      els.status.textContent = (appState.aiColor === 'w' ? 'White' : 'Black') + ' (AI) is thinking...';
      setTimeout(function () {
        var move = OukAI.chooseMove(appState.gameState, appState.aiOptions);
        appState.gameState = OukEngine.applyMove(appState.gameState, move);
        render();
      }, 30);
    }

    function renderControls() {
      els.controls.innerHTML =
        '<button id="oc-new-game">New Game</button>' +
        '<label><input type="radio" name="oc-mode" value="2p"' + (appState.mode === '2p' ? ' checked' : '') + '> 2-Player</label>' +
        '<label><input type="radio" name="oc-mode" value="vs-ai"' + (appState.mode === 'vs-ai' ? ' checked' : '') + '> vs Computer</label>' +
        '<label>Difficulty: <select id="oc-difficulty">' +
          '<option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option>' +
        '</select></label>';

      document.getElementById('oc-new-game').addEventListener('click', function () {
        appState.gameState = OukEngine.createInitialState();
        appState.selectedSquare = null;
        appState.legalMovesForSelected = [];
        render();
        maybeTriggerAI();
      });
      els.controls.querySelectorAll('input[name="oc-mode"]').forEach(function (radio) {
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
```

Call `renderControls()` once (controls don't need to redraw every move — only rebuild their DOM once, at the end of `createApp`, after the initial `render()`). Add `maybeTriggerAI();` to the end of `handleSquareClick` (after a successful human move):

```js
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
```

- [ ] **Step 2: Run to verify — play a full game against the AI in the browser**

Switch to "vs Computer", confirm the status line shows "thinking..." briefly then the AI replies with a legal move. Play a full game through to checkmate (or force one using the browser's JS console to fast-forward via `app.getState()` if needed) and confirm the game correctly stops accepting clicks once `status !== 'active'`.

- [ ] **Step 3: Commit**

```bash
git add src/ui.js index.html
git commit -m "ui: 2-player/vs-AI mode controls and difficulty"
```

---

### Task 5: Single-file Artifact build

**Files:**
- Create: `scripts/build-artifact.js`
- Create: `artifact/ouk-chaktrong.html` (generated, but committed so the Artifact-publish step has a concrete file to point at)

**Interfaces:**
- Consumes: `src/engine.js`, `src/ai.js`, `src/pieces.js`, `src/ui.js`, `styles.css`, `index.html`'s body markup.
- Produces: a single self-contained HTML file with all CSS inlined in a `<style>` tag and all JS concatenated into one `<script>` tag (in dependency order), no external `<script src>`/`<link>` references.

- [ ] **Step 1: Write `scripts/build-artifact.js`**

```js
// scripts/build-artifact.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const jsFiles = ['src/engine.js', 'src/ai.js', 'src/pieces.js', 'src/ui.js'];
const js = jsFiles.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

const bodyMatch = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .match(/<body>([\s\S]*?)<\/body>/);
if (!bodyMatch) throw new Error('could not find <body> in index.html');
let body = bodyMatch[1];
// Strip the modular <link>/<script src> tags; the inlined <style>/<script> below replace them.
body = body.replace(/<link rel="stylesheet"[^>]*>\s*/g, '');
body = body.replace(/<script src="[^"]*"><\/script>\s*/g, '');

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ouk Chaktrang</title>
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${js}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(root, 'artifact', 'ouk-chaktrong.html'), out);
console.log('Wrote artifact/ouk-chaktrong.html (' + out.length + ' bytes)');
```

- [ ] **Step 2: Run it**

```bash
mkdir -p artifact && node scripts/build-artifact.js
```
Expected: prints the byte count, creates `artifact/ouk-chaktrong.html`.

- [ ] **Step 3: Run to verify — open the bundled file directly and confirm it plays identically**

Open `artifact/ouk-chaktrong.html` directly in the Browser tool (no server needed — it's fully self-contained) and repeat the Task 2/4 golden-path check: starting position renders correctly, a move can be made, switching to vs-AI produces a legal AI reply.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-artifact.js artifact/ouk-chaktrong.html
git commit -m "build: single-file artifact bundle for Claude Artifact publishing"
```

---

## Self-Review Notes

- **Spec coverage**: board rendering + verified starting position (Task 1), click-to-move (Task 2), status/check/captures/move-list/counting display (Task 3), 2P and vs-AI modes with difficulty (Task 4), single-file Artifact build (Task 5). No spec item without a task.
- **Type consistency checked**: `els` object keys introduced in Task 1 (`board`) are extended, never renamed, across Tasks 2-4 (`status`, `counting`, `capturedByWhite`, `capturedByBlack`, `moves`, `controls`); `appState` fields (`gameState`, `selectedSquare`, `legalMovesForSelected`, then `mode`/`aiColor`/`aiOptions`) are additive across tasks, never restructured.
- **Deferred by design, not a gap**: no drag-and-drop, no move undo, no sound/animation — none were in the approved spec; adding them now would be scope creep.
