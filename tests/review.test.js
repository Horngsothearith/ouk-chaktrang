const test = require('node:test');
const assert = require('node:assert/strict');
const OukEngine = require('../src/engine.js');
const OukAI = require('../src/ai.js');
const OukReview = require('../src/review.js');

test('PIECE_NAMES has authentic Khmer and English names for all pieces', () => {
  const types = ['K', 'Q', 'B', 'N', 'R', 'P'];
  types.forEach((t) => {
    assert.ok(OukReview.PIECE_NAMES[t], 'missing piece type: ' + t);
    assert.ok(OukReview.PIECE_NAMES[t].km, 'missing khmer name for: ' + t);
    assert.ok(OukReview.PIECE_NAMES[t].en, 'missing english name for: ' + t);
  });
});

test('renderAsciiBoard produces valid 8x8 ASCII representation', () => {
  const state = OukEngine.createInitialState();
  const ascii = OukReview.renderAsciiBoard(state);
  assert.ok(ascii.includes('a b c d e f g h'));
  assert.ok(ascii.includes('R N B K Q B N R') || ascii.includes('R N B Q K B N R'));
  assert.ok(ascii.includes('P P P P P P P P'));
});

test('classifyMoveByEval accurately categorizes move quality based on evaluation swings', () => {
  // White perspective
  const brilliant = OukReview.classifyMoveByEval(0.0, 1.2, true, true);
  assert.equal(brilliant.key, 'brilliant');

  const best = OukReview.classifyMoveByEval(0.0, 0.1, true, true);
  assert.equal(best.key, 'best');

  const good = OukReview.classifyMoveByEval(0.0, -0.4, true, false);
  assert.equal(good.key, 'good');

  const inaccuracy = OukReview.classifyMoveByEval(0.0, -0.9, true, false);
  assert.equal(inaccuracy.key, 'inaccuracy');

  const mistake = OukReview.classifyMoveByEval(0.0, -1.8, true, false);
  assert.equal(mistake.key, 'mistake');

  const blunder = OukReview.classifyMoveByEval(0.0, -3.5, true, false);
  assert.equal(blunder.key, 'blunder');
});

test('buildPromptContext extracts correct game and engine facts for a played move', () => {
  const state = OukEngine.createInitialState();
  // Move 1: White moves Pawn c3 to c4 (rank 2 to rank 3)
  const moves = OukEngine.generateLegalMoves(state, 'w');
  const cPawnMove = moves.find((m) => m.from.rank === 2 && m.from.file === 2 && m.to.rank === 3);
  assert.ok(cPawnMove, 'pawn move c3-c4 should be legal');

  const history = [cPawnMove];
  const ctx = OukReview.buildPromptContext(history, 0);

  assert.equal(ctx.contextData.moveNumber, 1);
  assert.equal(ctx.contextData.mover, 'White');
  assert.equal(ctx.contextData.from, 'c3');
  assert.equal(ctx.contextData.to, 'c4');
  assert.equal(ctx.contextData.pieceType, 'P');
  assert.ok(ctx.contextData.boardBeforeAscii);
  assert.ok(ctx.contextData.boardAfterAscii);
  assert.ok(ctx.contextData.classification);
});

test('buildUserPrompt includes language and Khmer chess terminology', () => {
  const state = OukEngine.createInitialState();
  const moves = OukEngine.generateLegalMoves(state, 'w');
  const history = [moves[0]];
  const ctx = OukReview.buildPromptContext(history, 0);

  const promptEn = OukReview.buildUserPrompt(ctx.contextData, 'en');
  assert.ok(promptEn.includes('Analyze Move #1'));
  assert.ok(promptEn.includes('Engine Eval Before'));
  assert.ok(promptEn.includes('Board Before Move'));

  const promptKm = OukReview.buildUserPrompt(ctx.contextData, 'km');
  assert.ok(promptKm.includes('ភាសាខ្មែរ'));
});

test('parseAiResponse handles JSON fences and fallback parsing gracefully', () => {
  const jsonText = '```json\n{\n  "classification": "best",\n  "title": "Solid Center Pawn Push",\n  "explanation": "White advances the Trey to establish center control.",\n  "tags": ["Center Control", "Trey Push"],\n  "betterMove": null\n}\n```';
  const fallback = { key: 'good' };
  const parsed = OukReview.parseAiResponse(jsonText, fallback);

  assert.equal(parsed.classification, 'best');
  assert.equal(parsed.title, 'Solid Center Pawn Push');
  assert.equal(parsed.tags.length, 2);
  assert.ok(parsed.explanation.includes('White advances the Trey'));

  const plainText = 'White developed the knight nicely to protect the center.';
  const fallbackParsed = OukReview.parseAiResponse(plainText, fallback);
  assert.equal(fallbackParsed.classification, 'good');
  assert.equal(fallbackParsed.explanation, plainText);

  // Thinking tag handling (DeepSeek-R1 / QwQ reasoning models)
  const thinkResponse = '<think>\nEvaluating board state... White controls e4.\n</think>\n```json\n{"classification": "best", "title": "Strong Knight Move", "explanation": "Controls e4."}\n```';
  const thinkParsed = OukReview.parseAiResponse(thinkResponse, fallback);
  assert.equal(thinkParsed.classification, 'best');
  assert.equal(thinkParsed.title, 'Strong Knight Move');
  assert.equal(thinkParsed.explanation, 'Controls e4.');
});

test('createReviewSession handles settings and cache correctly', () => {
  const session = OukReview.createReviewSession();
  const defaultSettings = session.getSettings();
  assert.equal(defaultSettings.model, 'gpt-4o-mini');
  assert.equal(defaultSettings.useProxy, false);

  session.updateSettings({ model: 'gpt-4o', apiKey: 'test-key-123', useProxy: true });
  assert.equal(session.getSettings().model, 'gpt-4o');
  assert.equal(session.getSettings().apiKey, 'test-key-123');
  assert.equal(session.getSettings().useProxy, true);
});

test('OukReview exports sendChatRequest helper', () => {
  assert.equal(typeof OukReview.sendChatRequest, 'function');
});

test('parseChatResponseBody handles standard JSON and SSE data lines', () => {
  // Standard JSON
  const stdJson = JSON.stringify({ id: '123', choices: [{ message: { role: 'assistant', content: 'Hello' } }] });
  const parsedStd = OukReview.parseChatResponseBody(stdJson);
  assert.equal(parsedStd.choices[0].message.content, 'Hello');

  // SSE Stream
  const sseData = 'data: {"id":"1","choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"id":"1","choices":[{"delta":{"content":" World!"}}]}\n\ndata: [DONE]\n';
  const parsedSse = OukReview.parseChatResponseBody(sseData);
  assert.ok(parsedSse);
  assert.equal(parsedSse.choices[0].message.content, 'Hello World!');

  // Single data: line (from Ollama/vLLM proxies)
  const singleData = 'data: {"id":"chat-1","choices":[{"message":{"role":"assistant","content":"Greetings"}}]}';
  const parsedSingle = OukReview.parseChatResponseBody(singleData);
  assert.ok(parsedSingle);
  assert.equal(parsedSingle.choices[0].message.content, 'Greetings');
});

test('generateSimulatedReview generates rich authentic reviews in English and Khmer', () => {
  const state = OukEngine.createInitialState();
  const moves = OukEngine.generateLegalMoves(state, 'w');
  const history = [moves[0]];
  const ctx = OukReview.buildPromptContext(history, 0);

  // English simulation
  const simEn = OukReview.generateSimulatedReview(ctx.contextData, 'en');
  assert.ok(simEn.title);
  assert.ok(simEn.explanation);
  assert.ok(simEn.tags.length > 0);

  // Khmer simulation
  const simKm = OukReview.generateSimulatedReview(ctx.contextData, 'km');
  assert.ok(simKm.title);
  assert.ok(simKm.explanation);
  assert.ok(simKm.tags.length > 0);

  // Promotion special test
  const promoCtx = Object.assign({}, ctx.contextData, { special: 'promotion' });
  const promoSim = OukReview.generateSimulatedReview(promoCtx, 'en');
  assert.ok(promoSim.title.includes('Promotion') || promoSim.explanation.includes('promoting'));

  // King jump special test
  const jumpCtx = Object.assign({}, ctx.contextData, { special: 'kingJump' });
  const jumpSim = OukReview.generateSimulatedReview(jumpCtx, 'en');
  assert.ok(jumpSim.title.includes('King Jump') || jumpSim.explanation.includes('King Jump'));
});


test('replayToMoveIndex and stateBeforeMoveIndex are exported for the UI to consume', () => {
  // ui.js calls OukReview.replayToMoveIndex when the user clicks a past move,
  // and needs stateBeforeMoveIndex to rewind for the on-board recommendation.
  assert.equal(typeof OukReview.replayToMoveIndex, 'function');
  assert.equal(typeof OukReview.stateBeforeMoveIndex, 'function');

  const state = OukEngine.createInitialState();
  const first = OukEngine.generateLegalMoves(state, 'w')[0];
  const afterFirst = OukEngine.applyMove(state, first);
  const second = OukEngine.generateLegalMoves(afterFirst, 'b')[0];
  const history = [first, second];

  const before = OukReview.stateBeforeMoveIndex(history, 1);
  assert.equal(before.history.length, 1, 'position before move 2 has one move played');
  assert.equal(before.turn, 'b', 'Black is to move before move 2');

  const replayed = OukReview.replayToMoveIndex(history, 1);
  assert.equal(replayed.history.length, 2, 'replaying through move 2 has both moves played');
});

test('buildPromptContext exposes board coordinates for the played and recommended moves', () => {
  const state = OukEngine.createInitialState();
  const moves = OukEngine.generateLegalMoves(state, 'w');
  const history = [moves[0]];
  const ctx = OukReview.buildPromptContext(history, 0).contextData;

  // Played move coords must mirror the algebraic strings already in contextData,
  // so the UI can highlight squares without re-parsing notation.
  assert.ok(ctx.playedMoveCoords, 'playedMoveCoords should always be present');
  assert.equal(
    OukEngine.squareName(ctx.playedMoveCoords.from.rank, ctx.playedMoveCoords.from.file),
    ctx.from
  );
  assert.equal(
    OukEngine.squareName(ctx.playedMoveCoords.to.rank, ctx.playedMoveCoords.to.file),
    ctx.to
  );

  // The engine's preferred move is null exactly when the played move was best.
  if (ctx.isBestMove) {
    assert.equal(ctx.bestEngineMoveCoords, null, 'no alternative to draw when played move is best');
  } else {
    assert.ok(ctx.bestEngineMoveCoords, 'a non-best move must carry a recommendation to draw');
    const c = ctx.bestEngineMoveCoords;
    [c.from.rank, c.from.file, c.to.rank, c.to.file].forEach((n) => {
      assert.ok(Number.isInteger(n) && n >= 0 && n <= 7, 'coords must be on-board integers');
    });
    // Coords must agree with the human-readable text the review card shows.
    const fromName = OukEngine.squareName(c.from.rank, c.from.file);
    const toName = OukEngine.squareName(c.to.rank, c.to.file);
    assert.ok(ctx.bestEngineMove.includes(fromName), 'text should name the from square');
    assert.ok(ctx.bestEngineMove.includes(toName), 'text should name the to square');
    assert.equal(typeof c.captured, 'boolean');
  }
});

test('bestEngineMoveCoords is null when the played move matches the engine preference', () => {
  const state = OukEngine.createInitialState();
  const moves = OukEngine.generateLegalMoves(state, 'w');
  // Find a position where the played move IS the engine's pick by playing the
  // engine's own choice, so the "nothing to recommend" branch is exercised.
  const best = OukAI.chooseMove(state, { timeLimitMs: 250, maxDepth: 4 });
  const ctx = OukReview.buildPromptContext([best], 0).contextData;
  assert.equal(ctx.isBestMove, true);
  assert.equal(ctx.bestEngineMoveCoords, null);
  assert.ok(moves.length > 0);
});

// --- LLM-sourced recommendation ------------------------------------------
// The arrow drawn on the board comes from the LLM when it names a move that is
// actually legal, and falls back to the local engine when it does not.

function firstMoveContext() {
  const state = OukEngine.createInitialState();
  // a3-a4: a quiet pawn push the engine does not rate best, so there is always
  // an engine fallback available to test against.
  const push = OukEngine.generateLegalMoves(state, 'w').find(
    (m) => m.from.rank === 2 && m.from.file === 0 && m.to.rank === 3 && m.to.file === 0
  );
  const built = OukReview.buildPromptContext([push], 0);
  return { stateBefore: built.stateBefore, ctx: built.contextData };
}

test('parseAiResponse extracts structured better-move squares, defaulting to null', () => {
  const fallback = { key: 'good' };
  const withSquares = OukReview.parseAiResponse(JSON.stringify({
    classification: 'inaccuracy', title: 'T', explanation: 'E', tags: ['x'],
    betterMove: 'Nb1-c3 develops', betterMoveFrom: 'b1', betterMoveTo: 'c3'
  }), fallback);
  assert.equal(withSquares.betterMoveFrom, 'b1');
  assert.equal(withSquares.betterMoveTo, 'c3');

  const without = OukReview.parseAiResponse(JSON.stringify({
    classification: 'best', title: 'T', explanation: 'E', tags: ['x']
  }), fallback);
  assert.equal(without.betterMoveFrom, null);
  assert.equal(without.betterMoveTo, null);

  // Non-JSON reply must not invent squares.
  const prose = OukReview.parseAiResponse('just some text', fallback);
  assert.equal(prose.betterMoveFrom, null);
  assert.equal(prose.betterMoveTo, null);
});

test('resolveRecommendedMove draws the LLM move when it is legal', () => {
  const { stateBefore, ctx } = firstMoveContext();
  // Derive a legal alternative rather than hardcoding notation: Ouk Chaktrang
  // pawns start on rank 3, so the knights are blocked and chess intuition
  // about which opening moves exist does not carry over.
  const played = ctx.playedMoveCoords;
  const alt = OukEngine.generateLegalMoves(stateBefore, 'w').find(
    (m) => !(m.from.rank === played.from.rank && m.from.file === played.from.file &&
             m.to.rank === played.to.rank && m.to.file === played.to.file)
  );
  assert.ok(alt, 'the opening position should offer an alternative move');

  const res = OukReview.resolveRecommendedMove(stateBefore, ctx, {
    betterMoveFrom: OukEngine.squareName(alt.from.rank, alt.from.file),
    betterMoveTo: OukEngine.squareName(alt.to.rank, alt.to.file)
  });
  assert.equal(res.source, 'llm');
  assert.deepEqual(res.coords.from, { rank: alt.from.rank, file: alt.from.file });
  assert.deepEqual(res.coords.to, { rank: alt.to.rank, file: alt.to.file });
  assert.equal(typeof res.coords.captured, 'boolean');
});

test('resolveRecommendedMove rejects a move that is blocked in Ouk Chaktrang', () => {
  // Nb1-c3 is the natural chess developing move, but c3 holds a Trey (pawn)
  // in the opening position here, so it must be refused and fall back.
  const { stateBefore, ctx } = firstMoveContext();
  const res = OukReview.resolveRecommendedMove(stateBefore, ctx, {
    betterMoveFrom: 'b1', betterMoveTo: 'c3'
  });
  assert.equal(res.source, 'engine');
});

test('resolveRecommendedMove falls back to the engine for illegal or junk LLM moves', () => {
  const { stateBefore, ctx } = firstMoveContext();
  const engineCoords = ctx.bestEngineMoveCoords;
  assert.ok(engineCoords, 'fixture should have an engine recommendation to fall back to');

  const cases = [
    { betterMoveFrom: 'a1', betterMoveTo: 'h8' },   // legal squares, illegal move
    { betterMoveFrom: 'zz', betterMoveTo: 'c3' },   // unparseable square
    { betterMoveFrom: 'b1', betterMoveTo: null },   // half-specified
    { betterMoveFrom: null, betterMoveTo: null },   // simulation / model said nothing
    { betterMoveFrom: 5, betterMoveTo: {} },        // wrong types entirely
    {}                                              // fields absent
  ];
  cases.forEach((review, i) => {
    const res = OukReview.resolveRecommendedMove(stateBefore, ctx, review);
    assert.equal(res.source, 'engine', 'case ' + i + ' should fall back to the engine');
    assert.deepEqual(res.coords, engineCoords, 'case ' + i + ' should draw the engine move');
  });

  // A missing review object must not throw either.
  assert.equal(OukReview.resolveRecommendedMove(stateBefore, ctx, null).source, 'engine');
});

test('resolveRecommendedMove ignores an LLM move identical to the one played', () => {
  const { stateBefore, ctx } = firstMoveContext();
  // The model claiming a3-a4 is "better" is not an alternative to a3-a4.
  const res = OukReview.resolveRecommendedMove(stateBefore, ctx, {
    betterMoveFrom: 'a3', betterMoveTo: 'a4'
  });
  assert.equal(res.source, 'engine');
});

test('resolveRecommendedMove reports nothing to draw when neither source has a move', () => {
  const state = OukEngine.createInitialState();
  const best = OukAI.chooseMove(state, { timeLimitMs: 250, maxDepth: 4 });
  const built = OukReview.buildPromptContext([best], 0);
  assert.equal(built.contextData.bestEngineMoveCoords, null);

  const res = OukReview.resolveRecommendedMove(built.stateBefore, built.contextData, {
    betterMoveFrom: 'a1', betterMoveTo: 'h8'
  });
  assert.equal(res.source, null);
  assert.equal(res.coords, null);
});
