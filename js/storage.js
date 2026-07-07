'use strict';
// Per-user Mastery Map state in localStorage — the SAME shape lib/mastery produces for the CLI's
// data/users/*.json (so a profile is portable between CLI and webapp).
(function () {
  const KEY = 'chessgym:user:default';

  // Deep-merge a stored (possibly older-shape) state onto a FRESH newUserState() so a returning
  // user can never crash on a missing key when a station/field is added post-launch — award(),
  // awardMilestone(), and recordMiss() all assume every known station key exists on state.stations.
  function migrate(stored) {
    const fresh = window.Lib.mastery.newUserState();
    if (!stored || typeof stored !== 'object') return fresh;
    const merged = Object.assign({}, fresh, stored);
    merged.version = fresh.version;
    merged.stations = {};
    for (const id of Object.keys(fresh.stations)) {
      merged.stations[id] = Object.assign({}, fresh.stations[id], (stored.stations && stored.stations[id]) || {});
    }
    merged.wingCrests = Object.assign({}, fresh.wingCrests, stored.wingCrests || {});
    merged.session = Object.assign({}, fresh.session, stored.session || {});
    return merged;
  }

  function load() {
    try { const s = localStorage.getItem(KEY); if (s) return migrate(JSON.parse(s)); } catch (e) { /* fall through */ }
    return window.Lib.mastery.newUserState();
  }
  function save(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* quota/private mode */ } }

  // Intake result is stored SEPARATELY from the mastery state — it's not part of the state
  // shape the CLI persists under data/users/*.json, and intake grants no % (spec §2).
  const INTAKE_KEY = 'chessgym:intake:default';
  function loadIntake() { try { const s = localStorage.getItem(INTAKE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function saveIntake(result) { try { localStorage.setItem(INTAKE_KEY, JSON.stringify(result)); } catch (e) { /* ignore */ } }

  window.Storage = { load, save, KEY, loadIntake, saveIntake, INTAKE_KEY };
})();
