'use strict';

// Pure, I/O-free board primitives: square/piece helpers, state shape, FEN I/O.
// Square index: 0..63, a1=0, h1=7, a8=56, h8=63. index = rank*8 + file (rank 0 = rank "1").

const WHITE = 'w';
const BLACK = 'b';
const FILES = 'abcdefgh';

function fileOf(sq) { return sq & 7; }
function rankOf(sq) { return sq >> 3; }
function makeSquare(file, rank) { return rank * 8 + file; }

function algebraic(sq) { return FILES[fileOf(sq)] + (rankOf(sq) + 1); }

function parseSquare(s) {
  if (typeof s !== 'string' || s.length < 2) return -1;
  const file = FILES.indexOf(s[0]);
  const rank = parseInt(s[1], 10) - 1;
  if (file < 0 || !(rank >= 0 && rank <= 7)) return -1;
  return makeSquare(file, rank);
}

function isWhitePiece(p) { return p >= 'A' && p <= 'Z'; }
function colorOf(p) { return isWhitePiece(p) ? WHITE : BLACK; }
function typeOf(p) { return p.toLowerCase(); }
function opposite(color) { return color === WHITE ? BLACK : WHITE; }

// Square color: 'light' or 'dark' (used for insufficient-material bishop checks).
function squareColor(sq) {
  return ((fileOf(sq) + rankOf(sq)) & 1) === 0 ? 'dark' : 'light';
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// A "state" is a plain object; make/unmake mutate it in place for speed.
//   board:    Array(64) of piece chars ('P','n',...) or null
//   turn:     'w' | 'b'
//   castling: { K, Q, k, q } booleans
//   ep:       en-passant target square index, or -1
//   halfmove: halfmove clock (for 50-move rule)
//   fullmove: fullmove number
function fromFEN(fen) {
  if (typeof fen !== 'string' || fen.trim() === '') {
    throw new Error('Invalid FEN: empty');
  }
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0];
  const turn = parts[1] || 'w';
  const castling = parts[2] || '-';
  const ep = parts[3] || '-';
  const half = parts[4];
  const full = parts[5];

  const board = new Array(64).fill(null);
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error('Invalid FEN: expected 8 ranks');
  for (let r = 0; r < 8; r++) {
    const row = rows[r];
    const rank = 7 - r; // rows[0] is rank 8
    let file = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        file += parseInt(ch, 10);
      } else {
        if ('pnbrqkPNBRQK'.indexOf(ch) < 0) throw new Error('Invalid FEN piece: ' + ch);
        board[makeSquare(file, rank)] = ch;
        file++;
      }
    }
    if (file !== 8) throw new Error('Invalid FEN: rank ' + (rank + 1) + ' wrong length');
  }

  return {
    board,
    turn: turn === 'b' ? BLACK : WHITE,
    castling: {
      K: castling.indexOf('K') >= 0,
      Q: castling.indexOf('Q') >= 0,
      k: castling.indexOf('k') >= 0,
      q: castling.indexOf('q') >= 0,
    },
    ep: ep !== '-' ? parseSquare(ep) : -1,
    halfmove: half !== undefined ? parseInt(half, 10) : 0,
    fullmove: full !== undefined ? parseInt(full, 10) : 1,
  };
}

function toFEN(state) {
  const rows = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = state.board[makeSquare(file, rank)];
      if (p === null) {
        empty++;
      } else {
        if (empty) { row += empty; empty = 0; }
        row += p;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  let c = '';
  if (state.castling.K) c += 'K';
  if (state.castling.Q) c += 'Q';
  if (state.castling.k) c += 'k';
  if (state.castling.q) c += 'q';
  if (c === '') c = '-';
  const ep = state.ep >= 0 ? algebraic(state.ep) : '-';
  return [
    rows.join('/'),
    state.turn,
    c,
    ep,
    state.halfmove,
    state.fullmove,
  ].join(' ');
}

function cloneState(state) {
  return {
    board: state.board.slice(),
    turn: state.turn,
    castling: { K: state.castling.K, Q: state.castling.Q, k: state.castling.k, q: state.castling.q },
    ep: state.ep,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
  };
}

module.exports = {
  WHITE, BLACK, FILES, START_FEN,
  fileOf, rankOf, makeSquare, algebraic, parseSquare,
  isWhitePiece, colorOf, typeOf, opposite, squareColor,
  fromFEN, toFEN, cloneState,
};
