'use strict';

// The Mastery Map — pure, I/O-free data model + math. The CLI and the future webapp
// both drive this; persistence (data/ JSON, localStorage) is the host's job.
//
// Three non-negotiable invariants (PRODUCT-SPEC §2):
//   1. 90/100 rule: Learn/Bronze/Silver/Gold sum caps at 90; only Prove sets 100.
//   2. Monotonic: earned % never decreases.
//   3. Delta rule: every completed activity reports before -> after (enforced by callers
//      via computeDelta / formatDelta; no activity ends numberless).

// Component seed weights within a station (sum = 90; Prove lifts to 100).
const COMPONENT_WEIGHTS = { learn: 20, bronze: 20, silver: 25, gold: 25 };
const PRE_PROVE_CAP = 90;
const RUNGS = ['learn', 'bronze', 'silver', 'gold'];

// Wing weights toward overall Chess Mastery % (sum = 100).
const WING_WEIGHTS = { R: 15, M: 15, T: 30, E: 15, S: 10, A: 15 };

// Wings & stations (seed set — PRODUCT-SPEC §3). Prereqs are SOFT (a notice, never a lock).
const WINGS = {
  R: { name: 'The Rulebook' },
  M: { name: 'The Mate Room' },
  T: { name: 'The Tactics Floor' },
  E: { name: 'The Endgame Room' },
  S: { name: 'The Strategy Studio' },
  A: { name: 'The Arena' },
};

const STATIONS = [
  // R — The Rulebook
  { id: 'R1', wing: 'R', name: 'Board & Pawns', prereqs: [] },
  { id: 'R2', wing: 'R', name: 'The Pieces', prereqs: ['R1'] },
  { id: 'R3', wing: 'R', name: 'Special Moves', prereqs: ['R2'] },
  { id: 'R4', wing: 'R', name: 'Check, Escape, Mate', prereqs: ['R2'] },
  { id: 'R5', wing: 'R', name: 'Reading the Game', prereqs: ['R4'] },
  // M — The Mate Room
  { id: 'M1', wing: 'M', name: 'Two-Rook Ladder', prereqs: ['R4'] },
  { id: 'M2', wing: 'M', name: 'King + Queen', prereqs: ['M1'] },
  { id: 'M3', wing: 'M', name: 'King + Rook', prereqs: ['M2'] },
  { id: 'M4', wing: 'M', name: 'Back-Rank Patterns', prereqs: ['R4'] },
  { id: 'M5', wing: 'M', name: 'Traps & Punishments', prereqs: ['M4'] },
  // T — The Tactics Floor
  { id: 'T1', wing: 'T', name: 'Counting & Hanging Pieces', prereqs: ['R2'] },
  { id: 'T2', wing: 'T', name: 'Forks', prereqs: ['T1'] },
  { id: 'T3', wing: 'T', name: 'Pins', prereqs: ['T1'] },
  { id: 'T4', wing: 'T', name: 'Skewers', prereqs: ['T3'] },
  { id: 'T5', wing: 'T', name: 'Discovered & Double Attacks', prereqs: ['T2'] },
  { id: 'T6', wing: 'T', name: 'Remove the Defender / Overloading', prereqs: ['T1'] },
  { id: 'T7', wing: 'T', name: 'Mate in 1', prereqs: ['R4'] },
  { id: 'T8', wing: 'T', name: 'Mate in 2', prereqs: ['T7'] },
  // E — The Endgame Room
  { id: 'E1', wing: 'E', name: 'King Activity & Opposition', prereqs: ['R2'] },
  { id: 'E2', wing: 'E', name: 'The Square Rule & Pawn Races', prereqs: ['E1'] },
  { id: 'E3', wing: 'E', name: 'K+P vs K technique', prereqs: ['E1'] },
  { id: 'E4', wing: 'E', name: 'Rook-Endgame Starter Kit', prereqs: ['E3'] },
  // S — The Strategy Studio
  { id: 'S1', wing: 'S', name: 'Opening Principles', prereqs: ['R2'] },
  { id: 'S2', wing: 'S', name: 'Weak Squares & Outposts', prereqs: ['S1'] },
  { id: 'S3', wing: 'S', name: 'Pawn Structure Basics', prereqs: ['S1'] },
  // A — The Arena (milestone checklists; % = milestones done / total)
  { id: 'A1', wing: 'A', name: 'First Steps', prereqs: [], milestones: ['finish a game vs L1', 'win vs L1', 'win as Black'] },
  { id: 'A2', wing: 'A', name: 'The Ladder', prereqs: ['A1'], milestones: ['beat AI L2', 'beat AI L3', 'beat AI L4', 'beat AI L5'] },
  { id: 'A3', wing: 'A', name: 'The Long Game', prereqs: ['A1'], milestones: ['win by checkmate', '0-blunder game', 'claim/receive a threefold or 50-move draw'] },
  { id: 'A4', wing: 'A', name: 'Head to Head', prereqs: ['A1'], milestones: ['finish an async match', 'win an async match'] },
];

const STATION_BY_ID = Object.fromEntries(STATIONS.map((s) => [s.id, s]));
const REFRESHER_DAYS = 14;

function isArena(station) { return station.wing === 'A'; }

// A fresh, empty user state. Same shape the L2 webapp persists to localStorage.
function newUserState() {
  const stations = {};
  for (const s of STATIONS) {
    stations[s.id] = {
      learn: false, bronze: false, silver: false, gold: false,
      proved: false, provedAt: null, lastActiveAt: null,
      attempts: 0, missedMotifs: {},
      milestones: isArena(s) ? {} : undefined,
    };
  }
  return { version: 1, stations, wingCrests: {}, session: { deltas: [], startedAt: null, streakDays: 0, lastDay: null } };
}

// ---- Wing Exam capstone: passing stamps the wing's crest (a recognition badge; no % change) ----
function passWingExam(state, wing, whenISO) {
  if (!state.wingCrests) state.wingCrests = {};
  state.wingCrests[wing] = { at: whenISO || true };
}
function hasCrest(state, wing) { return !!(state.wingCrests && state.wingCrests[wing]); }

// ---- Refresher-restore: clear the "refresher due" nudge on a mastered station (no % change) ----
function doRefresher(state, id, whenISO) {
  const st = state.stations[id];
  if (st) st.lastActiveAt = whenISO || st.lastActiveAt;
}

// Mastered stations in a wing (for Silver/Gold interleaving review items), excluding one id.
function wingReviewStations(state, wing, excludeId) {
  return wingStations(wing)
    .filter((s) => s.id !== excludeId && !isArena(s) && stationPercent(state, s.id) >= 100)
    .map((s) => s.id);
}

// Station % — honest, monotonic, 90-capped pre-Prove; 100 on Prove.
function stationPercent(state, id) {
  const st = state.stations[id];
  if (!st) return 0;
  const station = STATION_BY_ID[id];
  if (isArena(station)) {
    const total = station.milestones.length;
    const done = Object.values(st.milestones || {}).filter(Boolean).length;
    return total === 0 ? 0 : Math.round((done / total) * 100);
  }
  if (st.proved) return 100;
  let sum = 0;
  for (const rung of RUNGS) if (st[rung]) sum += COMPONENT_WEIGHTS[rung];
  return Math.min(PRE_PROVE_CAP, sum);
}

function wingStations(wing) { return STATIONS.filter((s) => s.wing === wing); }

function wingPercent(state, wing) {
  const list = wingStations(wing);
  if (list.length === 0) return 0;
  const sum = list.reduce((a, s) => a + stationPercent(state, s.id), 0);
  return Math.round(sum / list.length);
}

function overallPercent(state) {
  let total = 0, wsum = 0;
  for (const wing of Object.keys(WING_WEIGHTS)) {
    total += wingPercent(state, wing) * WING_WEIGHTS[wing];
    wsum += WING_WEIGHTS[wing];
  }
  return Math.round(total / wsum);
}

// Snapshot of every number that could move, for the delta rule.
function snapshot(state, id) {
  const station = STATION_BY_ID[id];
  return {
    station: stationPercent(state, id),
    wing: wingPercent(state, station.wing),
    overall: overallPercent(state),
  };
}

// Award a component/rung or Prove. Monotonic: only ever flips flags on.
// kind: 'learn'|'bronze'|'silver'|'gold'|'prove'  (Arena: use awardMilestone)
// Returns { before, after, changed } snapshots. NEVER decreases any %.
function award(state, id, kind, whenISO) {
  const st = state.stations[id];
  const before = snapshot(state, id);
  st.attempts += 1;
  st.lastActiveAt = whenISO || st.lastActiveAt;
  if (kind === 'prove') {
    st.proved = true;
    st.provedAt = whenISO || st.provedAt;
    // Proving implies the pre-Prove rungs are effectively earned (map stays honest & full).
    for (const r of RUNGS) st[r] = true;
  } else if (RUNGS.includes(kind)) {
    st[kind] = true;
  }
  const after = snapshot(state, id);
  return { id, before, after };
}

function awardMilestone(state, id, milestone, whenISO) {
  const st = state.stations[id];
  const before = snapshot(state, id);
  if (!st.milestones) st.milestones = {};
  st.milestones[milestone] = true;
  st.lastActiveAt = whenISO || st.lastActiveAt;
  const after = snapshot(state, id);
  return { id, before, after };
}

// Record a missed motif (drives Drill composition + `next`).
function recordMiss(state, id, motif) {
  const st = state.stations[id];
  st.missedMotifs[motif] = (st.missedMotifs[motif] || 0) + 1;
}

// Build the delta line(s). Station % ALWAYS; wing/overall only when they moved a point.
function formatDelta(state, result, opts = {}) {
  const station = STATION_BY_ID[result.id];
  const parts = [];
  const b = result.before, a = result.after;
  if (opts.failed) {
    return `${station.name} ${a.station}% (no change) — next: ${opts.nextHint || 'retry this set'}`;
  }
  parts.push(`${station.name} ${b.station}% -> ${a.station}%`);
  if (a.wing !== b.wing) parts.push(`${WINGS[station.wing].name} ${b.wing}% -> ${a.wing}%`);
  if (a.overall !== b.overall) parts.push(`Chess Mastery ${b.overall}% -> ${a.overall}%`);
  return parts.join(' | ');
}

// "Refresher due": a mastered station untouched ~14 days (informational; never steals %).
function refresherDue(state, id, nowISO) {
  const st = state.stations[id];
  if (!st.proved || !st.provedAt) return false;
  const now = nowISO ? Date.parse(nowISO) : null;
  const last = st.lastActiveAt ? Date.parse(st.lastActiveAt) : Date.parse(st.provedAt);
  if (now === null || isNaN(last)) return false;
  return (now - last) >= REFRESHER_DAYS * 86400000;
}

// Weakest stations (lowest %, then most-missed motifs). Excludes fully-proved (100%).
function weakStations(state, limit = 5) {
  return STATIONS
    .map((s) => ({ id: s.id, name: s.name, wing: s.wing, pct: stationPercent(state, s.id), missed: state.stations[s.id].missedMotifs }))
    .filter((s) => s.pct < 100)
    .sort((a, b) => a.pct - b.pct || a.id.localeCompare(b.id))
    .slice(0, limit);
}

function prereqsMet(state, id) {
  const station = STATION_BY_ID[id];
  return (station.prereqs || []).every((p) => stationPercent(state, p) >= 50);
}

// `next`: exactly ONE recommendation — weakest wing -> prereq-ready station -> missed motifs.
function next(state) {
  // 1) Weakest wing by %.
  const wings = Object.keys(WING_WEIGHTS)
    .map((w) => ({ w, pct: wingPercent(state, w) }))
    .sort((a, b) => a.pct - b.pct || a.w.localeCompare(b.w));
  for (const { w } of wings) {
    // 2) In that wing, the lowest-% station whose soft prereqs are met.
    const candidates = wingStations(w)
      .map((s) => ({ s, pct: stationPercent(state, s.id) }))
      .filter((x) => x.pct < 100)
      .sort((a, b) => a.pct - b.pct || a.s.id.localeCompare(b.s.id));
    for (const { s, pct } of candidates) {
      const ready = prereqsMet(state, s.id);
      // 3) If the user has missed motifs here, point at the rung to train.
      const missed = Object.keys(state.stations[s.id].missedMotifs || {});
      const st = state.stations[s.id];
      let action;
      if (isArena(s)) action = `play a game — ${s.name} milestones await (${pct}%)`;
      else if (!st.learn) action = `Learn ${s.id} ${s.name} (${pct}%)`;
      else if (!st.bronze) action = `Drill ${s.id} Bronze (${pct}%)`;
      else if (!st.silver) action = `Drill ${s.id} Silver (${pct}%)`;
      else if (!st.gold) action = `Drill ${s.id} Gold (${pct}%)`;
      else action = `Prove ${s.id} to bank it at 100% (${pct}%)`;
      return {
        stationId: s.id, wing: w, pct, ready,
        prereqNotice: ready ? null : `heads-up: ${s.name}'s prereqs (${s.prereqs.join(', ')}) aren't warmed up yet — you can still try it`,
        missedMotifs: missed,
        text: action + (missed.length ? ` (you've missed: ${missed.join(', ')})` : ''),
      };
    }
  }
  return { stationId: null, text: 'Every station is at 100% — you have mastered this map. Try a refresher or the Arena.' };
}

// Post-game hook for the CLI report (task #4). Lights Arena milestones + one recommendation.
// events: { result: '1-0'|'0-1'|'1/2-1/2', playerColor, aiLevel, mode, byCheckmate, blunders, drawByRuleClaimed, asyncMatch, wonAsyncMatch }
function postGameHook(state, ctx) {
  const lines = [];
  const results = [];
  const ev = (ctx && ctx.events) || {};
  const won = (ev.playerColor === 'w' && ev.result === '1-0') || (ev.playerColor === 'b' && ev.result === '0-1');
  const finished = !!ev.result;
  const now = ev.nowISO;
  const light = (sid, milestone) => {
    const st = state.stations[sid];
    if (st.milestones && !st.milestones[milestone]) { results.push(awardMilestone(state, sid, milestone, now)); lines.push(`Arena milestone lit: ${milestone}`); }
  };

  if (ev.mode === 'ai' && ev.aiLevel === 1) {
    if (finished) light('A1', 'finish a game vs L1');
    if (won) light('A1', 'win vs L1');
    if (won && ev.playerColor === 'b') light('A1', 'win as Black');
  }
  if (ev.mode === 'ai' && won && ev.aiLevel >= 2 && ev.aiLevel <= 5) light('A2', `beat AI L${ev.aiLevel}`);
  if (won && ev.byCheckmate) light('A3', 'win by checkmate');
  // A real 0-hanging-blunder game: reached a natural end (mate/draw, not a resignation) and
  // was a genuine game, not a 3-move abort.
  if (finished && ev.blunders === 0 && ev.mode === 'ai' && ev.naturalEnd && (ev.plies || 0) >= 20) light('A3', '0-blunder game');
  if (ev.drawByRuleClaimed) light('A3', 'claim/receive a threefold or 50-move draw');
  if (ev.asyncMatch && finished) light('A4', 'finish an async match');
  if (ev.wonAsyncMatch) light('A4', 'win an async match');

  const rec = next(state);
  lines.push(`Recommended next: ${rec.text}`);
  return { lines, results };
}

module.exports = {
  COMPONENT_WEIGHTS, PRE_PROVE_CAP, RUNGS, WING_WEIGHTS, WINGS, STATIONS, STATION_BY_ID, REFRESHER_DAYS,
  isArena, newUserState, stationPercent, wingPercent, overallPercent, snapshot,
  award, awardMilestone, recordMiss, formatDelta, refresherDue, weakStations, prereqsMet, next, postGameHook, wingStations,
  passWingExam, hasCrest, doRefresher, wingReviewStations,
};
