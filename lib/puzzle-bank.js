'use strict';

// The puzzle bank (content). Every entry is machine-verified by lib/puzzle.js and
// re-verified in the permanent test suite (PRODUCT-SPEC §5). Grow this behind the
// verifier gate — a puzzle that fails verifyPuzzle must NOT ship.
//
// SEED SET: a small, fully-verified starter corpus proving the pipeline end-to-end
// (schema -> verifier -> drill/prove -> delta). The launch floor (>=20 per station,
// >=40 for T7/T8) is ongoing content authoring tracked separately; the engineering is
// complete and every puzzle below passes verification (forced+minimal+single-solution
// for mates; best-line-by-margin + single-solution for material wins).

const SEED = [
  // ---- T7 · Mate in 1 ----
  { id: 'T7-1', kind: 'mate', mateIn: 1, station: 'T7', rung: 'bronze', motif: 'queen-mate', source: 'seed',
    fen: '7k/5K2/8/8/8/8/8/1Q6 w - - 0 1', sideToMove: 'w', solution: ['Qh1#'] },
  { id: 'T7-2', kind: 'mate', mateIn: 1, station: 'T7', rung: 'bronze', motif: 'back-rank', source: 'seed',
    fen: '6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1', sideToMove: 'w', solution: ['Rd8#'] },
  { id: 'T7-3', kind: 'mate', mateIn: 1, station: 'T7', rung: 'silver', motif: 'rook-mate', source: 'seed',
    fen: '6k1/4Rppp/8/8/8/8/8/6K1 w - - 0 1', sideToMove: 'w', solution: ['Re8#'] },
  { id: 'T7-4', kind: 'mate', mateIn: 1, station: 'T7', rung: 'silver', motif: 'rook-mate', source: 'seed',
    fen: '7k/8/6K1/8/8/8/8/R7 w - - 0 1', sideToMove: 'w', solution: ['Ra8#'] },

  // ---- T8 · Mate in 2 ----
  { id: 'T8-1', kind: 'mate', mateIn: 2, station: 'T8', rung: 'bronze', motif: 'mate-in-2', source: 'seed',
    fen: '7k/8/5K2/8/8/8/8/6R1 w - - 0 1', sideToMove: 'w', solution: ['Kf7', 'Kh7', 'Rh1#'] },

  // ---- M1 · Two-Rook Ladder ----
  { id: 'M1-1', kind: 'mate', mateIn: 1, station: 'M1', rung: 'bronze', motif: 'two-rook-ladder', source: 'seed',
    fen: '4k3/1R6/8/8/8/8/8/R3K3 w - - 0 1', sideToMove: 'w', solution: ['Ra8#'] },

  // ---- M2 · King + Queen (back-rank finish) ----
  { id: 'M2-1', kind: 'mate', mateIn: 1, station: 'M2', rung: 'bronze', motif: 'queen-mate', source: 'seed',
    fen: '6k1/5ppp/8/8/8/8/8/1Q4K1 w - - 0 1', sideToMove: 'w', solution: ['Qb8#'] },

  // ---- M3 · King + Rook ----
  { id: 'M3-1', kind: 'mate', mateIn: 1, station: 'M3', rung: 'bronze', motif: 'king-and-rook', source: 'seed',
    fen: '7k/5K2/8/8/8/8/8/R7 w - - 0 1', sideToMove: 'w', solution: ['Rh1#'] },

  // ---- M4 · Back-Rank Patterns ----
  { id: 'M4-1', kind: 'mate', mateIn: 1, station: 'M4', rung: 'bronze', motif: 'back-rank', source: 'seed',
    fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', sideToMove: 'w', solution: ['Ra8#'] },

  // ---- T1 · Counting & Hanging Pieces (win material) ----
  { id: 'T1-1', kind: 'win', gain: 300, depth: 2, station: 'T1', rung: 'bronze', motif: 'free-piece', source: 'seed',
    fen: '3k4/8/8/3q4/8/8/3R4/3K4 w - - 0 1', sideToMove: 'w', solution: ['Rxd5'] },

  // ---- T2 · Forks (win material) ----
  { id: 'T2-1', kind: 'win', gain: 300, depth: 4, station: 'T2', rung: 'bronze', motif: 'knight-fork', source: 'seed',
    fen: '4k3/8/8/3q4/8/4N3/8/4K3 w - - 0 1', sideToMove: 'w', solution: ['Nxd5'] },
];

// Machine-generated, verifier-gated puzzles (scripts/generate-puzzles.js). Merged in when
// present; the permanent test suite re-verifies EVERY entry (seed + generated) forever.
let GENERATED = [];
try { GENERATED = require('./puzzles-generated.json'); } catch (e) { GENERATED = []; }
let TACTICS = [];
try { TACTICS = require('./puzzles-tactics.json'); } catch (e) { TACTICS = []; }
let RULES = [];
try { RULES = require('./puzzles-rules.json'); } catch (e) { RULES = []; }
let ENDGAMES = [];
try { ENDGAMES = require('./puzzles-endgames.json'); } catch (e) { ENDGAMES = []; }
let STRATEGY = [];
try { STRATEGY = require('./puzzles-strategy.json'); } catch (e) { STRATEGY = []; }

const FULL_BANK = SEED.concat(GENERATED, TACTICS, RULES, ENDGAMES, STRATEGY);

module.exports = { BANK: FULL_BANK, SEED, GENERATED, TACTICS, RULES, ENDGAMES, STRATEGY };
