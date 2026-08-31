# Ouk Chaktrang (Khmer Chess) — Web App Design

Status: Approved 2026-08-31.

## Goal

A correct, playable web implementation of Ouk Chaktrang (Khmer chess), supporting
both local 2-player pass-and-play and a computer opponent, with the full official
counting (endgame) draw rule.

## Rules reference (verified against Wikipedia's Makruk/Ouk Chaktrang article,
starting position confirmed against the article's actual DOM, not eyeballed)

### Board & starting position

8×8 board, files a-h, ranks 1-8, White on rank 1.

| Rank | a | b | c | d | e | f | g | h |
|---|---|---|---|---|---|---|---|---|
| 8 (Black) | R | N | B | **Q** | **K** | B | N | R |
| 7 | . | . | . | . | . | . | . | . |
| 6 (Black pawns) | p | p | p | p | p | p | p | p |
| 5 | . | . | . | . | . | . | . | . |
| 4 | . | . | . | . | . | . | . | . |
| 3 (White pawns) | P | P | P | P | P | P | P | P |
| 2 | . | . | . | . | . | . | . | . |
| 1 (White) | R | N | B | **K** | **Q** | B | N | R |

King and Queen are **not** mirrored between sides — White King (d1) shares a file
with Black Queen (d8); White Queen (e1) shares a file with Black King (e8). This is
the single most commonly-gotten-wrong detail versus international chess.

### Piece movement

- **Pawn**: 1 square straight forward (move only); 1 square diagonally forward
  (capture only). No double-step, no en passant.
- **Promoted pawn**: moves like Queen (below). Promotion is automatic, no choice of
  piece, triggered when a pawn reaches the rank where the *opponent's* pawns
  started (rank 6 for White, rank 3 for Black).
- **Queen** ("Met"/"Neang"): 1 square diagonally, any of 4 directions.
- **Bishop** ("Khon"/"Koul"): 1 square diagonally (4 directions) OR 1 square
  straight forward. 5 possible target squares.
- **Knight**: standard chess knight jump (2+1 L-shape), jumps over pieces.
- **Rook** ("Ruea"/"Tuuk"): standard chess rook slide, any distance orthogonal.
- **King**: 1 square in any of the 8 directions. Checkmate ends the game.
  Stalemate is a **draw** (not a loss, unlike shatranj).

### Cambodia-specific first-move exceptions

Both gated on a single global condition: **no capture has occurred yet, by either
side, anywhere in the game.** The instant any capture happens, both options
disappear permanently for both players, whether or not either had used them yet.

1. A King's first move may instead be a single knight-style jump — only legal if
   the King is not currently in check.
2. A Queen's first move may instead be a straight 2-square advance — only legal
   if both squares on that path are empty (in practice requires its own pawn to
   have already moved out of the way on an earlier turn).

### Counting rule (full official version)

Two triggers:

**A. Bare-king trigger.** Once a side has been reduced to king-only (no pawns, no
other pieces), the opponent must deliver checkmate within a move budget set by
their own remaining material:

| Attacker's material | Base budget |
|---|---|
| 2 rooks | 8 |
| 1 rook | 16 |
| 2 bishops (no rooks) | 22 |
| 2 knights (no rooks/bishops) | 32 |
| 1 bishop (no rooks) | 44 |
| 1 knight (no rooks/bishops) | 64 |
| Only queens / promoted pawns | 64 |

Actual budget = base value − total pieces remaining on the board (both kings
included) at the moment the count (re)starts. Promoted pawns count as
queen-tier material (they move identically). If checkmate isn't delivered
within budget, the game is a draw.

**B. No-progress trigger.** Once *both* sides have no pawns left at all
(captured or promoted away), 64 moves without a capture or checkmate → draw.

**Deliberate simplification vs. the official OTB rule**: the official rule lets
the defending player manually announce/stop/restart the count, for use with a
human arbiter. This implementation makes it automatic — the engine starts
counting the instant a trigger condition is met, and recomputes the budget live
if the material mix changes mid-count. Same budgets, same forced-draw outcome;
just no manual announcement ritual.

## Architecture

Plain JS, no build step, no dependencies.

```
rean-ouk-chaktrong/
  index.html
  styles.css
  src/engine.js   — board state, legal move generation, check/mate/stalemate,
                     promotion, the two first-move exceptions, counting-rule
                     state machine. Pure logic, no DOM — fully unit-testable.
  src/ai.js       — opponent, built on engine.js
  src/ui.js       — rendering + click-to-move interaction, wires engine+ai to
                     the page
  src/pieces.js   — original SVG piece glyphs (not copied from any source)
  tests/engine.test.js       — node --test unit tests
  scripts/build-artifact.js  — concatenates src/* into one inlined HTML file
                                for publishing as a shareable Claude Artifact
```

Each `src/` file works unmodified three ways: `<script src>` locally,
`require()`'d from Node tests, and concatenated verbatim into the single-file
Artifact build (UMD-lite pattern, no ESM import/export).

## Testing

TDD on `engine.js`: legal-move sets per piece type from various board states,
promotion triggers, the first-move exceptions (including expiry after any
capture), check/checkmate/stalemate detection on known positions, counting-rule
budget computation and forced-draw behavior, plus perft-style legal-move-count
checks from the start position as a cross-check. Then a full game played
through the actual UI in-browser to confirm it's genuinely playable, including
forcing a promotion and a checkmate.

## AI opponent

Negamax + alpha-beta pruning, iterative deepening under a time budget
(~1s/move default, adjustable), built directly on `engine.js`'s move generator.

Evaluation: material (Rook 5, Knight 3, Bishop 2.5, Queen 1.5, Pawn 1, promoted
pawn 1.5) plus basic mobility/king-safety terms. Treats a counting-forced draw
as a draw outcome in search so it won't blunder into one while ahead and will
steer toward one while lost. Heuristic search, not a tablebase — won't play the
counting phase perfectly.

## Interface

Click-to-select / click-to-move board, legal-move highlighting, check
indicator, captured-piece tray, move list, visible counting-rule tracker once
active. Difficulty toggle and 2-player/vs-AI mode switch on one screen.

## Delivery

Real project files in this repo, tested locally via the Browser tool, plus the
single-file build published as a Claude Artifact for instant play from a link.
