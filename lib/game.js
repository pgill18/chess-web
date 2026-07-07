'use strict';

// Pure, I/O-free high-level engine: SAN/UCI, check/mate/stalemate, draw rules,
// history + threefold, teaching illegal-move errors. The CLI and webapp both wrap this.

const B = require('./board');
const {
  WHITE, BLACK, FILES, START_FEN, fileOf, rankOf, makeSquare, algebraic,
  parseSquare, colorOf, typeOf, opposite, squareColor, fromFEN, toFEN, cloneState,
} = B;
const MG = require('./movegen');
const {
  isSquareAttacked, attacks, findKing, inCheck, generatePseudoMoves, generateLegalMoves,
  makeMove, unmakeMove, perft,
} = MG;

const PIECE_NAMES = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

function sameMove(a, b) {
  return a.from === b.from && a.to === b.to && (a.promotion || null) === (b.promotion || null);
}

// SAN for a move, computed against `state` BEFORE the move is made.
function moveToSAN(state, move) {
  let san;
  if (move.flags === 'castle-k') san = 'O-O';
  else if (move.flags === 'castle-q') san = 'O-O-O';
  else {
    const piece = state.board[move.from];
    const t = typeOf(piece);
    const isCapture = state.board[move.to] !== null || move.flags === 'ep';
    if (t === 'p') {
      san = '';
      if (isCapture) san += FILES[fileOf(move.from)] + 'x';
      san += algebraic(move.to);
      if (move.promotion) san += '=' + move.promotion.toUpperCase();
    } else {
      san = t.toUpperCase() + disambiguation(state, move) + (isCapture ? 'x' : '') + algebraic(move.to);
    }
  }
  return san + checkSuffix(state, move);
}

function disambiguation(state, move) {
  const piece = state.board[move.from];
  const others = generateLegalMoves(state).filter(
    (m) => m.to === move.to && m.from !== move.from && state.board[m.from] === piece,
  );
  if (others.length === 0) return '';
  let sameFile = false, sameRank = false;
  for (const o of others) {
    if (fileOf(o.from) === fileOf(move.from)) sameFile = true;
    if (rankOf(o.from) === rankOf(move.from)) sameRank = true;
  }
  if (!sameFile) return FILES[fileOf(move.from)];
  if (!sameRank) return String(rankOf(move.from) + 1);
  return FILES[fileOf(move.from)] + String(rankOf(move.from) + 1);
}

function checkSuffix(state, move) {
  const undo = makeMove(state, move);
  const them = state.turn;
  let suffix = '';
  if (inCheck(state, them)) suffix = generateLegalMoves(state).length === 0 ? '#' : '+';
  unmakeMove(state, undo);
  return suffix;
}

// Repetition key per spec: placement + side to move + castling rights + ep file.
function repetitionKey(state) {
  const placement = toFEN(state).split(' ')[0];
  let c = '';
  if (state.castling.K) c += 'K';
  if (state.castling.Q) c += 'Q';
  if (state.castling.k) c += 'k';
  if (state.castling.q) c += 'q';
  if (c === '') c = '-';
  const epFile = state.ep >= 0 ? FILES[fileOf(state.ep)] : '-';
  return `${placement} ${state.turn} ${c} ${epFile}`;
}

// Insufficient material: KvK, K(minor)vK, and same-colored bishops only.
function insufficientMaterial(state) {
  const minors = []; // squares of bishops/knights
  for (let sq = 0; sq < 64; sq++) {
    const p = state.board[sq];
    if (p === null) continue;
    const t = typeOf(p);
    if (t === 'k') continue;
    if (t === 'p' || t === 'r' || t === 'q') return false; // mating material present
    minors.push({ t, sq });
  }
  if (minors.length === 0) return true;              // K vs K
  if (minors.length === 1) return true;              // K+minor vs K
  // Only bishops, all on the same square color -> no mate possible.
  if (minors.every((m) => m.t === 'b')) {
    const colors = new Set(minors.map((m) => squareColor(m.sq)));
    if (colors.size === 1) return true;
  }
  return false;
}

// Name one enemy piece giving check to `color`'s king (for teaching messages).
function checkingPiece(state, color) {
  const ksq = findKing(state, color);
  const them = opposite(color);
  for (let sq = 0; sq < 64; sq++) {
    const p = state.board[sq];
    if (p === null || colorOf(p) !== them) continue;
    // Does this single piece attack the king? Temporarily blank the rest is overkill;
    // re-use ray/step logic by checking a board with only this piece + king is unnecessary —
    // isSquareAttacked already accounts for blockers, so test attack from this square directly.
    if (attacks(state, sq, ksq)) {
      return { alg: algebraic(sq), name: PIECE_NAMES[typeOf(p)] };
    }
  }
  return null;
}

class Chess {
  constructor(fen = START_FEN) {
    this.state = fromFEN(fen);
    this._history = []; // { undo, san, before (fen) }
    this._repetitions = Object.create(null);
    this._repetitions[repetitionKey(this.state)] = 1;
  }

  fen() { return toFEN(this.state); }
  turn() { return this.state.turn; }
  get(square) { const sq = parseSquare(square); return sq < 0 ? null : this.state.board[sq]; }

  // 8x8 array (rank 8 first) of piece chars / null — convenience for renderers.
  board() {
    const out = [];
    for (let rank = 7; rank >= 0; rank--) {
      const row = [];
      for (let file = 0; file < 8; file++) row.push(this.state.board[makeSquare(file, rank)]);
      out.push(row);
    }
    return out;
  }

  legalMoves() { return generateLegalMoves(this.state); }

  // moves() -> SAN strings; moves({verbose:true}) -> objects with from/to/san/flags.
  moves(opts = {}) {
    let list = generateLegalMoves(this.state);
    if (opts.square !== undefined) {
      const sq = parseSquare(opts.square);
      list = list.filter((m) => m.from === sq);
    }
    if (opts.verbose) {
      return list.map((m) => ({
        from: algebraic(m.from),
        to: algebraic(m.to),
        promotion: m.promotion || null,
        flags: m.flags,
        san: moveToSAN(this.state, m),
        piece: this.state.board[m.from],
      }));
    }
    return list.map((m) => moveToSAN(this.state, m));
  }

  // Resolve any accepted input form to a legal move object, or null.
  _resolve(input) {
    return this._matchMove(input, generateLegalMoves(this.state));
  }

  // Match an input (object {from,to,promotion} | UCI coords | SAN) against a move list.
  _matchMove(input, moves) {
    if (input && typeof input === 'object') {
      const from = parseSquare(input.from);
      const to = parseSquare(input.to);
      const promotion = input.promotion ? input.promotion.toLowerCase() : null;
      return moves.find((m) => m.from === from && m.to === to && (m.promotion || null) === promotion) || null;
    }
    const raw = String(input).trim();
    // UCI coordinates (forgiving fallback): e2e4, e7e8q
    const uci = raw.match(/^([a-h][1-8])([a-h][1-8])([qrbnQRBN])?$/);
    if (uci) {
      const from = parseSquare(uci[1]);
      const to = parseSquare(uci[2]);
      const promotion = uci[3] ? uci[3].toLowerCase() : null;
      const m = moves.find((mm) => mm.from === from && mm.to === to
        && (mm.promotion || null) === (promotion || (mm.promotion ? 'q' : null)));
      if (m) return m;
      return moves.find((mm) => mm.from === from && mm.to === to && (mm.promotion || null) === promotion) || null;
    }
    // SAN: match against generated SAN (with and without check/annotation decorations)
    const norm = (s) => s.replace(/[+#!?]+$/, '').replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');
    const target = norm(raw);
    for (const m of moves) {
      if (norm(moveToSAN(this.state, m)) === target) return m;
    }
    return null;
  }

  // Apply a move. Returns a verbose move record. Throws Error with a teaching message if illegal.
  move(input) {
    const resolved = this._resolve(input);
    if (!resolved) throw new Error(this._explainIllegal(input));
    const before = this.fen();
    const san = moveToSAN(this.state, resolved);
    const undo = makeMove(this.state, resolved);
    const key = repetitionKey(this.state);
    this._repetitions[key] = (this._repetitions[key] || 0) + 1;
    this._history.push({ undo, san, before });
    return {
      from: algebraic(resolved.from),
      to: algebraic(resolved.to),
      promotion: resolved.promotion || null,
      flags: resolved.flags,
      san,
      before,
      after: this.fen(),
    };
  }

  undo() {
    const last = this._history.pop();
    if (!last) return null;
    const key = repetitionKey(this.state);
    this._repetitions[key]--;
    if (this._repetitions[key] <= 0) delete this._repetitions[key];
    unmakeMove(this.state, last.undo);
    return last.san;
  }

  // Explain WHY a castling attempt is illegal (rights / path / check / through-check).
  _explainCastle(kingside) {
    const us = this.state.turn;
    const them = opposite(us);
    const c = this.state.castling;
    const rights = us === WHITE ? (kingside ? c.K : c.Q) : (kingside ? c.k : c.q);
    const name = kingside ? 'kingside (O-O)' : 'queenside (O-O-O)';
    if (!rights) return `You can't castle ${name}: the king or that rook has already moved (or the rook was captured), so the right is gone.`;
    if (inCheck(this.state, us)) return `You can't castle ${name}: you may not castle out of check — deal with the check first.`;
    const betweens = kingside ? (us === WHITE ? [5, 6] : [61, 62]) : (us === WHITE ? [1, 2, 3] : [57, 58, 59]);
    for (const sq of betweens) {
      if (this.state.board[sq] !== null) return `You can't castle ${name} yet: the ${PIECE_NAMES[typeOf(this.state.board[sq])]} on ${algebraic(sq)} is between your king and rook — clear the path first.`;
    }
    const transit = kingside ? (us === WHITE ? [5, 6] : [61, 62]) : (us === WHITE ? [2, 3] : [58, 59]);
    for (const sq of transit) {
      if (isSquareAttacked(this.state, sq, them)) return `You can't castle ${name}: your king would pass through ${algebraic(sq)}, which is attacked — the king may not castle through check.`;
    }
    return `You can't castle ${name} right now.`;
  }

  _explainIllegal(input) {
    // Best-effort teaching message. Falls back to a plain statement.
    if (typeof input === 'string') {
      const c = input.trim().replace(/0/g, 'O');
      if (c === 'O-O-O') return this._explainCastle(false);
      if (c === 'O-O') return this._explainCastle(true);
    }
    const pseudoAll = generatePseudoMoves(this.state);
    let from = -1, to = -1, promotion = null;
    if (input && typeof input === 'object') {
      from = parseSquare(input.from); to = parseSquare(input.to);
      promotion = input.promotion ? input.promotion.toLowerCase() : null;
    } else {
      const raw = String(input).trim();
      const uci = raw.match(/^([a-h][1-8])([a-h][1-8])([qrbnQRBN])?$/);
      if (uci) { from = parseSquare(uci[1]); to = parseSquare(uci[2]); promotion = uci[3] ? uci[3].toLowerCase() : null; }
      else {
        // Try to recover the intended move from the pseudo-legal SAN set.
        const intended = this._matchMove(input, pseudoAll);
        if (intended) { from = intended.from; to = intended.to; promotion = intended.promotion || null; }
      }
    }
    if (from < 0 || to < 0) {
      // Couldn't tie it to a specific piece — give an honest, legal-move-pointing fallback.
      const raw = String(input).trim();
      const dm = raw.match(/([a-h][1-8])[+#]?$/);
      const side = this.state.turn === WHITE ? 'White' : 'Black';
      if (dm) {
        return `${raw} isn't legal here — no ${side} piece can move to ${dm[1]} that way. Type "moves" to see the legal moves.`;
      }
      return `"${input}" is not a move I understand here (try coordinates like e2e4, or SAN like Nf3). Type "moves" to list legal moves.`;
    }

    const piece = this.state.board[from];
    if (piece === null) return `There is no piece on ${algebraic(from)}.`;
    if (colorOf(piece) !== this.state.turn) {
      return `The ${PIECE_NAMES[typeOf(piece)]} on ${algebraic(from)} is not yours to move — it's ${this.state.turn === WHITE ? 'White' : 'Black'} to play.`;
    }

    const pseudo = pseudoAll.filter((m) => m.from === from && m.to === to
      && (promotion ? (m.promotion || null) === promotion : true));
    if (pseudo.length === 0) {
      return `The ${PIECE_NAMES[typeOf(piece)]} on ${algebraic(from)} cannot move to ${algebraic(to)}.`;
    }
    // Pseudo-legal but leaves own king in check.
    const m = pseudo[0];
    const undo = makeMove(this.state, m);
    const attacker = checkingPiece(this.state, this.state.turn === WHITE ? BLACK : WHITE);
    unmakeMove(this.state, undo);
    const label = typeOf(piece) === 'p' ? algebraic(to) : PIECE_NAMES[typeOf(piece)] + algebraic(to);
    if (attacker) {
      return `${label} is illegal here: your king would be in check from the ${attacker.name} on ${attacker.alg}.`;
    }
    return `${label} is illegal here: it would leave your king in check.`;
  }

  // ---- status ----
  inCheck() { return inCheck(this.state, this.state.turn); }
  isCheckmate() { return this.inCheck() && generateLegalMoves(this.state).length === 0; }
  isStalemate() { return !this.inCheck() && generateLegalMoves(this.state).length === 0; }
  isInsufficientMaterial() { return insufficientMaterial(this.state); }
  isThreefoldRepetition() { return (this._repetitions[repetitionKey(this.state)] || 0) >= 3; }
  isFiftyMoveRule() { return this.state.halfmove >= 100; }

  isDraw() {
    return this.isStalemate() || this.isInsufficientMaterial()
      || this.isThreefoldRepetition() || this.isFiftyMoveRule();
  }

  drawReason() {
    if (this.isStalemate()) return 'stalemate';
    if (this.isInsufficientMaterial()) return 'insufficient material';
    if (this.isThreefoldRepetition()) return 'threefold repetition';
    if (this.isFiftyMoveRule()) return 'fifty-move rule';
    return null;
  }

  isGameOver() { return this.isCheckmate() || this.isDraw(); }

  result() {
    if (this.isCheckmate()) return this.state.turn === WHITE ? '0-1' : '1-0';
    if (this.isDraw()) return '1/2-1/2';
    return null;
  }

  // One-line status summary, e.g. "Checkmate — Black wins" / "Draw — stalemate".
  status() {
    if (this.isCheckmate()) {
      return { over: true, reason: 'checkmate', result: this.result(), text: `Checkmate — ${this.state.turn === WHITE ? 'Black' : 'White'} wins` };
    }
    if (this.isDraw()) {
      const r = this.drawReason();
      return { over: true, reason: r, result: '1/2-1/2', text: `Draw — ${r}` };
    }
    if (this.inCheck()) {
      return { over: false, reason: 'check', result: null, text: `${this.state.turn === WHITE ? 'White' : 'Black'} is in check` };
    }
    return { over: false, reason: null, result: null, text: `${this.state.turn === WHITE ? 'White' : 'Black'} to move` };
  }

  history(opts = {}) {
    if (opts.verbose) return this._history.map((h) => ({ san: h.san, before: h.before }));
    return this._history.map((h) => h.san);
  }

  perft(depth) { return perft(cloneState(this.state), depth); }

  clone() {
    const c = new Chess(this.fen());
    return c;
  }
}

module.exports = { Chess, moveToSAN, repetitionKey, insufficientMaterial };
