'use strict';

// Round-robin + knockout tournament structure for the named AI cast (Phase 4, PRODUCT-SPEC §8).
// Pure, deterministic: every game between two characters is itself a full deterministic
// character-vs-character game (chooseMoveAs driving both sides with distinct, derived seeds), so
// an entire tournament replays byte-identical given the same master seed and participant list.

const { Chess } = require('./game');
const { chooseMoveAs } = require('./ai');
const { makeRng } = require('./rng');
const { algebraic } = require('./board');

// A real game length (safety net, not a target) — 16 plies (8 full moves) made EVERY game in a
// live tournament run hit the cap and draw, so standings were decided by tiebreak alone rather
// than actual chess skill (spec §8 wants standings that mean something). 120 plies is enough for
// real checkmate/repetition/50-move/insufficient-material resolution in the vast majority of
// games between these characters. Wall-clock cost (quiescence characters run ~2-3s/move) is the
// accepted tradeoff — deliberately NOT reducing search depth/quiescence for tournament games
// specifically, since that would make a character play a weaker version of itself in a
// tournament than in `play rival`, breaking the "one real identity per character" principle.
const MAX_PLIES = 120;

function seedFor(masterSeed, tag) {
  let h = (masterSeed >>> 0) || 1;
  for (const ch of String(tag)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return h || 1;
}

// Generator form of a single game: yields { plies } after EVERY move (not just at game end), so
// a caller (roundRobinSteps/knockoutSteps below) can let the browser repaint/respond between
// individual moves, not only between whole games. A single move against a quiescence character
// still costs ~2-3s of synchronous search — that part isn't interruptible without touching
// lib/ai.js's reviewed search/quiescence recursion — but yielding every ply (rather than only
// every game, which could be 30-90+s of unbroken blocking) is the fix for #86: the tab was
// unresponsive for an ENTIRE tournament run because the old per-game generator gave the event
// loop no chance to run until each full game finished.
function* playGameSteps(white, black, masterSeed, gameTag) {
  const g = new Chess();
  const rngW = makeRng(seedFor(masterSeed, gameTag + ':w:' + white));
  const rngB = makeRng(seedFor(masterSeed, gameTag + ':b:' + black));
  let plies = 0;
  while (!g.isGameOver() && plies < MAX_PLIES) {
    const turnChar = g.turn() === 'w' ? white : black;
    const rng = g.turn() === 'w' ? rngW : rngB;
    const m = chooseMoveAs(g.state, turnChar, rng);
    if (!m) break;
    g.move({ from: algebraic(m.from), to: algebraic(m.to), promotion: m.promotion });
    plies++;
    yield { plies };
  }
  const result = g.isCheckmate() ? (g.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2';
  return { result, plies };
}

// Play one full deterministic game: `white`/`black` are character keys. Returns {result, plies}.
// result: '1-0' | '0-1' | '1/2-1/2'. Thin drain of playGameSteps — one source of truth for the
// move loop, same pattern as roundRobin/knockout draining their *Steps generators below.
function playGame(white, black, masterSeed, gameTag) {
  const gen = playGameSteps(white, black, masterSeed, gameTag);
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

function pointsFor(result, side) {
  if (result === '1/2-1/2') return 0.5;
  if (side === 'w') return result === '1-0' ? 1 : 0;
  return result === '0-1' ? 1 : 0;
}

function applyResult(standings, white, black, result) {
  const wp = pointsFor(result, 'w'), bp = pointsFor(result, 'b');
  const sw = standings[white], sb = standings[black];
  sw.played++; sb.played++;
  sw.points += wp; sb.points += bp;
  if (result === '1/2-1/2') { sw.draws++; sb.draws++; }
  else if (result === '1-0') { sw.wins++; sb.losses++; }
  else { sb.wins++; sw.losses++; }
}

function rankStandings(standings) {
  return Object.keys(standings)
    .map((key) => Object.assign({ key }, standings[key]))
    .sort((a, b) => b.points - a.points || b.wins - a.wins || a.key.localeCompare(b.key));
}

// All-play-all once. Standings: 1 point win / 0.5 draw / 0 loss (standard chess scoring).
// Drains its own generator (roundRobinSteps, defined below) rather than re-implementing the
// pairing loop — ONE orchestration for both the synchronous (CLI) and stepped (webapp) forms, so
// a future change to pairing order can't make the two hosts silently diverge (otis's #74 note).
function roundRobin(participants, masterSeed) {
  for (const step of roundRobinSteps(participants, masterSeed)) {
    if (step.type === 'done') return { games: step.games, standings: step.standings };
  }
}

// Single-elimination knockout. `seededOrder` = participants ranked best-to-worst (e.g. from a
// prior round-robin); an odd participant count gives the last-listed (weakest) seed a bye. Drains
// its own generator (knockoutSteps, defined below) for the same one-orchestration reason.
function knockout(seededOrder, masterSeed) {
  for (const step of knockoutSteps(seededOrder, masterSeed)) {
    if (step.type === 'done') return { rounds: step.rounds, champion: step.champion };
  }
}

// Generator variants of roundRobin/knockout — same pairing/scoring/bracket logic (they call the
// exact same playGameSteps/applyResult/rankStandings helpers above), but yield control after
// EVERY MOVE, not just after each game (see playGameSteps above for why: a single game between
// quiescence characters can itself run 30-90+s synchronously, so a per-game-only yield left the
// tab unresponsive for the whole run — #86). A full tournament can take minutes wall-clock; a
// synchronous run is fine for the CLI (blocking a script is normal) but would freeze a browser
// tab. The webapp drives these generators with a setTimeout(0) between .next() calls to yield to
// the render loop; the CLI's roundRobin/knockout above are UNCHANGED (zero risk to
// already-reviewed code) — nothing requires a caller to use the generator form.
//
// Yields: { type: 'ply', white, black, plies, ... } after each move within a game (for
// responsiveness only — callers should not log every one), { type: 'game', white, black, result,
// plies, ... } once a game finishes (knockout also includes `winner`/`bye`), then a final
// { type: 'done', ... } with the same shape roundRobin/knockout return synchronously.
function* roundRobinSteps(participants, masterSeed) {
  const standings = {};
  for (const p of participants) standings[p] = { played: 0, wins: 0, draws: 0, losses: 0, points: 0 };
  const games = [];
  const totalGames = (participants.length * (participants.length - 1)) / 2;
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const white = participants[i], black = participants[j];
      const gen = playGameSteps(white, black, masterSeed, `rr:${white}-vs-${black}`);
      let r = gen.next();
      while (!r.done) { yield { type: 'ply', white, black, plies: r.value.plies, gameIndex: games.length + 1, totalGames }; r = gen.next(); }
      const { result, plies } = r.value;
      const game = { white, black, result, plies };
      games.push(game);
      applyResult(standings, white, black, result);
      yield { type: 'game', ...game, gameIndex: games.length, totalGames };
    }
  }
  yield { type: 'done', games, standings: rankStandings(standings) };
}

function* knockoutSteps(seededOrder, masterSeed) {
  let round = seededOrder.slice();
  const rounds = [];
  let roundNum = 1;
  while (round.length > 1) {
    const next = [];
    const matches = [];
    for (let i = 0; i < round.length; i += 2) {
      if (i + 1 >= round.length) { const m = { bye: round[i] }; next.push(round[i]); matches.push(m); yield { type: 'game', round: roundNum, ...m }; continue; }
      const white = round[i], black = round[i + 1];
      const tag = `ko:r${roundNum}:${white}-vs-${black}`;
      const gen = playGameSteps(white, black, masterSeed, tag);
      let r = gen.next();
      while (!r.done) { yield { type: 'ply', round: roundNum, white, black, plies: r.value.plies }; r = gen.next(); }
      const result = r.value.result, plies = r.value.plies;
      let winner;
      if (result === '1-0') winner = white;
      else if (result === '0-1') winner = black;
      else {
        const tbGen = playGameSteps(black, white, masterSeed, tag + ':tiebreak');
        let r2 = tbGen.next();
        while (!r2.done) { yield { type: 'ply', round: roundNum, white, black, tiebreak: true, plies: r2.value.plies }; r2 = tbGen.next(); }
        if (r2.value.result === '0-1') winner = white;
        else if (r2.value.result === '1-0') winner = black;
        else winner = white;
      }
      const m = { white, black, result, plies, winner };
      matches.push(m);
      next.push(winner);
      yield { type: 'game', round: roundNum, ...m };
    }
    rounds.push(matches);
    round = next;
    roundNum++;
  }
  yield { type: 'done', rounds, champion: round[0] };
}

module.exports = { playGame, playGameSteps, roundRobin, knockout, roundRobinSteps, knockoutSteps, MAX_PLIES };
