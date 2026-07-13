'use strict';

// Phase 5 core: modular gamification (PRODUCT-SPEC §8). A central registry of small feature
// modules — each declares {id, name, description, default, on: {eventName: handler}}. Existing
// code paths fire named events via dispatch(settings, eventName, ctx) without needing to know
// which modules exist or are enabled; only enabled modules' handlers for that event run. Pure,
// I/O-free, host-agnostic — reused verbatim by the CLI and (later) the webapp, same doctrine as
// mastery.js/activity.js.
//
// registerModule() has a side effect (mutates the in-memory registry) — that's the one
// deliberate exception to "pure": modules must be registered once, at require-time, by whoever
// requires lib/gamification-modules.js. dispatch/isEnabled/etc. are pure functions over the
// registry + a settings object.

const MODULES = {};

function registerModule(def) {
  if (!def || !def.id) throw new Error('module needs an id');
  if (!def.hasOwnProperty('default')) throw new Error(`module "${def.id}" needs a default (on/off)`);
  MODULES[def.id] = def;
}

// Test-only escape hatch (permanent tests need a clean registry between cases); never called by
// product code.
function _resetRegistry() { for (const k of Object.keys(MODULES)) delete MODULES[k]; }

function listModules() {
  return Object.keys(MODULES).sort().map((id) => {
    const m = MODULES[id];
    return { id: m.id, name: m.name, description: m.description, default: m.default };
  });
}

// A fresh per-user settings state — every known module defaults to its own `default`.
function newSettingsState() {
  const enabled = {};
  for (const id of Object.keys(MODULES)) enabled[id] = MODULES[id].default;
  return { version: 1, enabled };
}

// Deep-merge a stored (possibly older-shape) settings object onto fresh defaults — same
// migrate-on-load pattern as storage.js/mastery.js, so a module added after a user's last save
// backfills to its own default instead of being missing/undefined.
function migrateSettings(stored) {
  const fresh = newSettingsState();
  if (!stored || typeof stored !== 'object') return fresh;
  return { version: fresh.version, enabled: Object.assign({}, fresh.enabled, stored.enabled || {}) };
}

function isEnabled(settings, id) {
  if (!(id in MODULES)) return false;
  if (settings && settings.enabled && Object.prototype.hasOwnProperty.call(settings.enabled, id)) return !!settings.enabled[id];
  return MODULES[id].default;
}

function setEnabled(settings, id, on) {
  if (!(id in MODULES)) throw new Error(`Unknown module "${id}". Run  gym settings  to list modules.`);
  settings.enabled[id] = !!on;
  return settings;
}

// Fire a named event to every enabled module that listens for it. `ctx` is caller-supplied
// (e.g. { state, nowISO }) — handlers are pure functions of ctx, returning a value (often a
// display line) or undefined/null if they have nothing to say this time. Returns only the
// non-empty results, each tagged with the module id that produced it.
function dispatch(settings, eventName, ctx) {
  const out = [];
  for (const id of Object.keys(MODULES)) {
    const m = MODULES[id];
    if (!m.on || !m.on[eventName]) continue;
    if (!isEnabled(settings, id)) continue;
    const result = m.on[eventName](ctx);
    if (result !== undefined && result !== null) out.push({ id, result });
  }
  return out;
}

module.exports = { registerModule, listModules, newSettingsState, migrateSettings, isEnabled, setEnabled, dispatch, _resetRegistry };
