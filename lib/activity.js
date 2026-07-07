'use strict';

// Shared puzzle-selection glue for BOTH hosts (CLI + webapp) — "one engine, two hosts" doctrine
// (PRODUCT-SPEC §1). Two spec rules live here, once, so neither host can drift from the other:
//   - no-repeat-within-last-10 per station (§5)
//   - Silver/Gold ~20% interleaving from mastered same-wing stations (§2)
// Pure and I/O-free: takes/returns plain data, no console/fs/DOM.

const { BANK } = require('./puzzle-bank');
const M = require('./mastery');
const { makeRng } = require('./rng');

const RUNG_ORDER = { bronze: 1, silver: 2, gold: 3 };

function stationPuzzles(id) { return BANK.filter((p) => p.station === id); }

// Select a set for a rung: prefer that rung's puzzles (harder rungs may borrow easier ones),
// exclude the last 10 seen (spec §5), shuffle deterministically by attempt count.
// rung === null/undefined -> any rung (used by Prove and the intake/exam samplers).
function selectPuzzles(state, id, rung, count) {
  const st = state.stations[id];
  const recent = new Set(st.recent || []);
  const all = stationPuzzles(id);
  const maxRung = rung ? (RUNG_ORDER[rung] || 3) : 3;
  let pool = all.filter((p) => !recent.has(p.id) && (RUNG_ORDER[p.rung] || 1) <= maxRung);
  if (pool.length < count) pool = all.filter((p) => (RUNG_ORDER[p.rung] || 1) <= maxRung); // allow repeats if the pool is small
  if (pool.length === 0) pool = all;
  const rng = makeRng(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + (st.attempts || 0) + (rung ? RUNG_ORDER[rung] * 7 : 0));
  const shuffled = pool.map((p) => ({ p, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.p);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function rememberSeen(state, id, puzzles) {
  const st = state.stations[id];
  st.recent = (st.recent || []).concat(puzzles.map((p) => p.id)).slice(-10);
}

// Record each puzzle against ITS OWN station (interleaved review items belong to theirs, not
// the station being drilled — a puzzle's recency and missed-motif history are per-source-station).
function rememberSeenByStation(state, puzzles) {
  const by = {};
  for (const p of puzzles) { (by[p.station] = by[p.station] || []).push(p); }
  for (const st of Object.keys(by)) rememberSeen(state, st, by[st]);
}

// Build a Drill set for a rung, mixing in ~20% review items from mastered same-wing stations on
// Silver/Gold (spec §2 interleaving; Bronze stays pure so early learning isn't diluted).
// Returns { puzzles, reviewCount }.
function buildDrillSet(state, id, rung, setSize) {
  const station = M.STATION_BY_ID[id];
  let puzzles = selectPuzzles(state, id, rung, setSize);
  let reviewCount = 0;
  if (rung !== 'bronze') {
    const reviewStations = M.wingReviewStations(state, station.wing, id);
    if (reviewStations.length) {
      const nReview = Math.max(1, Math.round(setSize * 0.2));
      const rng = makeRng(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + (state.stations[id].attempts || 0) + 99);
      const pool = reviewStations.flatMap((rid) => stationPuzzles(rid));
      const picks = pool.map((p) => ({ p, k: rng() })).sort((a, b) => a.k - b.k).slice(0, nReview).map((x) => x.p);
      if (picks.length) {
        puzzles = puzzles.slice(0, Math.max(1, puzzles.length - picks.length)).concat(picks);
        reviewCount = picks.length;
      }
    }
  }
  return { puzzles, reviewCount };
}

module.exports = { RUNG_ORDER, stationPuzzles, selectPuzzles, rememberSeen, rememberSeenByStation, buildDrillSet };
