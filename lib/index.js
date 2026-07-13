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
const tournament = require('./tournament');
const matchcode = require('./matchcode');
const gamification = require('./gamification-modules'); // requiring registers the real modules (side effect)

module.exports = {
  Chess: game.Chess,
  // AI ladder + analysis (deterministic, seeded)
  chooseMove: ai.chooseMove,
  makeRng: rng.makeRng,
  // Named AI cast (Phase 4) — deterministic personality variants, reused by CLI and webapp
  listCharacters: ai.listCharacters,
  getCharacter: ai.getCharacter,
  chooseMoveAs: ai.chooseMoveAs,
  pickVoiceLine: ai.pickVoiceLine,
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
  // Tournament structure (Phase 4) — round robin + knockout among named characters
  roundRobin: tournament.roundRobin,
  knockout: tournament.knockout,
  playCharacterGame: tournament.playGame,
  // Generator variants — same logic, yield after each game so a caller (the webapp) can spread
  // a long-running tournament across event-loop ticks instead of freezing the UI thread.
  roundRobinSteps: tournament.roundRobinSteps,
  knockoutSteps: tournament.knockoutSteps,
  // Phase 5: modular gamification registry + event dispatch (gamification-modules.js already
  // required above, so the real modules are registered before any of these are called)
  listModules: gamification.listModules,
  newGamificationSettings: gamification.newSettingsState,
  migrateGamificationSettings: gamification.migrateSettings,
  isModuleEnabled: gamification.isEnabled,
  setModuleEnabled: gamification.setEnabled,
  dispatchGamification: gamification.dispatch,
  // Self-contained async-match codes (spec §4: "compact copy-paste codes in the webapp")
  encodeMatch: matchcode.encodeMatch,
  decodeMatch: matchcode.decodeMatch,
  gameFromCode: matchcode.gameFromCode,
  appendMoveToCode: matchcode.appendMoveToCode,
  newMatchCode: matchcode.newMatchCode,
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
