'use strict';

// Retrofit of a real existing feature as a gamification module (Phase 5 core) — proves the
// registry + event-hook architecture end to end. The underlying LOGIC still lives in its
// original home (lib/mastery.js); this handler just wraps it so it's toggleable through the
// registry instead of being unconditionally hardcoded into the host. Requiring this file is
// what registers the module (side effect, by design — see lib/gamification.js's header note).

const G = require('./gamification');
const M = require('./mastery');

G.registerModule({
  id: 'refresherNudge',
  name: 'Refresher Nudge',
  description: 'Flags mastered stations gone 14+ days without activity (spec §2 "refresher due" — never steals %).',
  default: true,
  on: {
    // ctx: { state, nowISO }. Fired by the map overview; returns a display line or null.
    mapOverview: (ctx) => {
      const due = M.STATIONS.filter((s) => M.refresherDue(ctx.state, s.id, ctx.nowISO)).map((s) => s.id);
      if (!due.length) return null;
      return `refresher due: ${due.join(', ')} (run  gym refresh <id>  to restore the shine — no % is lost)`;
    },
  },
});

G.registerModule({
  id: 'streak',
  name: 'Daily Streak',
  description: 'Announces your day-over-day activity streak on `gym today` (the streak count itself is always tracked in session state; this module governs whether it\'s announced).',
  default: true,
  on: {
    // ctx: { state }. Fired by `gym today`; returns the header line to show.
    todayHeader: (ctx) => `Today — streak ${(ctx.state.session && ctx.state.session.streakDays) || 0} day(s)`,
  },
});

module.exports = G;
