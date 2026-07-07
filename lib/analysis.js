'use strict';

// Pure, I/O-free position analysis: static exchange evaluation (SEE) and a
// hanging-piece / blunder scan for the post-game report. No search, no I/O.

const { typeOf, colorOf, opposite, algebraic, fromFEN } = require('./board');
const { attackersOf } = require('./movegen');
const { VALUE } = require('./ai');

// NOTE: this is a standard SEE simplification — it does not model x-ray/battery attackers
// that appear behind a captured piece, and it counts pinned enemy pieces as if they could
// capture. Fine for a post-game blunder *heuristic*; it can occasionally over/under-count.
//
// Standard SEE swap-off: net material (centipawns) the side capturing FIRST gains on `sq`.
// attackersAsc/defendersAsc are piece values sorted ascending (least valuable first).
function seeSwap(targetValue, attackersAsc, defendersAsc) {
  if (attackersAsc.length === 0) return 0;
  const gain = [targetValue];
  let captured = attackersAsc[0];
  let ai = 1, di = 0, n = 1;
  let defenderTurn = true;
  while (true) {
    const list = defenderTurn ? defendersAsc : attackersAsc;
    const idx = defenderTurn ? di : ai;
    if (idx >= list.length) break;
    gain[n] = captured - gain[n - 1];
    captured = list[idx];
    if (defenderTurn) di++; else ai++;
    defenderTurn = !defenderTurn;
    n++;
  }
  for (let k = n - 1; k >= 1; k--) {
    gain[k - 1] = -Math.max(-gain[k - 1], gain[k]);
  }
  return gain[0];
}

// Net centipawns the opponent wins by capturing the piece on `sq` (0 if safe / empty).
function seeOnSquare(state, sq) {
  const target = state.board[sq];
  if (target === null) return 0;
  const owner = colorOf(target);
  const attackerVals = attackersOf(state, sq, opposite(owner))
    .map((s) => VALUE[typeOf(state.board[s])]).sort((a, b) => a - b);
  const defenderVals = attackersOf(state, sq, owner)
    .map((s) => VALUE[typeOf(state.board[s])]).sort((a, b) => a - b);
  return seeSwap(VALUE[typeOf(target)], attackerVals, defenderVals);
}

// Pieces of `color` the opponent can win material from (SEE > 0), worst first.
function hangingPieces(state, color) {
  const out = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = state.board[sq];
    if (p === null || colorOf(p) !== color || typeOf(p) === 'k') continue;
    const loss = seeOnSquare(state, sq);
    if (loss > 0) out.push({ square: algebraic(sq), piece: p, loss });
  }
  return out.sort((a, b) => b.loss - a.loss);
}

// Blunder scan over a game. `fens` = positions AFTER each move (in order).
// A blunder = the side that just moved left >= a minor piece (200cp) hanging.
// Returns { w, b, plies:[{ply, mover, worst:{square,piece,loss}}] }.
const BLUNDER_THRESHOLD = 200;

function analyzeGame(fens) {
  const result = { w: 0, b: 0, plies: [] };
  fens.forEach((fen, i) => {
    const state = fromFEN(fen);
    const mover = opposite(state.turn); // side that just moved to reach this position
    const hang = hangingPieces(state, mover);
    const worst = hang[0];
    if (worst && worst.loss >= BLUNDER_THRESHOLD) {
      result[mover]++;
      result.plies.push({ ply: i + 1, mover, worst });
    }
  });
  return result;
}

module.exports = { seeSwap, seeOnSquare, hangingPieces, analyzeGame, BLUNDER_THRESHOLD };
