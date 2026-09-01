// The LLM opponent behind "vs AI".
//
// "vs Computer" plays the local negamax search in src/ai.js. This module is
// the other kind of opponent: the chat model configured in the settings
// dialog picks the move itself. It reuses that dialog's endpoint, key and
// proxy handling from src/review.js, because it is the same account and the
// same request - the model is just being asked to play rather than to
// comment.
//
// The engine never leaves the loop. A model naming an illegal move is common
// in a variant this obscure, and a game that stalls on a bad reply is worse
// than one that plays on, so every suggestion is checked against the real
// legal move list and anything that fails falls back to the local search.
// Callers are told which source won, the same way resolveRecommendedMove
// reports it, so the UI can say honestly who chose the move.
(function (root) {
  'use strict';

  var OukEngine = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.OukEngine;
  var OukAI = (typeof module !== 'undefined' && module.exports) ? require('./ai.js') : root.OukAI;
  var OukReview = (typeof module !== 'undefined' && module.exports) ? require('./review.js') : root.OukReview;

  // How much history the model is shown. The board already says where every
  // piece stands, so the move list is only here for plan continuity - a longer
  // tail costs tokens without buying accuracy.
  var HISTORY_PLIES = 12;

  // Move choice wants the model's best guess, not its most creative one. The
  // review panel's temperature is a separate setting for separate work, so
  // this deliberately does not read it.
  var MOVE_TEMPERATURE = 0.2;

  // What the model was actually asked, kept where a developer can get at it.
  // The prompt is built here and sent straight out, so when "vs AI" plays a
  // move that makes no sense the first question - what did it see? - has no
  // answer anywhere else in the app. setDebugListener hears every exchange as
  // it happens; getLastExchange answers the same question after the fact, from
  // the console, with nothing switched on beforehand.
  //
  // The record carries the endpoint but never the API key. It is written to a
  // console log, and a debug aid that leaks the key is a worse bug than the
  // one it was helping with.
  var debugListener = null;
  var lastExchange = null;

  function setDebugListener(fn) {
    debugListener = typeof fn === 'function' ? fn : null;
  }

  function getLastExchange() {
    return lastExchange;
  }

  // One exchange is one object, updated in place as it moves from 'request' to
  // 'response', so the listener and getLastExchange always see the whole story
  // rather than a phase of it. A listener that throws is the debugger's
  // problem: the game still has a move to play.
  function emitDebug(exchange, phase, fields) {
    exchange.phase = phase;
    if (fields) {
      Object.keys(fields).forEach(function (key) { exchange[key] = fields[key]; });
    }
    lastExchange = exchange;
    if (!debugListener) return;
    try {
      debugListener(exchange);
    } catch (e) {
      /* a broken listener must not cost the game its move */
    }
  }

  var SYSTEM_PROMPT = [
    'You are a strong player of Ouk Chaktrang (អុកចត្រង្គ - Traditional Cambodian / Khmer Chess), playing a game against a human opponent.',
    'You will be given the current position and the complete list of your legal moves. Choose the strongest one.',
    '',
    '### Rules & Pieces of Ouk Chaktrang:',
    '- **Sdaach / Ang (ស្ដេច / K - King)**: 1 step in all 8 directions. First-move exception: the King may jump like a Knight if it has not moved, is not in check, and no capture has been made yet by either side.',
    '- **Neang / Met (នាង / ម៉ែត្រ / Q - Queen/General)**: Moves exactly 1 step diagonally in 4 directions. First-move exception: it may instead advance 2 squares straight forward if the path is clear and no capture has been made yet.',
    '- **Koul / Thom (គោល / ធំ / B - Bishop/Noble)**: Moves 1 step in the 4 diagonal directions OR 1 step straight forward (5 directions total). Never backward orthogonally.',
    '- **Shes (សេះ / N - Knight/Horse)**: Moves exactly like a chess Knight (L-shape).',
    '- **Touk (ទូក / R - Rook/Boat)**: Moves any number of unblocked squares orthogonally.',
    '- **Trey / Kun (ត្រី / កូន / P - Pawn/Fish)**: Starts on Rank 3 (White) and Rank 6 (Black). Moves 1 step forward, captures 1 step diagonally forward. Promotes to Neang on reaching the opponent\'s pawn starting rank - Rank 6 for White, Rank 3 for Black, NOT the last rank.',
    '- **Counting Rules (Daeul)**: A bare king, or a pawnless position, starts a countdown that forces a draw if mate is not delivered in time. Watch the budget when you are ahead.',
    '',
    'There is no castling, no en passant, and no double pawn step. The Neang is a weak piece here, not a chess queen.',
    '',
    '### Your Task:',
    'Pick one move from the numbered list of legal moves you are given, and reply with valid JSON only:',
    '{',
    '  "from": "Origin square in algebraic form, e.g. \\"b1\\"",',
    '  "to": "Destination square, e.g. \\"c3\\"",',
    '  "reason": "One short sentence - at most 12 words - on why you chose it."',
    '}',
    '',
    'The move you name MUST be one of the legal moves listed. Do not invent a move, do not pass, and do not return anything outside the JSON object.'
  ].join('\n');

  function squareOf(point) {
    return OukEngine.squareName(point.rank, point.file);
  }

  // The legal move list is the whole reason this works. Asked to invent a move
  // in an unfamiliar variant a model guesses; asked to pick a line out of a
  // list it is doing something it is reliably good at. Each line carries the
  // exact from/to strings the reply should quote back, and formatMoveText's
  // notation beside them so the model, the move list and the review panel are
  // all naming moves the same way.
  function describeLegalMoves(moves) {
    return moves.map(function (move, i) {
      return (i + 1) + '. ' + squareOf(move.from) + ' -> ' + squareOf(move.to) +
        '  (' + OukReview.formatMoveText(move) + ')';
    }).join('\n');
  }

  function describeHistory(history) {
    if (!history || history.length === 0) return '(no moves yet - this is the opening)';
    var start = Math.max(0, history.length - HISTORY_PLIES);
    var shown = history.slice(start).map(function (move, i) {
      return OukReview.formatMoveText(move, start + i);
    }).join('\n');
    return start > 0 ? '(earlier moves omitted)\n' + shown : shown;
  }

  function buildOpponentPrompt(state, history, legalMoves) {
    var colorName = state.turn === 'w' ? 'White' : 'Black';
    var lines = [
      'You are playing ' + colorName + '. It is your move.',
      '',
      '### Position (uppercase = White, lowercase = Black):',
      OukReview.renderAsciiBoard(state),
      '',
      '### Moves so far:',
      describeHistory(history),
      ''
    ];

    if (OukEngine.isInCheck(state, state.turn)) {
      lines.push('### YOU ARE IN CHECK. Every move listed below already answers it.');
      lines.push('');
    }

    lines.push('### Your legal moves (choose exactly one):');
    lines.push(describeLegalMoves(legalMoves));
    lines.push('');
    lines.push('Reply with JSON only: {"from": "...", "to": "...", "reason": "..."}');
    return lines.join('\n');
  }

  // Mirrors parseAiResponse's tolerance: models wrap JSON in prose or code
  // fences often enough that refusing those replies would throw away good
  // moves.
  function parseOpponentMove(rawText) {
    if (typeof rawText !== 'string') return null;
    var cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    var json = null;
    try {
      json = JSON.parse(cleaned);
    } catch (e) {
      var first = cleaned.indexOf('{');
      var last = cleaned.lastIndexOf('}');
      if (first === -1 || last <= first) return null;
      try {
        json = JSON.parse(cleaned.slice(first, last + 1));
      } catch (e2) {
        return null;
      }
    }

    if (!json || typeof json !== 'object') return null;
    if (typeof json.from !== 'string' || typeof json.to !== 'string') return null;
    return {
      from: json.from,
      to: json.to,
      reason: typeof json.reason === 'string' ? json.reason : null
    };
  }

  function parseSquareStrict(name) {
    if (typeof name !== 'string') return null;
    if (!/^[a-h][1-8]$/.test(name.trim().toLowerCase())) return null;
    return OukEngine.parseSquare(name.trim().toLowerCase());
  }

  // from/to identifies a move uniquely here: no two legal moves share both.
  function findLegalMove(legalMoves, from, to) {
    for (var i = 0; i < legalMoves.length; i++) {
      var m = legalMoves[i];
      if (m.from.rank === from.rank && m.from.file === from.file &&
          m.to.rank === to.rank && m.to.file === to.file) {
        return m;
      }
    }
    return null;
  }

  // Turns whatever the model said into a move the engine will actually accept,
  // or explains why it could not. `reason` is the fallback's cause, not the
  // model's justification - that rides along as `comment`.
  function resolveOpponentMove(legalMoves, parsed) {
    if (!parsed) return { move: null, source: null, reason: 'the model returned no usable JSON' };
    var from = parseSquareStrict(parsed.from);
    var to = parseSquareStrict(parsed.to);
    if (!from || !to) {
      return { move: null, source: null, reason: 'the model named a square that does not exist' };
    }
    var match = findLegalMove(legalMoves, from, to);
    if (!match) {
      return {
        move: null,
        source: null,
        reason: 'the model chose ' + parsed.from + '-' + parsed.to + ', which is not legal here'
      };
    }
    return { move: match, source: 'llm', reason: null, comment: parsed.reason || null };
  }

  function engineFallback(state, engineOptions, reason) {
    return {
      move: OukAI.chooseMove(state, engineOptions || {}),
      source: 'engine',
      reason: reason || null,
      comment: null
    };
  }

  // Why these settings cannot be asked to play, or null if they can. Rather
  // than refuse to play, the mode falls through to the local engine and says
  // so - the same answer a failed request gets.
  function unusableEndpointReason(settings) {
    if (!settings) return 'no AI endpoint configured — the local engine is playing';
    if (settings.baseURL === 'simulation' || settings.baseURL === 'demo' ||
        settings.baseURL === 'mock' || settings.isSimulation === true) {
      return 'Simulation mode is on — the local engine is playing';
    }
    // An untouched install: the shipped OpenAI endpoint with no key. A missing
    // key on its own proves nothing, because Ollama and LM Studio genuinely
    // do not use one - it is the base URL still being the default that says
    // nobody has been here. Catching it saves a 401 round-trip per move.
    if (!settings.apiKey && (settings.baseURL || '') === OukReview.DEFAULT_SETTINGS.baseURL) {
      return 'no API key set — open ⚙ AI Settings to let the model play';
    }
    return null;
  }

  // Asks the configured model for a move and hands the caller something
  // playable no matter what comes back. The callback is (err, result); err is
  // always null, because a fallback move is not an error the game can act on -
  // the reason travels in result.reason so the UI can say what happened
  // without the game stopping.
  function chooseOpponentMove(state, history, settings, engineOptions, callback) {
    var legalMoves = OukEngine.generateLegalMoves(state, state.turn);
    if (legalMoves.length === 0) {
      callback(null, { move: null, source: null, reason: 'no legal moves', comment: null });
      return;
    }

    var exchange = {
      at: new Date().toISOString(),
      phase: 'request',
      turn: state.turn,
      ply: history ? history.length : 0,
      legalMoveCount: legalMoves.length,
      endpoint: settings ? settings.baseURL : null,
      useProxy: !!(settings && settings.useProxy),
      model: null,
      temperature: MOVE_TEMPERATURE,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: null
    };

    var unusable = unusableEndpointReason(settings);
    if (unusable) {
      // A phase rather than silence, on purpose: "nothing was sent, and here
      // is why" is exactly what someone wondering where the model went is
      // trying to find out.
      emitDebug(exchange, 'skipped', { source: 'engine', reason: unusable });
      callback(null, engineFallback(state, engineOptions, unusable));
      return;
    }

    var userPrompt = buildOpponentPrompt(state, history, legalMoves);
    var bodyPayload = {
      model: settings.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: MOVE_TEMPERATURE
    };

    var startedAt = Date.now();
    emitDebug(exchange, 'request', { model: bodyPayload.model, userPrompt: userPrompt });

    OukReview.sendChatRequest(settings, bodyPayload)
      .then(function (data) {
        var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('the model returned an empty response');
        var parsed = parseOpponentMove(content);
        var resolved = resolveOpponentMove(legalMoves, parsed);
        emitDebug(exchange, 'response', {
          elapsedMs: Date.now() - startedAt,
          rawReply: content,
          parsed: parsed,
          source: resolved.move ? 'llm' : 'engine',
          reason: resolved.reason || null,
          comment: resolved.comment || null,
          chosen: resolved.move ? squareOf(resolved.move.from) + ' -> ' + squareOf(resolved.move.to) : null
        });
        if (!resolved.move) {
          callback(null, engineFallback(state, engineOptions, resolved.reason));
          return;
        }
        callback(null, resolved);
      })
      .catch(function (err) {
        var message = err.message || 'the request failed';
        emitDebug(exchange, 'error', {
          elapsedMs: Date.now() - startedAt,
          error: message,
          source: 'engine',
          reason: message
        });
        callback(null, engineFallback(state, engineOptions, message));
      });
  }

  var api = {
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    HISTORY_PLIES: HISTORY_PLIES,
    describeLegalMoves: describeLegalMoves,
    describeHistory: describeHistory,
    buildOpponentPrompt: buildOpponentPrompt,
    parseOpponentMove: parseOpponentMove,
    resolveOpponentMove: resolveOpponentMove,
    unusableEndpointReason: unusableEndpointReason,
    chooseOpponentMove: chooseOpponentMove,
    setDebugListener: setDebugListener,
    getLastExchange: getLastExchange
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukOpponent = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
