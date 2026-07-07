'use strict';

// Puzzle model + MACHINE VERIFIER (pure, I/O-free). Every puzzle in the bank is
// re-verified by the test suite forever (PRODUCT-SPEC §5). Two verifiable kinds:
//   kind 'mate' : mate in N — proven FORCED, MINIMAL (no faster mate), and SINGLE-SOLUTION
//                 (exactly one first move forces mate in N).
//   kind 'win'  : the solution's key move wins >= `gain` centipawns against best defense,
//                 verified by bounded negamax, and is strictly better than every alternative.
//
// Puzzle shape: { id, fen, sideToMove, kind, mateIn?, gain?, solution:[SAN...], motif, station, rung, source }

const { Chess } = require('./game');
const { fromFEN, opposite, typeOf, parseSquare } = require('./board');
const { generateLegalMoves, makeMove, unmakeMove, inCheck } = require('./movegen');
const { moveToSAN } = require('./game');
const { evaluateWhite, VALUE } = require('./ai');
const { hangingPieces } = require('./analysis');

// --- mate solver -----------------------------------------------------------
// True if the side to move can force checkmate in at most n of its own moves.
function attackerCanMate(state, n) {
  if (n <= 0) return false;
  for (const m of generateLegalMoves(state)) {
    const undo = makeMove(state, m);
    const replies = generateLegalMoves(state);
    let works;
    if (replies.length === 0) {
      works = inCheck(state, state.turn); // mate delivered (else stalemate — fails)
    } else if (n === 1) {
      works = false; // opponent has a move; can't be mate-in-1
    } else {
      works = true;
      for (const d of replies) {
        const u2 = makeMove(state, d);
        const sub = attackerCanMate(state, n - 1);
        unmakeMove(state, u2);
        if (!sub) { works = false; break; }
      }
    }
    unmakeMove(state, undo);
    if (works) return true;
  }
  return false;
}

// Smallest k in 1..maxN with a forced mate, or null.
function mateDistance(state, maxN) {
  for (let k = 1; k <= maxN; k++) if (attackerCanMate(state, k)) return k;
  return null;
}

// First moves that force mate in exactly n (assuming n is minimal).
function matingFirstMoves(state, n) {
  const out = [];
  for (const m of generateLegalMoves(state)) {
    const undo = makeMove(state, m);
    const replies = generateLegalMoves(state);
    let works;
    if (replies.length === 0) works = inCheck(state, state.turn);
    else if (n === 1) works = false;
    else {
      works = true;
      for (const d of replies) {
        const u2 = makeMove(state, d);
        const sub = attackerCanMate(state, n - 1);
        unmakeMove(state, u2);
        if (!sub) { works = false; break; }
      }
    }
    unmakeMove(state, undo);
    if (works) out.push(m);
  }
  return out;
}

// --- material search (for 'win' puzzles) -----------------------------------
function materialWhite(state) {
  let s = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = state.board[sq];
    if (p === null) continue;
    const v = VALUE[p.toLowerCase()];
    s += (p >= 'A' && p <= 'Z') ? v : -v;
  }
  return s;
}

// Negamax on material only (captures matter); returns best material for side to move.
function materialSearch(state, depth) {
  if (depth === 0) return state.turn === 'w' ? materialWhite(state) : -materialWhite(state);
  const moves = generateLegalMoves(state);
  if (moves.length === 0) return inCheck(state, state.turn) ? -1000000 : 0;
  let best = -Infinity;
  for (const m of moves) {
    const undo = makeMove(state, m);
    const score = -materialSearch(state, depth - 1);
    unmakeMove(state, undo);
    if (score > best) best = score;
  }
  return best;
}

// --- verification ----------------------------------------------------------
function sanOf(state, m) { return moveToSAN(state, m).replace(/[+#]$/, ''); }

// Material outcome (side-to-move perspective) of a SAN move after best defense to `depth`.
function scoreOfSan(state, san, depth) {
  const target = String(san).replace(/[+#]$/, '');
  for (const m of generateLegalMoves(state)) {
    if (sanOf(state, m) === target) {
      const u = makeMove(state, m);
      const sc = -materialSearch(state, depth - 1);
      unmakeMove(state, u);
      return sc;
    }
  }
  return null;
}

// Tolerant grader for STRATEGY drills: accept any legal move that does not hang material (SEE).
// Openings legitimately have several good moves — exact-SAN grading would fail equally-good play,
// and a deep "not worse than declared" search is unreliable here (no quiescence in wide opening
// trees), so the objective bar is simply: legal + doesn't drop material to a static exchange.
function gradeStrategy(fen, playerInput, opts = {}) {
  const g = new Chess(fen);
  let mv = null;
  try { mv = g.move(playerInput); } catch (e) { return { ok: false, reason: e.message }; }
  // Accept any legal move that does not hang material (SEE) — openings have several good moves,
  // and the spec's §3 S bar is "explained why", not a unique best. Reject only outright blunders.
  const after = fromFEN(g.fen());
  const mover = opposite(after.turn); // side that just moved
  const hung = hangingPieces(after, mover).filter((h) => h.loss >= 200);
  if (hung.length) return { ok: false, reason: `that leaves the ${hung[0].piece} on ${hung[0].square} hanging` };
  return { ok: true, san: mv.san };
}

const PIECE_WORD = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// Grader for R1/R2 "move-piece" drills: accept ANY legal move made with a piece of `pieceType`.
// Movement rules only — no check/escape reasoning required.
function gradeMovePiece(fen, playerInput, pieceType) {
  const state = fromFEN(fen);
  const g = new Chess(fen);
  let mv = null;
  try { mv = g.move(playerInput); } catch (e) { return { ok: false, reason: e.message }; }
  const from = parseSquare(mv.from);
  const pt = from >= 0 ? typeOf(state.board[from]) : null;
  if (pt !== pieceType) return { ok: false, reason: `that is not a ${PIECE_WORD[pieceType] || pieceType} move — move your ${PIECE_WORD[pieceType] || pieceType}` };
  return { ok: true, san: mv.san };
}

function verifyPuzzle(p) {
  const problems = [];
  let state;
  try { state = fromFEN(p.fen); } catch (e) { return { ok: false, problems: ['bad FEN: ' + e.message] }; }

  const stm = state.turn;
  if (p.sideToMove && p.sideToMove !== stm) problems.push(`sideToMove ${p.sideToMove} != FEN turn ${stm}`);
  if (!Array.isArray(p.solution) || p.solution.length === 0) problems.push('missing solution line');

  if (p.kind === 'mate') {
    const n = p.mateIn;
    if (!(n >= 1)) { problems.push('mateIn must be >= 1'); return { ok: false, problems }; }
    const dist = mateDistance(state, n);
    if (dist === null) problems.push(`no forced mate within ${n}`);
    else if (dist < n) problems.push(`mate is faster (in ${dist}) than declared ${n} — not minimal`);
    else {
      const firsts = matingFirstMoves(state, n);
      if (firsts.length === 0) problems.push('no first move forces the mate');
      else if (firsts.length > 1) problems.push(`not single-solution: ${firsts.length} first moves force mate in ${n}`);
      else {
        const keySan = sanOf(state, firsts[0]);
        const declared = String(p.solution[0]).replace(/[+#]$/, '');
        if (keySan !== declared) problems.push(`solution first move ${declared} != unique key move ${keySan}`);
      }
    }
  } else if (p.kind === 'win') {
    const gain = p.gain || 200;
    const depth = p.depth || 4;
    // Key move must be the unique material-best by bounded search, winning >= gain.
    const baseline = state.turn === 'w' ? materialWhite(state) : -materialWhite(state);
    const scored = [];
    for (const m of generateLegalMoves(state)) {
      const undo = makeMove(state, m);
      const score = -materialSearch(state, depth - 1);
      unmakeMove(state, undo);
      scored.push({ m, score, san: sanOf(state, m) });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const swing = best.score - baseline;
    if (swing < gain) problems.push(`best line only wins ${swing}cp (< ${gain})`);
    if (scored.length > 1 && scored[1].score >= best.score) problems.push('not single-solution: a second move ties the best line');
    const declared = String(p.solution[0]).replace(/[+#]$/, '');
    if (best.san !== declared) problems.push(`solution first move ${declared} != best move ${best.san}`);
  } else if (p.kind === 'rule') {
    // Rulebook puzzles verified against the engine's own legality — deterministic ground truth.
    const legal = generateLegalMoves(state);
    const declared = String(p.solution[0]).replace(/[+#]$/, '');
    if (p.ruleType === 'only-move') {
      // The position must be a forced move (exactly one legal reply) and it must match.
      if (legal.length !== 1) problems.push(`only-move puzzle must have exactly 1 legal move, has ${legal.length}`);
      else if (sanOf(state, legal[0]) !== declared) problems.push(`the only legal move is ${sanOf(state, legal[0])}, not ${declared}`);
    } else if (p.ruleType === 'legal-special') {
      // The solution move must be legal AND be the special move it claims (castle/ep/promotion).
      const match = legal.find((m) => sanOf(state, m) === declared);
      if (!match) problems.push(`${declared} is not legal here`);
      else {
        const kindOk = p.special === 'castle' ? (match.flags === 'castle-k' || match.flags === 'castle-q')
          : p.special === 'ep' ? match.flags === 'ep'
            : p.special === 'promotion' ? !!match.promotion
              : false;
        if (!kindOk) problems.push(`${declared} is legal but not a ${p.special} move (flags=${match.flags})`);
      }
    } else if (p.ruleType === 'move-piece') {
      // Beginner piece-movement (R1 pawns / R2 pieces): "make a legal <type> move". Solvable with
      // ONLY movement rules — deliberately NOT check/escape logic, and NOT single-solution (any legal
      // move of the type counts). Guard: side to move must NOT be in check, so no escape reasoning.
      if (inCheck(state, state.turn)) problems.push('move-piece puzzle must not be in check (that is R4 skill)');
      const pt = p.pieceType;
      if (!'pnbrqk'.includes(pt)) problems.push(`bad pieceType ${pt}`);
      const ofType = legal.filter((m) => typeOf(state.board[m.from]) === pt);
      if (ofType.length === 0) problems.push(`no legal ${pt} move available`);
      else if (!ofType.some((m) => sanOf(state, m) === declared)) problems.push(`declared ${declared} is not a legal ${pt} move`);
    } else {
      problems.push(`unknown ruleType ${p.ruleType}`);
    }
  } else if (p.kind === 'strategy') {
    // Positional puzzles: the bar (per spec §3 S) is "explained why", not search-proof.
    // We sanity-check only that the recommended move is legal AND does not hang material.
    if (!p.explanation) problems.push('strategy puzzle needs an explanation');
    const declared = String(p.solution[0]).replace(/[+#]$/, '');
    const g = new Chess(p.fen);
    let mv = null;
    try { mv = g.move(declared); } catch (e) { problems.push('recommended move illegal: ' + e.message); }
    if (mv) {
      // Engine sanity gate (SEE-based, reliable without quiescence): the recommended move must not
      // leave own material hanging. This is the objective anti-blunder floor for §3 S — deeper
      // "wins a pawn"-style claims are a human content pass (plain material search mis-scores
      // recaptures in wide opening trees, so we do NOT deep-search here).
      const after = fromFEN(g.fen());
      const mover = state.turn; // side that just made the recommended move
      const hung = hangingPieces(after, mover).filter((h) => h.loss >= 200);
      if (hung.length) problems.push(`recommended move hangs material: ${hung.map((h) => h.piece + '@' + h.square + ' (-' + h.loss + ')').join(', ')}`);
    }
  } else {
    problems.push(`unknown kind ${p.kind}`);
  }

  // The declared solution line must be legal from the FEN.
  if (Array.isArray(p.solution)) {
    const g = new Chess(p.fen);
    try { for (const san of p.solution) g.move(san); }
    catch (e) { problems.push('solution line illegal: ' + e.message); }
  }

  return { ok: problems.length === 0, problems };
}

// Verify a whole bank; returns per-station counts + failures.
function verifyBank(bank) {
  const failures = [];
  const perStation = {};
  for (const p of bank) {
    perStation[p.station] = (perStation[p.station] || 0) + 1;
    const r = verifyPuzzle(p);
    if (!r.ok) failures.push({ id: p.id, problems: r.problems });
  }
  return { total: bank.length, perStation, failures, ok: failures.length === 0 };
}

module.exports = { verifyPuzzle, verifyBank, mateDistance, matingFirstMoves, attackerCanMate, gradeStrategy, gradeMovePiece, PIECE_WORD };
