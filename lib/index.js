'use strict';

// Public entry point for the rules engine. Pure and I/O-free — the CLI (Level 1)
// and the static webapp (Level 2) both import this verbatim.

const board = require('./board');
const movegen = require('./movegen');
const game = require('./game');
const ai = require('./ai');
const analysis = require('./analysis');
const rng = require('./rng');
const mastery = require('./mastery');
const puzzle = require('./puzzle');
const puzzleBank = require('./puzzle-bank');
const intake = require('./intake');
const activity = require('./activity');

module.exports = {
  Chess: game.Chess,
  // AI ladder + analysis (deterministic, seeded)
  chooseMove: ai.chooseMove,
  makeRng: rng.makeRng,
  analyzeGame: analysis.analyzeGame,
  hangingPieces: analysis.hangingPieces,
  seeOnSquare: analysis.seeOnSquare,
  // Mastery Map + puzzles
  mastery,
  verifyPuzzle: puzzle.verifyPuzzle,
  verifyBank: puzzle.verifyBank,
  puzzleBank: puzzleBank.BANK,
  // Intake assessment (Level 2 required) — pure, grants no % itself
  buildIntakeSet: intake.buildIntakeSet,
  scoreIntake: intake.scoreIntake,
  // Shared puzzle-selection glue (no-repeat-within-10, Silver/Gold interleaving) — one
  // implementation, reused verbatim by the CLI (cli/gym.js) and this webapp.
  activity,
  // low-level pure helpers (for tests, perft harness, and the AI layer)
  START_FEN: board.START_FEN,
  fromFEN: board.fromFEN,
  toFEN: board.toFEN,
  cloneState: board.cloneState,
  algebraic: board.algebraic,
  parseSquare: board.parseSquare,
  perft: movegen.perft,
  perftDivide: movegen.perftDivide,
  generateLegalMoves: movegen.generateLegalMoves,
  generatePseudoMoves: movegen.generatePseudoMoves,
  makeMove: movegen.makeMove,
  unmakeMove: movegen.unmakeMove,
  isSquareAttacked: movegen.isSquareAttacked,
  inCheck: movegen.inCheck,
  moveToSAN: game.moveToSAN,
  repetitionKey: game.repetitionKey,
};
