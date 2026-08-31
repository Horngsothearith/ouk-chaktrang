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
// cannot leak a stub into the tests that follow.
function withChatResponse(impl, run) {
  const original = OukReview.sendChatRequest;
  OukReview.sendChatRequest = impl;
  try {
    return run();
  } finally {
    OukReview.sendChatRequest = original;
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
