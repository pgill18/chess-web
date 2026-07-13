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

// Static evaluation from WHITE's perspective (centipawns). `weights` (optional) scales material
// per piece type, mobility, and PST usage — this is how named AI characters (below) differ from
// the L1-5 ladder without touching search itself. Omitted/undefined -> identical to plain L1-5
// behavior (all multipliers are 1), so this is a strict backward-compatible extension.
function evaluateWhite(state, usePST, weights) {
  const w = (weights && weights.material) || null;
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = state.board[sq];
    if (p === null) continue;
    const t = typeOf(p);
    const white = colorOf(p) === WHITE;
    let v = VALUE[t] * (w && w[t] !== undefined ? w[t] : 1);
    if (usePST) v += PST[t][white ? sq : mirror(sq)] * (weights && weights.pst !== undefined ? weights.pst : 1);
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
  const white = evaluateWhite(state, opts.pst, opts.weights);
  let score = state.turn === WHITE ? white : -white;
  if (opts.mobility) score += 2 * (opts.weights && opts.weights.mobility !== undefined ? opts.weights.mobility : 1) * mobility(state);
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

// Bounded to opts.maxQDepth extra plies past the horizon ONLY when opts.maxQDepth is explicitly
// set — plain L1-5 (chooseMove) never sets it, so vanilla L5 stays exactly as it always was
// (unbounded, byte-identical to pre-Phase-4 behavior — "every reported game replays exactly" is
// a standing doctrine point, not just for the new cast). Named characters (chooseMoveAs) DO set
// it: unbounded capture-chain extension could run away in tactically dense positions (e.g. several
// defended captures on one square), and a cap keeps per-game cost predictable once a game is one
// of many played back-to-back (tournaments/train-vs-rival), not just a single interactive move. A
// shallow cap on THIS extension does not change a character's identity (depth/weights define
// that) — it only stops chasing exchanges past a reasonable point.
function quiescence(state, alpha, beta, opts, qDepth) {
  const standPat = evaluate(state, opts);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  const d = qDepth || 0;
  if (opts.maxQDepth != null && d >= opts.maxQDepth) return alpha;
  const caps = orderMoves(state, generateLegalMoves(state).filter((m) => isCaptureMove(state, m)));
  for (const m of caps) {
    const undo = makeMove(state, m);
    const score = -quiescence(state, -beta, -alpha, opts, d + 1);
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

// ---- Named AI cast (Phase 4, PRODUCT-SPEC §8) ----
// Deterministic personality variants of the SAME engine — not new search algorithms. A character
// is a depth/quiescence profile (reused from the L1-5 ladder) plus a distinct eval-weights vector
// (material per piece type, mobility, PST usage) that genuinely changes which move gets chosen.
//
// Move-ordering is deliberately NOT a personality lever: chooseMove/chooseMoveAs evaluate every
// legal ROOT move exhaustively regardless of orderMoves' order (ordering only affects alpha-beta
// PRUNING efficiency inside the recursion — it never changes a move's score or which moves tie
// for best). Two characters differing only in move-ordering would play identically; building that
// as a "trait" would be cosmetic, not real, so it's left out.
const CHARACTERS = {
  rook: {
    name: 'Rook "The Grinder"',
    blurb: 'Values material above all else; trades down into simple, winning endgames.',
    voiceLines: [
      'Material is truth. Everything else is opinion.',
      "I'll take that, thank you.",
      'Simplify, simplify, simplify.',
    ],
    depth: 3,
    quiescence: false,
    weights: { material: { p: 1.1, n: 1, b: 1, r: 1.05, q: 1 }, mobility: 0.3, pst: 0.4 },
  },
  vera: {
    name: 'Vera "The Aggressor"',
    blurb: 'Chases piece activity and space, even at some material cost.',
    voiceLines: [
      "Sitting still is losing slowly.",
      "Every square you don't control is a square I will.",
      "Let's go faster.",
    ],
    depth: 3,
    quiescence: true,
    weights: { material: { p: 0.9, n: 1, b: 1, r: 1, q: 1 }, mobility: 2.2, pst: 1.4 },
  },
  selene: {
    name: 'Selene "The Strategist"',
    blurb: 'Plays for long-term positional pressure over immediate material.',
    voiceLines: [
      'A pawn today, a square forever.',
      'Patience is a weapon too.',
      'I am already three moves past this one.',
    ],
    depth: 3,
    quiescence: false,
    weights: { material: { p: 0.85, n: 0.95, b: 0.95, r: 1, q: 1 }, mobility: 1.2, pst: 2.0 },
  },
  talon: {
    name: 'Talon "The Tactician"',
    blurb: 'Hunts for combinations; keeps minor pieces active and looks deep with quiescence.',
    voiceLines: [
      'Show me a weakness and I will show you a combination.',
      'The board is a puzzle. I like puzzles.',
      'One tempo. That is all I need.',
    ],
    depth: 3,
    quiescence: true,
    weights: { material: { p: 1, n: 1.1, b: 1.1, r: 0.95, q: 1.05 }, mobility: 1.6, pst: 1.0 },
  },
};

function listCharacters() { return Object.keys(CHARACTERS).map((key) => ({ key, name: CHARACTERS[key].name, blurb: CHARACTERS[key].blurb })); }
function getCharacter(key) { return CHARACTERS[key] || null; }

// Deterministic given the same seed/rng-state and position, same as chooseMove for the L1-5 ladder.
function chooseMoveAs(state, characterKey, rng) {
  const legal = generateLegalMoves(state);
  if (legal.length === 0) return null;
  const ch = CHARACTERS[characterKey];
  if (!ch) return chooseMove(state, 4, rng); // unknown character -> a sane, still-deterministic default
  // maxQDepth is set explicitly here (and ONLY here / for named characters) — plain chooseMove
  // never sets it, so vanilla L1-5 quiescence stays unbounded, exactly as before Phase 4.
  const opts = { pst: true, mobility: true, quiescence: ch.quiescence, weights: ch.weights, maxQDepth: 6 };
  let best = -Infinity;
  const scored = [];
  for (const m of orderMoves(state, legal)) {
    const undo = makeMove(state, m);
    const score = -search(state, ch.depth - 1, -MATE, MATE, 1, opts);
    unmakeMove(state, undo);
    scored.push({ m, score });
    if (score > best) best = score;
  }
  const top = scored.filter((s) => s.score === best).map((s) => s.m);
  return top[rng.int(top.length)];
}

// Deterministic voice-line pick (a rng draw, so a seeded rival session always says the same lines
// in the same order given the same seed — flavor, not infrastructure, but kept reproducible anyway).
function pickVoiceLine(characterKey, rng) {
  const ch = CHARACTERS[characterKey];
  if (!ch || !ch.voiceLines.length) return '';
  return ch.voiceLines[rng.int(ch.voiceLines.length)];
}

module.exports = {
  chooseMove, evaluateWhite, VALUE, LEVELS,
  CHARACTERS, listCharacters, getCharacter, chooseMoveAs, pickVoiceLine,
};
