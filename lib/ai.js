'use strict';

// Deterministic, seeded chess AI ladder (pure, I/O-free). Operates on engine `state`
// objects (from board.js) via make/unmake. Given the same seed and the same sequence of
// positions, chooseMove returns identical moves — so any reported game replays exactly.
//
//   L1  shuffle legal moves            (random-but-seeded)
//   L2  greedy material                (1-ply, captures/material)
//   L3  minimax depth 2, material + mobility
//   L4  alpha-beta depth 3, + piece-square tables
//   L5  "The Calculator": alpha-beta depth 3 + quiescence, PST

const { WHITE, BLACK, fileOf, rankOf, typeOf, colorOf, opposite } = require('./board');
const { generateLegalMoves, makeMove, unmakeMove, inCheck } = require('./movegen');

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 1000000;

// Piece-square tables (white's view, a1..h8 by rank). Mirrored for black.
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, -20, -20, 10, 10, 5,
    5, -5, -10, 0, 0, -10, -5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, 5, 10, 25, 25, 10, 5, 5,
    10, 10, 20, 30, 30, 20, 10, 10,
    50, 50, 50, 50, 50, 50, 50, 50,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 5, 5, 0, 0, 0,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    5, 10, 10, 10, 10, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -10, 5, 5, 5, 5, 5, 0, -10,
    0, 0, 5, 5, 5, 5, 0, -5,
    -5, 0, 5, 5, 5, 5, 0, -5,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    20, 30, 10, 0, 0, 10, 30, 20,
    20, 20, 0, 0, 0, 0, 20, 20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
  ],
};

function mirror(sq) { return (7 - rankOf(sq)) * 8 + fileOf(sq); }

// Static evaluation from WHITE's perspective (centipawns).
function evaluateWhite(state, usePST) {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = state.board[sq];
    if (p === null) continue;
    const t = typeOf(p);
    const white = colorOf(p) === WHITE;
    let v = VALUE[t];
    if (usePST) v += PST[t][white ? sq : mirror(sq)];
    score += white ? v : -v;
  }
  return score;
}

function mobility(state) {
  const mine = generateLegalMoves(state).length;
  state.turn = opposite(state.turn);
  const theirs = generateLegalMoves(state).length;
  state.turn = opposite(state.turn);
  return mine - theirs; // from side-to-move's perspective
}

// Evaluation from the side-to-move's perspective.
function evaluate(state, opts) {
  const white = evaluateWhite(state, opts.pst);
  let score = state.turn === WHITE ? white : -white;
  if (opts.mobility) score += 2 * mobility(state);
  return score;
}

function isCaptureMove(state, m) {
  return m.flags === 'capture' || m.flags === 'ep' || m.flags === 'capture-promo';
}

// MVV-LVA-ish ordering: captures first (by victim value), deterministic and stable.
function orderMoves(state, moves) {
  return moves
    .map((m, i) => {
      let s = 0;
      const victim = state.board[m.to];
      if (victim) s += 10 * VALUE[typeOf(victim)] - VALUE[typeOf(state.board[m.from])];
      else if (m.flags === 'ep') s += 10 * VALUE.p;
      if (m.promotion) s += VALUE[m.promotion];
      return { m, s, i };
    })
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.m);
}

function quiescence(state, alpha, beta, opts) {
  const standPat = evaluate(state, opts);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  const caps = orderMoves(state, generateLegalMoves(state).filter((m) => isCaptureMove(state, m)));
  for (const m of caps) {
    const undo = makeMove(state, m);
    const score = -quiescence(state, -beta, -alpha, opts);
    unmakeMove(state, undo);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// Negamax with alpha-beta. Returns best score from side-to-move's perspective.
function search(state, depth, alpha, beta, ply, opts) {
  const legal = generateLegalMoves(state);
  if (legal.length === 0) {
    if (inCheck(state, state.turn)) return -(MATE - ply); // mated: prefer slower loss / faster mate
    return 0; // stalemate
  }
  if (depth === 0) {
    return opts.quiescence ? quiescence(state, alpha, beta, opts) : evaluate(state, opts);
  }
  let best = -Infinity;
  for (const m of orderMoves(state, legal)) {
    const undo = makeMove(state, m);
    const score = -search(state, depth - 1, -beta, -alpha, ply + 1, opts);
    unmakeMove(state, undo);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

const LEVELS = {
  1: { kind: 'random' },
  2: { kind: 'search', depth: 1, opts: { pst: false, mobility: false } },
  3: { kind: 'search', depth: 2, opts: { pst: false, mobility: true } },
  4: { kind: 'search', depth: 3, opts: { pst: true, mobility: true } },
  5: { kind: 'search', depth: 3, opts: { pst: true, mobility: true, quiescence: true } },
};

// Choose a move for the side to move. `rng` (from lib/rng) makes ties deterministic.
// Returns the chosen move object (as produced by generateLegalMoves), or null if none.
function chooseMove(state, level, rng) {
  const legal = generateLegalMoves(state);
  if (legal.length === 0) return null;
  const cfg = LEVELS[level] || LEVELS[3];

  if (cfg.kind === 'random') {
    return legal[rng.int(legal.length)];
  }

  // Score every root move; collect those within the best bucket, break ties with rng.
  let best = -Infinity;
  const scored = [];
  for (const m of orderMoves(state, legal)) {
    const undo = makeMove(state, m);
    const score = -search(state, cfg.depth - 1, -MATE, MATE, 1, cfg.opts);
    unmakeMove(state, undo);
    scored.push({ m, score });
    if (score > best) best = score;
  }
  const top = scored.filter((s) => s.score === best).map((s) => s.m);
  return top[rng.int(top.length)];
}

module.exports = { chooseMove, evaluateWhite, VALUE, LEVELS };
