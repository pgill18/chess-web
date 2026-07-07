'use strict';

// Intake assessment (pure, I/O-free) — PRODUCT-SPEC §2. Optional/stretch at Level 1, REQUIRED
// at Level 2. ~8 minutes: samples Prove-tier items across wings, suggests an entry point, and
// flags stations "likely strong — bank it with a 2-minute Prove". Grants NO % by itself — it
// only produces a recommendation; the player still has to actually Prove to bank anything.

const M = require('./mastery');
const { BANK } = require('./puzzle-bank');
const { makeRng } = require('./rng');

const ITEMS_PER_WING = 2; // 6 wings * 2 = 12 items, ~35-45s each -> ~8 minutes
const STRONG_THRESHOLD = 1.0; // both sampled items correct -> "likely strong" for that station

// Build the ~8-minute item set: sample ITEMS_PER_WING puzzles per wing, spread across stations,
// preferring higher rungs (Prove-tier difficulty) since intake probes capability, not attendance.
function buildIntakeSet(seed) {
  const rng = makeRng(seed || 1);
  const items = [];
  for (const wing of Object.keys(M.WING_WEIGHTS)) {
    const stations = M.wingStations(wing).filter((s) => !M.isArena(s));
    if (stations.length === 0) continue;
    // Round-robin across stations in the wing so ITEMS_PER_WING items land on different stations
    // where possible (broad sampling beats depth on any one station for placement purposes).
    const order = stations.map((s) => ({ s, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.s);
    let picked = 0;
    for (let i = 0; picked < ITEMS_PER_WING && i < order.length * 3; i++) {
      const station = order[i % order.length];
      const all = BANK.filter((p) => p.station === station.id);
      // Prefer the hardest rung available (Prove-tier probes capability) but don't skip a
      // station just because it has no gold/silver content yet (e.g. bronze-only wings) —
      // fall back to whatever exists so every wing still gets sampled.
      const RUNG_RANK = { gold: 3, silver: 2, bronze: 1 };
      let best = 0;
      for (const p of all) best = Math.max(best, RUNG_RANK[p.rung] || 0);
      const pool = all.filter((p) => (RUNG_RANK[p.rung] || 0) === best);
      if (pool.length === 0) continue;
      const item = pool[rng.int(pool.length)];
      if (items.some((it) => it.id === item.id)) continue;
      items.push(item);
      picked++;
    }
  }
  return items;
}

// Score a completed intake: answers = [{id, correct: bool}] in the same order as buildIntakeSet.
// Returns { perStation: {id: {correct,total}}, perWing: {w: {correct,total}},
//           suggestedEntry: wingCode, strongStations: [id], text }.
function scoreIntake(items, answers) {
  const perStation = {};
  const perWing = {};
  answers.forEach((a, i) => {
    const item = items[i];
    if (!item) return;
    const st = (perStation[item.station] = perStation[item.station] || { correct: 0, total: 0 });
    st.total++; if (a.correct) st.correct++;
    const w = (perWing[item.station.charAt(0)] = perWing[item.station.charAt(0)] || { correct: 0, total: 0 });
    w.total++; if (a.correct) w.correct++;
  });

  // Suggested entry point: weakest wing by sampled accuracy (ties broken by spec wing order).
  // Arena is excluded — it's milestone-based (finish/win games), not puzzle-probed by intake, so
  // it would always look "unsampled = weakest" and wrongly dominate every result.
  const wingOrder = Object.keys(M.WING_WEIGHTS).filter((w) => w !== 'A');
  let suggestedEntry = wingOrder[0];
  let worstRate = Infinity;
  for (const w of wingOrder) {
    const s = perWing[w];
    const rate = s && s.total ? s.correct / s.total : 0; // unsampled wing = assume weakest (0)
    if (rate < worstRate) { worstRate = rate; suggestedEntry = w; }
  }

  const strongStations = Object.keys(perStation)
    .filter((id) => perStation[id].total > 0 && (perStation[id].correct / perStation[id].total) >= STRONG_THRESHOLD);

  const lines = [
    `Intake complete — suggested entry point: ${suggestedEntry} · ${M.WINGS[suggestedEntry].name}.`,
  ];
  if (strongStations.length) {
    lines.push(`Likely strong — bank these with a 2-minute Prove: ${strongStations.join(', ')}.`);
  }
  lines.push('This grants no % by itself — Learn/Drill/Prove still earn your map, honestly.');

  return { perStation, perWing, suggestedEntry, strongStations, text: lines.join(' ') };
}

module.exports = { buildIntakeSet, scoreIntake, ITEMS_PER_WING };
