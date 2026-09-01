(function (root) {
  'use strict';

  var OukEngine = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.OukEngine;
  var OukAI = (typeof module !== 'undefined' && module.exports) ? require('./ai.js') : root.OukAI;

  var PIECE_NAMES = {
    K: { km: 'ស្ដេច / អង (Sdaach / Ang)', en: 'King' },
    Q: { km: 'នាង / ម៉ែត្រ (Neang / Met)', en: 'Queen' },
    B: { km: 'គោល / ធំ (Koul / Thom)', en: 'Bishop' },
    N: { km: 'សេះ (Shes)', en: 'Knight / Horse' },
    R: { km: 'ទូក (Touk)', en: 'Rook / Boat' },
    P: { km: 'ត្រី / កូន (Trey / Kun)', en: 'Pawn / Fish' }
  };

  var DEFAULT_SETTINGS = {
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    language: 'en', // 'en' | 'km' | 'both'
    temperature: 0.3,
    useProxy: false,
    // Prints the "vs AI" prompt and reply to the browser console. Saved with
    // the rest so it survives a reload - a bug you are chasing across moves
    // outlives the page.
    debugPrompts: false
  };

  var STORAGE_KEY = 'ouk_chaktrang_ai_review_settings';

  function loadSettings() {
    if (typeof localStorage === 'undefined') return Object.assign({}, DEFAULT_SETTINGS);
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(saved));
      }
    } catch (e) {
      console.warn('Failed to load review settings from localStorage:', e);
    }
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  function saveSettings(settings) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('Failed to save review settings to localStorage:', e);
    }
  }

  function formatMoveText(move, index) {
    var from = OukEngine.squareName(move.from.rank, move.from.file);
    var to = OukEngine.squareName(move.to.rank, move.to.file);
    var sep = move.captured ? 'x' : '-';
    var special = '';
    if (move.special === 'promotion') special = '=Q (Promoted to Trey/Met)';
    else if (move.special === 'kingJump') special = ' (King Jump)';
    else if (move.special === 'queenDoubleStep') special = ' (Queen 2-Step)';
    var prefix = typeof index === 'number' ? (index + 1) + '. ' : '';
    return prefix + move.piece.type + from + sep + to + special;
  }

  function renderAsciiBoard(state) {
    var lines = ['  a b c d e f g h'];
    for (var r = 7; r >= 0; r--) {
      var row = (r + 1) + ' ';
      for (var f = 0; f < 8; f++) {
        var p = OukEngine.pieceAt(state, r, f);
        if (!p) {
          row += '. ';
        } else {
          var char = p.color === 'w' ? p.type.toUpperCase() : p.type.toLowerCase();
          row += char + ' ';
        }
      }
      row += (r + 1);
      lines.push(row);
    }
    lines.push('  a b c d e f g h');
    return lines.join('\n');
  }

  function replayToMoveIndex(history, moveIndex) {
    var state = OukEngine.createInitialState();
    for (var i = 0; i <= moveIndex && i < history.length; i++) {
      state = OukEngine.applyMove(state, history[i]);
    }
    return state;
  }

  function stateBeforeMoveIndex(history, moveIndex) {
    var state = OukEngine.createInitialState();
    for (var i = 0; i < moveIndex && i < history.length; i++) {
      state = OukEngine.applyMove(state, history[i]);
    }
    return state;
  }

  function classifyMoveByEval(evalBefore, evalAfter, isPlayerWhite, isBestMove) {
    // Evaluation is from White's perspective (+ = White advantage, - = Black advantage)
    var diff = isPlayerWhite ? (evalAfter - evalBefore) : (evalBefore - evalAfter);

    if (isBestMove && diff >= 0.5) return { key: 'brilliant', label: 'Brilliant', symbol: '✨', color: '#10b981' };
    if (isBestMove || diff >= -0.2) return { key: 'best', label: 'Best Move', symbol: '🟢', color: '#22c55e' };
    if (diff >= -0.6) return { key: 'good', label: 'Good', symbol: '🔵', color: '#3b82f6' };
    if (diff >= -1.3) return { key: 'inaccuracy', label: 'Inaccuracy', symbol: '🟡', color: '#eab308' };
    if (diff >= -2.5) return { key: 'mistake', label: 'Mistake', symbol: '🟠', color: '#f97316' };
    return { key: 'blunder', label: 'Blunder', symbol: '🔴', color: '#ef4444' };
  }

  function buildPromptContext(history, moveIndex) {
    var stateBefore = stateBeforeMoveIndex(history, moveIndex);
    var move = history[moveIndex];
    var stateAfter = OukEngine.applyMove(stateBefore, move);
    var moverColor = move.piece.color;
    var moverName = moverColor === 'w' ? 'White' : 'Black';
    var pieceInfo = PIECE_NAMES[move.piece.type] || { km: move.piece.type, en: move.piece.type };

    // Engine evaluations
    var evalBefore = OukAI.evaluate(stateBefore);
    var evalAfter = OukAI.evaluate(stateAfter);

    // Compute best alternative move from stateBefore
    var bestEngineMove = OukAI.chooseMove(stateBefore, { timeLimitMs: 250, maxDepth: 4 });
    var isBestMove = false;
    var bestMoveText = '';
    if (bestEngineMove) {
      bestMoveText = formatMoveText(bestEngineMove);
      isBestMove = (bestEngineMove.from.rank === move.from.rank &&
                    bestEngineMove.from.file === move.from.file &&
                    bestEngineMove.to.rank === move.to.rank &&
                    bestEngineMove.to.file === move.to.file);
    }

    // Raw coordinates alongside the notation text: the review card prints the
    // text, but the board overlay needs squares it can highlight and connect
    // with an arrow without re-parsing algebraic notation. Null when the played
    // move already was the engine's pick - there is nothing to recommend.
    var bestMoveCoords = (bestEngineMove && !isBestMove) ? {
      from: { rank: bestEngineMove.from.rank, file: bestEngineMove.from.file },
      to: { rank: bestEngineMove.to.rank, file: bestEngineMove.to.file },
      special: bestEngineMove.special || null,
      captured: !!bestEngineMove.captured
    } : null;

    var classification = classifyMoveByEval(evalBefore, evalAfter, moverColor === 'w', isBestMove);

    var moveNotation = formatMoveText(move, moveIndex);
    var fromSq = OukEngine.squareName(move.from.rank, move.from.file);
    var toSq = OukEngine.squareName(move.to.rank, move.to.file);

    var inCheckBefore = OukEngine.isInCheck(stateBefore, moverColor);
    var opponentColor = OukEngine.opposite(moverColor);
    var inCheckAfterOpponent = OukEngine.isInCheck(stateAfter, opponentColor);

    var contextData = {
      moveNumber: moveIndex + 1,
      mover: moverName,
      moverColor: moverColor,
      moveNotation: moveNotation,
      from: fromSq,
      to: toSq,
      pieceType: move.piece.type,
      pieceNameEn: pieceInfo.en,
      pieceNameKm: pieceInfo.km,
      captured: move.captured ? (PIECE_NAMES[move.captured.type] ? PIECE_NAMES[move.captured.type].en : move.captured.type) : null,
      special: move.special,
      inCheckBefore: inCheckBefore,
      deliveredCheck: inCheckAfterOpponent,
      evalBefore: Number(evalBefore.toFixed(2)),
      evalAfter: Number(evalAfter.toFixed(2)),
      evalDiff: Number((moverColor === 'w' ? evalAfter - evalBefore : evalBefore - evalAfter).toFixed(2)),
      bestEngineMove: bestMoveText,
      bestEngineMoveCoords: bestMoveCoords,
      playedMoveCoords: {
        from: { rank: move.from.rank, file: move.from.file },
        to: { rank: move.to.rank, file: move.to.file },
        special: move.special || null,
        captured: !!move.captured
      },
      isBestMove: isBestMove,
      classification: classification,
      statusAfter: stateAfter.status,
      countingActive: stateAfter.counting.active,
      countingDetails: stateAfter.counting.active ? {
        trigger: stateAfter.counting.trigger,
        remaining: stateAfter.counting.budget - stateAfter.counting.elapsed
      } : null,
      boardBeforeAscii: renderAsciiBoard(stateBefore),
      boardAfterAscii: renderAsciiBoard(stateAfter)
    };

    return {
      contextData: contextData,
      stateBefore: stateBefore,
      stateAfter: stateAfter,
      move: move
    };
  }

  var SYSTEM_PROMPT = [
    'You are an expert Grandmaster and Master Instructor of Ouk Chaktrang (អុកចត្រង្គ - Traditional Cambodian / Khmer Chess).',
    'Your goal is to provide concise, instructive, and engaging move explanations and game review commentary.',
    '',
    '### Rules & Pieces of Ouk Chaktrang:',
    '- **Sdaach / Ang (ស្ដេច / K - King)**: 1 step in all 8 directions. First-move exception: King may jump like a Knight on its first move if not in check and no pieces have been captured yet anywhere.',
    '- **Neang / Met (នាង / ម៉ែត្រ / Q - Queen/General)**: Moves exactly 1 step diagonally in 4 directions. First-move exception: Queen may move 2 squares straight forward on its first move if path is clear and no pieces captured yet.',
    '- **Koul / Thom (គោល / ធំ / B - Bishop/Noble)**: Moves 1 step in the 4 diagonal directions OR 1 step straight forward (5 directions total). Never backward orthogonally.',
    '- **Shes (សេះ / N - Knight/Horse)**: Moves exactly like a chess Knight (L-shape).',
    '- **Touk (ទូក / R - Rook/Boat)**: Moves any number of unblocked squares orthogonally.',
    '- **Trey / Kun (ត្រី / កូន / P - Pawn/Fish)**: Starts on Rank 3 (White rank index 2) and Rank 6 (Black rank index 5). Moves 1 step forward, captures 1 step diagonally forward. Promotes to Trey Promoted (moves like Neang/Met) upon reaching the opponent\'s pawn starting rank (Rank 6 for White, Rank 3 for Black).',
    '- **Counting Rules (Daeul)**: When one side has only a bare king, or when both sides are pawnless (64-move rule), a countdown rule triggers to enforce a draw if mate is not delivered within the move limit.',
    '',
    '### Your Task:',
    'Analyze the played move given the exact game state, engine evaluations, and context.',
    'Explain the tactical purpose, strategic plan, piece activity, threats created or defended, and give constructive feedback.',
    'Always respond in valid JSON format with the following structure:',
    '{',
    '  "classification": "brilliant" | "best" | "good" | "inaccuracy" | "mistake" | "blunder",',
    '  "title": "A short 4-8 word descriptive punchy title",',
    '  "explanation": "2-4 sentences explaining the move\'s intent, tactical strengths/weaknesses, piece dynamics, and what the opponent or player should watch for. Mention Khmer piece names when relevant.",',
    '  "tags": ["Center Control", "Trey Advance", "Tactical Threat", "King Safety", "Promotion Race"],',
    '  "betterMove": "Optional alternative move notation if the move was an inaccuracy/mistake/blunder, with brief reason, or null if best move"',
    '  "betterMoveFrom": "Origin square of your recommended alternative in algebraic form (e.g. \\"b1\\"), or null",',
    '  "betterMoveTo": "Destination square of your recommended alternative (e.g. \\"c3\\"), or null"',
    '}',
    '',
    'betterMoveFrom/betterMoveTo are drawn as an arrow on the player\'s board, so they must be a single legal Ouk Chaktrang move for the side that moved, in the position BEFORE the played move.',
    'Remember this is Ouk Chaktrang, not international chess: the Neang steps one square diagonally, the Koul has five directions, and there is no castling or en passant.',
    'If you are not confident the move is legal, set both to null rather than guessing.'
  ].join('\n');

  function buildUserPrompt(contextData, language) {
    var langInstruction = '';
    if (language === 'km') {
      langInstruction = 'Provide the explanation, title, and tags in Khmer language (ភាសាខ្មែរ).';
    } else if (language === 'both') {
      langInstruction = 'Provide the explanation in English with Khmer piece terms and a brief Khmer summary.';
    } else {
      langInstruction = 'Provide the explanation in English, naturally incorporating traditional Khmer terms (e.g. Trey, Koul, Touk, Shes, Neang, Sdaach).';
    }

    return [
      'Analyze Move #' + contextData.moveNumber + ': ' + contextData.mover + ' played ' + contextData.moveNotation + '.',
      '',
      '--- Move Details ---',
      '- Piece: ' + contextData.pieceNameEn + ' (' + contextData.pieceNameKm + ')',
      '- From: ' + contextData.from + ' -> To: ' + contextData.to,
      '- Captured: ' + (contextData.captured ? contextData.captured : 'None'),
      '- Special: ' + (contextData.special ? contextData.special : 'None'),
      '- Checks: ' + (contextData.deliveredCheck ? 'DELIVERS CHECK!' : (contextData.inCheckBefore ? 'Escapes check' : 'None')),
      '- Engine Eval Before: ' + contextData.evalBefore + ' | After: ' + contextData.evalAfter + ' (Swing for ' + contextData.mover + ': ' + (contextData.evalDiff >= 0 ? '+' : '') + contextData.evalDiff + ')',
      '- Engine Suggested Best Move: ' + (contextData.bestEngineMove || 'N/A') + ' (Played move is best: ' + contextData.isBestMove + ')',
      '- Counting Rule Status: ' + (contextData.countingActive ? JSON.stringify(contextData.countingDetails) : 'Inactive'),
      '',
      '--- Board State (Lowercase = Black, Uppercase = White, . = Empty) ---',
      'Board Before Move:',
      contextData.boardBeforeAscii,
      '',
      'Board After Move:',
      contextData.boardAfterAscii,
      '',
      langInstruction,
      'Output strictly the JSON response.'
    ].join('\n');
  }

  function generateSimulatedReview(contextData, language) {
    var isKhmer = (language === 'km');
    var isBilingual = (language === 'both');
    var piece = contextData.pieceType;
    var qual = contextData.classification ? contextData.classification.key : 'good';
    var mover = contextData.mover;
    var pieceEn = contextData.pieceNameEn;
    var pieceKm = contextData.pieceNameKm;
    var fromSq = contextData.from;
    var toSq = contextData.to;

    var title = '';
    var explanation = '';
    var tags = [];
    var betterMove = null;

    if (isKhmer) {
      if (contextData.special === 'promotion') {
        title = 'ការប្តូរកូនត្រីជាត្រីឡើង (Neang)';
        explanation = mover + ' បានរុញ ' + pieceKm + ' ទៅកាន់ក្រឡា ' + toSq + ' ហើយឡើងជាត្រីប្តូរ ដោយទទួលបានសមត្ថភាពដើរដូចនាង។';
        tags = ['ការប្តូរត្រី', 'ការគ្រប់គ្រងផ្ទៃកណ្ដាល'];
      } else if (contextData.special === 'kingJump') {
        title = 'ការលោតស្ដេចលើកទីមួយ (King Jump)';
        explanation = mover + ' ប្រើប្រាស់សិទ្ធិពិសេសនៃការលោតស្ដេចជំហានសេះ ដើម្បីពង្រឹងសុវត្ថិភាពស្ដេចនៅពីក្រោយខ្សែត្រី។';
        tags = ['ការលោតស្ដេច', 'សុវត្ថិភាពស្ដេច'];
      } else if (contextData.special === 'queenDoubleStep') {
        title = 'ការបោះជំហាននាង ២ ក្រឡា (Queen 2-Step)';
        explanation = mover + ' ប្រើប្រាស់ជំហានពីរដំបូងរបស់នាង ដើម្បីដណ្តើមផ្ទៃកណ្ដាលតាំងពីបើកឆាក។';
        tags = ['ជំហានពីរនាង', 'ការបើកឆាក'];
      } else if (contextData.deliveredCheck) {
        title = 'ការគំរាមកំហែង និងចាក់អុកស្ដេច!';
        explanation = mover + ' ដើរ ' + pieceKm + ' ទៅ ' + toSq + ' និងធ្វើការចាក់អុកស្ដេចគូប្រកួត ដោយបង្ខំឱ្យគេការពារ។';
        tags = ['ចាក់អុក', 'ការវាយប្រហារ'];
      } else if (contextData.captured) {
        title = 'ការស៊ីកូនអុក ' + contextData.captured;
        explanation = mover + ' ប្រើ ' + pieceKm + ' ស៊ីកូនអុក ' + contextData.captured + ' របស់គូប្រកួតនៅ ' + toSq + ' ដោយទទួលបានប្រៀបកម្លាំង។';
        tags = ['ការស៊ីកូន', 'ប្រៀបកម្លាំង'];
      } else {
        if (piece === 'P') {
          title = 'ការរុញត្រីគ្រប់គ្រងផ្ទៃកណ្ដាល';
          explanation = mover + ' រុញ ' + pieceKm + ' ទៅ ' + toSq + ' ដើម្បីបង្កើតខ្សែការពារ និងទប់ស្កាត់ការឈ្លានពានរបស់គូប្រកួត។';
          tags = ['រចនាសម្ព័ន្ធត្រី', 'ការគ្រប់គ្រងផ្ទៃកណ្ដាល'];
        } else if (piece === 'N') {
          title = 'ការអភិវឌ្ឍសេះយ៉ាងសកម្ម';
          explanation = mover + ' ដាក់ ' + pieceKm + ' នៅលើក្រឡា ' + toSq + ' ដើម្បីត្រួតត្រាក្រឡាសំខាន់ៗ និងការពារត្រីជិតខាង។';
          tags = ['អភិវឌ្ឍសេះ', 'ការគ្រប់គ្រងក្រឡា'];
        } else if (piece === 'B') {
          title = 'ការចល័តគោល ៥ ទិស';
          explanation = mover + ' រំកិល ' + pieceKm + ' ទៅ ' + toSq + ' ក្នុងទិសដៅយុទ្ធសាស្ត្រ ដើម្បីត្រៀមប្រយុទ្ធនិងការពារ។';
          tags = ['ការចល័តគោល', 'យុទ្ធសាស្ត្រ'];
        } else if (piece === 'R') {
          title = 'ការគ្រប់គ្រងខ្សែទូក';
          explanation = mover + ' បញ្ជា ' + pieceKm + ' ឱ្យគ្រប់គ្រងខ្សែបើកចំហរ ' + toSq[0] + ' បង្កើតសម្ពាធយ៉ាងខ្លាំងទៅលើបន្ទាយគូប្រកួត។';
          tags = ['ខ្សែទូក', 'សម្ពាធខ្សែបើក'];
        } else {
          title = 'ការដើរយុទ្ធសាស្ត្រដ៏រឹងមាំ';
          explanation = mover + ' ដើរ ' + pieceKm + ' ទៅ ' + toSq + ' ដោយរក្សាលំនឹង និងសុវត្ថិភាពទ័ព។';
          tags = ['យុទ្ធសាស្ត្រ', 'លំនឹងទ័ព'];
        }
      }

      if (qual === 'inaccuracy' || qual === 'mistake' || qual === 'blunder') {
        if (contextData.bestEngineMove) {
          betterMove = 'ការដើរល្អជាងនេះគឺ ' + contextData.bestEngineMove + ' ដែលផ្តល់ប្រៀបយុទ្ធសាស្ត្ររឹងមាំជាង។';
        }
      }
    } else {
      if (contextData.special === 'promotion') {
        title = 'Trey Promotion to Neang';
        explanation = mover + ' advances the Trey (Pawn) to ' + toSq + ', successfully promoting to Trey Promoted (Neang) with diagonal mobility.';
        tags = ['Trey Promotion', 'Endgame Power', 'Center Pressure'];
      } else if (contextData.special === 'kingJump') {
        title = 'Traditional Sdaach King Jump';
        explanation = mover + ' activates the traditional first-move King Jump exception, tucking the Sdaach into safety behind the pawn phalanx.';
        tags = ['King Jump', 'Traditional Rule', 'King Safety'];
      } else if (contextData.special === 'queenDoubleStep') {
        title = 'Neang Opening Double Step';
        explanation = mover + ' plays the classic Neang (Queen) 2-step opening move to ' + toSq + ', immediately staking a claim in the center.';
        tags = ['Queen 2-Step', 'Center Control', 'Opening Initiative'];
      } else if (contextData.deliveredCheck) {
        title = 'Aggressive Check to the Sdaach!';
        explanation = mover + ' delivers direct check with the ' + pieceEn + ' (' + pieceKm + ') on ' + toSq + ', seizing tempo and forcing defensive maneuvers.';
        tags = ['Check', 'Tactical Threat', 'Initiative'];
      } else if (contextData.captured) {
        title = 'Tactical Capture of ' + contextData.captured;
        explanation = mover + ' captures the enemy ' + contextData.captured + ' on ' + toSq + ' with the ' + pieceEn + ', winning material and fracturing enemy coordination.';
        tags = ['Capture', 'Material Advantage', 'Tactical Strike'];
      } else {
        if (piece === 'P') {
          title = 'Classical Trey Advance to ' + toSq;
          explanation = mover + ' marches the Trey (Pawn) from ' + fromSq + ' to ' + toSq + ', contesting space and preparing infiltration lines for the Koul (Noble/Bishop).';
          tags = ['Trey Structure', 'Center Control', 'Space'];
        } else if (piece === 'N') {
          title = 'Active Shes (Knight) Outpost';
          explanation = mover + ' maneuvers the Shes to ' + toSq + ', commanding vital forward landing squares and supporting adjacent Treys.';
          tags = ['Shes Outpost', 'Piece Activity', 'Center Control'];
        } else if (piece === 'B') {
          title = 'Koul Strategic Deployment';
          explanation = mover + ' steps the Koul (Noble) forward to ' + toSq + ', leveraging its 5-step movement (4 diagonals + 1 forward) to fortify the center.';
          tags = ['Koul Maneuver', 'Five Directions', 'Solid Defense'];
        } else if (piece === 'R') {
          title = 'Touk (Rook) Heavy Line Pressure';
          explanation = mover + ' deploys the Touk onto the ' + toSq[0] + '-file, preparing long-range battery threats and restricting enemy King mobility.';
          tags = ['Touk Battery', 'Open File', 'Heavy Artillery'];
        } else if (piece === 'Q') {
          title = 'Neang Diagonal Repositioning';
          explanation = mover + ' repositions the Neang to ' + toSq + ', strengthening the defensive core and guarding vulnerable adjacent pawns.';
          tags = ['Neang Harmony', 'Diagonal Guard', 'Pawn Support'];
        } else {
          title = 'Sdaach Positional Adjustment';
          explanation = mover + ' adjusts the King on ' + toSq + ', enhancing King safety and connecting the defensive backline.';
          tags = ['King Safety', 'Positional Structure'];
        }
      }

      if (qual === 'brilliant') {
        title = '✨ Brilliant: ' + title;
        explanation += ' A masterstroke that deepens tactical pressure with absolute precision.';
        tags.unshift('✨ Brilliant');
      } else if (qual === 'best') {
        title = '🟢 Best Move: ' + title;
      } else if (qual === 'inaccuracy') {
        title = '🟡 Inaccuracy: ' + title;
        if (contextData.bestEngineMove) {
          betterMove = contextData.bestEngineMove + ' keeps tighter central control and superior piece mobility.';
        }
      } else if (qual === 'mistake') {
        title = '🟠 Mistake: ' + title;
        if (contextData.bestEngineMove) {
          betterMove = contextData.bestEngineMove + ' was strongly preferred to prevent positional concessions.';
        }
      } else if (qual === 'blunder') {
        title = '🔴 Blunder: ' + title;
        if (contextData.bestEngineMove) {
          betterMove = contextData.bestEngineMove + ' was essential to safeguard material and King security.';
        }
      }

      if (isBilingual) {
        explanation += ' (' + pieceKm + ' ដើរទៅ ' + toSq + ')';
      }
    }

    return {
      classification: qual,
      title: title,
      explanation: explanation,
      tags: tags,
      betterMove: betterMove
    };
  }

  // "e4" -> {rank, file}, or null for anything that is not a real square.
  // OukEngine.parseSquare is trusting by design (it yields NaN/-1 for junk),
  // and these strings come from a language model, so validate here.
  function parseSquareStrict(name) {
    if (typeof name !== 'string') return null;
    if (!/^[a-h][1-8]$/.test(name.trim().toLowerCase())) return null;
    var sq = OukEngine.parseSquare(name.trim().toLowerCase());
    return (sq.file >= 0 && sq.rank >= 0 && sq.rank <= 7) ? sq : null;
  }

  // Decides what the board actually draws. The LLM is the preferred source -
  // it is the one giving the advice - but a model naming an illegal move is
  // common in a variant this obscure, so every suggestion is checked against
  // the real legal move list before it is trusted. Anything that fails falls
  // back to the local search engine's pick, and the caller is told which
  // source won so the UI can label it honestly.
  function resolveRecommendedMove(stateBefore, contextData, review) {
    var engineCoords = (contextData && contextData.bestEngineMoveCoords) || null;
    var engineResult = engineCoords
      ? { coords: engineCoords, source: 'engine' }
      : { coords: null, source: null };

    if (!review || !stateBefore) return engineResult;

    var from = parseSquareStrict(review.betterMoveFrom);
    var to = parseSquareStrict(review.betterMoveTo);
    if (!from || !to) return engineResult;

    // A model that "recommends" the move already played is not offering an
    // alternative - there would be nothing to compare on the board.
    var played = contextData && contextData.playedMoveCoords;
    if (played &&
        played.from.rank === from.rank && played.from.file === from.file &&
        played.to.rank === to.rank && played.to.file === to.file) {
      return engineResult;
    }

    var legal = OukEngine.generateLegalMoves(stateBefore, stateBefore.turn);
    var match = null;
    for (var i = 0; i < legal.length; i++) {
      var m = legal[i];
      if (m.from.rank === from.rank && m.from.file === from.file &&
          m.to.rank === to.rank && m.to.file === to.file) {
        match = m;
        break;
      }
    }
    if (!match) return engineResult;

    return {
      coords: {
        from: { rank: match.from.rank, file: match.from.file },
        to: { rank: match.to.rank, file: match.to.file },
        special: match.special || null,
        captured: !!match.captured
      },
      source: 'llm'
    };
  }

  function parseAiResponse(rawText, fallbackClassification) {
    var cleaned = rawText.trim();
    // Strip markdown code fences if wrapped in ```json ... ```
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    try {
      var json = JSON.parse(cleaned);
      return {
        classification: json.classification || fallbackClassification.key,
        title: json.title || 'Move Analysis',
        explanation: json.explanation || rawText,
        tags: Array.isArray(json.tags) ? json.tags : ['Analysis'],
        betterMove: json.betterMove || null,
        betterMoveFrom: json.betterMoveFrom || null,
        betterMoveTo: json.betterMoveTo || null
      };
    } catch (e) {
      // Fallback if model returned plain text
      return {
        classification: fallbackClassification.key,
        title: 'Move Commentary',
        explanation: cleaned,
        tags: ['Review'],
        betterMove: null,
        betterMoveFrom: null,
        betterMoveTo: null
      };
    }
  }

  function parseChatResponseBody(rawBody) {
    if (!rawBody || typeof rawBody !== 'string') return null;
    var trimmed = rawBody.trim();

    // 1. Direct standard JSON object or array
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        // Fall through to other handlers
      }
    }

    // 2. Server-Sent Events (SSE) stream (e.g. data: {"id": ...} or streaming chunks)
    if (trimmed.includes('data:')) {
      var lines = trimmed.split(/\r?\n/);
      var combinedContent = '';
      var lastParsed = null;
      var hasSseData = false;

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('data:')) {
          hasSseData = true;
          var dataStr = line.slice(5).trim();
          if (dataStr === '[DONE]') continue;
          try {
            var chunk = JSON.parse(dataStr);
            lastParsed = chunk;
            if (chunk.choices && chunk.choices[0]) {
              var choice = chunk.choices[0];
              if (choice.delta && typeof choice.delta.content === 'string') {
                combinedContent += choice.delta.content;
              } else if (choice.message && typeof choice.message.content === 'string') {
                combinedContent += choice.message.content;
              } else if (choice.text && typeof choice.text === 'string') {
                combinedContent += choice.text;
              }
            }
          } catch (e) {
            // Ignore unparseable line
          }
        }
      }

      if (hasSseData) {
        if (lastParsed && lastParsed.choices && lastParsed.choices[0] && lastParsed.choices[0].message && lastParsed.choices[0].message.content) {
          return lastParsed;
        }
        return {
          id: (lastParsed && lastParsed.id) || 'sse-parsed',
          object: 'chat.completion',
          choices: [
            {
              message: {
                role: 'assistant',
                content: combinedContent || (lastParsed && JSON.stringify(lastParsed)) || ''
              }
            }
          ]
        };
      }
    }

    // 3. Fallback: extract JSON substring if wrapped in non-JSON prefix/suffix
    var firstBrace = trimmed.indexOf('{');
    var lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch (e) {
        // ignore
      }
    }

    return null;
  }

  // One request to the configured endpoint, carrying the CORS dance every
  // caller needs: try the endpoint directly, and on the network/CORS failure
  // browsers report for endpoints that send no CORS headers, retry through the
  // dev server's proxy. `options` is { path, method, body } - body omitted for
  // a GET.
  function apiRequest(settings, options) {
    var baseURL = (settings.baseURL || DEFAULT_SETTINGS.baseURL).replace(/\/+$/, '');
    var directUrl = baseURL + options.path;
    var method = options.method || 'POST';
    var apiKey = settings.apiKey || '';

    var headers = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers['Authorization'] = 'Bearer ' + apiKey;
    }

    function doFetch(targetUrl, isProxy) {
      var fetchUrl = targetUrl;
      var fetchHeaders = Object.assign({}, headers);
      if (isProxy) {
        fetchUrl = '/api/proxy';
        fetchHeaders['x-target-url'] = targetUrl;
      }

      var init = { method: method, headers: fetchHeaders };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);

      return fetch(fetchUrl, init).then(function (res) {
        return res.text().then(function (rawBody) {
          var data = parseChatResponseBody(rawBody);

          if (!res.ok) {
            var errMsg = (data && data.error && data.error.message) ||
                         (rawBody && rawBody.includes('Not found') ? 'Proxy endpoint returned 404 Not Found. Please restart your dev-server (`node scripts/dev-server.js`).' : null) ||
                         (rawBody && rawBody.length < 200 ? rawBody : null) ||
                         ('HTTP error ' + res.status + ' (' + res.statusText + ')');
            throw new Error(errMsg);
          }

          if (!data) {
            throw new Error('Received unexpected non-JSON response from server: ' + (rawBody.slice(0, 100) || 'Empty body'));
          }

          return data;
        });
      });
    }

    if (settings.useProxy) {
      return doFetch(directUrl, true);
    }

    // Try direct fetch first. If it fails due to CORS or Network TypeError, attempt auto-fallback to dev proxy.
    return doFetch(directUrl, false).catch(function (directErr) {
      var isNetworkOrCors = directErr.name === 'TypeError' ||
                            directErr.message === 'Failed to fetch' ||
                            (typeof directErr.message === 'string' &&
                              (directErr.message.includes('NetworkError') ||
                               directErr.message.includes('Load failed') ||
                               directErr.message.includes('CORS')));
      if (isNetworkOrCors) {
        return doFetch(directUrl, true).then(function (proxyResult) {
          // If proxy worked, remember it for subsequent calls. Only the flag:
          // callers pass throwaway settings objects (the dialog's Test
          // Connection builds one from the unsaved form), and writing the whole
          // thing back would persist half-edited fields and drop the keys it
          // does not carry - the language choice among them.
          settings.useProxy = true;
          saveSettings(Object.assign({}, loadSettings(), { useProxy: true }));
          return proxyResult;
        }).catch(function () {
          throw new Error('CORS / Network Error: Browser blocked direct access to ' + directUrl + '. Enable "Use Local Proxy" in Settings or run dev-server (node scripts/dev-server.js).');
        });
      }
      throw directErr;
    });
  }

  function sendChatRequest(settings, bodyPayload) {
    return apiRequest(settings, {
      path: '/chat/completions',
      method: 'POST',
      // Clone payload and ensure stream: false is explicitly set unless specified
      body: Object.assign({ stream: false }, bodyPayload)
    });
  }

  // What an OpenAI-compatible /models response can look like varies more than
  // the spec suggests: OpenAI and Ollama wrap the list in `data`, some
  // gateways return a bare array, and entries are sometimes plain strings
  // rather than objects. Read all of those rather than making the picker a
  // provider lottery.
  function parseModelList(data) {
    if (!data) return [];
    var raw = Array.isArray(data) ? data
      : (Array.isArray(data.data) ? data.data
      : (Array.isArray(data.models) ? data.models : []));

    var seen = {};
    var ids = [];
    raw.forEach(function (entry) {
      var id = typeof entry === 'string' ? entry : (entry && (entry.id || entry.name));
      if (typeof id !== 'string') return;
      id = id.trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      ids.push(id);
    });

    // Alphabetical, case-insensitively: a provider's own order is arbitrary,
    // and OpenRouter alone returns hundreds.
    return ids.sort(function (a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
  }

  function listModels(settings) {
    return apiRequest(settings, { path: '/models', method: 'GET' }).then(function (data) {
      var ids = parseModelList(data);
      if (ids.length === 0) {
        throw new Error('The endpoint answered but listed no models.');
      }
      return ids;
    });
  }

  function requestMoveReview(history, moveIndex, settings, callback) {
    var promptCtx = buildPromptContext(history, moveIndex);

    var isSimulation = (settings.baseURL === 'simulation' || settings.baseURL === 'demo' || settings.baseURL === 'mock' || settings.isSimulation);
    if (isSimulation) {
      var simReview = generateSimulatedReview(promptCtx.contextData, settings.language || 'en');
      setTimeout(function () {
        callback(null, {
          moveIndex: moveIndex,
          context: promptCtx.contextData,
          review: simReview,
          raw: JSON.stringify(simReview)
        });
      }, 100);
      return;
    }

    var userPrompt = buildUserPrompt(promptCtx.contextData, settings.language || 'en');

    var bodyPayload = {
      model: settings.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: typeof settings.temperature === 'number' ? settings.temperature : 0.3
    };

    sendChatRequest(settings, bodyPayload)
      .then(function (data) {
        var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('Received empty response from AI model.');
        var parsed = parseAiResponse(content, promptCtx.contextData.classification);
        callback(null, {
          moveIndex: moveIndex,
          context: promptCtx.contextData,
          review: parsed,
          raw: content
        });
      })
      .catch(function (err) {
        callback(err, null);
      });
  }

  function createReviewSession() {
    var settings = loadSettings();
    var cache = new Map(); // key: "moveIndex:moveCount:notation" -> reviewData
    var isReviewingAll = false;
    var abortReviewAll = false;

    function getCacheKey(history, moveIndex) {
      if (!history[moveIndex]) return null;
      var mv = history[moveIndex];
      return moveIndex + '_' + history.length + '_' + mv.from.rank + mv.from.file + mv.to.rank + mv.to.file + (mv.special || '');
    }

    function isSimMode() {
      return (settings.baseURL === 'simulation' || settings.baseURL === 'demo' || settings.baseURL === 'mock' || settings.isSimulation);
    }

    function getReviewForMove(history, moveIndex, onComplete) {
      if (moveIndex < 0 || moveIndex >= history.length) {
        onComplete(new Error('Invalid move index'), null);
        return;
      }
      var key = getCacheKey(history, moveIndex);
      if (cache.has(key)) {
        onComplete(null, cache.get(key));
        return;
      }

      if (!isSimMode() && !settings.apiKey && !settings.baseURL.includes('localhost') && !settings.baseURL.includes('127.0.0.1')) {
        onComplete(new Error('NO_API_KEY'), null);
        return;
      }

      requestMoveReview(history, moveIndex, settings, function (err, result) {
        if (!err && result) {
          cache.set(key, result);
        }
        onComplete(err, result);
      });
    }

    function reviewFullGame(history, onProgress, onComplete) {
      if (isReviewingAll) return;
      if (history.length === 0) {
        onComplete(new Error('No moves to review'), null);
        return;
      }
      if (!isSimMode() && !settings.apiKey && !settings.baseURL.includes('localhost') && !settings.baseURL.includes('127.0.0.1')) {
        onComplete(new Error('NO_API_KEY'), null);
        return;
      }

      isReviewingAll = true;
      abortReviewAll = false;
      var results = [];
      var currentIndex = 0;

      function step() {
        if (abortReviewAll || currentIndex >= history.length) {
          isReviewingAll = false;
          onComplete(null, results);
          return;
        }

        var idx = currentIndex;
        getReviewForMove(history, idx, function (err, res) {
          if (err) {
            console.error('Error reviewing move ' + (idx + 1) + ':', err);
          }
          results.push({ moveIndex: idx, result: res, error: err ? err.message : null });
          if (typeof onProgress === 'function') {
            onProgress(idx + 1, history.length, res);
          }
          currentIndex++;
          setTimeout(step, 100);
        });
      }

      step();
    }

    function cancelFullGameReview() {
      abortReviewAll = true;
      isReviewingAll = false;
    }

    function clearCache() {
      cache.clear();
    }

    return {
      getSettings: function () { return settings; },
      updateSettings: function (newSettings) {
        settings = Object.assign({}, settings, newSettings);
        saveSettings(settings);
        return settings;
      },
      getReviewForMove: getReviewForMove,
      reviewFullGame: reviewFullGame,
      cancelFullGameReview: cancelFullGameReview,
      clearCache: clearCache,
      getCachedReview: function (history, moveIndex) {
        var key = getCacheKey(history, moveIndex);
        return cache.get(key) || null;
      },
      isReviewingAll: function () { return isReviewingAll; }
    };
  }

  var api = {
    PIECE_NAMES: PIECE_NAMES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    formatMoveText: formatMoveText,
    renderAsciiBoard: renderAsciiBoard,
    replayToMoveIndex: replayToMoveIndex,
    stateBeforeMoveIndex: stateBeforeMoveIndex,
    classifyMoveByEval: classifyMoveByEval,
    buildPromptContext: buildPromptContext,
    buildUserPrompt: buildUserPrompt,
    parseAiResponse: parseAiResponse,
    resolveRecommendedMove: resolveRecommendedMove,
    generateSimulatedReview: generateSimulatedReview,
    requestMoveReview: requestMoveReview,
    createReviewSession: createReviewSession,
    apiRequest: apiRequest,
    sendChatRequest: sendChatRequest,
    parseModelList: parseModelList,
    listModels: listModels,
    parseChatResponseBody: parseChatResponseBody,
    SYSTEM_PROMPT: SYSTEM_PROMPT
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukReview = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
