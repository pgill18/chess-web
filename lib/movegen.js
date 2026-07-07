'use strict';

// Pure, I/O-free move generation, make/unmake, attack detection, and perft.
// A "move" is: { from, to, promotion?, flags }
//   flags is one of: '' | 'capture' | 'double' | 'ep' | 'promo' | 'capture-promo'
//                    | 'castle-k' | 'castle-q'

const {
  WHITE, BLACK, fileOf, rankOf, makeSquare, colorOf, typeOf, opposite,
} = require('./board');

const KNIGHT_DELTAS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_DELTAS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const QUEEN_DIRS = BISHOP_DIRS.concat(ROOK_DIRS);

function onBoard(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }

// Is `sq` attacked by any piece of color `byColor`?
function isSquareAttacked(state, sq, byColor) {
  const board = state.board;
  const f = fileOf(sq);
  const r = rankOf(sq);

  // Pawns: a byColor pawn attacks `sq` if it sits one rank "behind" `sq` diagonally.
  if (byColor === WHITE) {
    for (const df of [-1, 1]) {
      const nf = f + df, nr = r - 1;
      if (onBoard(nf, nr) && board[makeSquare(nf, nr)] === 'P') return true;
    }
  } else {
    for (const df of [-1, 1]) {
      const nf = f + df, nr = r + 1;
      if (onBoard(nf, nr) && board[makeSquare(nf, nr)] === 'p') return true;
    }
  }

  // Knights
  const N = byColor === WHITE ? 'N' : 'n';
  for (const [df, dr] of KNIGHT_DELTAS) {
    const nf = f + df, nr = r + dr;
    if (onBoard(nf, nr) && board[makeSquare(nf, nr)] === N) return true;
  }

  // King
  const K = byColor === WHITE ? 'K' : 'k';
  for (const [df, dr] of KING_DELTAS) {
    const nf = f + df, nr = r + dr;
    if (onBoard(nf, nr) && board[makeSquare(nf, nr)] === K) return true;
  }

  // Bishop / Queen (diagonals)
  const B = byColor === WHITE ? 'B' : 'b';
  const Q = byColor === WHITE ? 'Q' : 'q';
  for (const [df, dr] of BISHOP_DIRS) {
    let nf = f + df, nr = r + dr;
    while (onBoard(nf, nr)) {
      const p = board[makeSquare(nf, nr)];
      if (p !== null) { if (p === B || p === Q) return true; break; }
      nf += df; nr += dr;
    }
  }

  // Rook / Queen (orthogonals)
  const R = byColor === WHITE ? 'R' : 'r';
  for (const [df, dr] of ROOK_DIRS) {
    let nf = f + df, nr = r + dr;
    while (onBoard(nf, nr)) {
      const p = board[makeSquare(nf, nr)];
      if (p !== null) { if (p === R || p === Q) return true; break; }
      nf += df; nr += dr;
    }
  }

  return false;
}

// Does the piece on `from` attack `to` on the current board (blockers respected)?
function attacks(state, from, to) {
  const p = state.board[from];
  if (p === null || from === to) return false;
  const t = typeOf(p);
  const df = fileOf(to) - fileOf(from);
  const dr = rankOf(to) - rankOf(from);
  const adf = Math.abs(df), adr = Math.abs(dr);
  if (t === 'p') {
    const dir = colorOf(p) === WHITE ? 1 : -1;
    return dr === dir && adf === 1;
  }
  if (t === 'n') return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
  if (t === 'k') return adf <= 1 && adr <= 1;
  const diagonal = adf === adr;
  const straight = df === 0 || dr === 0;
  if (t === 'b' && !diagonal) return false;
  if (t === 'r' && !straight) return false;
  if (t === 'q' && !diagonal && !straight) return false;
  const sf = Math.sign(df), sr = Math.sign(dr);
  let f = fileOf(from) + sf, r = rankOf(from) + sr;
  while (f !== fileOf(to) || r !== rankOf(to)) {
    if (state.board[makeSquare(f, r)] !== null) return false; // blocked
    f += sf; r += sr;
  }
  return true;
}

// All squares holding a `byColor` piece that attacks `sq`.
function attackersOf(state, sq, byColor) {
  const out = [];
  for (let s = 0; s < 64; s++) {
    const p = state.board[s];
    if (p === null || colorOf(p) !== byColor) continue;
    if (attacks(state, s, sq)) out.push(s);
  }
  return out;
}

function findKing(state, color) {
  const k = color === WHITE ? 'K' : 'k';
  for (let sq = 0; sq < 64; sq++) if (state.board[sq] === k) return sq;
  return -1;
}

function inCheck(state, color) {
  const ksq = findKing(state, color);
  if (ksq < 0) return false;
  return isSquareAttacked(state, ksq, opposite(color));
}

function addPromotions(moves, from, to, capture) {
  const flag = capture ? 'capture-promo' : 'promo';
  for (const pr of ['q', 'r', 'b', 'n']) moves.push({ from, to, promotion: pr, flags: flag });
}

function addCastling(state, moves, ksq) {
  const us = state.turn;
  const them = opposite(us);
  const board = state.board;
  if (isSquareAttacked(state, ksq, them)) return; // never castle out of check

  if (us === WHITE) {
    if (state.castling.K && board[5] === null && board[6] === null && board[7] === 'R'
      && !isSquareAttacked(state, 5, them) && !isSquareAttacked(state, 6, them)) {
      moves.push({ from: 4, to: 6, flags: 'castle-k' });
    }
    if (state.castling.Q && board[3] === null && board[2] === null && board[1] === null && board[0] === 'R'
      && !isSquareAttacked(state, 3, them) && !isSquareAttacked(state, 2, them)) {
      moves.push({ from: 4, to: 2, flags: 'castle-q' });
    }
  } else {
    if (state.castling.k && board[61] === null && board[62] === null && board[63] === 'r'
      && !isSquareAttacked(state, 61, them) && !isSquareAttacked(state, 62, them)) {
      moves.push({ from: 60, to: 62, flags: 'castle-k' });
    }
    if (state.castling.q && board[59] === null && board[58] === null && board[57] === null && board[56] === 'r'
      && !isSquareAttacked(state, 59, them) && !isSquareAttacked(state, 58, them)) {
      moves.push({ from: 60, to: 58, flags: 'castle-q' });
    }
  }
}

// Pseudo-legal moves (may leave own king in check; filtered by generateLegalMoves).
function generatePseudoMoves(state) {
  const moves = [];
  const board = state.board;
  const us = state.turn;
  const them = opposite(us);

  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p === null || colorOf(p) !== us) continue;
    const t = typeOf(p);
    const f = fileOf(sq);
    const r = rankOf(sq);

    if (t === 'p') {
      const dir = us === WHITE ? 1 : -1;
      const startRank = us === WHITE ? 1 : 6;
      const promoRank = us === WHITE ? 7 : 0;

      const r1 = r + dir;
      if (r1 >= 0 && r1 < 8 && board[makeSquare(f, r1)] === null) {
        const to = makeSquare(f, r1);
        if (r1 === promoRank) addPromotions(moves, sq, to, false);
        else moves.push({ from: sq, to, flags: '' });
        if (r === startRank) {
          const r2 = r + 2 * dir;
          if (board[makeSquare(f, r2)] === null) {
            moves.push({ from: sq, to: makeSquare(f, r2), flags: 'double' });
          }
        }
      }
      for (const df of [-1, 1]) {
        const nf = f + df, nr = r + dir;
        if (!onBoard(nf, nr)) continue;
        const to = makeSquare(nf, nr);
        const tp = board[to];
        if (tp !== null && colorOf(tp) === them) {
          if (nr === promoRank) addPromotions(moves, sq, to, true);
          else moves.push({ from: sq, to, flags: 'capture' });
        } else if (to === state.ep) {
          moves.push({ from: sq, to, flags: 'ep' });
        }
      }
    } else if (t === 'n') {
      for (const [df, dr] of KNIGHT_DELTAS) {
        const nf = f + df, nr = r + dr;
        if (!onBoard(nf, nr)) continue;
        const to = makeSquare(nf, nr);
        const tp = board[to];
        if (tp === null) moves.push({ from: sq, to, flags: '' });
        else if (colorOf(tp) === them) moves.push({ from: sq, to, flags: 'capture' });
      }
    } else if (t === 'k') {
      for (const [df, dr] of KING_DELTAS) {
        const nf = f + df, nr = r + dr;
        if (!onBoard(nf, nr)) continue;
        const to = makeSquare(nf, nr);
        const tp = board[to];
        if (tp === null) moves.push({ from: sq, to, flags: '' });
        else if (colorOf(tp) === them) moves.push({ from: sq, to, flags: 'capture' });
      }
      addCastling(state, moves, sq);
    } else {
      const dirs = t === 'b' ? BISHOP_DIRS : t === 'r' ? ROOK_DIRS : QUEEN_DIRS;
      for (const [df, dr] of dirs) {
        let nf = f + df, nr = r + dr;
        while (onBoard(nf, nr)) {
          const to = makeSquare(nf, nr);
          const tp = board[to];
          if (tp === null) { moves.push({ from: sq, to, flags: '' }); }
          else { if (colorOf(tp) === them) moves.push({ from: sq, to, flags: 'capture' }); break; }
          nf += df; nr += dr;
        }
      }
    }
  }
  return moves;
}

// Apply a move in place, returning an undo record for unmakeMove.
function makeMove(state, move) {
  const board = state.board;
  const us = state.turn;
  const piece = board[move.from];
  const undo = {
    move,
    captured: null,
    capturedSquare: -1,
    castling: { K: state.castling.K, Q: state.castling.Q, k: state.castling.k, q: state.castling.q },
    ep: state.ep,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
  };

  const isPawn = typeOf(piece) === 'p';
  let isCapture = board[move.to] !== null;

  state.ep = -1;
  board[move.from] = null;

  if (move.flags === 'ep') {
    const capSq = us === WHITE ? move.to - 8 : move.to + 8;
    undo.captured = board[capSq];
    undo.capturedSquare = capSq;
    board[capSq] = null;
    board[move.to] = piece;
    isCapture = true;
  } else if (move.promotion) {
    if (board[move.to] !== null) { undo.captured = board[move.to]; undo.capturedSquare = move.to; }
    board[move.to] = us === WHITE ? move.promotion.toUpperCase() : move.promotion;
  } else {
    if (board[move.to] !== null) { undo.captured = board[move.to]; undo.capturedSquare = move.to; }
    board[move.to] = piece;
  }

  if (move.flags === 'castle-k') {
    if (us === WHITE) { board[7] = null; board[5] = 'R'; } else { board[63] = null; board[61] = 'r'; }
  } else if (move.flags === 'castle-q') {
    if (us === WHITE) { board[0] = null; board[3] = 'R'; } else { board[56] = null; board[59] = 'r'; }
  }

  if (move.flags === 'double') {
    state.ep = us === WHITE ? move.from + 8 : move.from - 8;
  }

  // Castling rights bookkeeping.
  if (typeOf(piece) === 'k') {
    if (us === WHITE) { state.castling.K = false; state.castling.Q = false; }
    else { state.castling.k = false; state.castling.q = false; }
  }
  if (move.from === 0 || move.to === 0) state.castling.Q = false;
  if (move.from === 7 || move.to === 7) state.castling.K = false;
  if (move.from === 56 || move.to === 56) state.castling.q = false;
  if (move.from === 63 || move.to === 63) state.castling.k = false;

  if (isPawn || isCapture) state.halfmove = 0; else state.halfmove++;
  if (us === BLACK) state.fullmove++;
  state.turn = opposite(us);
  return undo;
}

function unmakeMove(state, undo) {
  const move = undo.move;
  const board = state.board;
  state.turn = opposite(state.turn); // back to the side that moved
  const us = state.turn;
  state.castling = undo.castling;
  state.ep = undo.ep;
  state.halfmove = undo.halfmove;
  state.fullmove = undo.fullmove;

  const piece = move.promotion ? (us === WHITE ? 'P' : 'p') : board[move.to];
  board[move.from] = piece;

  if (move.flags === 'ep') {
    board[move.to] = null;
    board[undo.capturedSquare] = undo.captured;
  } else {
    board[move.to] = undo.captured; // null if it was not a capture
  }

  if (move.flags === 'castle-k') {
    if (us === WHITE) { board[5] = null; board[7] = 'R'; } else { board[61] = null; board[63] = 'r'; }
  } else if (move.flags === 'castle-q') {
    if (us === WHITE) { board[3] = null; board[0] = 'R'; } else { board[59] = null; board[56] = 'r'; }
  }
}

function generateLegalMoves(state) {
  const pseudo = generatePseudoMoves(state);
  const us = state.turn;
  const legal = [];
  for (const m of pseudo) {
    const undo = makeMove(state, m);
    if (!inCheck(state, us)) legal.push(m);
    unmakeMove(state, undo);
  }
  return legal;
}

function perft(state, depth) {
  if (depth === 0) return 1;
  const moves = generatePseudoMoves(state);
  const us = state.turn;
  let nodes = 0;
  for (const m of moves) {
    const undo = makeMove(state, m);
    if (!inCheck(state, us)) {
      nodes += depth === 1 ? 1 : perft(state, depth - 1);
    }
    unmakeMove(state, undo);
  }
  return nodes;
}

// Per-root-move breakdown (divide) — handy for debugging perft mismatches.
function perftDivide(state, depth) {
  const moves = generateLegalMoves(state);
  const out = {};
  for (const m of moves) {
    const undo = makeMove(state, m);
    out[m.from + '-' + m.to + (m.promotion || '')] = depth <= 1 ? 1 : perft(state, depth - 1);
    unmakeMove(state, undo);
  }
  return out;
}

module.exports = {
  isSquareAttacked, attacks, attackersOf, findKing, inCheck,
  generatePseudoMoves, generateLegalMoves,
  makeMove, unmakeMove, perft, perftDivide,
};
