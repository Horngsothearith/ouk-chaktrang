const test = require('node:test');
const assert = require('node:assert/strict');
const OukEngine = require('../src/engine.js');
const OukReview = require('../src/review.js');
const OukOpponent = require('../src/opponent.js');

// Settings that route through the network path rather than the simulation
// short-circuit. sendChatRequest is stubbed per-test, so nothing is sent.
const LIVE_SETTINGS = { baseURL: 'https://example.test/v1', apiKey: 'k', model: 'test-model' };
const FAST_ENGINE = { timeLimitMs: 20, maxDepth: 1 };

// Replaces the transport for one test and always puts it back, so a failure
// cannot leak a stub into the tests that follow. Awaits the run, so the stub
// is still in place for anything the call does after its first await.
async function withChatResponse(impl, run) {
  const original = OukReview.sendChatRequest;
  OukReview.sendChatRequest = impl;
  try {
    return await run();
  } finally {
    OukReview.sendChatRequest = original;
  }
}

// Captures the debug records one call produces and always unhooks, so a
// failing test cannot leave a listener attached to the shared module.
async function withDebugCapture(run) {
  const records = [];
  OukOpponent.setDebugListener((record) => {
    // The record is one object mutated across phases, so snapshot each emit -
    // holding the reference would give every entry the final phase's fields.
    records.push(Object.assign({}, record));
  });
  try {
    const value = await run();
    return { records, value };
  } finally {
    OukOpponent.setDebugListener(null);
  }
}

function replyWith(content) {
  return () => Promise.resolve({ choices: [{ message: { content } }] });
}

function chooseMove(state, settings, engineOptions) {
  return new Promise((resolve) => {
    OukOpponent.chooseOpponentMove(state, state.history, settings, engineOptions || FAST_ENGINE, (err, result) => {
      resolve({ err, result });
    });
  });
}

function emptyBoard() {
  return new Array(64).fill(null);
}

function stateFrom(board, turn) {
  const state = OukEngine.createInitialState();
  state.board = board;
  state.turn = turn;
  return state;
}

function place(board, square, piece) {
  const { rank, file } = OukEngine.parseSquare(square);
  board[rank * 8 + file] = piece;
}

test('the prompt gives the model the position, the side to move, and every legal move', () => {
  const state = OukEngine.createInitialState();
  const legal = OukEngine.generateLegalMoves(state, 'w');
  const prompt = OukOpponent.buildOpponentPrompt(state, [], legal);

  assert.match(prompt, /You are playing White/);
  assert.ok(prompt.includes(OukReview.renderAsciiBoard(state)), 'prompt embeds the board');
  assert.match(prompt, /no moves yet/);
  // Every legal move must be offered, or the model is being asked to guess.
  legal.forEach((move) => {
    const from = OukEngine.squareName(move.from.rank, move.from.file);
    const to = OukEngine.squareName(move.to.rank, move.to.file);
    assert.ok(prompt.includes(from + ' -> ' + to), 'missing legal move ' + from + '-' + to);
  });
});

test('the prompt says so when the side to move is in check', () => {
  const board = emptyBoard();
  place(board, 'e1', { type: 'K', color: 'w' });
  place(board, 'e8', { type: 'R', color: 'b' });
  place(board, 'a8', { type: 'K', color: 'b' });
  const state = stateFrom(board, 'w');

  assert.ok(OukEngine.isInCheck(state, 'w'), 'position is a check to begin with');
  const legal = OukEngine.generateLegalMoves(state, 'w');
  assert.match(OukOpponent.buildOpponentPrompt(state, [], legal), /YOU ARE IN CHECK/);
});

test('the history the model sees is trimmed to the most recent plies', () => {
  let state = OukEngine.createInitialState();
  const history = [];
  for (let i = 0; i < OukOpponent.HISTORY_PLIES + 6; i++) {
    const move = OukEngine.generateLegalMoves(state, state.turn)[0];
    history.push(move);
    state = OukEngine.applyMove(state, move);
  }

  const text = OukOpponent.describeHistory(history);
  assert.match(text, /earlier moves omitted/);
  assert.equal(text.split('\n').length, OukOpponent.HISTORY_PLIES + 1, 'one header line plus the trimmed tail');
});

test('parseOpponentMove reads bare JSON, fenced JSON, and JSON buried in prose', () => {
  const bare = OukOpponent.parseOpponentMove('{"from":"e3","to":"e4","reason":"center"}');
  assert.deepEqual(bare, { from: 'e3', to: 'e4', reason: 'center' });

  const fenced = OukOpponent.parseOpponentMove('```json\n{"from":"b1","to":"c3"}\n```');
  assert.deepEqual(fenced, { from: 'b1', to: 'c3', reason: null });

  const prose = OukOpponent.parseOpponentMove('Sure! I will play {"from":"g1","to":"f3"} this turn.');
  assert.deepEqual(prose, { from: 'g1', to: 'f3', reason: null });
});

test('parseOpponentMove rejects replies with no usable move in them', () => {
  assert.equal(OukOpponent.parseOpponentMove('I think I will pass.'), null);
  assert.equal(OukOpponent.parseOpponentMove('{"from":"e3"}'), null, 'missing "to"');
  assert.equal(OukOpponent.parseOpponentMove('{"from":1,"to":2}'), null, 'non-string squares');
  assert.equal(OukOpponent.parseOpponentMove(''), null);
  assert.equal(OukOpponent.parseOpponentMove(null), null);
});

test('resolveOpponentMove returns the real engine move behind a legal choice', () => {
  const state = OukEngine.createInitialState();
  const legal = OukEngine.generateLegalMoves(state, 'w');
  const resolved = OukOpponent.resolveOpponentMove(legal, { from: 'e3', to: 'e4', reason: 'space' });

  assert.equal(resolved.source, 'llm');
  assert.equal(resolved.comment, 'space');
  // The move handed back is the engine's own object, not a reconstruction, so
  // applyMove gets the piece, capture flag and special marker it expects.
  assert.ok(legal.includes(resolved.move));
  assert.deepEqual(resolved.move.from, OukEngine.parseSquare('e3'));
  assert.deepEqual(resolved.move.to, OukEngine.parseSquare('e4'));
});

test('resolveOpponentMove refuses an illegal move and says why', () => {
  const state = OukEngine.createInitialState();
  const legal = OukEngine.generateLegalMoves(state, 'w');

  // e3-e5 is a double pawn step: legal in chess, not in Ouk Chaktrang.
  const illegal = OukOpponent.resolveOpponentMove(legal, { from: 'e3', to: 'e5' });
  assert.equal(illegal.move, null);
  assert.match(illegal.reason, /e3-e5.*not legal/);

  const offBoard = OukOpponent.resolveOpponentMove(legal, { from: 'j9', to: 'e4' });
  assert.equal(offBoard.move, null);
  assert.match(offBoard.reason, /does not exist/);

  const nothing = OukOpponent.resolveOpponentMove(legal, null);
  assert.equal(nothing.move, null);
  assert.match(nothing.reason, /no usable JSON/);
});

test('a legal choice from the model is the move that gets played', async () => {
  const state = OukEngine.createInitialState();
  const { result } = await withChatResponse(
    replyWith('{"from":"e3","to":"e4","reason":"claim the centre"}'),
    () => chooseMove(state, LIVE_SETTINGS)
  );

  assert.equal(result.source, 'llm');
  assert.equal(result.comment, 'claim the centre');
  assert.equal(result.reason, null);
  assert.deepEqual(result.move.to, OukEngine.parseSquare('e4'));
  // The whole point of validating: the move must survive the engine.
  assert.doesNotThrow(() => OukEngine.applyMove(state, result.move));
});

test('an illegal choice falls back to the engine rather than stalling the game', async () => {
  const state = OukEngine.createInitialState();
  const { result } = await withChatResponse(
    replyWith('{"from":"e3","to":"e5","reason":"double step"}'),
    () => chooseMove(state, LIVE_SETTINGS)
  );

  assert.equal(result.source, 'engine');
  assert.match(result.reason, /not legal/);
  assert.ok(result.move, 'the game still gets a move to play');
  assert.doesNotThrow(() => OukEngine.applyMove(state, result.move));
});

test('a failed request falls back to the engine and reports the cause', async () => {
  const state = OukEngine.createInitialState();
  const { err, result } = await withChatResponse(
    () => Promise.reject(new Error('CORS / Network Error')),
    () => chooseMove(state, LIVE_SETTINGS)
  );

  // A fallback is not an error the game can act on, so the callback stays
  // clean and the cause rides along on the result.
  assert.equal(err, null);
  assert.equal(result.source, 'engine');
  assert.match(result.reason, /CORS \/ Network Error/);
  assert.ok(result.move);
});

test('an empty completion falls back to the engine', async () => {
  const state = OukEngine.createInitialState();
  const { result } = await withChatResponse(
    () => Promise.resolve({ choices: [{ message: { content: '' } }] }),
    () => chooseMove(state, LIVE_SETTINGS)
  );

  assert.equal(result.source, 'engine');
  assert.match(result.reason, /empty response/);
  assert.ok(result.move);
});

test('an endpoint that cannot be called plays the engine without sending a request', async () => {
  const state = OukEngine.createInitialState();
  let sent = false;
  const { result } = await withChatResponse(
    () => { sent = true; return Promise.reject(new Error('should not be called')); },
    () => chooseMove(state, { baseURL: 'simulation', model: 'ouk-grandmaster-v1' })
  );

  assert.equal(sent, false, 'no request is attempted without an endpoint');
  assert.equal(result.source, 'engine');
  assert.match(result.reason, /Simulation mode/);
  assert.ok(result.move);
});

test('an untouched install is caught before it spends a 401 on every move', () => {
  // The shipped default is OpenAI with no key - nobody has configured
  // anything, so there is nothing to ask.
  assert.match(
    OukOpponent.unusableEndpointReason(OukReview.DEFAULT_SETTINGS),
    /no API key set/
  );
  // ...but a local endpoint legitimately has no key, and must still play.
  assert.equal(OukOpponent.unusableEndpointReason({ baseURL: 'http://localhost:11434/v1', apiKey: '' }), null);
  assert.equal(OukOpponent.unusableEndpointReason({ baseURL: 'http://localhost:1234/v1', apiKey: '' }), null);
});

test('unusableEndpointReason covers the presets that have nowhere to send a request', () => {
  assert.match(OukOpponent.unusableEndpointReason({ baseURL: 'simulation' }), /Simulation mode/);
  assert.match(OukOpponent.unusableEndpointReason({ baseURL: 'demo' }), /Simulation mode/);
  assert.match(OukOpponent.unusableEndpointReason({ baseURL: 'mock' }), /Simulation mode/);
  assert.match(OukOpponent.unusableEndpointReason({ isSimulation: true }), /Simulation mode/);
  assert.match(OukOpponent.unusableEndpointReason(null), /no AI endpoint configured/);
  assert.equal(OukOpponent.unusableEndpointReason(LIVE_SETTINGS), null);
});

test('a position with no legal moves yields no move at all', async () => {
  // Black is stalemated: the king on h8 has g8/g7/h7 covered by the two rooks
  // and h8 itself is not attacked. A capture has been made, which is what
  // takes the Sdaach's knight-jump escape off the table.
  const board = emptyBoard();
  place(board, 'h8', { type: 'K', color: 'b' });
  place(board, 'a7', { type: 'R', color: 'w' });
  place(board, 'g1', { type: 'R', color: 'w' });
  place(board, 'a1', { type: 'K', color: 'w' });
  const state = stateFrom(board, 'b');
  state.anyCaptureYet = true;

  assert.equal(OukEngine.generateLegalMoves(state, 'b').length, 0, 'position really is a dead end');

  const { result } = await chooseMove(state, LIVE_SETTINGS);
  assert.equal(result.move, null);
  assert.equal(result.reason, 'no legal moves');
});

test('the debug listener is handed the exact prompt that was sent', async () => {
  const state = OukEngine.createInitialState();
  const { records } = await withDebugCapture(() =>
    withChatResponse(
      replyWith('{"from":"e3","to":"e4","reason":"centre"}'),
      () => chooseMove(state, LIVE_SETTINGS)
    )
  );

  const request = records.find((r) => r.phase === 'request');
  assert.ok(request, 'a request phase is emitted');
  assert.equal(request.model, LIVE_SETTINGS.model);
  assert.equal(request.endpoint, LIVE_SETTINGS.baseURL);
  assert.equal(request.temperature, 0.2);
  assert.equal(request.ply, 0);
  assert.equal(request.legalMoveCount, OukEngine.generateLegalMoves(state, 'w').length);
  assert.equal(request.systemPrompt, OukOpponent.SYSTEM_PROMPT);
  // Not "looks like the prompt": the same string the request body carries.
  assert.equal(
    request.userPrompt,
    OukOpponent.buildOpponentPrompt(state, [], OukEngine.generateLegalMoves(state, 'w'))
  );
});

test('the debug record never carries the API key', async () => {
  const state = OukEngine.createInitialState();
  const settings = { baseURL: 'https://example.test/v1', apiKey: 'sk-secret-key', model: 'm' };
  const { records } = await withDebugCapture(() =>
    withChatResponse(replyWith('{"from":"e3","to":"e4"}'), () => chooseMove(state, settings))
  );

  // Debug output ends up in console logs and pasted bug reports.
  records.forEach((record) => {
    assert.ok(!JSON.stringify(record).includes('sk-secret-key'), record.phase + ' phase leaked the key');
  });
});

test('the debug listener sees the raw reply and the move it resolved to', async () => {
  const state = OukEngine.createInitialState();
  const { records } = await withDebugCapture(() =>
    withChatResponse(
      replyWith('{"from":"e3","to":"e4","reason":"claim the centre"}'),
      () => chooseMove(state, LIVE_SETTINGS)
    )
  );

  const response = records.find((r) => r.phase === 'response');
  assert.ok(response, 'a response phase is emitted');
  assert.match(response.rawReply, /claim the centre/);
  assert.deepEqual(response.parsed, { from: 'e3', to: 'e4', reason: 'claim the centre' });
  assert.equal(response.source, 'llm');
  assert.equal(response.chosen, 'e3 -> e4');
  assert.equal(response.reason, null);
  assert.equal(typeof response.elapsedMs, 'number');
});

test('the debug record says when the engine took the move back off the model', async () => {
  const state = OukEngine.createInitialState();
  const { records } = await withDebugCapture(() =>
    withChatResponse(
      replyWith('{"from":"e3","to":"e5","reason":"double step"}'),
      () => chooseMove(state, LIVE_SETTINGS)
    )
  );

  const response = records.find((r) => r.phase === 'response');
  assert.equal(response.source, 'engine');
  assert.equal(response.chosen, null);
  assert.match(response.reason, /not legal/);
  // The prompt is still on the record: an illegal answer is exactly when you
  // want to read what was asked.
  assert.match(response.userPrompt, /Your legal moves/);
});

test('a failed request is reported to the debug listener rather than swallowed', async () => {
  const state = OukEngine.createInitialState();
  const { records } = await withDebugCapture(() =>
    withChatResponse(
      () => Promise.reject(new Error('CORS / Network Error')),
      () => chooseMove(state, LIVE_SETTINGS)
    )
  );

  const failure = records.find((r) => r.phase === 'error');
  assert.ok(failure, 'an error phase is emitted');
  assert.ok(failure.error.includes('CORS / Network Error'));
  assert.equal(failure.source, 'engine');
});

test('an endpoint that cannot be called is logged as skipped, with no prompt built', async () => {
  const state = OukEngine.createInitialState();
  const { records } = await withDebugCapture(() =>
    chooseMove(state, { baseURL: 'simulation', model: 'ouk-grandmaster-v1' })
  );

  assert.equal(records.length, 1);
  assert.equal(records[0].phase, 'skipped');
  assert.match(records[0].reason, /Simulation mode/);
  assert.equal(records[0].userPrompt, null, 'nothing was built, because nothing was sent');
});

test('the last exchange is kept for after-the-fact inspection with nothing listening', async () => {
  const state = OukEngine.createInitialState();
  await withChatResponse(
    replyWith('{"from":"e3","to":"e4","reason":"centre"}'),
    () => chooseMove(state, LIVE_SETTINGS)
  );

  const last = OukOpponent.getLastExchange();
  assert.equal(last.phase, 'response');
  assert.equal(last.systemPrompt, OukOpponent.SYSTEM_PROMPT);
  assert.match(last.userPrompt, /You are playing White/);
  assert.equal(last.chosen, 'e3 -> e4');
});

test('a listener that throws does not cost the game its move', async () => {
  const state = OukEngine.createInitialState();
  OukOpponent.setDebugListener(() => { throw new Error('broken listener'); });
  try {
    const { result } = await withChatResponse(
      replyWith('{"from":"e3","to":"e4"}'),
      () => chooseMove(state, LIVE_SETTINGS)
    );
    assert.equal(result.source, 'llm');
    assert.deepEqual(result.move.to, OukEngine.parseSquare('e4'));
  } finally {
    OukOpponent.setDebugListener(null);
  }
});
